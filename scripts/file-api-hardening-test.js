const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { redactSensitive } = require('../utils/securityRedaction');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const redacted = redactSensitive({ password: 'bad', nested: { bankAccountNumber: '123', safe: 'ok' } });
assert.equal(redacted.password, '[REDACTED]');
assert.equal(redacted.nested.bankAccountNumber, '[REDACTED]');
assert.equal(redacted.nested.safe, 'ok');

const upload = read('middleware/uploadSecurity.js');
const documents = read('services/documentSecurityService.js');
const app = read('app.js');
const supplier = read('controllers/supplierController.js');
const expense = read('controllers/expenseController.js');
const compliance = read('controllers/complianceController.js');
assert.match(upload, /matchesSignature/);
assert.match(upload, /File content does not match/);
assert.match(documents, /safeStoredPath/);
assert.match(documents, /VIEW_CONFIDENTIAL_FILES/);
assert.match(documents, /SENSITIVE_DOCUMENT_VIEWED/);
assert.match(app, /\/api\/documents/);
assert(!app.includes("app.use('/uploads'"), 'raw upload storage must not be directly served');
assert(!supplier.match(/SELECT sf\.\*/));
assert(!expense.match(/SELECT ef\.\*/));
assert(!compliance.match(/SELECT cf\.\*/));

console.log('File and API hardening tests passed.');
