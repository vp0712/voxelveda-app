const pool = require('../config/db');
const { queueEmail } = require('./emailQueue');
const { brandedLayout } = require('./emailTemplates');
const { ensureWorkforceSchema } = require('./workforceSchema');
const { ensureUserLifecycleSchema } = require('./userLifecycleService');

let schedulerTimer;
let schedulerBusy = false;
let lastCompletedRunKey = '';

function enabled() {
  return String(process.env.WEEKLY_TIMESHEET_EMAIL_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function datePartsInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour)
  };
}

function latestCompletedWeek(date = new Date(), timezone = 'Australia/Sydney') {
  const parts = datePartsInTimezone(date, timezone);
  const localDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (localDay.getUTCDay() + 6) % 7;
  const currentMonday = new Date(localDay);
  currentMonday.setUTCDate(localDay.getUTCDate() - daysSinceMonday);
  const periodStart = new Date(currentMonday);
  periodStart.setUTCDate(currentMonday.getUTCDate() - 7);
  const periodEnd = new Date(currentMonday);
  periodEnd.setUTCDate(currentMonday.getUTCDate() - 1);
  return { start: isoDate(periodStart), end: isoDate(periodEnd), localHour: parts.hour };
}

function formatClock(value, timezone) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16) || '-';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function dateOnly(value, timezone = 'Australia/Sydney') {
  const text = String(value || '');
  const sqlDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (sqlDate) return sqlDate;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return text || '-';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatDisplayDate(value, timezone = 'Australia/Sydney') {
  const dateText = dateOnly(value, timezone);
  const date = new Date(`${dateText}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateText;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function buildWeeklyEmail(staff, timesheet, rows, timezone) {
  const weekStart = dateOnly(timesheet.week_start, timezone);
  const weekEnd = dateOnly(timesheet.week_end, timezone);
  const detailRows = rows.map((row) => `
    <tr>
      <td style="padding:9px 8px;border-bottom:1px solid #dbe5ec">${escapeHtml(formatDisplayDate(row.work_date, timezone))}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #dbe5ec">${escapeHtml(formatClock(row.clock_in, timezone))}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #dbe5ec">${escapeHtml(formatClock(row.clock_out, timezone))}</td>
      <td style="padding:9px 8px;border-bottom:1px solid #dbe5ec;text-align:right">${Number(row.total_hours || 0).toFixed(2)}</td>
    </tr>`).join('');

  const status = String(timesheet.status || 'DRAFT').replace(/_/g, ' ').toLowerCase();
  const content = `
    <h2 style="margin:0 0 8px">Your weekly timesheet</h2>
    <p style="margin:0 0 22px;color:#516272">Hello ${escapeHtml(staff.name || 'Team member')}, here is your recorded time for the completed week.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:22px;background:#f5f8fa;border:1px solid #dbe5ec">
      <tr><td style="padding:14px"><strong>Period</strong><br>${escapeHtml(formatDisplayDate(weekStart, timezone))} to ${escapeHtml(formatDisplayDate(weekEnd, timezone))}</td><td style="padding:14px"><strong>Total</strong><br>${Number(timesheet.total_hours || 0).toFixed(2)} hours</td></tr>
      <tr><td style="padding:14px"><strong>Ordinary</strong><br>${Number(timesheet.ordinary_hours || 0).toFixed(2)} hours</td><td style="padding:14px"><strong>Overtime</strong><br>${Number(timesheet.overtime_hours || 0).toFixed(2)} hours</td></tr>
    </table>
    <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbe5ec;border-collapse:collapse">
      <thead><tr style="background:#10283a;color:#fff"><th style="padding:10px 8px;text-align:left">Date</th><th style="padding:10px 8px;text-align:left">Clock in</th><th style="padding:10px 8px;text-align:left">Clock out</th><th style="padding:10px 8px;text-align:right">Hours</th></tr></thead>
      <tbody>${detailRows || '<tr><td colspan="4" style="padding:14px">No completed shifts were recorded.</td></tr>'}</tbody>
    </table>
    <p style="margin:22px 0 0;color:#516272">Current status: <strong style="text-transform:capitalize">${escapeHtml(status)}</strong>. Review the Timesheet section in Voxel Veda and contact admin if a correction is required.</p>`;

  const textRows = rows.map((row) => `${formatDisplayDate(row.work_date, timezone)} | ${formatClock(row.clock_in, timezone)} - ${formatClock(row.clock_out, timezone)} | ${Number(row.total_hours || 0).toFixed(2)} hours`).join('\n');
  return {
    subject: `Voxel Veda timesheet | ${weekStart} to ${weekEnd}`,
    html: brandedLayout(content, `Your timesheet for ${weekStart} to ${weekEnd}`),
    text: `Hello ${staff.name || 'Team member'},\n\nYour weekly timesheet for ${weekStart} to ${weekEnd}:\n\n${textRows}\n\nTotal: ${Number(timesheet.total_hours || 0).toFixed(2)} hours\nOrdinary: ${Number(timesheet.ordinary_hours || 0).toFixed(2)} hours\nOvertime: ${Number(timesheet.overtime_hours || 0).toFixed(2)} hours\nStatus: ${status}.`
  };
}

async function closeExpiredPeriodShifts(start, end) {
  await pool.query(
    `UPDATE staff_attendance
     SET clock_out = DATE_ADD(clock_in, INTERVAL 12 HOUR),
         total_minutes = 720,
         total_hours = 12,
         notes = CASE WHEN notes IS NULL OR notes = '' THEN 'A' ELSE notes END
     WHERE deleted = 0
       AND clock_out IS NULL
       AND work_date BETWEEN ? AND ?
       AND clock_in <= DATE_SUB(NOW(), INTERVAL 12 HOUR)`,
    [start, end]
  );
}

async function queueClosedWeekTimesheets(options = {}) {
  if (!enabled() && !options.force) return { skipped: true, reason: 'disabled', queued: 0 };

  const timezone = process.env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE || 'Australia/Sydney';
  const sendHour = Math.max(0, Math.min(23, Number(process.env.WEEKLY_TIMESHEET_EMAIL_HOUR || 7)));
  const period = latestCompletedWeek(options.now || new Date(), timezone);
  if (!options.force && period.localHour < sendHour) {
    return { skipped: true, reason: 'before_send_window', queued: 0, period };
  }

  await ensureUserLifecycleSchema();
  await ensureWorkforceSchema();
  await closeExpiredPeriodShifts(period.start, period.end);

  const [staffRows] = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       ROUND(SUM(COALESCE(sa.total_hours, 0)), 2) AS total_hours
     FROM users u
     LEFT JOIN staff_attendance sa
       ON sa.user_id = u.id
      AND sa.deleted = 0
      AND sa.work_date BETWEEN ? AND ?
     WHERE u.active = 1
       AND u.deleted_at IS NULL
       AND (
         LOWER(u.role) IN ('staff', 'production')
         OR u.permissions LIKE '%\"attendance\"%'
       )
     GROUP BY u.id, u.name, u.email
     ORDER BY u.id ASC`,
    [period.start, period.end]
  );

  let queued = 0;
  let existing = 0;
  for (const staff of staffRows) {
    const totalHours = Number(staff.total_hours || 0);
    const standardHours = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
    await pool.query(
      `INSERT INTO weekly_timesheets
       (user_id, week_start, week_end, total_hours, ordinary_hours, overtime_hours, status)
       VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')
       ON DUPLICATE KEY UPDATE
         total_hours = IF(UPPER(status) IN ('DRAFT', 'CORRECTION_REQUIRED'), VALUES(total_hours), total_hours),
         ordinary_hours = IF(UPPER(status) IN ('DRAFT', 'CORRECTION_REQUIRED'), VALUES(ordinary_hours), ordinary_hours),
         overtime_hours = IF(UPPER(status) IN ('DRAFT', 'CORRECTION_REQUIRED'), VALUES(overtime_hours), overtime_hours)`,
      [staff.id, period.start, period.end, totalHours, Math.min(totalHours, standardHours), Math.max(0, totalHours - standardHours)]
    );

    const [[timesheet]] = await pool.query(
      `SELECT id, user_id, week_start, week_end, total_hours, ordinary_hours, overtime_hours, status
       FROM weekly_timesheets
       WHERE user_id = ? AND week_start = ? AND week_end = ?
       LIMIT 1`,
      [staff.id, period.start, period.end]
    );
    const idempotencyKey = `weekly-timesheet:${timesheet.id}:${period.start}:${period.end}:v1`;
    const [[alreadyQueued]] = await pool.query(
      'SELECT id FROM email_queue WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    if (alreadyQueued) {
      existing += 1;
      continue;
    }

    const [attendance] = await pool.query(
      `SELECT work_date, clock_in, clock_out, total_hours
       FROM staff_attendance
       WHERE user_id = ? AND deleted = 0 AND work_date BETWEEN ? AND ?
       ORDER BY work_date ASC, clock_in ASC`,
      [staff.id, period.start, period.end]
    );
    const email = buildWeeklyEmail(staff, timesheet, attendance, timezone);
    await queueEmail({
      ...email,
      to: staff.email,
      templateKey: 'weekly_timesheet_summary',
      relatedModule: 'timesheets',
      relatedRecordId: timesheet.id,
      idempotencyKey
    });
    await pool.query(
      `INSERT INTO notifications
       (user_id, type, title, message, priority, linked_module, linked_record_id)
       VALUES (?, 'WEEKLY_TIMESHEET_READY', 'Weekly timesheet ready', ?, 'normal', 'timesheets', ?)`,
      [staff.id, `Your timesheet for ${period.start} to ${period.end} has been prepared and emailed.`, String(timesheet.id)]
    );
    queued += 1;
  }

  return { skipped: false, queued, existing, staff: staffRows.length, period };
}

async function runScheduledWeeklyTimesheetEmails() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const result = await queueClosedWeekTimesheets();
    const runKey = result.period ? `${result.period.start}:${result.period.end}` : '';
    if (!result.skipped && (result.queued > 0 || lastCompletedRunKey !== runKey)) {
      console.log(`Weekly timesheet email run ${runKey}: ${result.queued} queued, ${result.existing} already queued.`);
    }
    if (!result.skipped) lastCompletedRunKey = runKey;
  } catch (error) {
    console.error('Weekly timesheet email scheduler error:', error.message);
  } finally {
    schedulerBusy = false;
  }
}

function startWeeklyTimesheetScheduler() {
  if (!enabled() || schedulerTimer) return schedulerTimer;
  const intervalMs = Math.max(60000, Number(process.env.WEEKLY_TIMESHEET_EMAIL_INTERVAL_MS || 900000));
  schedulerTimer = setInterval(runScheduledWeeklyTimesheetEmails, intervalMs);
  schedulerTimer.unref();
  setTimeout(runScheduledWeeklyTimesheetEmails, 10000).unref();
  return schedulerTimer;
}

function stopWeeklyTimesheetScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

module.exports = {
  latestCompletedWeek,
  queueClosedWeekTimesheets,
  runScheduledWeeklyTimesheetEmails,
  startWeeklyTimesheetScheduler,
  stopWeeklyTimesheetScheduler
};
