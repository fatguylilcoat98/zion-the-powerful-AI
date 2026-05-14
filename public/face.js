/*
  Zion — Particle Face v10 (stippling, Stage 1 redo).

  Per Chris's review: replace the old grid-sampled silhouette with a true
  stippled portrait. Particles are now rejection-sampled from the cropped
  face region of the reference, with density proportional to source
  brightness. No rings, no background — just the face.

  Data format (v2):
    /zion-particle-meta.json     -> { bbox: {w, h}, count, ... }
    /zion-particle-data-{1,2,3}.json -> arrays of [x, y, brightness]
                                        where x,y are in bbox-local pixels
                                        and brightness is 0..1.

  Stage 1 scope: static dots, fade in on CONVERSE entry, fade out on exit.
  Animation (breathing, lip sync, formation) lands in Stages 2-4.
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face v10] neural-center missing'); return; }

    const faceCanvas = document.createElement('canvas');
    faceCanvas.id = 'faceCanvas';
    faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; opacity:0; transition:opacity 0.5s ease;';
    neuralCenter.appendChild(faceCanvas);

    const ctx = faceCanvas.getContext('2d');
    if (!ctx) {
      console.warn('[face v10] 2D context unavailable');
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
      for (let i = 0; i < n; i++) {
        xs[i] = all[i][0];
        ys[i] = all[i][1];
        bs[i] = all[i][2];
      }
      particles = {
        x: xs, y: ys, b: bs,
        imgW: meta.bbox.w,
        imgH: meta.bbox.h,
        count: n,
      };
      console.log('[face v10] loaded ' + n + ' stipple dots (bbox ' + meta.bbox.w + 'x' + meta.bbox.h + ')');
    }).catch(err => {
      console.warn('[face v10] particle data fetch failed:', err.message);
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

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const xs = particles.x, ys = particles.y, bs = particles.b;
      const n = particles.count;
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
          const x = offX + xs[i] * scale;
          const y = offY + ys[i] * scale;
          ctx.fillRect(x - half, y - half, pSize, pSize);
        }
      }
      ctx.restore();

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    console.log('[face v10] stage 1 stipple init — fetching meta + 3 chunks');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
