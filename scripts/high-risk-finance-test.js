const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.FINANCE_ENCRYPTION_KEY = '7f'.repeat(32);
const { decryptSensitive, encryptSensitive, maskAccount } = require('../services/financeEncryptionService');
const { HIGH_RISK_PERMISSIONS, ROLE_TEMPLATES } = require('../config/permissionCatalog');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const encrypted = encryptSensitive('123456789');
assert.notEqual(encrypted, '123456789');
assert.equal(decryptSensitive(encrypted), '123456789');
assert.equal(maskAccount('123456789'), '••••6789');
assert.throws(() => decryptSensitive(`${encrypted.slice(0, -1)}x`));

assert(HIGH_RISK_PERMISSIONS.has('VIEW_PAYROLL_BANKING'));
assert(HIGH_RISK_PERMISSIONS.has('APPROVE_PAYROLL_BANK_CHANGE'));
assert(ROLE_TEMPLATES.hr.includes('VIEW_PAYROLL_BANKING'));

const routes = read('routes/highRiskFinanceRoutes.js');
const financeRoutes = read('routes/financeRoutes.js');
const controller = read('controllers/highRiskFinanceController.js');
const guard = read('middleware/highRiskPaymentMiddleware.js');
const schema = read('migrations/20260905_high_risk_finance.sql');
const client = read('public/admin-dashboard.js');

assert.match(routes, /requireStepUp\('CHANGE_SUPPLIER_BANK_DETAILS'\)/);
assert.match(routes, /requireStepUp\('REVEAL_PAYROLL_BANK_DETAILS'\)/);
assert.match(routes, /requireStepUp\('APPROVE_HIGH_VALUE_PAYMENT'\)/);
assert.match(financeRoutes, /highRiskPaymentGuard/);
assert.match(controller, /SELF_APPROVAL_FORBIDDEN/);
assert.match(controller, /BANK_DETAILS_VIEWED/);
assert.match(controller, /PAYROLL_BANK_DETAILS_VIEWED/);
assert.match(controller, /status = 'SUPERSEDED'/);
assert.match(guard, /SUPPLIER_BANK_DETAILS_RECENTLY_CHANGED/);
assert.match(guard, /DUAL_APPROVAL_REQUIRED/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS sensitive_bank_details/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS bank_detail_change_requests/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS payment_approval_requests/);
assert.match(client, /BANK DETAILS RECENTLY CHANGED/);
assert.match(client, /High-Risk Approval Queue|loadHighRiskApprovals/);

console.log('High-risk finance tests passed.');
