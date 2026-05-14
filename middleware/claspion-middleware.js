/*
  Zion — CLASPION Middleware.
  Express integration. PR 2 keeps this NOT mounted globally in server.js;
  the upstream gate is dormant via CLASPION_ENABLED=false and per-route
  validation in routes/chat.js handles the gating. When CLASPION goes
  live, mount via `app.use(claspionMiddleware())` and
  `app.use(claspionResponseMiddleware())` before routes.
*/

const { enhancedGovernance } = require('../lib/claspion-enhanced-integration');

function claspionMiddleware(options = {}) {
  const {
    exemptPaths = ['/health', '/version', '/api/governance', '/api/status'],
    exemptMethods = ['OPTIONS'],
    logAll = true
  } = options;

  return async (req, res, next) => {
    if (exemptPaths.some(p => req.path.startsWith(p)) || exemptMethods.includes(req.method)) {
      return next();
    }
    const startTime = Date.now();
    const correlationId = require('crypto').randomUUID();
    try {
      const actionRequest = buildActionFromRequest(req);
      const context = buildContextFromRequest(req, correlationId);
      const validationResult = await enhancedGovernance.validateAction(actionRequest, context);
      res.set({
        'X-Claspion-Decision': validationResult.decision,
        'X-Claspion-Basis': validationResult.basis_state,
        'X-Claspion-Correlation': validationResult.correlation_id,
        'X-Claspion-Latency': `${validationResult.latency_ms}ms`,
        'X-GNG-Rules-Version': '1.1'
      });
      if (!validationResult.allow) return handleGovernanceBlock(res, validationResult, req);
      req.claspionValidation = validationResult;
      req.correlationId = correlationId;
      if (logAll) console.log(`[CLASPION-MIDDLEWARE] ALLOW ${req.method} ${req.path}`);
      next();
    } catch (error) {
      console.error('[CLASPION-MIDDLEWARE] Governance error:', error);
      res.status(503).json({
        error: 'Governance system unavailable',
        message: 'Request blocked for safety - governance validation failed',
        correlation_id: correlationId,
        basis_state: 'GOVERNANCE_ERROR'
      });
    }
  };
}

function buildActionFromRequest(req) {
  const actionType = determineActionType(req);
  return {
    type: actionType, method: req.method, path: req.path,
    action: `${req.method}_${req.path.replace(/\//g, '_')}`,
    data: req.body, query: req.query,
    headers: filterSensitiveHeaders(req.headers),
    user_agent: req.get('User-Agent'), ip: req.ip,
    timestamp: new Date().toISOString()
  };
}

function buildContextFromRequest(req, correlationId) {
  return {
    correlation_id: correlationId,
    user_id: req.user?.id || req.headers['x-user-id'] || 'anonymous',
    session_id: req.session?.id || req.headers['x-session-id'],
    ip_address: req.ip, user_agent: req.get('User-Agent'),
    referer: req.get('Referer'),
    method: req.method, path: req.path, query: req.query,
    timestamp: new Date().toISOString()
  };
}

function determineActionType(req) {
  if (req.path.includes('/memory')) {
    if (req.method === 'POST') return 'memory_store';
    if (req.method === 'GET') return 'memory_retrieve';
    if (req.method === 'DELETE') return 'memory_delete';
    if (req.method === 'PUT') return 'memory_update';
  }
  if (req.path.includes('/chat')) return 'chat_interaction';
  if (req.path.includes('/admin')) return 'admin_operation';
  if (req.path.includes('/governance')) return 'governance_operation';
  if (req.method === 'POST' && req.path.includes('/upload')) return 'file_upload';
  if (req.path.includes('/auth')) {
    if (req.method === 'POST' && req.path.includes('/login')) return 'user_login';
    if (req.method === 'POST' && req.path.includes('/signup')) return 'user_signup';
    if (req.method === 'POST' && req.path.includes('/logout')) return 'user_logout';
  }
  if (req.method === 'GET') return 'http_read';
  if (req.method === 'POST') return 'http_create';
  if (req.method === 'PUT') return 'http_update';
  if (req.method === 'DELETE') return 'http_delete';
  return 'http_operation';
}

function filterSensitiveHeaders(headers) {
  const sensitive = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
  const filtered = { ...headers };
  for (const key of sensitive) if (filtered[key]) filtered[key] = '[REDACTED]';
  return filtered;
}

function handleGovernanceBlock(res, validationResult, req) {
  const statusCode = determineBlockStatusCode(validationResult);
  console.warn(`[CLASPION-MIDDLEWARE] BLOCK ${req.method} ${req.path} - ${validationResult.reason}`);
  if (validationResult.decision === 'QUARANTINE') {
    return res.status(503).json({
      error: 'System in quarantine mode',
      message: 'Critical governance violation detected - human intervention required',
      correlation_id: validationResult.correlation_id,
      basis_state: validationResult.basis_state,
      violations: validationResult.violations, quarantine: true
    });
  }
  res.status(statusCode).json({
    error: 'Request blocked by governance',
    message: validationResult.reason,
    decision: validationResult.decision,
    basis_state: validationResult.basis_state,
    enforcement_layer: validationResult.enforcement_layer,
    correlation_id: validationResult.correlation_id,
    violations: validationResult.violations || [],
    warnings: validationResult.warnings || []
  });
}

function determineBlockStatusCode(validationResult) {
  switch (validationResult.basis_state) {
    case 'RULE_VIOLATION':
    case 'AUTHORITY_VIOLATION':
    case 'MEMORY_VIOLATION':
      return 403;
    case 'QUARANTINED':
    case 'GOVERNANCE_ERROR':
    case 'UNREACHABLE':
      return 503;
    default:
      return 403;
  }
}

function claspionResponseMiddleware() {
  return (req, res, next) => {
    const originalSend = res.send;
    const originalJson = res.json;
    res.send = function(body) {
      setResponseHeaders(req, res);
      setImmediate(() => validateResponseAsync(body, req, res));
      return originalSend.call(this, body);
    };
    res.json = function(body) {
      setResponseHeaders(req, res);
      setImmediate(() => validateResponseAsync(body, req, res));
      return originalJson.call(this, body);
    };
    next();
  };
}

function setResponseHeaders(req, res) {
  try {
    if (!res.headersSent) {
      res.set({
        'X-Claspion-Response-Validated': 'true',
        'X-Claspion-Response-Correlation': req.correlationId || 'unknown'
      });
    }
  } catch (_) {}
}

async function validateResponseAsync(body, req, res) {
  try {
    const responseAction = {
      type: 'response',
      content: typeof body === 'string' ? body : JSON.stringify(body),
      status_code: res.statusCode,
      headers: res.getHeaders(),
      request_correlation: req.correlationId
    };
    const validation = await enhancedGovernance.validateAction(responseAction, {
      user_id: req.user?.id || 'anonymous',
      original_request: req.path
    });
    if (!validation.allow) console.warn(`[CLASPION-MIDDLEWARE] Response blocked: ${validation.reason}`);
  } catch (error) {
    console.error('[CLASPION-MIDDLEWARE] Response validation error:', error.message);
  }
}

module.exports = { claspionMiddleware, claspionResponseMiddleware };
