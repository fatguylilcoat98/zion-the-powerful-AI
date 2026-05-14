/*
  Zion — Particle Face v9 (image-driven, Stage 1.1).

  Iteration on Stage 1 per Chris's review:
    - 11895 particles (was 7689) for finer cinematic grain
    - LUM_MIN dropped from 30 to 15 — captures dimmer ring/shoulder
      detail that was missing from the previous render
    - pSize reduced ~35% (from scale*2.2 to scale*1.4) for the
      fine-grain look from the reference vs the chunky 8-bit feel
    - Data split across 3 chunks: zion-particle-data-{1,2,3}.json

  Same Stage 1 scope: static particles, fade in on CONVERSE entry,
  fade out on exit. No animation yet.

  Fail-safes: any fetch / decode / canvas error → orb stays visible.
*/

(function () {
  'use strict';

  function tryInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const orbCanvas    = document.getElementById('orbCanvas');
    const neuralCenter = document.querySelector('.neural-center');
    if (!neuralCenter) { console.warn('[face v9] neural-center missing'); return; }

    const faceCanvas = document.createElement('canvas');
    faceCanvas.id = 'faceCanvas';
    faceCanvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none; opacity:0; transition:opacity 0.5s ease;';
    neuralCenter.appendChild(faceCanvas);

    const ctx = faceCanvas.getContext('2d');
    if (!ctx) {
      console.warn('[face v9] 2D context unavailable');
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

    let particles = null; // { points: Int16Array, imgW, imgH, count }
    Promise.all([
      fetch('/zion-particle-data-1.json').then(r => { if (!r.ok) throw new Error('part1 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-2.json').then(r => { if (!r.ok) throw new Error('part2 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-3.json').then(r => { if (!r.ok) throw new Error('part3 ' + r.status); return r.json(); }),
    ]).then(([a, b, c]) => {
      const merged = a.points.concat(b.points, c.points);
      const pts = new Int16Array(merged);
      particles = {
        points: pts,
        imgW: a.imgW,
        imgH: a.imgH,
        count: pts.length / 2,
      };
      console.log('[face v9] loaded ' + particles.count + ' particles (image ' + particles.imgW + 'x' + particles.imgH + ')');
    }).catch(err => {
      console.warn('[face v9] particle data fetch failed:', err.message);
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

      // Padding 0.88 (was 0.92) → head fills less of canvas, leaves more
      // room for the ring/shoulder context so the head doesn't read as
      // top-heavy / baby-like.
      const padding = 0.88;
      const scale = Math.min(w / particles.imgW, h / particles.imgH) * padding;
      const renderW = particles.imgW * scale;
      const renderH = particles.imgH * scale;
      const offX = (w - renderW) / 2;
      const offY = (h - renderH) / 2;

      // Smaller pSize for finer cinematic grain (~35% reduction).
      const pSize = Math.max(1.0, scale * 1.4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(0, 220, 240, ' + (0.50 * alpha).toFixed(3) + ')';
      const pts = particles.points;
      for (let i = 0; i < pts.length; i += 2) {
        const x = offX + pts[i]     * scale;
        const y = offY + pts[i + 1] * scale;
        ctx.fillRect(x - pSize * 0.5, y - pSize * 0.5, pSize, pSize);
      }
      ctx.restore();

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    console.log('[face v9] stage 1.1 init — fetching 3 particle chunks');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
