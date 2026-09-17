const assert = require('node:assert');
const { classifyItem, buildExecutiveOversight } = require('../services/recoveryExecutiveOversight');

const now = new Date('2026-09-17T10:00:00.000Z');
const urgent = classifyItem({ priority:'URGENT', status:'OPEN', created_at:'2026-09-16T08:00:00.000Z', due_at:'2026-09-17T08:00:00.000Z' }, now);
assert.equal(urgent.sla_breached, true);
assert.equal(urgent.escalation, 'EXECUTIVE');
assert.ok(urgent.overdue_hours > 0);

const report = buildExecutiveOversight({
  now,
  remediationRows:[
    { id:'1', title:'Restore validation', priority:'URGENT', status:'OPEN', created_at:'2026-09-16T08:00:00.000Z', due_at:'2026-09-17T08:00:00.000Z', owner_label:null },
    { id:'2', title:'Evidence update', priority:'LOW', status:'CLOSED', created_at:'2026-09-15T10:00:00.000Z', closed_at:'2026-09-15T20:00:00.000Z', owner_label:'Security Admin' }
  ],
  drillRows:[
    { id:'d1', final_decision:'FAIL', rpo_objective_status:'MISSED', rto_objective_status:'MET', finalized_at:'2026-09-16T10:00:00.000Z' }
  ]
});
assert.equal(report.summary.open, 1);
assert.equal(report.summary.closed, 1);
assert.equal(report.summary.failed_drills_90d, 1);
assert.equal(report.summary.objective_misses_90d, 1);
assert.equal(report.summary.unassigned, 1);
assert.equal(report.safety.production_restore_available, false);
assert.ok(report.risk.score > 0);
assert.ok(report.actions.length >= 1);

console.log('RECOVERY_EXECUTIVE_OVERSIGHT_OK');
