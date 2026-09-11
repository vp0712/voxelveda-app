const crypto = require('node:crypto');
const os = require('node:os');
const pool = require('../config/db');
const { deploymentSha } = require('./runtimeState');
const { BackgroundJobStore } = require('./backgroundJobStore');

const JOB_STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  RETRY: 'RETRY',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER'
});
const TRIGGERS = new Set(['SCHEDULED', 'STARTUP', 'MANUAL']);
const JOB_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{2,189}$/;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

function safeError(error) {
  const code = String(error?.code || 'BACKGROUND_JOB_FAILED').replace(/[^A-Z0-9_.-]/gi, '_').slice(0, 100);
  const summary = String(error?.message || 'Background job failed')
    .replace(/(password|secret|token|authorization|cookie)\s*[=:]\s*[^\s;,]+/gi, '$1=[redacted]')
    .replace(/(?:mysql|https?):\/\/[^\s]+/gi, '[redacted-url]')
    .slice(0, 1000);
  return { code, summary };
}

function ownerIdentity(env = process.env) {
  const source = [
    env.RAILWAY_REPLICA_ID,
    env.RAILWAY_DEPLOYMENT_ID,
    deploymentSha(env),
    os.hostname(),
    process.pid,
    crypto.randomUUID()
  ].filter(Boolean).join(':');
  return `worker:${crypto.createHash('sha256').update(source).digest('hex').slice(0, 40)}`;
}

function resultCounts(result) {
  const outcomes = Array.isArray(result) ? result : (Array.isArray(result?.outcomes) ? result.outcomes : []);
  const processed = result?.processed ?? result?.staff ?? outcomes.length ?? 0;
  const failed = result?.failed ?? outcomes.filter((item) => ['FAILED', 'RETRY'].includes(String(item?.status || '').toUpperCase())).length;
  return {
    processedCount: boundedInteger(processed, 0, 0, 2147483647),
    failedCount: boundedInteger(failed, 0, 0, 2147483647)
  };
}

