const assert = require('assert');
const { injectRecoveryAssurance } = require('../services/adminPageRenderer');
const readinessController = require('../controllers/readinessController');

const sample = '<html><head></head><body><section id="securitySection"><div class="metric-grid security-metric-grid"></div></section></body></html>';
const rendered = injectRecoveryAssurance(sample);
assert(rendered.includes('id="recoveryAssurancePanel"'));
assert(rendered.includes('/recovery-assurance.css?v=20260917'));
assert(rendered.includes('/recovery-assurance.js?v=20260917'));
assert.equal((rendered.match(/id="recoveryAssurancePanel"/g) || []).length, 1);
assert.equal((injectRecoveryAssurance(rendered).match(/id="recoveryAssurancePanel"/g) || []).length, 1, 'injection must be idempotent');

(async () => {
  const original = { ...process.env };
  process.env.NODE_ENV = 'production';
  process.env.BACKUP_STATUS_PROVIDER = 'unverified';
  process.env.BACKUP_ASSURANCE_REQUIRED = 'false';
  process.env.BACKUP_MAX_AGE_HOURS = '26';
  process.env.RESTORE_TEST_MAX_AGE_DAYS = '90';
  delete process.env.BACKUP_STATUS_URL;
  delete process.env.BACKUP_STATUS_TOKEN;

  const headers = {};
  let payload = null;
  const res = {
    setHeader(name, value) { headers[name] = value; },
    json(value) { payload = value; return value; }
  };
  await readinessController.recovery({}, res);

  assert(payload);
  assert.equal(payload.state, 'unverified');
  assert.equal(payload.ready, false);
  assert.equal(payload.mandatory, false);
  assert.equal(payload.provider_connected, false);
  assert.equal(payload.provider_claim, 'unverified');
  assert.equal(payload.thresholds.backup_max_age_hours, 26);
  assert.equal(payload.thresholds.restore_test_max_age_days, 90);
  assert(payload.guidance.some((item) => item.id === 'railway_backup_schedule'));
  assert(payload.guidance.some((item) => item.id === 'restore_drill'));
  assert(payload.guidance.some((item) => item.id === 'mandatory_gate'));
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert(!JSON.stringify(payload).includes('BACKUP_STATUS_TOKEN'));

  process.env = original;
  console.log('Recovery Assurance dashboard tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
