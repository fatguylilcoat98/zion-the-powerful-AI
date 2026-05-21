/*
  Zion — Particle Face v13 (lylo face source, runtime-sampled).

  Source of truth: /face-source.jpg (the cyan stipple portrait Chris
  approved on lylo). On load we sample it once with the same pipeline
  lylo's ParticleFace uses — face-ellipse mask + cyan/brightness
  threshold + neighbor-density filter — and build the per-dot arrays
  the renderer below needs. No more precomputed JSON stipple files.

  Phase machine (unchanged from v12):
    hidden     -> CONVERSE on   -> forming   (~2.8s spiral inward from scatter)
    forming    -> auto          -> live      (idle breathing + voice-driven motion)
    live       -> CONVERSE off  -> dissolving(~2.0s spiral outward + fade)
    dissolving -> auto          -> hidden    (orb returns)

  Voice (window.__voiceLevel, 0..1, populated by zion-interface.html)
  drives, during live:
    - whole-head bob (uniform Y translation, reads as nodding into words)
    - lower-face jaw drop + upper-lip lift (mouth opens like a mouth)
    - whole-face incoherent shimmer (sparkle, not wave streaks)
    - teal -> aqua-white color shift + alpha boost
  Everything is gated on smoothedVoice (lowpass envelope) so it tracks
  talking *activity*, not per-phoneme amplitude spikes.
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face v13] neural-center missing'); return; }

    const faceCanvas = document.createElement('canvas');
    faceCanvas.id = 'faceCanvas';
    faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; opacity:0; transition:opacity 0.6s ease;';
    neuralCenter.appendChild(faceCanvas);

    const ctx = faceCanvas.getContext('2d');
    if (!ctx) {
      console.warn('[face v13] 2D context unavailable');
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

    // Sampling knobs — mirror lylo/components/ParticleFace.tsx defaults so
    // the look is identical to the /face route on the site.
    const SAMPLE_STEP = 2;
    const CYAN_THRESHOLD = 10;
    const BRIGHTNESS_THRESHOLD = 42;
    const DENSITY_RADIUS = 3;
    const DENSITY_MIN = 14;
    const FACE_CX = 0.5;
    const FACE_CY = 0.5;
    const FACE_RX = 0.42;
    const FACE_RY = 0.46;

    let particles = null;

    function samplePixelsToParticles(img) {
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
      const tmp = document.createElement('canvas');
      tmp.width = imgW;
      tmp.height = imgH;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      if (!tctx) return null;
      tctx.drawImage(img, 0, 0);
      const data = tctx.getImageData(0, 0, imgW, imgH).data;

      // Face-ellipse mask — drops the HUD lines and orbital rings outside
      // the head so we only sample the portrait.
      const fx  = FACE_CX * imgW;
      const fy  = FACE_CY * imgH;
      const frx = FACE_RX * imgW;
      const fry = FACE_RY * imgH;

      const mask = new Uint8Array(imgW * imgH);
      for (let y = 0; y < imgH; y++) {
        const ny = (y - fy) / fry;
        for (let x = 0; x < imgW; x++) {
          const nx = (x - fx) / frx;
          if (nx * nx + ny * ny > 1) continue;
          const i = (y * imgW + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const cyan = (g + b) * 0.5 - r;
          const brightness = (r + g + b) / 3;
          if (cyan > CYAN_THRESHOLD && brightness > BRIGHTNESS_THRESHOLD) {
            mask[y * imgW + x] = 1;
          }
        }
      }

      // Neighbor-density filter — keeps stipple clusters, drops lone
      // speckles so the face reads as a solid surface.
      const dr = DENSITY_RADIUS;
      const homeX = [];
      const homeY = [];
      const homeB = [];
      for (let y = 0; y < imgH; y += SAMPLE_STEP) {
        for (let x = 0; x < imgW; x += SAMPLE_STEP) {
          if (!mask[y * imgW + x]) continue;
          if (x < dr || y < dr || x >= imgW - dr || y >= imgH - dr) continue;
          let count = 0;
          for (let dy = -dr; dy <= dr; dy++) {
            const row = (y + dy) * imgW;
            for (let dx = -dr; dx <= dr; dx++) {
              count += mask[row + x + dx];
            }
          }
          if (count < DENSITY_MIN) continue;

          const i = (y * imgW + x) * 4;
          const b01 = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
          // Boost low-brightness pixels so they still register against the
          // dark background (same compression lylo uses).
          homeX.push(x);
          homeY.push(y);
          homeB.push(Math.min(1, 0.35 + b01 * 0.85));
        }
      }

      const n = homeX.length;
      if (!n) return null;

      const cxImg = imgW * 0.5;
      const cyImg = imgH * 0.5;

      const xs  = new Float32Array(n);
      const ys  = new Float32Array(n);
      const bs  = new Float32Array(n);
      // Per-particle INDEPENDENT motion seeds. Each dot gets its own
      // phase, frequency multiplier, direction vector, and blink-timing
      // offset. The whole point: neighboring dots no longer move in
      // lockstep — region kernels modulate the *amplitude* of each
      // dot's personal dance, they don't translate slabs.
      const phA  = new Float32Array(n);    // primary phase
      const phB  = new Float32Array(n);    // secondary phase (different freq)
      const phF  = new Float32Array(n);    // freq multiplier 0.6..1.7
      const dxU  = new Float32Array(n);    // personal x unit vector
      const dyU  = new Float32Array(n);    // personal y unit vector
      const blnk = new Float32Array(n);    // blink-timing offset 0..1
      const rH   = new Float32Array(n);
      const thH  = new Float32Array(n);
      // Scatter is parameterized so it remaps to the canvas each frame
      // (responsive to viewport). thS = angle, sf = 0..1 radial factor.
      const thS  = new Float32Array(n);
      const sf   = new Float32Array(n);

      const TAU = Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const x = homeX[i];
        const y = homeY[i];
        xs[i] = x;
        ys[i] = y;
        bs[i] = homeB[i];

        // Pure random phases — each particle dances on its own clock.
        phA[i] = Math.random() * TAU;
        phB[i] = Math.random() * TAU;
        phF[i] = 0.6 + Math.random() * 1.1;     // 0.6..1.7
        // Personal direction: a random unit-ish vector. Each dot has a
        // preferred axis of motion, so even when many dots share the
        // same region influence they don't all move the same direction.
        const theta = Math.random() * TAU;
        dxU[i] = Math.cos(theta);
        dyU[i] = Math.sin(theta);
        blnk[i] = Math.random();                // 0..1 stagger for blink

        const dx = x - cxImg;
        const dy = y - cyImg;
        rH[i]  = Math.sqrt(dx * dx + dy * dy);
        thH[i] = Math.atan2(dy, dx);

        thS[i] = Math.random() * TAU;
        sf[i]  = Math.random();
      }

      const px = new Float32Array(n);
      const py = new Float32Array(n);

      return {
        x: xs, y: ys, b: bs,
        phA, phB, phF, dxU, dyU, blnk,
        rH, thH, thS, sf,
        px, py,
        imgW, imgH, cxImg, cyImg,
        count: n,
      };
    }

    const faceImg = new Image();
    faceImg.crossOrigin = 'anonymous';
    faceImg.decoding = 'async';
    faceImg.onload = () => {
      try {
        particles = samplePixelsToParticles(faceImg);
        if (!particles) {
          console.warn('[face v13] no particles after sampling face-source.jpg');
          return;
        }
        console.log('[face v13] sampled ' + particles.count + ' dots from /face-source.jpg ('
          + particles.imgW + 'x' + particles.imgH + ')');
      } catch (err) {
        console.warn('[face v13] sampling failed:', err && err.message);
      }
    };
    faceImg.onerror = () => {
      console.warn('[face v13] failed to load /face-source.jpg');
    };
    // Cache-buster — bump on every face-source change so clients always
    // pull the fresh portrait past Render's CDN / browser HTTP cache.
    faceImg.src = '/face-source.jpg?v=v13';

    // Phase state machine
    const FORM_DURATION = 2.8;
    const DISSOLVE_DURATION = 2.0;
    const FORM_FADE_IN = 0.6;
    const DISSOLVE_HOLD = 0.5;
    // Whole-number extra rotations so dots land exactly on their home
    // angle at p=1 (a fractional spin count rotates the whole face off-axis).
    const EXTRA_SPINS = 1;
    const EXTRA_TWO_PI = EXTRA_SPINS * 2 * Math.PI;

    let phase = 'hidden';
    let phaseStart = performance.now();
    // Smoothed voice envelope — low-pass over the raw FFT level so
    // whole-head motion tracks vocal *activity*, not per-phoneme blips.
    let smoothedVoice = 0;

    function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }
    function easeInCubic(t)  { return t * t * t; }

    function frame() {
      const now = performance.now();
      const t   = (now - phaseStart) / 1000;
      const converse = !!window.__converseActive;

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
        // Reroll scatter angles + factors so dissolve doesn't mirror entry.
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

      const padding = 0.95;
      const scale = Math.min(w / imgW, h / imgH) * padding;
      const cX = w * 0.5;
      const cY = h * 0.5;

      const minDim = Math.min(w, h);
      const SCATTER_MIN = minDim * 0.55;
      const SCATTER_SPREAD = minDim * 0.22;

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
      // ~85ms rise, ~250ms fall — talking-activity signal, not per-phoneme.
      smoothedVoice = smoothedVoice * 0.88 + voice * 0.12;
      const tSec = now * 0.001;

      // ── Head as a unit ──────────────────────────────────────────────
      // Translation (bob + sway) plus a roll rotation around the centroid.
      // Real heads tilt and pitch constantly while talking, not just bob.
      // The roll has an always-on idle component so the head feels alive
      // even when quiet, plus a voice-driven beat that lands on speech.
      const headBob       = smoothedVoice * 6.5;
      const headSway      = smoothedVoice * 2.2 * Math.sin(tSec * 0.9);
      const headRollIdle  = Math.sin(tSec * 0.55) * 0.014
                          + Math.sin(tSec * 0.37 + 1.3) * 0.008;
      const headRollTalk  = smoothedVoice * 0.04 * Math.sin(tSec * 2.1);
      const headRoll      = headRollIdle + headRollTalk;
      const cosR = Math.cos(headRoll), sinR = Math.sin(headRoll);

      // ── Autonomic blink ─────────────────────────────────────────────
      // Every ~4.5s a quick squeeze (~0.18s) of the eye band, even when
      // quiet. Voice doesn't trigger blinks — those are involuntary.
      const blinkCycle = (tSec * (1 / 4.5)) % 1;
      const blinkAmt = blinkCycle < 0.04 ? Math.sin(blinkCycle / 0.04 * Math.PI) : 0;

      // ── Eye saccades + emphasis squint ──────────────────────────────
      // Slow random drift of eye particles (the small horizontal/vertical
      // micro-movements human eyes do constantly) plus a partial squint
      // when smoothedVoice is high (eyes engage with the words).
      const eyeDriftX  = (Math.sin(tSec * 0.21) + 0.5 * Math.sin(tSec * 0.43 + 1.1)) * 1.4;
      const eyeDriftY  = Math.sin(tSec * 0.31 + 0.7) * 0.8;
      const eyeSquint  = smoothedVoice * 0.32;

      // ── Mouth-shape variation ───────────────────────────────────────
      // Real mouths don't just open/close on voice level — they form
      // different shapes for different vowels. Approximated here by a
      // medium-fast oscillator scaled by voice, modulating lateral lip
      // spread (positive = wider, negative = rounder) and jaw amplitude.
      const mouthShape = Math.sin(tSec * 4.7) + 0.6 * Math.sin(tSec * 7.3 + 1.9);
      const mouthWide  = voice * 3.0 * mouthShape;       // lateral spread/round
      const jawJitter  = 1 + 0.35 * mouthShape;          // per-syllable size variation

      // ── Asymmetry biases ────────────────────────────────────────────
      // Slow asymmetry on brow/cheek so left and right don't mirror
      // perfectly — the single biggest tell of a "puppet" face.
      const browAsym  = 0.45 * Math.sin(tSec * 0.83);    // -0.45..0.45
      const cheekAsym = 0.35 * Math.sin(tSec * 0.62 + 1.6);

      const breathLive = 1 + 0.015 * Math.sin(tSec * 2 * Math.PI * 0.25);
      const breath = phase === 'live' ? breathLive : 1;
      const sX = scale * breath;
      const sY = scale * breath;

      const formEased = phase === 'forming' ? easeOutCubic(formP) : 0;
      const dissEased = phase === 'dissolving' ? easeInCubic(dissP) : 0;

      const n = particles.count;
      const xs = particles.x, ys = particles.y;
      const phA = particles.phA, phB = particles.phB, phF = particles.phF;
      const dxU = particles.dxU, dyU = particles.dyU, blnk = particles.blnk;
      const rH = particles.rH, thH = particles.thH;
      const thS = particles.thS, sf = particles.sf;
      const pxArr = particles.px, pyArr = particles.py;

      if (phaseKind === 'live') {
        const imgHinv = 1 / imgH;
        const halfW = imgW * 0.5;
        // Face-region landmarks in image-normalized y. Tuned for the
        // lylo face-source.jpg portrait — forehead 0.18..0.32, brows
        // 0.32..0.41, eyes 0.38..0.46, nose 0.48..0.66, cheeks 0.50..0.66,
        // mouth 0.72..0.80, chin 0.92.
        const FOREHEAD_TOP = 0.18, FOREHEAD_BOT = 0.32;
        const BROW_TOP   = 0.32, BROW_BOT  = 0.41;
        const EYE_TOP    = 0.38, EYE_BOT   = 0.46, EYE_CY = 0.42;
        const NOSE_TOP   = 0.48, NOSE_BOT  = 0.66;
        const CHEEK_TOP  = 0.50, CHEEK_BOT = 0.66;
        const UPPER_LIP_N = 0.72;
        const LIP_Y       = 0.76;
        const CHIN_N      = 0.92;
        const SPAN        = CHIN_N - UPPER_LIP_N;
        // Each dot has its own oscillator — these scalars set the base
        // tempo all dots share, modulated per-dot by phF[i].
        const baseOmegaA = 2 * Math.PI * 1.1;
        const baseOmegaB = 2 * Math.PI * 1.7;
        // Always-on tiny personal motion (so even a quiet dot is moving).
        const ambientAmp = 0.9;
        for (let i = 0; i < n; i++) {
          // ── Per-particle PERSONAL oscillation ─────────────────────
          // Each dot dances on its own. Its phase, frequency, and
          // direction vector are random per-particle — neighbors
          // do not move in lockstep. This is the core change: region
          // kernels (below) modulate the AMPLITUDE of this personal
          // motion, they don't translate slabs.
          const tA  = tSec * baseOmegaA * phF[i] + phA[i];
          const tB  = tSec * baseOmegaB * phF[i] + phB[i];
          const oscA = Math.sin(tA);                  // -1..1, per dot
          const oscB = Math.cos(tB);                  // -1..1, per dot
          // Personal motion vector — each dot has its own preferred axis.
          const persX = dxU[i] * oscA + dyU[i] * oscB * 0.6;
          const persY = dyU[i] * oscA + dxU[i] * oscB * 0.6;

          const yNorm = ys[i] * imgHinv;
          const xRel = (xs[i] - halfW) / halfW;
          // Two Gaussians — tight for mouth motion (stays on the mouth
          // column), wider for brow/cheek (spans most of the face).
          const mouthHw = Math.exp(-xRel * xRel * 4.5);
          const faceHw  = Math.exp(-xRel * xRel * 1.6);
          const side = xRel >= 0 ? 1 : -1;

          // ── Always-on ambient: each dot oscillates a little ──
          // Replaces the old "spatially coherent breathing surface"
          // (which moved as one slab) with per-dot motion that reads
          // as individuals dancing.
          let dDx = ambientAmp * persX;
          let dDy = ambientAmp * persY;

          // ── Region influences. Each kernel is a 0..1 weight scaled
          //    by voice. We add it to (a) per-dot personal motion as
          //    AMPLITUDE, and (b) a small directional bias for shape.

          // Mouth: jaw drop band (below upper lip → chin)
          if (yNorm > UPPER_LIP_N && yNorm < CHIN_N + 0.04) {
            const tt = Math.min(1, (yNorm - UPPER_LIP_N) / SPAN);
            const jaw = mouthHw * Math.sin(tt * Math.PI * 0.5);
            // Each dot oscillates more — gestalt = mouth area dancing
            dDx += persX * voice * 6 * jaw * jawJitter;
            dDy += persY * voice * 6 * jaw * jawJitter;
            // Tiny directional bias DOWN so the average opens the jaw
            dDy += voice * 3.5 * jaw * jawJitter;
            // Lateral spread/round per dot, with per-dot variation
            dDx += xRel * mouthWide * jaw * (0.7 + 0.6 * oscA);
          }

          // Upper-lip lift band (just above the lip line)
          const ulDist = yNorm - LIP_Y;
          const ulKernel = Math.max(0, 1 - Math.abs(ulDist) / 0.05);
          if (yNorm < LIP_Y && ulKernel > 0) {
            const ul = mouthHw * ulKernel;
            dDx += persX * voice * 3 * ul;
            dDy += persY * voice * 3 * ul;
            dDy -= voice * 1.8 * ul;  // small upward bias
          }

          // Brow band (asymmetric)
          if (yNorm > BROW_TOP && yNorm < BROW_BOT) {
            const bk = Math.sin((yNorm - BROW_TOP) / (BROW_BOT - BROW_TOP) * Math.PI);
            const sideFactor = 1 + side * browAsym;
            const brow = faceHw * bk * sideFactor;
            dDx += persX * smoothedVoice * 5 * brow;
            dDy += persY * smoothedVoice * 5 * brow;
            dDy -= smoothedVoice * 2.0 * brow;  // upward bias
          }

          // Forehead band — wakes up correlated with brow
          if (yNorm > FOREHEAD_TOP && yNorm < FOREHEAD_BOT) {
            const fk = Math.sin((yNorm - FOREHEAD_TOP) / (FOREHEAD_BOT - FOREHEAD_TOP) * Math.PI);
            const fore = faceHw * fk;
            dDx += persX * smoothedVoice * 3 * fore;
            dDy += persY * smoothedVoice * 3 * fore;
            dDy += smoothedVoice * 0.8 * fore;  // tiny downward (furrow)
          }

          // Cheek band (asymmetric)
          if (yNorm > CHEEK_TOP && yNorm < CHEEK_BOT && Math.abs(xRel) > 0.30) {
            const ck = Math.sin((yNorm - CHEEK_TOP) / (CHEEK_BOT - CHEEK_TOP) * Math.PI);
            const sideFactor = 1 + side * cheekAsym;
            const cheek = ck * sideFactor;
            dDx += persX * smoothedVoice * 4 * cheek;
            dDy += persY * smoothedVoice * 4 * cheek;
            dDy -= smoothedVoice * 1.4 * cheek;  // upward bias
          }

          // Nose / nostril band (central column)
          if (yNorm > NOSE_TOP && yNorm < NOSE_BOT && Math.abs(xRel) < 0.18) {
            dDx += persX * smoothedVoice * 2.5;
            dDy += persY * smoothedVoice * 2.5;
            dDx += side * smoothedVoice * 0.6;  // tiny outward bias
          }

          // ── Eyes ───────────────────────────────────────────────
          // Saccades become per-dot drift; squint becomes per-dot
          // inward bias scaled by voice; blink is a per-dot sweep
          // with TIMING STAGGER so dots arrive in waves, not in unison.
          if (yNorm > EYE_TOP && yNorm < EYE_BOT) {
            // Per-dot saccade drift — each eye dot drifts on its own
            dDx += eyeDriftX * (0.6 + 0.8 * oscA);
            dDy += eyeDriftY * (0.6 + 0.8 * oscB);
            // Squint — partial inward bias, jittered per dot so dots
            // don't pile up on the eye-center line.
            const sq = (EYE_CY - yNorm) * imgH * eyeSquint;
            dDy += sq * (0.7 + 0.6 * oscA);
            dDx += sq * 0.25 * oscB;  // lateral component so dots spread
            // Eyelid dance — every eye dot has constant tiny motion
            // even when not blinking (lashes/lids never truly still).
            dDx += persX * 0.8;
            dDy += persY * 0.8;
          }

          // Blink — per-dot staggered sweep. Each dot starts its blink
          // motion at a slightly different time (blnk[i] offsets it
          // into the cycle), moves with its own vector toward the
          // eye-center line, and adds a lateral component so dots don't
          // stack into a bright bar.
          if (blinkAmt > 0 && yNorm > EYE_TOP && yNorm < EYE_BOT) {
            const stagger = blnk[i] * 0.25;            // up to 0.25 of pulse
            const dotBlink = Math.max(0, blinkAmt - stagger);
            const toCenter = (EYE_CY - yNorm) * imgH;
            // 0.4 instead of 0.55 — gentler, so dots don't pile up
            dDy += toCenter * dotBlink * 0.4 * (0.8 + 0.4 * oscA);
            // Lateral sweep — each dot moves its own way, kills the bar.
            dDx += dxU[i] * dotBlink * 3.5;
            dDy += dyU[i] * dotBlink * 1.6;
          }

          // ── Head as a unit: roll around centroid, then translate ──
          const dx0 = xs[i] - cxImg;
          const dy0 = ys[i] - cyImg;
          const rx  = dx0 * cosR - dy0 * sinR;
          const ry  = dx0 * sinR + dy0 * cosR;

          const imgX = cxImg + rx + dDx + headSway;
          const imgY = cyImg + ry + dDy + headBob;
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

      const pSize = 1.4;
      const half = pSize * 0.5;

      // Voice-reactive color: idle teal -> aqua-white while Zion speaks.
      const talk = Math.min(1, smoothedVoice * 1.5);
      const cr  = (talk * 165) | 0;        // 0   -> 165
      const cg  = (220 + talk * 35) | 0;   // 220 -> 255
      const cbl = (240 + talk * 12) | 0;   // 240 -> 252
      const aBoost = 1 + talk * 0.55;
      const colPrefix = 'rgba(' + cr + ', ' + cg + ', ' + cbl + ', ';

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bs = particles.b;
      const BUCKETS = 8;
      for (let bk = 0; bk < BUCKETS; bk++) {
        const bMin = bk / BUCKETS;
        const bMax = (bk + 1) / BUCKETS;
        const aMul = 0.25 + 0.75 * ((bk + 0.5) / BUCKETS);
        ctx.fillStyle = colPrefix + (0.55 * alpha * aMul * aBoost).toFixed(3) + ')';
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
    console.log('[face v13] init — runtime-sampled lylo face, CONVERSE-gated swarm');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
