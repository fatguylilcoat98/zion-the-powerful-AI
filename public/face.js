/*
  Zion — Particle Face v3 (talking head).

  v2 had too much around the face — thick orbital bands, bright core
  glow, ambient nebula. The reference Chris approved shows a clear 3D
  talking head with TWO fine orbital traces and no other clutter. This
  pass rebuilds toward that aesthetic:

    - Face = ~4500 particles distributed on a 3D head surface
      (front-weighted half-sphere) with carved eye sockets and
      emphasized feature ridges (brow, nose, mouth, jawline).
    - Rings = 2 thin elliptical traces (220 particles each, small size)
      rotating slowly around the head. Feel like delicate orbits.
    - No core glow, no nebula. Face is the focus.

  All other behaviors preserved from v2:
    - Color lerps to active state palette (teal/cyan/gold/red)
    - Mouth particles displace with window.__voiceLevel during speech
    - Speed multiplier per state
    - Fail-safe to canvas orb on WebGL / Three.js failure
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.THREE) { console.warn('[face] Three.js not loaded — keeping canvas orb'); return; }

    const FACE_COUNT  = 4500;
    const RING_COUNT  = 220; // per ring × 2 rings = 440

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face] neural-center missing'); return; }

    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) { console.warn('[face] WebGL not available — keeping canvas orb'); return; }

    // ─── Soft sprite for additive glow ──────────────────────────────
    function makeSprite() {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const sctx = c.getContext('2d');
      const g = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0,    'rgba(255,255,255,1)');
      g.addColorStop(0.20, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.50, 'rgba(255,255,255,0.22)');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }

    // ─── 3D talking-head shape ──────────────────────────────────────
    // Particles distributed on a front-weighted half-sphere. Eye sockets
    // carved out as negative space. Higher density around feature ridges
    // (brow, nose, mouth, jawline) for definition. Light density on the
    // back of the head so it has dimension but stays a "front view".
    const facePositions = new Float32Array(FACE_COUNT * 3);
    const faceAnchors   = new Float32Array(FACE_COUNT * 3);
    const facePhases    = new Float32Array(FACE_COUNT);
    const isMouth       = new Uint8Array(FACE_COUNT);

    // Face dimensions (normalized units)
    const HEAD_RX = 0.62;
    const HEAD_RY = 0.82;
    const HEAD_RZ = 0.55;
    const EYE_Y = 0.18;
    const EYE_X = 0.22;
    const EYE_RADIUS = 0.13;
    const MOUTH_Y = -0.36;
    const NOSE_Y_TOP = 0.10;
    const NOSE_Y_BOT = -0.18;

    let fi = 0;
    function pushAnchor(x, y, z, mouth) {
      if (fi >= FACE_COUNT) return false;
      faceAnchors[fi * 3]     = x;
      faceAnchors[fi * 3 + 1] = y;
      faceAnchors[fi * 3 + 2] = z;
      facePhases[fi]          = Math.random() * Math.PI * 2;
      isMouth[fi]             = mouth ? 1 : 0;
      facePositions[fi * 3]     = (Math.random() - 0.5) * 2.6;
      facePositions[fi * 3 + 1] = (Math.random() - 0.5) * 2.6;
      facePositions[fi * 3 + 2] = (Math.random() - 0.5) * 0.8;
      fi++;
      return true;
    }

    function inEyeSocket(x, y, z) {
      if (z < 0.10) return false; // only carve front of face
      const dl = Math.hypot(x + EYE_X, y - EYE_Y);
      const dr = Math.hypot(x - EYE_X, y - EYE_Y);
      return dl < EYE_RADIUS || dr < EYE_RADIUS;
    }

    function inFeatureRidge(x, y, z) {
      if (z < 0.18) return false; // ridges only on front
      // Brow ridge
      if (y > 0.30 && y < 0.42 && Math.abs(x) < 0.30) return true;
      // Nose ridge
      if (Math.abs(x) < 0.045 && y > NOSE_Y_BOT && y < NOSE_Y_TOP) return true;
      // Mouth ridge
      if (y > MOUTH_Y - 0.04 && y < MOUTH_Y + 0.04 && Math.abs(x) < 0.30) return true;
      // Jawline
      const jawDist = Math.hypot(x / 0.55, (y + 0.78) / 0.18);
      if (jawDist < 1.0 && y < -0.55) return true;
      return false;
    }

    function attemptPlace() {
      const u = Math.random() * Math.PI * 2;
      const rawV = Math.random();
      const v = Math.acos(2 * rawV - 1);

      const sx = Math.sin(v) * Math.cos(u);
      const sy = Math.cos(v);
      const sz = Math.sin(v) * Math.sin(u);

      let x = sx * HEAD_RX;
      let y = sy * HEAD_RY - 0.05;
      let z = sz * HEAD_RZ;

      // Reject most back-of-head points so the face reads as a front view.
      if (z < 0 && Math.random() > 0.18) return false;

      if (inFeatureRidge(x, y, z) && Math.random() < 0.65) {
        x *= 1.02;
        y *= 1.02;
        z = Math.min(z + 0.02, HEAD_RZ);
      }

      if (inEyeSocket(x, y, z)) return false;

      x += (Math.random() - 0.5) * 0.015;
      y += (Math.random() - 0.5) * 0.015;
      z += (Math.random() - 0.5) * 0.015;

      const isInMouth = (z > 0.20 && Math.abs(y - MOUTH_Y) < 0.05 && Math.abs(x) < 0.25);
      return pushAnchor(x, y, z, isInMouth);
    }

    let attempts = 0;
    while (fi < FACE_COUNT && attempts < FACE_COUNT * 8) {
      attemptPlace();
      attempts++;
    }
    while (fi < FACE_COUNT) {
      pushAnchor((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0, false);
    }

    // ─── Three.js scene ─────────────────────────────────────────────
    let scene, camera, renderer, faceCanvas;
    let faceLayer;
    const rings = [];

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

      const sprite = makeSprite();

      const faceGeom = new THREE.BufferGeometry();
      faceGeom.setAttribute('position', new THREE.BufferAttribute(facePositions, 3));
      const faceMat = new THREE.PointsMaterial({
        size: 0.060,
        color: 0x4FB8C9,
        map: sprite,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      faceLayer = new THREE.Points(faceGeom, faceMat);
      scene.add(faceLayer);

      // Two fine orbital traces around the head.
      const ringSpecs = [
        { rx: 1.05, ry: 0.95, tilt: [ 0.30,  0.08, -0.10], speed:  0.28, color: 0x00E5FF, opacity: 0.72, size: 0.028 },
        { rx: 1.18, ry: 1.10, tilt: [-0.18, -0.05,  0.42], speed: -0.20, color: 0x9eeaff, opacity: 0.62, size: 0.024 },
      ];
      ringSpecs.forEach((spec) => {
        const pos = new Float32Array(RING_COUNT * 3);
        for (let k = 0; k < RING_COUNT; k++) {
          const a = (k / RING_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.03;
          pos[k * 3]     = Math.cos(a) * spec.rx + (Math.random() - 0.5) * 0.012;
          pos[k * 3 + 1] = Math.sin(a) * spec.ry + (Math.random() - 0.5) * 0.012;
          pos[k * 3 + 2] = (Math.random() - 0.5) * 0.012;
        }
        const ringGeom = new THREE.BufferGeometry();
        ringGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const ringMat = new THREE.PointsMaterial({
          size: spec.size,
          color: spec.color,
          map: sprite,
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
    const faceLerped = new THREE.Color(STATES.idle.primary);
    const faceTarget = new THREE.Color(STATES.idle.primary);

    const t0 = performance.now();
    let lastState = '';

    function frame() {
      const time = (performance.now() - t0) / 1000;
      const voice = window.__voiceLevel || 0;
      const state = window.__orbState || 'idle';

      if (state !== lastState) {
        const palette = STATES[state] || STATES.idle;
        faceTarget.set(palette.primary);
        lastState = state;
      }
      faceLerped.lerp(faceTarget, 0.08);
      faceLayer.material.color.copy(faceLerped);

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

        const jx = Math.sin(time * 0.6 * speedMul + ph) * 0.0045;
        const jy = Math.cos(time * 0.8 * speedMul + ph * 1.3) * 0.0045;
        const jz = Math.sin(time * 0.5 * speedMul + ph * 0.7) * 0.008;

        const mouthY = isMouth[k] ? Math.sin(time * 8 + ph) * voice * 0.10 : 0;
        const mouthZ = isMouth[k] ? Math.cos(time * 8 + ph) * voice * 0.04 : 0;

        const breath = 1 + Math.sin(time * 1.2 * speedMul) * 0.012;

        if (assemble < 1) {
          const cx = posArr[k * 3], cy = posArr[k * 3 + 1], cz = posArr[k * 3 + 2];
          posArr[k * 3]     = cx + ((ax + jx) * breath - cx) * 0.04;
          posArr[k * 3 + 1] = cy + ((ay + jy + mouthY) * breath - cy) * 0.04;
          posArr[k * 3 + 2] = cz + ((az + jz + mouthZ) * breath - cz) * 0.04;
        } else {
          posArr[k * 3]     = (ax + jx) * breath;
          posArr[k * 3 + 1] = (ay + jy + mouthY) * breath;
          posArr[k * 3 + 2] = (az + jz + mouthZ) * breath;
        }
      }
      faceLayer.geometry.attributes.position.needsUpdate = true;

      faceLayer.material.size = state === 'speaking' ? (0.060 + voice * 0.05) : 0.060;

      for (const ring of rings) {
        ring.mesh.rotation.z += ring.rotSpeed * 0.01 * speedMul;
        ring.mesh.rotation.y += ring.rotSpeed * 0.0035 * speedMul;
        ring.material.color.lerp(faceTarget, 0.04);
      }

      faceLayer.rotation.y = Math.sin(time * 0.30 * speedMul) * 0.22;
      faceLayer.rotation.x = Math.sin(time * 0.22 * speedMul) * 0.07;

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);

    console.log('[face] v3 talking-head — face=' + FACE_COUNT + ', rings=' + (rings.length * RING_COUNT));
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
