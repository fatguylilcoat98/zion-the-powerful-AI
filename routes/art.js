/*
  Zion — Art route.
  Two endpoints:
    POST /api/art/generate { prompt }           — generate art directly
    POST /api/art/maybe-generate { transcript } — detect intent first;
                                                  returns generated:false
                                                  when no art intent.
*/

const express = require('express');
const router = express.Router();
const { requireAuth, requireOwner } = require('../middleware/auth');
const { generateArt, isArtRequest } = require('../lib/art-generator');

router.post('/generate', requireAuth, requireOwner, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'prompt required' });
    }
    const result = await generateArt({
      userId: req.userId,
      userMessage: prompt,
      source: 'chat',
    });
    if (!result.ok) {
      return res.status(502).json({
        ok: false,
        error_category: result.errorCategory,
        error_message: result.errorMessage,
        request_id: result.requestId,
      });
    }
    res.json(result);
  } catch (err) {
    console.error('[art] generate error:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/maybe-generate', requireAuth, requireOwner, async (req, res) => {
  try {
    const { transcript } = req.body || {};
    if (!transcript) return res.json({ generated: false, reason: 'empty_transcript' });
    if (!isArtRequest(transcript)) return res.json({ generated: false, reason: 'no_intent_detected' });
    const result = await generateArt({
      userId: req.userId,
      userMessage: transcript,
      source: 'chat-intercept',
    });
    if (!result.ok) {
      return res.json({
        generated: false,
        reason: 'generation_failed',
        error_category: result.errorCategory,
        error_message: result.errorMessage,
        request_id: result.requestId,
      });
    }
    return res.json({
      generated: true,
      request_id: result.requestId,
      image_url: result.imageUrl,
      audio_b64: result.audioB64,
      description: result.description,
      revised_prompt: result.revisedPrompt,
      model: result.model,
    });
  } catch (err) {
    console.error('[art] maybe-generate error:', err);
    res.status(500).json({ generated: false, reason: 'internal_error', error_message: err.message });
  }
});

module.exports = router;
