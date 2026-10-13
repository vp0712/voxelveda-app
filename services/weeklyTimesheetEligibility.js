'use strict';
const crypto = require('node:crypto');
const { DateTime, IANAZone } = require('luxon');

function policyError(message, code = 'WEEKLY_TIMESHEET_POLICY_INVALID') { return Object.assign(new Error(message), { code, statusCode: 422 }); }
function integerSetting(value, fallback, min, max, key) {
  const raw = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(raw) || raw < min || raw > max) throw policyError(`${key} must be an integer between ${min} and ${max}.`);
  return raw;
}
function configuration(env = process.env) {
  const timezone = env.TIMESHEET_TIMEZONE || env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE || 'Australia/Sydney';
  if (!timezone.startsWith('Australia/') || !IANAZone.isValidZone(timezone)) throw policyError('The company timesheet timezone must be a valid Australian IANA timezone.');
  if (env.TIMESHEET_TIMEZONE && env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE && env.TIMESHEET_TIMEZONE !== env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE) throw policyError('Weekly delivery must use the configured company timesheet timezone.');
  const hour = integerSetting(env.WEEKLY_TIMESHEET_EMAIL_HOUR, 7, 0, 23, 'Weekly send hour');
  const minute = integerSetting(env.WEEKLY_TIMESHEET_EMAIL_MINUTE, 0, 0, 59, 'Weekly send minute');
  const weekday = integerSetting(env.WEEKLY_TIMESHEET_EMAIL_WEEKDAY, 1, 1, 7, 'Weekly send weekday');
  const windowMinutes = integerSetting(env.WEEKLY_TIMESHEET_EMAIL_WINDOW_MINUTES, 120, 1, 180, 'Weekly send window');
  if (hour * 60 + minute + windowMinutes > 1440) throw policyError('The weekly send window must end on the configured send day.');
  const flag = String(env.WEEKLY_TIMESHEET_EMAIL_ENABLED ?? 'true').toLowerCase();
  if (!['true', 'false'].includes(flag)) throw policyError('Weekly timesheet scheduling must be enabled with true or false.');
  // This is an explicit storage attestation, separate from the display timezone.
  // Historical unzoned DATETIME values must never be guessed from host settings.
  const storageTimezone = env.ATTENDANCE_STORAGE_TIMEZONE || '';
  if (storageTimezone && storageTimezone !== 'UTC') throw policyError('Only proven historical UTC storage may be attested. Leave this setting unset for explicit-row UTC delivery and legacy review.', 'ATTENDANCE_TIMEZONE_UNVERIFIED');
  return { timezone, storageTimezone, weekday, hour, minute, windowMinutes, enabled: flag === 'true' };
}
function latestCompletedWeek(now = new Date(), timezone = 'Australia/Sydney') {
  if (!IANAZone.isValidZone(timezone)) throw policyError('The company timesheet timezone is invalid.');
  const instant = now instanceof Date ? DateTime.fromJSDate(now, { zone: timezone }) : DateTime.fromISO(String(now), { zone: timezone });
  if (!instant.isValid) throw policyError('The scheduler time is invalid.');
  const thisMonday = instant.startOf('week'), previousMonday = thisMonday.minus({ weeks: 1 });
  return { start: previousMonday.toISODate(), end: thisMonday.minus({ days: 1 }).toISODate(),
    startUtc: previousMonday.toUTC().toISO(), endExclusiveUtc: thisMonday.toUTC().toISO(),
    timezone, localWeekday: instant.weekday, localHour: instant.hour, localMinute: instant.minute };
}
function scheduleWindow(now, config) {
  const instant = DateTime.fromJSDate(now, { zone: config.timezone });
  if (!instant.isValid) throw policyError('The scheduler time is invalid.');
  const period = latestCompletedWeek(now, config.timezone);
  const elapsed = instant.hour * 60 + instant.minute - config.hour * 60 - config.minute;
  const eligible = config.enabled && instant.weekday === config.weekday && elapsed >= 0 && elapsed < config.windowMinutes;
  return { eligible, period, reason: !config.enabled ? 'disabled' : instant.weekday !== config.weekday ? 'outside_send_day' : elapsed < 0 ? 'before_send_window' : elapsed >= config.windowMinutes ? 'send_window_closed' : 'scheduled_window' };
}
function scheduleDetails(now = new Date(), env = process.env) {
  const config = configuration(env), window = scheduleWindow(now, config);
  const local = DateTime.fromJSDate(now, { zone: config.timezone });
  let due = local.startOf('week').plus({ days: config.weekday - 1 }).set({ hour: config.hour, minute: config.minute });
  if (!window.eligible && due.toMillis() <= local.toMillis()) due = due.plus({ weeks: 1 });
  return { enabled: config.enabled, timezone: config.timezone, timezone_source: env.TIMESHEET_TIMEZONE ? 'TIMESHEET_TIMEZONE' : env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE ? 'WEEKLY_TIMESHEET_EMAIL_TIMEZONE' : 'default',
    storage_timezone_verified: config.storageTimezone === 'UTC', timestamp_policy: config.storageTimezone === 'UTC' ? 'VERIFIED_LEGACY_AND_EXPLICIT_UTC' : 'EXPLICIT_ROW_UTC_ONLY', weekday: config.weekday, hour: config.hour, minute: config.minute,
    window_minutes: config.windowMinutes, next_due_utc: due.toUTC().toISO(), next_due_local: due.toISO(),
    window_end_utc: due.plus({ minutes: config.windowMinutes }).toUTC().toISO(), current_period: window.period, waiting_reason: window.reason };
}
function emailAddress(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text.length > 254 || /[\r\n,;<>]/.test(text) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return '';
  return text;
}
const NON_EMPLOYEES = new Set(['customer', 'client', 'supplier', 'viewer', 'view_only', 'guest', 'external']);
const EMPLOYEE_ROLES = new Set(['staff', 'production', 'manager', 'supervisor', 'sales', 'hr', 'admin', 'super_admin']);
function isEmployee(staff) {
  const role = String(staff.role || '').toLowerCase();
  if (NON_EMPLOYEES.has(role)) return false;
  return EMPLOYEE_ROLES.has(role) || Boolean(String(staff.employee_number || '').trim());
}
function activeEmployee(staff) {
  return Boolean(staff) && Number(staff.active) === 1 && !staff.deleted_at &&
    (!staff.account_status || String(staff.account_status).toUpperCase() === 'ACTIVE') && isEmployee(staff);
}
function calendarDate(value) {
  const date = DateTime.fromISO(String(value || ''), { zone: 'UTC' });
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && date.isValid ? date.toISODate() : null;
}
function utcInstant(value, storageTimezone) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : DateTime.fromJSDate(value, { zone: 'UTC' });
  if (!value) return null;
  const text = String(value).trim();
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const parsed = DateTime.fromISO(text, { setZone: true }); return parsed.isValid ? parsed.toUTC() : null;
  }
  if (storageTimezone !== 'UTC') throw policyError('Attendance timestamp storage has not been verified as UTC.', 'ATTENDANCE_TIMEZONE_UNVERIFIED');
  const parsed = DateTime.fromSQL(text.replace('T', ' '), { zone: 'UTC' });
  return parsed.isValid ? parsed : null;
}
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function snapshotHash(snapshot) { return crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex'); }
function assessWorkedAttendance(staff, records, period, config, now = new Date()) {
  if (!activeEmployee(staff)) return { status: 'INELIGIBLE_ACCOUNT', rows: [], totalMinutes: 0, issues: [], duplicates: 0 };
  const rows = [], issues = [], intervals = [], fingerprints = new Map(); let duplicates = 0;
  const excludedStatuses = new Set(['PLANNED', 'SCHEDULED', 'CANCELLED', 'CANCELED', 'REJECTED', 'DELETED', 'VOID', 'VOIDED']);
  for (const row of [...records].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (Number(row.user_id) !== Number(staff.id)) { issues.push({ code: 'STAFF_ID_MISMATCH', attendance_id: row.id }); continue; }
    if (Number(row.deleted) || row.deleted_at || excludedStatuses.has(String(row.attendance_status || row.status || '').toUpperCase())) continue;
    const timestampVerified = row.timestamp_basis === 'UTC' || config.storageTimezone === 'UTC';
    if (!timestampVerified) {
      const savedDate = calendarDate(row.work_date);
      // Preserve legacy unzoned records. A stored date is sufficient to flag a
      // candidate for review, but is never sufficient to invent UTC hours.
      if (!savedDate || (savedDate >= period.start && savedDate <= period.end)) issues.push({ code: 'ATTENDANCE_TIMEZONE_UNVERIFIED', attendance_id: row.id });
      continue;
    }
    const manual = String(row.entry_source || '').toUpperCase() === 'MANUAL';
    const rawStart = row.clock_in_utc_text ?? row.clock_in, rawEnd = row.clock_out_utc_text ?? row.clock_out;
    const start = utcInstant(rawStart, 'UTC'), end = utcInstant(rawEnd, 'UTC'), savedDate = calendarDate(row.work_date);
    if ((rawStart && !start) || (rawEnd && !end) || (!manual && !start)) {
      if (!savedDate || savedDate >= period.start && savedDate <= period.end) issues.push({ code: 'CLOCK_TIMESTAMP_INVALID', attendance_id: row.id });
      continue;
    }
    const workDate = start ? start.setZone(config.timezone).toISODate() : manual ? savedDate : null;
    if (!workDate || workDate < period.start || workDate > period.end) continue;
    const minutes = Number(row.total_minutes), hours = Number(row.total_hours);
    const issue = (code) => issues.push({ code, attendance_id: row.id });
    if (row.timestamp_basis === 'UTC' && (!String(row.recorded_timezone || '').startsWith('Australia/') || !IANAZone.isValidZone(String(row.recorded_timezone)))) { issue('RECORDED_TIMEZONE_INVALID'); continue; }
    if (row.timestamp_basis === 'UTC' && !['CLOCK', 'MANUAL'].includes(String(row.entry_source || '').toUpperCase())) { issue('ATTENDANCE_SOURCE_UNVERIFIED'); continue; }
    if (Number(row.review_required)) { issue(['INCOMPLETE_SHIFT', 'INCOMPLETE_SHIFT_REQUIRES_REVIEW', 'ATTENDANCE_TIMEZONE_UNVERIFIED'].includes(row.review_reason) ? row.review_reason : 'ATTENDANCE_REVIEW_REQUIRED'); continue; }
    const authorisedAt = manual ? utcInstant(row.manual_authorised_at_utc_text ?? row.manual_authorised_at, 'UTC') : null;
    if (manual && (!Number.isSafeInteger(Number(row.manual_authorised_by)) || Number(row.manual_authorised_by) <= 0 || !authorisedAt || authorisedAt.toMillis() > now.getTime())) { issue('MANUAL_AUTHORISATION_REQUIRED'); continue; }
    const legacyClosureEvidence = /(?:auto.?clos|automatic.*12|maximum.*12)/i.test(String(row.review_reason || row.notes || '')) ||
      (/(?:^|\s)A(?:\s|$)/.test(String(row.notes || '')) && minutes === 720);
    // An authorised UTC manual correction can establish actual work without
    // erasing historical notes. An unreviewed legacy A-marker cannot.
    if (legacyClosureEvidence && !(manual && row.timestamp_basis === 'UTC')) { issue('UNVERIFIED_AUTO_CLOSURE'); continue; }
    if (!start || !end) {
      if (!manual || start || end) { issue('INCOMPLETE_SHIFT'); continue; }
    }
    if (!Number.isSafeInteger(minutes) || minutes < 0 || !Number.isFinite(hours) || hours < 0 || Math.abs(Math.round(minutes / 60 * 100) / 100 - hours) > 0.00001) { issue('RECORDED_DURATION_INCONSISTENT'); continue; }
    if (minutes === 0 && hours === 0) continue;
    const breakMinutes = row.break_minutes === undefined || row.break_minutes === null ? null : Number(row.break_minutes);
    if (breakMinutes !== null && (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0)) { issue('RECORDED_BREAK_INVALID'); continue; }
    if (start && end) {
      if (end.toMillis() <= start.toMillis() || end.toMillis() > now.getTime()) { issue('CLOCK_INTERVAL_INVALID'); continue; }
      const elapsedMinutes = Math.floor((end.toMillis() - start.toMillis()) / 60000);
      // An absent break is displayed as unrecorded, never a fabricated break.
      // Without recorded break evidence, saved work minutes must equal elapsed.
      if (minutes !== elapsedMinutes - (breakMinutes ?? 0) || (breakMinutes !== null && breakMinutes >= elapsedMinutes)) { issue('WORK_AND_BREAK_INCONSISTENT'); continue; }
    }
    const fingerprint = [workDate, start?.toISO() || '', end?.toISO() || '', minutes, breakMinutes, manual ? 'MANUAL' : 'CLOCK',
      String(row.notes || ''), String(row.project_name || row.project || ''), manual ? row.manual_authorised_by : '', manual ? authorisedAt.toISO() : ''].join(':');
    if (fingerprints.has(fingerprint)) { duplicates += 1; continue; }
    if ((!start || !end) && rows.some((entry) => entry.work_date === workDate) || rows.some((entry) => entry.work_date === workDate && (!entry.clock_in || !entry.clock_out))) { issue('AMBIGUOUS_MANUAL_WORKED_ENTRIES'); continue; }
    if (start && end && intervals.some((entry) => start.toMillis() < entry.end && end.toMillis() > entry.start)) { issue('OVERLAPPING_WORKED_ENTRIES'); continue; }
    fingerprints.set(fingerprint, row.id);
    if (start && end) intervals.push({ start: start.toMillis(), end: end.toMillis() });
    rows.push({ id: Number(row.id), user_id: Number(staff.id), name: String(staff.name || ''), work_date: workDate,
      clock_in: start?.toISO() || null, clock_out: end?.toISO() || null, total_minutes: minutes,
      total_hours: minutes / 60, break_minutes: breakMinutes,
      timestamp_basis: 'UTC', recorded_timezone: String(row.recorded_timezone || config.timezone),
      entry_source: manual ? 'MANUAL' : 'CLOCK', manual_authorised_by: manual ? Number(row.manual_authorised_by) : null,
      manual_authorised_at: manual ? authorisedAt.toISO() : null,
      notes: String(row.notes || ''), project: String(row.project_name || row.project || '') });
  }
  const totalMinutes = rows.reduce((sum, row) => sum + row.total_minutes, 0);
  if (issues.length) return { status: 'REVIEW_REQUIRED', rows, totalMinutes, issues, duplicates };
  return { status: totalMinutes > 0 && rows.length ? 'ELIGIBLE' : 'NO_WORK', rows, totalMinutes, issues, duplicates };
}
function canonicalSnapshot(staff, assessment, period, version = 1, reviewStatus = 'DRAFT') {
  return { staff_id: Number(staff.id), staff_name: String(staff.name || ''), employee_reference: String(staff.employee_number || ''),
    period_start: period.start, period_end: period.end, timezone: period.timezone, version,
    review_status: reviewStatus, total_minutes: assessment.totalMinutes, rows: assessment.rows,
    shift_allocation: 'WHOLE_SHIFT_LOCAL_START_DATE' };
}
module.exports = { configuration, latestCompletedWeek, scheduleWindow, scheduleDetails, emailAddress, isEmployee, activeEmployee, assessWorkedAttendance, canonicalSnapshot, snapshotHash, stableJson, utcInstant, policyError };
