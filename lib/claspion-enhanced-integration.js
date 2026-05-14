/*
  Zion — CLASPION Enhanced Integration.
  Full governance enforcement combining Core Rules + memory traceability
  + hierarchy + upstream CLASPION. Identical to Splendor's; actor rebranded.
*/

const { governance } = require('./claspion-governance');
const {
  GOOD_NEIGHBOR_GUARD_RULES,
  validateAgainstCoreRules,
  isMemoryTraceable,
  enforceInstructionHierarchy
} = require('./good-neighbor-guard-rules');
const { supabase } = require('./supabase');

class EnhancedClaspionGovernance {
  constructor() {
    this.governance = governance;
    this.rules = GOOD_NEIGHBOR_GUARD_RULES;
    this.quarantine_mode = false;
    this.audit_log = [];
  }

  async validateAction(actionRequest, context = {}) {
    const startTime = Date.now();
    const correlationId = require('crypto').randomUUID();
    try {
      const coreRulesResult = this._validateCoreRules(actionRequest, context);
      if (this.quarantine_mode || coreRulesResult.quarantine_triggered) {
        return this._quarantineResponse(actionRequest, coreRulesResult, correlationId);
      }
      const memoryResult = await this._validateMemoryIntegrity(actionRequest, context);
      const hierarchyResult = this._validateInstructionHierarchy(actionRequest);
      const claspionResult = await this._validateWithClaspion(actionRequest, context, correlationId);
      const enhancedResult = this._combineValidationResults({
        coreRules: coreRulesResult, memory: memoryResult, hierarchy: hierarchyResult,
        claspion: claspionResult, correlationId, latencyMs: Date.now() - startTime
      });
      await this._auditLog(enhancedResult, actionRequest, context);
      return enhancedResult;
    } catch (error) {
      return this._emergencyFailsafe(error, actionRequest, correlationId);
    }
  }

  _validateCoreRules(actionRequest, context) {
    const validation = validateAgainstCoreRules(actionRequest, context);
    const criticalViolations = validation.violations.filter(v => v.severity === 'critical');
    return {
      valid: validation.valid,
      violations: validation.violations,
      warnings: validation.warnings,
      criticalCount: criticalViolations.length,
      quarantine_triggered: validation.quarantine_triggered,
      enforcement_required: validation.enforcement_required
    };
  }

  async _validateMemoryIntegrity(actionRequest, context) {
    if (actionRequest.type !== 'memory_store' && actionRequest.type !== 'memory_retrieve') {
      return { valid: true, applicable: false };
    }
    const issues = [];
    if (actionRequest.type === 'memory_store' && actionRequest.memory) {
      if (!isMemoryTraceable(actionRequest.memory)) {
        issues.push({ rule: 20, severity: 'critical', message: 'Memory lacks required traceability (source, timestamp, content, user_id)' });
      }
      const validSources = ['conversation', 'user_direct_statement', 'assistant_response', 'web_search', 'system_observation'];
      if (actionRequest.memory.source && !validSources.includes(actionRequest.memory.source_type)) {
        issues.push({ rule: 20, severity: 'warning', message: `Memory source type "${actionRequest.memory.source_type}" not in validated list` });
      }
    }
    if (actionRequest.type === 'memory_retrieve' && context.retrieved_memories) {
      for (const memory of context.retrieved_memories) {
        if (!memory.created_at || !memory.source_type) {
          issues.push({ rule: 20, severity: 'warning', message: 'Retrieved memory missing traceability metadata' });
        }
      }
    }
    return { valid: issues.filter(i => i.severity === 'critical').length === 0, issues, applicable: true };
  }

  _validateInstructionHierarchy(actionRequest) {
    let instructionText = '';
    if (actionRequest.type === 'response' && actionRequest.content) instructionText = actionRequest.content;
    else if (actionRequest.instruction) instructionText = actionRequest.instruction;
    else if (actionRequest.user_message) instructionText = actionRequest.user_message;
    if (!instructionText) return { valid: true, applicable: false };
    return enforceInstructionHierarchy(instructionText);
  }

  async _validateWithClaspion(actionRequest, context, correlationId) {
    const thought = {
      context: context.reasoning || 'Action validation request',
      user_id: context.user_id || 'anonymous',
      session_id: context.session_id || correlationId
    };
    const intent = {
      type: actionRequest.type,
      action: actionRequest.action || actionRequest.type,
      target: actionRequest.target,
      data: actionRequest.data,
      risk_level: this._assessRiskLevel(actionRequest)
    };
    return await this.governance.validate({ thought, intent, actorId: 'zion', correlationId });
  }

  _assessRiskLevel(actionRequest) {
    const highRiskTypes = ['system_override', 'rule_modification', 'governance_change', 'user_data_modification', 'external_api_call'];
    const mediumRiskTypes = ['memory_store', 'file_write', 'database_write'];
    if (highRiskTypes.includes(actionRequest.type)) return 'high';
    if (mediumRiskTypes.includes(actionRequest.type)) return 'medium';
    return 'low';
  }

