const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  canAccessUserRecord,
  effectivePermissions,
  hasPermission
} = require('../services/authorizationService');

const user = (role, permissions = []) => ({ id: 10, role, permissions });

assert.equal(hasPermission(user('staff'), 'VIEW_DASHBOARD'), true);
assert.equal(hasPermission(user('staff'), 'VIEW_FINANCE'), false);
assert.equal(hasPermission(user('staff'), 'VIEW_OWN_TIMESHEET'), true);
assert.equal(hasPermission(user('admin'), 'MANAGE_ROLES'), true);
assert.equal(hasPermission(user('admin'), 'MANAGE_SECURITY'), false);
assert.equal(hasPermission(user('manager'), 'MANAGE_TEAM_JOBS'), true);
assert.equal(hasPermission(user('manager'), 'MANAGE_JOBS'), false);
assert.equal(hasPermission(user('manager'), 'VIEW_ALL_TIMESHEETS'), false);
assert.equal(hasPermission(user('finance_user'), 'POST_TRANSACTION'), true);
assert.equal(hasPermission(user('finance_user'), 'VOID_TRANSACTION'), false);
assert.equal(hasPermission(user('finance_user'), 'SEND_COMPANY_EMAIL'), true);
assert.equal(hasPermission(user('finance_user'), 'MANAGE_COMPANY_EMAIL'), false);
assert.equal(hasPermission(user('accountant'), 'VIEW_FINANCE'), true);
assert.equal(hasPermission(user('accountant'), 'EDIT_FINANCE'), false);
assert.equal(hasPermission(user('viewer'), 'VIEW_BANKING'), false);
assert.equal(hasPermission(user('unknown_role'), 'VIEW_DASHBOARD'), false);
assert.equal(hasPermission(user('staff', ['finance']), 'VIEW_FINANCE'), true);
assert.equal(hasPermission(user('staff', ['settings']), 'MANAGE_USERS'), true);
assert.equal(effectivePermissions(user('super_admin')).has('MANAGE_SECURITY'), true);

const root = path.join(__dirname, '..');
const permissionMiddleware = fs.readFileSync(path.join(root, 'middleware/permissionMiddleware.js'), 'utf8');
const inputPermissionMiddleware = fs.readFileSync(path.join(root, 'middleware/inputPermissionMiddleware.js'), 'utf8');
const userController = fs.readFileSync(path.join(root, 'controllers/userController.js'), 'utf8');
const timesheetService = fs.readFileSync(path.join(root, 'services/timesheetWorkflowService.js'), 'utf8');
const taskController = fs.readFileSync(path.join(root, 'controllers/taskController.js'), 'utf8');
const expenseRoutes = fs.readFileSync(path.join(root, 'routes/expenseRoutes.js'), 'utf8');
const invoiceRoutes = fs.readFileSync(path.join(root, 'routes/invoiceRoutes.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const uploadRoutes = fs.readFileSync(path.join(root, 'routes/uploadRoutes.js'), 'utf8');
const authController = fs.readFileSync(path.join(root, 'controllers/authController.js'), 'utf8');

assert.equal(permissionMiddleware.includes("['admin', 'super_admin']"), false);
assert.equal(inputPermissionMiddleware.includes("['admin', 'super_admin']"), false);
assert.match(userController, /You cannot modify your own role or permissions/);
assert.match(userController, /USER_ACCESS_CHANGED/);
assert.match(timesheetService, /u\.manager_id = \?/);
assert.match(timesheetService, /canApproveTimesheet/);
assert.match(taskController, /canManageTaskTarget/);
assert.match(taskController, /MANAGE_TEAM_JOBS/);
assert.match(expenseRoutes, /POST_TRANSACTION/);
assert.match(expenseRoutes, /VOID_TRANSACTION/);
assert.match(invoiceRoutes, /SEND_COMPANY_EMAIL/);
assert.match(app, /requireUploadPermission/);
assert.match(app, /requirePermission\('VIEW_FINANCE'\).*express\.static/);
assert.match(uploadRoutes, /requireAnyPermission\('EDIT_RFQS'\)/);
assert.match(authController, /exports\.me[\s\S]*const permissions = parsePermissions\(user\.permissions\);[\s\S]*effective_permissions/);

async function runRecordScopeTests() {
  const directReportDb = {
    async query(sql, params) {
      assert.match(sql, /manager_id = \?/);
      return [[Number(params[0]) === 20 && Number(params[1]) === 10 ? { id: 20 } : undefined]];
    }
  };

  assert.equal(await canAccessUserRecord(user('staff'), 10, {
    own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: directReportDb
  }), true);
  assert.equal(await canAccessUserRecord(user('manager'), 20, {
    own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: directReportDb
  }), true);
  assert.equal(await canAccessUserRecord(user('manager'), 30, {
    own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: directReportDb
  }), false);
  assert.equal(await canAccessUserRecord(user('hr'), 30, {
    own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: directReportDb
  }), true);
}

runRecordScopeTests()
  .then(() => console.log('Authorization foundation tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
