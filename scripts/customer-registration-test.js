const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bcrypt = require('bcryptjs');
const contracts = require('../middleware/publicEndpointProtection');
const { botChallenge } = require('../services/botChallengeService');
const { validatePassword } = require('../services/passwordPolicy');
const { hasPermission } = require('../services/authorizationService');

// Execute the production route and controller with an isolated in-memory DB.
// No app server, production identity, email, or persistent DB is used.
function loadIsolatedModule(relativePath, dependencies, extra = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    ...extra,
    require(name) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        throw new Error(`Unexpected dependency in registration test: ${name}`);
      }
      return dependencies[name];
    }
  });
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
  return module.exports;
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function invoke(handlers, body) {
  const req = { body, headers: {}, ip: '127.0.0.1', get: () => '' };
  const res = response();
  for (const handler of handlers) {
    let continued = false;
    await handler(req, res, (error) => {
      if (error) throw error;
      continued = true;
    });
    if (!continued) break;
  }
  return res;
}

async function run() {
  const inserts = [];
  const lookups = [];
  let existingAccount = false;
  let schemaChecks = 0;
  const db = {
    async query(sql, params) {
      if (sql.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
        lookups.push(params[0]);
        return [existingAccount ? [{ id: 1 }] : []];
      }
      if (sql.includes('INSERT INTO users')) {
        inserts.push({ sql, params });
        return [{ insertId: 100 + inserts.length, affectedRows: 1 }];
      }
      throw new Error('Unexpected registration database query');
    }
  };
  const controller = loadIsolatedModule('controllers/authController.js', {
    bcryptjs: bcrypt,
    '../config/db': db,
    '../services/authorizationService': require('../services/authorizationService'),
    '../utils/session': {},
    '../services/userLifecycleService': { async ensureUserLifecycleSchema() { schemaChecks += 1; } },
    '../services/securitySchema': {},
    '../services/sessionService': {},
    '../services/passwordPolicy': { validatePassword },
    '../services/authSessionService': {},
    '../services/mfaService': {}
  });

  const registeredRoutes = new Map();
  const router = {};
  for (const method of ['post', 'get', 'delete']) {
    router[method] = (route, ...handlers) => registeredRoutes.set(`${method} ${route}`, handlers);
  }
  const registrationEnv = {};
  const passThrough = (req, res, next) => next();
  loadIsolatedModule('routes/authRoutes.js', {
    express: { Router: () => router },
    '../controllers/authController': controller,
    '../middleware/auth': passThrough,
    '../middleware/securityMiddleware': { authRateLimit: () => passThrough },
    '../middleware/publicEndpointProtection': contracts,
    '../services/botChallengeService': { botChallenge: (endpoint) => botChallenge(endpoint, { env: {} }) },
    '../controllers/securityAuthController': {},
    '../controllers/mfaController': {},
    '../controllers/stepUpController': {}
  }, { process: { env: registrationEnv } });

  const handlers = registeredRoutes.get('post /customer-register');
  assert(handlers, 'public customer registration route must exist');
  const validBody = {
    name: '  Test Customer  ',
    email: '  Buyer@Example.com  ',
    password: 'Hills!River8Orbits$Stars',
    confirm_privacy: true
  };

  let res = await invoke(handlers, validBody);
  assert.equal(res.statusCode, 404, 'disabled registration must deny before DB access');
  assert.equal(schemaChecks, 0);
  assert.equal(inserts.length, 0);

  registrationEnv.ALLOW_PUBLIC_CUSTOMER_REGISTRATION = 'true';
  for (const extra of [{ role: 'super_admin' }, { permissions: ['VIEW_FINANCE', 'MANAGE_USERS'] }]) {
    res = await invoke(handlers, { ...validBody, ...extra });
    assert.equal(res.statusCode, 400, 'public contract must reject privilege fields');
    assert.equal(res.body.code, 'REQUEST_VALIDATION_FAILED');
  }
  assert.equal(inserts.length, 0);

  res = await invoke(handlers, { ...validBody, confirm_privacy: false });
  assert.equal(res.statusCode, 400, 'privacy consent must be explicit');
  res = await invoke(handlers, { ...validBody, confirm_privacy: 'true' });
  assert.equal(res.statusCode, 400, 'truthy strings must not bypass consent validation');
  res = await invoke(handlers, { ...validBody, password: 'short' });
  assert.equal(res.statusCode, 400, 'controller must enforce password policy');
  assert.match(res.body.message, /Password must be at least/);
  res = await invoke(handlers, { ...validBody, email: 'invalid' });
  assert.equal(res.statusCode, 400);
  assert.equal(inserts.length, 0);

  res = await invoke(handlers, validBody);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /Customer account created/);
  assert.equal(inserts.length, 1);
  const inserted = inserts[0];
  assert.equal(inserted.params[0], 'Test Customer');
  assert.equal(inserted.params[2], 'buyer@example.com');
  assert.equal(lookups.at(-1), 'buyer@example.com');
  assert.notEqual(inserted.params[3], validBody.password, 'password must never be stored in plaintext');
  assert.equal(await bcrypt.compare(validBody.password, inserted.params[3]), true);
  assert.equal(inserted.params[4], 'viewer');
  assert.deepEqual(JSON.parse(inserted.params[5]), []);
  const newCustomer = { role: inserted.params[4], permissions: JSON.parse(inserted.params[5]) };
  for (const permission of ['VIEW_FINANCE', 'VIEW_BANKING', 'POST_TRANSACTION', 'MANAGE_USERS', 'MANAGE_ROLES']) {
    assert.equal(hasPermission(newCustomer, permission), false, `customer must not receive ${permission}`);
  }

  existingAccount = true;
  res = await invoke(handlers, validBody);
  assert.equal(res.statusCode, 409, 'existing account must not be overwritten');
  assert.equal(inserts.length, 1);

  // The controller itself also fixes the role/grants if called without a route contract.
  existingAccount = false;
  res = await invoke([controller.customerRegister], {
    ...validBody,
    role: 'super_admin',
    permissions: ['MANAGE_USERS', 'VIEW_FINANCE']
  });
  assert.equal(res.statusCode, 200);
  assert.equal(inserts[1].params[4], 'viewer');
  assert.deepEqual(JSON.parse(inserts[1].params[5]), []);

  console.log('Customer registration tests passed: feature gate, consent/password checks, normalized identity, hashed password, duplicate protection, and customer-only permissions.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
