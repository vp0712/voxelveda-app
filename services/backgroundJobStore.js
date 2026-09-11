class BackgroundJobStore {
  constructor(pool) {
    this.pool = pool;
  }

  async initialize() {
    for (const table of [
      'background_job_leases',
      'background_job_runs',
      'background_job_failures',
      'background_job_dead_letters'
    ]) {
      await this.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
    }
  }

  async acquireLease({ jobKey, leaseOwner, leaseToken, leaseSeconds }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [insert] = await connection.query(
        `INSERT IGNORE INTO background_job_leases
         (job_key, lease_owner, lease_token, acquired_at, heartbeat_at, lease_expires_at)
         VALUES (?, ?, ?, NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [jobKey, leaseOwner, leaseToken, leaseSeconds]
      );
      let acquired = Boolean(insert.affectedRows);
      if (!acquired) {
        const [update] = await connection.query(
          `UPDATE background_job_leases
           SET lease_owner = ?, lease_token = ?, acquired_at = NOW(3), heartbeat_at = NOW(3),
               lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
           WHERE job_key = ? AND lease_expires_at <= NOW(3)`,
          [leaseOwner, leaseToken, leaseSeconds, jobKey]
        );
        acquired = Boolean(update.affectedRows);
      }
      await connection.commit();
      return acquired;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async renewLease({ jobKey, leaseOwner, leaseToken, leaseSeconds }) {
    const [result] = await this.pool.query(
      `UPDATE background_job_leases
       SET heartbeat_at = NOW(3), lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
       WHERE job_key = ? AND lease_owner = ? AND lease_token = ? AND lease_expires_at > NOW(3)`,
      [leaseSeconds, jobKey, leaseOwner, leaseToken]
    );
    return Boolean(result.affectedRows);
  }

  async releaseLease({ jobKey, leaseOwner, leaseToken }) {
    const [result] = await this.pool.query(
      `UPDATE background_job_leases
       SET heartbeat_at = NOW(3), lease_expires_at = NOW(3)
       WHERE job_key = ? AND lease_owner = ? AND lease_token = ?`,
      [jobKey, leaseOwner, leaseToken]
    );
    return Boolean(result.affectedRows);
  }

  async latestRun(jobKey) {
    const [[row]] = await this.pool.query(
      `SELECT run_uuid, job_key, status, attempt, started_at, completed_at, next_attempt_at
       FROM background_job_runs WHERE job_key = ? ORDER BY started_at DESC, run_uuid DESC LIMIT 1`,
      [jobKey]
    );
    return row || null;
  }

  async createRun(run, options = {}) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[previous]] = await connection.query(
        `SELECT run_uuid, status, attempt FROM background_job_runs
         WHERE job_key = ? ORDER BY started_at DESC, run_uuid DESC LIMIT 1 FOR UPDATE`,
        [run.jobKey]
      );
      if (previous?.status === 'RUNNING') {
        await connection.query(
          `UPDATE background_job_runs
           SET status = 'FAILED', completed_at = NOW(3), error_code = 'JOB_LEASE_EXPIRED',
               error_summary = 'Previous worker lease expired before completion.'
           WHERE run_uuid = ? AND status = 'RUNNING'`,
          [previous.run_uuid]
        );
        await connection.query(
          `INSERT IGNORE INTO background_job_failures
           (run_uuid, job_key, attempt, error_code, error_summary)
           VALUES (?, ?, ?, 'JOB_LEASE_EXPIRED', 'Previous worker lease expired before completion.')`,
          [previous.run_uuid, run.jobKey, Number(previous.attempt || 1)]
        );
      }
      const continueAttempt = previous && ['RUNNING', 'RETRY', 'FAILED'].includes(previous.status);
      const attempt = options.resetAttempts ? 1 : (continueAttempt ? Number(previous.attempt || 0) + 1 : 1);
      await connection.query(
        `INSERT INTO background_job_runs
         (run_uuid, job_key, lease_token, started_at, status, attempt, deployment_sha, trigger_source, requested_by)
         VALUES (?, ?, ?, NOW(3), 'RUNNING', ?, ?, ?, ?)`,
        [run.runUuid, run.jobKey, run.leaseToken, attempt, run.deploymentSha, run.triggerSource, run.requestedBy]
      );
      await connection.commit();
      return attempt;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async completeRun({ runUuid, processedCount, failedCount }) {
    await this.pool.query(
      `UPDATE background_job_runs
       SET status = 'COMPLETED', completed_at = NOW(3), processed_count = ?, failed_count = ?,
           next_attempt_at = NULL, error_code = NULL, error_summary = NULL
       WHERE run_uuid = ? AND status = 'RUNNING'`,
      [processedCount, failedCount, runUuid]
    );
  }

  async scheduleRetry({ runUuid, jobKey, attempt, errorCode, errorSummary, retryAt }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE background_job_runs
         SET status = 'RETRY', completed_at = NOW(3), failed_count = failed_count + 1,
             next_attempt_at = ?, error_code = ?, error_summary = ?
         WHERE run_uuid = ? AND status = 'RUNNING'`,
        [retryAt, errorCode, errorSummary, runUuid]
      );
      await connection.query(
        `INSERT IGNORE INTO background_job_failures
         (run_uuid, job_key, attempt, error_code, error_summary, retry_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [runUuid, jobKey, attempt, errorCode, errorSummary, retryAt]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async deadLetter({ runUuid, jobKey, attempt, errorCode, errorSummary }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE background_job_runs
         SET status = 'DEAD_LETTER', completed_at = NOW(3), failed_count = failed_count + 1,
             next_attempt_at = NULL, error_code = ?, error_summary = ?
         WHERE run_uuid = ? AND status = 'RUNNING'`,
        [errorCode, errorSummary, runUuid]
      );
      await connection.query(
        `INSERT IGNORE INTO background_job_failures
         (run_uuid, job_key, attempt, error_code, error_summary)
         VALUES (?, ?, ?, ?, ?)`,
        [runUuid, jobKey, attempt, errorCode, errorSummary]
      );
      await connection.query(
        `UPDATE background_job_dead_letters
         SET status = 'RESOLVED', resolved_at = NOW(3), retry_run_uuid = ?
         WHERE job_key = ? AND status = 'RETRYING'`,
        [runUuid, jobKey]
      );
      await connection.query(
        `INSERT IGNORE INTO background_job_dead_letters
         (run_uuid, job_key, attempt, error_code, error_summary)
         VALUES (?, ?, ?, ?, ?)`,
        [runUuid, jobKey, attempt, errorCode, errorSummary]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async resolveDeadLetters(jobKey, retryRunUuid) {
    await this.pool.query(
      `UPDATE background_job_dead_letters
       SET status = 'RESOLVED', resolved_at = NOW(3), retry_run_uuid = ?
       WHERE job_key = ? AND status IN ('OPEN', 'RETRYING')`,
      [retryRunUuid, jobKey]
    );
  }

  async deadLetterForRetry(id, actorId) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[row]] = await connection.query(
        `SELECT id, run_uuid, job_key, status, attempt, error_code, created_at
         FROM background_job_dead_letters WHERE id = ? LIMIT 1 FOR UPDATE`,
        [id]
      );
      if (!row) {
        const error = new Error('Background job dead letter not found.');
        error.code = 'BACKGROUND_JOB_DEAD_LETTER_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }
      if (row.status !== 'OPEN') {
        const error = new Error('This background job failure is not available for retry.');
        error.code = 'BACKGROUND_JOB_DEAD_LETTER_NOT_OPEN';
        error.statusCode = 409;
        throw error;
      }
      await connection.query(
        `UPDATE background_job_dead_letters
         SET status = 'RETRYING', retry_requested_by = ?, retry_requested_at = NOW(3)
         WHERE id = ? AND status = 'OPEN'`,
        [actorId, id]
      );
      await connection.commit();
      return row;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async reopenDeadLetter(id, actorId) {
    const [result] = await this.pool.query(
      `UPDATE background_job_dead_letters
       SET status = 'OPEN', retry_requested_by = NULL, retry_requested_at = NULL
       WHERE id = ? AND status = 'RETRYING' AND retry_requested_by = ?`,
      [id, actorId]
    );
    return Boolean(result.affectedRows);
  }

  async listHealthData() {
    const [leases] = await this.pool.query(
      `SELECT job_key, acquired_at, heartbeat_at, lease_expires_at,
              lease_expires_at > NOW(3) AS lease_active
       FROM background_job_leases ORDER BY job_key`
    );
    const [runs] = await this.pool.query(
      `SELECT run_uuid, job_key, started_at, completed_at, status, attempt,
              processed_count, failed_count, deployment_sha, trigger_source,
              next_attempt_at, error_code
       FROM background_job_runs ORDER BY started_at DESC, run_uuid DESC LIMIT 500`
    );
    const [deadLetters] = await this.pool.query(
      `SELECT job_key, COUNT(*) AS open_count
       FROM background_job_dead_letters WHERE status IN ('OPEN', 'RETRYING') GROUP BY job_key`
    );
    return { leases, runs, deadLetters };
  }

  async listDeadLetters(limit = 50) {
    const [rows] = await this.pool.query(
      `SELECT id, run_uuid, job_key, attempt, error_code, error_summary, status,
              retry_requested_by, retry_requested_at, retry_run_uuid, resolved_at, created_at
       FROM background_job_dead_letters ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  }

  async getDeadLetter(id) {
    const [[row]] = await this.pool.query(
      `SELECT id, run_uuid, job_key, attempt, error_code, status, created_at
       FROM background_job_dead_letters WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) {
      const error = new Error('Background job dead letter was not found.');
      error.code = 'BACKGROUND_JOB_DEAD_LETTER_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    return row;
  }
}

module.exports = { BackgroundJobStore };
