const pool = require('../config/db');
const { backgroundJobService } = require('../services/backgroundJobService');
const { logAudit } = require('../services/auditService');

function numericId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.health = async (_req, res, next) => {
  try {
    return res.json(await backgroundJobService.health());
  } catch (error) {
    return next(error);
  }
};

exports.deadLetters = async (req, res, next) => {
  try {
    return res.json({ dead_letters: await backgroundJobService.listDeadLetters(req.query.limit) });
  } catch (error) {
    return next(error);
  }
};

exports.retryDeadLetter = async (req, res, next) => {
  const id = numericId(req.params.id);
  const reason = String(req.body.reason || '').trim();
  if (!id || reason.length < 10 || reason.length > 500) {
    return res.status(400).json({
      code: 'BACKGROUND_JOB_RETRY_INVALID',
      message: 'A valid dead-letter ID and a 10-500 character reason are required.'
    });
  }
  try {
    const deadLetter = await backgroundJobService.getDeadLetter(id);
    if (deadLetter.status !== 'OPEN') {
      return res.status(409).json({
        code: 'BACKGROUND_JOB_DEAD_LETTER_NOT_OPEN',
        message: 'Only an open background-job dead letter can be retried.'
      });
    }
    await logAudit(pool, {
      actorId: req.user.id,
      action: 'BACKGROUND_JOB_MANUAL_RETRY_REQUESTED',
      module: 'SECURITY',
      recordType: 'BACKGROUND_JOB_DEAD_LETTER',
      recordId: id,
      requestId: req.requestId,
      sessionId: req.session?.id,
      newValue: {
        job_key: deadLetter.job_key,
        source_run_uuid: deadLetter.run_uuid,
        reason
      },
      metadata: { manual: true, step_up_verified: true }
    });
    const outcome = await backgroundJobService.retryDeadLetter(id, req.user.id);
    if (outcome.result.skipped) {
      return res.status(409).json({
        code: 'BACKGROUND_JOB_RETRY_NOT_DISPATCHED',
        message: 'The retry could not start because this job is already running. Try again after the active lease finishes.',
        job_key: outcome.deadLetter.job_key,
        reason: outcome.result.reason || 'lease_held'
      });
    }
    return res.status(202).json({
      message: 'Background job retry was accepted and recorded.',
      job_key: outcome.deadLetter.job_key,
      source_run_uuid: outcome.deadLetter.run_uuid,
      retry: {
        run_uuid: outcome.result.runUuid || null,
        status: outcome.result.status || null,
        skipped: Boolean(outcome.result.skipped),
        reason: outcome.result.reason || null,
        attempt: Number(outcome.result.attempt || 0),
        processed_count: Number(outcome.result.processedCount || 0),
        failed_count: Number(outcome.result.failedCount || 0),
        error_code: outcome.result.errorCode || null
      }
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ code: error.code, message: error.message });
    return next(error);
  }
};
