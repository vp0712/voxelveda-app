const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BackgroundJobService, JOB_STATES, safeError } = require('../services/backgroundJobService');
const { BackgroundJobStore } = require('../services/backgroundJobStore');

class MemoryJobStore {
  constructor(now) {
    this.now = now;
    this.leases = new Map();
    this.runs = [];
    this.failures = [];
    this.deadLetters = [];
    this.nextDeadLetterId = 1;
    this.initialized = false;
  }

  async initialize() { this.initialized = true; }

  async acquireLease(input) {
    const existing = this.leases.get(input.jobKey);
    if (existing && existing.expiresAt > this.now().getTime()) return false;
    this.leases.set(input.jobKey, { ...input, expiresAt: this.now().getTime() + input.leaseSeconds * 1000, heartbeatAt: this.now() });
    return true;
  }

  async renewLease(input) {
    const lease = this.leases.get(input.jobKey);
    if (!lease || lease.leaseToken !== input.leaseToken || lease.leaseOwner !== input.leaseOwner || lease.expiresAt <= this.now().getTime()) return false;
    lease.expiresAt = this.now().getTime() + input.leaseSeconds * 1000;
    lease.heartbeatAt = this.now();
    return true;
  }

  async releaseLease(input) {
    const lease = this.leases.get(input.jobKey);
    if (!lease || lease.leaseToken !== input.leaseToken || lease.leaseOwner !== input.leaseOwner) return false;
    this.leases.delete(input.jobKey);
    return true;
  }

  async latestRun(jobKey) {
    return [...this.runs].reverse().find((run) => run.job_key === jobKey) || null;
  }

  async createRun(run, options = {}) {
    const previous = await this.latestRun(run.jobKey);
    if (previous?.status === JOB_STATES.RUNNING) {
      previous.status = JOB_STATES.FAILED;
      previous.error_code = 'JOB_LEASE_EXPIRED';
      previous.completed_at = this.now();
      this.failures.push({ run_uuid: previous.run_uuid, job_key: run.jobKey, error_code: previous.error_code });
    }
    const continues = previous && [JOB_STATES.RUNNING, JOB_STATES.RETRY, JOB_STATES.FAILED].includes(previous.status);
    const attempt = options.resetAttempts ? 1 : (continues ? Number(previous.attempt || 0) + 1 : 1);
    this.runs.push({
      run_uuid: run.runUuid,
      job_key: run.jobKey,
      lease_token: run.leaseToken,
      started_at: this.now(),
      completed_at: null,
      status: JOB_STATES.RUNNING,
      attempt,
      processed_count: 0,
      failed_count: 0,
      deployment_sha: run.deploymentSha,
      trigger_source: run.triggerSource,
      next_attempt_at: null,
      error_code: null
    });
    return attempt;
  }

  async completeRun(input) {
    const run = this.runs.find((item) => item.run_uuid === input.runUuid);
    Object.assign(run, { status: JOB_STATES.COMPLETED, completed_at: this.now(), processed_count: input.processedCount, failed_count: input.failedCount });
  }

  async scheduleRetry(input) {
    const run = this.runs.find((item) => item.run_uuid === input.runUuid);
    Object.assign(run, { status: JOB_STATES.RETRY, completed_at: this.now(), next_attempt_at: input.retryAt, error_code: input.errorCode });
    this.failures.push({ run_uuid: input.runUuid, job_key: input.jobKey, error_code: input.errorCode, retry_at: input.retryAt });
  }

  async deadLetter(input) {
    const run = this.runs.find((item) => item.run_uuid === input.runUuid);
    Object.assign(run, { status: JOB_STATES.DEAD_LETTER, completed_at: this.now(), error_code: input.errorCode });
    this.failures.push({ run_uuid: input.runUuid, job_key: input.jobKey, error_code: input.errorCode });
    for (const item of this.deadLetters) if (item.job_key === input.jobKey && item.status === 'RETRYING') item.status = 'RESOLVED';
    this.deadLetters.push({ id: this.nextDeadLetterId++, run_uuid: input.runUuid, job_key: input.jobKey, attempt: input.attempt, error_code: input.errorCode, error_summary: input.errorSummary, status: 'OPEN', created_at: this.now() });
  }

  async resolveDeadLetters(jobKey, retryRunUuid) {
    for (const item of this.deadLetters) {
      if (item.job_key === jobKey && ['OPEN', 'RETRYING'].includes(item.status)) Object.assign(item, { status: 'RESOLVED', retry_run_uuid: retryRunUuid, resolved_at: this.now() });
    }
  }

