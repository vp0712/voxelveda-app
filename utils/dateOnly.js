'use strict';

// Shared calendar validation belongs to the original workflows, independent of Finance.
function dateOnly(value) {
  const raw = value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/ )?.[1] || '';
  if (!raw) return '';
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? '' : raw;
}

module.exports = { dateOnly };
