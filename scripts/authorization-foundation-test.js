const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  activePermissionProjection,
  canAccessUserRecord,
  effectivePermissions,
  hasPermission
} = require('../services/authorizationService');

const user = (role, permissions = []) => ({ id: 10, role, permissions });

assert.equal(effectivePermissions(user('staff')).size, 0);
assert.equal(hasPermission(user('admin'), 'MANAGE_ROLES'), true);
assert.equal(hasPermission(user('admin'), 'MANAGE_SECURITY'), false);
for (const role of ['finance_admin', 'finance_user', 'accountant', 'hr', 'manager', 'supervisor', 'sales', 'production', 'unknown_role']) {
  assert.equal(effectivePermissions(user(role)).size, 0, 'legacy operational roles must not acquire administration privileges');
}
const archivedFlags = ['finance', 'settings', 'VIEW_BANKING', 'VIEW_RFQS', 'VIEW_DASHBOARD'];
for (const role of ['staff', 'admin', 'super_admin']) {
  for (const permission of archivedFlags) assert.equal(hasPermission(user(role, archivedFlags), permission), false, 'retired grants must be inert even for privileged users');
}
assert.equal(hasPermission(user('staff', ['settings']), 'MANAGE_USERS'), false, 'retired UI aliases must not become administrator authority');
assert.equal(hasPermission(user('finance_admin', ['MANAGE_USERS']), 'MANAGE_USERS'), true, 'explicit retained canonical grants remain authoritative');
assert.deepEqual(activePermissionProjection(JSON.stringify([...archivedFlags, 'VIEW_AUDIT_LOG', 'view_audit_log'])), ['VIEW_AUDIT_LOG']);
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
}

runRecordScopeTests()
  .then(() => console.log('Authorization foundation tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
