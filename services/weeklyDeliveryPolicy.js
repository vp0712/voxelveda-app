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
  const key = String(message.deliveryKey || message.idempotencyKey || message.idempotency_key || '');
  if (key !== `weekly-timesheet:${p.staffId}:${p.fromDate}:${p.toDate}:v${p.revision}`) throw privacyError('WEEKLY_POLICY_IDENTITY_MISMATCH');
  if (!Array.isArray(addresses.to) || addresses.to.length !== 1 || addresses.to[0] !== p.recipient || addresses.cc?.length || addresses.bcc?.length) throw privacyError('WEEKLY_RECIPIENT_PRIVACY_VIOLATION');
  return Object.freeze({ ...p });
}
module.exports = { assertWeeklyDeliveryPolicy, weeklyMessage, privacyError };
