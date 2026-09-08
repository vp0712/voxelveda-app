const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function expect(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message || `Missing expected source: ${needle}`);
}

const schema = read('services/qmsSchema.js');
const controller = read('controllers/qmsRecordController.js');
const routes = read('routes/qmsRoutes.js');
const app = read('app.js');
const server = read('server.js');

for (const table of ['qms_records','qms_record_revisions','qms_record_workflow_events','qms_record_signatures']) {
  expect(schema, table, `QMS schema missing ${table}`);
}
expect(controller, "const MUTABLE = new Set(['DRAFT', 'REJECTED'])", 'Approved records must not be directly mutable');
expect(controller, 'Separation of duties: the preparer cannot provide final approval.', 'QMS approval separation of duties missing');
expect(controller, 'QMS_RECORD_REVISED', 'QMS audit logging missing');
expect(controller, 'signed_integrity_hash', 'QMS signature integrity binding missing');
expect(routes, "requireStepUp(`qms:${target.toLowerCase()}`)", 'High-risk QMS transitions must require step-up authentication');
expect(app, "app.use('/api/qms', auth, qmsRoutes);", 'QMS API not mounted');
expect(server, 'ensureQmsSchema()', 'QMS schema not initialized at startup');

console.log('QMS controlled-record foundation checks passed.');
