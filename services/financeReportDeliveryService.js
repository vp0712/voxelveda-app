'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { putObject, getObject, deleteObject } = require('./objectStorageService');

const DEFAULT_TTL_MINUTES = 30 * 24 * 60;
const MAX_TTL_MINUTES = 90 * 24 * 60;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

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
    || 'https://voxelveda-app-production.up.railway.app'
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

  await pool.query(
    `INSERT INTO finance_report_email_deliveries
      (delivery_uid, report_uid, filename, mime_type, pdf_blob, byte_size, sha256, object_storage_key, created_by, expires_at)
     VALUES (?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
    [
      deliveryUid,
      reportUid ? String(reportUid).slice(0, 80) : null,
      safeFilename,
      buffer,
      buffer.length,
      sha256,
      objectKey,
      Number(createdBy || 0) || null,
      Math.floor(expiresAt / 1000)
    ]
  );

  const backupStored = await writeObjectStorageBackup(objectKey, buffer);

  const token = createDeliveryToken({
    v: 2,
    id: deliveryUid,
    key: objectKey,
    filename: safeFilename,
    sha256,
    exp: expiresAt
  });

  return {
    url: `${publicAppUrl()}/api/public/finance-report/${encodeURIComponent(token)}/${encodeURIComponent(safeFilename)}`,
    filename: safeFilename,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMinutes,
    deliveryUid,
    objectKey,
    backupStored
  };
}

async function revokePdfDelivery(delivery) {
  const deliveryUid = String(delivery?.deliveryUid || '').trim();
  const key = String(delivery?.objectKey || '').trim();

  if (deliveryUid) {
    await pool.query(
      'DELETE FROM finance_report_email_deliveries WHERE delivery_uid = ?',
      [deliveryUid]
    ).catch(() => {});
  }

  if (key) await deleteObject(key).catch(() => {});
  return Boolean(deliveryUid || key);
}

async function loadLegacyObject(payload) {
  const body = await getObject(payload.key);
  assertPdfBuffer(body);
  return body;
}

async function loadDurableDatabasePdf(payload) {
  const [[row]] = await pool.query(
    `SELECT delivery_uid, filename, mime_type, pdf_blob, byte_size, sha256, object_storage_key,
            expires_at, revoked_at
       FROM finance_report_email_deliveries
      WHERE delivery_uid = ?
      LIMIT 1`,
    [payload.id]
  );

  if (!row) return { state: 'missing', row: null, body: null };
  if (row.revoked_at) return { state: 'revoked', row, body: null };

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt && Date.now() > expiresAt) return { state: 'expired', row, body: null };

  const body = Buffer.isBuffer(row.pdf_blob)
    ? row.pdf_blob
    : Buffer.from(row.pdf_blob || Buffer.alloc(0));

  assertPdfBuffer(body);

  const digest = digestPdf(body);
  if (String(row.sha256 || '') !== digest || (payload.sha256 && String(payload.sha256) !== digest)) {
    const error = new Error('Durable Finance PDF hash verification failed.');
    error.code = 'FINANCE_REPORT_DELIVERY_HASH_MISMATCH';
    throw error;
  }

  if (Number(row.byte_size || 0) !== body.length) {
    const error = new Error('Durable Finance PDF size verification failed.');
    error.code = 'FINANCE_REPORT_DELIVERY_SIZE_MISMATCH';
    throw error;
  }

  return { state: 'ready', row, body };
}

async function loadBackupPdf(payload, row = null) {
  const key = String(row?.object_storage_key || payload?.key || '').trim();
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

async function cleanupExpiredDelivery(payload, row = null) {
  if (Number(payload?.v) === 2 && payload?.id) {
    await pool.query(
      'DELETE FROM finance_report_email_deliveries WHERE delivery_uid = ?',
      [payload.id]
    ).catch(() => {});
  }

  const key = String(row?.object_storage_key || payload?.key || '').trim();
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

  let databaseResult = null;
  let databaseError = null;

  try {
    databaseResult = await loadDurableDatabasePdf(payload);
  } catch (error) {
    databaseError = error;
  }

  if (databaseResult?.state === 'revoked') {
    return res.status(410).json({ message: 'This PDF delivery link has been revoked.' });
  }

  if (databaseResult?.state === 'expired') {
    await cleanupExpiredDelivery(payload, databaseResult.row);
    return res.status(410).json({ message: 'This PDF delivery link has expired.' });
  }

  if (databaseResult?.state === 'ready') {
    await pool.query(
      `UPDATE finance_report_email_deliveries
          SET access_count = access_count + 1,
              first_accessed_at = COALESCE(first_accessed_at, NOW()),
              last_accessed_at = NOW()
        WHERE delivery_uid = ?`,
      [payload.id]
    ).catch(() => {});

    return sendPdfResponse(res, databaseResult.body, databaseResult.row.filename || tokenFilename);
  }

  const backupBody = await loadBackupPdf(payload, databaseResult?.row || null);
  if (backupBody) return sendPdfResponse(res, backupBody, tokenFilename);

  console.error(
    'FINANCE PDF DELIVERY ERROR:',
    String(databaseError?.code || 'DURABLE_PDF_UNAVAILABLE'),
    Number(databaseError?.status || 0) || ''
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
    digestPdf,
    publicAppUrl
  }
};
