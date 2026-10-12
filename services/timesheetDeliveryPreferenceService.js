'use strict';

function preferenceValidation() {
  const message = 'Enter one valid timesheet delivery email address, or leave it blank to disable delivery.';
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    fields: { timesheet_delivery_email: message }
  });
}

// Deliberately accepts one plain mailbox only. Lists, display names and header
// characters cannot expand a staff member's private delivery to other people.
function normalizeTimesheetDeliveryEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw preferenceValidation();
  const email = value.trim();
  if (!email) return null;
  if (email.length > 254 || /[\r\n\x00-\x20\x7f,;<>]/.test(email)) throw preferenceValidation();
  const parts = email.split('@');
  if (parts.length !== 2) throw preferenceValidation();
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
      || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) throw preferenceValidation();
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !label || label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))
      || !/^[A-Za-z]{2,63}$/.test(labels.at(-1))) throw preferenceValidation();
  return `${local}@${domain.toLowerCase()}`;
}

module.exports = { normalizeTimesheetDeliveryEmail };
