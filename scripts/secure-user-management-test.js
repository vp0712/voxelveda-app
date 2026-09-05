const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ACCOUNT_STATES, permissionDifference } = require('../services/userSecurityService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

assert.deepEqual(permissionDifference(['A', 'B'], ['B', 'C']), { added: ['C'], removed: ['A'] });
assert(ACCOUNT_STATES.includes('TERMINATED'));
assert(ACCOUNT_STATES.includes('MFA_SETUP_REQUIRED'));

const routes = read('routes/userRoutes.js');
const controller = read('controllers/userController.js');
const service = read('services/userSecurityService.js');
const schema = read('services/securitySchema.js');
const ui = read('public/admin-dashboard.js');

assert.match(routes, /account-state.*requireStepUp\('TERMINATE_USER_ACCESS'\)/);
assert.match(routes, /compromised.*requireStepUp\('MARK_ACCOUNT_COMPROMISED'\)/);
assert.match(routes, /revoke-sessions.*requireStepUp\('REVOKE_USER_SESSIONS'\)/);
assert.match(routes, /access-review.*requireStepUp\('REVIEW_PRIVILEGED_ACCESS'\)/);
assert(!routes.includes("router.delete('/:id'"), 'normal user-management routes must not hard-delete identities');
assert.match(controller, /You cannot change your own account state/);
assert.match(controller, /last active super administrator cannot be disabled or terminated/);
assert.match(controller, /Privileged users cannot approve their own access review/);
assert.match(controller, /Only a super administrator can grant high-risk permissions/);
assert.match(controller, /PRIVILEGED_MFA_ROLES/);
assert.match(controller, /revokeEveryCredential\(pool, userId, 'ACCESS_DISABLED'\)/);
assert.match(controller, /employee_number = COALESCE/);
assert.match(service, /UPDATE user_api_tokens SET revoked_at/);
assert.match(service, /UPDATE trusted_devices SET revoked_at/);
assert.match(service, /DELETE FROM user_mfa_totp/);
assert.match(service, /DELETE FROM mfa_recovery_codes/);
assert.match(service, /controlled password-reset recovery/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS user_security_actions/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS privileged_access_reviews/);
assert.match(ui, /Permission difference/);
assert.match(ui, /Mark Compromised/);
assert.match(ui, /Terminate Access/);

console.log('Secure user-management tests passed.');
