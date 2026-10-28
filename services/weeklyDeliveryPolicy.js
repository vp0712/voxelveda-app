'use strict';
function privacyError(reason) {
  return Object.assign(new Error('Weekly timesheet delivery requires one designated staff recipient and a verified delivery policy. No message was sent.'), { code: 'DELIVERY_REVIEW_REQUIRED', reasonCode: reason });
}
function weeklyMessage(message) {
  const module = String(message.relatedModule || message.related_module || '').toLowerCase();
  const template = String(message.templateKey || message.template_key || '').toLowerCase();
  return String(message.deliveryKey || message.idempotencyKey || message.idempotency_key || '').startsWith('weekly-timesheet:')
    || message.deliveryPolicy?.type === 'WEEKLY_TIMESHEET'
    || /WEEKLY_TIMESHEET/.test(String(message.delivery_policy_json || ''))
    || /^(?:weekly_timesheet|timesheet_summary)(?:_|$)/.test(template)
    || (module === 'timesheets' && /\bweekly\s+timesheet\b/i.test(String(message.subject || '')));
}
function assertWeeklyDeliveryPolicy(message, addresses) {
  if (!weeklyMessage(message)) return null;
  const p = message.deliveryPolicy;
  if (!p || p.type !== 'WEEKLY_TIMESHEET' || !Number.isSafeInteger(Number(p.staffId)) || Number(p.staffId) < 1 ||
      !Number.isSafeInteger(Number(p.deliveryId)) || Number(p.deliveryId) < 1 || !Number.isSafeInteger(Number(p.revision)) || Number(p.revision) < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(p.fromDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.toDate)) ||
      !/^[a-f0-9]{64}$/.test(String(p.sourceHash)) || typeof p.recipient !== 'string' || /[\s,;<>\r\n]/.test(p.recipient) || !/^[^@]+@[^@]+\.[^@]+$/.test(p.recipient)) throw privacyError('WEEKLY_POLICY_INVALID');
  if (p.format !== undefined && !['PDF', 'HTML'].includes(p.format)) throw privacyError('WEEKLY_FORMAT_INVALID');
  if (weeklyFormat(p) === 'HTML' && (!/^[a-f0-9]{64}$/.test(String(p.contentHash)) || p.layoutVersion !== 'weekly-html-v1')) throw privacyError('WEEKLY_HTML_POLICY_INVALID');
  const key = String(message.deliveryKey || message.idempotencyKey || message.idempotency_key || '');
  if (key !== `weekly-timesheet:${p.staffId}:${p.fromDate}:${p.toDate}:v${p.revision}`) throw privacyError('WEEKLY_POLICY_IDENTITY_MISMATCH');
  if (!Array.isArray(addresses.to) || addresses.to.length !== 1 || addresses.to[0] !== p.recipient || addresses.cc?.length || addresses.bcc?.length) throw privacyError('WEEKLY_RECIPIENT_PRIVACY_VIOLATION');
  return Object.freeze({ ...p });
}
function weeklyFormat(policy) { return policy?.format ?? 'PDF'; }
function assertWeeklyDeliveryContent(message, policy) {
  if (!policy) return null;
  const attachments = message.attachments || [];
  if (!Array.isArray(attachments)) throw privacyError('WEEKLY_ATTACHMENT_COUNT_INVALID');
  if (weeklyFormat(policy) !== 'HTML') {
    if (attachments.length !== 1) throw privacyError('WEEKLY_ATTACHMENT_COUNT_INVALID');
    return null;
  }
  if (attachments.length !== 0) throw privacyError('WEEKLY_HTML_ATTACHMENT_UNEXPECTED');
  if (typeof message.subject !== 'string' || message.subject !== message.subject.trim() || /[\r\n]/.test(message.subject)) throw privacyError('WEEKLY_HTML_CONTENT_INVALID');
  try {
    return require('./weeklyTimesheetEmailService').assertWeeklyTimesheetEmailContent({
      subject: message.subject,
      html: message.html ?? message.html_body,
      text: message.text ?? message.text_body,
      layoutVersion: policy.layoutVersion
    }, policy.contentHash);
  } catch (error) {
    throw privacyError(['WEEKLY_HTML_CONTENT_HASH_MISMATCH','WEEKLY_HTML_CONTENT_MISMATCH'].includes(error.code) ? 'WEEKLY_HTML_CONTENT_HASH_MISMATCH' : 'WEEKLY_HTML_CONTENT_INVALID');
  }
}
module.exports = { assertWeeklyDeliveryPolicy, assertWeeklyDeliveryContent, weeklyFormat, weeklyMessage, privacyError };