  _combineValidationResults(results) {
    const { coreRules, memory, hierarchy, claspion, correlationId, latencyMs } = results;
    if (!coreRules.valid || coreRules.enforcement_required) {
      return {
        decision: 'BLOCK', allow: false,
        reason: `Core rule violation: ${coreRules.violations.map(v => `Rule ${v.rule}: ${v.message}`).join('; ')}`,
        basis_state: 'RULE_VIOLATION', enforcement_layer: 'CORE_RULES',
        correlation_id: correlationId, latency_ms: latencyMs,
        violations: coreRules.violations,
        warnings: [...(coreRules.warnings || []), ...(memory.issues || []).filter(i => i.severity === 'warning')]
      };
    }
    if (hierarchy.authority_mutation) {
      return {
        decision: 'BLOCK', allow: false,
        reason: `Authority mutation detected: ${hierarchy.violations.map(v => v.message).join('; ')}`,
        basis_state: 'AUTHORITY_VIOLATION', enforcement_layer: 'HIERARCHY_ENFORCEMENT',
        correlation_id: correlationId, latency_ms: latencyMs,
        violations: hierarchy.violations
      };
    }
    if (!memory.valid) {
      return {
        decision: 'BLOCK', allow: false,
        reason: `Memory integrity violation: ${memory.issues.filter(i => i.severity === 'critical').map(i => i.message).join('; ')}`,
        basis_state: 'MEMORY_VIOLATION', enforcement_layer: 'MEMORY_INTEGRITY',
        correlation_id: correlationId, latency_ms: latencyMs,
        violations: memory.issues.filter(i => i.severity === 'critical')
      };
    }
    if (!claspion.allow) {
      return {
        decision: claspion.decision, allow: false,
        reason: `CLASPION: ${claspion.reason}`,
        basis_state: claspion.basis_state, enforcement_layer: 'CLASPION_UPSTREAM',
        correlation_id: correlationId, latency_ms: latencyMs,
        claspion_verdict: claspion.verdict_id, failed_axes: claspion.failed_axes
      };
    }
    return {
      decision: 'ALLOW', allow: true,
      reason: 'All governance layers validated successfully',
      basis_state: 'VALIDATED', enforcement_layer: 'FULL_GOVERNANCE',
      correlation_id: correlationId, latency_ms: latencyMs,
      warnings: [...(memory.issues || []).filter(i => i.severity === 'warning')]
    };
  }

  _quarantineResponse(actionRequest, coreRulesResult, correlationId) {
    this.quarantine_mode = true;
    return {
      decision: 'QUARANTINE', allow: false,
      reason: 'QUARANTINE triggered by critical rule violation - human intervention required',
      basis_state: 'QUARANTINED', enforcement_layer: 'QUARANTINE_PROTOCOL',
      correlation_id: correlationId, quarantine_triggered: true,
      violations: coreRulesResult.violations, requires_human_intervention: true
    };
  }

  _emergencyFailsafe(error, actionRequest, correlationId) {
    return {
      decision: 'BLOCK', allow: false,
      reason: `Governance system error - failing closed for safety: ${error.message}`,
      basis_state: 'GOVERNANCE_ERROR', enforcement_layer: 'EMERGENCY_FAILSAFE',
      correlation_id: correlationId, error_code: 'GOVERNANCE_FAILURE',
      requires_manual_review: true
    };
  }

  async _auditLog(result, actionRequest, context) {
    const auditEntry = {
      id: require('crypto').randomUUID(),
      timestamp: new Date().toISOString(),
      correlation_id: result.correlation_id,
      action_type: actionRequest.type,
      decision: result.decision,
      enforcement_layer: result.enforcement_layer,
      user_id: context.user_id || 'anonymous',
      violations: result.violations || [],
      warnings: result.warnings || [],
      latency_ms: result.latency_ms
    };
    this.audit_log.push(auditEntry);
    if (this.audit_log.length > 1000) this.audit_log = this.audit_log.slice(-1000);
    try {
      if (supabase) {
        await supabase.from('governance_audit_log').insert([auditEntry]);
      }
    } catch (error) {
      // Best-effort — if the table doesn't exist yet, we keep going.
      // In-memory audit_log is still authoritative.
    }
  }

  getGovernanceState() {
    return {
      ...this.governance.getState(),
      rules_version: this.rules.version,
      quarantine_mode: this.quarantine_mode,
      audit_entries: this.audit_log.length,
      core_rules_count: Object.keys(this.rules.rules).length,
      enforcement_layers: ['CORE_RULES', 'HIERARCHY_ENFORCEMENT', 'MEMORY_INTEGRITY', 'CLASPION_UPSTREAM']
    };
  }

  exitQuarantine(authToken) {
    this.quarantine_mode = false;
    return this.getGovernanceState();
  }
}

const enhancedGovernance = new EnhancedClaspionGovernance();

module.exports = { EnhancedClaspionGovernance, enhancedGovernance };
