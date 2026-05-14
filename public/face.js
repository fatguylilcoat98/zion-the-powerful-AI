/*
  Zion — Particle Face v11 (stippling + idle breathing, Stage 2).

  Stage 1 (merged): rejection-sampled stipple of the face region of the
  reference, masked to an egg-shaped envelope so no halo dots float
  outside the head.

  Stage 2 adds idle breathing. Each dot drifts in a small Lissajous orbit
  around its home position; the per-dot phases are derived from home
  coordinates so neighboring dots move similarly. Net effect: face stays
  recognizable, just feels alive — like a held breath in and out.

  Amplitude ~2.5 px in source coords. Rate ~0.4 Hz (one in/out per 2.5 s).
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face v11] neural-center missing'); return; }

    const faceCanvas = document.createElement('canvas');
    faceCanvas.id = 'faceCanvas';
    faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; opacity:0; transition:opacity 0.5s ease;';
    neuralCenter.appendChild(faceCanvas);

    const ctx = faceCanvas.getContext('2d');
    if (!ctx) {
      console.warn('[face v11] 2D context unavailable');
      neuralCenter.removeChild(faceCanvas);
      return;
    }

    if (orbCanvas && !orbCanvas.style.transition) {
      orbCanvas.style.transition = 'opacity 0.5s ease';
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

    // particles = { x: Float32Array, y: Float32Array, b: Float32Array,
    //               imgW, imgH, count }
    let particles = null;
    Promise.all([
      fetch('/zion-particle-meta.json').then(r => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-1.json').then(r => { if (!r.ok) throw new Error('part1 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-2.json').then(r => { if (!r.ok) throw new Error('part2 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-3.json').then(r => { if (!r.ok) throw new Error('part3 ' + r.status); return r.json(); }),
    ]).then(([meta, a, b, c]) => {
      const all = a.concat(b, c);
      const n = all.length;
      const xs = new Float32Array(n), ys = new Float32Array(n), bs = new Float32Array(n);
      // Per-dot phase offsets for the idle-breathing orbit. Derived from each
      // dot's home position so spatial coherence emerges — neighbors drift
      // together rather than each dot doing its own random jitter.
      const phA = new Float32Array(n), phB = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = all[i][0], y = all[i][1];
        xs[i] = x;
        ys[i] = y;
        bs[i] = all[i][2];
        phA[i] = Math.sin(x * 0.011 + y * 0.013) * 7;
        phB[i] = Math.cos(x * 0.013 + y * 0.011) * 7;
      }
      particles = {
        x: xs, y: ys, b: bs,
        phA: phA, phB: phB,
        imgW: meta.bbox.w,
        imgH: meta.bbox.h,
        count: n,
      };
      console.log('[face v11] loaded ' + n + ' stipple dots (bbox ' + meta.bbox.w + 'x' + meta.bbox.h + ')');
    }).catch(err => {
      console.warn('[face v11] particle data fetch failed:', err.message);
      if (faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
    });

    let phase = 'hidden';
    let phaseStart = performance.now();

    function frame() {
      const now = performance.now();
      const t   = (now - phaseStart) / 1000;
      const converse = !!window.__converseActive;

      if (phase === 'hidden' && converse && particles) {
        phase = 'entering';
        phaseStart = now;
        faceCanvas.style.opacity = '1';
        if (orbCanvas) orbCanvas.style.opacity = '0';
      } else if (phase === 'entering' && t > 0.6) {
        phase = 'live';
        phaseStart = now;
      } else if ((phase === 'entering' || phase === 'live') && !converse) {
        phase = 'exiting';
        phaseStart = now;
      } else if (phase === 'exiting' && t > 0.6) {
        phase = 'hidden';
        phaseStart = now;
        faceCanvas.style.opacity = '0';
        if (orbCanvas) orbCanvas.style.opacity = '1';
      }

      let alpha = 0;
      if (phase === 'entering')   alpha = Math.min(1, t / 0.6);
      else if (phase === 'live')  alpha = 1;
      else if (phase === 'exiting') alpha = Math.max(0, 1 - t / 0.6);

      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (!particles || alpha < 0.01) {
        requestAnimationFrame(frame);
        return;
      }

      // Tight face crop: fill ~95% of the smaller canvas dimension.
      const padding = 0.95;
      const scale = Math.min(w / particles.imgW, h / particles.imgH) * padding;
      const renderW = particles.imgW * scale;
      const renderH = particles.imgH * scale;
      const offX = (w - renderW) / 2;
      const offY = (h - renderH) / 2;

      // Small fixed dot size — true stipple grain regardless of canvas size.
      const dpr = window.devicePixelRatio || 1;
      const pSize = Math.max(1.0, 1.4 / dpr * dpr); // ~1.4 css px
      const half = pSize * 0.5;

      // Idle breathing: each dot orbits its home position. omega controls
      // breath rate, ampPx controls amplitude in source-pixel space (gets
      // scaled to canvas with everything else).
      const tSec = now * 0.001;
      const omega = 2 * Math.PI * 0.4;       // ~0.4 Hz, one breath per 2.5 s
      const ampPx = 2.5;                     // source-pixel amplitude
      const phaseT = tSec * omega;
      // Subtle global breath pulse — overall scale wobble of ~1.5% so the
      // whole head inhales/exhales, not just per-dot jitter.
      const breath = 1 + 0.015 * Math.sin(tSec * 2 * Math.PI * 0.25);
      const sX = scale * breath;
      const sY = scale * breath;
      const cX = offX + (particles.imgW * scale) * 0.5;
      const cY = offY + (particles.imgH * scale) * 0.5;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const xs = particles.x, ys = particles.y, bs = particles.b;
      const phA = particles.phA, phB = particles.phB;
      const n = particles.count;
      const sin = Math.sin;
      // Group draws by alpha bucket to amortize fillStyle changes.
      const BUCKETS = 8;
      for (let bk = 0; bk < BUCKETS; bk++) {
        const bMin = bk / BUCKETS;
        const bMax = (bk + 1) / BUCKETS;
        // Mid-bucket brightness maps to alpha; floor so faint dots still show.
        const aMul = 0.25 + 0.75 * ((bk + 0.5) / BUCKETS);
        ctx.fillStyle = 'rgba(0, 220, 240, ' + (0.55 * alpha * aMul).toFixed(3) + ')';
        for (let i = 0; i < n; i++) {
          const b = bs[i];
          if (b < bMin || b >= bMax) continue;
          const hx = xs[i], hy = ys[i];
          const dx = ampPx * sin(phaseT + phA[i]);
          const dy = ampPx * sin(phaseT + phB[i]);
          // Position around the centroid so the breath scale pulses outward
          // from the face center rather than the top-left of the bbox.
          const x = cX + (hx - particles.imgW * 0.5 + dx) * sX;
          const y = cY + (hy - particles.imgH * 0.5 + dy) * sY;
          ctx.fillRect(x - half, y - half, pSize, pSize);
        }
      }
      ctx.restore();

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    console.log('[face v11] stage 2 stipple + breathing init — fetching meta + 3 chunks');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
