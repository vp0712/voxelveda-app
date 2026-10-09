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

const upload = read('controllers/profileController.js');
const documents = read('services/documentSecurityService.js');
const objectStorage = read('services/objectStorageService.js');
const app = read('app.js');
const profile = read('routes/profileRoutes.js');
assert.match(upload, /validPhotoSignature/);
assert.match(upload, /Profile photo must be a genuine/);
assert.match(upload, /X-Content-Type-Options', 'nosniff/);
assert.match(documents, /safeStoredPath/);
assert.match(documents, /VIEW_CONFIDENTIAL_FILES/);
assert.match(documents, /SENSITIVE_DOCUMENT_VIEWED/);
assert.match(documents, /OBJECT_STORAGE_DOCUMENTS_ENABLED/);
assert.match(documents, /putObject\(objectKey, body/);
assert.match(documents, /storageUri\(objectKey\)/);
assert.match(documents, /keyFromStorageUri\(document\.storage_path\)/);
assert.match(documents, /DOCUMENT_INTEGRITY_MISMATCH/);
assert.match(documents, /scanStatusForFile/);
assert.match(documents, /synchronous === 'CLEAN'/);
assert.match(documents, /fs\.promises\.unlink\(safePath\)/);
assert.match(objectStorage, /async function putObject/);
assert.match(objectStorage, /async function getObject/);
assert.match(objectStorage, /async function deleteObject/);
assert.match(app, /\/api\/documents/);
assert(!app.includes("app.use('/uploads'"), 'raw upload storage must not be directly served');
assert.match(profile, /multer\.memoryStorage\(\)/);
assert.match(profile, /fileSize: 5 \* 1024 \* 1024/);
assert.match(documents, /documentModuleAvailable/);
assert.match(documents, /MODULE_RETIRED/);

console.log('File and API hardening tests passed.');
