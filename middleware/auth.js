/*
  Zion — Authentication middleware.
  Two-user allowlist: ZION_OWNER_EMAIL (Tiff) + ZION_ADMIN_EMAIL (Chris).
  Either email satisfies requireOwner. Email comparison is case-insensitive.
*/

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    res.status(401).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
}

function allowedEmails() {
  const owner = (process.env.ZION_OWNER_EMAIL || '').trim().toLowerCase();
  const admin = (process.env.ZION_ADMIN_EMAIL || '').trim().toLowerCase();
  return [owner, admin].filter(Boolean);
}

function requireOwner(req, res, next) {
  const allowlist = allowedEmails();

  if (allowlist.length === 0) {
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'No allowed emails configured (set ZION_OWNER_EMAIL and/or ZION_ADMIN_EMAIL)'
    });
  }

  const userEmail = (req.user && req.user.email ? req.user.email : '').toLowerCase();
  if (!userEmail || !allowlist.includes(userEmail)) {
    return res.status(403).json({
      error: 'Access denied',
      message: 'This system is restricted to authorized users only'
    });
  }

  // Tag the role on the request so downstream handlers can branch if needed.
  if (userEmail === (process.env.ZION_OWNER_EMAIL || '').trim().toLowerCase()) {
    req.userRole = 'owner';
  } else {
    req.userRole = 'admin';
  }

  next();
}

const rateLimits = new Map();

function rateLimit(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const window = rateLimits.get(key) || { count: 0, start: now };

    if (now - window.start > windowMs) {
      window.count = 0;
      window.start = now;
    }

    window.count++;
    rateLimits.set(key, window);

    if (window.count > maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Max ${maxRequests} per minute.`
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireOwner,
  rateLimit,
  allowedEmails
};
