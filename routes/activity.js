/*
  Zion — Activity SSE stream.
  Live system events for the orb rings and CLASPION header ticker.
  Auth via ?access_token query param (EventSource can't send headers).
  Allowlists both ZION_OWNER_EMAIL and ZION_ADMIN_EMAIL.
*/

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { activityBus } = require('../lib/activity-bus');

const router = express.Router();

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

function allowedEmails() {
  const owner = (process.env.ZION_OWNER_EMAIL || '').trim().toLowerCase();
  const admin = (process.env.ZION_ADMIN_EMAIL || '').trim().toLowerCase();
  return [owner, admin].filter(Boolean);
}

router.get('/stream', async (req, res) => {
  const token = String(req.query.access_token || '');
  const allowlist = allowedEmails();
  if (!supabase || !token || allowlist.length === 0) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'auth_failed' });
    if (!allowlist.includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'forbidden' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'auth_failed' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch (_) {}
  }, 15000);

  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (_) {}
  };
  const unsubscribe = activityBus.subscribe(send);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    try { res.end(); } catch (_) {}
  });
});

module.exports = router;
