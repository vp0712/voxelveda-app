const nodemailer = require('nodemailer');
const fs = require('node:fs');
const { companyProfile } = require('../config/companyProfile');

const SMTP_FIELDS = {
  host: ['SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST'],
  port: ['SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT'],
  user: ['SMTP_USERNAME', 'SMTP_USER', 'EMAIL_USER', 'MAIL_USER'],
  pass: ['SMTP_PASSWORD', 'SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS', 'EMAIL_PASSWORD'],
  fromEmail: ['MAIL_FROM_ADDRESS', 'FROM_EMAIL', 'EMAIL_FROM', 'MAIL_FROM'],
  fromName: ['MAIL_FROM_NAME', 'FROM_NAME']
};

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function smtpConfig() {
  const profile = companyProfile();
  const user = firstEnv(SMTP_FIELDS.user) || profile.email;
  const port = Number(firstEnv(SMTP_FIELDS.port) || 465);
  return {
    host: firstEnv(SMTP_FIELDS.host) || 'smtp.hostinger.com',
    port,
    user,
    pass: firstEnv(SMTP_FIELDS.pass),
    fromEmail: firstEnv(SMTP_FIELDS.fromEmail) || profile.email || user,
    fromName: firstEnv(SMTP_FIELDS.fromName) || profile.name,
    secure: process.env.SMTP_SECURE === undefined
      ? port === 465
      : String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    replyTo: profile.replyTo
  };
}

function missingSmtpKeys() {
  const config = smtpConfig();
  const missing = [];
  if (!config.host) missing.push('SMTP_HOST');
  if (!config.port) missing.push('SMTP_PORT');
  if (!config.user) missing.push('SMTP_USERNAME');
  if (!config.pass) missing.push('SMTP_PASSWORD');
  if (!config.fromEmail) missing.push('MAIL_FROM_ADDRESS');
  return missing;
}

function relayConfig() {
  const requestedTimeout = Number(process.env.WORDPRESS_MAIL_RELAY_TIMEOUT_MS || 15000);
  return {
    url: String(process.env.WORDPRESS_MAIL_RELAY_URL || '').trim(),
    token: String(process.env.WORDPRESS_MAIL_RELAY_TOKEN || '').trim(),
    timeoutMs: Number.isFinite(requestedTimeout) && requestedTimeout >= 1000
      ? Math.min(requestedTimeout, 60000)
      : 15000
  };
}

function isRelayConfigured() {
  const config = relayConfig();
  return Boolean(config.url.startsWith('https://') && config.token);
}

function isEmailConfigured() {
  return isRelayConfigured() || missingSmtpKeys().length === 0;
}

const EMAIL_TRANSPORT_CODES = new Set([
  'SMTP_CONFIG_MISSING',
  'EAUTH',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EDNS',
  'EMAIL_HTTPS_RELAY_FAILED'
]);

function isEmailTransportError(error) {
  const code = String(error?.code || '').toUpperCase();
  return EMAIL_TRANSPORT_CODES.has(code) || /smtp|socket|connection|timed?\s*out/i.test(String(error?.message || ''));
}

function classifySmtpFailure(error) {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || 0) || null;
  const command = String(error?.command || '').toUpperCase() || null;
  if (code === 'EAUTH' || [530, 534, 535].includes(responseCode)) return { category: 'AUTHENTICATION', retryable: false, code: code || 'EAUTH', response_code: responseCode, command };
  if (code === 'ETIMEDOUT') return { category: 'TIMEOUT', retryable: true, code, response_code: responseCode, command };
  if (code === 'EDNS') return { category: 'DNS', retryable: true, code, response_code: responseCode, command };
  if (['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ECONNECTION','ESOCKET'].includes(code)) return { category: 'NETWORK', retryable: true, code, response_code: responseCode, command };
  if (responseCode && responseCode >= 500) return { category: 'PROVIDER_REJECTION', retryable: false, code: code || 'SMTP_REJECTED', response_code: responseCode, command };
  if (responseCode && responseCode >= 400) return { category: 'PROVIDER_TEMPORARY', retryable: true, code: code || 'SMTP_TEMPORARY', response_code: responseCode, command };
  return { category: 'UNKNOWN', retryable: true, code: code || 'SMTP_CONNECTION_FAILED', response_code: responseCode, command };
}

