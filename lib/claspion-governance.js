/*
  Zion — CLASPION Governance Client.
  Cloned from Splendor; actor/surface/conscience names rebranded to Zion.
  Behavior identical: dormant pass-through when CLASPION_ENABLED=false.
*/

const crypto = require('crypto');
const { activityBus } = require('./activity-bus');

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_FAIL_MODE = 'block';

function readBool(envValue, fallback = false) {
  if (envValue === undefined || envValue === null) return fallback;
  const v = String(envValue).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function nowIso() { return new Date().toISOString(); }

class ClaspionGovernance {
  constructor(opts = {}) {
    this._envUrl = (opts.url || process.env.CLASPION_URL || '').replace(/\/+$/, '');
    const enabledDefault = !!this._envUrl;
    this._envEnabled = opts.enabled !== undefined
      ? !!opts.enabled
      : readBool(process.env.CLASPION_ENABLED, enabledDefault);
    this._runtimeEnabled = null;
    this._runtimeUrl = null;
    this._lastCall = null;
    this.apiKey = opts.apiKey || process.env.CLASPION_API_KEY || '';
    this.timeoutMs = Number(opts.timeoutMs || process.env.CLASPION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    this.failMode = (opts.failMode || process.env.CLASPION_FAIL_MODE || DEFAULT_FAIL_MODE).toLowerCase();
    this.actorId = opts.actorId || process.env.CLASPION_ACTOR_ID || 'zion';
    this.surface = opts.surface || 'zion';
    this.logger = opts.logger || console;
  }

  get enabled() {
    return this._runtimeEnabled !== null ? this._runtimeEnabled : this._envEnabled;
  }
  set enabled(v) { this._runtimeEnabled = !!v; }
  get url() {
    return this._runtimeUrl !== null ? this._runtimeUrl : this._envUrl;
  }
  set url(v) { this._runtimeUrl = (v || '').replace(/\/+$/, ''); }

  isEnabled() { return this.enabled && !!this.url; }

  setEnabled(v) { this._runtimeEnabled = !!v; return this.getState(); }
  setUrl(v) { this._runtimeUrl = v == null ? null : String(v).replace(/\/+$/, ''); return this.getState(); }
  resetOverrides() { this._runtimeEnabled = null; this._runtimeUrl = null; return this.getState(); }

  getState() {
    return {
      enabled: this.isEnabled(),
      enabled_flag: this.enabled,
      has_url: !!this.url,
      url: this.url || null,
      has_api_key: !!this.apiKey,
      fail_mode: this.failMode,
      timeout_ms: this.timeoutMs,
      actor_id: this.actorId,
      env_defaults: { enabled: this._envEnabled, url: this._envUrl || null },
      runtime_overrides: { enabled: this._runtimeEnabled, url: this._runtimeUrl },
      last_call: this._lastCall,
    };
  }

  async validate({ thought = {}, intent = {}, actorId, correlationId } = {}) {
    const correlation = correlationId || crypto.randomUUID();
    const intentType = intent && intent.type ? String(intent.type) : 'unspecified';
    const actor = actorId || this.actorId;
    const t0 = Date.now();

    if (!this.isEnabled()) {
      const verdict = {
        decision: 'ALLOW',
        allow: true,
        dormant: true,
        reason: 'governance disabled (CLASPION_ENABLED=false or no CLASPION_URL)',
        basis_state: 'ESTABLISHED',
        conscience_name: 'zion-bypass',
        failed_axes: [],
        verdict_id: `local-${correlation}`,
        correlation_id: correlation,
        latency_ms: 0,
      };
      this._log('dormant', verdict, { intentType, actor });
      return verdict;
    }

    let verdict;
    let upstreamErr = null;
    try {
      verdict = await this._postValidate({ thought, intent, actor, correlation });
    } catch (err) {
      upstreamErr = err;
      verdict = this._failureVerdict(err, correlation);
    }
    verdict.correlation_id = correlation;
    verdict.latency_ms = Date.now() - t0;
    this._lastCall = {
      at: new Date().toISOString(),
      ok: !upstreamErr,
      status: upstreamErr && upstreamErr.code && /^HTTP_(\d+)$/.test(upstreamErr.code)
        ? Number(upstreamErr.code.slice(5)) : null,
      error_code: upstreamErr ? (upstreamErr.code || 'ERROR') : null,
      error_message: upstreamErr ? String(upstreamErr.message || upstreamErr) : null,
      latency_ms: verdict.latency_ms,
      decision: verdict.decision,
      allow: !!verdict.allow,
    };
    this._log('validated', verdict, { intentType, actor });
    return verdict;
  }

  async check(args) {
    const verdict = await this.validate(args);
    return {
      allow: !!verdict.allow,
      reason: verdict.reason,
      decision: verdict.decision,
      verdict_id: verdict.verdict_id,
      correlation_id: verdict.correlation_id,
      basis_state: verdict.basis_state,
    };
  }

  async _postValidate({ thought, intent, actor, correlation }) {
    const endpoint = `${this.url}/api/v1/governance/validate`;
    const body = JSON.stringify({ thought, intent, actor_id: actor, correlation_id: correlation, surface: this.surface });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body, signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`CLASPION ${res.status}: ${text || res.statusText}`);
      err.code = `HTTP_${res.status}`;
      throw err;
    }
    const data = await res.json();
    return {
      decision: data.decision,
      allow: !!data.allow,
      reason: data.reason || '',
      basis_state: data.basis_state || 'UNKNOWN',
      conscience_name: data.conscience_name || 'unknown',
      failed_axes: Array.isArray(data.failed_axes) ? data.failed_axes : [],
      verdict_id: data.verdict_id || null,
      metadata: data.metadata || {},
      suggested_action: data.suggested_action || null,
    };
  }

  _failureVerdict(err, correlation) {
    const failClosed = this.failMode !== 'allow';
    const decision = failClosed ? 'BLOCK' : 'ALLOW';
    const reason = failClosed
      ? `network failure; fail-closed per CLASPION_FAIL_MODE: ${err && err.message ? err.message : 'unknown error'}`
      : `network failure; fail-open per CLASPION_FAIL_MODE: ${err && err.message ? err.message : 'unknown error'}`;
    return {
      decision, allow: !failClosed, reason,
      basis_state: 'UNREACHABLE',
      conscience_name: 'zion-failure-handler',
      failed_axes: ['transport'],
      verdict_id: `local-fail-${correlation}`,
      metadata: { error_code: err && err.code ? err.code : 'NETWORK' },
      suggested_action: failClosed
        ? 'restore CLASPION reachability or set CLASPION_FAIL_MODE=allow for testing only'
        : null,
    };
  }

  _log(stage, verdict, ctx) {
    const line = {
      ts: nowIso(), tag: '[CLASPION]', stage,
      enabled: this.isEnabled(),
      decision: verdict.decision, allow: verdict.allow,
      conscience: verdict.conscience_name, basis: verdict.basis_state,
      intent_type: ctx.intentType, actor: ctx.actor,
      correlation: verdict.correlation_id,
      latency_ms: verdict.latency_ms, reason: verdict.reason,
    };
    const log = this.logger && (this.logger.info || this.logger.log);
    if (log) {
      log.call(this.logger,
        `${line.tag} ${line.stage} decision=${line.decision} basis=${line.basis} conscience=${line.conscience} intent=${line.intent_type} actor=${line.actor} corr=${line.correlation} reason="${line.reason}"`);
    }
    try {
      activityBus.emit('claspion', {
        stage: line.stage, decision: line.decision, basis: line.basis,
        conscience: line.conscience, intent: line.intent_type,
        latency_ms: line.latency_ms, dormant: !!verdict.dormant,
      });
    } catch (_) {}
  }
}

const governance = new ClaspionGovernance();

module.exports = { ClaspionGovernance, governance };
