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

    // Cache-buster — Render's CDN / browser HTTP cache was holding onto an
    // older copy of the data files past a deploy. Bump this on every data
    // change so clients always pull the fresh stipple.
    const cb = '?v=v14';
    let particles = null;
    Promise.all([
      fetch('/zion-particle-meta.json' + cb).then(r => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-1.json' + cb).then(r => { if (!r.ok) throw new Error('part1 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-2.json' + cb).then(r => { if (!r.ok) throw new Error('part2 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-3.json' + cb).then(r => { if (!r.ok) throw new Error('part3 ' + r.status); return r.json(); }),
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
    // Smoothed voice envelope — low-pass filter over the raw FFT level so
    // whole-head motion tracks vocal *activity*, not every microsecond
    // amplitude blip. This is what drives the head bob; without smoothing
    // the head would jitter on every phoneme (which read as the "wave").
    let smoothedVoice = 0;

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
      // Smoothed envelope: ~85ms rise, ~250ms fall. Slow enough to be a
      // talking-activity signal, not a per-phoneme tracker.
      smoothedVoice = smoothedVoice * 0.88 + voice * 0.12;
      const tSec = now * 0.001;
      // Head bob — DRAMATIC uniform Y translation of the whole face. Dips down while
      // Zion is actively talking, eases back when quiet. Reads as a person
      // nodding into their words, not a particle wave.
      const headBob = smoothedVoice * 15.0; // More than 2x stronger head movement

      // Live-state idle motion — keeps the whole face alive when quiet.
      // The talking motion (jaw drop / lip split / lower-face shimmer) is
      // applied separately and ONLY to the lower face, so the upper face
      // stays still when Zion speaks (otherwise the whole face waves).
      const orbOmega = 2 * Math.PI * 0.4;
      const orbPhase = tSec * orbOmega;
      const sylPhase = tSec * 2 * Math.PI * 6.0; // ~6 Hz phoneme rate
      const idleAmp = 2.5;
      // Breath: subtle wobble only — no voice-driven inflation (it was
      // pumping the whole face on each word, contributing to the wave look).
      const breathLive = 1 + 0.015 * Math.sin(tSec * 2 * Math.PI * 0.25);
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
        // Facial region definitions for human-like expressions
        const LIP_Y = 0.76;           // Lip/mouth band center
        const LIP_HALF = 0.09;        // Half-width of lip band
        const JAW_START = 0.57;       // Where jaw drop starts (below nose)
        const JAW_SPAN  = 1.0 - JAW_START;

        // New facial regions for enhanced expressions
        const EYE_Y = 0.35;           // Eye region center
        const EYE_HALF = 0.08;        // Eye region half-height
        const EYEBROW_Y = 0.25;       // Eyebrow region
        const EYEBROW_HALF = 0.06;    // Eyebrow region half-height
        const CHEEK_Y = 0.55;         // Cheek region center
        const CHEEK_HALF = 0.12;      // Cheek region half-height
        const FOREHEAD_Y = 0.15;      // Forehead region
        for (let i = 0; i < n; i++) {
          // Idle breathing — every dot, voice-independent
          const idleDx = idleAmp * Math.sin(orbPhase + phA[i]);
          const idleDy = idleAmp * Math.sin(orbPhase + phB[i]);

          const yNorm = ys[i] * imgHinv;

          // Jaw drop — DRAMATIC jaw movement during speech
          // Voice-scaled. The lower the dot, the more it drops, like a
          // jaw rotating around the temporomandibular axis.
          const jawIntensity = yNorm > JAW_START ? (yNorm - JAW_START) / JAW_SPAN : 0;
          const jawDrop = voice * 45 * jawIntensity; // 1.5x stronger jaw movement

          // Lip split — DRAMATIC lip movement during speech
          // No abrupt crossover at the center (which read as a sharp line);
          // instead dots near the center barely move, mid-band displaces
          // most, edges return to zero — like the soft motion of parting lips.
          const lipDist = yNorm - LIP_Y;
          const lipKernel = Math.max(0, 1 - Math.abs(lipDist) / LIP_HALF);
          const lipSplit = voice * 22 * lipKernel * Math.sin(lipDist * Math.PI / LIP_HALF); // 2x stronger lip movement

          // Phoneme shimmer — fast wobble, scoped to the lower face so the
          // upper face stays still. Drives the per-syllable detail.
          const shimX = voice * 1.4 * jawIntensity * Math.sin(sylPhase + phA[i] * 1.7);
          const shimY = voice * 1.4 * jawIntensity * Math.sin(sylPhase + phB[i] * 1.7);

          // ═══ ENHANCED HUMAN FACIAL EXPRESSIONS ═══

          // Expression coordination phases for natural movement
          const expressionPhase = tSec * 2.1 + phA[i] * 0.6; // Main expression rhythm
          const speechIntensity = voice * (0.8 + 0.4 * Math.sin(tSec * 3.7)); // Variable speech intensity

          // Eye expressions — DRAMATIC blinking and eye movement during speech
          const eyeDist = Math.abs(yNorm - EYE_Y);
          const eyeKernel = Math.max(0, 1 - eyeDist / EYE_HALF);
          const blinkPhase = Math.sin(tSec * 3.2 + phA[i] * 0.8) * 0.5 + 0.5; // Slow blinks
          const speechBlink = speechIntensity * 25 * eyeKernel * Math.sin(blinkPhase * Math.PI); // 3x stronger
          const eyeSquint = speechIntensity * 12 * eyeKernel * Math.sin(expressionPhase + i * 0.3); // 4x stronger

          // Eyebrow expressions — DRAMATIC raise during speech, emotions
          const browDist = Math.abs(yNorm - EYEBROW_Y);
          const browKernel = Math.max(0, 1 - browDist / EYEBROW_HALF);
          const browRaise = voice * 20 * browKernel * Math.sin(tSec * 2.8 + phA[i] * 1.2) * -1; // 3x stronger, negative = up
          const browFurrow = smoothedVoice * 8 * browKernel * Math.sin(tSec * 1.9 + i * 0.15); // 4x stronger

          // Cheek expressions — DRAMATIC smile dynamics, cheek movement
          const cheekDist = Math.abs(yNorm - CHEEK_Y);
          const cheekKernel = Math.max(0, 1 - cheekDist / CHEEK_HALF);
          const cheekLift = voice * 15 * cheekKernel * Math.sin(tSec * 3.5 + phA[i] * 1.1) * -0.8; // Major smile lift
          const cheekPuff = smoothedVoice * 12 * cheekKernel * Math.sin(tSec * 2.1 + i * 0.4); // Strong cheek puffing

          // Forehead expressions — DRAMATIC wrinkles and tension
          const foreheadKernel = yNorm < FOREHEAD_Y ? (1 - yNorm / FOREHEAD_Y) : 0;
          const foreheadTension = voice * 10 * foreheadKernel * Math.sin(tSec * 1.6 + phA[i] * 0.7); // 5x stronger

          // Enhanced mouth expressions — DRAMATIC curvature and movement
          const mouthCurvature = voice * 18 * lipKernel * Math.sin(tSec * 4.2 + xs[i] * 0.01); // Strong smile curvature
          const mouthTwist = smoothedVoice * 10 * lipKernel * Math.cos(tSec * 3.1 + i * 0.25); // Pronounced asymmetry

          // Whole-face liveliness shimmer — INCOHERENT (phase seeded by
          // index, not by spatial position). Adjacent dots don't move
          // together, so no diagonal wave streaks. Very low amplitude so
          // it reads as "the surface is alive" not "particles are jittering".
          const liveX = smoothedVoice * 1.2 * Math.sin(tSec * 9.3 + i * 0.71);
          const liveY = smoothedVoice * 1.2 * Math.cos(tSec * 9.1 + i * 0.91);

          // Combine all facial expressions for natural human-like movement
          const imgX = xs[i] + idleDx + shimX + liveX + browFurrow + cheekPuff + mouthTwist;
          const imgY = ys[i] + idleDy + jawDrop + lipSplit + shimY + headBob + liveY
                       + speechBlink + eyeSquint + browRaise + cheekLift + foreheadTension + mouthCurvature;
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