function smtpReadinessSummary(error = null) {
  const config = smtpConfig();
  const base = {
    configured: isEmailConfigured(),
    host: config.host,
    port: config.port,
    secure: config.secure,
    identity_domain: String(config.user || '').split('@')[1] || null,
    from_domain: String(config.fromEmail || '').split('@')[1] || null,
    missing: missingSmtpKeys()
  };
  return error ? { ...base, ok: false, failure: classifySmtpFailure(error) } : { ...base, ok: true, failure: null };
}

function emailFailureDetails(error) {
  const code = String(error?.code || 'EMAIL_DELIVERY_FAILED').toUpperCase();

  if (code === 'SMTP_CONFIG_MISSING') {
    return {
      status: 503,
      code,
      message: 'Company email setup is incomplete. Preview or download the document while an administrator completes email configuration.',
      missing: missingSmtpKeys(),
      retryable: false
    };
  }

  if (code === 'EAUTH') {
    return {
      status: 503,
      code: 'EMAIL_AUTHENTICATION_FAILED',
      message: 'The company mailbox rejected the sign-in. An administrator must verify the mailbox credentials before direct delivery can resume.',
      retryable: false
    };
  }

  if (isEmailTransportError(error)) {
    return {
      status: 503,
      code: 'EMAIL_TRANSPORT_UNAVAILABLE',
      message: 'Direct email delivery is unavailable from the current hosting connection. The document is still ready to preview, download, or send from your mail app.',
      retryable: true
    };
  }

  return {
    status: 502,
    code: 'EMAIL_DELIVERY_FAILED',
    message: 'The email provider could not complete delivery. The document is still ready to preview or download.',
    retryable: true
  };
}

function normalizeAddressList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

function validateRecipients(value, field = 'recipient') {
  const recipients = normalizeAddressList(value);
  const invalid = recipients.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!recipients.length && field === 'to') {
    const error = new Error('At least one valid recipient is required.');
    error.code = 'EMAIL_RECIPIENT_REQUIRED';
    throw error;
  }
  if (invalid.length) {
    const error = new Error(`Invalid ${field}: ${invalid.join(', ')}`);
    error.code = 'EMAIL_RECIPIENT_INVALID';
    throw error;
  }
  return recipients;
}

function createTransporter() {
  const missing = missingSmtpKeys();
  if (missing.length) {
    const error = new Error(`SMTP is not configured. Missing: ${missing.join(', ')}`);
    error.code = 'SMTP_CONFIG_MISSING';
    throw error;
  }

  const config = smtpConfig();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 15000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 30000),
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 3),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100)
  });
}

async function verifyConnection() {
  if (isRelayConfigured()) {
    const config = relayConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.url.replace(/\/+$/, '')}/health`, {
        method: 'GET',
        headers: { 'X-Voxel-Veda-Relay-Token': config.token },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`WordPress mail relay health check returned ${response.status}`);
        error.code = 'EMAIL_HTTPS_RELAY_FAILED';
        throw error;
      }
      console.log('Email HTTPS relay evidence: ok=yes provider=wordpress_wp_mail transport=https');
      return { configured: true, ok: true, provider: 'wordpress_wp_mail', transport: 'https' };
    } catch (error) {
      if (!error.code || error.name === 'AbortError') error.code = 'EMAIL_HTTPS_RELAY_FAILED';
      console.warn(`Email HTTPS relay evidence: ok=no provider=wordpress_wp_mail code=${error.code}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const transporter = createTransporter();
  try {
    await transporter.verify();
    const summary = smtpReadinessSummary();
    console.log(`SMTP transport evidence: ok=yes host=${summary.host} port=${summary.port} secure=${summary.secure ? 'yes' : 'no'} identity_domain=${summary.identity_domain || 'unknown'} from_domain=${summary.from_domain || 'unknown'}`);
    return summary;
  } catch (error) {
    const summary = smtpReadinessSummary(error);
    const f = summary.failure;
    console.warn(`SMTP transport evidence: ok=no category=${f.category} code=${f.code} response_code=${f.response_code || 'none'} command=${f.command || 'none'} host=${summary.host} port=${summary.port} secure=${summary.secure ? 'yes' : 'no'} identity_domain=${summary.identity_domain || 'unknown'} from_domain=${summary.from_domain || 'unknown'}`);
    error.smtpReadiness = summary;
    throw error;
  } finally {
    transporter.close();
  }
}

