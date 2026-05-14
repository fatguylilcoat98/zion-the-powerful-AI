/*
  Zion — Particle Face.

  Three.js Points geometry, ~3200 particles, arranged into a stylized
  humanoid face: head outline, eyes, nose, mouth, scattered cheek/
  forehead interior. The mouth region is tagged audio-reactive and
  displaces vertically with window.__voiceLevel — Zion's speech
  literally moves her mouth.

  Reads state from window.__orbState (string) and color from
  window.__STATE_COLORS (object). Same state machine the canvas-2D
  orb uses, so all the existing setOrbState() calls just work.

  Fail-safe: if Three.js never loads (CDN blocked / network error) or
  WebGL init throws, this module logs the failure, returns, and the
  canvas-2D orb in zion-interface.html stays visible. We never crash
  the demo for the sake of a stretch goal.
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.THREE) {
      console.warn('[face] Three.js not loaded — keeping canvas orb');
      return;
    }

    const PARTICLE_COUNT = 3200;
    const orbCanvas = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) {
      console.warn('[face] neural-center container missing');
      return;
    }

    // Probe WebGL before committing. If the probe canvas can't get a
    // context, bail and leave the 2D orb visible.
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) {
      console.warn('[face] WebGL not available — keeping canvas orb');
      return;
    }

    // Build the face. All coordinates normalized to roughly [-1, 1].
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const anchors = new Float32Array(PARTICLE_COUNT * 3);
    const phases = new Float32Array(PARTICLE_COUNT);
    const isMouth = new Uint8Array(PARTICLE_COUNT);

    let i = 0;
    function setAnchor(x, y, z, mouth) {
      if (i >= PARTICLE_COUNT) return;
      anchors[i * 3]     = x;
      anchors[i * 3 + 1] = y;
      anchors[i * 3 + 2] = z;
      phases[i] = Math.random() * Math.PI * 2;
      isMouth[i] = mouth ? 1 : 0;
      // Start scattered so the face assembles in over the first second.
      positions[i * 3]     = (Math.random() - 0.5) * 2.4;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      i++;
    }

    // 1) Head outline — ellipse, dense ring
    const headOutline = Math.floor(PARTICLE_COUNT * 0.22);
    for (let k = 0; k < headOutline; k++) {
      const a = (k / headOutline) * Math.PI * 2;
      const rx = 0.68 + (Math.random() - 0.5) * 0.03;
      const ry = 0.92 + (Math.random() - 0.5) * 0.03;
      setAnchor(Math.cos(a) * rx, Math.sin(a) * ry - 0.05, 0, false);
    }

    // 2) Jaw — slight V at the bottom for face shape
    const jawCount = Math.floor(PARTICLE_COUNT * 0.05);
    for (let k = 0; k < jawCount; k++) {
      const t = (k / jawCount) * 2 - 1; // -1..1
      const x = t * 0.55;
      const y = -0.85 + Math.abs(t) * 0.15;
      setAnchor(x + (Math.random() - 0.5) * 0.04, y + (Math.random() - 0.5) * 0.03, 0, false);
    }

    // 3) Left eye — small cluster
    const eyeCount = Math.floor(PARTICLE_COUNT * 0.06);
    for (let k = 0; k < eyeCount; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.09;
      setAnchor(-0.27 + Math.cos(a) * r * 1.3, 0.22 + Math.sin(a) * r * 0.7, 0.02, false);
    }
    // Right eye
    for (let k = 0; k < eyeCount; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.09;
      setAnchor(0.27 + Math.cos(a) * r * 1.3, 0.22 + Math.sin(a) * r * 0.7, 0.02, false);
    }

    // 4) Nose — vertical line cluster
    const noseCount = Math.floor(PARTICLE_COUNT * 0.05);
    for (let k = 0; k < noseCount; k++) {
      const t = k / noseCount;
      setAnchor(
        (Math.random() - 0.5) * 0.10,
        0.05 - t * 0.30,
        0.03,
        false
      );
    }

    // 5) Mouth — horizontal cluster, AUDIO-REACTIVE
    const mouthCount = Math.floor(PARTICLE_COUNT * 0.10);
    for (let k = 0; k < mouthCount; k++) {
      const t = (k / mouthCount) * 2 - 1;
      const x = t * 0.32;
      const y = -0.42 + (Math.random() - 0.5) * 0.05;
      setAnchor(x, y, 0.02, true);
    }

    // 6) Forehead + cheeks — scattered interior fill
    while (i < PARTICLE_COUNT) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.55;
      const x = Math.cos(a) * r * 0.78;
      const y = Math.sin(a) * r * 0.95 - 0.05;
      // Skip if too close to eye / mouth zones — keep them readable
      const inLeftEye  = Math.hypot(x + 0.27, y - 0.22) < 0.13;
      const inRightEye = Math.hypot(x - 0.27, y - 0.22) < 0.13;
      const inMouth    = Math.hypot(x, y + 0.42) < 0.10 && Math.abs(y + 0.42) < 0.08;
      if (inLeftEye || inRightEye || inMouth) continue;
      setAnchor(x, y, (Math.random() - 0.5) * 0.08, false);
    }

    // Three.js setup
    let scene, camera, renderer, particles, material;
    try {
      scene = new THREE.Scene();
      const aspect = neuralCenter.clientWidth / neuralCenter.clientHeight || 1;
      camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
      camera.position.set(0, 0, 2.4);
      camera.lookAt(0, 0, 0);

      // Create a dedicated canvas overlaying #orbCanvas. We don't reuse
      // #orbCanvas because the 2D context already lives there — once a
      // canvas commits to 2D it can't switch to WebGL on the same element.
      const faceCanvas = document.createElement('canvas');
      faceCanvas.id = 'faceCanvas';
      faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none;';
      neuralCenter.appendChild(faceCanvas);

      renderer = new THREE.WebGLRenderer({ canvas: faceCanvas, alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(neuralCenter.clientWidth, neuralCenter.clientHeight, false);
      renderer.setClearColor(0x000000, 0);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // Soft glow sprite for each particle. A radial-gradient canvas
      // texture reads as a halo at small sizes — much warmer than the
      // default square Points dots.
      const spriteCanvas = document.createElement('canvas');
      spriteCanvas.width = spriteCanvas.height = 64;
      const sctx = spriteCanvas.getContext('2d');
      const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0,    'rgba(255,255,255,1)');
      grad.addColorStop(0.4,  'rgba(255,255,255,0.55)');
      grad.addColorStop(1,    'rgba(255,255,255,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 64, 64);
      const sprite = new THREE.CanvasTexture(spriteCanvas);

      material = new THREE.PointsMaterial({
        size: 0.045,
        color: 0x4FB8C9, // idle teal; updated each frame from STATE_COLORS
        map: sprite,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      particles = new THREE.Points(geometry, material);
      scene.add(particles);
    } catch (err) {
      console.warn('[face] init failed, keeping canvas orb:', err.message);
      return;
    }

    // Once Three.js is up and running, hide the canvas-2D orb so the
    // two animations don't fight visually.
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
    const lerpedColor = new THREE.Color(STATES.idle.primary);
    const targetColor = new THREE.Color(STATES.idle.primary);

    const t0 = performance.now();
    let lastState = '';

    function frame() {
      const time = (performance.now() - t0) / 1000;
      const voice = window.__voiceLevel || 0;
      const state = window.__orbState || 'idle';

      // Update target color when state changes; lerp toward it each frame.
      if (state !== lastState) {
        const palette = STATES[state] || STATES.idle;
        targetColor.set(palette.primary);
        lastState = state;
      }
      lerpedColor.lerp(targetColor, 0.08);
      material.color.copy(lerpedColor);

      const posArr = particles.geometry.attributes.position.array;
      const assemble = Math.min(1, time / 1.4); // assemble face over 1.4s

      // Speed multiplier per state (matches canvas orb's feel)
      const speedMul =
        state === 'speaking'  ? (1 + voice * 1.5) :
        state === 'listening' ? 1.6 :
        state === 'streaming' ? 1.3 :
        state === 'creating'  ? 1.8 :
        state === 'thinking'  ? 1.1 :
        state === 'fault'     ? 0.5 : 1.0;

      // Per-particle micro-motion + audio-reactive mouth.
      for (let k = 0; k < PARTICLE_COUNT; k++) {
        const ax = anchors[k * 3];
        const ay = anchors[k * 3 + 1];
        const az = anchors[k * 3 + 2];
        const ph = phases[k];

        // Idle jitter — small drift, individual phase
        const jx = Math.sin(time * 0.6 * speedMul + ph) * 0.006;
        const jy = Math.cos(time * 0.8 * speedMul + ph * 1.3) * 0.006;
        const jz = Math.sin(time * 0.5 * speedMul + ph * 0.7) * 0.012;

        // Mouth audio displacement — visible only when speaking
        const mouthY = isMouth[k]
          ? Math.sin(time * 8 + ph) * voice * 0.10
          : 0;

        // Breathing scale for non-mouth particles (subtle)
        const breath = 1 + Math.sin(time * 1.2 * speedMul) * 0.015;

        // During the first 1.4s, lerp from initial scatter to anchor.
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
      particles.geometry.attributes.position.needsUpdate = true;

      // Slow head sway — a few degrees in Y, less in X. Faster during
      // active states.
      particles.rotation.y = Math.sin(time * 0.25 * speedMul) * 0.16;
      particles.rotation.x = Math.sin(time * 0.18 * speedMul) * 0.05;

      // Particle size pulses lightly with voice level when speaking.
      material.size = state === 'speaking' ? (0.045 + voice * 0.025) : 0.045;

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);

    console.log('[face] particle face initialized — ' + PARTICLE_COUNT + ' particles');
  }

  // Wait for DOM + Three.js. Three.js is loaded async/defer-ish via CDN
  // so we may need to wait. Poll briefly for window.THREE.
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
