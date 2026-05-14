/*
  Zion — Particle Face v7 (cinematic talking head).

  This pass exists because v5/v6 read as an egg, not a man. The fix is
  not "more particles" — it's proper 3D head topology + choreographed
  formation + real audio-reactive lip sync. The spec from Chris:

    "Matrix Sentinel materialization. Doctor Strange. Holographic male AI.
     Particles swarm and dance before assembling — not a snap-cut.
     Strong jaw, masculine, no hair. Real lip sync, jaw lags 50-100ms
     behind the mouth. When you exit Converse, particles dandelion out."

  ─── ARCHITECTURE ─────────────────────────────────────────────────────

  Four animation states driven by window.__converseActive + an internal
  state machine:

    hidden      — opacity 0, particles parked at scatter origins.
                  Orb is the visible UI.

    forming     — entered when __converseActive flips true. ~3.5s.
                  Particles swirl from scatter origins via curl-noise
                  turbulence + bezier paths, snap to head vertices,
                  ripple wave confirms formation.

    live        — head idle, breathing micro-motion, audio-reactive
                  lip sync. Lasts as long as Converse is active.

    dissipating — entered when __converseActive flips false. ~2.5s.
                  Particles accelerate outward along randomized escape
                  vectors (dandelion in wind), fade to zero, then orb
                  fades back in.

  ─── HEAD TOPOLOGY ────────────────────────────────────────────────────

  Each particle has a 3D target sampled from one of 13 anatomical
  regions, not a 2D silhouette. The regions are placed in true 3D so
  head sway / rotation reveals depth:

    cranium     — back + top of head (sphere, slightly elongated)
    forehead    — front of upper face, curved outward
    brow        — pronounced brow ridge above eyes
    temples     — sides of skull
    cheek       — wide cheekbones, falls back to jaw
    nose        — bridge + tip + nostrils, protrudes forward
    upper_lip   — cupid's bow arc
    lower_lip   — fuller lower lip
    mouth_int   — particles INSIDE the mouth, revealed during speech
    jaw         — strong angular jawline (masculine read)
    chin        — square chin tip
    neck        — short neck/shoulder hint at the base
    inner_glow  — low-opacity central cloud for subsurface luminance

  Eye sockets are NEGATIVE space — the cheek + brow regions explicitly
  reject points inside two carved spheres. Empty eye sockets give the
  face a "looking out" presence rather than a flat mask.

  ─── LIP SYNC ─────────────────────────────────────────────────────────

  window.__voiceLevel is updated each frame by the existing FFT pipeline
  (see zion-interface.html — AnalyserNode → frequency average).
  This file smooths it (attack 0.30, release 0.18) into mouthLevel, and
  delays a ring buffer copy by 5 frames (~83ms at 60fps) into jawLevel.

    upper_lip particles    dy = +mouthLevel × 0.026 (lip rises)
    lower_lip particles    dy = -mouthLevel × 0.062 (lip drops)
    mouth_int opacity      = mouthLevel × 0.85 (the mouth GAP appears)
    jaw + chin particles   dy = -jawLevel × 0.038, dz = -jawLevel × 0.012
    cheek micro-ripple     dy = sin(time × 8 + k) × voice × 0.011

  The jaw lag is the difference between "mouth opens" and "talking
  head". Eyes flick to it.

  ─── FAIL-SAFES ───────────────────────────────────────────────────────

  - Three.js missing            → log, keep canvas-2D orb visible
  - WebGL unavailable           → log, keep canvas-2D orb visible
  - any init throw              → remove faceCanvas, keep orb
  - Mobile UA                   → particle count drops to 2400 (vs 4000)
*/

