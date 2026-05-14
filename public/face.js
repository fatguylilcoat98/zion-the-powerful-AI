/*
  Zion — Particle Face v2 (luminous).

  Splendor's orb reads as *beautiful* because it has depth: a hot
  glowing core, concentric tilted orbital rings, an ambient halo.
  This pass layers that cosmic structure around the face so Zion
  reads as luminous, not pixelly.

  Layers (each is a Three.js Points object):
    1. Core glow     — one giant white-hot sprite at origin
    2. Face          — ~3200 particles in head/eyes/nose/mouth shape
    3. Orbital rings — 3 tilted ellipse rings, each rotating at its
                       own rate (matches Splendor's orbital trails)
    4. Nebula        — ~800 scattered particles forming an ambient
                       halo cloud around the whole thing

  All layers respond to the state machine:
    - Color lerps to the active state's primary teal/cyan/gold/red
    - Speaking → mouth particles displace with window.__voiceLevel
    - Speed multiplier per state affects ring rotation + breathing

  Fail-safe behavior is unchanged from v1: if Three.js never loads,
  if WebGL is unavailable, or if any init step throws, this module
  returns silently and the canvas-2D orb keeps drawing.
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.THREE) { console.warn('[face] Three.js not loaded — keeping canvas orb'); return; }

    const FACE_COUNT   = 3200;
    const NEBULA_COUNT = 800;
    const RING_COUNT   = 500; // per ring × 3 rings = 1500

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face] neural-center missing'); return; }

    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) { console.warn('[face] WebGL not available — keeping canvas orb'); return; }

    // ───────────────────────────────────────────────────────────────
    // Soft glow sprite — big radial gradient texture. Each particle
    // wears this as a halo when rendered with AdditiveBlending, so
    // overlapping particles bloom into one another instead of
    // looking like a constellation of dots.
    // ───────────────────────────────────────────────────────────────
    function makeSprite(falloff) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const sctx = c.getContext('2d');
      const g = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0,    'rgba(255,255,255,1)');
      g.addColorStop(0.18, 'rgba(255,255,255,' + (0.75 * falloff) + ')');
      g.addColorStop(0.45, 'rgba(255,255,255,' + (0.30 * falloff) + ')');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }

    // ───────────────────────────────────────────────────────────────
    // Face anchors — same layout as v1 (head outline, eyes, nose,
    // mouth, scattered fill). Mouth particles are tagged audio-reactive.
    // ───────────────────────────────────────────────────────────────
    const facePositions = new Float32Array(FACE_COUNT * 3);
    const faceAnchors   = new Float32Array(FACE_COUNT * 3);
    const facePhases    = new Float32Array(FACE_COUNT);
    const isMouth       = new Uint8Array(FACE_COUNT);

    let fi = 0;
    function pushFace(x, y, z, mouth) {
      if (fi >= FACE_COUNT) return;
      faceAnchors[fi * 3]     = x;
      faceAnchors[fi * 3 + 1] = y;
      faceAnchors[fi * 3 + 2] = z;
      facePhases[fi]          = Math.random() * Math.PI * 2;
      isMouth[fi]             = mouth ? 1 : 0;
      facePositions[fi * 3]     = (Math.random() - 0.5) * 2.4;
      facePositions[fi * 3 + 1] = (Math.random() - 0.5) * 2.4;
      facePositions[fi * 3 + 2] = (Math.random() - 0.5) * 0.6;
      fi++;
    }

    // Head outline (22%)
    const headOutline = Math.floor(FACE_COUNT * 0.22);
    for (let k = 0; k < headOutline; k++) {
      const a = (k / headOutline) * Math.PI * 2;
      const rx = 0.68 + (Math.random() - 0.5) * 0.03;
      const ry = 0.92 + (Math.random() - 0.5) * 0.03;
      pushFace(Math.cos(a) * rx, Math.sin(a) * ry - 0.05, 0, false);
    }
    // Jaw V (5%)
    const jawCount = Math.floor(FACE_COUNT * 0.05);
    for (let k = 0; k < jawCount; k++) {
      const t = (k / jawCount) * 2 - 1;
      pushFace(t * 0.55 + (Math.random() - 0.5) * 0.04, -0.85 + Math.abs(t) * 0.15 + (Math.random() - 0.5) * 0.03, 0, false);
    }
    // Eyes (12% combined)
    const eyeCount = Math.floor(FACE_COUNT * 0.06);
    for (let k = 0; k < eyeCount; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.09;
      pushFace(-0.27 + Math.cos(a) * r * 1.3, 0.22 + Math.sin(a) * r * 0.7, 0.02, false);
    }
    for (let k = 0; k < eyeCount; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.09;
      pushFace(0.27 + Math.cos(a) * r * 1.3, 0.22 + Math.sin(a) * r * 0.7, 0.02, false);
    }
    // Nose (5%)
    const noseCount = Math.floor(FACE_COUNT * 0.05);
    for (let k = 0; k < noseCount; k++) {
      const t = k / noseCount;
      pushFace((Math.random() - 0.5) * 0.10, 0.05 - t * 0.30, 0.03, false);
    }
    // Mouth (10%) — AUDIO-REACTIVE
    const mouthCount = Math.floor(FACE_COUNT * 0.10);
    for (let k = 0; k < mouthCount; k++) {
      const t = (k / mouthCount) * 2 - 1;
      pushFace(t * 0.32, -0.42 + (Math.random() - 0.5) * 0.05, 0.02, true);
    }
    // Forehead + cheek fill (the rest)
    while (fi < FACE_COUNT) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.55;
      const x = Math.cos(a) * r * 0.78;
      const y = Math.sin(a) * r * 0.95 - 0.05;
      const inLeftEye  = Math.hypot(x + 0.27, y - 0.22) < 0.13;
      const inRightEye = Math.hypot(x - 0.27, y - 0.22) < 0.13;
      const inMouth    = Math.hypot(x, y + 0.42) < 0.10 && Math.abs(y + 0.42) < 0.08;
      if (inLeftEye || inRightEye || inMouth) continue;
      // Slight convex z — fills out depth so the face isn't pancake-flat.
      const z = 0.18 * Math.exp(-(x * x + y * y) * 2.2);
      pushFace(x, y, z + (Math.random() - 0.5) * 0.04, false);
    }

    // ───────────────────────────────────────────────────────────────
    // Three.js scene + layers
    // ───────────────────────────────────────────────────────────────
    let scene, camera, renderer, faceCanvas;
    let faceLayer, coreLayer, nebulaLayer;
    const rings = []; // { mesh, material, rotSpeed }

    try {
      scene = new THREE.Scene();
      const aspect = neuralCenter.clientWidth / neuralCenter.clientHeight || 1;
      camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
      camera.position.set(0, 0, 2.6);
      camera.lookAt(0, 0, 0);

      faceCanvas = document.createElement('canvas');
      faceCanvas.id = 'faceCanvas';
      faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none;';
      neuralCenter.appendChild(faceCanvas);

      renderer = new THREE.WebGLRenderer({ canvas: faceCanvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(neuralCenter.clientWidth, neuralCenter.clientHeight, false);
      renderer.setClearColor(0x000000, 0);

      const softSprite   = makeSprite(1.0);
      const ringSprite   = makeSprite(0.85);
      const coreSprite   = makeSprite(1.0);
      const nebulaSprite = makeSprite(0.55);

      // ─── Core glow — one giant white-hot particle at origin
      const coreGeom = new THREE.BufferGeometry();
      coreGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -0.05, -0.05]), 3));
      const coreMat = new THREE.PointsMaterial({
        size: 1.4,
        color: 0xE0FFFF,
        map: coreSprite,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      coreLayer = new THREE.Points(coreGeom, coreMat);
      scene.add(coreLayer);

      // ─── Face — main particles, bigger soft sprites
      const faceGeom = new THREE.BufferGeometry();
      faceGeom.setAttribute('position', new THREE.BufferAttribute(facePositions, 3));
      const faceMat = new THREE.PointsMaterial({
        size: 0.085,
        color: 0x4FB8C9,
        map: softSprite,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      faceLayer = new THREE.Points(faceGeom, faceMat);
      scene.add(faceLayer);

      // ─── Orbital rings — 3 tilted ellipses around the face
      const ringSpecs = [
        { rx: 1.05, ry: 0.95, tilt: [ 0.28,  0.10,  0.00], speed:  0.28, color: 0x00E5FF, opacity: 0.75 },
        { rx: 1.22, ry: 1.10, tilt: [-0.20,  0.00,  0.45], speed: -0.22, color: 0x00BFC4, opacity: 0.65 },
        { rx: 1.40, ry: 1.28, tilt: [ 0.15, -0.30,  0.10], speed:  0.17, color: 0x9eeaff, opacity: 0.55 },
      ];
      ringSpecs.forEach((spec) => {
        const pos = new Float32Array(RING_COUNT * 3);
        for (let k = 0; k < RING_COUNT; k++) {
          const a = (k / RING_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;
          pos[k * 3]     = Math.cos(a) * spec.rx + (Math.random() - 0.5) * 0.04;
          pos[k * 3 + 1] = Math.sin(a) * spec.ry + (Math.random() - 0.5) * 0.04;
          pos[k * 3 + 2] = (Math.random() - 0.5) * 0.04;
        }
        const ringGeom = new THREE.BufferGeometry();
        ringGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const ringMat = new THREE.PointsMaterial({
          size: 0.055,
          color: spec.color,
          map: ringSprite,
          transparent: true,
          opacity: spec.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Points(ringGeom, ringMat);
        mesh.rotation.x = spec.tilt[0];
        mesh.rotation.y = spec.tilt[1];
        mesh.rotation.z = spec.tilt[2];
        scene.add(mesh);
        rings.push({ mesh, material: ringMat, rotSpeed: spec.speed });
      });

      // ─── Nebula — scattered ambient halo around the face
      const nebPos = new Float32Array(NEBULA_COUNT * 3);
      for (let k = 0; k < NEBULA_COUNT; k++) {
        const u = Math.random();
        const radius = 0.9 + Math.sqrt(u) * 0.95;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        nebPos[k * 3]     = Math.sin(phi) * Math.cos(theta) * radius;
        nebPos[k * 3 + 1] = Math.cos(phi) * radius * 0.9;
        nebPos[k * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius * 0.6;
      }
      const nebGeom = new THREE.BufferGeometry();
      nebGeom.setAttribute('position', new THREE.BufferAttribute(nebPos, 3));
      const nebMat = new THREE.PointsMaterial({
        size: 0.10,
        color: 0x4FB8C9,
        map: nebulaSprite,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      nebulaLayer = new THREE.Points(nebGeom, nebMat);
      scene.add(nebulaLayer);
    } catch (err) {
      console.warn('[face] init failed, keeping canvas orb:', err.message);
      if (faceCanvas && faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
      return;
    }

    if (orbCanvas) orbCanvas.style.visibility = 'hidden';

    function resize() {
      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    const STATES = window.__STATE_COLORS || {
      idle:      { primary: '#4FB8C9' },
      listening: { primary: '#39ff14' },
      streaming: { primary: '#00BFC4' },
      speaking:  { primary: '#00E5FF' },
      thinking:  { primary: '#FFD166' },
      creating:  { primary: '#FFD166' },
      fault:     { primary: '#FF5C5C' },
    };
    const faceLerped   = new THREE.Color(STATES.idle.primary);
    const faceTarget   = new THREE.Color(STATES.idle.primary);
    const nebulaLerped = new THREE.Color(STATES.idle.primary);
    const nebulaTarget = new THREE.Color(STATES.idle.primary);
    const coreWhite    = new THREE.Color(0xE0FFFF);

    const t0 = performance.now();
    let lastState = '';

    function frame() {
      const time = (performance.now() - t0) / 1000;
      const voice = window.__voiceLevel || 0;
      const state = window.__orbState || 'idle';

      if (state !== lastState) {
        const palette = STATES[state] || STATES.idle;
        faceTarget.set(palette.primary);
        nebulaTarget.set(palette.primary);
        lastState = state;
      }
      faceLerped.lerp(faceTarget, 0.08);
      nebulaLerped.lerp(nebulaTarget, 0.05);
      faceLayer.material.color.copy(faceLerped);
      nebulaLayer.material.color.copy(nebulaLerped);

      const speedMul =
        state === 'speaking'  ? (1 + voice * 1.5) :
        state === 'listening' ? 1.6 :
        state === 'streaming' ? 1.3 :
        state === 'creating'  ? 1.8 :
        state === 'thinking'  ? 1.1 :
        state === 'fault'     ? 0.5 : 1.0;

      const posArr = faceLayer.geometry.attributes.position.array;
      const assemble = Math.min(1, time / 1.4);
      for (let k = 0; k < FACE_COUNT; k++) {
        const ax = faceAnchors[k * 3];
        const ay = faceAnchors[k * 3 + 1];
        const az = faceAnchors[k * 3 + 2];
        const ph = facePhases[k];

        const jx = Math.sin(time * 0.6 * speedMul + ph) * 0.006;
        const jy = Math.cos(time * 0.8 * speedMul + ph * 1.3) * 0.006;
        const jz = Math.sin(time * 0.5 * speedMul + ph * 0.7) * 0.012;
        const mouthY = isMouth[k] ? Math.sin(time * 8 + ph) * voice * 0.10 : 0;
        const breath = 1 + Math.sin(time * 1.2 * speedMul) * 0.018;

        if (assemble < 1) {
          const cx = posArr[k * 3], cy = posArr[k * 3 + 1], cz = posArr[k * 3 + 2];
          posArr[k * 3]     = cx + ((ax + jx) * breath - cx) * 0.04;
          posArr[k * 3 + 1] = cy + ((ay + jy + mouthY) * breath - cy) * 0.04;
          posArr[k * 3 + 2] = cz + ((az + jz) - cz) * 0.04;
        } else {
          posArr[k * 3]     = (ax + jx) * breath;
          posArr[k * 3 + 1] = (ay + jy + mouthY) * breath;
          posArr[k * 3 + 2] = az + jz;
        }
      }
      faceLayer.geometry.attributes.position.needsUpdate = true;

      faceLayer.material.size = state === 'speaking' ? (0.085 + voice * 0.06) : 0.085;

      // Core glow pulses with state + voice
      const coreBase = state === 'speaking' ? (1.4 + voice * 0.6)
                     : state === 'fault'    ? 0.9
                     : 1.4 + Math.sin(time * 0.9 * speedMul) * 0.10;
      coreLayer.material.size = coreBase;
      coreLayer.material.color.copy(faceLerped).lerp(coreWhite, 0.55);
      coreLayer.material.opacity = 0.45 + Math.sin(time * 0.7 * speedMul) * 0.10 + voice * 0.20;

      // Orbital rings rotate at their own rates; color follows face
      for (const ring of rings) {
        ring.mesh.rotation.z += ring.rotSpeed * 0.01 * speedMul;
        ring.mesh.rotation.y += ring.rotSpeed * 0.004 * speedMul;
        ring.material.color.lerp(faceTarget, 0.04);
      }

      // Nebula drifts slowly
      nebulaLayer.rotation.y = time * 0.04 * speedMul;
      nebulaLayer.rotation.x = Math.sin(time * 0.08) * 0.05;
      nebulaLayer.material.opacity = 0.30 + Math.sin(time * 0.5) * 0.08 + voice * 0.10;

      // Face sway
      faceLayer.rotation.y = Math.sin(time * 0.25 * speedMul) * 0.16;
      faceLayer.rotation.x = Math.sin(time * 0.18 * speedMul) * 0.05;

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);

    console.log('[face] v2 initialized — face=' + FACE_COUNT +
                ', rings=' + (rings.length * RING_COUNT) +
                ', nebula=' + NEBULA_COUNT +
                ', core=1');
  }

  function waitForThreeAndInit() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.THREE) {
        clearInterval(interval);
        try { tryInit(); } catch (e) { console.warn('[face] init threw:', e.message); }
      } else if (attempts > 30) {
        clearInterval(interval);
        console.warn('[face] Three.js never appeared after 3s — keeping canvas orb');
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForThreeAndInit);
  } else {
    waitForThreeAndInit();
  }
})();