async function relayAttachments(attachments = []) {
  let totalBytes = 0;
  const encoded = [];
  for (const attachment of attachments) {
    if (!attachment?.path) continue;
    const content = await fs.promises.readFile(attachment.path);
    totalBytes += content.length;
    if (totalBytes > 20 * 1024 * 1024) {
      const error = new Error('Email relay attachments exceed the 20 MB limit.');
      error.code = 'EMAIL_RELAY_ATTACHMENT_LIMIT';
      throw error;
    }
    encoded.push({
      filename: String(attachment.filename || 'attachment').slice(0, 180),
      content_type: String(attachment.contentType || 'application/octet-stream').slice(0, 120),
      content_base64: content.toString('base64')
    });
  }
  return encoded;
}

async function sendViaHttpsRelay({ to, cc, bcc, subject, html, text, replyTo, attachments }) {
  const config = relayConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Voxel-Veda-Relay-Token': config.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to,
        cc,
        bcc,
        subject: String(subject || '').trim(),
        html: html || '',
        text: text || '',
        reply_to: replyTo || '',
        request_id: `railway-${Date.now()}`,
        attachments: await relayAttachments(attachments)
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    let result = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }
    if (!response.ok || result.sent !== true) {
      const error = new Error(result.message || `WordPress mail relay returned ${response.status}`);
      error.code = 'EMAIL_HTTPS_RELAY_FAILED';
      error.responseCode = response.status;
      throw error;
    }
    return { messageId: result.provider_message_id || result.request_id || null, accepted: to };
  } catch (error) {
    if (!error.code || error.name === 'AbortError') error.code = 'EMAIL_HTTPS_RELAY_FAILED';
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMail({ to, cc, bcc, subject, html, text, replyTo, attachments = [] }) {
  const recipients = validateRecipients(to, 'to');
  const ccRecipients = validateRecipients(cc, 'cc');
  const bccRecipients = validateRecipients(bcc, 'bcc');

  if (isRelayConfigured()) {
    return sendViaHttpsRelay({
      to: recipients,
      cc: ccRecipients,
      bcc: bccRecipients,
      subject,
      html,
      text,
      replyTo,
      attachments
    });
  }

  const config = smtpConfig();
  const transporter = createTransporter();

  try {
    return await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: recipients,
      cc: ccRecipients.length ? ccRecipients : undefined,
      bcc: bccRecipients.length ? bccRecipients : undefined,
      subject: String(subject || '').trim(),
      html: html || undefined,
      text: text || undefined,
      replyTo: replyTo || config.replyTo || undefined,
      attachments
    });
  } finally {
    transporter.close();
  }
}

module.exports = {
  sendMail,
  verifyConnection,
  createTransporter,
  isEmailConfigured,
  missingSmtpKeys,
  smtpConfig,
  smtpReadinessSummary,
  classifySmtpFailure,
  isRelayConfigured,
  relayConfig,
  normalizeAddressList,
  validateRecipients,
  isEmailTransportError,
  emailFailureDetails
};
