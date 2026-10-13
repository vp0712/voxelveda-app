'use strict';
const { DateTime } = require('luxon');
const { configuration } = require('./weeklyTimesheetEligibility');

function inputError(field, message, code = 'ATTENDANCE_TIME_INVALID') {
  return Object.assign(new Error(message), { statusCode: 422, code, fields: { [field]: message } });
}
function companyTimezone(env = process.env) { return configuration(env).timezone; }
function sqlUtc(instant) { return instant.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'); }
function parseAttendanceTime(value, field, timezone) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const explicit = /(?:Z|[+-]\d{2}:\d{2})$/.test(text);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) throw inputError(field, 'Enter a valid date and time.');
  const parsed = DateTime.fromISO(text.replace(' ', 'T'), { zone: timezone, setZone: explicit });
  if (!parsed.isValid) throw inputError(field, 'Enter a valid date and time.');
  if (!explicit) {
    const normalized = text.replace(' ', 'T').padEnd(19, ':00');
    if (parsed.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== normalized) throw inputError(field, 'This local time does not exist because of daylight saving. Choose a valid time.');
    if (parsed.getPossibleOffsets().length !== 1) throw inputError(field, 'This local time is ambiguous because of daylight saving. Include its UTC offset, such as +10:00 or +11:00.');
  }
  return parsed.toUTC();
}
function manualWorkedEntry(body, actorId, now = new Date(), env = process.env) {
  const timezone = companyTimezone(env);
  const start = parseAttendanceTime(body.clock_in, 'clock_in', timezone);
  const end = parseAttendanceTime(body.clock_out, 'clock_out', timezone);
  if (!start) throw inputError('clock_in', 'Enter the actual shift start.');
  if (start.toMillis() > now.getTime() || (end && end.toMillis() > now.getTime())) throw inputError(end ? 'clock_out' : 'clock_in', 'Worked attendance cannot be in the future.');
  if (end && end.toMillis() <= start.toMillis()) throw inputError('clock_out', 'Clock-out must be after clock-in.');
  const rawBreak = body.break_minutes;
  const breakMinutes = rawBreak === undefined || rawBreak === null || rawBreak === '' ? null : Number(rawBreak);
  if (breakMinutes !== null && (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0)) throw inputError('break_minutes', 'Break minutes must be a non-negative whole number.');
  const elapsed = end ? Math.floor((end.toMillis() - start.toMillis()) / 60000) : 0;
  if (end && breakMinutes !== null && breakMinutes >= elapsed) throw inputError('break_minutes', 'The break must be shorter than the shift.');
  const minutes = end ? elapsed - (breakMinutes ?? 0) : 0;
  return { clock_in: sqlUtc(start), clock_out: end ? sqlUtc(end) : null,
    work_date: start.setZone(timezone).toISODate(), total_minutes: minutes,
    total_hours: Math.round(minutes / 60 * 100) / 100, break_minutes: breakMinutes,
    entry_source: 'MANUAL', timestamp_basis: 'UTC', clock_out_timestamp_basis: end ? 'UTC' : null, recorded_timezone: timezone,
    manual_authorised_by: Number(actorId), manual_authorised_at: sqlUtc(DateTime.fromJSDate(now)),
    attendance_status: end ? 'WORKED' : 'INCOMPLETE', review_required: end ? 0 : 1,
    review_reason: end ? null : 'INCOMPLETE_SHIFT' };
}
module.exports = { companyTimezone, parseAttendanceTime, manualWorkedEntry, sqlUtc, inputError };