class BackgroundJobService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.store = options.store || new BackgroundJobStore(options.pool || pool);
    this.leaseOwner = options.leaseOwner || ownerIdentity(this.env);
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.now = options.now || (() => new Date());
    this.jobs = new Map();
    this.initialized = false;
  }

  async initialize() {
    await this.store.initialize();
    this.initialized = true;
    return { state: 'OPERATIONAL', registered_jobs: this.jobs.size };
  }

  registerJob(definition) {
    const jobKey = String(definition?.jobKey || '').trim().toLowerCase();
    if (!JOB_KEY_PATTERN.test(jobKey)) throw new Error(`Invalid background job key: ${jobKey || '[empty]'}`);
    if (typeof definition.handler !== 'function') throw new Error(`Background job ${jobKey} requires a handler.`);
    this.jobs.set(jobKey, {
      jobKey,
      handler: definition.handler,
      leaseMs: boundedInteger(definition.leaseMs ?? this.env.BACKGROUND_JOB_LEASE_MS, 120000, 10000, 3600000),
      maxAttempts: boundedInteger(definition.maxAttempts ?? this.env.BACKGROUND_JOB_MAX_ATTEMPTS, 5, 1, 20),
      retryBaseMs: boundedInteger(definition.retryBaseMs ?? this.env.BACKGROUND_JOB_RETRY_BASE_MS, 30000, 1000, 3600000),
      retryMaxMs: boundedInteger(definition.retryMaxMs ?? this.env.BACKGROUND_JOB_RETRY_MAX_MS, 3600000, 1000, 86400000),
      enabled: definition.enabled || (() => true),
      description: String(definition.description || jobKey).slice(0, 200)
    });
    return jobKey;
  }

  registeredJobs() {
    return [...this.jobs.values()].map(({ handler: _handler, enabled, ...job }) => ({
      ...job,
      enabled: Boolean(enabled())
    }));
  }

  definition(jobKey) {
    const definition = this.jobs.get(String(jobKey || '').trim().toLowerCase());
    if (!definition) {
      const error = new Error('Background job is not registered on this deployment.');
      error.code = 'BACKGROUND_JOB_NOT_REGISTERED';
      error.statusCode = 409;
      throw error;
    }
    return definition;
  }

  async acquireLease(jobKey, options = {}) {
    const definition = options.definition || this.definition(jobKey);
    const leaseToken = this.randomUUID();
    const leaseSeconds = Math.ceil(definition.leaseMs / 1000);
    const acquired = await this.store.acquireLease({
      jobKey: definition.jobKey,
      leaseOwner: this.leaseOwner,
      leaseToken,
      leaseSeconds
    });
    return { acquired, jobKey: definition.jobKey, leaseOwner: this.leaseOwner, leaseToken, leaseSeconds };
  }

  async renewLease(lease) {
    return this.store.renewLease(lease);
  }

  async releaseLease(lease) {
    return this.store.releaseLease(lease);
  }

  async recordRun(run, options = {}) {
    return this.store.createRun(run, options);
  }

  retryDelay(definition, attempt) {
    return Math.min(definition.retryMaxMs, definition.retryBaseMs * (2 ** Math.max(0, attempt - 1)));
  }

  async scheduleRetry(run, error, definition) {
    const safe = safeError(error);
    const retryAt = new Date(this.now().getTime() + this.retryDelay(definition, run.attempt));
    await this.store.scheduleRetry({
      runUuid: run.runUuid,
      jobKey: run.jobKey,
      attempt: run.attempt,
      errorCode: safe.code,
      errorSummary: safe.summary,
      retryAt
    });
    return { status: JOB_STATES.RETRY, retryAt, errorCode: safe.code };
  }

  async deadLetter(run, error) {
    const safe = safeError(error);
    await this.store.deadLetter({
      runUuid: run.runUuid,
      jobKey: run.jobKey,
      attempt: run.attempt,
      errorCode: safe.code,
      errorSummary: safe.summary
    });
    return { status: JOB_STATES.DEAD_LETTER, errorCode: safe.code };
  }

  async runJob(jobKey, options = {}) {
    const definition = this.definition(jobKey);
    if (!definition.enabled() && !options.force) {
      return { jobKey: definition.jobKey, skipped: true, reason: 'disabled' };
    }
    const previous = await this.store.latestRun(definition.jobKey);
    if (!options.force && previous?.status === JOB_STATES.DEAD_LETTER) {
      return { jobKey: definition.jobKey, skipped: true, reason: 'dead_letter' };
    }
    if (!options.force && previous?.status === JOB_STATES.RETRY && previous.next_attempt_at
      && new Date(previous.next_attempt_at).getTime() > this.now().getTime()) {
      return { jobKey: definition.jobKey, skipped: true, reason: 'retry_wait', nextAttemptAt: previous.next_attempt_at };
    }

    const lease = await this.acquireLease(definition.jobKey, { definition });
    if (!lease.acquired) return { jobKey: definition.jobKey, skipped: true, reason: 'lease_held' };

    const run = {
      runUuid: this.randomUUID(),
      jobKey: definition.jobKey,
      leaseToken: lease.leaseToken,
      deploymentSha: deploymentSha(this.env),
      triggerSource: TRIGGERS.has(String(options.trigger || '').toUpperCase()) ? String(options.trigger).toUpperCase() : 'SCHEDULED',
      requestedBy: options.requestedBy || null,
      attempt: 1
    };
    let heartbeat = null;
    let leaseLost = false;
    let runRecorded = false;
    try {
      run.attempt = await this.recordRun(run, { resetAttempts: Boolean(options.resetAttempts) });
      runRecorded = true;
      const heartbeatMs = Math.max(1000, Math.floor(definition.leaseMs / 3));
      heartbeat = setInterval(() => {
        this.renewLease(lease).then((renewed) => {
          if (!renewed) leaseLost = true;
        }).catch(() => {
          leaseLost = true;
        });
      }, heartbeatMs);
      heartbeat.unref?.();

      const result = await definition.handler({
        jobKey: definition.jobKey,
        runUuid: run.runUuid,
        attempt: run.attempt,
        trigger: run.triggerSource,
        requestedBy: run.requestedBy
      });
      const finalRenewal = leaseLost ? false : await this.renewLease(lease);
      if (!finalRenewal) {
        const error = new Error('Background job lease heartbeat was lost before completion.');
        error.code = 'BACKGROUND_JOB_LEASE_LOST';
        throw error;
      }
      const counts = resultCounts(result);
      await this.store.completeRun({ runUuid: run.runUuid, ...counts });
      await this.store.resolveDeadLetters(definition.jobKey, run.runUuid);
      return { jobKey: definition.jobKey, runUuid: run.runUuid, status: JOB_STATES.COMPLETED, attempt: run.attempt, ...counts, result };
    } catch (error) {
      if (!runRecorded) throw error;
      const outcome = run.attempt < definition.maxAttempts
        ? await this.scheduleRetry(run, error, definition)
        : await this.deadLetter(run, error);
      return { jobKey: definition.jobKey, runUuid: run.runUuid, attempt: run.attempt, ...outcome };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await this.releaseLease(lease).catch(() => {});
    }
  }

  createScheduler(options) {
    const jobKey = this.registerJob(options);
    let intervalTimer = null;
    let initialTimer = null;
    const logger = options.logger || console;
    const tick = (trigger = 'SCHEDULED') => this.runJob(jobKey, { trigger }).then((result) => {
      if ([JOB_STATES.RETRY, JOB_STATES.DEAD_LETTER].includes(result.status)) {
        logger.error?.(`Background job ${jobKey} finished as ${result.status}: ${result.errorCode}`);
      }
      return result;
    }).catch((error) => logger.error?.(`Background job ${jobKey} scheduler failed: ${safeError(error).code}`));
    return {
      jobKey,
      run: (runOptions = {}) => this.runJob(jobKey, runOptions),
      start: () => {
        if (intervalTimer || !this.definition(jobKey).enabled()) return false;
        const intervalMs = boundedInteger(typeof options.intervalMs === 'function' ? options.intervalMs() : options.intervalMs, 300000, 1000, 86400000);
        const initialDelayMs = boundedInteger(typeof options.initialDelayMs === 'function' ? options.initialDelayMs() : options.initialDelayMs, 10000, 0, intervalMs);
        intervalTimer = setInterval(() => tick('SCHEDULED'), intervalMs);
        intervalTimer.unref?.();
        initialTimer = setTimeout(() => tick('STARTUP'), initialDelayMs);
        initialTimer.unref?.();
        return true;
      },
      stop: () => {
        if (intervalTimer) clearInterval(intervalTimer);
        if (initialTimer) clearTimeout(initialTimer);
        intervalTimer = null;
        initialTimer = null;
      }
    };
  }

  async health() {
    const data = await this.store.listHealthData();
    const latestByJob = new Map();
    for (const run of data.runs) if (!latestByJob.has(run.job_key)) latestByJob.set(run.job_key, run);
    const leases = new Map(data.leases.map((lease) => [lease.job_key, lease]));
    const deadLetters = new Map(data.deadLetters.map((row) => [row.job_key, Number(row.open_count || 0)]));
    return {
      state: this.initialized ? 'OPERATIONAL' : 'INITIALIZING',
      registered_jobs: this.jobs.size,
      jobs: this.registeredJobs().map((job) => {
        const run = latestByJob.get(job.jobKey) || null;
        const lease = leases.get(job.jobKey) || null;
        return {
          job_key: job.jobKey,
          description: job.description,
          enabled: job.enabled,
          lease_active: Number(lease?.lease_active || 0) === 1,
          heartbeat_at: lease?.heartbeat_at || null,
          lease_expires_at: lease?.lease_expires_at || null,
          last_run: run ? {
            run_uuid: run.run_uuid,
            status: run.status,
            attempt: Number(run.attempt || 0),
            started_at: run.started_at,
            completed_at: run.completed_at,
            processed_count: Number(run.processed_count || 0),
            failed_count: Number(run.failed_count || 0),
            deployment_sha: run.deployment_sha || null,
            trigger_source: run.trigger_source,
            next_attempt_at: run.next_attempt_at,
            error_code: run.error_code || null
          } : null,
          open_dead_letters: deadLetters.get(job.jobKey) || 0
        };
      })
    };
  }

  async listDeadLetters(limit) {
    const rows = await this.store.listDeadLetters(boundedInteger(limit, 50, 1, 100));
    return rows.map((row) => ({
      ...row,
      error_summary: safeError({ code: row.error_code, message: row.error_summary }).summary
    }));
  }

  async getDeadLetter(id) {
    return this.store.getDeadLetter(id);
  }

  async retryDeadLetter(id, actorId) {
    const deadLetter = await this.store.deadLetterForRetry(id, actorId);
    try {
      const result = await this.runJob(deadLetter.job_key, {
        force: true,
        resetAttempts: true,
        trigger: 'MANUAL',
        requestedBy: actorId
      });
      if (result.skipped) await this.store.reopenDeadLetter(id, actorId);
      return { deadLetter, result };
    } catch (error) {
      await this.store.reopenDeadLetter(id, actorId).catch(() => {});
      throw error;
    }
  }
}

const backgroundJobService = new BackgroundJobService();

module.exports = {
  BackgroundJobService,
  JOB_STATES,
  backgroundJobService,
  boundedInteger,
  ownerIdentity,
  resultCounts,
  safeError
};
