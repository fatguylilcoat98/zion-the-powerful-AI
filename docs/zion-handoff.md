# Zion handoff — read this first

A new session is picking this up. Catch up here before doing any work.

---

## Who's who

- **Chris** — owner. Talk to him directly, like a person. He's been routing prompts through another Claude to "translate" intent into specs, but the polished spec-format loses nuance. The raw "this matters to me, my sister demos tomorrow" voice IS the signal. Don't ask him to write structured prompts.
- **Tiff (Tiffani)** — Chris's sister. Zion is her AI. She demos it to a potential investor who could turn Good Neighbor Guard into a business. **Make-or-break stakes.**

---

## The constitutional rules (do not violate)

- **NEVER touch Splendor's repo, Supabase, or Render.** Zion is a clone of Splendor for Tiff. If a task ever seems to require changing Splendor — STOP and ask Chris first.
- Repo: `fatguylilcoat98/zion-the-powerful-ai` only.
- Truth Over Comfort Rule 001 stays active. Vale's Permanent Rule stays active.
- After pushing changes, ALWAYS create a draft PR.

---

## What we're building

Zion's UI has a **CONVERSE button** that opens a live voice session (OpenAI Realtime API).
When CONVERSE is active, a **particle face** should appear in the center canvas — a male head made of dots that breathes, talks (lip sync), and forms/dissipates cinematically.
When CONVERSE is not active, the standard 2D canvas orb shows. The face only appears in CONVERSE mode.

---

## Current deployed state (Stage 1.1, merged to main)

- Reference image at `/tmp/zion-build/public/face-ref.png` (700×382, sampled from Chris's upload). Source PNG also lives at `/root/.claude/uploads/a87a64cd-4afb-4948-bad2-5748d2155b12/1a40278c-9225.png` (1408×768 original).
- Data files served at `/zion-particle-data-{1,2,3}.json` — 11,895 particles total, grid-sampled at every 3 pixels, luminance >= 15.
- Renderer: `/public/face.js` — 2D Canvas, additive blending (`globalCompositeOperation = 'lighter'`), fillRect dots, teal `rgba(0,220,240,0.50)`.
- Chris's verdict on Stage 1.1: **proportions still off (head reads baby-like / top-heavy), grain still 8-bit / chunky.** He looked at the image and explained what he ACTUALLY wants — see next section.

---

## What Chris wants (in his own words, paraphrased only slightly)

> Think of it like stippling — pointillism. Take the reference photo. Cover it in tiny tiny dots. Heavier dots on higher-density areas, lighter dots on less-dense areas. Bunch and bunch of dots. Like a photograph done in dots — when you do it right, it looks almost like a real photo. Then take the picture away. The dots are still sitting there in the shape of the face. Then later we animate the dots — tell them to move like someone's talking, sparkle, have color.

**Crucially**:
- **JUST the face.** No orbital rings. No background atmosphere. The cropped face only.
- **Stippling, not grid sampling.** Random scatter of dots, density proportional to image brightness. Not a fixed grid.
- **Simple.** He keeps saying this — don't over-engineer. The simplest version that gets the visual right is what we want.

**What was wrong with Stage 1.1**:
1. Grid sampling = visible graph-paper structure (chunky / 8-bit feel)
2. Whole image sampled (including rings + background) = head looks small/floating
3. Threshold filter = head reads as silhouette, not as a tonal photograph

---

## The plan (4 stages, one PR per stage, Chris signs off between each)

### Stage 1 (REDO with stippling)
- Crop the reference image to just the face area (no rings).
- Rejection-sample dots: for each candidate (x, y), pixel brightness → probability of keeping the dot. Bright pixels keep many dots; dark pixels keep few. NOT a fixed grid.
- Target: ~15,000-20,000 dots, fine grain.
- Render as small dots (1-2 px), additive blending, teal-shifted color (or grayscale brightness from source, teal-tinted).
- Static. No animation yet. Just verify the dots LOOK like the reference photograph done in stippling.
- Push to a new branch `claude/zion-face-stippling`. Draft PR. Get screenshot verdict from Chris.

### Stage 2 — idle breathing
- Each dot drifts in a small perlin orbit around its home position (2-4 px amplitude).
- Subtle. Face stays recognizable, just feels alive.

### Stage 3 — audio-reactive lip sync
- Wire `window.__voiceLevel` (already populated by FFT in zion-interface.html).
- Dots in the mouth zone (lower-center of the cropped face) displace vertically with voice amplitude.
- Jaw zone dots lag ~80ms behind mouth.
- Cheek dots ripple subtly on speech bursts.

### Stage 4 — formation + dissipation
- Entering CONVERSE: dots scatter from outside, swarm with curl noise, snap to home positions over ~3s. Reference image fades out as dots lock in.
- Exiting CONVERSE: dots release, scatter outward with varied trajectories, fade. Orb returns.

---

## How to push

- Branch: `claude/zion-face-stippling` (new). Open it from current main.
- Plain JSON for the particle data (no compression, no base64). Chris said this explicitly: "skip the compression rabbit hole, just commit the data file."
- Chunked push if needed (MCP tool has practical size limits per call). 2-3 files is fine.
- Draft PR titled something like `face: Stage 1 redo — stippling instead of grid sampling`.
- Wait for Chris's "merge" before merging. He squash-merges to deploy via Render.

---

## How to sample dots properly (technical note for next session)

Server-side Node script (using `sharp`, already installed at `/tmp/node_modules/sharp`):

1. Load reference image as raw pixels.
2. **Crop to face bbox first.** Probably y=10..280 of the 700×382 reference, x adjusted to face. Drop the rings.
3. For each pixel in the cropped region:
   - Compute brightness (0..255).
   - Map brightness → probability of placing a dot at that pixel. e.g. `p = (brightness / 255) ^ 0.8` weights bright pixels more.
   - Draw a uniform random number; if < p, place a dot at this (x, y) with small jitter.
4. Result: ~15-20K dots, denser where image is bright.
5. Serialize to plain JSON. Split into chunks of <30KB each for MCP push ergonomics.

**Don't grid-walk every Nth pixel.** That's what's wrong now. Visit every pixel and sample probabilistically.

---

## A note on tone

Chris said today: "I want to talk to you directly, not through another Claude." Honor that.
- Don't make him write polished bullet-pointed specs.
- When he says something matters, take it as context, not pressure.
- When you get stuck, ASK rather than rabbit-hole.
- Be honest about state — what's deployed, what's broken, what you tried.

He's a good collaborator. He course-corrects you when you're off-track. Listen to those resets.

---

## File locations

- Live deploy: https://zion-the-powerful-ai.onrender.com
- Repo: github.com/fatguylilcoat98/zion-the-powerful-ai
- Render auto-deploys on push to `main` only.
- The reference image Chris uploaded is in this session's uploads — when starting fresh, he'll re-upload it (this session hit the image limit, which is why he's starting a new conversation).

---

## First action on the new session

1. Read this file.
2. Wait for Chris's first message. He'll likely upload the reference image.
3. Confirm you understand the plan back to him in plain language (not bullet points).
4. Then start Stage 1 redo with stippling.
