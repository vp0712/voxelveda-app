const assert = require('assert');
const fs = require('fs');
const { assessSupplierPayment } = require('../services/paymentRiskService');
const { safeLocation } = require('../controllers/securityTelemetryController');
const { safeStoredPath } = require('../services/documentSecurityService');
const { csrfProtection, enforceHttps, safeApiResponses } = require('../middleware/securityMiddleware');

function runMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    const state = { statusCode: 200, body: null, redirected: null };
    const res = {
      status(code) { state.statusCode = code; return this; },
      json(body) { state.body = body; resolve({ next: false, ...state }); return this; },
      redirect(code, location) { state.statusCode = code; state.redirected = location; resolve({ next: false, ...state }); return this; }
    };
    try { middleware(req, res, () => resolve({ next: true, ...state, res })); } catch (error) { reject(error); }
  });
}

async function paymentRiskTest() {
  process.env.HIGH_RISK_PAYMENT_THRESHOLD = '5000.00';
  const answers = [
    [[{ id: 7, supplier_id: 9, bill_uid: 'BILL-7', total_amount: '12000.00', paid_amount: '0.00' }]],
    [[{ id: 22, activated_at: new Date(), account_last_four: '1234' }]],
    [[{ payment_count: 4, payment_total: '18000.00' }]],
    [[{ duplicate_count: 1 }]],
    [[{ payment_count: 0 }]]
  ];
  const connection = { query: async () => answers.shift() };
  const risk = await assessSupplierPayment({ billId: 7, amount: '10000.00', actorId: 3, connection });
  assert.equal(risk.requireApproval, true);
  assert.equal(risk.level, 'CRITICAL');
  assert.equal(risk.score, 100);
  for (const reason of ['HIGH_VALUE_PAYMENT', 'SUPPLIER_BANK_DETAILS_RECENTLY_CHANGED', 'FIRST_PAYMENT_TO_CURRENT_BANK_DETAILS', 'POSSIBLE_DUPLICATE_PAYMENT', 'SUPPLIER_PAYMENT_VELOCITY']) {
    assert(risk.reasons.includes(reason), `missing payment risk reason ${reason}`);
  }
  assert.equal(risk.bankDetailId, 22);

  const missingBankAnswers = [
    [[{ id: 8, supplier_id: 10, bill_uid: 'BILL-8', total_amount: '100.00', paid_amount: '0.00' }]],
    [[]],
    [[{ payment_count: 0, payment_total: '0.00' }]],
    [[{ duplicate_count: 0 }]]
  ];
  const missingBank = await assessSupplierPayment({ billId: 8, amount: '100.00', actorId: 3, connection: { query: async () => missingBankAnswers.shift() } });
  assert.equal(missingBank.requireApproval, true);
  assert(missingBank.reasons.includes('SUPPLIER_BANK_DETAILS_NOT_VERIFIED'));
}

async function main() {
  await paymentRiskTest();
  assert.equal(safeLocation('https://app.voxelveda.com/admin?token=secret#value'), 'https://app.voxelveda.com/admin');
  assert.equal(safeLocation('data:text/html,secret'), 'data');
  assert.equal(safeStoredPath('/etc/passwd'), null);

  process.env.ALLOWED_ORIGINS = 'https://app.voxelveda.com';
  const rejected = await runMiddleware(csrfProtection, { method: 'POST', path: '/api/finance', headers: { cookie: 'vv_session=x', authorization: 'Bearer ', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(rejected.statusCode, 403, 'empty Bearer header must not bypass CSRF');
  const accepted = await runMiddleware(csrfProtection, { method: 'POST', path: '/api/finance', headers: { cookie: 'vv_session=x', authorization: 'Bearer real-token' } });
  assert.equal(accepted.next, true, 'explicit bearer credentials are not ambient CSRF credentials');
  process.env.NODE_ENV = 'production';
  const insecureWrite = await runMiddleware(enforceHttps, { method: 'POST', path: '/api/finance', originalUrl: '/api/finance', secure: false, headers: { host: 'app.voxelveda.com' } });
  assert.equal(insecureWrite.statusCode, 400, 'unsafe HTTP methods must not be redirected and replayed');

  const responseState = { payload: null };
  const response = { statusCode: 500, json(body) { responseState.payload = body; return body; } };
  safeApiResponses({ path: '/api/test', requestId: 'req-test' }, response, () => {});
  response.json({ message: 'Failed safely', error: 'SELECT secret FROM users', stack: 'private stack' });
  assert.deepEqual(responseState.payload, { message: 'Failed safely', requestId: 'req-test' });

  const middleware = fs.readFileSync('middleware/securityMiddleware.js', 'utf8');
  const documentService = fs.readFileSync('services/documentSecurityService.js', 'utf8');
  const finance = fs.readFileSync('controllers/highRiskFinanceController.js', 'utf8');
  const financeOperations = fs.readFileSync('controllers/financeOperationsController.js', 'utf8');
  const schema = fs.readFileSync('services/securityOperationsSchema.js', 'utf8');
  const migration = fs.readFileSync('migrations/20260907_phase_37_50_transaction_data_hardening.sql', 'utf8');
  assert(middleware.includes("authorization.slice(7).trim().length > 0"), 'empty Bearer header must not bypass CSRF');
  assert(middleware.includes('Content-Security-Policy-Report-Only'));
  assert(middleware.includes('enforceHttps'));
  assert(documentService.includes("classification === 'RESTRICTED'"));
  assert(documentService.includes("access_policy === 'AUTHENTICATED'"));
  assert(documentService.includes('crypto.randomBytes(32)'));
  assert(documentService.includes('used_at = NOW()'));
  assert(finance.includes('PAYMENT_BANK_DETAILS_CHANGED'));
  assert(financeOperations.includes('PAYMENT_BANK_DETAILS_CHANGED'), 'execution transaction must revalidate the bank-detail version');
  for (const table of ['document_download_grants', 'security_policy_violations']) {
    assert(schema.includes(table));
    assert(migration.includes(table));
  }
  console.log('Phases 37-50 security tests passed.');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
