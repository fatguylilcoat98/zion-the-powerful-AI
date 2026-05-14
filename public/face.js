/*
  Zion — Particle Face v5 (Matrix-style talking head).

  Critique that drove this pass (from Chris):
    "art isn't your best area so im really challenging you here"
    "splendor is stunning, zion isn't very good"
    "the particles should be wired to the voice"
    "move and talk like a human head"
    "should look like a human head"
    "think like the head from the matrix movie"

  Two things changed from v4:

  1. EXPLICIT FACE FEATURES (v4 layout, proven). The face is built from
     explicit feature regions — head outline, hair, eyebrows, nose ridge,
     nostrils, cheeks (with eye sockets carved as negative space), upper
     lip, lower lip, mouth interior, jaw + chin. So the face actually
     reads as a face, not an egg.

  2. MATRIX FLOW. Every particle has a per-particle drift phase + speed.
     Each frame the phase advances, the particle drifts downward by up to
     0.16 units, then wraps back to its anchor. Brightness fades in at
     the anchor and out at the bottom of the lane. The face is therefore
     made of constantly-streaming particles — recognizable but always
     in motion. Speed multiplier from state machine accelerates the
     stream during speech.

  TALKING — when window.__voiceLevel rises:
    - upper lip particles displace +0.06 * voice  (lip rises)
    - lower lip particles displace -0.10 * voice  (lip drops further)
    - jaw + chin displace -0.05 * voice            (jaw drops)
    - mouth-interior layer opacity fades in       (the gap "opens")
    - mouth-interior particles stream faster      (more motion in the gap)
    - eyebrow particles raise +0.018 * voice      (subtle brow lift)
    - face particle size pulses +0.04 * voice

  Two thin orbital rings preserved. No core glow, no nebula clutter.
  Same canvas-orb fail-safe on Three.js / WebGL failure.
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.THREE) { console.warn('[face] Three.js not loaded — keeping canvas orb'); return; }

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face] neural-center missing'); return; }

    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) { console.warn('[face] WebGL not available — keeping canvas orb'); return; }

    // Roles drive per-region motion + audio response.
    const ROLE_FILL     = 0;
    const ROLE_EYEBROW  = 1;
    const ROLE_NOSE     = 2;
    const ROLE_UPLIP    = 3;
    const ROLE_LOWLIP   = 4;
    const ROLE_INTERIOR = 5;
    const ROLE_JAW      = 6;

    const CAP = 7000;
    const positions = new Float32Array(CAP * 3);
    const anchors   = new Float32Array(CAP * 3);
    const phases    = new Float32Array(CAP);
    const speeds    = new Float32Array(CAP);
    const amps      = new Float32Array(CAP);
    const roles     = new Uint8Array(CAP);
    let fi = 0;

    function push(x, y, z, role, opts) {
      if (fi >= CAP) return;
      anchors[fi * 3]     = x;
      anchors[fi * 3 + 1] = y;
      anchors[fi * 3 + 2] = z;
      phases[fi]          = Math.random();
      speeds[fi]          = (opts && opts.speed) || (0.30 + Math.random() * 0.35);
      amps[fi]            = (opts && opts.amp)   || (0.06 + Math.random() * 0.10);
      roles[fi]           = role;
      positions[fi * 3]     = (Math.random() - 0.5) * 2.8;
      positions[fi * 3 + 1] = (Math.random() - 0.5) * 2.8;
      positions[fi * 3 + 2] = (Math.random() - 0.5) * 0.8;
      fi++;
    }

    function reliefZ(x, y) {
      return 0.16 * Math.exp(-(x * x * 1.8 + y * y * 1.2));
    }

    function inEyeSocket(x, y) {
      const dl = Math.hypot(x + 0.24, y - 0.22);
      const dr = Math.hypot(x - 0.24, y - 0.22);
      return dl < 0.13 || dr < 0.13;
    }

    // 1) Head silhouette outline (220)
    for (let k = 0; k < 220; k++) {
      const a  = (k / 220) * Math.PI * 2;
      const rx = 0.62 + (Math.random() - 0.5) * 0.015;
      const ry = 0.92 + (Math.random() - 0.5) * 0.015;
      const x  = Math.cos(a) * rx;
      const y  = Math.sin(a) * ry - 0.05;
      push(x, y, reliefZ(x, y) * 0.4, ROLE_FILL);
    }

    // 2) Hair/scalp sparse band (160)
    for (let k = 0; k < 160; k++) {
      const t = (Math.random() - 0.5) * 1.05;
      const x = t * 0.55;
      const y = 0.68 + Math.random() * 0.22 - Math.abs(t) * 0.12;
      push(x, y, reliefZ(x, y) * 0.55, ROLE_FILL, { amp: 0.20 });
    }

    // 3) Forehead fill (450)
    let attempts = 0, placed = 0;
    while (placed < 450 && attempts < 1500) {
      attempts++;
      const x = (Math.random() - 0.5) * 0.95;
      const y = 0.42 + Math.random() * 0.30;
      if (Math.hypot(x / 0.60, (y + 0.05) / 0.88) > 1.0) continue;
      push(x, y, reliefZ(x, y) * 0.8, ROLE_FILL);
      placed++;
    }

    // 4) Eyebrows — 2 short curved arcs (260)
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 130; k++) {
        const t    = k / 130;
        const xOff = (t - 0.5) * 0.30;
        const x    = side * 0.24 + xOff;
        const y    = 0.42 - Math.abs(t - 0.5) * 0.025 + (Math.random() - 0.5) * 0.012;
        push(x, y, reliefZ(x, y) * 1.05, ROLE_EYEBROW, { amp: 0.04 });
      }
    }

    // 5) Nose bridge — vertical ridge (220)
    for (let k = 0; k < 220; k++) {
      const t = k / 220;
      const x = (Math.random() - 0.5) * 0.055;
      const y = 0.30 - t * 0.30;
      const z = reliefZ(x, y) * 1.15 + t * 0.04;
      push(x, y, z, ROLE_NOSE, { amp: 0.05 });
    }

    // 6) Nostrils — wider density at base of nose (170)
    for (let k = 0; k < 170; k++) {
      const side = (k % 2 === 0) ? -1 : 1;
      const x    = side * (0.04 + Math.random() * 0.07);
      const y    = -0.02 - Math.random() * 0.09;
      push(x, y, reliefZ(x, y) * 1.0, ROLE_NOSE, { amp: 0.06 });
    }

    // 7) Cheeks — scattered fill (1300). Avoids eye sockets + features.
    attempts = 0; placed = 0;
    while (placed < 1300 && attempts < 5500) {
      attempts++;
      const x = (Math.random() - 0.5) * 1.05;
      const y = (Math.random() - 0.5) * 1.1 - 0.08;
      if (Math.hypot(x / 0.60, (y + 0.05) / 0.88) > 0.98) continue;
      if (inEyeSocket(x, y)) continue;
      if (Math.abs(x) < 0.07 && y > -0.15 && y < 0.30) continue;
      if (Math.abs(y + 0.32) < 0.10 && Math.abs(x) < 0.22) continue;
      if (Math.abs(y - 0.42) < 0.025 && Math.abs(Math.abs(x) - 0.24) < 0.16) continue;
      push(x, y, reliefZ(x, y) * 0.7, ROLE_FILL);
      placed++;
    }

    // 8) Upper lip — horizontal arc with cupid's bow (300)
    for (let k = 0; k < 300; k++) {
      const t   = (k / 300) * 2 - 1;
      const x   = t * 0.21;
      const bow = Math.cos(t * Math.PI) * 0.012;
      const y   = -0.27 - bow + (Math.random() - 0.5) * 0.012;
      push(x, y, reliefZ(x, y) * 1.1, ROLE_UPLIP, { amp: 0.04 });
    }

    // 9) Lower lip — horizontal arc (300)
    for (let k = 0; k < 300; k++) {
      const t = (k / 300) * 2 - 1;
      const x = t * 0.21;
      const y = -0.36 + Math.sin(Math.abs(t) * Math.PI * 0.5) * 0.02 + (Math.random() - 0.5) * 0.012;
      push(x, y, reliefZ(x, y) * 1.1, ROLE_LOWLIP, { amp: 0.04 });
    }

    // 10) Mouth interior — fills the gap when she opens her mouth (180)
    for (let k = 0; k < 180; k++) {
      const t = (Math.random() - 0.5) * 2;
      const x = t * 0.18;
      const y = -0.315 + (Math.random() - 0.5) * 0.025;
      push(x, y, reliefZ(x, y) * 1.0, ROLE_INTERIOR, { speed: 0.9, amp: 0.10 });
    }

    // 11) Jaw + chin curve (470)
    for (let k = 0; k < 470; k++) {
      const t  = (k / 470) * 2 - 1;
      const a  = Math.PI + (t + 1) * Math.PI / 2 * 0.5;
      const rx = 0.56, ry = 0.40;
      const x  = Math.cos(a) * rx;
      const y  = -0.50 + Math.sin(a) * ry;
      push(x + (Math.random() - 0.5) * 0.02, y + (Math.random() - 0.5) * 0.02, reliefZ(x, y) * 0.9, ROLE_JAW);
    }

    // 12) Chin tip emphasis (70)
    for (let k = 0; k < 70; k++) {
      const x = (Math.random() - 0.5) * 0.18;
      const y = -0.82 + (Math.random() - 0.5) * 0.04;
      push(x, y, reliefZ(x, y) * 0.95, ROLE_JAW);
    }

    const N = fi;

    // Split into main + interior layers for independent opacity rules.
    let mainN = 0, intN = 0;
    const mainP = new Float32Array(N * 3), mainA = new Float32Array(N * 3),
          mainPh = new Float32Array(N), mainSp = new Float32Array(N),
          mainAm = new Float32Array(N), mainR = new Uint8Array(N);
    const intP = new Float32Array(N * 3), intA = new Float32Array(N * 3),
          intPh = new Float32Array(N), intSp = new Float32Array(N),
          intAm = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (roles[k] === ROLE_INTERIOR) {
        intP[intN * 3] = positions[k * 3];     intP[intN * 3 + 1] = positions[k * 3 + 1]; intP[intN * 3 + 2] = positions[k * 3 + 2];
        intA[intN * 3] = anchors[k * 3];       intA[intN * 3 + 1] = anchors[k * 3 + 1];   intA[intN * 3 + 2] = anchors[k * 3 + 2];
        intPh[intN] = phases[k]; intSp[intN] = speeds[k]; intAm[intN] = amps[k];
        intN++;
      } else {
        mainP[mainN * 3] = positions[k * 3];   mainP[mainN * 3 + 1] = positions[k * 3 + 1]; mainP[mainN * 3 + 2] = positions[k * 3 + 2];
        mainA[mainN * 3] = anchors[k * 3];     mainA[mainN * 3 + 1] = anchors[k * 3 + 1];   mainA[mainN * 3 + 2] = anchors[k * 3 + 2];
        mainPh[mainN] = phases[k]; mainSp[mainN] = speeds[k]; mainAm[mainN] = amps[k];
        mainR[mainN]  = roles[k];
        mainN++;
      }
    }

    let scene, camera, renderer, faceCanvas;
    let faceLayer, interiorLayer;
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

      const sc = document.createElement('canvas');
      sc.width = sc.height = 128;
      const sctx = sc.getContext('2d');
      const g = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0,    'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 128, 128);
      const sprite = new THREE.CanvasTexture(sc);

      // Per-vertex colors for per-particle brightness (Matrix shimmer + lane fade).
      const mainColors = new Float32Array(mainN * 3);
      for (let k = 0; k < mainN; k++) {
        mainColors[k * 3]     = 0.31;
        mainColors[k * 3 + 1] = 0.72;
        mainColors[k * 3 + 2] = 0.79;
      }
      const faceGeom = new THREE.BufferGeometry();
      faceGeom.setAttribute('position', new THREE.BufferAttribute(mainP.subarray(0, mainN * 3), 3));
      faceGeom.setAttribute('color',    new THREE.BufferAttribute(mainColors, 3));
      const faceMat = new THREE.PointsMaterial({
        size: 0.055,
        map: sprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      faceLayer = new THREE.Points(faceGeom, faceMat);
      scene.add(faceLayer);

      const intColors = new Float32Array(intN * 3);
      for (let k = 0; k < intN; k++) {
        intColors[k * 3]     = 0.16;
        intColors[k * 3 + 1] = 0.45;
        intColors[k * 3 + 2] = 0.50;
      }
      const intGeom = new THREE.BufferGeometry();
      intGeom.setAttribute('position', new THREE.BufferAttribute(intP.subarray(0, intN * 3), 3));
      intGeom.setAttribute('color',    new THREE.BufferAttribute(intColors, 3));
      const intMat = new THREE.PointsMaterial({
        size: 0.045,
        map: sprite,
        vertexColors: true,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      interiorLayer = new THREE.Points(intGeom, intMat);
      scene.add(interiorLayer);

      const ringSpecs = [
        { rx: 1.10, ry: 0.95, tilt: [ 0.32,  0.08, -0.10], speed:  0.28, color: 0x00E5FF, opacity: 0.75, size: 0.030 },
        { rx: 1.28, ry: 1.12, tilt: [-0.20, -0.05,  0.42], speed: -0.20, color: 0x9eeaff, opacity: 0.62, size: 0.024 },
      ];
      ringSpecs.forEach((spec) => {
        const ringN = 260;
        const pos = new Float32Array(ringN * 3);
        for (let k = 0; k < ringN; k++) {
          const a = (k / ringN) * Math.PI * 2 + (Math.random() - 0.5) * 0.025;
          pos[k * 3]     = Math.cos(a) * spec.rx + (Math.random() - 0.5) * 0.01;
          pos[k * 3 + 1] = Math.sin(a) * spec.ry + (Math.random() - 0.5) * 0.01;
          pos[k * 3 + 2] = (Math.random() - 0.5) * 0.01;
        }
        const ringGeom = new THREE.BufferGeometry();
        ringGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const ringMat = new THREE.PointsMaterial({
          size: spec.size, color: spec.color, map: sprite,
          transparent: true, opacity: spec.opacity,
          depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Points(ringGeom, ringMat);
        mesh.rotation.x = spec.tilt[0];
        mesh.rotation.y = spec.tilt[1];
        mesh.rotation.z = spec.tilt[2];
        scene.add(mesh);
        rings.push({ mesh, material: ringMat, rotSpeed: spec.speed });
      });

      faceLayer.userData = {
        anchors: mainA.subarray(0, mainN * 3),
        phases:  mainPh.subarray(0, mainN),
        speeds:  mainSp.subarray(0, mainN),
        amps:    mainAm.subarray(0, mainN),
        roles:   mainR.subarray(0, mainN),
        colors:  mainColors,
        count:   mainN,
      };
      interiorLayer.userData = {
        anchors: intA.subarray(0, intN * 3),
        phases:  intPh.subarray(0, intN),
        speeds:  intSp.subarray(0, intN),
        amps:    intAm.subarray(0, intN),
        colors:  intColors,
        count:   intN,
      };
    } catch (err) {
      console.warn('[face] v5 init failed, keeping canvas orb:', err.message);
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
    const baseColor   = new THREE.Color(STATES.idle.primary);
    const targetColor = new THREE.Color(STATES.idle.primary);

    let lastTime = performance.now();
    let lastState = '';

    function frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const voice = window.__voiceLevel || 0;
      const state = window.__orbState || 'idle';

      if (state !== lastState) {
        const palette = STATES[state] || STATES.idle;
        targetColor.set(palette.primary);
        lastState = state;
      }
      baseColor.lerp(targetColor, 0.08);

      const speedMul =
        state === 'speaking'  ? (1 + voice * 1.5) :
        state === 'listening' ? 1.6 :
        state === 'streaming' ? 1.3 :
        state === 'creating'  ? 1.8 :
        state === 'thinking'  ? 1.1 :
        state === 'fault'     ? 0.5 : 1.0;

      const ud = faceLayer.userData;
      const aArr = ud.anchors, phArr = ud.phases, spArr = ud.speeds,
            amArr = ud.amps, rArr = ud.roles, cArr = ud.colors, M = ud.count;
      const posArr = faceLayer.geometry.attributes.position.array;
      const colArr = faceLayer.geometry.attributes.color.array;
      const baseR = baseColor.r, baseG = baseColor.g, baseB = baseColor.b;

      for (let k = 0; k < M; k++) {
        phArr[k] += dt * spArr[k] * speedMul;
        if (phArr[k] >= 1) phArr[k] -= 1;
        const t = phArr[k];

        const ax = aArr[k * 3];
        const ay = aArr[k * 3 + 1];
        const az = aArr[k * 3 + 2];

        const drift = t * amArr[k];

        let dy = 0, dz = 0;
        switch (rArr[k]) {
          case ROLE_UPLIP:   dy = voice * 0.06;  break;
          case ROLE_LOWLIP:  dy = -voice * 0.10; break;
          case ROLE_JAW:     dy = -voice * 0.05; break;
          case ROLE_EYEBROW: dy = voice * 0.018; break;
          case ROLE_NOSE:    dz = voice * 0.012; break;
        }

        const jx = Math.sin((now * 0.001) * 0.6 + k * 0.13) * 0.0035;

        posArr[k * 3]     = ax + jx;
        posArr[k * 3 + 1] = ay - drift + dy;
        posArr[k * 3 + 2] = az + dz;

        const lane = Math.sin(t * Math.PI);
        const shimmer = 0.85 + Math.sin(now * 0.004 + k * 0.7) * 0.15;
        const brightness = lane * shimmer;

        colArr[k * 3]     = baseR * brightness;
        colArr[k * 3 + 1] = baseG * brightness;
        colArr[k * 3 + 2] = baseB * brightness;
      }
      faceLayer.geometry.attributes.position.needsUpdate = true;
      faceLayer.geometry.attributes.color.needsUpdate    = true;
      faceLayer.material.size = 0.055 + (state === 'speaking' ? voice * 0.04 : 0);

      const ud2 = interiorLayer.userData;
      const aI = ud2.anchors, phI = ud2.phases, spI = ud2.speeds, amI = ud2.amps, cI = ud2.colors, NI = ud2.count;
      const posI = interiorLayer.geometry.attributes.position.array;
      const colI = interiorLayer.geometry.attributes.color.array;
      for (let k = 0; k < NI; k++) {
        phI[k] += dt * spI[k] * speedMul * (1 + voice * 0.8);
        if (phI[k] >= 1) phI[k] -= 1;
        const t = phI[k];
        const drift = t * amI[k];
        posI[k * 3]     = aI[k * 3]     + Math.sin(now * 0.001 + k) * 0.003;
        posI[k * 3 + 1] = aI[k * 3 + 1] - drift;
        posI[k * 3 + 2] = aI[k * 3 + 2];
        const lane = Math.sin(t * Math.PI);
        colI[k * 3]     = baseR * 0.30 * lane;
        colI[k * 3 + 1] = baseG * 0.45 * lane;
        colI[k * 3 + 2] = baseB * 0.55 * lane;
      }
      interiorLayer.geometry.attributes.position.needsUpdate = true;
      interiorLayer.geometry.attributes.color.needsUpdate    = true;
      const interiorTarget = state === 'speaking' ? voice * 0.75 : 0;
      interiorLayer.material.opacity += (interiorTarget - interiorLayer.material.opacity) * 0.18;

      for (const ring of rings) {
        ring.mesh.rotation.z += ring.rotSpeed * 0.01 * speedMul;
        ring.mesh.rotation.y += ring.rotSpeed * 0.0035 * speedMul;
        ring.material.color.lerp(targetColor, 0.04);
      }

      const swayY = Math.sin(now * 0.0003 * speedMul) * 0.20;
      const swayX = Math.sin(now * 0.00022 * speedMul) * 0.07;
      faceLayer.rotation.y     = swayY; faceLayer.rotation.x     = swayX;
      interiorLayer.rotation.y = swayY; interiorLayer.rotation.x = swayX;

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    resize();
    console.log('[face] v5 Matrix talking-head — face=' + faceLayer.userData.count +
                ', interior=' + interiorLayer.userData.count +
                ', rings=' + (rings.length * 260));
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
