'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');

function load(filename, dependencies, env = {}) {
  const module = { exports: {} };
  const requireFixture = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected retained-runtime dependency: ${name}`);
  };
  const context = {
    module, exports: module.exports, require: requireFixture,
    __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, Date, Set, Map, Promise, setTimeout, clearTimeout,
    process: { env, pid: 100, uptime: () => 1 },
    console: { log() {}, warn() {}, error() {} }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}

async function testStartup() {
  for (const databaseFails of [false, true]) {
    const calls = [];
    const runtime = require('../services/runtimeState');
    const schemas = {
      securitySchema: 'ensureSecuritySchema',
      securityOperationsSchema: 'ensureSecurityOperationsSchema',
      operationalTrustSchema: 'ensureOperationalTrustSchema',
      securityGovernanceSchema: 'ensureSecurityGovernanceSchema',
      emailQueueSchema: 'ensureEmailQueueSchema'
    };
    const dependencies = {
      dotenv: { config: () => ({}) },
      './config/security': { validateSecurityEnvironment: () => ({ warnings: [] }) },
      './app': { listen: () => {
        calls.push('listen');
        const server = new EventEmitter();
        server.listening = true;
        server.close = (done) => { server.listening = false; done(); };
        queueMicrotask(() => server.emit('listening'));
        return server;
      } },
      './config/db': { end: async () => calls.push('pool.close') },
      './services/emailService': { isEmailConfigured: () => false },
      './services/emailQueueWorker': {
        startEmailQueueWorker: () => { calls.push('email.start'); return false; },
        stopEmailQueueWorker: () => calls.push('email.stop')
      },
      './services/databaseRuntimeService': {
        verifyDatabaseConnection: async () => {
          calls.push('database');
          if (databaseFails) throw Object.assign(new Error('Connection denied'), { code: 'DB_TEST_DENIED' });
        },
        refreshDatabaseAttestation: async () => calls.push('attestation')
      },
      './services/databaseCapacityRecoveryService': { recoverDatabaseCapacity: async () => calls.push('capacity') },
      './services/migrationRunner': { runMigrations: async () => {
        calls.push('migrations'); return { schema_version: 'retained_fixture', applied: 0, skipped: 1 };
      } },
      './services/outboundRequestPolicy': { allowedHosts: () => new Set() },
      './services/rateLimitService': { getRateLimitService: () => ({
        initialize: async () => { calls.push('limiter'); return { provider: 'REDIS', distributed: true }; },
        close: async () => calls.push('limiter.close')
      }) },
      './services/malwareScannerService': {},
      './services/objectStorageService': {},
      './services/webhookSecurityService': {},
      './config/backupRestoreAssurance': {},
      './services/backgroundJobService': { backgroundJobService: {
        initialize: async () => { calls.push('jobs'); return { registered_jobs: 1 }; }
      } },
      './services/runtimeState': runtime
    };
    for (const [filename, method] of Object.entries(schemas)) {
      dependencies[`./services/${filename}`] = { [method]: async () => calls.push(filename) };
    }
    const server = load(path.join(root, 'server.js'), dependencies, { NODE_ENV: 'production' });
    if (databaseFails) {
      await assert.rejects(server.bootstrap(), { code: 'DB_TEST_DENIED' });
      assert.equal(calls.includes('listen'), false);
      assert.equal(calls.includes('migrations'), false);
      assert.equal(runtime.publicReadiness().ready, false);
      assert.equal(runtime.detailedReadiness().failure.phase, 'CONNECTING_DATABASE');
    } else {
      await server.bootstrap();
      assert.deepEqual(calls, [
        'database', 'capacity', 'migrations', ...Object.keys(schemas),
        'attestation', 'limiter', 'jobs', 'email.start', 'listen'
      ]);
      assert.equal(runtime.publicReadiness().ready, true);
      assert.deepEqual(Object.keys(runtime.publicReadiness().critical_services).sort(), [
        'background_workers', 'database', 'migrations', 'rate_limiter',
        'schema_email_queue', 'schema_operational_trust', 'schema_security',
        'schema_security_governance', 'schema_security_operations'
      ].sort());
      await server.shutdown();
      assert.deepEqual(calls.slice(-3), ['email.stop', 'limiter.close', 'pool.close']);
    }
  }
}

async function testEmailSchema() {
  const statements = [];
  const schema = load(path.join(root, 'services/emailQueueSchema.js'), {
    '../config/db': { query: async (sql) => {
      statements.push(sql);
      if (/^ALTER TABLE/.test(sql)) throw Object.assign(new Error('already exists'), {
        code: /COLUMN/.test(sql) ? 'ER_DUP_FIELDNAME' : 'ER_DUP_KEYNAME'
      });
    } }
  });
  await schema.ensureEmailQueueSchema();
  await schema.ensureEmailQueueSchema();
  assert.equal(statements.length, 4, 'Shared schema promise must prevent repeated initialization');
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS email_queue/);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS email_logs/);
  assert.doesNotMatch(statements.join('\n'), /DROP|DELETE|TRUNCATE|weekly_timesheets|staff|finance/i);

  let attempts = 0;
  const retrySchema = load(path.join(root, 'services/emailQueueSchema.js'), {
    '../config/db': { query: async () => {
      if (++attempts === 1) throw Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
    } }
  });
  await assert.rejects(retrySchema.ensureEmailQueueSchema(), { code: 'ER_ACCESS_DENIED_ERROR' });
  await retrySchema.ensureEmailQueueSchema();
  assert.equal(attempts, 5, 'An unsuccessful schema attempt must be retried, not cached as success');
}

async function testEmailRetirement() {
  const rows = [
    { id: 1, related_module: 'timesheets', status: 'PENDING', subject: 'Retired timesheet' },
    { id: 2, related_module: 'finance', status: 'RETRY', subject: 'Retired report' },
    { id: 3, related_module: null, status: 'PENDING', subject: 'Unclassified old email' },
    { id: 4, related_module: 'contact', status: 'PENDING', subject: 'Contact acknowledgement', to_json: '["fixture@example.invalid"]', attempts: 0 },
    { id: 5, related_module: 'customer_rfqs', status: 'PENDING', subject: 'Retired enquiry' }
  ];
  const retiredBefore = JSON.stringify(rows.filter((row) => row.related_module !== 'contact'));
  const sent = [];
  const queries = [];
  const queue = load(path.join(root, 'services/emailQueue.js'), {
    '../config/db': { query: async (sql, parameters = []) => {
      queries.push({ sql, parameters });
      if (/SELECT \* FROM email_queue/.test(sql)) {
        assert.match(sql, /related_module IN \(\?, \?, \?\)/);
        const allowed = parameters.slice(0, -1);
        return [rows.filter((row) => ['PENDING', 'RETRY'].includes(row.status) && allowed.includes(row.related_module)).slice(0, parameters.at(-1))];
      }
      if (/SET status = 'SENDING'/.test(sql)) {
        const row = rows.find((item) => item.id === parameters[0]);
        if (!row || !parameters.slice(1).includes(row.related_module)) return [{ affectedRows: 0 }];
        row.status = 'SENDING'; return [{ affectedRows: 1 }];
      }
      if (/SET status = 'SENT'/.test(sql)) {
        rows.find((item) => item.id === parameters[1]).status = 'SENT';
      }
      if (/INSERT INTO email_queue/.test(sql)) return [{ insertId: 5 }];
      return [{ affectedRows: 1 }];
    } },
    './emailQueueSchema': { ensureEmailQueueSchema: async () => {} },
    './emailService': {
      sendMail: async (message) => { sent.push(message); return { messageId: 'fixture-provider-accepted' }; },
      normalizeAddressList: (items) => Array.isArray(items) ? items : items ? [items] : [],
      attachmentBuffer: (item) => Buffer.isBuffer(item.content) ? item.content : null,
      isEmailTransportError: () => false,
      classifySmtpFailure: () => ({ code: 'FIXTURE_FAILURE', category: 'fixture' })
    }
  });
  const original = Buffer.from([0, 255, 128, 10, 13, 60, 0, 250]);
  const stored = await queue._test.serializableAttachments([{ filename: 'enquiry.bin', contentType: 'application/octet-stream', content: original }]);
  rows[3].attachments_json = JSON.stringify(stored);
  const outcomes = await queue.processEmailQueue(10);
  assert.equal(outcomes.length, 1);
  assert.equal(sent.length, 1, 'Retired emails must never reach the provider');
  assert.equal(sent[0].subject, 'Contact acknowledgement');
  assert.deepEqual(sent[0].attachments[0].content, original);
  assert.equal(sent[0].attachments[0].filename, 'enquiry.bin');
  assert.equal(JSON.stringify(rows.filter((row) => row.related_module !== 'contact')), retiredBefore, 'Retired queue rows and content remain intact');
  await queue.processEmailQueue(10);
  assert.equal(sent.length, 1);
  await assert.rejects(queue.queueEmail({ relatedModule: 'finance' }), { code: 'EMAIL_MODULE_RETIRED' });
  await assert.rejects(queue.queueEmail({ relatedModule: 'customer_rfqs' }), { code: 'EMAIL_MODULE_RETIRED' });
  await assert.rejects(queue.queueEmail({}), { code: 'EMAIL_MODULE_RETIRED' });
  assert.equal(await queue.queueEmail({ relatedModule: 'contact', to: ['fixture@example.invalid'], subject: 'Allowed', attachments: [] }), 5);
  assert.equal(queries.filter(({ sql }) => /INSERT INTO email_queue/.test(sql)).length, 1);
  const corrupt = JSON.parse(JSON.stringify(stored));
  corrupt[0].content = Buffer.from('wrong').toString('base64');
  assert.throws(() => queue._test.restoreAttachments(corrupt), /integrity check failed/);
}

function testProductionReadiness() {
  const { assessProductionReadiness } = require('../config/productionReadiness');
  const env = {
    NODE_ENV: 'production', JWT_SECRET: 'fixture-jwt-secret-is-long-and-unique',
    SESSION_SECRET: 'fixture-session-secret-is-long-and-unique', MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
    TRUST_PROXY: 'true', DB_HOST: '127.0.0.1', DB_USER: 'fixture', DB_NAME: 'fixture',
    ALLOWED_ORIGINS: 'https://app.voxelveda.com', APP_URL: 'https://app.voxelveda.com'
  };
  assert.equal(assessProductionReadiness(env).ready, true, 'Retired subsystem keys must not gate customer app startup');
  assert.equal(assessProductionReadiness({ ...env, JWT_SECRET: 'weak' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, SESSION_SECRET: env.JWT_SECRET }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, MFA_ENCRYPTION_KEY: 'weak' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, TRUST_PROXY: 'false' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, ALLOWED_ORIGINS: '*' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, DEBUG_AUTH_BYPASS: 'true' }).ready, false);
}

async function testCapacityIsolation() {
  const queries = [];
  const query = async (sql, parameters = []) => {
    queries.push(sql);
    if (/table_name=\?/.test(sql)) return [[{ count: 1 }]];
    if (/SUM\(data_length/.test(sql)) return [[{ size_mb: 1, data_free_mb: 0 }]];
    if (/SELECT table_name/.test(sql)) return [[]];
    return [{ affectedRows: 0 }];
  };
  const connection = {
    query, beginTransaction: async () => {}, rollback: async () => {}, release() {}
  };
  const capacity = load(path.join(root, 'services/databaseCapacityRecoveryService.js'), {
    '../config/db': { query, getConnection: async () => connection }
  });
  const result = await capacity.recoverDatabaseCapacity({ force: true });
  assert.equal(result.writable, true);
  const mutations = queries.filter((sql) => /^\s*(?:DELETE|UPDATE|INSERT|TRUNCATE|DROP)\b/i.test(sql));
  const allowed = new Set(['background_job_runs', 'background_job_failures', 'background_job_dead_letters', 'security_events', 'email_logs', 'email_queue']);
  assert.ok(mutations.length > 0, 'Capacity recovery fixture must exercise retention/probe SQL');
  for (const sql of mutations) {
    const table = sql.match(/^\s*(?:DELETE FROM|INSERT INTO|UPDATE|TRUNCATE TABLE|DROP TABLE)\s+`?([a-z_]+)/i)?.[1];
    assert.ok(allowed.has(table), `Capacity recovery must not mutate a retired record table: ${table}`);
  }
  assert.doesNotMatch(mutations.join('\n'), /statement_import|finance|bank|processing_errors|rfqs|customers|invoices/i);
}

async function run() {
  await testStartup();
  await testEmailSchema();
  await testEmailRetirement();
  testProductionReadiness();
  await testCapacityIsolation();
  console.log('Retained customer runtime, fail-closed startup, email hold and durable content tests passed.');
}

run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
