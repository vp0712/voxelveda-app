const crypto = require('node:crypto');
const pool = require('../config/db');
const { clientIp } = require('../middleware/securityMiddleware');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function payloadHash(body) {
  const submission = body && typeof body === 'object' && !Array.isArray(body) ? { ...body } : body;
  if (submission && typeof submission === 'object') delete submission.bot_challenge_token;
  return sha256(JSON.stringify(stableValue(submission || {})));
}

function parseStoredJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function validatedIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    const error = new Error('Idempotency-Key must contain 8 to 128 safe characters');
    error.code = 'IDEMPOTENCY_KEY_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return key;
}

function dedupeIdentity({ submissionType, body, ip, idempotencyKey }) {
  const bodySha = payloadHash(body);
  const explicit = validatedIdempotencyKey(idempotencyKey);
  const identity = explicit ? `idempotency:${explicit}` : `automatic:${ip || 'unknown'}:${bodySha}`;
  return {
    payloadSha: bodySha,
    dedupeKey: sha256(`${submissionType}:${identity}`)
  };
}

async function beginPublicSubmission({
  db = pool,
  submissionType,
  body,
  ip,
  idempotencyKey,
  ttlSeconds = 600
}) {
  const type = String(submissionType || '').trim().toLowerCase();
  if (!/^[a-z0-9:_-]{2,64}$/.test(type)) throw new Error('Invalid public submission type');
  const ttl = Math.min(86400, Math.max(30, Math.floor(Number(ttlSeconds) || 600)));
  const lockToken = crypto.randomUUID();
  const { dedupeKey, payloadSha } = dedupeIdentity({ submissionType: type, body, ip, idempotencyKey });

  await db.query(
    `INSERT INTO public_submission_dedupe
       (submission_type, dedupe_key, payload_sha256, lock_token, status, expires_at)
     VALUES (?, ?, ?, ?, 'PROCESSING', DATE_ADD(NOW(3), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE
       lock_token = IF(expires_at <= NOW(3), VALUES(lock_token), lock_token),
       payload_sha256 = IF(expires_at <= NOW(3), VALUES(payload_sha256), payload_sha256),
       status = IF(expires_at <= NOW(3), 'PROCESSING', status),
       response_status = IF(expires_at <= NOW(3), NULL, response_status),
       response_json = IF(expires_at <= NOW(3), NULL, response_json),
       completed_at = IF(expires_at <= NOW(3), NULL, completed_at),
       expires_at = IF(expires_at <= NOW(3), VALUES(expires_at), expires_at)`,
    [type, dedupeKey, payloadSha, lockToken, ttl]
  );

  const [[row]] = await db.query(
    `SELECT payload_sha256, lock_token, status, response_status, response_json, expires_at
     FROM public_submission_dedupe
     WHERE submission_type = ? AND dedupe_key = ?
     LIMIT 1`,
    [type, dedupeKey]
  );
  if (!row) {
    const error = new Error('Public submission receipt could not be created');
    error.code = 'PUBLIC_SUBMISSION_RECEIPT_MISSING';
    throw error;
  }
  if (row.payload_sha256 !== payloadSha) {
    return { state: 'CONFLICT', type, dedupeKey, payloadSha };
  }
  if (row.lock_token === lockToken) {
    return { state: 'ACQUIRED', type, dedupeKey, payloadSha, lockToken, ttlSeconds: ttl };
  }
  if (row.status === 'COMPLETED' && row.response_status && row.response_json !== null) {
    return { state: 'REPLAY', status: Number(row.response_status), response: parseStoredJson(row.response_json) };
  }
  return { state: 'IN_PROGRESS', retryAt: row.expires_at };
}

async function completePublicSubmission(receipt, status, response, db = pool) {
  await db.query(
    `UPDATE public_submission_dedupe
     SET status = 'COMPLETED', response_status = ?, response_json = ?, completed_at = NOW(3)
     WHERE submission_type = ? AND dedupe_key = ? AND lock_token = ?`,
    [Number(status), JSON.stringify(response ?? null), receipt.type, receipt.dedupeKey, receipt.lockToken]
  );
}

async function abandonPublicSubmission(receipt, db = pool) {
  await db.query(
    `UPDATE public_submission_dedupe
     SET status = 'FAILED', expires_at = NOW(3)
     WHERE submission_type = ? AND dedupe_key = ? AND lock_token = ?`,
    [receipt.type, receipt.dedupeKey, receipt.lockToken]
  );
}

function publicSubmissionDedupe({ submissionType, ttlSeconds = 600, db = pool } = {}) {
  return async (req, res, next) => {
    let receipt;
    try {
      receipt = await beginPublicSubmission({
        db,
        submissionType,
        body: req.body,
        ip: clientIp(req),
        idempotencyKey: req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'],
        ttlSeconds
      });
    } catch (error) {
      return next(error);
    }

    if (receipt.state === 'CONFLICT') {
      return res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', message: 'This submission key was already used with different data' });
    }
    if (receipt.state === 'REPLAY') {
      res.setHeader('X-Idempotent-Replay', 'true');
      return res.status(receipt.status).json(receipt.response);
    }
    if (receipt.state === 'IN_PROGRESS') {
      res.setHeader('Retry-After', '5');
      return res.status(409).json({ code: 'DUPLICATE_SUBMISSION_IN_PROGRESS', message: 'An identical submission is already being processed' });
    }

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const status = res.statusCode;
      const finalize = status >= 200 && status < 300
        ? completePublicSubmission(receipt, status, payload, db)
        : abandonPublicSubmission(receipt, db);
      finalize
        .catch((error) => console.error('Public submission receipt finalization failed:', error.code || error.message))
        .finally(() => originalJson(payload));
      return res;
    };
    return next();
  };
}

module.exports = {
  abandonPublicSubmission,
  beginPublicSubmission,
  completePublicSubmission,
  dedupeIdentity,
  payloadHash,
  publicSubmissionDedupe,
  stableValue,
  validatedIdempotencyKey
};
