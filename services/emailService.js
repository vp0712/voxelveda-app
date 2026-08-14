const nodemailer = require('nodemailer');
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

function isEmailConfigured() {
  return missingSmtpKeys().length === 0;
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
  'EDNS'
]);

function isEmailTransportError(error) {
  const code = String(error?.code || '').toUpperCase();
  return EMAIL_TRANSPORT_CODES.has(code) || /smtp|socket|connection|timed?\s*out/i.test(String(error?.message || ''));
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
  const transporter = createTransporter();
  try {
    await transporter.verify();
    return { ok: true, host: smtpConfig().host, port: smtpConfig().port };
  } finally {
    transporter.close();
  }
}

async function sendMail({ to, cc, bcc, subject, html, text, replyTo, attachments = [] }) {
  const config = smtpConfig();
  const transporter = createTransporter();
  const recipients = validateRecipients(to, 'to');
  const ccRecipients = validateRecipients(cc, 'cc');
  const bccRecipients = validateRecipients(bcc, 'bcc');

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
  normalizeAddressList,
  validateRecipients,
  isEmailTransportError,
  emailFailureDetails
};
