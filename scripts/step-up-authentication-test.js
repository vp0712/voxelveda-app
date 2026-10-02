const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isStepUpFresh, stepUpTtlMinutes } = require('../services/stepUpService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

delete process.env.STEP_UP_TTL_MINUTES;
assert.equal(stepUpTtlMinutes(), 15);
assert.equal(isStepUpFresh({ assuranceLevel: 2, stepUpVerifiedAt: new Date() }), false);
assert.equal(isStepUpFresh({ assuranceLevel: 3, stepUpVerifiedAt: new Date(Date.now() - 14 * 60 * 1000) }), true);
assert.equal(isStepUpFresh({ assuranceLevel: 3, stepUpVerifiedAt: new Date(Date.now() - 16 * 60 * 1000) }), false);
assert.equal(isStepUpFresh({ assuranceLevel: 3, stepUpVerifiedAt: new Date(Date.now() + 60 * 1000) }), false);

const authRoutes = read('routes/authRoutes.js');
const financeRoutes = read('routes/financeRoutes.js');
const userRoutes = read('routes/userRoutes.js');
const settingsRoutes = read('routes/settingsRoutes.js');
const invoiceRoutes = read('routes/invoiceRoutes.js');
const expenseRoutes = read('routes/expenseRoutes.js');
const middleware = read('middleware/stepUpMiddleware.js');
const controller = read('controllers/stepUpController.js');
const client = read('public/step-up.js');

assert.match(authRoutes, /post\('\/step-up'.*authRateLimit\(\).*auth.*stepUpController\.verify/);
assert.match(middleware, /STEP_UP_REQUIRED/);
assert.match(controller, /bcrypt\.compare/);
assert.match(controller, /verifyAuthenticatedTotp/);
assert.match(controller, /markSessionStepUp/);
assert.match(financeRoutes, /requireStepUp\('CHANGE_BANK_DETAILS'\)/);
assert.match(financeRoutes, /requireStepUp\('EXPORT_ACCOUNTANT_PACK'\)/);
assert.match(financeRoutes, /requireStepUp\('VOID_FINANCIAL_TRANSACTION'\)/);
assert.match(userRoutes, /requireStepUp\('CHANGE_ROLE_OR_PERMISSIONS'\)/);
assert.match(userRoutes, /requireStepUp\('TERMINATE_USER_ACCESS'\)/);
assert.match(settingsRoutes, /requireStepUp\('CHANGE_SYSTEM_SETTINGS'\)/);
assert.match(invoiceRoutes, /requireStepUp\('DELETE_INVOICE'\)/);
assert.match(expenseRoutes, /requireStepUp\('VOID_EXPENSE_PAYMENT'\)/);
assert.match(client, /Security Verification Required/);
assert.match(client, /nativeFetch\('\/api\/auth\/step-up'/);
assert(!client.includes('localStorage'), 'step-up credentials or state must not be stored in localStorage');


const retentionSource = read('services/securityEventRetentionService.js');
const sessionSource = read('services/sessionService.js');
const securitySchemaSource = read('services/securitySchema.js');
const { isSecurityEventCapacityError } = require('../services/securityEventRetentionService');

assert.equal(isSecurityEventCapacityError({ code: 'ER_RECORD_FILE_FULL', errno: 1114, message: "The table 'security_events' is full" }), true);
assert.equal(isSecurityEventCapacityError({ code: 'ER_BAD_FIELD_ERROR', errno: 1054, message: 'Unknown column' }), false);
assert.match(retentionSource, /STEP_UP_REQUIRED/);
assert.match(retentionSource, /SECURITY_EVENT_ROUTINE_ROW_CAP/);
assert.match(sessionSource, /SECURITY_EVENT_CAPACITY_FALLBACK/);
assert.match(sessionSource, /pruneSecurityEvents\(\{ emergency: true \}\)/);
assert.match(sessionSource, /return \{ persisted: false, fallback: 'RUNTIME_LOG' \}/);
assert.match(securitySchemaSource, /pruneSecurityEvents\(\)/);
assert(!sessionSource.includes('password:'), 'capacity fallback must never log password fields');
assert(!sessionSource.includes('code: entry.code'), 'capacity fallback must never log authenticator codes');

console.log('Step-up authentication tests passed.');
