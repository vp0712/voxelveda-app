const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { canAccessUserRecord } = require('../services/authorizationService');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

const permissionCatalog = read('config/permissionCatalog.js');
const authorizationService = read('services/authorizationService.js');
const authorizationMiddleware = read('middleware/authorizationMiddleware.js');
const inputPermissionMiddleware = read('middleware/inputPermissionMiddleware.js');
const userController = read('controllers/userController.js');
const timesheetService = read('services/timesheetAuthorizationService.js');
const taskController = read('controllers/taskController.js');
const expenseRoutes = read('routes/expenseRoutes.js');
const invoiceRoutes = read('routes/invoiceRoutes.js');
const app = read('app.js');
const uploadRoutes = read('routes/uploadRoutes.js');
const authController = read('controllers/authController.js');

function user(role, id = 10) {
  return { id, role, permissions: '[]', temporary_permissions: '[]', break_glass_permissions: '[]', permission_boundary: null };
}

assert.match(permissionCatalog, /VIEW_OWN_TIMESHEET/);
assert.match(permissionCatalog, /VIEW_TEAM_TIMESHEET/);
assert.match(permissionCatalog, /VIEW_ALL_TIMESHEETS/);
assert.match(permissionCatalog, /APPROVE_TEAM_TIMESHEET/);
assert.match(permissionCatalog, /APPROVE_ALL_TIMESHEETS/);
assert.match(permissionCatalog, /MANAGE_TEAM_JOBS/);
assert.match(permissionCatalog, /VIEW_CONFIDENTIAL_FILES/);
assert.match(permissionCatalog, /VIEW_PAYROLL_BANKING/);
assert.match(permissionCatalog, /APPROVE_PAYROLL_BANK_CHANGE/);
assert.match(permissionCatalog, /ROLE_TEMPLATES/);
assert.match(permissionCatalog, /finance_admin/);
assert.match(permissionCatalog, /accountant/);
assert.match(permissionCatalog, /supervisor/);
assert.match(authorizationService, /permission_boundary/);
assert.match(authorizationService, /temporary_permissions/);
assert.match(authorizationService, /break_glass_permissions/);
assert.match(authorizationMiddleware, /requireAnyPermission/);
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
assert.match(app, /app\.use\('\/api\/documents',\s*auth,\s*documentSecurityRoutes\)/);
assert(!app.includes("app.use('/uploads'"));
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

runRecordScopeTests().then(() => console.log('Authorization foundation tests passed.')).catch((error) => {
  console.error(error);
  process.exit(1);
});
