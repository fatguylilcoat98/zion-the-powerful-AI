/*
  Zion — email rate limiter (cloned verbatim from Splendor).
  Cooldown 30s, hourly 10, daily 50, per user.
*/

const COOLDOWN_MS = 30 * 1000;
const HOURLY_LIMIT = 10;
const DAILY_LIMIT = 50;

const state = new Map();

function utcHourBucket(now) { return Math.floor(now / (60 * 60 * 1000)); }
function utcDayBucket(now) { return Math.floor(now / (24 * 60 * 60 * 1000)); }

function check(userId, now = Date.now()) {
  const entry = state.get(userId) || {
    lastSendAt: 0,
    hourBucket: utcHourBucket(now), hourCount: 0,
    dayBucket: utcDayBucket(now), dayCount: 0,
  };
  const hb = utcHourBucket(now);
  const db = utcDayBucket(now);
  if (entry.hourBucket !== hb) { entry.hourBucket = hb; entry.hourCount = 0; }
  if (entry.dayBucket  !== db) { entry.dayBucket  = db; entry.dayCount  = 0; }

  if (entry.lastSendAt && (now - entry.lastSendAt) < COOLDOWN_MS) {
    return { allowed: false, limit: 'cooldown',
      retry_after_seconds: Math.ceil((COOLDOWN_MS - (now - entry.lastSendAt)) / 1000) };
  }
  if (entry.hourCount >= HOURLY_LIMIT) {
    const hourEnd = (hb + 1) * 60 * 60 * 1000;
    return { allowed: false, limit: 'hourly',
      retry_after_seconds: Math.max(1, Math.ceil((hourEnd - now) / 1000)) };
  }
  if (entry.dayCount >= DAILY_LIMIT) {
    const dayEnd = (db + 1) * 24 * 60 * 60 * 1000;
    return { allowed: false, limit: 'daily',
      retry_after_seconds: Math.max(1, Math.ceil((dayEnd - now) / 1000)) };
  }
  return { allowed: true, entry };
}

function record(userId, entry, now = Date.now()) {
  entry.lastSendAt = now;
  entry.hourCount += 1;
  entry.dayCount  += 1;
  state.set(userId, entry);
}

function checkAndCommit(userId) {
  const result = check(userId);
  if (!result.allowed) {
    return { allowed: false, limit: result.limit, retry_after_seconds: result.retry_after_seconds };
  }
  return { allowed: true, commit: () => record(userId, result.entry) };
}

function emailRateLimit(req, res, next) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const r = checkAndCommit(userId);
  if (!r.allowed) {
    return res.status(429).json({ error: 'rate_limit', limit: r.limit, retry_after_seconds: r.retry_after_seconds });
  }
  res.locals.commitEmailSend = r.commit;
  next();
}

module.exports = { emailRateLimit, checkAndCommit, COOLDOWN_MS, HOURLY_LIMIT, DAILY_LIMIT };
