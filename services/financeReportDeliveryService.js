'use strict';

const crypto = require('node:crypto');
const { putObject, getObject, deleteObject } = require('./objectStorageService');

const DEFAULT_TTL_MINUTES = 24 * 60;
const MAX_TTL_MINUTES = 48 * 60;

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
  if (!payload || payload.v !== 1 || !payload.key || !payload.filename || !Number(payload.exp)) {
    const error = new Error('Invalid finance report delivery token.');
    error.code = 'FINANCE_REPORT_DELIVERY_TOKEN_INVALID';
    throw error;
  }
  return payload;
}

function publicAppUrl() {
  const value = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://app.voxelveda.com').trim();
  return value.replace(/\/+$/, '');
}

function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    const error = new Error('Finance report delivery requires a valid PDF buffer.');
    error.code = 'FINANCE_REPORT_DELIVERY_PDF_INVALID';
    throw error;
  }
}

async function issuePdfDelivery({ buffer, filename, ttlMinutes = DEFAULT_TTL_MINUTES }) {
  assertPdfBuffer(buffer);
  const safeFilename = safePdfFilename(filename);
  const requestedTtl = Number(ttlMinutes || DEFAULT_TTL_MINUTES);
  const boundedTtl = Math.max(15, Math.min(
    Number.isFinite(requestedTtl) ? requestedTtl : DEFAULT_TTL_MINUTES,
    MAX_TTL_MINUTES
  ));
  const expiresAt = Date.now() + boundedTtl * 60 * 1000;
  const objectId = crypto.randomUUID();
  const key = `finance-email-delivery/${expiresAt}-${objectId}/${safeFilename}`;

  await putObject(key, buffer, 'application/pdf');

  const token = createDeliveryToken({
    v: 1,
    key,
    filename: safeFilename,
    exp: expiresAt
  });

  const timer = setTimeout(() => {
    deleteObject(key).catch(() => {});
  }, boundedTtl * 60 * 1000 + 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    url: `${publicAppUrl()}/api/public/finance-report/${encodeURIComponent(token)}`,
    filename: safeFilename,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMinutes: boundedTtl,
    objectKey: key
  };
}

async function servePdfDelivery(req, res) {
  let payload;
  try {
    payload = decodeDeliveryToken(req.params.token);
  } catch {
    return res.status(404).json({ message: 'This PDF delivery link is invalid.' });
  }

  if (Date.now() > Number(payload.exp)) {
    await deleteObject(payload.key).catch(() => {});
    return res.status(410).json({ message: 'This PDF delivery link has expired.' });
  }

  try {
    const body = await getObject(payload.key);
    assertPdfBuffer(body);
    const filename = safePdfFilename(payload.filename);
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(body);
  } catch (error) {
    console.error('FINANCE PDF DELIVERY ERROR:', error.code || error.message);
    return res.status(404).json({ message: 'The requested PDF report is no longer available.' });
  }
}

module.exports = {
  createDeliveryToken,
  decodeDeliveryToken,
  issuePdfDelivery,
  safePdfFilename,
  servePdfDelivery,
  _test: { assertPdfBuffer }
};
