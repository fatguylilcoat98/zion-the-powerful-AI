/*
  Zion — Email route.
  User-triggered email: "email me about X" / "send me an email".
*/

const express = require('express');
const { requireAuth, requireOwner } = require('../middleware/auth');
const { checkAndCommit } = require('../middleware/email-rate-limit');
const { proactiveCommunication } = require('../lib/proactive-communication');

const router = express.Router();

const INTENT_PATTERNS = [
  /\b(?:email|e-?mail)\s+me\b(?:\s+(?:about|on|with|regarding|the)\s+(.+?))?[.?!]*$/i,
  /\b(?:send|shoot)\s+(?:me\s+)?(?:an?\s+)?(?:email|e-?mail|note)\b(?:\s+(?:about|on|regarding|with)\s+(.+?))?[.?!]*$/i,
  /\b(?:email|send)\s+(?:this|that)\b(?:\s+(?:to\s+me|in\s+(?:an?\s+)?email))?[.?!]*$/i,
];

function detectIntent(text) {
  if (!text || typeof text !== 'string') return { matched: false, topic: null };
  const cleaned = text.trim();
  for (const re of INTENT_PATTERNS) {
    const m = cleaned.match(re);
    if (m) {
      const topic = (m[1] || '').trim();
      return { matched: true, topic: topic.length ? topic : null };
    }
  }
  return { matched: false, topic: null };
}

function deriveSubject(topic) {
  if (!topic) return 'Recap from our conversation';
  const truncated = topic.replace(/\s+/g, ' ').slice(0, 70).trim();
  if (!truncated) return 'Recap from our conversation';
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

async function sendEmailForIntent(userId, intent, opts = {}) {
  const rate = checkAndCommit(userId);
  if (!rate.allowed) {
    return { sent: false, rate_limited: true, limit: rate.limit, retry_after_seconds: rate.retry_after_seconds };
  }
  const conversationContext = (opts.conversation_context || '').trim();
  const content = intent.topic
    ? `Write Tiff a clear, useful email about: ${intent.topic}. Pull from anything you already remember about this. Keep it tight and direct, like a colleague's note.`
    : (conversationContext
        ? `Summarize what we were just discussing into a short, useful email Tiff can refer to later:\n\n${conversationContext.slice(0, 4000)}`
        : 'Brief check-in note from our recent conversation.');
  const subject = deriveSubject(intent.topic);
  try {
    const result = await proactiveCommunication.sendProactiveMessage(userId, {
      type: 'update', subject, content, priority: 2,
      context: { trigger: 'on_command', source: opts.source || 'unknown', has_topic: !!intent.topic },
      deliveryMethod: 'email',
    });
    if (!result || result.success === false) {
      return { sent: false, error: (result && result.error) || 'send_failed' };
    }
    rate.commit();
    return { sent: true, subject };
  } catch (err) {
    console.error('[email] sendEmailForIntent error:', err);
    return { sent: false, error: err.message };
  }
}

router.post('/send-on-command', requireAuth, requireOwner, async (req, res) => {
  try {
    const { transcript, source = 'chat', conversation_context = '' } = req.body || {};
    const intent = detectIntent(transcript);
    if (!intent.matched) return res.json({ sent: false, reason: 'no_intent_detected' });
    const result = await sendEmailForIntent(req.userId, intent, { source, conversation_context });
    if (result.rate_limited) {
      return res.status(429).json({ error: 'rate_limit', limit: result.limit, retry_after_seconds: result.retry_after_seconds });
    }
    if (!result.sent) return res.status(502).json({ sent: false, error: result.error });
    return res.json(result);
  } catch (err) {
    console.error('[email] send-on-command error:', err);
    return res.status(500).json({ sent: false, error: 'internal_error', message: err.message });
  }
});

router.post('/test', requireAuth, requireOwner, async (req, res) => {
  try {
    const result = await proactiveCommunication.sendTestMessage(req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.detectEmailIntent = detectIntent;
module.exports.sendEmailForIntent = sendEmailForIntent;
