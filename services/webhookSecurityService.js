const crypto = require('crypto');
const pool = require('../config/db');
const { ensureOperationalTrustSchema } = require('./operationalTrustSchema');

function safeEqualHex(expected, supplied) {
  if (!/^[a-f0-9]{64}$/i.test(String(supplied || ''))) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(String(supplied), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseSignature(value) {
  const match = String(value || '').trim().match(/^sha256=([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : '';
}

function verifyWebhookSignature({ rawBody, timestamp, signature, secret = process.env.WEBHOOK_SIGNING_KEY, now = Date.now() }) {
  if (!secret || Buffer.byteLength(secret) < 32) return { ok: false, code: 'WEBHOOK_NOT_CONFIGURED' };
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return { ok: false, code: 'STALE_WEBHOOK' };
  const supplied = parseSignature(signature);
  const expected = crypto.createHmac('sha256', secret).update(`${seconds}.`).update(rawBody || Buffer.alloc(0)).digest('hex');
  return { ok: safeEqualHex(expected, supplied), code: supplied ? 'INVALID_SIGNATURE' : 'MISSING_SIGNATURE' };
}

async function acceptWebhook(req, sourceKey) {
  await ensureOperationalTrustSchema();
  const eventId = String(req.get('x-vv-event-id') || '').trim();
  const eventType = String(req.get('x-vv-event-type') || '').trim().toUpperCase();
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(eventId) || !/^[A-Z0-9._:-]{3,100}$/.test(eventType)) {
    throw Object.assign(new Error('Valid webhook event ID and event type are required'), { statusCode: 400 });
  }
  const [[source]] = await pool.query('SELECT source_key, allowed_events_json, active FROM webhook_sources WHERE source_key = ? LIMIT 1', [sourceKey]);
  if (!source || Number(source.active) !== 1) throw Object.assign(new Error('Webhook source is unavailable'), { statusCode: 404 });
  const allowed = Array.isArray(source.allowed_events_json) ? source.allowed_events_json : JSON.parse(source.allowed_events_json || '[]');
  if (!allowed.includes(eventType)) throw Object.assign(new Error('Webhook event type is not allowed'), { statusCode: 403 });
  const verification = verifyWebhookSignature({ rawBody: req.rawBody, timestamp: req.get('x-vv-timestamp'), signature: req.get('x-vv-signature') });
  if (!verification.ok) throw Object.assign(new Error('Webhook signature verification failed'), { statusCode: verification.code === 'WEBHOOK_NOT_CONFIGURED' ? 503 : 401 });
  const payloadHash = crypto.createHash('sha256').update(req.rawBody || Buffer.alloc(0)).digest('hex');
  try {
    await pool.query(
      `INSERT INTO webhook_receipts (source_key, event_id, event_type, payload_sha256, signature_key_version)
       VALUES (?, ?, ?, ?, ?)`,
      [sourceKey, eventId, eventType, payloadHash, String(process.env.WEBHOOK_SIGNING_KEY_VERSION || 'v1').slice(0, 30)]
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return { duplicate: true, eventId };
    throw error;
  }
  return { duplicate: false, eventId, eventType };
}

module.exports = { acceptWebhook, parseSignature, verifyWebhookSignature };
