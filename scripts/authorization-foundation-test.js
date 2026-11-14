const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  activePermissionProjection,
  canAccessUserRecord,
  canEditTimesheetRecord,
  effectivePermissions,
  hasPermission
} = require('../services/authorizationService');

const user = (role, permissions = []) => ({ id: 10, role, permissions });

assert.equal(hasPermission(user('staff'), 'VIEW_OWN_JOBS'), true);
assert.equal(hasPermission(user('staff'), 'MANAGE_USERS'), false);
assert.equal(hasPermission(user('admin'), 'MANAGE_ROLES'), true);
assert.equal(hasPermission(user('admin'), 'MANAGE_SECURITY'), false);
for (const role of ['finance_admin', 'finance_user', 'accountant', 'hr', 'manager', 'supervisor', 'sales', 'production']) {
  assert.equal(hasPermission(user(role), 'MANAGE_USERS'), false, 'operational roles do not acquire account administration');
  assert.equal(hasPermission(user(role), 'VIEW_DASHBOARD'), true, 'original role workflows remain available');
}
assert.equal(effectivePermissions(user('unknown_role')).size, 0);
const archivedFlags = ['VIEW_BANKING', 'VIEW_BANK_DETAILS', 'CREATE_JOURNAL', 'finance_setup', 'finance_reconcile', 'settings'];
for (const role of ['staff', 'admin', 'super_admin']) {
  for (const permission of archivedFlags) assert.equal(hasPermission(user(role, archivedFlags), permission), false, 'retired Banking/Finance grants remain inert');
}
assert.equal(hasPermission(user('staff', ['settings']), 'MANAGE_USERS'), false, 'stale UI aliases must not become administrator authority');
assert.equal(hasPermission(user('finance_admin', ['MANAGE_USERS']), 'MANAGE_USERS'), true, 'explicit canonical grants remain authoritative');
assert.deepEqual(activePermissionProjection(JSON.stringify([...archivedFlags, 'rfqs', 'VIEW_AUDIT_LOG', 'view_audit_log'])), ['VIEW_RFQS', 'VIEW_AUDIT_LOG']);
assert.equal(effectivePermissions(user('super_admin')).has('MANAGE_SECURITY'), true);

const root = path.join(__dirname, '..');
const authorizationMiddleware = fs.readFileSync(path.join(root, 'middleware/authorizationMiddleware.js'), 'utf8');
const userController = fs.readFileSync(path.join(root, 'controllers/userController.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const authController = fs.readFileSync(path.join(root, 'controllers/authController.js'), 'utf8');

assert.match(authorizationMiddleware, /hasAnyPermission/);
assert.match(authorizationMiddleware, /PERMISSION_DENIED/);
assert.match(userController, /You cannot modify your own role or permissions/);
assert.match(userController, /USER_ACCESS_CHANGED/);
assert.match(app, /app\.use\('\/api\/documents',\s*auth,\s*documentSecurityRoutes\)/);
assert(!app.includes("app.use('/uploads'"));
assert.match(authController, /exports\.me[\s\S]*const permissions = activePermissionProjection\(user\.permissions\);[\s\S]*effective_permissions/);

async function runRecordScopeTests() {
  const directReportDb = {
    async query(sql, params) {
      assert.match(sql, /manager_id = \?/);
      return [[Number(params[0]) === 20 && Number(params[1]) === 10 ? { id: 20 } : undefined]];
    }
  };

  const scope = { own: 'VIEW_CONFIDENTIAL_FILES', team: 'VIEW_AUDIT_LOG', all: 'MANAGE_USERS', connection: directReportDb };
  assert.equal(await canAccessUserRecord(user('staff', ['VIEW_CONFIDENTIAL_FILES']), 10, {
    ...scope
  }), true);
  assert.equal(await canAccessUserRecord(user('staff', ['VIEW_AUDIT_LOG']), 20, {
    ...scope
  }), true);
  assert.equal(await canAccessUserRecord(user('staff', ['VIEW_AUDIT_LOG']), 30, {
    ...scope
  }), false);
  assert.equal(await canAccessUserRecord(user('admin'), 30, {
    ...scope
  }), true);

  // The old delegated reviewer grant and the explicit edit grant have exactly
  // the same scope, including when a permission boundary uses the other name.
  for (const [previous, current, allStaff] of [
    ['APPROVE_TEAM_TIMESHEET', 'EDIT_TEAM_TIMESHEET', false],
    ['APPROVE_ALL_TIMESHEETS', 'EDIT_ALL_TIMESHEETS', true]
  ]) {
    for (const [grant, boundary] of [[previous, current], [current, previous]]) {
      for (const source of ['permissions', 'temporary_permissions', 'break_glass_permissions']) {
        const reviewer = { id: 10, role: 'unknown_role', [source]: [grant], permission_boundary: [boundary] };
        assert(hasPermission(reviewer, previous));
        assert(hasPermission(reviewer, current));
        assert.equal(await canEditTimesheetRecord(reviewer, 20, directReportDb), true, source + ' retains an assigned employee');
        assert.equal(await canEditTimesheetRecord(reviewer, 30, directReportDb), allStaff, source + ' cannot expand a team grant to other employees');
        assert.equal(await canEditTimesheetRecord(reviewer, 10, directReportDb), false, 'Even delegated all-staff authority cannot edit its own employee timesheet');
      }
      const constrained = { id: 10, role: 'unknown_role', permissions: [grant], permission_boundary: ['VIEW_ALL_TIMESHEETS'] };
      assert.equal(hasPermission(constrained, current), false, 'Read-only boundaries exclude both edit names');
      assert.equal(hasPermission(constrained, previous), false);
      assert.equal(await canEditTimesheetRecord(constrained, 20, directReportDb), false);
    }
  }
  for (const permissions of [['VIEW_OWN_TIMESHEET'], ['VIEW_TEAM_TIMESHEET'], ['VIEW_ALL_TIMESHEETS'], ['VIEW_ATTENDANCE']]) {
    assert.equal(await canEditTimesheetRecord(user('unknown_role', permissions), 20, directReportDb), false, 'Viewing attendance/timesheets never grants editing');
  }
  const mismatchedScope = { id: 10, role: 'unknown_role', permissions: ['EDIT_ALL_TIMESHEETS'], permission_boundary: ['APPROVE_TEAM_TIMESHEET'] };
  assert.equal(await canEditTimesheetRecord(mismatchedScope, 20, directReportDb), false, 'A boundary cannot invent a different scoped grant');
  assert.equal(await canEditTimesheetRecord(user('staff'), 20, directReportDb), false);
  assert.equal(await canEditTimesheetRecord(user('admin'), 10, directReportDb), false, 'Administrator role does not bypass the own-employee restriction');
  for (const value of [0, -1, NaN, 'not-an-employee']) assert.equal(await canEditTimesheetRecord(user('admin'), value, directReportDb), false);
  for (const id of [undefined, 0, -1, NaN]) assert.equal(await canEditTimesheetRecord({ role: 'super_admin', id }, 20, directReportDb), false, 'A role name cannot replace an authenticated actor identity');
  let reportsToActor = true;
  const changedTeam = { async query() { return [reportsToActor ? [{ id: 20 }] : []]; } };
  const teamEditor = user('unknown_role', ['EDIT_TEAM_TIMESHEET']);
  assert.equal(await canEditTimesheetRecord(teamEditor, 20, changedTeam), true);
  reportsToActor = false;
  assert.equal(await canEditTimesheetRecord(teamEditor, 20, changedTeam), false, 'Authority is re-evaluated after team reassignment');
}

runRecordScopeTests()
  .then(() => console.log('Authorization foundation tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
