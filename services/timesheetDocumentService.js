"use strict";
const { DateTime, IANAZone } = require('luxon');
const { dateLabel, pdfError } = require('./documentPdfService');
function timesheetDocumentData({ rows, fromDate, toDate, staffName, staffId, employeeReference, totalHours, totalMinutes, status, approvedBy, timezone = process.env.TIMESHEET_TIMEZONE || 'Australia/Sydney', version = 1, generatedAt }) {
  if (!Array.isArray(rows) || !IANAZone.isValidZone(timezone)) throw pdfError('Timesheet entries or company timezone are unavailable.', 'PDF_DATA_INVALID');
  const staffIds = new Set(rows.filter(row => row.user_id != null).map(row => Number(row.user_id)));
  if (staffIds.size > 1 || (staffId && [...staffIds].some(id => id !== Number(staffId))) || rows.some(row => row.name && staffName && String(row.name) !== String(staffName))) throw pdfError('An individual timesheet must contain only its designated staff member.', 'PDF_STAFF_SCOPE_MISMATCH');
  let recordedMinutes = 0;
  const days = new Map();
  const formatClock = value => {
    if (!value) return 'Not recorded';
    const parsed = value instanceof Date ? DateTime.fromJSDate(value, { zone: 'UTC' }) : DateTime.fromISO(String(value), { setZone: true });
    if (!parsed.isValid) throw pdfError('A recorded shift timestamp is invalid.', 'PDF_DATA_INVALID');
    return parsed.setZone(timezone).toFormat('dd MMM yyyy HH:mm ZZZZ');
  };
  const hours = minutes => `${(minutes / 60).toFixed(2)} (${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m)`;
  const shifts = rows.map(row => {
    const numericHours = Number(row.total_hours ?? 0);
    const minutes = row.total_minutes == null ? Math.round(numericHours * 60) : Number(row.total_minutes);
    if (!Number.isFinite(numericHours) || numericHours < 0 || !Number.isSafeInteger(minutes) || minutes < 0 || Math.abs(numericHours - minutes / 60) > 0.011) throw pdfError('A timesheet entry has invalid recorded hours. Review its saved attendance.', 'PDF_DATA_INVALID');
    const breakMinutes = row.break_minutes == null ? null : Number(row.break_minutes);
    if (breakMinutes != null && (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0)) throw pdfError('A recorded shift break is invalid.', 'PDF_DATA_INVALID');
    const workDate = String(row.work_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !DateTime.fromISO(workDate).isValid || workDate < fromDate || workDate > toDate) throw pdfError('A worked shift falls outside its reporting period.', 'PDF_PERIOD_MISMATCH');
    recordedMinutes += minutes; days.set(workDate, (days.get(workDate) || 0) + minutes);
    return [dateLabel(workDate), formatClock(row.clock_in), formatClock(row.clock_out), breakMinutes == null ? 'Not recorded' : `${breakMinutes} min`, hours(minutes), String(row.project || row.project_name || row.job_reference || row.site_reference || 'Not recorded')];
  });
  if ((totalMinutes !== undefined && (!Number.isSafeInteger(Number(totalMinutes)) || Number(totalMinutes) !== recordedMinutes)) || (totalHours !== undefined && (!Number.isFinite(Number(totalHours)) || Math.abs(Number(totalHours) - recordedMinutes / 60) > 0.011))) throw pdfError('Timesheet totals do not match saved attendance for this period.', 'PDF_TOTAL_MISMATCH');
  if (!Number.isSafeInteger(Number(version)) || Number(version) < 1) throw pdfError('The timesheet document version is invalid.', 'PDF_DATA_INVALID');
  const approved = String(status || '').toUpperCase() === 'APPROVED';
  const review = approved ? 'Approved' : `Provisional — ${String(status || 'DRAFT').replace(/_/g, ' ')}`;
  return { title: Number(version) > 1 ? 'TIMESHEET — REVISION' : 'TIMESHEET', reference: `${fromDate} to ${toDate} | Version ${version}`, filename: `timesheet-${employeeReference || staffName || 'staff'}-${fromDate}-${toDate}-v${version}`, issueDate: generatedAt ? DateTime.fromISO(String(generatedAt), { setZone: true }).setZone(timezone).toISODate() : toDate,
    period: `${dateLabel(fromDate)} to ${dateLabel(toDate)} | ${timezone}`, party: `${staffName || 'Staff'}${employeeReference ? ` | Staff reference: ${employeeReference}` : ''}`,
    tables: [{ title: 'Worked shifts', columns: [{ label: 'Shift date', width: 1 }, { label: 'Start', width: 1.5 }, { label: 'End', width: 1.5 }, { label: 'Break', width: .8 }, { label: 'Worked hours', width: 1 }, { label: 'Job / site', width: 1.3 }], rows: shifts },
      { title: 'Daily totals', columns: [{ label: 'Date', width: 3 }, { label: 'Recorded hours', width: 2, align: 'right' }], rows: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, minutes]) => [dateLabel(day), hours(minutes)]) }],
    totals: [{ label: 'Weekly recorded hours', value: hours(recordedMinutes) }],
    notes: [`Timesheet status: ${review}`, `Reporting interval: local Monday 00:00 through the following Monday 00:00 in ${timezone}; shifts are allocated to their local start date. An overnight shift is included once in full.`, 'Breaks marked “Not recorded” are not assumed or fabricated.', `Document version ${version}${Number(version) > 1 ? ' — authorised corrected report; replaces the earlier report for this staff member and period.' : ' — generated from this staff member’s saved worked-time records.'}`, approvedBy ? `Approved by: ${approvedBy}` : '', generatedAt ? `Generated ${formatClock(generatedAt)}` : ''].filter(Boolean) };
}
module.exports = { timesheetDocumentData };
