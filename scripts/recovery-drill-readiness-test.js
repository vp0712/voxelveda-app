const assert = require('assert');
const { buildRecoveryDrillReadiness } = require('../services/recoveryDrillReadiness');
const { injectRecoveryDrillCenter } = require('../services/adminPageRenderer');

const now = new Date('2026-09-17T07:00:00.000Z');

const blocked = buildRecoveryDrillReadiness({
  recovery: { provider_connected: false, ready: false, checks: [] },
  env: { RECOVERY_RPO_HOURS: '24', RECOVERY_RTO_HOURS: '4' },
  now
});
assert.equal(blocked.state, 'blocked');
assert.equal(blocked.gates.formal_drill_ready, false);
assert.equal(blocked.gates.recovery_assurance_verified, false);
assert.equal(blocked.safety.production_restore_available, false);
assert.match(blocked.plain_language, /do not yet have enough evidence/i);

const needsRestore = buildRecoveryDrillReadiness({
  recovery: {
    provider_connected: true,
    ready: false,
    checks: [{ id: 'backup_freshness', status: 'ready' }, { id: 'restore_verification', status: 'degraded' }]
  },
  env: { RECOVERY_RPO_HOURS: '12', RECOVERY_RTO_HOURS: '3' },
  now
});
assert.equal(needsRestore.state, 'action_required');
assert.equal(needsRestore.objectives.rpo_hours, 12);
assert.equal(needsRestore.objectives.rto_hours, 3);
assert.match(needsRestore.plain_language, /recoverability is not yet proven/i);

const verified = buildRecoveryDrillReadiness({
  recovery: {
    provider_connected: true,
    ready: true,
    checks: [
      { id: 'backup_freshness', status: 'ready' },
      { id: 'restore_verification', status: 'ready' },
      { id: 'restore_result', status: 'ready' }
    ]
  },
  env: {},
  now
});
assert.equal(verified.state, 'ready');
assert.equal(verified.gates.recovery_assurance_verified, true);
assert.ok(verified.progress.completed_steps >= 5);
assert.ok(verified.evidence_pack.length >= 8);

const sample = '<html><head></head><body><section id="recoveryAssurancePanel" class="card recovery-assurance" aria-live="polite"></section></body></html>';
const rendered = injectRecoveryDrillCenter(sample);
assert.match(rendered, /id="recoveryDrillCenter"/);
assert.match(rendered, /recovery-drill\.css/);
assert.match(rendered, /recovery-drill\.js/);
assert.equal((rendered.match(/id="recoveryDrillCenter"/g) || []).length, 1);

console.log('RECOVERY_DRILL_READINESS_OK');
