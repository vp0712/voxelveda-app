const nodemailer = require('nodemailer');

const SMTP_FIELDS = {
  host: ['SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST'],
  port: ['SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT'],
  user: ['SMTP_USER', 'EMAIL_USER', 'MAIL_USER'],
  pass: ['SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS', 'SMTP_PASSWORD', 'EMAIL_PASSWORD'],
  fromEmail: ['FROM_EMAIL', 'EMAIL_FROM', 'MAIL_FROM']
};

const REQUIRED_SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function smtpConfig() {
  const user = firstEnv(SMTP_FIELDS.user);
  return {
    host: firstEnv(SMTP_FIELDS.host),
    port: firstEnv(SMTP_FIELDS.port),
    user,
    pass: firstEnv(SMTP_FIELDS.pass),
    fromEmail: firstEnv(SMTP_FIELDS.fromEmail) || user,
    fromName: process.env.FROM_NAME || 'Voxel Veda',
    secure: process.env.SMTP_SECURE
  };
}

function missingSmtpKeys() {
  const config = smtpConfig();
  const missing = [];
  if (!config.host) missing.push('SMTP_HOST');
  if (!config.port) missing.push('SMTP_PORT');
  if (!config.user) missing.push('SMTP_USER');
  if (!config.pass) missing.push('SMTP_PASS');
  if (!config.fromEmail) missing.push('FROM_EMAIL');
  return missing;
}

function isEmailConfigured() {
  return missingSmtpKeys().length === 0;
}

function createTransporter() {
  const missing = missingSmtpKeys();
  if (missing.length) {
    const err = new Error(`SMTP is not configured. Missing: ${missing.join(', ')}`);
    err.code = 'SMTP_CONFIG_MISSING';
    throw err;
  }

  const config = smtpConfig();
  const port = Number(config.port);
  return nodemailer.createTransport({
    host: config.host,
    port,
    secure: config.secure ? String(config.secure) === 'true' : port === 465,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

async function sendMail({ to, subject, html, text, replyTo }) {
  const config = smtpConfig();
  return createTransporter().sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to,
    subject,
    html,
    text,
    replyTo
  });
}

module.exports = { sendMail, isEmailConfigured, missingSmtpKeys, smtpConfig };