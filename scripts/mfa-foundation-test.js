const assert = require('assert');
const crypto = require('crypto');

process.env.MFA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const mfa = require('../services/mfaService');
const fs = require('fs');
const path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

assert(mfa.requiresMfa('super_admin'), 'super admin must require MFA');
assert(mfa.requiresMfa('finance_admin'), 'finance admin must require MFA');
assert(!mfa.requiresMfa('staff'), 'staff MFA should be optional by default');
assert(read('services/mfaService.js').includes('aes-256-gcm'), 'TOTP secrets must use authenticated encryption');
assert(read('services/mfaService.js').includes("createHmac('sha256'"), 'challenge and recovery values must be keyed hashes');
assert(read('services/mfaService.js').includes('last_used_step'), 'TOTP login replay prevention must track the last used timestep');
assert(read('controllers/authController.js').includes("assuranceLevel: 1"), 'password-only sessions must be level 1');
assert(read('controllers/mfaController.js').includes('assuranceLevel: 2'), 'MFA sessions must be level 2');
assert(read('public/mfa.js').includes('sessionStorage'), 'short-lived pre-auth challenge should not use persistent storage');
assert(!read('public/mfa.js').includes("localStorage.setItem('vv_mfa_challenge'"), 'MFA challenge must not persist in localStorage');
assert.strictEqual(mfa._test.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082', 'TOTP must match RFC 6238 SHA-1 test vector reduced to six digits');

console.log('MFA foundation tests passed.');
