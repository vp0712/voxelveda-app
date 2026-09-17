const fs = require('node:fs');
const assert = require('node:assert');
const controller = require('../controllers/recoveryDrillEvidenceController');

const migration = fs.readFileSync('migrations/20260917_recovery_drill_evidence_ledger.sql', 'utf8');
const routes = fs.readFileSync('routes/readinessRoutes.js', 'utf8');
const ui = fs.readFileSync('public/recovery-drill-ledger.js', 'utf8');
const renderer = fs.readFileSync('services/adminPageRenderer.js', 'utf8');
const runner = fs.readFileSync('scripts/apply-recovery-drill-ledger-migration.js', 'utf8');

for (const table of ['recovery_drill_records', 'recovery_drill_events']) {
  assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Migration must create ${table}.`);
}
assert.ok(migration.includes('ON DELETE RESTRICT'), 'Evidence events must not cascade-delete with a drill.');
assert.ok(routes.includes("requireAnyPermission('MANAGE_SECURITY')"), 'Ledger writes must require MANAGE_SECURITY.');
assert.ok(routes.includes("router.get('/recovery/drills'"), 'Ledger list route is required.');
assert.ok(routes.includes("router.post('/recovery/drills'"), 'Ledger create route is required.');
assert.ok(routes.includes("/recovery/drills/:id/finalize"), 'Ledger finalization route is required.');
assert.ok(ui.includes('Finalize & Lock Evidence'), 'UI must explain evidence finalization/locking.');
assert.ok(ui.includes('does not prove Railway/provider backup scheduling'), 'UI must preserve external-provider evidence boundary.');
assert.ok(renderer.includes('/recovery-drill-ledger.js'), 'Admin page must load ledger UI.');
assert.ok(renderer.includes('/recovery-drill-ledger.css'), 'Admin page must load ledger styles.');
assert.ok(runner.includes('RECOVERY_DRILL_LEDGER_MIGRATION_OK'), 'Migration runner must verify schema creation.');

const { checks, hoursBetween, numberTarget } = controller._test;
assert.deepEqual(checks([{ name: 'Login', passed: true }, { name: '', passed: true }]), [{ name: 'Login', passed: true, note: '' }]);
assert.equal(hoursBetween(new Date('2026-09-17T00:00:00Z'), new Date('2026-09-17T03:30:00Z')), 3.5);
assert.equal(hoursBetween(new Date('2026-09-17T04:00:00Z'), new Date('2026-09-17T03:00:00Z')), 0);
assert.equal(numberTarget('12.5', 24), 12.5);
assert.equal(numberTarget('-1', 24), 24);

assert.ok(!ui.includes('production restore'), 'Ledger UI must not expose a production restore action.');
console.log('RECOVERY_DRILL_EVIDENCE_LEDGER_OK');
