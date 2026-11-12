'use strict';
const crypto = require('node:crypto');
const { validatePdf, safePdfFilename } = require('./documentPdfService');
const { assertWeeklyDeliveryPolicy, assertWeeklyDeliveryContent } = require('./weeklyDeliveryPolicy');

const API_ORIGIN = 'https://api.resend.com';
const COMPANY_SENDER = 'info@voxelveda.com';

function resendConfig() {
  const requested = Number(process.env.RESEND_TIMEOUT_MS || 15000);
  return { apiKey: String(process.env.RESEND_API_KEY || '').trim(), timeoutMs: Number.isFinite(requested) ? Math.max(1000, Math.min(requested, 60000)) : 15000 };
}
function missingResendKeys() { return resendConfig().apiKey ? [] : ['RESEND_API_KEY']; }
function isResendConfigured() { return missingResendKeys().length === 0; }
function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, retryable: false, deliveryOutcome: 'NOT_DISPATCHED', deliveryAttempted: false, ...extra });
}
function review(reason, providerAccepted = false) {
  return failure('DELIVERY_REVIEW_REQUIRED', 'The email provider outcome requires review before another send. Automatic resend is disabled.', { reasonCode: reason, providerAccepted, deliveryOutcome: 'UNKNOWN', deliveryAttempted: true });
}
function addresses(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[;,]/u);
  const result = values.map(v => String(v || '').trim()).filter(Boolean);
  if (result.some(v => !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/u.test(v))) throw failure('EMAIL_RECIPIENT_INVALID', 'A valid email recipient is required.');
  return result;
}
function senderValue(sender) {
  if (String(sender?.fromEmail || '').trim().toLowerCase() !== COMPANY_SENDER) throw failure('RESEND_SENDER_INVALID', 'The authorised company sender must be info@voxelveda.com.');
  const name = String(sender.fromName || 'Voxel Veda').replace(/[\r\n<>"\\]/gu, '').trim();
  return `${name || 'Voxel Veda'} <${COMPANY_SENDER}>`;
}
async function prepareMessage(message, sender) {
  const to = addresses(message.to), cc = addresses(message.cc), bcc = addresses(message.bcc);
  if (!to.length) throw failure('EMAIL_RECIPIENT_REQUIRED', 'At least one valid recipient is required.');
  const checked = assertWeeklyDeliveryPolicy(message, { ...message, to, cc, bcc });
  assertWeeklyDeliveryContent(message, checked);
  const payload = { from: senderValue(sender), to, subject: String(message.subject || ''), html: String(message.html || ''), text: String(message.text || '') };
  if (/[\r\n]/u.test(payload.subject) || !payload.subject.trim()) throw failure('EMAIL_SUBJECT_INVALID', 'A valid single-line email subject is required.');
  if (!payload.html && !payload.text) throw failure('EMAIL_CONTENT_REQUIRED', 'Email content is required.');
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  const replyTo = addresses(message.replyTo || sender.replyTo || COMPANY_SENDER);
  if (replyTo.length) payload.reply_to = replyTo;
  const attachments = [];
  let attachmentBytes = 0;
  for (const attachment of message.attachments || []) {
    if (!/\.pdf$/iu.test(String(attachment.filename || ''))) throw failure('PDF_ATTACHMENT_FILENAME_INVALID', 'Document attachments must have a .pdf filename.');
    if (attachment.contentType && attachment.contentType !== 'application/pdf') throw failure('PDF_ATTACHMENT_MIME_INVALID', 'Document attachments must declare application/pdf.');
    const bytes = Buffer.isBuffer(attachment.content) ? attachment.content : attachment.content?.type === 'Buffer' && Array.isArray(attachment.content.data) ? Buffer.from(attachment.content.data) : null;
    if (!bytes || !bytes.length) throw failure('PDF_ATTACHMENT_CONTENT_INVALID', 'Document attachment bytes are required.');
    attachmentBytes += bytes.length;
    if (attachmentBytes > 20 * 1024 * 1024) throw failure('PDF_ATTACHMENT_SIZE_INVALID', 'Document attachments exceed the permitted size.');
    await validatePdf(bytes, { expectedText: attachment.expectedText || [] });
    attachments.push({ filename: safePdfFilename(attachment.filename), content: bytes.toString('base64'), content_type: 'application/pdf' });
  }
  if (attachments.length) payload.attachments = attachments;
  const serialized = JSON.stringify(payload);
  const payloadHash = crypto.createHash('sha256').update(serialized).digest('hex');
  // Queue callers supply a durable record key. Direct security messages use a
  // content key, so retrying the same token cannot create a second send.
  const idempotencyKey = 'voxelveda-' + crypto.createHash('sha256').update(String(message.deliveryKey || payloadHash)).digest('hex');
  return { payload, serialized, payloadHash, idempotencyKey };
}
function retryAfterMs(response) {
  const raw = response.headers?.get?.('retry-after');
  const seconds = Number(raw);
  const duration = raw && Number.isFinite(seconds) ? seconds * 1000 : raw ? Date.parse(raw) - Date.now() : 60000;
  return Number.isFinite(duration) ? Math.max(1000, Math.min(duration, 3600000)) : 60000;
}
async function request(path, config, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(API_ORIGIN + path, { ...options, headers: { Accept: 'application/json', Authorization: `Bearer ${config.apiKey}`, ...options.headers }, redirect: 'error', signal: controller.signal });
    let body;
    try { body = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; }
    return { response, body };
  } finally { clearTimeout(timer); }
}
async function sendViaResend(message, sender) {
  const config = resendConfig();
  if (!config.apiKey) throw failure('RESEND_CONFIG_MISSING', 'Resend email configuration is incomplete.');
  const prepared = await prepareMessage(message, sender);
  let response, body;
  try {
    ({ response, body } = await request('/emails', config, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': prepared.idempotencyKey }, body: prepared.serialized }));
  } catch (error) {
    if (error.code === 'DELIVERY_REVIEW_REQUIRED') throw error;
    throw review('RESEND_NETWORK_OUTCOME_UNKNOWN');
  }
  if (response.ok) {
    if (!body || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(String(body.id || ''))) throw review('RESEND_ACCEPTANCE_RESPONSE_INVALID');
    return { messageId: body.id, providerMessageId: body.id, accepted: prepared.payload.to, rejected: [], transport: 'resend', providerAccepted: true, receivedVerified: false, attachmentFilenameGuaranteed: true, contentHash: prepared.payloadHash };
  }
  if (response.status === 409) throw review('RESEND_IDEMPOTENCY_CONFLICT');
  if (response.status === 429) throw failure('RESEND_RATE_LIMITED', 'The email provider rate limit requires a bounded retry.', { retryable: true, retryAfterMs: retryAfterMs(response), deliveryOutcome: 'NOT_ACCEPTED', deliveryAttempted: true, httpStatus: 429 });
  if (response.status >= 500 || response.status < 400) throw review('RESEND_PROVIDER_OUTCOME_UNKNOWN');
  throw failure([401,403].includes(response.status) ? 'RESEND_AUTHENTICATION_FAILED' : 'RESEND_MESSAGE_REJECTED', 'The email provider rejected the request. An administrator must review sender configuration or message validation.', { deliveryOutcome: 'NOT_ACCEPTED', deliveryAttempted: true, httpStatus: response.status });
}
async function verifyResendConnection(sender) {
  const config = resendConfig();
  if (!config.apiKey) throw failure('RESEND_CONFIG_MISSING', 'Resend email configuration is incomplete.');
  senderValue(sender);
  let response, body;
  try {
    ({ response, body } = await request('/domains', config, { method: 'GET' }));
  } catch { throw failure('RESEND_CONNECTION_UNAVAILABLE', 'The Resend API connection could not be verified.', { retryable: true }); }
  const base = { transport: 'resend', provider: 'resend', configured: true, connectivity_verified: true, credentials_verified: false, sender_domain_verified: false, recipient_receipt_verified: false, recipient_verified: false, verification: 'CONFIGURED' };
  // Sending-only keys are deliberately valid for delivery without /domains
  // access. A restricted read cannot establish sender verification or receipt.
  if (response.status === 403 && body?.name === 'restricted_api_key') return { ...base, reason_code: 'RESEND_SENDING_KEY_DOMAIN_READ_UNAVAILABLE' };
  if (!response.ok) throw failure([401,403].includes(response.status) ? 'RESEND_AUTHENTICATION_FAILED' : 'RESEND_CONNECTION_UNAVAILABLE', 'The Resend API health check could not verify company email configuration.', { retryable: response.status === 429 || response.status >= 500 });
  if (!body || !Array.isArray(body.data)) throw failure('RESEND_CONNECTION_UNAVAILABLE', 'The Resend API health response was invalid.');
  const verified = body.data.some(domain => domain?.name === 'voxelveda.com' && domain?.status === 'verified');
  return { ...base, credentials_verified: true, sender_domain_verified: verified, verification: verified ? 'SENDER_VERIFIED' : 'API_AUTHENTICATED', reason_code: verified ? 'RESEND_SENDER_DOMAIN_VERIFIED' : 'RESEND_SENDER_DOMAIN_NOT_VERIFIED' };
}
module.exports = { resendConfig, missingResendKeys, isResendConfigured, sendViaResend, verifyResendConnection, prepareMessage };
