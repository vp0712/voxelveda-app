const assert = require('assert');
const { effectivePermissions, hasPermission } = require('../services/authorizationService');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const user = (role, permissions = []) => ({ id: 1, role, permissions });

const matrix = [
  ['staff', 'MANAGE_USERS', false], ['staff', 'VIEW_BANKING', false],
  ['manager', 'MANAGE_USERS', false], ['manager', 'VIEW_BANK_DETAILS', false],
  ['finance_user', 'POST_TRANSACTION', false], ['finance_user', 'MANAGE_SECURITY', false],
  ['accountant', 'VIEW_FINANCE', false], ['accountant', 'MANAGE_USERS', false],
  ['hr', 'VIEW_PAYROLL_BANKING', false], ['hr', 'MANAGE_USERS', false],
  ['admin', 'MANAGE_USERS', true], ['admin', 'REVOKE_ORGANISATION_SESSIONS', false],
  ['super_admin', 'REVOKE_ORGANISATION_SESSIONS', true], ['super_admin', 'MANAGE_SECURITY_INCIDENTS', true]
];

for (const [role, permission, expected] of matrix) {
  assert.equal(hasPermission(user(role), permission), expected, `${role}/${permission}`);
}
assert(!effectivePermissions(user('unknown-role')).size, 'unknown roles must deny by default');
for (const role of ['constructor', '__proto__', 'toString']) {
  assert.equal(effectivePermissions(user(role)).size, 0, 'prototype property names must not become role templates');
  assert.equal(hasPermission(user(role, [role]), role), false, 'prototype property names must never resolve to authority aliases');
}
assert.equal(hasPermission(user('staff', ['role', 'SUPER_ADMIN']), 'MANAGE_SECURITY'), false, 'untrusted role fields must not become permissions');
assert.equal(hasPermission(user('finance_admin', ['MANAGE_USERS']), 'MANAGE_USERS'), true, 'retained explicit grants remain valid without promoting the legacy role');
for (const role of ['admin', 'super_admin', 'finance_admin', 'sales']) {
  const archived = ['VIEW_BANKING', 'VIEW_RFQS', 'VIEW_DASHBOARD', 'EDIT_FINANCE', 'rfqs', 'settings'];
  for (const permission of archived) assert.equal(hasPermission(user(role, archived), permission), false, 'stored obsolete permissions must never reactivate');
}

let nextCalled = false;
let denied;
requireAnyPermission('VIEW_BANKING')(userRequest(user('staff')), responseRecorder((value) => { denied = value; }), () => { nextCalled = true; });
assert.equal(nextCalled, false);
assert.equal(denied.status, 403);
nextCalled = false;
requireAnyPermission('MANAGE_USERS')(userRequest(user('admin')), responseRecorder((value) => { denied = value; }), () => { nextCalled = true; });
assert.equal(nextCalled, true, 'retained administration route guards must permit authorized administrators');

function userRequest(value) { return { user: value }; }
function responseRecorder(record) {
  const state = { status: 200 };
  return { status(code) { state.status = code; return this; }, json(body) { record({ status: state.status, body }); return this; } };
}

console.log('Security role-matrix tests passed.');
