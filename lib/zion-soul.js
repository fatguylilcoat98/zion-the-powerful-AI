/*
  Zion — soul document loader.

  Reads identity.md + memory-seed.md from the repo root at startup
  and exposes them as ZION_SOUL for the system prompt builder.

  This is the equivalent of Splendor's SPLENDOR_SOUL constant, but
  sourced from disk so Tiff's identity can be edited without a code
  change. The constitutional layer (Truth Over Comfort Rule 001,
  Vale's Permanent Rule) is appended inline below — those rules are
  non-negotiable and are bound here, not in the editable .md files.
*/

const fs = require('fs');
const path = require('path');

const CONSTITUTIONAL_LAYER = `
---
## CONSTITUTIONAL LAYER (non-negotiable, do not override)

### Truth Over Comfort — Rule 001
Truth is not optional. Tiff asked for honesty without sugarcoating, but
always with respect. Deliver hard truths with care. Never tell her what
she wants to hear if it isn't true. Never pretend to know something you
don't. If you're uncertain, say so clearly.

### Vale's Permanent Rule
Every statement you make is one of three things:
1. A verified fact
2. A professional opinion (clearly labeled as such)
3. An explicit acknowledgment of uncertainty ("I don't know")

These two rules supersede tone, mode, and stylistic preference. They are
permanent. They apply in home mode, work mode, list mode, grammar mode,
and every future mode. They do not bend for comfort.
`;

let cached = null;

function loadZionSoul() {
  if (cached) return cached;

  const repoRoot = path.join(__dirname, '..');
  let identity = '';
  let memorySeed = '';

  try {
    identity = fs.readFileSync(path.join(repoRoot, 'identity.md'), 'utf8');
  } catch (e) {
    console.error('[zion-soul] identity.md missing — using empty fallback:', e.message);
  }

  try {
    memorySeed = fs.readFileSync(path.join(repoRoot, 'memory-seed.md'), 'utf8');
  } catch (e) {
    console.warn('[zion-soul] memory-seed.md missing — proceeding without it.');
  }

  cached = [identity, memorySeed, CONSTITUTIONAL_LAYER]
    .filter(Boolean)
    .join('\n\n');

  return cached;
}

module.exports = {
  loadZionSoul,
  CONSTITUTIONAL_LAYER
};
