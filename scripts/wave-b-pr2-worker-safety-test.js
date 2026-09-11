const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { BackgroundJobService, JOB_STATES, safeError } = require('../services/backgroundJobService');

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

  async listDeadLetters() { return this.deadLetters; }

  async getDeadLetter(id) {
    const item = this.deadLetters.find((candidate) => candidate.id === Number(id));
    if (!item) throw Object.assign(new Error('Not found'), { code: 'BACKGROUND_JOB_NOT_FOUND', statusCode: 404 });
    return item;
  }

  async deadLetterForRetry(id, actorId) {
    const item = this.deadLetters.find((candidate) => candidate.id === Number(id));
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

async function run() {
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
  for (const file of ['emailQueueWorker.js', 'trashPurgeService.js', 'workflowEscalationService.js', 'weeklyTimesheetScheduler.js']) {
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
