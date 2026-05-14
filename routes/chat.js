/*
  Zion — Chat routes (POST / and POST /stream).
  Mode-toggle commands are detected upstream of the LLM call and
  short-circuit with an acknowledgment. Web search runs ahead of the
  LLM call when the message looks like a current-events / legal /
  factual question and Tavily is configured.
*/

const express = require('express');
const router = express.Router();
const { generateZionResponse, streamZionResponse } = require('../lib/anthropic');
const { getMemoriesForUser, storeMemory } = require('../lib/supabase');
const { governance } = require('../lib/claspion-governance');
const { requireAuth, requireOwner } = require('../middleware/auth');
const { getModes, setModes, detectModeCommand } = require('../lib/tiff-modes');
const { search: tavilySearch } = require('../lib/tavily');

const SAFE_REFUSAL =
  "I held back on this one. CLASPION flagged the action and I won't speak past my conscience. Tell me what you actually need and we'll try a different angle.";

// Triggers that mean Tiff wants current external info — legal updates,
// regulations, news. We run Tavily ahead of the LLM call and inject
// results into the system prompt via streamZionResponse options.
const SEARCH_TRIGGERS = /\b(current law|latest|today|this week|news|regulation|statute|legal|recent court|recently|2025|2026)\b/i;

async function maybeSearch(message) {
  if (!message || !SEARCH_TRIGGERS.test(message)) return null;
  try {
    return await tavilySearch(message);
  } catch (err) {
    console.warn('[CHAT] tavily search failed:', err.message);
    return null;
  }
}

async function gateAction(thought, intent) {
  return governance.validate({ thought, intent });
}

router.post('/', requireAuth, requireOwner, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.userId;

    console.log(`[CHAT] Processing message from ${userId}`);

    // Mode-toggle short-circuit: don't burn an LLM call to flip a flag.
    const cmd = detectModeCommand(message);
    if (cmd) {
      const next = await setModes(userId, cmd.updates);
      return res.json({
        message: cmd.ack,
        timestamp: new Date().toISOString(),
        modes: next,
        meta: { mode_toggle: true }
      });
    }

    const [memories, modes, searchResults] = await Promise.all([
      getMemoriesForUser(userId, 8).catch(() => []),
      getModes(userId),
      maybeSearch(message)
    ]);

    const response = await generateZionResponse(message, memories, {
      modes,
      searchResults
    });

    const verdict = await gateAction(
      { user_message: message, generated_response: response, memory_count: memories.length },
      { type: 'send_chat_response', target: userId, domain: 'conversation' }
    );

    if (!verdict.allow) {
      console.warn(`[CHAT] CLASPION blocked: reason="${verdict.reason}"`);
      return res.json({
        message: SAFE_REFUSAL,
        timestamp: new Date().toISOString(),
        governance: verdict
      });
    }

    res.json({
      message: response,
      timestamp: new Date().toISOString(),
      modes,
      governance: { decision: verdict.decision, dormant: !!verdict.dormant }
    });

    storeMemory(userId, `User: ${message}`, 'shared_history')
      .catch(e => console.error('Memory storage (user) failed:', e.message));
    storeMemory(userId, `Zion: ${response}`, 'shared_history')
      .catch(e => console.error('Memory storage (assistant) failed:', e.message));
  } catch (error) {
    console.error('[CHAT] Error:', error);
    res.status(500).json({ error: error.message || 'Unable to process your message' });
  }
});

router.post('/stream', requireAuth, requireOwner, async (req, res) => {
  const { message } = req.body;
  const userId = req.userId;

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const cmd = detectModeCommand(message);
    if (cmd) {
      const next = await setModes(userId, cmd.updates);
      const words = cmd.ack.split(' ');
      for (let i = 0; i < words.length; i++) {
        const token = words[i] + (i < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
        await new Promise(r => setTimeout(r, 30));
      }
      res.write(`data: ${JSON.stringify({ type: 'done', full_response: cmd.ack, modes: next, mode_toggle: true })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      return res.end();
    }

    const [memories, modes, searchResults] = await Promise.all([
      getMemoriesForUser(userId, 8).catch(() => []),
      getModes(userId),
      maybeSearch(message)
    ]);

    let full = '';
    await streamZionResponse(
      message || '',
      memories,
      { modes, searchResults },
      (token) => {
        full += token;
        res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
      }
    );

    const verdict = await gateAction(
      { user_message: message, generated_response: full, memory_count: memories.length },
      { type: 'send_chat_response', target: userId, domain: 'conversation' }
    );

    const finalText = verdict.allow ? full : SAFE_REFUSAL;

    res.write(`data: ${JSON.stringify({
      type: 'done',
      conversation_id: require('crypto').randomUUID(),
      full_response: finalText,
      modes,
      governance: { decision: verdict.decision, dormant: !!verdict.dormant }
    })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();

    storeMemory(userId, `User: ${message}`, 'shared_history')
      .catch(e => console.error('Memory storage (user) failed:', e.message));
    storeMemory(userId, `Zion: ${finalText}`, 'shared_history')
      .catch(e => console.error('Memory storage (assistant) failed:', e.message));
  } catch (error) {
    console.error('[STREAM] Error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  }
});

module.exports = router;
