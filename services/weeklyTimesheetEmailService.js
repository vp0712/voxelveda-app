'use strict';

const crypto = require('node:crypto');
const { DateTime, IANAZone } = require('luxon');
const { companyProfile } = require('../config/companyProfile');
const { timesheetDocumentData } = require('./timesheetDocumentService');

const DELIVERY_FORMAT = 'HTML';
const LAYOUT_VERSION = 'weekly-html-v1';
const LOGO_URL = 'https://app.voxelveda.com/logo.png';
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;

function contentError(message, code = 'WEEKLY_HTML_CONTENT_INVALID') {
  return Object.assign(new Error(message), { code, statusCode: 422 });
}
function sourceText(value, label, limit, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\p{Surrogate}/u.test(value)) {
    throw contentError(`${label} is invalid. Review the saved timesheet source.`, 'WEEKLY_HTML_SOURCE_INVALID');
  }
  const clean = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (required && !clean) throw contentError(`${label} is missing. Review the saved timesheet source.`, 'WEEKLY_HTML_SOURCE_INVALID');
  return clean;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function contentHashFor(content) {
  if (!content || !['subject', 'html', 'text', 'layoutVersion'].every(key => typeof content[key] === 'string')) {
    throw contentError('The weekly email content snapshot is incomplete.');
  }
  return crypto.createHash('sha256').update(JSON.stringify({ subject: content.subject, html: content.html, text: content.text, layoutVersion: content.layoutVersion }), 'utf8').digest('hex');
}
function assertWeeklyTimesheetEmailContent(content, expected = {}) {
  const expectedHash = typeof expected === 'string' ? expected : expected?.expectedHash;
  if (!content || (content.format !== undefined && content.format !== DELIVERY_FORMAT) || content.layoutVersion !== LAYOUT_VERSION ||
      !['subject', 'html', 'text'].every(key => typeof content[key] === 'string' && content[key].trim()) ||
      /[\r\n\u0000]/.test(content.subject || '') || /\p{Surrogate}/u.test([content.subject, content.html, content.text].join('')) ||
      Buffer.byteLength(content.subject, 'utf8') > 998 || Buffer.byteLength(content.html, 'utf8') > MAX_HTML_BYTES || Buffer.byteLength(content.text, 'utf8') > MAX_TEXT_BYTES ||
      /<(?:script|iframe|object|embed|form|input|button|svg|link|base)\b|<[^>]+\son[a-z]+\s*=|\b(?:href|src)\s*=\s*["']\s*(?:javascript|data):/i.test(content.html)) {
    throw contentError('The weekly email content snapshot is invalid or too large. Review it before retrying.');
  }
  const contentHash = contentHashFor(content);
  for (const expectedValue of [expectedHash, content.contentHash]) if (expectedValue !== undefined &&
      (!/^[a-f0-9]{64}$/.test(String(expectedValue)) || expectedValue !== contentHash)) {
    throw contentError('The weekly email content no longer matches its immutable snapshot. No message was sent.', 'WEEKLY_HTML_CONTENT_MISMATCH');
  }
  return Object.freeze({ format: DELIVERY_FORMAT, layoutVersion: LAYOUT_VERSION, subject: content.subject, html: content.html, text: content.text, contentHash });
}
function instant(value, label) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw contentError(`${label} has no authoritative timezone.`, 'WEEKLY_HTML_SOURCE_INVALID');
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) throw contentError(`${label} is invalid.`, 'WEEKLY_HTML_SOURCE_INVALID');
  return parsed;
}
function validateSource(snapshot) {
  // Recorded work follows the validated source and whole-shift allocation, not
  // the approval-hours ceiling: a fall-back calendar week alone spans 169 hours.
  if (!snapshot || !Number.isSafeInteger(snapshot.staff_id) || snapshot.staff_id < 1 ||
      !Number.isSafeInteger(snapshot.version) || snapshot.version < 1 || snapshot.version > 2147483647 ||
      !Number.isSafeInteger(snapshot.total_minutes) || snapshot.total_minutes <= 0 ||
      !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > 2000 ||
      typeof snapshot.timezone !== 'string' || !snapshot.timezone.startsWith('Australia/') || !IANAZone.isValidZone(snapshot.timezone)) {
    throw contentError('An individual weekly email requires verified worked time, identity and reporting configuration.', 'WEEKLY_HTML_SOURCE_INVALID');
  }
  const staffName = sourceText(snapshot.staff_name, 'Employee name', 500, true);
  sourceText(snapshot.employee_reference, 'Staff reference', 200);
  const start = DateTime.fromISO(String(snapshot.period_start), { zone: snapshot.timezone });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.period_start) || !start.isValid || start.weekday !== 1 || start.plus({ days: 6 }).toISODate() !== snapshot.period_end) {
    throw contentError('The weekly reporting interval must be the saved Monday–Sunday week.', 'WEEKLY_HTML_PERIOD_INVALID');
  }
  const issued = instant(snapshot.generated_at, 'Report issue time');
  if (issued < start.plus({ days: 7 })) throw contentError('A weekly report cannot be issued before its reporting week is completed.', 'WEEKLY_HTML_PERIOD_INVALID');
  const status = sourceText(snapshot.review_status, 'Review status', 40, true).toUpperCase();
  const approvedHours = snapshot.approved_hours ?? snapshot.total_minutes / 60;
  if (!/^[A-Z_ ]+$/.test(status) || (status === 'APPROVED' && snapshot.approval_verified !== true) ||
      (snapshot.approved_hours !== undefined && (status !== 'APPROVED' || snapshot.approval_verified !== true)) ||
      (status === 'APPROVED' && (!Number.isFinite(Number(approvedHours)) || Number(approvedHours) < 0 || Number(approvedHours) > 168))) {
    throw contentError('Approval status requires verified saved review evidence.', 'WEEKLY_HTML_APPROVAL_INVALID');
  }
  const ids = new Set(), intervals = [];
  for (const row of snapshot.rows) {
    if (!row || Number(row.user_id) !== snapshot.staff_id || (row.name && row.name !== snapshot.staff_name) ||
        !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || Number(row.review_required) === 1 ||
        /^(?:CANCELLED|REJECTED|DUPLICATE|DELETED|PLANNED|SCHEDULED)$/i.test(String(row.attendance_status || '')) ||
        !Number.isSafeInteger(row.total_minutes) || row.total_minutes <= 0) {
      throw contentError('This report contains another employee, duplicate or unverified attendance.', 'WEEKLY_HTML_STAFF_SCOPE_MISMATCH');
    }
    ids.add(row.id);
    for (const field of ['project', 'project_name', 'job_reference', 'site_reference']) sourceText(row[field], 'Job/site reference', 4000);
    const manual = row.entry_source === 'MANUAL';
    if ((!row.clock_in || !row.clock_out) && !(manual && !row.clock_in && !row.clock_out)) {
      throw contentError('An incomplete shift requires review before weekly delivery.', 'WEEKLY_HTML_ATTENDANCE_REVIEW_REQUIRED');
    }
    if ((!row.clock_in || !row.clock_out) && snapshot.rows.some(other => other !== row && other.work_date === row.work_date)) {
      throw contentError('Untimed manual entries sharing a shift date require review.', 'WEEKLY_HTML_ATTENDANCE_REVIEW_REQUIRED');
    }
    if (manual && (!Number.isSafeInteger(row.manual_authorised_by) || row.manual_authorised_by < 1 ||
        instant(row.manual_authorised_at, 'Manual entry authorisation') > issued)) {
      throw contentError('Manual worked time requires saved authorisation.', 'WEEKLY_HTML_ATTENDANCE_REVIEW_REQUIRED');
    }
    if (row.clock_in && row.clock_out) {
      const clockIn = instant(row.clock_in, 'Shift start'), clockOut = instant(row.clock_out, 'Shift end');
      if (clockOut <= clockIn || clockOut > issued || clockIn.setZone(snapshot.timezone).toISODate() !== row.work_date ||
          Math.floor(clockOut.diff(clockIn, 'minutes').minutes) - (row.break_minutes ?? 0) !== row.total_minutes ||
          intervals.some(entry => clockIn.toMillis() < entry.end && clockOut.toMillis() > entry.start)) {
        throw contentError('Shift intervals, allocation or recorded minutes need review.', 'WEEKLY_HTML_ATTENDANCE_REVIEW_REQUIRED');
      }
      intervals.push({ start: clockIn.toMillis(), end: clockOut.toMillis() });
    }
  }
  return { staffName, issued, status };
}
function statusLabel(status) {
  return ({ DRAFT: 'Provisional — Draft', OPEN: 'Submitted — Pending approval', SUBMITTED: 'Submitted — Pending approval',
    PENDING_APPROVAL: 'Submitted — Pending approval', CORRECTION_RESUBMITTED: 'Correction resubmitted — Pending approval',
    CORRECTION_REQUIRED: 'Review required — Correction requested', REVIEW_REQUIRED: 'Review required',
    REJECTED: 'Rejected — Correction required', APPROVED: 'Approved' })[status] || `Provisional — ${status.replace(/_/g, ' ')}`;
}
function emailTable(table, { shifts = false } = {}) {
  const header = table.columns.map(column => `<th scope="col" style="padding:12px 10px;text-align:left;font-size:12px;line-height:1.4;color:#ffffff;overflow-wrap:anywhere;">${escapeHtml(column.label)}</th>`).join('');
  const rows = table.rows.map((row, index) => `<tr${shifts ? ' class="shift-row"' : ''} style="background:${index % 2 ? '#ffffff' : '#f2f5fb'};">${row.map((value, column) =>
    `<td${shifts ? ' class="shift-cell"' : ''} style="padding:12px 10px;vertical-align:top;border-bottom:1px solid #e4eaf3;font-size:13px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word;${!shifts && column === row.length - 1 ? 'text-align:right;' : ''}">${shifts ? `<span class="mobile-label" style="display:none;font-weight:700;color:#173451;">${escapeHtml(table.columns[column].label)}: </span>` : ''}${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  return `<h2 style="margin:26px 0 12px;font-size:18px;line-height:1.4;color:#132d4c;">${escapeHtml(table.title)}</h2><table role="table"${shifts ? ' class="shift-table"' : ''} style="border-collapse:collapse;table-layout:fixed;width:100%;border:1px solid #e4eaf3;"><thead${shifts ? ' class="shift-head"' : ''} style="background:#132d4c;"><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}
function renderWeeklyTimesheetEmail(snapshot) {
  const { staffName, issued, status } = validateSource(snapshot);
  const approved = status === 'APPROVED';
  const data = timesheetDocumentData({ rows: snapshot.rows, fromDate: snapshot.period_start, toDate: snapshot.period_end, staffId: snapshot.staff_id,
    staffName: snapshot.staff_name, employeeReference: snapshot.employee_reference, totalMinutes: snapshot.total_minutes, totalHours: snapshot.total_minutes / 60,
    status, timezone: snapshot.timezone, version: snapshot.version, generatedAt: snapshot.generated_at, approvedHours: snapshot.approved_hours });
  const company = companyProfile();
  const companyName = sourceText(company.legalName || company.name, 'Company name', 500, true);
  const details = [companyName, company.address, company.phone, company.email, company.abn ? `ABN ${company.abn}` : ''].filter(Boolean).map(value => sourceText(value, 'Company details', 1500));
  const title = snapshot.version > 1 ? 'TIMESHEET — REVISION' : 'TIMESHEET';
  const period = `${DateTime.fromISO(snapshot.period_start).toFormat('d LLL yyyy')} to ${DateTime.fromISO(snapshot.period_end).toFormat('d LLL yyyy')}`;
  const issueDate = issued.setZone(snapshot.timezone).toFormat('d LLL yyyy');
  const reference = sourceText(snapshot.employee_reference, 'Staff reference', 200);
  const review = statusLabel(status);
  const recorded = data.totals[0].value;
  const approvedValue = approved ? Number(snapshot.approved_hours ?? snapshot.total_minutes / 60).toFixed(2) : null;
  const approvedMinutes = approved ? Math.round(Number(approvedValue) * 60) : null;
  const approvedDisplay = approved ? `${approvedValue} (${Math.floor(approvedMinutes / 60)}h ${String(approvedMinutes % 60).padStart(2, '0')}m)` : null;
  const notes = [
    `Reporting interval: local Monday 00:00 through the following Monday 00:00 in ${snapshot.timezone}. Shifts are allocated to their local start date; an overnight shift is included once in full.`,
    'Breaks marked “Not recorded” are not assumed or fabricated. A recorded zero break is shown as 0 min.',
    snapshot.version > 1 ? `Report version ${snapshot.version} is an authorised corrected report and replaces the earlier report for this employee and period.` : `Report version ${snapshot.version} uses this employee’s saved worked-time records.`,
    'This email contains the complete timesheet. PDF preview and download remain available in the application.'
  ];
  const subject = `Voxel Veda weekly timesheet${snapshot.version > 1 ? ` | Correction v${snapshot.version}` : ''} | ${snapshot.period_start} to ${snapshot.period_end}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>@media screen and (max-width:600px){.email-pad{padding:20px 16px!important}.email-header-cell{display:block!important;width:auto!important;text-align:left!important}.email-heading{margin-top:18px!important}.shift-table,.shift-table tbody,.shift-row,.shift-cell{display:block!important;width:auto!important}.shift-head{display:none!important}.shift-row{padding:10px 12px!important;border-bottom:1px solid #d6dfed!important}.shift-cell{padding:4px 0!important;border:0!important}.mobile-label{display:inline!important}.email-title{font-size:23px!important}}</style></head><body style="margin:0;padding:0;background:#f3f6fa;color:#203650;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(`${staffName} · ${period} · Recorded ${recorded} · ${review}`)}</div><table role="presentation" style="width:100%;border-collapse:collapse;background:#f3f6fa;"><tr><td style="padding:20px 8px;"><table role="presentation" style="width:100%;max-width:720px;margin:0 auto;border-collapse:collapse;background:#ffffff;border-top:7px solid #2857df;"><tr><td class="email-pad" style="padding:28px 26px;"><table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td class="email-header-cell" style="width:38%;vertical-align:top;"><img src="${LOGO_URL}" alt="Voxel Veda" width="86" height="86" style="display:block;width:86px;height:86px;border:0;"></td><td class="email-header-cell email-heading" style="vertical-align:top;text-align:right;"><h1 class="email-title" style="margin:0 0 12px;font-size:27px;line-height:1.25;letter-spacing:.4px;color:#132d4c;">${escapeHtml(title)}</h1><p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#586c86;">${escapeHtml(period)} | Version ${snapshot.version}</p><p style="margin:0;font-size:13px;line-height:1.6;color:#586c86;">Issued ${escapeHtml(issueDate)}</p></td></tr></table><p style="margin:22px 0 18px;padding-top:16px;border-top:1px solid #ccd7e8;font-size:12px;line-height:1.7;color:#586c86;overflow-wrap:anywhere;">${details.map(escapeHtml).join(' | ')}</p><p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:700;overflow-wrap:anywhere;">${escapeHtml(staffName)}${reference ? ` | Staff reference: ${escapeHtml(reference)}` : ''}</p><p style="margin:0;font-size:14px;line-height:1.7;">Period: ${escapeHtml(period)} | ${escapeHtml(snapshot.timezone)}</p>${emailTable(data.tables[0], { shifts: true })}${emailTable(data.tables[1])}<p style="margin:24px 0 10px;font-size:17px;line-height:1.6;font-weight:700;color:#132d4c;">Weekly recorded hours: ${escapeHtml(recorded)}</p>${approved ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;font-weight:700;color:#132d4c;">Approved hours${snapshot.approved_hours !== undefined && Math.abs(Number(snapshot.approved_hours) - snapshot.total_minutes / 60) > .011 ? ' (authorised adjustment)' : ''}: ${escapeHtml(approvedDisplay)}</p>` : ''}<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#344e70;"><strong>Timesheet status:</strong> ${escapeHtml(review)}</p>${notes.map(note => `<p style="margin:0 0 12px;font-size:12px;line-height:1.8;color:#586c86;overflow-wrap:anywhere;">${escapeHtml(note)}</p>`).join('')}<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e4eaf3;font-size:12px;line-height:1.7;color:#586c86;">${escapeHtml(companyName)}</p></td></tr></table></td></tr></table></body></html>`;
  const plainRows = data.tables.map(table => `${table.title.toUpperCase()}\n${table.rows.map(row => table.columns.map((column, index) => `${column.label}: ${row[index]}`).join('\n')).join('\n\n')}`).join('\n\n');
  const heading = [title, ...details, '', staffName, reference ? `Staff reference: ${reference}` : '', `Period: ${period}`, `Timezone: ${snapshot.timezone}`, `Report version: ${snapshot.version}`, `Issued: ${issueDate}`].filter(Boolean).join('\n');
  const summary = [`Weekly recorded hours: ${recorded}`, approved ? `Approved hours: ${approvedDisplay}` : '', `Timesheet status: ${review}`].filter(Boolean).join('\n');
  const text = [heading, plainRows, summary, ...notes].join('\n\n');
  return assertWeeklyTimesheetEmailContent({ format: DELIVERY_FORMAT, layoutVersion: LAYOUT_VERSION, subject, html, text });
}

module.exports = { DELIVERY_FORMAT, LAYOUT_VERSION, LOGO_URL, MAX_HTML_BYTES, MAX_TEXT_BYTES, contentHashFor, assertWeeklyTimesheetEmailContent, renderWeeklyTimesheetEmail };
