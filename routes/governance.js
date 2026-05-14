/*
  Zion — CLASPION governance admin routes.
  /state, /toggle, /reset, /rules, /audit, /quarantine/exit, /health.
*/

const express = require('express');
const router = express.Router();
const { governance } = require('../lib/claspion-governance');
const { enhancedGovernance } = require('../lib/claspion-enhanced-integration');
const { GOOD_NEIGHBOR_GUARD_RULES } = require('../lib/good-neighbor-guard-rules');

router.get('/state', (req, res) => res.json(governance.getState()));
router.get('/status', (req, res) => res.json(governance.getState()));

router.post('/state', (req, res) => {
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) governance.setEnabled(!!body.enabled);
  if (Object.prototype.hasOwnProperty.call(body, 'url')) governance.setUrl(body.url);
  console.log(`[CLASPION] override: enabled=${governance.enabled} url=${governance.url || '(none)'} effective=${governance.isEnabled()}`);
  res.json(governance.getState());
});

router.post('/toggle', (req, res) => {
  governance.setEnabled(!governance.enabled);
  console.log(`[CLASPION] toggled: enabled=${governance.enabled} effective=${governance.isEnabled()}`);
  res.json(governance.getState());
});

router.post('/reset', (req, res) => {
  governance.resetOverrides();
  res.json(governance.getState());
});

router.get('/enhanced/state', (req, res) => res.json(enhancedGovernance.getGovernanceState()));
router.get('/rules', (req, res) => res.json(GOOD_NEIGHBOR_GUARD_RULES));
router.get('/rules/:ruleNumber', (req, res) => {
  const ruleNumber = parseInt(req.params.ruleNumber);
  const rule = GOOD_NEIGHBOR_GUARD_RULES.rules[ruleNumber];
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json({ number: ruleNumber, version: GOOD_NEIGHBOR_GUARD_RULES.version, rule });
});

router.post('/validate', async (req, res) => {
  try {
    const { action, context = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'Missing action' });
    const result = await enhancedGovernance.validateAction(action, context);
    res.json({ validation_result: result, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const auditLog = enhancedGovernance.audit_log.slice(-limit).reverse();
  res.json({ entries: auditLog, total_count: enhancedGovernance.audit_log.length, limit });
});

router.post('/quarantine/exit', (req, res) => {
  const { auth_token } = req.body;
  if (!auth_token) return res.status(400).json({ error: 'auth_token required' });
  try {
    const state = enhancedGovernance.exitQuarantine(auth_token);
    res.json({ success: true, governance_state: state });
  } catch (error) {
    res.status(403).json({ error: 'Authorization failed' });
  }
});

router.get('/health', (req, res) => {
  const basicState = governance.getState();
  const enhancedState = enhancedGovernance.getGovernanceState();
  res.json({
    status: 'healthy',
    claspion_basic: {
      enabled: basicState.enabled, has_url: basicState.has_url, has_api_key: basicState.has_api_key
    },
    enhanced_governance: {
      rules_version: enhancedState.rules_version,
      core_rules_count: enhancedState.core_rules_count,
      enforcement_layers: enhancedState.enforcement_layers.length,
      quarantine_mode: enhancedState.quarantine_mode,
      audit_entries: enhancedState.audit_entries
    },
    good_neighbor_guard: {
      version: GOOD_NEIGHBOR_GUARD_RULES.version,
      hierarchy_level: GOOD_NEIGHBOR_GUARD_RULES.hierarchy_level,
      enforced_by: GOOD_NEIGHBOR_GUARD_RULES.enforced_by,
      total_rules: Object.keys(GOOD_NEIGHBOR_GUARD_RULES.rules).length
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
