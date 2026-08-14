const pool = require('../config/db');
const {
  isEmailConfigured,
  missingSmtpKeys,
  smtpConfig,
  verifyConnection,
  sendMail,
  emailFailureDetails,
  isEmailTransportError
} = require('../services/emailService');
const { processEmailQueue } = require('../services/emailQueue');
const { renderEmailTemplate, templates } = require('../services/emailTemplates');
const { ensureWorkforceSchema } = require('../services/workforceSchema');
const { companyProfile } = require('../config/companyProfile');

function pageSize(value) {
  return Math.max(1, Math.min(Number(value) || 25, 100));
}

function masked(value) {
  const text = String(value || '');
  if (!text) return '';
  const at = text.indexOf('@');
  if (at > 2) return `${text.slice(0, 2)}***${text.slice(at)}`;
  return `${text.slice(0, 2)}***`;
}

exports.config = async (_req, res) => {
  const config = smtpConfig();
  const company = companyProfile();
  return res.json({
    provider: 'Hostinger SMTP',
    configured: isEmailConfigured(),
    missing: missingSmtpKeys(),
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: masked(config.user),
    from_name: config.fromName,
    from_address: config.fromEmail,
    reply_to: config.replyTo,
    support_address: company.supportEmail,
    password_configured: Boolean(config.pass)
  });
};

exports.verify = async (_req, res) => {
  try {
    const result = await verifyConnection();
    return res.json({ message: 'SMTP connection verified successfully.', ...result });
  } catch (error) {
    console.error('SMTP VERIFY ERROR:', error.message);
    const details = emailFailureDetails(error);
    return res.status(details.status).json(details);
  }
};

exports.sendTest = async (req, res) => {
  try {
    const recipient = String(req.body.to || req.user?.email || '').trim();
    const rendered = renderEmailTemplate('general_notification', {
      subject: 'Voxel Veda SMTP test',
      preview: 'Voxel Veda email delivery is configured correctly.',
      title: 'Voxel Veda email test',
      message: 'Your Hostinger SMTP connection and Voxel Veda delivery queue are working correctly.'
    });
    const result = await sendMail({
      to: recipient,
      ...rendered,
    });
    return res.json({
      message: `Test email sent to ${recipient}.`,
      message_id: result.messageId || null
    });
  } catch (error) {
    console.error('SMTP TEST ERROR:', error.message);
    const details = isEmailTransportError(error)
      ? emailFailureDetails(error)
      : { status: 400, message: error.message, code: error.code || 'EMAIL_TEST_FAILED' };
    return res.status(details.status).json(details);
  }
};

exports.queue = async (req, res) => {
  try {
    await ensureWorkforceSchema();
    const limit = pageSize(req.query.limit);
    const page = Math.max(1, Number(req.query.page) || 1);
    const status = String(req.query.status || '').trim().toUpperCase();
    const params = [];
    const where = status ? 'WHERE status = ?' : '';
    if (status) params.push(status);
    params.push(limit, (page - 1) * limit);
    const [rows] = await pool.query(
      `SELECT id, template_key, to_json, subject, related_module, related_record_id, status,
        attempts, max_attempts, scheduled_at, next_attempt_at, last_error, message_id, created_at, sent_at
       FROM email_queue ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    const [countRows] = await pool.query(
      'SELECT status, COUNT(*) AS total FROM email_queue GROUP BY status'
    );
    const counts = countRows.reduce((result, row) => {
      result[String(row.status || 'UNKNOWN').toUpperCase()] = Number(row.total || 0);
      return result;
    }, {});
    return res.json({ emails: rows, counts, page, limit });
  } catch (error) {
    console.error('EMAIL QUEUE LIST ERROR:', error);
    return res.status(500).json({ message: 'Unable to load the email queue.' });
  }
};

exports.logs = async (req, res) => {
  try {
    await ensureWorkforceSchema();
    const limit = pageSize(req.query.limit);
    const [rows] = await pool.query(
      `SELECT id, queue_id, related_module, related_record_id, recipients, subject, status,
        provider_message_id, error_message, created_by, created_at
       FROM email_logs ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return res.json({ logs: rows });
  } catch (error) {
    console.error('EMAIL LOG LIST ERROR:', error);
    return res.status(500).json({ message: 'Unable to load email delivery logs.' });
  }
};

exports.process = async (req, res) => {
  try {
    const outcomes = await processEmailQueue(pageSize(req.body.limit || 10));
    return res.json({ message: 'Email queue processed.', outcomes });
  } catch (error) {
    console.error('EMAIL QUEUE PROCESS ERROR:', error);
    return res.status(500).json({ message: error.message || 'Unable to process the email queue.' });
  }
};

exports.retry = async (req, res) => {
  try {
    await ensureWorkforceSchema();
    const [result] = await pool.query(
      `UPDATE email_queue SET status = 'RETRY', next_attempt_at = NOW(), last_error = NULL
       WHERE id = ? AND status IN ('FAILED', 'RETRY')`,
      [Number(req.params.id)]
    );
    if (!result.affectedRows) return res.status(409).json({ message: 'Only failed emails can be retried.' });
    return res.json({ message: 'Email queued for retry.' });
  } catch (error) {
    console.error('EMAIL RETRY ERROR:', error);
    return res.status(500).json({ message: 'Unable to retry this email.' });
  }
};

exports.templates = async (_req, res) => res.json({
  templates: Object.entries(templates).map(([key, value]) => ({
    key,
    subject: value.subject,
    supports_html: true,
    supports_text: true
  }))
});
