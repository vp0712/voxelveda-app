const assert = require('assert');
const fs = require('fs');

const controller = fs.readFileSync('controllers/recoveryRemediationController.js', 'utf8');
const routes = fs.readFileSync('routes/readinessRoutes.js', 'utf8');
const renderer = fs.readFileSync('services/adminPageRenderer.js', 'utf8');
const migration = fs.readFileSync('migrations/20260917_recovery_remediation_workflow.sql', 'utf8');

for (const marker of ['closure_evidence', 'REMEDIATION_CLOSED', 'Closed remediation records are immutable', 'priorityFromSeverity', 'production_restore_available: false']) {
  assert(controller.includes(marker), `Missing remediation safeguard: ${marker}`);
}
assert(routes.includes("router.get('/recovery/remediations'"), 'Read endpoint required.');
assert(routes.includes("router.post('/recovery/remediations/sync'"), 'Governance sync endpoint required.');
assert(routes.includes("securityWriteAccess, remediationWriteLimit"), 'Remediation mutations must require MANAGE_SECURITY and rate limiting.');
assert(renderer.includes('/recovery-remediation.js') && renderer.includes('/recovery-remediation.css'), 'Remediation assets must load in Security Centre.');
assert(migration.includes('recovery_remediation_items') && migration.includes('recovery_remediation_events'), 'Remediation tables required.');
assert(!controller.includes('DELETE FROM recovery_remediation'), 'Remediation evidence must not be deleted by workflow actions.');
assert(!controller.includes('UPDATE recovery_drill_records'), 'Remediation workflow must not rewrite drill evidence.');
console.log('RECOVERY_REMEDIATION_OK');
