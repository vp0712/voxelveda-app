'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const root = path.resolve(__dirname, '..');

function isolated(relative, dependencies, env = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, Map, Set, Promise, Date, setTimeout, clearTimeout,
    console, process: { env },
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith('node:')) return require(name);
      throw new Error(`Unexpected retirement fixture dependency in ${relative}: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}

// Exercise real Express request matching and HTML rendering without opening a
// socket or connecting to the database, SMTP, Railway or any external service.
function request(app, url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const req = new http.IncomingMessage(socket);
    req.url = url;
    req.method = method;
    req.headers = { host: 'app.voxelveda.com', accept: 'text/html', ...headers };
    req.push(null);
    const res = new http.ServerResponse(req);
    const chunks = [];
    const timeout = setTimeout(() => reject(new Error(`Fixture request timed out: ${url}`)), 2000);
    res.write = (chunk, encoding) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      res.finished = true;
      clearTimeout(timeout);
      callback?.();
      res.emit('finish');
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.getHeaders(), body: Buffer.concat(chunks).toString('utf8') });
      return res;
    };
    res.on('error', (error) => { clearTimeout(timeout); reject(error); });
    app.handle(req, res, (error) => { clearTimeout(timeout); reject(error || new Error(`Unhandled route: ${url}`)); });
  });
}

function applicationFixture() {
  const jwt = require('jsonwebtoken');
  const testSecret = 'retirement-test-only-secret-never-used-outside-this-fixture';
  const testToken = jwt.sign({ id: 17, role: 'viewer' }, testSecret, { expiresIn: '5m' });
  const effects = { database: 0, schemas: 0, routes: 0 };
  const actualPageAuth = isolated('middleware/pageAuth.js', {
    path, jsonwebtoken: jwt,
    '../config/db': { async query(sql, params) {
      effects.database += 1;
      assert.match(sql, /FROM users/);
      assert.deepEqual(Array.from(params), [17]);
      return [[{ id: 17, email: 'account@example.invalid', username: 'Fixture account', role: 'viewer',
        permissions: '[]', active: 1, account_status: 'ACTIVE', session_version: 3, mfa_enabled: 0 }]];
    } },
    '../utils/session': require('../utils/session'),
    '../services/userLifecycleService': { async ensureUserLifecycleSchema() { effects.schemas += 1; } },
    '../services/securitySchema': { async ensureSecuritySchema() { effects.schemas += 1; } },
    '../services/sessionService': { async validateSession(token) { return token === testToken ? { session_version: 3, assurance_level: 1 } : null; } },
    '../services/mfaService': { requiresMfa: () => false },
    '../services/authorizationService': { hasPermission: () => false }
  }, { JWT_SECRET: testSecret, NODE_ENV: 'test' });
  const actualReadiness = isolated('controllers/readinessController.js', {
    '../services/runtimeState': require('../services/runtimeState'),
    '../config/backupRestoreAssurance': {}, '../services/recoveryDrillReadiness': {}
  });
  const pass = (req, res, next) => next();
  const router = () => {
    const fixture = express.Router();
    fixture.use((req, res) => { effects.routes += 1; return res.status(401).json({ message: 'Fixture: authentication required' }); });
    return fixture;
  };
  const dependencies = {
    express, cors: require('cors'),
    './controllers/securityTelemetryController': { recordCspViolation: pass },
    './controllers/readinessController': actualReadiness,
    './middleware/auth': pass, './middleware/pageAuth': actualPageAuth,
    './services/globalBrandRenderer': require('../services/globalBrandRenderer'),
    './config/urls': require('../config/urls'),
    './middleware/securityMiddleware': {
      corsOptions: () => ({ origin: 'https://app.voxelveda.com' }),
      csrfProtection: pass, enforceHttps: pass, securityHeaders: pass,
      rateLimitPolicy: () => pass, safeApiResponses: pass,
      safeErrorHandler(error, req, res, next) { return res.status(500).json({ message: 'Fixture error' }); }
    },
    './services/applicationRetirement': require('../services/applicationRetirement')
  };
  for (const name of ['auth', 'user', 'profile', 'settings', 'documentSecurity', 'securityDashboard', 'securityIncident', 'readiness', 'backgroundJob']) {
    dependencies[`./routes/${name}Routes`] = router();
  }
  return { app: isolated('app.js', dependencies, { NODE_ENV: 'test' }), effects, testToken };
}

async function routeBoundaries() {
  const { app, effects, testToken } = applicationFixture();
  const retiredPages = ['/finance', '/finance/reports/RPT_saved/view', '/banking', '/financial-years', '/quality', '/shop-floor',
    '/attendance-terminal', '/employee-id', '/employee/verify/example', '/careers-admin', '/invoices', '/rfqs', '/customers', '/suppliers',
    '/procurement', '/inventory', '/stock', '/tasks', '/roster', '/timesheets', '/expenses', '/qms', '/compliance', '/workflows', '/trash',
    '/request-quote', '/customer.html', '/rfq', '/quotes', '/quotations'];
  const retiredApis = ['/api/finance/accounts', '/api/banking/accounts', '/api/high-risk-finance/payments', '/api/erp/workspace',
    '/api/dashboard', '/api/rfq', '/api/invoice', '/api/customers', '/api/suppliers', '/api/procurement', '/api/stock', '/api/materials',
    '/api/tasks', '/api/meetings', '/api/roster', '/api/attendance', '/api/expenses', '/api/qms', '/api/compliance', '/api/competitors',
    '/api/workflows', '/api/trash', '/api/careers', '/api/employee-identities', '/api/email', '/api/upload', '/api/notifications',
    '/api/integrations', '/api/access-attempts', '/api/security/operations', '/api/security/assurance', '/api/security/governance',
    '/api/public/finance-report/example', '/api/public/careers', '/api/public/employee-id', '/api/public/shift-qr', '/api/public/qms', '/api/public/ai-lead',
    '/api/public/rfq'];
  const retiredAssets = ['/finance.js', '/finance.css', '/banking.js', '/personal-money.js', '/advanced-banking.js', '/premium-banking.css',
    '/report-viewer.js', '/role-portal.css', '/staff.js', '/controlled-forms.js', '/procurement.js', '/workflow.js', '/quality.js', '/shop-floor.js',
    '/customer.js'];
  for (const url of [...retiredPages, ...retiredApis, ...retiredAssets]) {
    const result = await request(app, url);
    assert.equal(result.status, 410, `${url} must explicitly report feature retirement`);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.match(String(result.headers['x-robots-tag']), /noindex/);
    if (url.startsWith('/api/')) {
      assert.match(String(result.headers['content-type']), /^application\/json/);
      assert.equal(JSON.parse(result.body).code, 'MODULE_RETIRED');
    } else {
      assert.match(String(result.headers['content-type']), /^text\/html/);
      assert.match(result.body, /This module is no longer available/);
      assert.doesNotMatch(result.body, /<script[^>]+src=["'][^"']*(?:finance|banking|customer|rfq|role-portal|workspace-shell)/i);
    }
  }
  for (const url of ['/api/public/rfq', '/api/rfq', '/api/invoice', '/api/finance/accounts']) {
    const result = await request(app, url, { method: 'POST', headers: { accept: 'application/json' } });
    assert.equal(result.status, 410, `${url} cannot recreate retired data through POST`);
    assert.equal(JSON.parse(result.body).code, 'MODULE_RETIRED');
  }
  assert.deepEqual(effects, { database: 0, schemas: 0, routes: 0 }, 'Retired routes cannot touch a database, provider or retained API handler');

  for (const url of ['/dashboard?section=account', '/security?tab=sessions', '/profile', '/admin', '/client', '/portal/viewer']) {
    const result = await request(app, url);
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, `/login?returnTo=${encodeURIComponent(url)}`);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.match(String(result.headers['set-cookie']), /vv_session=;/);
  }
  assert.equal(effects.database, 0, 'Anonymous page requests must stop before database access');

  const aliases = { '/workspace.html': '/dashboard', '/security.html': '/security', '/profile.html': '/profile',
    '/login.html': '/login', '/register.html': '/register', '/privacy-policy.html': '/privacy',
    '/mfa.html': '/mfa', '/forgot-password.html': '/forgot-password', '/reset-password.html': '/reset-password',
    '/accept-invite.html': '/accept-invite', '/support.html': '/support', '/terms.html': '/terms', '/careers.html': '/careers' };
  for (const [url, target] of Object.entries(aliases)) {
    const result = await request(app, url + '?from=bookmark');
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, target + '?from=bookmark');
  }
  for (const url of ['/', '/login', '/register', '/privacy', '/terms', '/support', '/careers', '/mfa', '/forgot-password', '/reset-password', '/accept-invite']) {
    const result = await request(app, url);
    assert.equal(result.status, 200, `${url} must render retained HTML`);
    assert.match(String(result.headers['content-type']), /^text\/html/);
    assert.match(result.body, /data-vv-theme="navy-blue"/);
    assert.match(result.body, /\/logo\.png/);
    assert.doesNotMatch(result.body, /(?:href|src)=["'][^"']*(?:\/finance|\/banking|\/request-quote|\/customer(?:\.|\/)|\/rfq|\/quotes|role-portal|advanced-theme|workspace-shell)/i);
  }
  const notFound = await request(app, '/unknown-app-page');
  assert.equal(notFound.status, 404);
  assert.match(notFound.body, /404|not found/i);
  const health = await request(app, '/api/health');
  assert.equal(health.status, 200);
  assert.match(String(health.headers['content-type']), /^application\/json/);
  assert.equal(health.headers['cache-control'], 'no-store');
  const ready = await request(app, '/api/ready');
  assert.equal(ready.status, 503, 'Unbootstrapped runtime must not manufacture database readiness');
  assert.equal(JSON.parse(ready.body).ready, false);

  const authenticated = { headers: { cookie: `vv_session=${testToken}` } };
  const workspace = await request(app, '/dashboard', authenticated);
  assert.equal(workspace.status, 200);
  assert.doesNotMatch(workspace.body, /workspaceRfqForm|rfqSubmit|projectQuantity|Submit request/);
  assert.match(workspace.body, /\/workspace\.js/);
  assert.match(workspace.body, /href="\/profile"/);
  assert.match(workspace.body, /href="\/security"/);
  assert.match(workspace.body, /href="\/support"/);
  for (const id of ['profileName', 'profileEmail', 'logoutButton', 'workspaceStatus', 'retryIdentity']) {
    assert(workspace.body.includes(`id="${id}"`), `Account home must expose its real ${id} control`);
  }
  assert.doesNotMatch(workspace.body, /(?:href|src)=["'][^"']*(?:\/finance|\/banking|\/request-quote|\/customer(?:\.|\/)|\/rfq|role-portal|workspace-shell)/i);
  for (const url of ['/security', '/profile']) {
    const result = await request(app, url, authenticated);
    assert.equal(result.status, 200, `${url} remains available to the same authenticated account`);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.match(result.body, /data-vv-theme="navy-blue"/);
  }
  const invalidSession = await request(app, '/dashboard?from=expired-session', { headers: { cookie: 'vv_session=invalid-fixture-token' } });
  assert.equal(invalidSession.status, 302);
  assert.equal(invalidSession.headers.location, '/login?returnTo=%2Fdashboard%3Ffrom%3Dexpired-session');
  for (const url of ['/admin', '/client', '/portal/admin', '/admin-dashboard.html', '/staff-dashboard.html', '/client-portal.html']) {
    const result = await request(app, url + '?section=account', authenticated);
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, '/dashboard?section=account');
  }
  assert.equal(effects.routes, 0, 'Route verification never writes through retained API handlers');
}

function sourceGraph() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/APPLICATION_REMOVAL_MANIFEST.json'), 'utf8'));
  assert.equal(manifest.baseline, '80733384e62ce47942f5ad19481973f90aa568e0');
  assert(manifest.removed.length > 200, 'The removal manifest must enumerate real source deletion, not menu hiding');
  for (const entry of manifest.removed) {
    assert.equal(fs.existsSync(path.join(root, entry.path)), false, `Retired source remains: ${entry.path}`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  for (const relative of ['controllers/publicRfqController.js', 'public/customer.html', 'public/customer.js', 'scripts/customer-rfq-intake-test.js']) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, `Latest RFQ retirement must physically remove ${relative}`);
    assert(manifest.removed.some((entry) => entry.path === relative), `Removal provenance is missing for ${relative}`);
  }
  const { documentModuleAvailable } = require('../services/applicationRetirement');
  for (const retiredModule of ['finance', 'banking', 'invoice', 'rfq', 'procurement', 'workflow']) {
    assert.equal(documentModuleAvailable(retiredModule), false, `Archived ${retiredModule} documents cannot re-enter the account app`);
  }
  assert.equal(documentModuleAvailable('profile'), true);
  assert.equal(documentModuleAvailable('security'), true);
  if (manifest.preserved_migrations) {
    assert(manifest.preserved_migrations.length > 0);
    for (const entry of manifest.preserved_migrations) {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, entry.path))).digest('hex');
      assert.equal(digest, entry.sha256, `Historical migration modified: ${entry.path}`);
    }
  }
  const roots = manifest.retained_entry_roots;
  assert(roots.includes('app.js') && roots.includes('server.js') && roots.includes('scripts/railway-startup-gateway.js'));
  const seen = new Set();
  const pending = [...roots];
  const retiredSource = /^(?:finance|banking|advancedBanking|premiumBanking|personal(?:Money|Debt|Asset|Net|Spending|Financial|Roadmap)|highRiskFinance|workforce|invoice|supplier|procurement|qms|controlledForm|shiftQr|vom|erp|trash|workflow|attendance|roster|publicRfq|rfq|quote|quotation|customerController)/i;
  while (pending.length) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    seen.add(relative);
    assert.equal(retiredSource.test(path.basename(relative)), false, `Retired runtime remains reachable: ${relative}`);
    const filename = path.join(root, relative);
    assert(fs.existsSync(filename), `Missing retained source: ${relative}`);
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /INSERT\s+INTO\s+(?:`)?(?:customer_rfqs|rfqs|quotations|quotes)(?:`|\s|\()/i, `Retired enquiry writes remain reachable: ${relative}`);
    for (const match of source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!match[1].startsWith('.')) continue;
      const candidate = path.resolve(path.dirname(filename), match[1]);
      const resolved = [candidate, candidate + '.js', candidate + '.json', path.join(candidate, 'index.js')].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
      assert(resolved, `Missing dependency ${match[1]} from ${relative}`);
      if (resolved.endsWith('.js')) pending.push(path.relative(root, resolved));
    }
  }
  const startup = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.doesNotMatch(startup, /(?:start|schedule|ensure)(?:Finance|Banking|Statement|Timesheet|Workflow|Trash|Vom|Qms|Procurement|Workforce)/i);
  assert.doesNotMatch(startup, /(?:statementIngestion|financeIngestion|bankSync|weeklyTimesheet)/i);
  const logoHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'public/logo.png'))).digest('hex');
  assert.equal(logoHash, 'ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312', 'Original company logo must remain byte-identical');
  return seen.size;
}

async function run() {
  const count = sourceGraph();
  await routeBoundaries();
  console.log(`Application retirement tests passed: ${count} retained runtime sources, physical removal manifest, original logo, real Express 410 boundaries, retained HTML, authentication return paths and aliases. No database, email or production writes.`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
