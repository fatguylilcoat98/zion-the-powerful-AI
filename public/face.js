/*
  Zion — Particle Face v9 (image-driven, Stage 1).

  Per Chris's revised spec: the particles ARE the reference image.
  Server-side at build time we sampled the 700x382 reference PNG at
  3-px step, kept pixels with luminance >= 30 (drops background),
  serialized the (x, y) positions to plain JSON. 7689 particles
  split into two files (zion-particle-data-1.json + -2.json) for
  push-tool ergonomics.

  STAGE 1 SCOPE (this file):
    On CONVERSE entry:
      - Particles fade in over 0.6s at their home positions.
      - Particles are STATIC — no breathing, no lip sync yet.
    Goal: verify the particle field visually matches the reference.

  Stages 2-4 (each as its own PR after Chris's sign-off):
    Stage 2: idle breathing (perlin drift around home position)
    Stage 3: audio-reactive lip sync (FFT → mouth/jaw zones)
    Stage 4: swarm formation + dandelion dissipation

  Rendering: Canvas2D, fillRect 2px squares with additive blending.
  Color: teal (matches reference image palette).
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

    // Fetch both chunks in parallel and concatenate.
    let particles = null; // { points: Int16Array, imgW, imgH, count }
    Promise.all([
      fetch('/zion-particle-data-1.json').then(r => { if (!r.ok) throw new Error('part1 ' + r.status); return r.json(); }),
      fetch('/zion-particle-data-2.json').then(r => { if (!r.ok) throw new Error('part2 ' + r.status); return r.json(); }),
    ]).then(([a, b]) => {
      const merged = a.points.concat(b.points);
      // Cast to Int16Array for tighter memory + faster access.
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

      // Fit the image-space coords into the canvas with light padding,
      // preserving aspect.
      const padding = 0.92;
      const scale = Math.min(w / particles.imgW, h / particles.imgH) * padding;
      const renderW = particles.imgW * scale;
      const renderH = particles.imgH * scale;
      const offX = (w - renderW) / 2;
      const offY = (h - renderH) / 2;

      const pSize = Math.max(1.4, scale * 2.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Slightly varied teal — additive blending makes overlaps brighten.
      ctx.fillStyle = 'rgba(0, 220, 240, ' + (0.55 * alpha).toFixed(3) + ')';
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
    console.log('[face v9] stage 1 init — fetching particle data');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
