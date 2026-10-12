'use strict';

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isSecurityEventCapacityError(error) {
  const code = String(error?.code || '').toUpperCase();
  const errno = Number(error?.errno || 0);
  const message = String(error?.message || '').toLowerCase();
  return code === 'ER_RECORD_FILE_FULL'
    || code === 'ER_DISK_FULL'
    || errno === 1114
    || (message.includes('security_events') && message.includes('is full'))
    || message.includes('table is full');
}

async function pruneSecurityEvents() {
  // The restoration release places all historical security telemetry on hold.
  // Capacity failures require provider recovery; no audit/event record is erased.
  return { deleted: 0, held: true, reason: 'HISTORY_PRESERVATION' };
}

module.exports = {
  isSecurityEventCapacityError,
  pruneSecurityEvents,
  _test: { boundedInteger }
};
