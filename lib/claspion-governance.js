/*
  Zion — CLASPION governance stub.

  PR 1 keeps CLASPION dormant. The full governance layer lands in PR 3
  with the enterprise build. Until then this stub returns an ALLOW
  verdict on every call so routes can preserve the validate() shape
  without taking a real dependency.

  When CLASPION_ENABLED=true is set later, drop in the full
  lib/claspion-governance.js from Splendor in PR 3.
*/

const ENABLED = process.env.CLASPION_ENABLED === 'true';

const governance = {
  isEnabled() {
    return ENABLED;
  },
  url: process.env.CLASPION_URL || null,
  failMode: process.env.CLASPION_FAIL_MODE || 'block',

  async validate(_input) {
    return {
      allow: true,
      decision: 'ALLOW',
      reason: ENABLED ? 'stub_pass_through' : 'governance_dormant',
      dormant: !ENABLED,
      basis_state: 'unbound',
      conscience_name: 'zion_stub',
      verdict_id: null,
      correlation_id: null
    };
  }
};

module.exports = { governance };
