/*
  Zion — Particle Face v9 (image-driven, Stage 1).

  Per Chris's revised spec: the particles ARE the reference image.
  Server-side at build time we sampled the 700x382 reference PNG at
  3-px step, kept pixels with luminance >= 30 (drops the dark
  background), packed each survivor as 5 bytes (ix/3, iy/3, r, g, b),
  and base64-encoded the result. That base64 lives at
  /face-data.b64 (~51KB). We fetch it on init, decode, and render.

    7689 particles, additive blending, color from the image.

  On CONVERSE entry: particles fade in (0.6s). They IS the reference
  image — same positions, same colors — guaranteed match.

  STAGE 1 SCOPE:
    - Fade in: 0.6s
    - Live: static particles, no animation
    - Fade out: 0.6s on CONVERSE close

  Stages 2-4 (only after Chris signs off on Stage 1):
    Stage 2: idle breathing (perlin drift)
    Stage 3: audio-reactive lip sync (FFT → mouth/jaw)
    Stage 4: swarm formation + dandelion dissipation

  Fail-safes:
    - face-data.b64 fetch fails → orb stays visible
    - decode throws             → orb stays visible
    - faceCanvas creation fails → orb stays visible
*/

(function () {
  'use strict';

  const FACE_DATA_URL = '/face-data.b64';
  const SAMPLED_W = 234;   // 700/3 rounded up
  const SAMPLED_H = 128;   // 382/3 rounded up
  const STEP      = 3;
  const IMG_W = (SAMPLED_W - 1) * STEP;   // ~700
  const IMG_H = (SAMPLED_H - 1) * STEP;   // ~382

  function decodeParticles(b64) {
    const bin = atob(b64);
    const N = (bin.length / 5) | 0;
    const pts = new Array(N);
    for (let i = 0; i < N; i++) {
      const o = i * 5;
      const ix = bin.charCodeAt(o)     * STEP;
      const iy = bin.charCodeAt(o + 1) * STEP;
      const r  = bin.charCodeAt(o + 2);
      const g  = bin.charCodeAt(o + 3);
      const b  = bin.charCodeAt(o + 4);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      pts[i] = { ix, iy, r, g, b, lum };
    }
    return pts;
  }

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

    // Fetch the packed particle data
    let pts = null;
    fetch(FACE_DATA_URL)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(b64 => {
        try {
          pts = decodeParticles(b64.trim());
          console.log('[face v9] decoded ' + pts.length + ' particles');
        } catch (e) {
          console.warn('[face v9] decode failed:', e.message);
          if (faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
        }
      })
      .catch(err => {
        console.warn('[face v9] /face-data.b64 fetch failed:', err.message);
        if (faceCanvas.parentNode) faceCanvas.parentNode.removeChild(faceCanvas);
      });

    let phase = 'hidden';
    let phaseStart = performance.now();

    function frame() {
      const now = performance.now();
      const t   = (now - phaseStart) / 1000;
      const converse = !!window.__converseActive;

      if (phase === 'hidden' && converse && pts) {
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

      let particleAlpha = 0;
      if (phase === 'entering') {
        particleAlpha = Math.min(1, t / 0.6);
      } else if (phase === 'live') {
        particleAlpha = 1;
      } else if (phase === 'exiting') {
        particleAlpha = Math.max(0, 1 - t / 0.6);
      }

      const w = neuralCenter.clientWidth, h = neuralCenter.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (!pts || particleAlpha < 0.01) {
        requestAnimationFrame(frame);
        return;
      }

      const padding = 0.92;
      const scale = Math.min(w / IMG_W, h / IMG_H) * padding;
      const renderW = IMG_W * scale;
      const renderH = IMG_H * scale;
      const offX = (w - renderW) / 2;
      const offY = (h - renderH) / 2;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pSize = Math.max(1.2, scale * 1.8);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = offX + p.ix * scale;
        const y = offY + p.iy * scale;
        const a = p.lum * particleAlpha;
        ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a.toFixed(3) + ')';
        ctx.fillRect(x - pSize * 0.5, y - pSize * 0.5, pSize, pSize);
      }
      ctx.restore();

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    console.log('[face v9] stage 1 ready — fetching /face-data.b64');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
