/*
  Zion — Particle Face v12 (Stages 2 + 3 + 4, cinematic).

  Pipeline:
    hidden   -> CONVERSE click  -> forming   (~2.8s spiral inward from scatter)
    forming  -> auto            -> live      (idle breathing + voice-driven motion)
    live     -> CONVERSE off    -> dissolving(~2.0s spiral outward + fade)
    dissolving -> auto          -> hidden    (orb returns)

  Per-dot precomputation at load:
    - home position (xs, ys) and brightness (bs) from the stipple data
    - polar coords of the home position relative to the bbox center
      (rH, thH) — used by formation/dissolution as the target/origin
    - scatter polar (rS, thS) — a random point outside the face envelope
      where the dot starts (formation) or ends up (dissolution)
    - phA, phB — phase offsets for the live-state Lissajous breathing
      orbit, derived from home coords so neighbors drift together

  Per frame:
    Pass 1: for each dot, compute its current image-space position
            based on the active phase (formation spiral / live orbit+
            voice / dissolution spiral). Stash in scratch arrays.
    Pass 2: bucketed draws — group by brightness so we set fillStyle 8x
            instead of 17000x.

  Voice: window.__voiceLevel (0..1, smoothed FFT, already populated by
  zion-interface.html). During live, voice:
    - amplifies the per-dot orbit amplitude (so whole face responds)
    - boosts the global breath/inflation scale slightly
    - adds a jaw-drop bias for dots in the lower face on speech peaks
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face v12] neural-center missing'); return; }

    const faceCanvas = document.createElement('canvas');
    faceCanvas.id = 'faceCanvas';
    faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; opacity:0; transition:opacity 0.6s ease;';
    neuralCenter.appendChild(faceCanvas);

    const ctx = faceCanvas.getContext('2d');
    if (!ctx) {
      console.warn('[face v12] 2D context unavailable');
      neuralCenter.removeChild(faceCanvas);
      return;
    }

    if (orbCanvas && !orbCanvas.style.transition) {
      orbCanvas.style.transition = 'opacity 0.6s ease';
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      faceCanvas.width  = Math.max(1, Math.round(w * dpr));
      faceCanvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    let particles = null;
    Promise.all([
      fetch('/zion-particle-meta.json').then(r => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-1.json').then(r => { if (!r.ok) throw new Error('part1 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-2.json').then(r => { if (!r.ok) throw new Error('part2 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-3.json').then(r => { if (!r.ok) throw new Error('part3 ' + r.status); return r.json(); }),
    ]).then(([meta, a, b, c]) => {
      const all = a.concat(b, c);
      const n = all.length;
      const imgW = meta.bbox.w, imgH = meta.bbox.h;
      const cxImg = imgW * 0.5;
      const cyImg = imgH * 0.5;

      const xs = new Float32Array(n), ys = new Float32Array(n), bs = new Float32Array(n);
      const phA = new Float32Array(n), phB = new Float32Array(n);
      const rH = new Float32Array(n), thH = new Float32Array(n);
      // Scatter is parameterized so it remaps to the *canvas* each frame
      // (responsive to viewport). thS = angle, sf = 0..1 radial factor.
      const thS = new Float32Array(n), sf = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const x = all[i][0], y = all[i][1];
        xs[i] = x;
        ys[i] = y;
        bs[i] = all[i][2];

        // Live-state orbit phases — spatially coherent (neighbors drift together)
        phA[i] = Math.sin(x * 0.011 + y * 0.013) * 7;
        phB[i] = Math.cos(x * 0.013 + y * 0.011) * 7;

        // Polar coords of home position relative to bbox center
        const dx = x - cxImg, dy = y - cyImg;
        rH[i]  = Math.sqrt(dx * dx + dy * dy);
        thH[i] = Math.atan2(dy, dx);

        // Scatter angle + radial factor (resolved against canvas at render time)
        thS[i] = Math.random() * Math.PI * 2;
        sf[i]  = Math.random();
      }

      // Scratch arrays for per-frame computed positions (canvas space)
      const px = new Float32Array(n);
      const py = new Float32Array(n);

      particles = {
        x: xs, y: ys, b: bs,
        phA, phB, rH, thH, thS, sf,
        px, py,
        imgW, imgH, cxImg, cyImg,
        count: n,
      };
      console.log('[face v12] loaded ' + n + ' stipple dots (bbox ' + imgW + 'x' + imgH + ')');
    }).catch(err => {
      console.warn('[face v12] particle data fetch failed:', err.message);
      if (faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
    });

    // Phase state machine
    const FORM_DURATION = 2.8;     // seconds for spiral-in
    const DISSOLVE_DURATION = 2.0; // seconds for spiral-out
    const FORM_FADE_IN = 0.6;
    const DISSOLVE_HOLD = 0.5;     // hold full alpha at start of dissolve
    // Whole-number extra rotations so dots land EXACTLY on their home angle
    // at p=1 (a fractional spin count rotates the whole face off-axis).
    const EXTRA_SPINS = 1;
    const EXTRA_TWO_PI = EXTRA_SPINS * 2 * Math.PI;

    let phase = 'hidden';
    let phaseStart = performance.now();

    // Easing
    function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }
    function easeInCubic(t)  { return t * t * t; }

    function frame() {
      const now = performance.now();
      const t   = (now - phaseStart) / 1000;
      const converse = !!window.__converseActive;

      // Transitions
      if (phase === 'hidden' && converse && particles) {
        phase = 'forming';
        phaseStart = now;
        faceCanvas.style.opacity = '1';
        if (orbCanvas) orbCanvas.style.opacity = '0';
      } else if (phase === 'forming' && t >= FORM_DURATION) {
        phase = 'live';
        phaseStart = now;
      } else if ((phase === 'forming' || phase === 'live') && !converse) {
        phase = 'dissolving';
        phaseStart = now;
        // Reroll scatter angles + factors so dissolve doesn't mirror the entry
        const n = particles.count;
        const thS = particles.thS, sf = particles.sf;
        for (let i = 0; i < n; i++) {
          thS[i] = Math.random() * Math.PI * 2;
          sf[i]  = Math.random();
        }
      } else if (phase === 'dissolving' && t >= DISSOLVE_DURATION) {
        phase = 'hidden';
        phaseStart = now;
        faceCanvas.style.opacity = '0';
        if (orbCanvas) orbCanvas.style.opacity = '1';
      }

      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (!particles || phase === 'hidden') {
        requestAnimationFrame(frame);
        return;
      }

      const imgW = particles.imgW, imgH = particles.imgH;
      const cxImg = particles.cxImg, cyImg = particles.cyImg;

      // Canvas projection: face centroid at canvas center, scaled to fit.
      const padding = 0.95;
      const scale = Math.min(w / imgW, h / imgH) * padding;
      const cX = w * 0.5;
      const cY = h * 0.5;

      // Scatter ring sized to the canvas: dots arrive from somewhere
      // between the face envelope (~half the smaller canvas dim) and the
      // canvas edge — so they're visible at formP=0 instead of off-screen.
      const minDim = Math.min(w, h);
      const SCATTER_MIN = minDim * 0.55;
      const SCATTER_SPREAD = minDim * 0.22;

      // Phase-dependent globals
      let alpha = 1;
      let phaseKind = phase;
      let formP = 0, dissP = 0;
      if (phase === 'forming') {
        formP = Math.min(1, t / FORM_DURATION);
        alpha = Math.min(1, t / FORM_FADE_IN);
      } else if (phase === 'dissolving') {
        dissP = Math.min(1, t / DISSOLVE_DURATION);
        const fadeStart = DISSOLVE_HOLD;
        const fadeSpan = DISSOLVE_DURATION - DISSOLVE_HOLD;
        alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / fadeSpan);
      }

      const voice = (typeof window !== 'undefined' && window.__voiceLevel) ? window.__voiceLevel : 0;
      const tSec = now * 0.001;

      // Live-state idle/voice motion params
      const orbOmega = 2 * Math.PI * 0.4;
      const orbPhase = tSec * orbOmega;
      // Fast syllable-rate wobble layered on top of the slow idle orbit —
      // gives the face a per-phoneme shimmer when voice is active.
      const sylPhase = tSec * 2 * Math.PI * 6.0;
      const idleAmp = 2.5;
      const voiceOrbAmp = 9 * voice;
      const voiceSylAmp = 4 * voice;
      const ampPx = idleAmp + voiceOrbAmp;
      // Breath: subtle global scale wobble + voice inflation (boosted)
      const breathLive = 1 + 0.015 * Math.sin(tSec * 2 * Math.PI * 0.25) + 0.06 * voice;
      const breath = phase === 'live' ? breathLive : 1;
      const sX = scale * breath;
      const sY = scale * breath;

      // Precomputed transit eased progress for the dot loop
      const formEased = phase === 'forming' ? easeOutCubic(formP) : 0;
      const dissEased = phase === 'dissolving' ? easeInCubic(dissP) : 0;

      const n = particles.count;
      const xs = particles.x, ys = particles.y;
      const phA = particles.phA, phB = particles.phB;
      const rH = particles.rH, thH = particles.thH;
      const thS = particles.thS, sf = particles.sf;
      const pxArr = particles.px, pyArr = particles.py;

      // Pass 1: compute per-dot CANVAS-space positions
      if (phaseKind === 'live') {
        // In live, we render the dot's home (+ orbit + voice) in image space,
        // then project through the breath-scaled (sX, sY) at draw time.
        // Stash image-space positions; pass 2 projects them.
        const imgHinv = 1 / imgH;
        for (let i = 0; i < n; i++) {
          // Slow orbit (idle + voice-amplified)
          const dx0 = ampPx * Math.sin(orbPhase + phA[i]);
          const dy0 = ampPx * Math.sin(orbPhase + phB[i]);
          // Fast syllable wobble — only kicks in with voice
          const sx = voiceSylAmp * Math.sin(sylPhase + phA[i] * 1.7);
          const sy = voiceSylAmp * Math.sin(sylPhase + phB[i] * 1.7);
          // Jaw drop on the lower face during speech peaks (stronger)
          const yNorm = ys[i] * imgHinv;
          const jaw = yNorm > 0.55 ? voice * 8 * (yNorm - 0.55) / 0.45 : 0;
          // Brow lift on the upper face during speech peaks (subtle)
          const brow = yNorm < 0.35 ? -voice * 2 * (0.35 - yNorm) / 0.35 : 0;
          const imgX = xs[i] + dx0 + sx;
          const imgY = ys[i] + dy0 + sy + jaw + brow;
          pxArr[i] = cX + (imgX - cxImg) * sX;
          pyArr[i] = cY + (imgY - cyImg) * sY;
        }
      } else if (phaseKind === 'forming') {
        const p = formEased;
        for (let i = 0; i < n; i++) {
          const scatterR = SCATTER_MIN + sf[i] * SCATTER_SPREAD;
          const homeR    = rH[i] * scale;
          const r  = scatterR + (homeR - scatterR) * p;
          const th = thS[i] + (thH[i] - thS[i] + EXTRA_TWO_PI) * p;
          pxArr[i] = cX + r * Math.cos(th);
          pyArr[i] = cY + r * Math.sin(th);
        }
      } else { // dissolving
        const p = dissEased;
        for (let i = 0; i < n; i++) {
          const scatterR = (SCATTER_MIN + sf[i] * SCATTER_SPREAD) * 1.15;
          const homeR    = rH[i] * scale;
          const r  = homeR + (scatterR - homeR) * p;
          const th = thH[i] + (thS[i] - thH[i] + EXTRA_TWO_PI) * p;
          pxArr[i] = cX + r * Math.cos(th);
          pyArr[i] = cY + r * Math.sin(th);
        }
      }

      // Pass 2: bucketed draws
      const dpr = window.devicePixelRatio || 1;
      const pSize = Math.max(1.0, 1.4); // 1.4 css px regardless of dpr
      const half = pSize * 0.5;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bs = particles.b;
      const BUCKETS = 8;
      for (let bk = 0; bk < BUCKETS; bk++) {
        const bMin = bk / BUCKETS;
        const bMax = (bk + 1) / BUCKETS;
        const aMul = 0.25 + 0.75 * ((bk + 0.5) / BUCKETS);
        ctx.fillStyle = 'rgba(0, 220, 240, ' + (0.55 * alpha * aMul).toFixed(3) + ')';
        for (let i = 0; i < n; i++) {
          const b = bs[i];
          if (b < bMin || b >= bMax) continue;
          ctx.fillRect(pxArr[i] - half, pyArr[i] - half, pSize, pSize);
        }
      }
      ctx.restore();

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    console.log('[face v12] stages 2+3+4 init — forming/live/dissolving with voice');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
