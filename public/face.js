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
      const phA = new Float32Array(n);
      const phB = new Float32Array(n);
      const rH  = new Float32Array(n);
      const thH = new Float32Array(n);
      // Scatter is parameterized so it remaps to the canvas each frame
      // (responsive to viewport). thS = angle, sf = 0..1 radial factor.
      const thS = new Float32Array(n);
      const sf  = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const x = homeX[i];
        const y = homeY[i];
        xs[i] = x;
        ys[i] = y;
        bs[i] = homeB[i];

        // Live-state orbit phases — spatially coherent so neighbors drift
        // together (gives the breathing surface its quiet life).
        phA[i] = Math.sin(x * 0.011 + y * 0.013) * 7;
        phB[i] = Math.cos(x * 0.013 + y * 0.011) * 7;

        const dx = x - cxImg;
        const dy = y - cyImg;
        rH[i]  = Math.sqrt(dx * dx + dy * dy);
        thH[i] = Math.atan2(dy, dx);

        thS[i] = Math.random() * Math.PI * 2;
        sf[i]  = Math.random();
      }

      const px = new Float32Array(n);
      const py = new Float32Array(n);

      return {
        x: xs, y: ys, b: bs,
        phA, phB, rH, thH, thS, sf,
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
      // Whole-head bob + sway — small uniform translation. Reads as
      // micro-nod into the words, not a bounce.
      const headBob  = smoothedVoice * 4.5;
      const headSway = smoothedVoice * 1.6 * Math.sin(tSec * 0.9);

      // Autonomic blink — happens every ~4.5s regardless of voice. A
      // short 0.18s squeeze that gives the face life even when quiet.
      const blinkCycle = (tSec * (1 / 4.5)) % 1;
      const blinkAmt = blinkCycle < 0.04 ? Math.sin(blinkCycle / 0.04 * Math.PI) : 0;

      const orbOmega = 2 * Math.PI * 0.4;
      const orbPhase = tSec * orbOmega;
      const idleAmp = 2.5;
      const breathLive = 1 + 0.015 * Math.sin(tSec * 2 * Math.PI * 0.25);
      const breath = phase === 'live' ? breathLive : 1;
      const sX = scale * breath;
      const sY = scale * breath;

      const formEased = phase === 'forming' ? easeOutCubic(formP) : 0;
      const dissEased = phase === 'dissolving' ? easeInCubic(dissP) : 0;

      const n = particles.count;
      const xs = particles.x, ys = particles.y;
      const phA = particles.phA, phB = particles.phB;
      const rH = particles.rH, thH = particles.thH;
      const thS = particles.thS, sf = particles.sf;
      const pxArr = particles.px, pyArr = particles.py;

      if (phaseKind === 'live') {
        const imgHinv = 1 / imgH;
        const halfW = imgW * 0.5;
        // Face-region landmarks in image-normalized y. Tuned for the
        // lylo face-source.jpg portrait — eyes mid-upper-face, mouth
        // about 3/4 down, chin near 0.9.
        const BROW_TOP   = 0.32, BROW_BOT  = 0.41;
        const EYE_TOP    = 0.38, EYE_BOT   = 0.46, EYE_CY = 0.42;
        const CHEEK_TOP  = 0.50, CHEEK_BOT = 0.66;
        const UPPER_LIP_N = 0.72;
        const LIP_Y       = 0.76;
        const CHIN_N      = 0.92;
        const SPAN        = CHIN_N - UPPER_LIP_N;
        for (let i = 0; i < n; i++) {
          const idleDx = idleAmp * Math.sin(orbPhase + phA[i]);
          const idleDy = idleAmp * Math.sin(orbPhase + phB[i]);

          const yNorm = ys[i] * imgHinv;
          const xRel = (xs[i] - halfW) / halfW;
          // Two Gaussians — tight for mouth motion (stays on the mouth
          // column), wider for brow/cheek (spans most of the face).
          const mouthHw = Math.exp(-xRel * xRel * 4.5);
          const faceHw  = Math.exp(-xRel * xRel * 1.6);

          // Jaw drop — small, smooth, sin-eased upper-lip-to-chin.
          let jawOpen = 0;
          if (yNorm > UPPER_LIP_N && yNorm < CHIN_N + 0.04) {
            const tt = Math.min(1, (yNorm - UPPER_LIP_N) / SPAN);
            jawOpen = voice * 7 * mouthHw * Math.sin(tt * Math.PI * 0.5);
          }

          // Upper-lip lift — narrow band just above the lip line.
          const ulDist = yNorm - LIP_Y;
          const ulKernel = Math.max(0, 1 - Math.abs(ulDist) / 0.05);
          const upperLip = (yNorm < LIP_Y) ? -voice * 3 * mouthHw * ulKernel : 0;

          // Brow raise — eyebrows lift on speech, sin-eased so the
          // motion peaks at the middle of the brow band and tapers at
          // the edges. This is what makes the upper face *react*.
          let browLift = 0;
          if (yNorm > BROW_TOP && yNorm < BROW_BOT) {
            const bk = Math.sin((yNorm - BROW_TOP) / (BROW_BOT - BROW_TOP) * Math.PI);
            browLift = -smoothedVoice * 2.5 * faceHw * bk;
          }

          // Cheek lift — outer cheeks pull up slightly during speech,
          // suggesting an engaged / slightly-smiling expression.
          let cheekLift = 0;
          if (yNorm > CHEEK_TOP && yNorm < CHEEK_BOT && Math.abs(xRel) > 0.30) {
            const ck = Math.sin((yNorm - CHEEK_TOP) / (CHEEK_BOT - CHEEK_TOP) * Math.PI);
            cheekLift = -smoothedVoice * 1.4 * ck;
          }

          // Blink — eye-band particles compress toward the eye center
          // for ~0.18s every ~4.5s. Pure autonomic; runs even when quiet.
          let blinkDy = 0;
          if (blinkAmt > 0 && yNorm > EYE_TOP && yNorm < EYE_BOT) {
            blinkDy = (EYE_CY - yNorm) * imgH * blinkAmt * 0.55;
          }

          // Whole-face shimmer — incoherent per-dot jitter (phase seeded
          // by index) so it sparkles instead of forming wave streaks.
          // Subtle so the head reads as alive without looking jittery.
          const danceAmp = smoothedVoice * 2.4;
          const liveX = danceAmp * Math.sin(tSec * 9.3 + i * 0.71);
          const liveY = danceAmp * Math.cos(tSec * 11.1 + i * 0.91);

          const imgX = xs[i] + idleDx + liveX + headSway;
          const imgY = ys[i] + idleDy + jawOpen + upperLip + browLift + cheekLift + blinkDy + headBob + liveY;
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