(function () {
  'use strict';

  // ─── Role enum ──────────────────────────────────────────────────────
  const R_CRANIUM    = 0;
  const R_FOREHEAD   = 1;
  const R_BROW       = 2;
  const R_TEMPLE     = 3;
  const R_CHEEK      = 4;
  const R_NOSE       = 5;
  const R_UPPER_LIP  = 6;
  const R_LOWER_LIP  = 7;
  const R_MOUTH_INT  = 8;
  const R_JAW        = 9;
  const R_CHIN       = 10;
  const R_NECK       = 11;
  const R_INNER_GLOW = 12;

  // ─── Palette (Splendor's teal language, applied per-region) ────────
  // Returned as Float32 rgb triples in 0..1.
  function paletteForRole(role, depthZ) {
    // depthZ ~ -0.4 (back) to +0.6 (front-most nose tip)
    // Front particles get brighter; back gets the muted teal.
    const front = Math.max(0, Math.min(1, (depthZ + 0.4) / 1.0));
    const bright = 0.55 + front * 0.45; // 0.55 back .. 1.0 front

    switch (role) {
      // primary face front — bright teal
      case R_FOREHEAD:
      case R_BROW:
      case R_CHEEK:
      case R_NOSE:
        return { r: 0.00 * bright, g: 0.90 * bright, b: 1.00 * bright };
      // upper / lower lip — slightly warmer, picks up the eye
      case R_UPPER_LIP:
      case R_LOWER_LIP:
        return { r: 0.35 * bright, g: 0.95 * bright, b: 1.00 * bright };
      // mouth interior — warm pink-coral inside, picks up the speech moment
      case R_MOUTH_INT:
        return { r: 1.00, g: 0.55, b: 0.78 };
      // jaw / chin — mid teal, slightly cooler
      case R_JAW:
      case R_CHIN:
        return { r: 0.00 * bright, g: 0.75 * bright, b: 0.85 * bright };
      // cranium / temples / neck — softer, more atmospheric
      case R_CRANIUM:
      case R_TEMPLE:
      case R_NECK:
        return { r: 0.31 * bright, g: 0.72 * bright, b: 0.79 * bright };
      // inner glow — near-white cyan, very soft
      case R_INNER_GLOW:
        return { r: 0.63, g: 0.97, b: 1.00 };
      default:
        return { r: 0.50, g: 0.85, b: 0.95 };
    }
  }

  // ─── Eye socket carve test ──────────────────────────────────────────
  function inEyeSocket(x, y, z) {
    // Two ellipsoidal recesses on the face front.
    // Eye centers at (±0.18, +0.06, +0.38). Carve radius ~0.10.
    const dL = Math.hypot((x + 0.18) / 0.11, (y - 0.06) / 0.085, (z - 0.38) / 0.12);
    const dR = Math.hypot((x - 0.18) / 0.11, (y - 0.06) / 0.085, (z - 0.38) / 0.12);
    return dL < 1.0 || dR < 1.0;
  }

  // ─── Mouth carve test (used to keep face-front fill out of the mouth) ─
  function inMouthZone(x, y, z) {
    // Mouth gap ellipsoid around (0, -0.20, 0.42).
    return Math.hypot(x / 0.14, (y + 0.20) / 0.045, (z - 0.42) / 0.10) < 1.0;
  }

  // ─── Cheap 3D curl-ish noise for swarm turbulence ──────────────────
  // Real curl noise needs gradients of perlin; this is a sum-of-sines
  // approximation that's continuous + cheap + looks turbulent enough.
  function curlNoise(x, y, z, t, seed) {
    const s = seed * 0.013;
    const tt = t * 0.6;
    const cx = Math.sin(y * 1.3 + tt + s)       - Math.sin(z * 1.7 + tt * 0.9 + s * 1.3);
    const cy = Math.sin(z * 1.1 + tt * 1.2 + s) - Math.sin(x * 1.5 + tt * 0.7 + s * 0.7);
    const cz = Math.sin(x * 1.4 + tt * 0.8 + s) - Math.sin(y * 1.2 + tt * 1.1 + s * 1.1);
    return { x: cx, y: cy, z: cz };
  }

  // ─── Easing ─────────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ─── Build the head as 13 anatomical regions in 3D space ───────────
  function buildHeadTargets(N) {
    // Particle budget split. Anatomically loaded toward the face front.
    const counts = {
      cranium:    Math.round(N * 0.16),
      forehead:   Math.round(N * 0.07),
      brow:       Math.round(N * 0.035),
      temple:     Math.round(N * 0.06),
      cheek:      Math.round(N * 0.20),
      nose:       Math.round(N * 0.075),
      upper_lip:  Math.round(N * 0.045),
      lower_lip:  Math.round(N * 0.045),
      mouth_int:  Math.round(N * 0.035),
      jaw:        Math.round(N * 0.13),
      chin:       Math.round(N * 0.035),
      neck:       Math.round(N * 0.05),
      inner_glow: Math.round(N * 0.025),
    };

    const targets = [];

    const push = (x, y, z, role) => {
      targets.push({
        x, y, z, role,
        color: paletteForRole(role, z),
        baseSize: sizeForRole(role),
      });
    };

    // 1) CRANIUM — back + top hemisphere of a slightly elongated sphere.
    //    Skull dimensions: rx 0.50, ry 0.62, rz 0.50.
    {
      let placed = 0, attempts = 0;
      while (placed < counts.cranium && attempts < counts.cranium * 6) {
        attempts++;
        // Uniform sphere sampling
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const phi   = Math.acos(2 * v - 1);
        let x = Math.sin(phi) * Math.cos(theta) * 0.50;
        let y = Math.cos(phi) * 0.62 + 0.18;
        let z = Math.sin(phi) * Math.sin(theta) * 0.48;
        // Keep top + back hemisphere; the face-front is handled by other regions.
        if (z > 0.20 && y < 0.55) continue;
        if (y < -0.10) continue;
        // tiny jitter
        x += (Math.random() - 0.5) * 0.012;
        y += (Math.random() - 0.5) * 0.012;
        z += (Math.random() - 0.5) * 0.012;
        push(x, y, z, R_CRANIUM);
        placed++;
      }
    }

    // 2) FOREHEAD — front upper-face curved panel.
    {
      let placed = 0, attempts = 0;
      while (placed < counts.forehead && attempts < counts.forehead * 6) {
        attempts++;
        const angle = (Math.random() - 0.5) * Math.PI * 0.95;        // wide front arc
        const yT    = Math.random();
        const x     = Math.sin(angle) * 0.42;
        const y     = 0.20 + yT * 0.32;                              // 0.20..0.52
        const z     = Math.cos(angle) * 0.46 - yT * 0.05;            // curves back slightly toward crown
        if (inEyeSocket(x, y, z)) continue;
        push(
          x + (Math.random() - 0.5) * 0.015,
          y + (Math.random() - 0.5) * 0.015,
          z + (Math.random() - 0.5) * 0.012,
          R_FOREHEAD
        );
        placed++;
      }
    }

    // 3) BROW RIDGE — pronounced ridge above eyes (masculine read).
    for (let k = 0; k < counts.brow; k++) {
      const side = k < counts.brow / 2 ? -1 : 1;
      const t    = ((k * 2) % counts.brow) / counts.brow;             // 0..1 across one brow
      const xOff = (t - 0.5) * 0.28;
      const x    = side * 0.18 + xOff;
      const y    = 0.18 + (Math.random() - 0.5) * 0.020;
      const z    = 0.46 - Math.abs(xOff) * 0.10;                      // bulges forward at the inner brow
      push(x, y, z, R_BROW);
    }

    // 4) TEMPLES — sides of the skull, between cranium and cheek.
    for (let k = 0; k < counts.temple; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const yT   = Math.random();
      const x    = side * (0.44 + (Math.random() - 0.5) * 0.020);
      const y    = 0.08 + yT * 0.20;
      const z    = 0.08 + (Math.random() - 0.5) * 0.08;
      push(x, y, z, R_TEMPLE);
    }

    // 5) CHEEKS — wide masculine cheekbones, fill front of face.
    //    Big region, carved around eyes + mouth + nose ridge.
    {
      let placed = 0, attempts = 0;
      while (placed < counts.cheek && attempts < counts.cheek * 8) {
        attempts++;
        const x = (Math.random() - 0.5) * 0.85;
        const y = -0.14 + Math.random() * 0.30;                        // -0.14 .. +0.16
        // Curve forward like a face panel — z falls off as x increases (side of face).
        const z = 0.45 - x * x * 0.55;
        if (inEyeSocket(x, y, z)) continue;
        if (inMouthZone(x, y, z)) continue;
        // Avoid the nose ridge column
        if (Math.abs(x) < 0.06 && y > -0.05 && y < 0.18) continue;
        // Avoid carving below the jaw (handled by jaw region)
        if (y < -0.08 && Math.abs(x) > 0.30) continue;
        push(
          x + (Math.random() - 0.5) * 0.015,
          y + (Math.random() - 0.5) * 0.015,
          z + (Math.random() - 0.5) * 0.020,
          R_CHEEK
        );
        placed++;
      }
    }

    // 6) NOSE — bridge column + flared tip + nostril mass, protrudes forward.
    {
      let placed = 0, attempts = 0;
      while (placed < counts.nose && attempts < counts.nose * 6) {
        attempts++;
        const t  = Math.random();                                      // 0=bridge top, 1=tip
        const xJ = (Math.random() - 0.5) * (0.045 + t * 0.05);         // narrower at top, flares at base
        // Y from forehead-base (~0.16) down to upper-lip (-0.10)
        const y  = 0.16 - t * 0.26;
        // Z: protrudes forward, tip is the most forward point on the face
        const z  = 0.48 + t * 0.10;
        push(
          xJ,
          y + (Math.random() - 0.5) * 0.012,
          z + (Math.random() - 0.5) * 0.012,
          R_NOSE
        );
        placed++;
      }
      // Add a small cluster at the nostril base for the "wing" mass
      for (let k = 0; k < Math.floor(counts.nose * 0.25); k++) {
        const side = k % 2 === 0 ? -1 : 1;
        const x = side * (0.04 + Math.random() * 0.05);
        const y = -0.09 + (Math.random() - 0.5) * 0.020;
        const z = 0.50 + (Math.random() - 0.5) * 0.020;
        push(x, y, z, R_NOSE);
      }
    }

    // 7) UPPER LIP — cupid's bow.
    for (let k = 0; k < counts.upper_lip; k++) {
      const t   = (k / counts.upper_lip) * 2 - 1;                      // -1..+1
      const x   = t * 0.13;
      const bow = Math.cos(t * Math.PI) * 0.014;                       // cupid's bow rise at center
      const y   = -0.17 + bow + (Math.random() - 0.5) * 0.010;
      const z   = 0.43 - t * t * 0.04;                                 // recedes at corners
      push(x, y, z, R_UPPER_LIP);
    }

    // 8) LOWER LIP — fuller, single arc.
    for (let k = 0; k < counts.lower_lip; k++) {
      const t = (k / counts.lower_lip) * 2 - 1;
      const x = t * 0.13;
      const y = -0.24 + Math.sin(Math.abs(t) * Math.PI * 0.5) * 0.015 + (Math.random() - 0.5) * 0.010;
      const z = 0.44 - t * t * 0.04;
      push(x, y, z, R_LOWER_LIP);
    }

    // 9) MOUTH INTERIOR — hidden behind the lips, fades in during speech.
    for (let k = 0; k < counts.mouth_int; k++) {
      const x = (Math.random() - 0.5) * 0.20;
      const y = -0.205 + (Math.random() - 0.5) * 0.025;
      const z = 0.40 + (Math.random() - 0.5) * 0.025;
      push(x, y, z, R_MOUTH_INT);
    }

    // 10) JAW — strong angular line from temple to chin. Masculine read.
    //     Two passes (left/right) so the jaw angle is symmetric and crisp.
    {
      const perSide = Math.floor(counts.jaw / 2);
      for (let side = -1; side <= 1; side += 2) {
        for (let k = 0; k < perSide; k++) {
          const t = k / perSide;                                        // 0=ear, 1=chin
          // Hinge near (side*0.42, +0.02), runs down-and-in to (side*0.10, -0.50)
          const x = side * (0.42 - t * 0.32) + (Math.random() - 0.5) * 0.020;
          const y = 0.02 - t * 0.52 + (Math.random() - 0.5) * 0.020;
          // Jaw bone sits slightly behind the cheek plane
          const z = 0.30 - t * 0.05 + (Math.random() - 0.5) * 0.020;
          push(x, y, z, R_JAW);
        }
      }
    }

    // 11) CHIN TIP — square masculine chin.
    for (let k = 0; k < counts.chin; k++) {
      const x = (Math.random() - 0.5) * 0.16;
      const y = -0.52 + (Math.random() - 0.5) * 0.025;
      const z = 0.30 + (Math.random() - 0.5) * 0.020;
      push(x, y, z, R_CHIN);
    }

    // 12) NECK / collar hint — short band below the chin, fades out.
    for (let k = 0; k < counts.neck; k++) {
      const t = Math.random();
      const x = (Math.random() - 0.5) * 0.55;
      const y = -0.60 - t * 0.20;
      const z = 0.05 + (Math.random() - 0.5) * 0.20;
      push(x, y, z, R_NECK);
    }

    // 13) INNER GLOW — small low-opacity cloud inside the head for
    //     subsurface luminance. Visible through the surface particles.
    for (let k = 0; k < counts.inner_glow; k++) {
      const u = Math.random(), v = Math.random();
      const theta = u * Math.PI * 2;
      const phi   = Math.acos(2 * v - 1);
      const r     = 0.18 + Math.random() * 0.08;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi) + 0.05;
      const z = r * Math.sin(phi) * Math.sin(theta) + 0.15;
      push(x, y, z, R_INNER_GLOW);
    }

    return targets;
  }

  function sizeForRole(role) {
    // Pixel-size baseline; the shader scales by depth.
    switch (role) {
      case R_INNER_GLOW: return 9.0 + Math.random() * 3.0;   // big soft glow blobs
      case R_NOSE:
      case R_BROW:
      case R_UPPER_LIP:
      case R_LOWER_LIP:
        return 5.5 + Math.random() * 1.5;                     // feature accents
      case R_MOUTH_INT:
        return 4.5 + Math.random() * 1.5;
      case R_CHEEK:
      case R_FOREHEAD:
      case R_CHIN:
        return 4.8 + Math.random() * 1.4;
      case R_JAW:
      case R_TEMPLE:
      case R_CRANIUM:
        return 4.0 + Math.random() * 1.3;
      case R_NECK:
        return 3.5 + Math.random() * 1.2;
      default:
        return 4.5;
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────
  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.THREE) { console.warn('[face v7] Three.js not loaded — keeping canvas orb'); return; }

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face v7] neural-center missing'); return; }

    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) { console.warn('[face v7] WebGL not available — keeping canvas orb'); return; }

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const N        = isMobile ? 2400 : 4000;

    const targets = buildHeadTargets(N);
    const COUNT   = targets.length;

    // Per-particle buffers
    const positions   = new Float32Array(COUNT * 3);
    const colors      = new Float32Array(COUNT * 3);
    const sizes       = new Float32Array(COUNT);
    const baseColors  = new Float32Array(COUNT * 3);   // never mutated — frame copies from here
    const baseSizes   = new Float32Array(COUNT);
    const origins     = new Float32Array(COUNT * 3);   // scatter starting points
    const escapeDirs  = new Float32Array(COUNT * 3);   // dissipation vectors
    const phases      = new Float32Array(COUNT);       // 0..1 desync
    const seeds       = new Float32Array(COUNT);       // per-particle noise offset
    const roles       = new Uint8Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      const t = targets[i];
      roles[i]      = t.role;
      baseColors[i * 3]     = t.color.r;
      baseColors[i * 3 + 1] = t.color.g;
      baseColors[i * 3 + 2] = t.color.b;
      baseSizes[i]  = t.baseSize;
      sizes[i]      = t.baseSize;
      colors[i * 3]     = 0;
      colors[i * 3 + 1] = 0;
      colors[i * 3 + 2] = 0;

      // Scatter origin: random direction on radius 2.2 sphere, biased outward.
      {
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const phi   = Math.acos(2 * v - 1);
        const r     = 2.0 + Math.random() * 0.6;
        const ox = r * Math.sin(phi) * Math.cos(theta);
        const oy = r * Math.cos(phi) + 0.1;
        const oz = r * Math.sin(phi) * Math.sin(theta);
        origins[i * 3]     = ox;
        origins[i * 3 + 1] = oy;
        origins[i * 3 + 2] = oz;
        // Start hidden at origin
        positions[i * 3]     = ox;
        positions[i * 3 + 1] = oy;
        positions[i * 3 + 2] = oz;
      }

      // Escape direction: target − head_center, normalized, jittered, slight upward bias.
      {
        let ex = t.x - 0;
        let ey = t.y - 0;
        let ez = t.z - 0;
        const m = Math.hypot(ex, ey, ez) || 1;
        ex /= m; ey /= m; ez /= m;
        // Jitter so the burst doesn't look uniform
        ex += (Math.random() - 0.5) * 0.7;
        ey += (Math.random() - 0.4) * 0.7;                              // slight upward bias
        ez += (Math.random() - 0.5) * 0.7;
        const m2 = Math.hypot(ex, ey, ez) || 1;
        escapeDirs[i * 3]     = ex / m2;
        escapeDirs[i * 3 + 1] = ey / m2;
        escapeDirs[i * 3 + 2] = ez / m2;
      }

      phases[i] = Math.random();
      seeds[i]  = Math.random() * 100;
    }

    // ─── Three.js scene + canvas ──────────────────────────────────────
    let scene, camera, renderer, faceCanvas;
    let faceLayer;
    const rings = [];

    try {
      scene = new THREE.Scene();
      const aspect = neuralCenter.clientWidth / neuralCenter.clientHeight || 1;
      camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
      camera.position.set(0, 0.04, 2.85);
      camera.lookAt(0, -0.05, 0);

      faceCanvas = document.createElement('canvas');
      faceCanvas.id = 'faceCanvas';
      faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; opacity:0; transition:opacity 0.5s ease;';
      neuralCenter.appendChild(faceCanvas);

      renderer = new THREE.WebGLRenderer({ canvas: faceCanvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(neuralCenter.clientWidth, neuralCenter.clientHeight, false);
      renderer.setClearColor(0x000000, 0);

      // Soft glow sprite — radial gradient, additive blending → cinematic glow.
      const sc = document.createElement('canvas');
      sc.width = sc.height = 128;
      const sctx = sc.getContext('2d');
      const g = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0,    'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.60)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 128, 128);
      const sprite = new THREE.CanvasTexture(sc);

      // Shader material — per-particle size + per-particle color.
      const faceGeom = new THREE.BufferGeometry();
      faceGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      faceGeom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
      faceGeom.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

      const faceMat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: sprite } },
        vertexShader: [
          'attribute float aSize;',
          'attribute vec3 color;',
          'varying vec3 vColor;',
          'void main() {',
          '  vColor = color;',
          '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          '  gl_PointSize = aSize * (260.0 / -mv.z);',
          '  gl_Position = projectionMatrix * mv;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D uTex;',
          'varying vec3 vColor;',
          'void main() {',
          '  vec4 t = texture2D(uTex, gl_PointCoord);',
          '  gl_FragColor = vec4(vColor, 1.0) * t;',
          '}'
        ].join('\n'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      faceLayer = new THREE.Points(faceGeom, faceMat);
      scene.add(faceLayer);

      // Orbital rings — two thin teal + one warm accent (subtle).
      const ringSpecs = [
        { rx: 1.10, ry: 0.95, tilt: [ 0.32,  0.08, -0.10], speed:  0.28, color: 0x00E5FF, opacity: 0.75, size: 0.030, n: 280 },
        { rx: 1.28, ry: 1.12, tilt: [-0.20, -0.05,  0.42], speed: -0.20, color: 0x9eeaff, opacity: 0.55, size: 0.024, n: 280 },
        { rx: 1.42, ry: 1.22, tilt: [ 0.55,  0.20,  0.15], speed:  0.12, color: 0xFFB3D1, opacity: 0.22, size: 0.020, n: 220 }, // pink-purple accent
      ];
      ringSpecs.forEach((spec) => {
        const pos = new Float32Array(spec.n * 3);
        for (let k = 0; k < spec.n; k++) {
          const a = (k / spec.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.025;
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
        rings.push({ mesh, material: ringMat, rotSpeed: spec.speed, baseOpacity: spec.opacity });
      });
    } catch (err) {
      console.warn('[face v7] init threw, keeping canvas orb:', err.message);
      if (faceCanvas && faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
      return;
    }

    // Crossfade transitions on the orb too (face/orb both stay mounted).
    if (orbCanvas && !orbCanvas.style.transition) {
      orbCanvas.style.transition = 'opacity 0.5s ease';
    }

    function resize() {
      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    // ─── State machine ────────────────────────────────────────────────
    let faceState  = 'hidden';
    let stateStart = performance.now();

    const FORM_DUR    = 3.5;   // seconds: full formation
    const DISSIPATE_DUR = 2.5; // seconds: full dissipation

    // ─── Audio smoothing + jaw lag buffer ────────────────────────────
    let mouthLevel = 0;
    const audioBuf = new Float32Array(8);
    let abIdx = 0;

    // ─── Frame loop ───────────────────────────────────────────────────
    let lastTime = performance.now();

    function frame() {
      const now = performance.now();
      const dt  = Math.min(0.05, (now - lastTime) / 1000);
      lastTime  = now;
      const elapsed = (now - stateStart) / 1000;

      // ── State transitions
      const converse = !!window.__converseActive;

      if (faceState === 'hidden' && converse) {
        faceState = 'forming';
        stateStart = now;
        faceCanvas.style.opacity = '1';
        if (orbCanvas) orbCanvas.style.opacity = '0';
      } else if (faceState === 'forming' && elapsed > FORM_DUR) {
        faceState = 'live';
        stateStart = now;
      } else if ((faceState === 'live' || faceState === 'forming') && !converse) {
        faceState = 'dissipating';
        stateStart = now;
      } else if (faceState === 'dissipating' && elapsed > DISSIPATE_DUR) {
        faceState = 'hidden';
        stateStart = now;
        faceCanvas.style.opacity = '0';
        if (orbCanvas) orbCanvas.style.opacity = '1';
      }

      // ── Voice smoothing + jaw lag
      const rawVoice = window.__voiceLevel || 0;
      // Attack 0.30, release 0.18
      const k = rawVoice > mouthLevel ? 0.30 : 0.18;
      mouthLevel += (rawVoice - mouthLevel) * k;
      audioBuf[abIdx % 8] = mouthLevel;
      abIdx++;
      // jawLevel = mouthLevel from ~5 frames ago (~83ms at 60fps)
      const jawLevel = audioBuf[(abIdx - 5 + 8) % 8];

      // ── Per-particle update
      const posArr = faceLayer.geometry.attributes.position.array;
      const colArr = faceLayer.geometry.attributes.color.array;
      const sizeArr = faceLayer.geometry.attributes.aSize.array;

      for (let i = 0; i < COUNT; i++) {
        const tx = targets[i].x, ty = targets[i].y, tz = targets[i].z;
        const ox = origins[i * 3], oy = origins[i * 3 + 1], oz = origins[i * 3 + 2];
        const role = roles[i];
        const seed = seeds[i];
        const phase = phases[i];
        const bSize = baseSizes[i];

        let px = ox, py = oy, pz = oz;
        let alpha = 0;
        let sz    = bSize;

        if (faceState === 'forming') {
          // Phase-stagger: each particle starts forming at slightly different time.
          const startDelay = phase * 0.7;                                  // up to 0.7s desync
          const formTotal  = FORM_DUR - 0.5;                               // each particle has ~3s to converge
          const t0 = Math.max(0, (elapsed - startDelay) / formTotal);
          const t  = Math.min(1, t0);
          const eT = easeInOutCubic(t);

          // Bezier-arc midpoint with perpendicular swirl
          const swirl = 0.55 * (1 - eT);                                   // dies as we converge
          const mx = (ox + tx) * 0.5 + Math.sin(elapsed * 1.8 + seed * 0.7) * swirl;
          const my = (oy + ty) * 0.5 + Math.cos(elapsed * 1.6 + seed * 0.9) * swirl * 0.7;
          const mz = (oz + tz) * 0.5 + Math.sin(elapsed * 2.1 + seed * 1.3) * swirl * 0.7;

          let qx, qy, qz;
          if (eT < 0.5) {
            const u = eT * 2;
            qx = ox + (mx - ox) * u;
            qy = oy + (my - oy) * u;
            qz = oz + (mz - oz) * u;
          } else {
            const u = (eT - 0.5) * 2;
            qx = mx + (tx - mx) * u;
            qy = my + (ty - my) * u;
            qz = mz + (tz - mz) * u;
          }

          // Curl turbulence — strong early, gone by snap.
          const turb = 0.35 * (1 - t * t);
          const c = curlNoise(qx * 1.5, qy * 1.5, qz * 1.5, elapsed, seed);
          px = qx + c.x * turb;
          py = qy + c.y * turb;
          pz = qz + c.z * turb;

          // Alpha builds from 0 → 1 across the convergence; ripple pulse at snap.
          alpha = t * t;

          // Ripple wave: a brief size pulse when the particle finishes locking in
          if (t > 0.92) {
            const ripple = 1 + Math.sin((t - 0.92) / 0.08 * Math.PI) * 0.45;
            sz = bSize * ripple;
          }
        }
        else if (faceState === 'live') {
          px = tx;
          py = ty;
          pz = tz;

          // Subtle breathing — whole head pulses ~0.5% slow
          const breath = 1 + Math.sin(now * 0.00085) * 0.006;
          px *= breath; py *= breath; pz *= breath;

          // Per-particle shimmer — barely perceptible, keeps the face "alive"
          const shimmer = Math.sin(now * 0.0042 + seed) * 0.0035;
          py += shimmer;

          // ── Lip sync per role ─────────────────────────────────────
          if (role === R_UPPER_LIP) {
            py += mouthLevel * 0.026;
          } else if (role === R_LOWER_LIP) {
            py -= mouthLevel * 0.062;
          } else if (role === R_MOUTH_INT) {
            // mouth interior fades in as the mouth opens
            alpha = 0;                                                     // start at 0, override below
          } else if (role === R_JAW || role === R_CHIN) {
            py -= jawLevel * 0.038;
            pz -= jawLevel * 0.012;
          } else if (role === R_CHEEK) {
            py += Math.sin(now * 0.008 + seed * 3) * mouthLevel * 0.011;
          } else if (role === R_BROW) {
            py += mouthLevel * 0.009;                                      // micro brow lift
          }

          if (role === R_MOUTH_INT) {
            alpha = mouthLevel * 0.95;
          } else if (role === R_INNER_GLOW) {
            alpha = 0.45 + mouthLevel * 0.25;
          } else {
            alpha = 1;
          }

          // Speaking pulses face size + ring color
          if (role !== R_INNER_GLOW) {
            sz = bSize * (1 + mouthLevel * 0.18);
          }
        }
        else if (faceState === 'dissipating') {
          const startDelay = phase * 0.5;
          const dT = Math.max(0, Math.min(1, (elapsed - startDelay) / (DISSIPATE_DUR - 0.4)));

          // Accelerating outward along escape direction
          const speed = 1.4 + phase * 0.8;
          const dist  = dT * dT * speed;
          const exd = escapeDirs[i * 3], eyd = escapeDirs[i * 3 + 1], ezd = escapeDirs[i * 3 + 2];

          let qx = tx + exd * dist;
          let qy = ty + eyd * dist;
          let qz = tz + ezd * dist;

          // Light curl drift so they don't fly in straight lines
          const c = curlNoise(qx, qy, qz, elapsed * 0.7, seed);
          px = qx + c.x * dT * 0.35;
          py = qy + c.y * dT * 0.35;
          pz = qz + c.z * dT * 0.35;

          alpha = Math.max(0, 1 - dT * 1.25);
          sz    = bSize * (1 + dT * 0.6);                                  // puff out as they fade
        }
        else {
          // hidden: park at origin, render nothing
          px = ox; py = oy; pz = oz;
          alpha = 0;
        }

        posArr[i * 3]     = px;
        posArr[i * 3 + 1] = py;
        posArr[i * 3 + 2] = pz;

        // Color multiplied by alpha (additive blend means 0 = invisible)
        colArr[i * 3]     = baseColors[i * 3]     * alpha;
        colArr[i * 3 + 1] = baseColors[i * 3 + 1] * alpha;
        colArr[i * 3 + 2] = baseColors[i * 3 + 2] * alpha;

        sizeArr[i] = sz;
      }

      faceLayer.geometry.attributes.position.needsUpdate = true;
      faceLayer.geometry.attributes.color.needsUpdate    = true;
      faceLayer.geometry.attributes.aSize.needsUpdate    = true;

      // Head sway during live state — subtle, conveys "presence"
      if (faceState === 'live') {
        faceLayer.rotation.y = Math.sin(now * 0.00040) * 0.18;
        faceLayer.rotation.x = Math.sin(now * 0.00028) * 0.06;
      } else if (faceState === 'forming') {
        // ease rotation in
        const t = Math.min(1, elapsed / FORM_DUR);
        faceLayer.rotation.y = Math.sin(now * 0.0006) * 0.12 * t;
      } else {
        faceLayer.rotation.y = 0;
        faceLayer.rotation.x = 0;
      }

      // Rings — spin always, slightly faster when forming/live
      const ringMul =
        faceState === 'forming'     ? 1.6 :
        faceState === 'live'        ? (1 + mouthLevel * 0.8) :
        faceState === 'dissipating' ? 0.6 :
        0.4;
      for (const ring of rings) {
        ring.mesh.rotation.z += ring.rotSpeed * 0.01 * ringMul;
        ring.mesh.rotation.y += ring.rotSpeed * 0.0035 * ringMul;
        // Rings fade with the face
        const ringTarget =
          faceState === 'hidden'      ? 0 :
          faceState === 'forming'     ? Math.min(1, elapsed / 1.0) :
          faceState === 'dissipating' ? Math.max(0, 1 - elapsed / DISSIPATE_DUR) :
          1;
        ring.material.opacity += (ring.baseOpacity * ringTarget - ring.material.opacity) * 0.10;
      }

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    resize();
    console.log('[face v7] cinematic ready — count=' + COUNT + ', mobile=' + isMobile);
  }

  function waitForThreeAndInit() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.THREE) {
        clearInterval(interval);
        try { tryInit(); } catch (e) { console.warn('[face v7] init threw:', e.message); }
      } else if (attempts > 30) {
        clearInterval(interval);
        console.warn('[face v7] Three.js never appeared after 3s — keeping canvas orb');
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForThreeAndInit);
  } else {
    waitForThreeAndInit();
  }
})();
