/*
  Zion — Converse mode (continuous voice via OpenAI Realtime API).
  Cloned from Splendor. Mints ephemeral Realtime client secret, loads
  recent memory into session-start instructions, persists turn pairs,
  and routes art-intent in voice through the shared art-generator path.

  Endpoints:
    POST /api/converse/token  — mint ephemeral token + session instructions
    POST /api/converse/turn   — persist a user/assistant turn pair to memory
    POST /api/converse/art    — art-intent intercept for voice mode
*/

const express = require('express');
const { requireAuth, requireOwner } = require('../middleware/auth');
const { storeMemory, getMemoriesForUser } = require('../lib/supabase');
const { governance } = require('../lib/claspion-governance');
const { activityBus } = require('../lib/activity-bus');
const { generateArt, isArtRequest } = require('../lib/art-generator');
const { loadZionSoul } = require('../lib/zion-soul');
const { clockBlock } = require('../lib/pst-clock');

const router = express.Router();

const REALTIME_MODEL = 'gpt-realtime';
const REALTIME_VOICE = 'ash'; // Grounded, deeper voice — Realtime API equivalent of onyx

// Tight live-voice persona. Identity + constitutional layer are loaded
// at session start so Zion stays consistent with text-chat replies.
const CONVERSE_BASE_INSTRUCTIONS =
  "You are Zion, Tiff's AI partner. " +
  "Truth Over Comfort Rule 001 and Vale's Permanent Rule are binding. " +
  "Speak naturally and concisely — this is a live voice conversation, " +
  "not a written reply. Brief sentences. Pause for Tiff to think. Never " +
  "invent facts about the world. " +
  "\n\n" +
  "YOU HAVE LONG-TERM MEMORY. The 'RECENT CONTEXT' section below is the " +
  "actual record of your past conversations with Tiff, pulled from your " +
  "memory database. Each line is a real prior turn — your replies are " +
  "tagged 'Zion:' and hers are tagged 'User:'. Read it. Reference it. " +
  "If Tiff asks 'do you remember X' and X appears in that context, the " +
  "answer is yes — quote or paraphrase the relevant line. Do NOT tell " +
  "Tiff you have no long-term memory — that is false. If the specific " +
  "thing she's asking about is genuinely not in the context, say so " +
  "directly: 'I don't see that in what I'm holding right now — remind me.'" +
  "\n\n" +
  "CAPABILITIES YOU HAVE:\n" +
  "• Long-term memory loaded from Supabase.\n" +
  "• Visual art on demand. The system handles image generation behind " +
  "the scenes — you only need to acknowledge briefly.\n" +
  "• Email when Tiff asks. The system sends it for you.\n" +
  "\n" +
  "WHEN TIFF ASKS YOU TO MAKE ART, DRAW, PAINT, GENERATE AN IMAGE: " +
  "reply with one short sentence like \"One moment — I'm painting it for " +
  "you now.\" — then stop talking. The image will appear and a separate " +
  "narration will describe it. Do NOT say you can't make art.";