  async listHealthData() {
    return {
      leases: [...this.leases.entries()].map(([job_key, lease]) => ({ job_key, lease_active: lease.expiresAt > this.now().getTime(), heartbeat_at: lease.heartbeatAt, lease_expires_at: new Date(lease.expiresAt) })),
      runs: [...this.runs].reverse(),
      deadLetters: [...new Set(this.deadLetters.map((item) => item.job_key))].map((job_key) => ({ job_key, open_count: this.deadLetters.filter((item) => item.job_key === job_key && ['OPEN', 'RETRYING'].includes(item.status)).length }))
    };
  }

  async listDeadLetters(limit, jobKeys = []) { return this.deadLetters.filter((row) => jobKeys.includes(row.job_key)).slice(0, limit); }

  async getDeadLetter(id, jobKeys = []) {
    const item = this.deadLetters.find((candidate) => candidate.id === Number(id) && jobKeys.includes(candidate.job_key));
    if (!item) throw Object.assign(new Error('Not found'), { code: 'BACKGROUND_JOB_NOT_FOUND', statusCode: 404 });
    return item;
  }

  async deadLetterForRetry(id, actorId, jobKeys = []) {
    const item = this.deadLetters.find((candidate) => candidate.id === Number(id) && jobKeys.includes(candidate.job_key));
    if (!item) throw Object.assign(new Error('Not found'), { code: 'BACKGROUND_JOB_NOT_FOUND', statusCode: 404 });
    if (item.status !== 'OPEN') throw Object.assign(new Error('Not open'), { code: 'BACKGROUND_JOB_NOT_OPEN', statusCode: 409 });
    Object.assign(item, { status: 'RETRYING', retry_requested_by: actorId, retry_requested_at: this.now() });
    return item;
  }

  async reopenDeadLetter(id, actorId) {
    const item = this.deadLetters.find((candidate) => candidate.id === Number(id));
    if (!item || item.status !== 'RETRYING' || item.retry_requested_by !== actorId) return false;
    Object.assign(item, { status: 'OPEN', retry_requested_by: null, retry_requested_at: null });
    return true;
  }
}

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

async function testRetiredJobIsolation() {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, job_key: 'finance_retired', status: 'OPEN', created_at: '2026-10-09', error_summary: 'Archived details' }));
  rows.push({ id: 121, job_key: 'email_queue_delivery', status: 'OPEN', created_at: '2026-10-08' });
  const archived = JSON.stringify(rows.slice(0, 120));
  const queries = [];
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (/SELECT .*FROM background_job_dead_letters/s.test(sql) && /WHERE id = \?/.test(sql)) {
      return [rows.filter((row) => row.id === params[0] && params.slice(1).includes(row.job_key))];
    }
    if (/SELECT .*FROM background_job_dead_letters/s.test(sql) && /LIMIT \?/.test(sql)) {
      assert(sql.indexOf('job_key IN') < sql.indexOf('ORDER BY'), 'Filter before ordering/pagination');
      return [rows.filter((row) => params.slice(0, -1).includes(row.job_key)).slice(0, params.at(-1))];
    }
    if (/UPDATE background_job_dead_letters/.test(sql)) {
      assert.match(sql, /job_key IN/, 'A retry claim must repeat the registered-job boundary');
      const row = rows.find((row) => row.id === params[1] && params.slice(2).includes(row.job_key));
      if (row) row.status = 'RETRYING';
      return [{ affectedRows: row ? 1 : 0 }];
    }
    return [[]];
  };
  const store = new BackgroundJobStore({ query, getConnection: async () => ({ query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) });
  const service = new BackgroundJobService({ store });
  service.registerJob({ jobKey: 'email_queue_delivery', handler: async () => ({ processed: 1 }) });
  assert.deepEqual((await service.listDeadLetters(1)).map((row) => row.id), [121], 'Archived rows must not crowd a retained failure out of the first page');
  await assert.rejects(service.getDeadLetter(1), { statusCode: 404 });
  await assert.rejects(service.retryDeadLetter(1, 7), { statusCode: 404 });
  await assert.rejects(store.deadLetterForRetry(1, 7, ['email_queue_delivery']), { statusCode: 404 });
  assert.equal(queries.some(({ sql }) => /^\s*UPDATE\b/.test(sql)), false, 'Retired retries are rejected before any claim mutation');
  assert.equal(JSON.stringify(rows.slice(0, 120)), archived);
  await store.listHealthData(['email_queue_delivery']);
  for (const { sql } of queries.filter(({ sql }) => /FROM background_job_(?:runs|leases)/.test(sql))) {
    assert.match(sql, /WHERE job_key IN/);
    if (sql.includes('LIMIT')) assert(sql.indexOf('job_key IN') < sql.indexOf('LIMIT'));
  }
  const count = queries.length;
  assert.deepEqual(await store.listDeadLetters(5, []), []);
  assert.deepEqual(await store.listHealthData([]), { leases: [], runs: [], deadLetters: [] });
  await assert.rejects(store.getDeadLetter(121, []), { statusCode: 404 });
  assert.equal(queries.length, count, 'An empty registry must not query archived jobs');

  let audits = 0;
  const fixture = { exports: {} };
  new vm.Script(source('controllers/backgroundJobController.js')).runInNewContext({ module: fixture, exports: fixture.exports,
    require(name) {
      if (name === '../config/db') return {};
      if (name === '../services/backgroundJobService') return { backgroundJobService: service };
      if (name === '../services/auditService') return { logAudit: async () => { audits += 1; } };
      throw new Error(`Unexpected worker-controller dependency ${name}`);
    }
  });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await fixture.exports.retryDeadLetter({ params: { id: 1 }, body: { reason: 'Do not retry an archived job' }, user: { id: 7 } }, response, (error) => { throw error; });
  assert.equal(response.statusCode, 404);
  assert.equal(audits, 0, 'Archived job keys/details must never enter new retry audit entries');
  assert.equal(JSON.stringify(rows.slice(0, 120)), archived);
  const retained = await store.deadLetterForRetry(121, 7, ['email_queue_delivery']);
  assert.equal(retained.job_key, 'email_queue_delivery');
  assert.equal(rows[120].status, 'RETRYING', 'A retained failure remains retryable');
}

