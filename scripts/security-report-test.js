const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parsePeriod } = require('../services/securityReportService');

const period = parsePeriod({ start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' });
assert.equal(period.start.toISOString(), '2026-08-01T00:00:00.000Z');
assert.throws(() => parsePeriod({ start: '2026-09-01', end: '2026-08-01' }), /valid report period/);
assert.throws(() => parsePeriod({ start: '2024-01-01', end: '2026-01-02' }), /366 days/);

const root = path.join(__dirname, '..');
const controller = fs.readFileSync(path.join(root, 'controllers/securityIncidentController.js'), 'utf8');
const report = fs.readFileSync(path.join(root, 'services/securityReportService.js'), 'utf8');
assert.match(controller, /SECURITY_REPORT_EXPORTED/);
assert.match(controller, /content_sha256/);
assert.match(controller, /Cache-Control', 'private, no-store/);
assert.match(report, /Operational security review data only/);
assert(!report.includes('password'));

console.log('Security-report tests passed.');
