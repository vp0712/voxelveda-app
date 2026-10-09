const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const authorization = require('../services/authorizationService');
const catalog = require('../config/permissionCatalog');
const { validatePassword } = require('../services/passwordPolicy');

// Execute production controllers/services against synthetic, isolated records.
// Every DB, session, audit and email boundary is explicit; this test never loads
// the configured DB, contacts a provider, or issues a production session.
function isolated(relativePath, dependencies, env = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, Buffer, Date,
    process: { env },
    console: { log() {}, error() {}, warn() {} },
    require(name) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        throw new Error(`Unexpected dependency in active-permission fixture: ${name}`);
      }
      return dependencies[name];
    }
  });
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
  return module.exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const noop = async () => {};
function forbidden(label) { return async () => { throw new Error(`Forbidden fixture side effect: ${label}`); }; }
function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = plain(body); return this; }
  };
}
function request(body = {}, overrides = {}) {
  return {
    user: { id: 1, role: 'super_admin', permissions: [] },
    params: { id: '2' }, body, ip: '127.0.0.1', headers: {},
    get: () => 'permission-boundary-fixture', ...overrides
  };
}
async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function fixtureDatabase() {
  const originalPermissions = ' [ "VIEW_BANKING", "rfqs", "MANAGE_USERS", "VIEW_AUDIT_LOG" ] ';
  const record = {
    id: 2, name: 'Legacy account', username: 'legacy.fixture',
    email: 'legacy@example.invalid', role: 'Finance_Admin',
    permissions: originalPermissions, active: 1, employee_number: 'VV-ARCHIVED',
    department: 'Archived operations', manager_id: 99,
    access_scope: ' { "departments": ["Archived"], "project_ids": [7] } ',
    employment_status: 'ARCHIVED', job_title: 'Archived production role', mfa_enabled: 1,
    account_status: 'ACTIVE', session_version: 1, password: 'fixture-hash'
  };
  const queries = [];
  const mutations = [];
  const db = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, params: plain(params) });
      if (/^SELECT id FROM users WHERE (?:\(LOWER\(email\)|LOWER\(email\))/.test(compact)) return [[]];
      if (/^SELECT /.test(compact) && compact.includes('FROM users')) {
        const selected = { ...record };
        for (const field of ['employee_number', 'department', 'manager_id', 'access_scope', 'employment_status', 'job_title']) {
          if (!new RegExp(`\\b${field}\\b`).test(compact)) delete selected[field];
        }
        return [[selected]];
      }
      if (compact.startsWith('UPDATE users SET name = ?')) {
        mutations.push({ sql: compact, params: plain(params) });
        const keys = ['name', 'username', 'email', 'role', 'permissions', 'active'];
        assert.equal(params.length, 7, 'profile updates must contain only six retained fields and the stable user ID');
        assert.equal(params[6], record.id);
        assert.doesNotMatch(compact, /\b(?:employee_number|department|manager_id|access_scope|employment_status|job_title)\b/);
        keys.forEach((key, index) => { record[key] = params[index]; });
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith('UPDATE users SET role = ?')) {
        mutations.push({ sql: compact, params: plain(params) });
        [record.role, record.permissions, record.active] = params;
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith('UPDATE users SET session_version = session_version + 1, account_status = ?')) {
        mutations.push({ sql: compact, params: plain(params) });
        record.session_version += 1;
        record.account_status = params[0];
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE users SET account_status = 'MFA_SETUP_REQUIRED'")) {
        mutations.push({ sql: compact, params: plain(params) });
        record.account_status = 'MFA_SETUP_REQUIRED';
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected fixture SQL: ${compact}`);
    }
  };
  return { db, record, queries, mutations, originalPermissions };
}

async function run() {
  const f = fixtureDatabase();
  const revokedSessions = [];
  const audits = [];
  let schemaChecks = 0;
  const schemaCheck = async () => { schemaChecks += 1; };
  const security = isolated('services/userSecurityService.js', {
    '../config/db': f.db,
    './securitySchema': { ensureSecuritySchema: noop },
    './securityGovernanceSchema': { ensureSecurityGovernanceSchema: noop },
    crypto
  });
  const controller = isolated('controllers/userController.js', {
    '../config/db': f.db,
    bcryptjs: { hash: forbidden('password hash for an invalid invitation') }, crypto,
    '../services/userLifecycleService': { ensureUserLifecycleSchema: schemaCheck },
    '../services/coreAuditSchema': { ensureCoreAuditSchema: noop },
    '../services/auditService': { logAudit: async (_db, audit) => audits.push(plain(audit)) },
    '../services/securitySchema': { ensureSecuritySchema: schemaCheck },
    '../services/sessionService': {
      revokeUserSessions: async (id, reason) => revokedSessions.push({ id, reason }),
      logSecurityEvent: noop
    },
    '../services/authActionTokenService': { issueToken: forbidden('invitation token'), revokeUserActionTokens: noop },
    '../services/securityEmailService': { queueSecurityLink: forbidden('email') },
    '../config/permissionCatalog': catalog,
    '../services/authorizationService': authorization,
    '../services/segregationPolicyService': { assertNoSegregationConflicts: noop },
    '../services/userSecurityService': { ...security, revokeEveryCredential: forbidden('credential mutation') }
  });
  const preview = isolated('controllers/userAccessPreviewController.js', {
    '../config/db': f.db,
    '../config/permissionCatalog': catalog,
    '../services/authorizationService': authorization,
    '../services/userSecurityService': security
  });

  const registeredRoutes = new Map();
  const router = { use() {}, get() {}, post(route, ...handlers) { registeredRoutes.set(route, handlers); } };
  const passThrough = (_req, _res, next) => next();
  const unreachableController = Object.fromEntries(Object.keys(controller).map((key) => [key, forbidden('router controller reached before rejected retired field')]));
  isolated('routes/userRoutes.js', {
    express: { Router: () => router },
    '../middleware/authMiddleware': passThrough,
    '../middleware/authorizationMiddleware': { requireAnyPermission: () => passThrough },
    '../middleware/stepUpMiddleware': () => passThrough,
    '../middleware/requestContractMiddleware': require('../middleware/requestContractMiddleware'),
    '../controllers/userController': unreachableController,
    '../controllers/userAccessPreviewController': { previewPermissionDifference: forbidden('preview route controller') }
  });
  for (const [route, body] of [
    ['/', { name: 'Fixture', email: 'fixture@example.invalid' }],
    ['/:id', { name: 'Fixture', username: 'fixture', email: 'fixture@example.invalid' }],
    ['/:id/access', { role: 'staff', active: true, permissions: [], reason: 'Fixture reason' }],
    ['/:id/access/preview', { role: 'staff', permissions: [] }]
  ]) {
    for (const field of ['employee_number', 'department', 'manager_id', 'access_scope']) {
      const req = request({ ...body, [field]: 'retired-field-fixture' });
      const res = response();
      for (const handler of registeredRoutes.get(route)) {
        let continued = false;
        await handler(req, res, () => { continued = true; });
        if (!continued) break;
      }
      assert.equal(res.statusCode, 400, `${route} rejects retired ${field}`);
      assert.equal(res.body.code, 'UNSUPPORTED_FIELDS');
      assert.deepEqual(res.body.fields, [field]);
    }
  }

  assert.deepEqual(authorization.activePermissionProjection(f.originalPermissions), ['MANAGE_USERS', 'VIEW_AUDIT_LOG']);
  assert.equal(authorization.hasPermission(f.record, 'MANAGE_USERS'), true);
  for (const permission of ['VIEW_BANKING', 'VIEW_FINANCE', 'VIEW_RFQS', 'rfqs', 'settings', 'dashboard']) {
    assert.equal(authorization.hasPermission({ role: 'super_admin', permissions: [permission] }, permission), false);
  }
  for (const role of ['finance_admin', 'finance_user', 'accountant', 'hr', 'sales', 'production', 'manager', 'supervisor']) {
    assert.equal(authorization.hasPermission({ role, permissions: ['settings', 'rfqs', 'VIEW_BANKING'] }, 'MANAGE_USERS'), false);
    assert.equal(authorization.hasPermission({ role }, 'MANAGE_SECURITY'), false);
  }
  assert.equal(authorization.hasPermission({ role: 'finance_admin', permissions: ['MANAGE_USERS'] }, 'MANAGE_USERS'), true);

  let res = await call(controller.getUsers, request());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.users[0].permissions, ['MANAGE_USERS', 'VIEW_AUDIT_LOG']);
  assert.equal(res.body.users[0].role, 'Finance_Admin');
  assert.equal(f.record.permissions, f.originalPermissions, 'DTO reads must not rewrite archived grants');
  const archivedFields = ['employee_number', 'department', 'manager_id', 'access_scope', 'employment_status', 'job_title'];
  const archivedValues = Object.fromEntries(archivedFields.map((field) => [field, f.record[field]]));
  for (const field of archivedFields) {
    assert.equal(Object.prototype.hasOwnProperty.call(res.body.users[0], field), false, `retained user DTO omits ${field}`);
    assert.equal(f.record[field], archivedValues[field]);
  }

  for (const [field, value] of Object.entries({ department: 'New operations', manager_id: 3, access_scope: {}, employee_number: 'VV-NEW' })) {
    for (const handler of [controller.createUser, controller.updateUser, controller.updateUserAccess, controller.previewPermissionDifference, preview.previewPermissionDifference]) {
      const mutationsBefore = f.mutations.length;
      const queriesBefore = f.queries.length;
      const schemaChecksBefore = schemaChecks;
      res = await call(handler, request({
        name: f.record.name, username: f.record.username, email: f.record.email,
        role: handler === controller.createUser ? 'staff' : 'finance_admin',
        permissions: [], active: true, reason: 'Fixture retired field rejection', [field]: value
      }));
      assert.equal(res.statusCode, 400, `${field}: ${JSON.stringify(res.body)}`);
      assert.equal(f.mutations.length, mutationsBefore, 'retired workforce fields must reject before writes');
      assert.equal(f.queries.length, queriesBefore, 'retired fields reject before database access');
      assert.equal(schemaChecks, schemaChecksBefore, 'retired fields reject before schema initialization');
      for (const archivedField of archivedFields) assert.equal(f.record[archivedField], archivedValues[archivedField]);
    }
  }

  res = await call(controller.updateUser, request({
    name: 'Legacy account renamed', username: f.record.username, email: f.record.email
  }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(f.record.name, 'Legacy account renamed');
  assert.equal(f.record.role, 'Finance_Admin', 'ordinary profile edits preserve the original legacy role ID');
  assert.equal(f.record.permissions, f.originalPermissions, 'ordinary profile edits preserve raw permission JSON byte for byte');
  assert.equal(f.record.account_status, 'ACTIVE');
  for (const field of archivedFields) assert.equal(f.record[field], archivedValues[field], 'ordinary profile edits preserve archived workforce data exactly');

  for (const handler of [controller.previewPermissionDifference, preview.previewPermissionDifference]) {
    const mutationsBefore = f.mutations.length;
    res = await call(handler, request({ role: 'finance_admin', permissions: ['VIEW_AUDIT_LOG'] }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.removed, ['MANAGE_USERS']);
    assert.deepEqual(res.body.added, []);
    assert.equal(f.mutations.length, mutationsBefore, 'previews are read-only');
  }

  for (const retired of ['VIEW_BANKING', 'VIEW_RFQS', 'rfqs', 'settings']) {
    for (const handler of [controller.updateUser, controller.updateUserAccess, controller.previewPermissionDifference, preview.previewPermissionDifference]) {
      const mutationsBefore = f.mutations.length;
      const rawBefore = f.record.permissions;
      const req = request({ name: f.record.name, username: f.record.username, email: f.record.email,
        role: 'finance_admin', permissions: [retired], active: true, reason: 'Fixture invalid-grant check' });
      res = await call(handler, req);
      assert.equal(res.statusCode, 400, `${retired}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'PERMISSION_UNAVAILABLE');
      assert.equal(f.mutations.length, mutationsBefore, 'retired permission requests must not write');
      assert.equal(f.record.permissions, rawBefore);
    }
    const mutationsBefore = f.mutations.length;
    res = await call(controller.createUser, request({
      name: 'Never invited', username: 'never.fixture', email: 'never@example.invalid',
      role: 'staff', permissions: [retired]
    }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'PERMISSION_UNAVAILABLE');
    assert.equal(f.mutations.length, mutationsBefore);
  }

  for (const handler of [controller.updateUser, controller.updateUserAccess, controller.previewPermissionDifference, preview.previewPermissionDifference]) {
    const mutationsBefore = f.mutations.length;
    res = await call(handler, request({ name: f.record.name, username: f.record.username, email: f.record.email,
      role: 'finance_user', permissions: [], active: true, reason: 'Fixture unavailable-role check' }));
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(f.mutations.length, mutationsBefore, 'new assignment of retired roles must not write');
  }
  res = await call(controller.createUser, request({
    name: 'Never invited', username: 'never.fixture', email: 'never@example.invalid',
    role: 'finance_user', permissions: []
  }));
  assert.equal(res.statusCode, 400);

  // Preserve historical role spelling without weakening authority checks.
  const preservedRole = f.record.role;
  const preservedRawPermissions = f.record.permissions;
  f.record.role = 'Super_Admin';
  const nonSuperAdmin = { id: 1, role: 'admin', permissions: [] };
  const protectedAccountChange = {
    name: f.record.name, username: f.record.username, email: f.record.email,
    role: 'viewer', permissions: [], active: true,
    reason: 'Fixture mixed-case super administrator protection'
  };
  for (const handler of [controller.updateUser, controller.updateUserAccess]) {
    const mutationsBefore = f.mutations.length;
    res = await call(handler, request(protectedAccountChange, { user: nonSuperAdmin }));
    assert.equal(res.statusCode, 403, JSON.stringify(res.body));
    assert.equal(f.mutations.length, mutationsBefore, 'mixed-case stored super administrator IDs remain protected before writes');
    assert.equal(f.record.role, 'Super_Admin');
    assert.equal(f.record.permissions, preservedRawPermissions);
  }
  const protectedPreviewMutations = f.mutations.length;
  res = await call(preview.previewPermissionDifference, request(protectedAccountChange, { user: nonSuperAdmin }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.allowed_to_apply, false);
  assert.match(res.body.authority_warning, /Only a super administrator can manage this account/);
  assert.equal(f.mutations.length, protectedPreviewMutations);
  f.record.role = preservedRole;

  const sessionRevocationsBefore = revokedSessions.length;
  res = await call(controller.updateUserAccess, request({
    role: 'finance_admin', permissions: ['VIEW_AUDIT_LOG'], active: true,
    reason: 'Revoke the explicit active administration grant'
  }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(JSON.parse(f.record.permissions), ['VIEW_BANKING', 'rfqs', 'VIEW_AUDIT_LOG']);
  assert.equal(f.record.role, 'Finance_Admin');
  assert.equal(authorization.hasPermission(f.record, 'MANAGE_USERS'), false, 'revoked active grants cannot survive in archived data');
  assert.equal(authorization.hasPermission(f.record, 'VIEW_AUDIT_LOG'), true);
  assert.deepEqual(res.body.permission_difference, { added: [], removed: ['MANAGE_USERS'] });
  assert.equal(revokedSessions.length, sessionRevocationsBefore + 1, 'access changes revoke existing sessions');
  assert.equal(audits.at(-1).action, 'USER_ACCESS_CHANGED');
  assert.deepEqual(audits.at(-1).newValue.permissions, ['VIEW_AUDIT_LOG']);

  f.record.mfa_enabled = 0;
  res = await call(controller.updateUser, request({ name: f.record.name, username: f.record.username, email: f.record.email }));
  assert.equal(res.statusCode, 200);
  assert.equal(f.record.account_status, 'MFA_SETUP_REQUIRED', 'legacy privileged roles retain the MFA setup requirement');

  const mfa = isolated('services/mfaService.js', {
    crypto, '../config/db': { query: forbidden('MFA database access') },
    './securitySchema': { ensureSecuritySchema: forbidden('MFA schema mutation') }
  });
  for (const role of ['super_admin', 'admin', 'finance_admin', 'accountant', 'hr']) {
    assert.equal(mfa.requiresMfa(role), true, `${role} still requires MFA`);
  }
  assert.equal(mfa.requiresMfa('staff'), false);

  let sessionAttempts = 0;
  const auth = isolated('controllers/authController.js', {
    bcryptjs: { compare: async () => true }, '../config/db': f.db,
    '../services/authorizationService': authorization,
    '../utils/session': { clearSessionCookie: noop },
    '../services/userLifecycleService': { ensureUserLifecycleSchema: noop },
    '../services/securitySchema': { ensureSecuritySchema: noop },
    '../services/sessionService': { logSecurityEvent: noop },
    '../services/passwordPolicy': { validatePassword },
    '../services/authSessionService': { createAuthenticatedSession: async () => { sessionAttempts += 1; throw new Error('MFA bypass'); } },
    '../services/mfaService': { requiresMfa: mfa.requiresMfa, issueLoginChallenge: async () => 'local-mfa-fixture' }
  });
  res = await call(auth.me, request({}, { user: { id: 2 } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.user.permissions, ['VIEW_AUDIT_LOG']);
  assert.deepEqual(res.body.user.effective_permissions, ['VIEW_AUDIT_LOG']);
  assert.equal(res.body.user.role, 'finance_admin');
  const authRawPermissions = f.record.permissions;
  res = await call(auth.login, request({ email: f.record.email, password: 'fixture-password-not-stored' }));
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.mfa_required, true);
  assert.equal(res.body.mfa_setup_required, true);
  assert.equal(sessionAttempts, 0, 'a retired privileged role must not bypass the existing MFA challenge');
  assert.equal(f.record.permissions, authRawPermissions);

  const sessionTokens = [];
  const sessionRecords = [];
  const localJwtSecret = 'isolated-active-permission-fixture-only-no-production-token';
  const sessions = isolated('services/authSessionService.js', {
    crypto, jsonwebtoken: jwt,
    './sessionService': { createSession: async (details) => sessionRecords.push(details) },
    '../utils/session': { setSessionCookie: (_req, _res, token) => sessionTokens.push(token) },
    './authorizationService': authorization
  }, { JWT_SECRET: localJwtSecret });
  for (const role of ['finance_admin', 'accountant', 'hr', 'admin', 'staff']) {
    const result = await sessions.createAuthenticatedSession({
      user: { ...f.record, role, permissions: f.originalPermissions }, req: request(), res: response(), assuranceLevel: 2
    });
    assert.deepEqual(plain(result.user.permissions), ['MANAGE_USERS', 'VIEW_AUDIT_LOG']);
    const decoded = jwt.verify(sessionTokens.at(-1), localJwtSecret);
    assert.deepEqual(decoded.permissions, ['MANAGE_USERS', 'VIEW_AUDIT_LOG']);
    assert.equal(decoded.role, role);
    assert.equal(decoded.assurance_level, 2);
    assert.equal(decoded.exp - decoded.iat, role === 'staff' ? 28800 : 7200, 'legacy privileged session lifetime remains unchanged');
    assert.equal(sessionRecords.at(-1).userId, 2);
    assert.equal(sessionRecords.at(-1).assuranceLevel, 2);
  }

  async function seedFixture(env, existing = false) {
    const queries = [];
    const seed = isolated('utils/seedAdmin.js', {
      '../config/db': {
        async query(sql, params = []) {
          queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: plain(params) });
          if (sql.trim().startsWith('SELECT id')) return [existing ? [{ id: 7 }] : []];
          if (sql.includes('ALTER TABLE')) return [{ affectedRows: 0 }];
          if (sql.includes('INSERT INTO users')) return [{ affectedRows: 1, insertId: 7 }];
          throw new Error('Unexpected seed fixture query');
        }
      },
      bcryptjs: { hash: async () => 'isolated-bootstrap-hash' },
      '../services/passwordPolicy': { validatePassword },
      '../config/permissionCatalog': catalog
    }, env);
    return { seed, queries };
  }
  const bootstrapEnv = { ADMIN_EMAIL: 'bootstrap@example.invalid', ADMIN_PASSWORD: 'Hills!River8Orbits$Stars' };
  const productionSeed = await seedFixture({ ...bootstrapEnv, NODE_ENV: 'production' });
  await assert.rejects(productionSeed.seed(), /bootstrap is prohibited in production/);
  assert.equal(productionSeed.queries.length, 0, 'production bootstrap must reject before even schema queries');
  const missingSeed = await seedFixture({ NODE_ENV: 'development' });
  await assert.rejects(missingSeed.seed(), /required for explicit bootstrap/);
  assert.equal(missingSeed.queries.length, 0, 'missing development credentials must reject before schema changes');
  const invalidSeed = await seedFixture({ ...bootstrapEnv, NODE_ENV: 'development', ADMIN_PASSWORD: 'bad' });
  await assert.rejects(invalidSeed.seed(), /Password must be at least/);
  assert.equal(invalidSeed.queries.length, 0);
  const developmentSeed = await seedFixture({ ...bootstrapEnv, NODE_ENV: 'development' });
  await developmentSeed.seed();
  const inserted = developmentSeed.queries.filter(({ sql }) => sql.startsWith('INSERT INTO users'));
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].params[4], 'admin');
  assert.deepEqual(JSON.parse(inserted[0].params[5]), catalog.ROLE_TEMPLATES.admin);
  assert.notEqual(inserted[0].params[3], bootstrapEnv.ADMIN_PASSWORD);
  const existingSeed = await seedFixture({ ...bootstrapEnv, NODE_ENV: 'development' }, true);
  await existingSeed.seed();
  assert.equal(existingSeed.queries.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql)), false, 'bootstrap never overwrites an existing identity');

  console.log('PASS active permission boundaries: archived role/grant preservation, strict mutations, revocation, auth DTO/JWT projection, legacy MFA/session duration, safe explicit bootstrap');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