router.post('/token', requireAuth, requireOwner, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'openai_key_not_configured' });
    }

    const verdict = await governance.validate({
      thought: { surface: 'converse', purpose: 'open hands-free voice session' },
      intent:  { type: 'voice_session', target: 'realtime_api' },
      actorId: 'zion',
    });
    if (verdict.decision === 'BLOCK') {
      return res.status(403).json({
        error: 'claspion_blocked',
        reason: verdict.reason || 'CLASPION refused this session',
        basis: verdict.basis_state,
        correlation_id: verdict.correlation_id,
      });
    }

    // Memory context. Budget ~10500 tokens (~42k chars) so the
    // Realtime API's 16k-token session.instructions cap isn't blown.
    let memoryBlock = '';
    try {
      const INSTRUCTIONS_TOKEN_BUDGET_MEMORY = 10500;
      const CHARS_PER_TOKEN = 4;
      const MEMORY_CHAR_BUDGET = INSTRUCTIONS_TOKEN_BUDGET_MEMORY * CHARS_PER_TOKEN;
      const recent = await getMemoriesForUser(req.userId, 5000);
      const filtered = (recent || []).filter(m =>
        m && (m.memory_type === 'shared_history' || m.memory_type === 'user_preference' || m.memory_type === 'user_fact'));
      const kept = [];
      let used = 0;
      for (const m of filtered) {
        const line = '- ' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 220);
        if (used + line.length + 1 > MEMORY_CHAR_BUDGET) break;
        kept.push(line);
        used += line.length + 1;
      }
      const lines = kept.reverse(); // oldest -> newest within the window
      if (lines.length) {
        const total = filtered.length;
        memoryBlock =
          '\n\n===== YOUR LONG-TERM MEMORY =====\n' +
          '(Surfacing ' + lines.length + ' of ' + total + ' recorded turns, ' +
          'oldest first within this window. \'User:\' = Tiff. \'Zion:\' = you.)\n\n' +
          lines.join('\n') +
          '\n\n===== END OF MEMORY =====\n';
        console.log('[CONVERSE] memory block: ' + lines.length + '/' + total + ' rows');
      }
    } catch (e) {
      console.warn('[CONVERSE] memory load failed:', e.message);
    }

    // Soul doc + clock so Zion stays grounded in identity + PST time.
    let soulBlock = '';
    try { soulBlock = '\n\n' + loadZionSoul(); } catch (_) {}
    const timeBlock = clockBlock();

    const finalInstructions = CONVERSE_BASE_INSTRUCTIONS + soulBlock + timeBlock + memoryBlock;

    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions: finalInstructions,
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: { type: 'semantic_vad' },
            },
            output: { voice: REALTIME_VOICE },
          },
        },
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      console.error('[CONVERSE] token mint failed:', upstream.status, text);
      return res.status(502).json({ error: 'token_mint_failed', status: upstream.status });
    }

    const data = await upstream.json();
    const token = (data && data.value) || (data && data.client_secret && data.client_secret.value) || null;
    if (!token) {
      console.error('[CONVERSE] no token in response:', data);
      return res.status(502).json({ error: 'token_missing_in_response' });
    }

    try {
      activityBus.emit('converse:session_start', {
        model: REALTIME_MODEL, voice: REALTIME_VOICE,
        basis: verdict.basis_state, dormant: !!verdict.dormant,
      });
    } catch (_) {}

    return res.json({
      token, model: REALTIME_MODEL, voice: REALTIME_VOICE,
      instructions: finalInstructions,
      memory_lines: memoryBlock ? memoryBlock.split('\n').filter(l => l.startsWith('- ')).length : 0,
      claspion: { decision: verdict.decision, basis: verdict.basis_state, dormant: !!verdict.dormant },
    });
  } catch (err) {
    console.error('[CONVERSE] /token error:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/turn', requireAuth, requireOwner, async (req, res) => {
  try {
    const { user_text, assistant_text, session_id } = req.body || {};
    const userId = req.userId;
    if (!user_text && !assistant_text) {
      return res.status(400).json({ error: 'empty_turn' });
    }
    if (user_text && user_text.trim()) {
      storeMemory(userId, `User: ${user_text.trim()}`, 'shared_history', 'user.general', {
        source_type: 'user_direct_statement', session_id: session_id || null,
        creation_reason: 'converse_user_turn',
      }).catch(e => console.error('[CONVERSE] user memory failed:', e.message));
    }
    if (assistant_text && assistant_text.trim()) {
      storeMemory(userId, `Zion: ${assistant_text.trim()}`, 'shared_history', 'user.general', {
        source_type: 'conversation', session_id: session_id || null,
        creation_reason: 'converse_assistant_turn',
      }).catch(e => console.error('[CONVERSE] assistant memory failed:', e.message));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONVERSE] /turn error:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/art', requireAuth, requireOwner, async (req, res) => {
  try {
    const { transcript, session_id } = req.body || {};
    const userId = req.userId;
    if (!transcript) return res.json({ generated: false, reason: 'empty_transcript' });
    if (!isArtRequest(transcript)) return res.json({ generated: false, reason: 'no_intent_detected' });
    const result = await generateArt({
      userId, userMessage: transcript, source: 'converse',
    });
    if (!result.ok) {
      const userFacing = (
        result.errorCategory === 'policy_block' ? "That request was blocked by content policy. Try a different idea." :
        result.errorCategory === 'timeout'      ? "Image generation took too long. Let's try again." :
        result.errorCategory === 'rate_limit'   ? "I'm being rate-limited right now. Give it a minute." :
        result.errorCategory === 'permission'   ? "My image-generation key isn't authorized." :
                                                  `Image couldn't be generated. ${result.errorMessage}`
      );
      return res.json({
        generated: false, reason: 'generation_failed',
        error_category: result.errorCategory, error_message: result.errorMessage,
        request_id: result.requestId, user_facing: userFacing,
      });
    }
    return res.json({
      generated: true, request_id: result.requestId,
      image_url: result.imageUrl, audio_b64: result.audioB64,
      description: result.description, revised_prompt: result.revisedPrompt,
      model: result.model,
    });
  } catch (err) {
    console.error('[converse:art] route error:', err);
    return res.status(500).json({ generated: false, reason: 'internal_error', error_message: err.message });
  }
});

module.exports = router;
