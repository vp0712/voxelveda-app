const nodemailer = require('nodemailer');

const REQUIRED_SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];

function missingSmtpKeys() {
  return REQUIRED_SMTP_KEYS.filter((key) => !process.env[key]);
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

  const port = Number(process.env.SMTP_PORT);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? String(process.env.SMTP_SECURE) === 'true' : port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendMail({ to, subject, html, text, replyTo }) {
  return createTransporter().sendMail({
    from: `"${process.env.FROM_NAME || 'Voxel Veda'}" <${process.env.FROM_EMAIL}>`,
    to,
    subject,
    html,
    text,
    replyTo
  });
}

module.exports = { sendMail, isEmailConfigured, missingSmtpKeys };