async function testArchiveSafeRetention() {
  const retirementKeys = ['finance_report_delivery', 'statement_import', 'erp_sync'];
  const queries = [];
  const store = new BackgroundJobStore({ query: async (sql, params = []) => {
    queries.push({ sql, params });
    return [{ affectedRows: 0 }];
  } });
  await store.initialize();
  assert.equal(queries.some(({ sql }) => /^\s*DELETE\b/.test(sql)), false, 'Startup before registration must never prune archived jobs');
  await store.pruneTelemetry({ aggressive: true, jobKeys: ['email_queue_delivery'] });
  const pruneQueries = queries.filter(({ sql }) => /^\s*DELETE\b/.test(sql));
  assert.equal(pruneQueries.length, 3);
  for (const { sql, params } of pruneQueries) {
    assert.match(sql, /WHERE job_key IN \(\?\)/);
    assert.equal(params[0], 'email_queue_delivery');
    assert(sql.indexOf('job_key IN') < sql.indexOf('LIMIT'));
  }
  assert.match(pruneQueries.find(({ sql }) => sql.includes('background_job_failures')).sql, /failed_at/);

  async function recoveryFixture({ failProbe = false } = {}) {
    const archive = Object.fromEntries(['background_job_runs', 'background_job_failures', 'background_job_dead_letters'].map((table) => [table,
      [...retirementKeys.map((job_key, id) => ({ id, job_key, payload: 'retired-record' })), { id: 4, job_key: 'email_queue_delivery' }]
    ]));
    for (const table of ['email_logs', 'email_queue']) archive[table] = ['finance', 'rfq', 'workforce', null, 'unknown', 'auth', 'security', 'contact'].map((related_module, id) => ({ id, related_module }));
    archive.security_events = [{ id: 1, event_type: 'BANK_DETAILS_CHANGED' }, { id: 2, event_type: 'STEP_UP_REQUIRED', module: 'finance' }, { id: 3, event_type: 'LOGIN_FAILURE', module: 'auth' }];
    const before = JSON.stringify(Object.fromEntries(Object.entries(archive).map(([table, rows]) => [table, rows.filter((row) => row.payload === 'retired-record' || ['finance', 'rfq', 'workforce', null, 'unknown'].includes(row.related_module) || row.module === 'finance' || row.event_type === 'BANK_DETAILS_CHANGED')])));
    const calls = [];
    const query = async (sql, params = []) => {
      calls.push({ sql, params });
      assert(!/^\s*(TRUNCATE|DROP)\b/.test(sql), 'Capacity recovery must never truncate or drop archives');
      if (sql.includes('information_schema.tables') && sql.includes('COUNT(*)')) return [[{ count: 1 }]];
      if (sql.includes('information_schema.tables') && sql.includes('SUM(')) return [[{ size_mb: 10, data_free_mb: 0 }]];
      if (sql.includes('information_schema.tables')) return [[]];
      if (/^\s*INSERT/.test(sql)) {
        if (failProbe) throw Object.assign(new Error('table is full'), { code: 'ER_RECORD_FILE_FULL', errno: 1114 });
        return [{ affectedRows: 1 }];
      }
      const match = sql.match(/^DELETE FROM `([^`]+)`/);
      if (match) {
        const table = match[1];
        let eligible;
        if (table.startsWith('background_job_')) {
          assert.match(sql, /WHERE job_key IN/);
          assert.deepEqual([...params], ['email_queue_delivery', 'capacity.probe']);
          eligible = (row) => params.includes(row.job_key);
        } else if (table.startsWith('email_')) {
          assert.match(sql, /WHERE related_module IN/);
          assert.deepEqual([...params], ['auth', 'security', 'contact']);
          eligible = (row) => params.includes(row.related_module);
        } else {
          assert.match(sql, /event_type IN/);
          assert.match(sql, /JSON_EXTRACT\(metadata_json/);
          eligible = (row) => row.event_type === 'LOGIN_FAILURE' && row.module === 'auth';
        }
        const count = archive[table].filter(eligible).length;
        archive[table] = archive[table].filter((row) => !eligible(row));
        return [{ affectedRows: count }];
      }
      throw new Error(`Unexpected capacity fixture SQL: ${sql}`);
    };
    const pool = { query, getConnection: async () => ({ query, beginTransaction: async () => {}, rollback: async () => {}, release() {} }) };
    const fixture = { exports: {} };
    new vm.Script(source('services/databaseCapacityRecoveryService.js')).runInNewContext({ module: fixture, exports: fixture.exports, process: { env: {} }, console: { log() {}, warn() {} },
      require(name) {
        if (name === '../config/db') return pool;
        if (name === 'node:crypto') return require('node:crypto');
        if (name === './securityDataScope') return require('../services/securityDataScope');
        throw new Error(`Unexpected capacity dependency ${name}`);
      }
    });
    if (failProbe) await assert.rejects(fixture.exports.recoverDatabaseCapacity({ force: true }), { code: 'DATABASE_CAPACITY_EXHAUSTED' });
    else assert.equal((await fixture.exports.recoverDatabaseCapacity({ force: true })).writable, true);
    const after = JSON.stringify(Object.fromEntries(Object.entries(archive).map(([table, rows]) => [table, rows.filter((row) => row.payload === 'retired-record' || ['finance', 'rfq', 'workforce', null, 'unknown'].includes(row.related_module) || row.module === 'finance' || row.event_type === 'BANK_DETAILS_CHANGED')])));
    assert.equal(after, before, 'Retired, unknown and unscoped records remain byte-identical during normal and failed capacity recovery');
    assert.equal(calls.filter(({ sql }) => /^\s*INSERT/.test(sql)).length >= 2, true, 'Readiness uses an actual transactional write probe');
  }
  await recoveryFixture();
  await recoveryFixture({ failProbe: true });
}

async function run() {
  await testRetiredJobIsolation();
  await testArchiveSafeRetention();
  let clock = new Date('2026-09-12T00:00:00.000Z');
  const now = () => new Date(clock);
  const shared = new MemoryJobStore(now);
  const replicaA = new BackgroundJobService({ store: shared, leaseOwner: 'replica-a', now, env: { DEPLOYMENT_SHA: 'worker-test' } });
  const replicaB = new BackgroundJobService({ store: shared, leaseOwner: 'replica-b', now, env: { DEPLOYMENT_SHA: 'worker-test' } });
  await replicaA.initialize();
  await replicaB.initialize();

  let releaseHandler;
  let handlerStarted;
  const started = new Promise((resolve) => { handlerStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseHandler = resolve; });
  let executions = 0;
  const singleton = async () => {
    executions += 1;
    handlerStarted();
    await blocked;
    return { processed: 2, failed: 0 };
  };
  for (const replica of [replicaA, replicaB]) replica.registerJob({ jobKey: 'singleton_test', handler: singleton, leaseMs: 60000 });
  const firstRun = replicaA.runJob('singleton_test');
  await started;
  const secondRun = await replicaB.runJob('singleton_test');
  assert.equal(secondRun.skipped, true);
  assert.equal(secondRun.reason, 'lease_held');
  assert.equal(executions, 1, 'two replicas must not execute one singleton lease concurrently');
  releaseHandler();
  const completed = await firstRun;
  assert.equal(completed.status, JOB_STATES.COMPLETED);
  assert.equal(completed.processedCount, 2);

  const crashedLease = await replicaA.acquireLease('singleton_test');
  assert.equal(crashedLease.acquired, true);
  clock = new Date(clock.getTime() + 60001);
  const takeoverLease = await replicaB.acquireLease('singleton_test');
  assert.equal(takeoverLease.acquired, true, 'an expired lease must be recoverable after a process crash');
  await replicaB.releaseLease(takeoverLease);

  let fail = true;
  const retryService = new BackgroundJobService({ store: shared, leaseOwner: 'replica-retry', now, env: { DEPLOYMENT_SHA: 'worker-test' } });
  retryService.registerJob({
    jobKey: 'retry_test',
    handler: async () => {
      if (fail) throw Object.assign(new Error('token=should-not-leak https://secret.invalid/path'), { code: 'TEST_FAILURE' });
      return { processed: 1 };
    },
    maxAttempts: 2,
    retryBaseMs: 1000,
    retryMaxMs: 10000,
    leaseMs: 60000
  });
  await retryService.initialize();
  const retry = await retryService.runJob('retry_test');
  assert.equal(retry.status, JOB_STATES.RETRY);
  assert.equal(new Date(retry.retryAt).getTime(), clock.getTime() + 1000);
  assert.equal((await retryService.runJob('retry_test')).reason, 'retry_wait');
  clock = new Date(clock.getTime() + 1001);
  const exhausted = await retryService.runJob('retry_test');
  assert.equal(exhausted.status, JOB_STATES.DEAD_LETTER);
  assert.equal(shared.deadLetters.length, 1);
  assert(!shared.deadLetters[0].error_summary.includes('should-not-leak'));
  assert(!shared.deadLetters[0].error_summary.includes('secret.invalid'));

  fail = false;
  const manual = await retryService.retryDeadLetter(shared.deadLetters[0].id, 42);
  assert.equal(manual.result.status, JOB_STATES.COMPLETED);
  assert.equal(manual.result.attempt, 1);
  assert.equal(shared.deadLetters[0].status, 'RESOLVED');
  const health = await retryService.health();
  assert.equal(health.state, 'OPERATIONAL');
  assert.equal(health.jobs[0].open_dead_letters, 0);
  assert(!JSON.stringify(health).includes('replica-retry'));

  const blockedRetryStore = new MemoryJobStore(now);
  const blockedRetryService = new BackgroundJobService({ store: blockedRetryStore, leaseOwner: 'manual-retry', now });
  blockedRetryService.registerJob({ jobKey: 'manual_retry_test', handler: async () => ({ processed: 1 }), leaseMs: 60000 });
  blockedRetryStore.deadLetters.push({ id: 1, run_uuid: 'source-run', job_key: 'manual_retry_test', attempt: 2, error_code: 'FAILED', error_summary: 'failed', status: 'OPEN' });
  blockedRetryStore.leases.set('manual_retry_test', { leaseOwner: 'another-replica', leaseToken: 'held', expiresAt: clock.getTime() + 60000 });
  const blockedManualRetry = await blockedRetryService.retryDeadLetter(1, 42);
  assert.equal(blockedManualRetry.result.reason, 'lease_held');
  assert.equal(blockedRetryStore.deadLetters[0].status, 'OPEN', 'failed manual dispatch must not strand a dead letter in RETRYING');

  const migration = source('migrations/20260912_wave_b2_background_job_safety.sql');
  for (const table of ['background_job_leases', 'background_job_runs', 'background_job_failures', 'background_job_dead_letters']) {
    assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing migration table ${table}`);
  }
  const app = source('app.js');
  assert(app.includes("app.use('/api/security/workers',auth,backgroundJobRoutes)"));
  const routes = source('routes/backgroundJobRoutes.js');
  assert(routes.includes("requireAnyPermission('MANAGE_BACKGROUND_JOBS')"));
  assert(routes.includes("requireStepUp('RETRY_BACKGROUND_JOB')"));
  const permissions = source('config/permissionCatalog.js');
  assert(permissions.includes("'MANAGE_BACKGROUND_JOBS'"));
  const server = source('server.js');
  assert(server.includes('await backgroundJobService.initialize()'));
  const controller = source('controllers/backgroundJobController.js');
  assert(controller.indexOf('BACKGROUND_JOB_MANUAL_RETRY_REQUESTED') < controller.indexOf('retryDeadLetter(id'));
  for (const file of ['emailQueueWorker.js']) {
    const worker = source(`services/${file}`);
    assert(worker.includes('backgroundJobService.createScheduler'), `${file} is not registered with the lease scheduler`);
    assert(!worker.includes('setInterval('), `${file} still owns a process-local interval`);
  }
  const redacted = safeError(new Error('password=hunter2 mysql://root:secret@db.local/app'));
  assert(!redacted.summary.includes('hunter2'));
  assert(!redacted.summary.includes('root:secret'));
  console.log('Wave B PR2 distributed worker safety tests passed.');
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
