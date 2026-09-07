const assert = require('assert');
const { effectivePermissions, hasPermission } = require('../services/authorizationService');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const user = (role, permissions = []) => ({ id: 1, role, permissions });

const matrix = [
  ['staff', 'VIEW_OWN_TIMESHEET', true], ['staff', 'VIEW_BANKING', false],
  ['manager', 'VIEW_TEAM_TIMESHEET', true], ['manager', 'VIEW_BANK_DETAILS', false],
  ['finance_user', 'POST_TRANSACTION', true], ['finance_user', 'MANAGE_SECURITY', false],
  ['accountant', 'VIEW_FINANCE', true], ['accountant', 'EDIT_BANK_DETAILS', false],
  ['hr', 'VIEW_PAYROLL_BANKING', true], ['hr', 'APPROVE_PAYMENT', false],
  ['admin', 'MANAGE_USERS', true], ['admin', 'REVOKE_ORGANISATION_SESSIONS', false],
  ['super_admin', 'REVOKE_ORGANISATION_SESSIONS', true], ['super_admin', 'MANAGE_SECURITY_INCIDENTS', true]
];

for (const [role, permission, expected] of matrix) {
  assert.equal(hasPermission(user(role), permission), expected, `${role}/${permission}`);
}
assert(!effectivePermissions(user('unknown-role')).size, 'unknown roles must deny by default');
assert.equal(hasPermission(user('staff', ['role', 'SUPER_ADMIN']), 'MANAGE_SECURITY'), false, 'untrusted role fields must not become permissions');

let nextCalled = false;
let denied;
requireAnyPermission('VIEW_BANKING')(userRequest(user('staff')), responseRecorder((value) => { denied = value; }), () => { nextCalled = true; });
assert.equal(nextCalled, false);
assert.equal(denied.status, 403);

function userRequest(value) { return { user: value }; }
function responseRecorder(record) {
  const state = { status: 200 };
  return { status(code) { state.status = code; return this; }, json(body) { record({ status: state.status, body }); return this; } };
}

console.log('Security role-matrix tests passed.');
