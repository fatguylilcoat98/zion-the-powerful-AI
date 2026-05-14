/*
  Zion — Particle Face v9 (image-driven, Stage 1).

  New approach (per Chris's revised spec): instead of procedurally
  generating a head from imagined 3D anatomy (the v5-v8 dead ends),
  use Chris's reference image AS the source of truth. Each particle
  is sampled from a pixel in the image: its position is the pixel's
  x/y, its color is the pixel's RGB. Because the particles ARE the
  image, the visual match is guaranteed.

  Image source: /face-ref.dataurl — a text file containing the full
  data: URI for the reference PNG (base64 encoded). We fetch it
  at startup, instantiate an Image() from the data URI, then sample.

  STAGE 1 (this file):
    On CONVERSE entry:
      - Image draws at full opacity for ~0.5s as orientation
      - Particles fade in alongside the image (same positions)
      - Image fades out over 1s; particles remain
      - Particles are STATIC — no breathing, no lip sync yet
    Goal: verify particle field matches the reference visually.

  Stages 2-4 (later PRs, after Stage 1 sign-off):
    Stage 2: idle breathing (perlin drift around home position)
    Stage 3: audio-reactive lip sync (FFT → mouth/jaw)
    Stage 4: formation + dissipation animations

  Sampling:
    desktop:  every 4 px
    mobile:   every 6 px
    threshold: pixel luminance > 78/255

  Rendering:
    fillRect 2px squares with globalCompositeOperation='lighter'
    (additive blending) — overlapping particles brighten naturally,
    matching the dense crowded look in the reference.
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
    if (!ctx) { console.warn('[face v9] 2D context unavailable'); neuralCenter.removeChild(faceCanvas); return; }

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

    const img = new Image();
    let particles = null;

    img.onerror = () => {
      console.warn('[face v9] reference image failed to load');
      if (faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
    };

    img.onload = () => {
      try {
        const off = document.createElement('canvas');
        off.width  = img.width;
        off.height = img.height;
        const offCtx = off.getContext('2d');
        offCtx.drawImage(img, 0, 0);
        const pixels = offCtx.getImageData(0, 0, img.width, img.height).data;

        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        const STEP    = isMobile ? 6 : 4;
        const LUM_MIN = 78;

        const pts = [];
        const imgW = img.width, imgH = img.height;
        let jSeed = 1;
        function r() { jSeed = (jSeed * 9301 + 49297) % 233280; return jSeed / 233280; }

        for (let py = 0; py < imgH; py += STEP) {
          for (let px = 0; px < imgW; px += STEP) {
            const idx = (py * imgW + px) * 4;
            const rC = pixels[idx], gC = pixels[idx + 1], bC = pixels[idx + 2];
            const lum = 0.299 * rC + 0.587 * gC + 0.114 * bC;
            if (lum < LUM_MIN) continue;
            const jx = (r() - 0.5) * STEP * 0.5;
            const jy = (r() - 0.5) * STEP * 0.5;
            pts.push({ ix: px + jx, iy: py + jy, r: rC, g: gC, b: bC, lum: lum / 255 });
          }
        }
        particles = { pts, imgW, imgH };
        console.log('[face v9] sampled ' + pts.length + ' particles from ' + imgW + 'x' + imgH + ' (step=' + STEP + ')');
      } catch (e) {
        console.warn('[face v9] sampling threw:', e.message);
      }
    };

    fetch('/face-ref.dataurl')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(dataurl => { img.src = dataurl.trim(); })
      .catch(err => {
        console.warn('[face v9] /face-ref.dataurl fetch failed:', err.message);
        if (faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
      });

    let phase = 'hidden';
    let phaseStart = performance.now();
    let imageAlpha = 0;
    let particleAlpha = 0;

    function frame() {
      const now = performance.now();
      const t   = (now - phaseStart) / 1000;
      const converse = !!window.__converseActive;

      if (phase === 'hidden' && converse && particles) {
        phase = 'image-showing';
        phaseStart = now;
        faceCanvas.style.opacity = '1';
        if (orbCanvas) orbCanvas.style.opacity = '0';
      }
      else if (phase === 'image-showing' && t > 0.8) {
        phase = 'fading-out';
        phaseStart = now;
      }
      else if (phase === 'fading-out' && t > 1.0) {
        phase = 'particles-only';
        phaseStart = now;
      }
      else if ((phase === 'image-showing' || phase === 'fading-out' || phase === 'particles-only') && !converse) {
        phase = 'exiting';
        phaseStart = now;
      }
      else if (phase === 'exiting' && t > 0.6) {
        phase = 'hidden';
        phaseStart = now;
        faceCanvas.style.opacity = '0';
        if (orbCanvas) orbCanvas.style.opacity = '1';
      }

      if (phase === 'image-showing') {
        imageAlpha    = Math.min(1, t / 0.3);
        particleAlpha = Math.min(1, t / 0.3) * 0.85;
      } else if (phase === 'fading-out') {
        const u = Math.min(1, t / 1.0);
        imageAlpha    = 1 - u;
        particleAlpha = 0.85 + u * 0.15;
      } else if (phase === 'particles-only') {
        imageAlpha    = 0;
        particleAlpha = 1;
      } else if (phase === 'exiting') {
        const u = Math.min(1, t / 0.6);
        imageAlpha    = 0;
        particleAlpha = 1 - u;
      } else {
        imageAlpha = 0;
        particleAlpha = 0;
      }

      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (!particles) { requestAnimationFrame(frame); return; }

      const padding = 0.92;
      const scale   = Math.min(w / particles.imgW, h / particles.imgH) * padding;
      const renderW = particles.imgW * scale;
      const renderH = particles.imgH * scale;
      const offX    = (w - renderW) / 2;
      const offY    = (h - renderH) / 2;

      if (imageAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = imageAlpha;
        ctx.drawImage(img, offX, offY, renderW, renderH);
        ctx.restore();
      }

      if (particleAlpha > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const pts = particles.pts;
        const pSize = 1.8;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const x = offX + p.ix * scale;
          const y = offY + p.iy * scale;
          const a = p.lum * particleAlpha;
          ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a.toFixed(3) + ')';
          ctx.fillRect(x - pSize * 0.5, y - pSize * 0.5, pSize, pSize);
        }
        ctx.restore();
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    console.log('[face v9] stage 1 init complete — fetching /face-ref.dataurl');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
