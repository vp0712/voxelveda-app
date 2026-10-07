'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { putObject, getObject, deleteObject } = require('./objectStorageService');

const DEFAULT_TTL_MINUTES = 30 * 24 * 60;
const MAX_TTL_MINUTES = 90 * 24 * 60;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 192 * 1024;
const INTERNAL_REPORT_TYPE = 'EMAIL_PDF_BLOB';

function signingSecret() {
  const value = String(
    process.env.FINANCE_REPORT_DELIVERY_SECRET
    || process.env.FINANCE_ENCRYPTION_KEY
    || process.env.JWT_SECRET
    || ''
  ).trim();
  if (value.length < 24) {
    const error = new Error('Finance report delivery signing secret is not configured.');
    error.code = 'FINANCE_REPORT_DELIVERY_SECRET_MISSING';
    throw error;
  }
  return value;
}

function safePdfFilename(value) {
  let filename = String(value || 'Voxel-Veda-Finance-Report.pdf')
    .trim()
    .replace(/[\\/\r\n\0"]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  if (!filename) filename = 'Voxel-Veda-Finance-Report.pdf';
  if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
  return filename;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPayload(encodedPayload) {
  return crypto.createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

function createDeliveryToken(payload) {
  const encoded = base64urlJson(payload);
  return encoded + '.' + signPayload(encoded);
}

function decodeDeliveryToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const error = new Error('Invalid finance report delivery token.');
    error.code = 'FINANCE_REPORT_DELIVERY_TOKEN_INVALID';
    throw error;
  }

  const expected = Buffer.from(signPayload(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const error = new Error('Invalid finance report delivery token.');
    error.code = 'FINANCE_REPORT_DELIVERY_TOKEN_INVALID';
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    const error = new Error('Invalid finance report delivery token.');
    error.code = 'FINANCE_REPORT_DELIVERY_TOKEN_INVALID';
    throw error;
  }

  const commonValid = payload
    && [1, 2].includes(Number(payload.v))
    && payload.filename
    && Number(payload.exp);

  const versionValid = Number(payload?.v) === 1
    ? Boolean(payload.key)
    : Boolean(payload.id);

  if (!commonValid || !versionValid) {
    const error = new Error('Invalid finance report delivery token.');
    error.code = 'FINANCE_REPORT_DELIVERY_TOKEN_INVALID';
    throw error;
  }

  return payload;
}

function publicAppUrl() {
  const value = String(
    process.env.FINANCE_REPORT_PUBLIC_BASE_URL
    || process.env.PUBLIC_APP_URL
    || process.env.APP_URL
    || require('../config/urls').app
  ).trim();
  return value.replace(/\/+$/, '');
}

function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    const error = new Error('Finance report delivery requires a valid PDF buffer.');
    error.code = 'FINANCE_REPORT_DELIVERY_PDF_INVALID';
    throw error;
  }
  if (buffer.length > MAX_PDF_BYTES) {
    const error = new Error('Finance report PDF exceeds the durable delivery size limit.');
    error.code = 'FINANCE_REPORT_DELIVERY_PDF_TOO_LARGE';
    throw error;
  }
}

function digestPdf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function boundedTtlMinutes(value) {
  const requested = Number(value || DEFAULT_TTL_MINUTES);
  const safe = Number.isFinite(requested) ? requested : DEFAULT_TTL_MINUTES;
  return Math.max(60, Math.min(Math.floor(safe), MAX_TTL_MINUTES));
}

function chunkUid(deliveryUid, index) {
  return `EPDF_${deliveryUid}_${String(index).padStart(4, '0')}`;
}

function chunkPattern(deliveryUid) {
  return `EPDF_${deliveryUid}_%`;
}

function parseDefinition(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

async function writeObjectStorageBackup(key, buffer) {
  try {
    await putObject(key, buffer, 'application/pdf');
    return true;
  } catch (error) {
    console.warn(
      'FINANCE PDF DELIVERY BACKUP WARNING:',
      String(error?.code || 'OBJECT_STORAGE_BACKUP_FAILED'),
      Number(error?.status || 0) || ''
    );
    return false;
  }
}

async function persistPdfChunks({
  deliveryUid,
  reportUid,
  filename,
  buffer,
  sha256,
  objectKey,
  createdBy,
  expiresAt
}) {
  const chunkCount = Math.ceil(buffer.length / CHUNK_BYTES);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * CHUNK_BYTES;
      const end = Math.min(start + CHUNK_BYTES, buffer.length);
      const chunk = buffer.subarray(start, end);

      const definition = {
        internal_type: INTERNAL_REPORT_TYPE,
        delivery_uid: deliveryUid,
        source_report_uid: reportUid ? String(reportUid).slice(0, 80) : null,
        filename,
        mime_type: 'application/pdf',
        sha256,
        object_storage_key: objectKey,
        byte_size: buffer.length,
        expires_at: expiresAt,
        chunk_index: index,
        chunk_count: chunkCount,
        data_base64: chunk.toString('base64')
      };

      await connection.query(
        `INSERT INTO finance_saved_reports
          (report_uid, name, report_type, definition_json, created_by, last_run_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          chunkUid(deliveryUid, index),
          `Internal PDF delivery ${deliveryUid}`.slice(0, 160),
          INTERNAL_REPORT_TYPE,
          JSON.stringify(definition),
          Number(createdBy || 0) || 0
        ]
      );
    }

    await connection.commit();
    return chunkCount;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function issuePdfDelivery({
  buffer,
  filename,
  ttlMinutes = DEFAULT_TTL_MINUTES,
  reportUid = null,
  createdBy = null
}) {
  assertPdfBuffer(buffer);

  const safeFilename = safePdfFilename(filename);
  const expiresInMinutes = boundedTtlMinutes(ttlMinutes);
  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
  const deliveryUid = crypto.randomUUID();
  const sha256 = digestPdf(buffer);
  const objectKey = `finance-email-delivery-v2/${deliveryUid}/${safeFilename}`;

  const chunkCount = await persistPdfChunks({
    deliveryUid,
    reportUid,
    filename: safeFilename,
    buffer,
    sha256,
    objectKey,
    createdBy,
    expiresAt
  });

  const backupStored = await writeObjectStorageBackup(objectKey, buffer);

  const token = createDeliveryToken({
    v: 2,
    id: deliveryUid,
    key: objectKey,
    filename: safeFilename,
    sha256,
    chunks: chunkCount,
    exp: expiresAt
  });

  return {
    url: `${publicAppUrl()}/api/public/finance-report/${encodeURIComponent(token)}/${encodeURIComponent(safeFilename)}`,
    filename: safeFilename,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMinutes,
    deliveryUid,
    objectKey,
    backupStored,
    chunkCount
  };
}

async function deleteDurableChunks(deliveryUid) {
  if (!deliveryUid) return;
  await pool.query(
    `DELETE FROM finance_saved_reports
      WHERE report_type = ?
        AND report_uid LIKE ?`,
    [INTERNAL_REPORT_TYPE, chunkPattern(deliveryUid)]
  ).catch(() => {});
}

async function revokePdfDelivery(delivery) {
  const deliveryUid = String(delivery?.deliveryUid || '').trim();
  const key = String(delivery?.objectKey || '').trim();

  if (deliveryUid) await deleteDurableChunks(deliveryUid);
  if (key) await deleteObject(key).catch(() => {});
  return Boolean(deliveryUid || key);
}

async function loadLegacyObject(payload) {
  const body = await getObject(payload.key);
  assertPdfBuffer(body);
  return body;
}

async function loadDurableChunks(payload) {
  const [rows] = await pool.query(
    `SELECT report_uid, definition_json
       FROM finance_saved_reports
      WHERE report_type = ?
        AND report_uid LIKE ?
      ORDER BY report_uid ASC`,
    [INTERNAL_REPORT_TYPE, chunkPattern(payload.id)]
  );

  if (!rows.length) return { state: 'missing', body: null, meta: null };

  const definitions = rows.map((row) => parseDefinition(row.definition_json));
  if (definitions.some((item) => !item || item.delivery_uid !== payload.id)) {
    const error = new Error('Durable Finance PDF chunk metadata is invalid.');
    error.code = 'FINANCE_REPORT_DELIVERY_CHUNK_METADATA_INVALID';
    throw error;
  }

  const meta = definitions[0];
  const expectedCount = Number(meta.chunk_count || 0);
  if (!expectedCount || rows.length !== expectedCount) {
    const error = new Error('Durable Finance PDF chunk set is incomplete.');
    error.code = 'FINANCE_REPORT_DELIVERY_CHUNK_INCOMPLETE';
    throw error;
  }

  const ordered = definitions
    .slice()
    .sort((left, right) => Number(left.chunk_index) - Number(right.chunk_index));

  for (let index = 0; index < ordered.length; index += 1) {
    if (Number(ordered[index].chunk_index) !== index || Number(ordered[index].chunk_count) !== expectedCount) {
      const error = new Error('Durable Finance PDF chunk sequence is invalid.');
      error.code = 'FINANCE_REPORT_DELIVERY_CHUNK_SEQUENCE_INVALID';
      throw error;
    }
  }

  const expiresAt = Number(meta.expires_at || 0);
  if (expiresAt && Date.now() > expiresAt) return { state: 'expired', body: null, meta };

  const body = Buffer.concat(
    ordered.map((item) => Buffer.from(String(item.data_base64 || ''), 'base64'))
  );

  assertPdfBuffer(body);

  const digest = digestPdf(body);
  if (String(meta.sha256 || '') !== digest || (payload.sha256 && String(payload.sha256) !== digest)) {
    const error = new Error('Durable Finance PDF hash verification failed.');
    error.code = 'FINANCE_REPORT_DELIVERY_HASH_MISMATCH';
    throw error;
  }

  if (Number(meta.byte_size || 0) !== body.length) {
    const error = new Error('Durable Finance PDF size verification failed.');
    error.code = 'FINANCE_REPORT_DELIVERY_SIZE_MISMATCH';
    throw error;
  }

  return { state: 'ready', body, meta };
}

async function markDurableAccess(deliveryUid) {
  await pool.query(
    `UPDATE finance_saved_reports
        SET last_run_at = NOW()
      WHERE report_type = ?
        AND report_uid LIKE ?`,
    [INTERNAL_REPORT_TYPE, chunkPattern(deliveryUid)]
  ).catch(() => {});
}

async function loadBackupPdf(payload, meta = null) {
  const key = String(meta?.object_storage_key || payload?.key || '').trim();
  if (!key) return null;

  try {
    const body = await getObject(key);
    assertPdfBuffer(body);
    const digest = digestPdf(body);
    if (payload.sha256 && String(payload.sha256) !== digest) {
      const error = new Error('Finance PDF backup hash verification failed.');
      error.code = 'FINANCE_REPORT_DELIVERY_HASH_MISMATCH';
      throw error;
    }
    return body;
  } catch (error) {
    console.error(
      'FINANCE PDF DELIVERY BACKUP ERROR:',
      String(error?.code || 'OBJECT_STORAGE_REQUEST_FAILED'),
      Number(error?.status || 0) || ''
    );
    return null;
  }
}

async function cleanupExpiredDelivery(payload, meta = null) {
  if (Number(payload?.v) === 2 && payload?.id) {
    await deleteDurableChunks(payload.id);
  }

  const key = String(meta?.object_storage_key || payload?.key || '').trim();
  if (key) await deleteObject(key).catch(() => {});
}

function sendPdfResponse(res, body, filename) {
  assertPdfBuffer(body);
  const safeFilename = safePdfFilename(filename);
  const asciiFilename = safeFilename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
  );
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).end(body);
}

async function servePdfDelivery(req, res) {
  let payload;
  try {
    payload = decodeDeliveryToken(req.params.token);
  } catch {
    return res.status(404).json({ message: 'This PDF delivery link is invalid.' });
  }

  if (Date.now() > Number(payload.exp)) {
    await cleanupExpiredDelivery(payload);
    return res.status(410).json({ message: 'This PDF delivery link has expired.' });
  }

  const tokenFilename = safePdfFilename(payload.filename);
  const requestedFilename = req.params.filename
    ? safePdfFilename(req.params.filename)
    : tokenFilename;

  if (requestedFilename !== tokenFilename) {
    return res.status(404).json({ message: 'This PDF delivery link is invalid.' });
  }

  if (Number(payload.v) === 1) {
    try {
      const body = await loadLegacyObject(payload);
      return sendPdfResponse(res, body, tokenFilename);
    } catch (error) {
      console.error(
        'FINANCE PDF DELIVERY ERROR:',
        String(error?.code || error?.message || 'LEGACY_PDF_UNAVAILABLE'),
        Number(error?.status || 0) || ''
      );
      return res.status(404).json({ message: 'The requested PDF report is no longer available.' });
    }
  }

  let durableResult = null;
  let durableError = null;

  try {
    durableResult = await loadDurableChunks(payload);
  } catch (error) {
    durableError = error;
  }

  if (durableResult?.state === 'expired') {
    await cleanupExpiredDelivery(payload, durableResult.meta);
    return res.status(410).json({ message: 'This PDF delivery link has expired.' });
  }

  if (durableResult?.state === 'ready') {
    await markDurableAccess(payload.id);
    return sendPdfResponse(
      res,
      durableResult.body,
      durableResult.meta?.filename || tokenFilename
    );
  }

  const backupBody = await loadBackupPdf(payload, durableResult?.meta || null);
  if (backupBody) return sendPdfResponse(res, backupBody, tokenFilename);

  console.error(
    'FINANCE PDF DELIVERY ERROR:',
    String(durableError?.code || 'DURABLE_PDF_UNAVAILABLE'),
    Number(durableError?.status || 0) || ''
  );
  return res.status(404).json({ message: 'The requested PDF report is no longer available.' });
}

module.exports = {
  createDeliveryToken,
  decodeDeliveryToken,
  issuePdfDelivery,
  revokePdfDelivery,
  safePdfFilename,
  servePdfDelivery,
  _test: {
    assertPdfBuffer,
    boundedTtlMinutes,
    chunkPattern,
    chunkUid,
    digestPdf,
    publicAppUrl
  }
};
