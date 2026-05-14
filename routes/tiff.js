/*
  Zion — Tiff mode endpoints.

  GET  /api/tiff/modes          — current tone / list_mode / grammar
  POST /api/tiff/modes          — partial update (any subset of fields)

  The chat route also detects mode-toggle commands in natural language
  ("switch to work mode", "list mode", "proofread this") and persists
  via the same lib/tiff-modes helpers — this route is for direct UI
  control (toggle switches in the panel).
*/

const express = require('express');
const router = express.Router();
const { requireAuth, requireOwner } = require('../middleware/auth');
const { getModes, setModes, DEFAULTS } = require('../lib/tiff-modes');

router.get('/modes', requireAuth, requireOwner, async (req, res) => {
  const modes = await getModes(req.userId);
  res.json({ modes, defaults: DEFAULTS });
});

router.post('/modes', requireAuth, requireOwner, async (req, res) => {
  const { tone, list_mode, grammar } = req.body || {};
  const updates = {};
  if (typeof tone === 'string') updates.tone = tone;
  if (typeof list_mode === 'boolean') updates.list_mode = list_mode;
  if (typeof grammar === 'boolean') updates.grammar = grammar;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided. Expected tone/list_mode/grammar.' });
  }

  const next = await setModes(req.userId, updates);
  if (!next) return res.status(500).json({ error: 'Failed to save modes' });
  res.json({ modes: next });
});

module.exports = router;
