const crypto = require('crypto');
const pool = require('../config/db');
const { ensureWorkforceSchema } = require('../services/workforceSchema');
const { hasPermission } = require('../services/authorizationService');
const { dateOnly } = require('../utils/dateOnly');
const { DateTime } = require('luxon');
const attendanceTime = require('../services/attendanceTimeService');
const { ensureWeeklyTimesheetDeliverySchema } = require('../services/weeklyTimesheetDeliverySchema');
const { attendanceRecordedHours } = require('../services/attendanceRecordedTotals');

const SHIFT_QR_WINDOW_SECONDS = 20;
const SHIFT_QR_PREFIX = 'VVSHIFT';

function todayDate() {
  return DateTime.now().setZone(attendanceTime.companyTimezone()).toISODate();
}

function weekStartDate() {
  return DateTime.now().setZone(attendanceTime.companyTimezone()).startOf('week').toISODate();
}

function weekEndDate() {
  return DateTime.fromISO(weekStartDate(), { zone: attendanceTime.companyTimezone() }).plus({ days: 6 }).toISODate();
}

function weekStartForDate(value) {
  const calendar = dateOnly(value);
  if (!calendar) throw attendanceTime.inputError('work_date', 'Enter a valid attendance date.');
  return DateTime.fromISO(calendar, { zone: attendanceTime.companyTimezone() }).startOf('week').toISODate();
}

function weekEndForDate(value) {
  return DateTime.fromISO(weekStartForDate(value), { zone: attendanceTime.companyTimezone() }).plus({ days: 6 }).toISODate();
}


function normalizeDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parts = text.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!parts || !require('../utils/dateOnly').dateOnly(parts[1])) return null;
  return `${parts[1]} ${parts[2]}:${parts[3]}:${parts[4] || '00'}`;
}

function isAdmin(req) {
  return hasPermission(req.user, 'EDIT_ATTENDANCE');
}

function shiftQrSecret() {
  const secret = process.env.SHIFT_QR_SIGNING_KEY || (process.env.NODE_ENV === 'production' ? '' : process.env.JWT_SECRET);
  if (!secret) throw new Error('SHIFT_QR_SIGNING_KEY is not configured');
  return secret;
}

function signShiftPeriod(period) {
  return crypto
    .createHmac('sha256', shiftQrSecret())
    .update(`${SHIFT_QR_PREFIX}:${period}`)
    .digest('hex')
    .slice(0, 18);
}

function currentShiftPeriod() {
  return Math.floor(Date.now() / (SHIFT_QR_WINDOW_SECONDS * 1000));
}

function createShiftQrToken(period = currentShiftPeriod()) {
  return `${SHIFT_QR_PREFIX}:${period}:${signShiftPeriod(period)}`;
}

function extractShiftQrToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (text.startsWith(`${SHIFT_QR_PREFIX}:`)) return text;

  try {
    const url = new URL(text);
    return url.searchParams.get('shift_qr_token')
      || url.searchParams.get('shift_qr')
      || url.searchParams.get('qr_token')
      || url.searchParams.get('token')
      || text;
  } catch {
    return text;
  }
}

function isValidShiftQrToken(value) {
  const token = extractShiftQrToken(value);
  const parts = token.split(':');
  if (parts.length !== 3 || parts[0] !== SHIFT_QR_PREFIX) return false;

  const period = Number(parts[1]);
  const signature = parts[2];
  if (!Number.isInteger(period) || !signature) return false;

  const current = currentShiftPeriod();
  const allowedPeriods = [current, current - 1, current + 1];
  return allowedPeriods.some((allowed) => {
    return period === allowed && signature === signShiftPeriod(period);
  });
}

function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function canBypassShiftQr(req) {
  const userId = Number(req.user?.id || 0);
  if (!userId) return false;

  const [rows] = await pool.query(
    'SELECT permissions FROM users WHERE id = ? LIMIT 1',
    [userId]
  );

  return parsePermissions(rows[0]?.permissions).includes('attendance_qr_bypass');
}

async function requireValidShiftQr(req, res) {
  if (await canBypassShiftQr(req)) return true;

  const token = req.body?.shift_qr_token || req.body?.qr_token || req.body?.token;
  if (isValidShiftQrToken(token)) return true;

  res.status(403).json({
    message: 'Please scan the current shift QR code before starting or ending your shift.',
    qr_required: true
  });
  return false;
}

let originalSchemaPromise;
function ensureAttendanceTables() {
  if (!originalSchemaPromise) originalSchemaPromise = createAttendanceTablesStructures().catch((error) => { originalSchemaPromise = null; throw error; });
  return originalSchemaPromise;
}

async function createAttendanceTablesStructures() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      clock_in DATETIME NOT NULL,
      clock_out DATETIME NULL,
      total_minutes INT NOT NULL DEFAULT 0,
      total_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
      work_date DATE NOT NULL,
      notes TEXT NULL,
      deleted TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_staff_attendance_user_date (user_id, work_date)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_timesheets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      total_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_weekly_timesheet (user_id, week_start, week_end)
    )
  `);

  await pool.query(`ALTER TABLE staff_attendance ADD COLUMN total_minutes INT NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE staff_attendance ADD COLUMN total_hours DECIMAL(8,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE staff_attendance ADD COLUMN work_date DATE NULL`).catch(() => {});
  await pool.query(`ALTER TABLE staff_attendance ADD COLUMN notes TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE staff_attendance ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query('ALTER TABLE staff_attendance ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP').catch(() => {});
  await pool.query('ALTER TABLE staff_attendance ADD COLUMN deleted TINYINT NOT NULL DEFAULT 0').catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN user_id INT NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN week_start DATE NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN week_end DATE NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN total_hours DECIMAL(8,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'open'`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP`).catch(() => {});
  await ensureWorkforceSchema();
  await ensureWeeklyTimesheetDeliverySchema();

}

async function markIncompleteShiftsForReview(userId = null) {
  await ensureAttendanceTables();
  const params = userId ? [userId] : [];
  const [rows] = await pool.query(`SELECT id,user_id FROM staff_attendance
    WHERE IFNULL(deleted,0)=0 AND clock_out IS NULL
      AND TIMESTAMPDIFF(MINUTE,clock_in,UTC_TIMESTAMP())>=720
      AND IFNULL(review_required,0)=0 ${userId ? 'AND user_id=?' : ''}`, params);
  if (rows.length) await pool.query(`UPDATE staff_attendance SET review_required=1,
    review_reason='INCOMPLETE_SHIFT_REQUIRES_REVIEW',attendance_status='INCOMPLETE'
    WHERE id IN (?) AND clock_out IS NULL AND IFNULL(deleted,0)=0`, [rows.map((row) => row.id)]);
  // Review metadata only: preserve the absent clock-out, original minutes and
  // historical notes. Reading attendance never manufactures completed hours.
  return rows;
}

/* ================= CLOCK IN ================= */

exports.clockIn = async (req, res) => {
  let connection;
  try {
    await ensureAttendanceTables();
    if (!(await requireValidShiftQr(req, res))) return;
    const userId = Number(req.user.id);
    await markIncompleteShiftsForReview(userId);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [[open]] = await connection.query(`SELECT id, clock_in FROM staff_attendance
      WHERE user_id = ? AND IFNULL(deleted, 0) = 0 AND clock_out IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId]);
    if (open) { await connection.commit(); return res.json({ message: 'Your active clock-in was returned safely', attendance_id: open.id, unchanged: true }); }
    const [result] = await connection.query(`INSERT INTO staff_attendance
      (user_id, clock_in, work_date, total_minutes, total_hours,entry_source,timestamp_basis,recorded_timezone,attendance_status)
      VALUES (?, UTC_TIMESTAMP(), ?, 0, 0,'CLOCK','UTC',?,'INCOMPLETE')`, [userId, todayDate(),attendanceTime.companyTimezone()]);
    await require('../services/auditService').logAudit(connection, {
      actorId: userId, action: 'CLOCK_IN', module: 'Attendance', recordType: 'staff_attendance', recordId: result.insertId,
      newValue: { user_id: userId, work_date: todayDate(), timestamp_basis: 'UTC', recorded_timezone: attendanceTime.companyTimezone(), entry_source: 'CLOCK' },
      ipAddress: req.ip, userAgent: req.get?.('user-agent')
    });
    await connection.commit();
    return res.json({ message: 'Clocked in successfully', attendance_id: result.insertId, unchanged: false });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Clock-in failed:', error.code || error.name);
    return res.status(500).json({ message: 'Clock-in could not be saved. Refresh your shift before retrying.', code: 'CLOCK_IN_FAILED' });
  } finally { if (connection) connection.release(); }
};

exports.clockOut = async (req, res) => {
  let connection;
  try {
    await ensureAttendanceTables();
    if (!(await requireValidShiftQr(req, res))) return;
    const userId = Number(req.user.id);
    await markIncompleteShiftsForReview(userId);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [[attendance]] = await connection.query(`SELECT * FROM staff_attendance
      WHERE user_id = ? AND IFNULL(deleted, 0) = 0 AND clock_out IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId]);
    if (!attendance) { await connection.rollback(); return res.status(409).json({ message: 'No active clock-in was found. Refresh your shift.', code: 'NO_ACTIVE_SHIFT' }); }
    if (attendance.timestamp_basis !== 'UTC') {
      await connection.query(`UPDATE staff_attendance SET clock_out=UTC_TIMESTAMP(),clock_out_timestamp_basis='UTC',
        review_required=1,review_reason='ATTENDANCE_TIMEZONE_UNVERIFIED',attendance_status='REVIEW_REQUIRED'
        WHERE id=? AND clock_out IS NULL AND IFNULL(deleted,0)=0`, [attendance.id]);
      const [[review]] = await connection.query('SELECT * FROM staff_attendance WHERE id = ?', [attendance.id]);
      await require('../services/auditService').logAudit(connection, {
        actorId: userId, action: 'CLOCK_OUT_REVIEW_REQUIRED', module: 'Attendance', recordType: 'staff_attendance', recordId: attendance.id,
        oldValue: { clock_in: attendance.clock_in, clock_out: attendance.clock_out, total_minutes: attendance.total_minutes, total_hours: attendance.total_hours, timestamp_basis: attendance.timestamp_basis },
        newValue: { clock_out: review.clock_out, clock_out_timestamp_basis: 'UTC', total_minutes: review.total_minutes, total_hours: review.total_hours, review_required: true, review_reason: 'ATTENDANCE_TIMEZONE_UNVERIFIED' },
        ipAddress: req.ip, userAgent: req.get?.('user-agent')
      });
      await connection.commit();
      return res.json({ message: 'Clock-out recorded. This older shift needs an authorised timezone correction before worked hours can be confirmed; its saved amounts are preserved.', code: 'ATTENDANCE_TIMEZONE_UNVERIFIED', attendance: review, review_required: true, timesheet_status: 'pending_review' });
    }
    await connection.query(`UPDATE staff_attendance SET clock_out = UTC_TIMESTAMP(),
      total_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, clock_in, UTC_TIMESTAMP())-COALESCE(break_minutes,0)),
      total_hours = GREATEST(0, ROUND((TIMESTAMPDIFF(MINUTE, clock_in, UTC_TIMESTAMP())-COALESCE(break_minutes,0)) / 60, 2)),
      attendance_status='WORKED',clock_out_timestamp_basis='UTC'
      WHERE id = ? AND clock_out IS NULL AND IFNULL(deleted, 0) = 0`, [attendance.id]);
    const [[updated]] = await connection.query('SELECT * FROM staff_attendance WHERE id = ?', [attendance.id]);
    await require('../services/auditService').logAudit(connection, {
      actorId: userId, action: 'CLOCK_OUT', module: 'Attendance', recordType: 'staff_attendance', recordId: attendance.id,
      oldValue: { clock_in: attendance.clock_in, clock_out: attendance.clock_out },
      newValue: { clock_out: updated.clock_out, total_minutes: updated.total_minutes, total_hours: updated.total_hours },
      ipAddress: req.ip, userAgent: req.get?.('user-agent')
    });
    await connection.commit();
    connection.release(); connection = null;
    let timesheetStatus = 'refreshed';
    try { await refreshWeekForDate(userId, updated.work_date); }
    catch (error) { timesheetStatus = 'pending_refresh'; console.error('Timesheet refresh pending:', error.code || error.name); }
    return res.json({ message: 'Clocked out successfully', attendance: updated, timesheet_status: timesheetStatus });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Clock-out failed:', error.code || error.name);
    return res.status(500).json({ message: 'Clock-out could not be saved. Refresh your shift before retrying.', code: 'CLOCK_OUT_FAILED' });
  } finally { if (connection) connection.release(); }
};

/* ================= TODAY ATTENDANCE ================= */

exports.todayAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    const userId = Number(req.user?.id);
    const workDate = todayDate();

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    await markIncompleteShiftsForReview(userId);

    const [rows] = await pool.query(
      `
      SELECT
        id,
        user_id,
        clock_in,
        clock_out,
        total_minutes,
        total_hours,
        work_date,
        notes,
        break_minutes,entry_source,timestamp_basis,clock_out_timestamp_basis,recorded_timezone,attendance_status,review_required,review_reason,
        DATE_FORMAT(clock_in,'%Y-%m-%d %H:%i:%s') AS clock_in_utc_text,
        DATE_FORMAT(clock_out,'%Y-%m-%d %H:%i:%s') AS clock_out_utc_text,
        created_at
      FROM staff_attendance
      WHERE IFNULL(deleted, 0) = 0 AND user_id = ?
      AND work_date = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId, workDate]
    );

    res.json({
      attendance: rows[0] || null, company_timezone: attendanceTime.companyTimezone()
    });
  } catch (err) {
    console.error('TODAY ATTENDANCE ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load today attendance',
      error: err.message
    });
  }
};

/* ================= WEEK ATTENDANCE ================= */

exports.weekAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    await markIncompleteShiftsForReview(userId);

    const start = weekStartDate();
    const end = weekEndDate();

    const data = await getWeekAttendance(userId, start, end);

    const timesheet = await upsertWeeklyTimesheet(userId, start, end, data.totalHours);

    res.json({
      week_start: start,
      week_end: end,
      total_hours: data.totalHours,
      attendance: data.rows,
      timesheet, company_timezone: attendanceTime.companyTimezone()
    });
  } catch (err) {
    console.error('WEEK ATTENDANCE ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load weekly attendance',
      error: err.message
    });
  }
};

/* ================= MY ATTENDANCE ================= */

exports.myAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    await markIncompleteShiftsForReview(userId);

    const [rows] = await pool.query(
      `
      SELECT
        id,
        user_id,
        clock_in,
        clock_out,
        total_minutes,
        total_hours,
        work_date,
        notes,
        break_minutes,entry_source,timestamp_basis,clock_out_timestamp_basis,recorded_timezone,attendance_status,review_required,review_reason,
        DATE_FORMAT(clock_in,'%Y-%m-%d %H:%i:%s') AS clock_in_utc_text,
        DATE_FORMAT(clock_out,'%Y-%m-%d %H:%i:%s') AS clock_out_utc_text,
        created_at
      FROM staff_attendance
      WHERE IFNULL(deleted, 0) = 0 AND user_id = ?
      ORDER BY work_date ASC, clock_in ASC
      `,
      [userId]
    );

    res.json({
      attendance: rows, company_timezone: attendanceTime.companyTimezone()
    });
  } catch (err) {
    console.error('MY ATTENDANCE ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load attendance',
      error: err.message
    });
  }
};

/* ================= ALL ATTENDANCE ADMIN ================= */

exports.allAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    await markIncompleteShiftsForReview();

    const archived = String(req.query?.archived || '').toLowerCase() === 'true';

    const [rows] = await pool.query(
      `
      SELECT
        a.id,
        a.user_id,
        u.name,
        u.email,
        u.role,
        a.clock_in,
        a.clock_out,
        a.total_minutes,
        a.total_hours,
        a.work_date,
        a.notes,
        a.break_minutes,a.entry_source,a.timestamp_basis,a.clock_out_timestamp_basis,a.recorded_timezone,a.attendance_status,a.review_required,a.review_reason,
        DATE_FORMAT(a.clock_in,'%Y-%m-%d %H:%i:%s') AS clock_in_utc_text,
        DATE_FORMAT(a.clock_out,'%Y-%m-%d %H:%i:%s') AS clock_out_utc_text,
        a.created_at,
        a.deleted
      FROM staff_attendance a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE IFNULL(a.deleted, 0) = ?
      ORDER BY a.work_date ASC, a.clock_in ASC
      `, [archived ? 1 : 0]
    );

    res.json({
      attendance: rows, company_timezone: attendanceTime.companyTimezone()
    });
  } catch (err) {
    console.error('ALL ATTENDANCE ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load attendance',
      error: err.message
    });
  }
};

/* ================= ADMIN WEEKLY TIMESHEETS ================= */

exports.allWeeklyTimesheets = async (req, res) => {
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const [rows] = await pool.query(
      `
      SELECT
        wt.id,
        wt.user_id,
        u.name,
        u.email,
        wt.week_start,
        wt.week_end,
        wt.total_hours,
        wt.status,
        wt.created_at
      FROM weekly_timesheets wt
      LEFT JOIN users u ON u.id = wt.user_id
      ORDER BY wt.week_start ASC, u.name ASC
      `
    );

    res.json({
      timesheets: rows
    });
  } catch (err) {
    console.error('ALL WEEKLY TIMESHEETS ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load weekly timesheets',
      error: err.message
    });
  }
};

exports.updateWeeklyTimesheetStatus = async (req, res) => {
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const id = Number(req.body.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    const allowed = new Set(['open', 'approved', 'rejected']);

    if (!id || !allowed.has(status)) {
      return res.status(400).json({ message: 'Valid timesheet and status are required' });
    }

    const [result] = await pool.query(
      `UPDATE weekly_timesheets SET status = ? WHERE id = ?`,
      [status, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Timesheet not found' });
    }

    res.json({ message: 'Timesheet status updated', status });
  } catch (err) {
    console.error('UPDATE WEEKLY TIMESHEET STATUS ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to update timesheet status',
      error: err.message
    });
  }
};
function buildShiftQrPayload() {
  const period = currentShiftPeriod();
  const token = createShiftQrToken(period);
  const expiresAtMs = (period + 1) * SHIFT_QR_WINDOW_SECONDS * 1000;

  return {
    token,
    qr_data: token,
    expires_in_seconds: Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000)),
    refresh_seconds: SHIFT_QR_WINDOW_SECONDS,
    manual_bypass_enabled: false
  };
}

exports.shiftQrToken = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    res.json(buildShiftQrPayload());
  } catch (err) {
    console.error('SHIFT QR TOKEN ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to generate shift QR',
      error: err.message
    });
  }
};

exports.publicShiftQrToken = async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(buildShiftQrPayload());
  } catch (err) {
    console.error('PUBLIC SHIFT QR TOKEN ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to generate shift QR',
      error: err.message
    });
  }
};

exports.userTimesheets = async (req, res) => {
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const userId = Number(req.query.user_id || 0);
    const period = String(req.query.period || 'weekly').toLowerCase() === 'monthly' ? 'monthly' : 'weekly';

    if (!userId) {
      return res.status(400).json({ message: 'Staff user is required' });
    }

    await markIncompleteShiftsForReview(userId);

    const groupStart = period === 'monthly'
      ? "DATE_FORMAT(a.work_date, '%Y-%m-01')"
      : "DATE_SUB(a.work_date, INTERVAL WEEKDAY(a.work_date) DAY)";
    const groupEnd = period === 'monthly'
      ? "LAST_DAY(a.work_date)"
      : "DATE_ADD(DATE_SUB(a.work_date, INTERVAL WEEKDAY(a.work_date) DAY), INTERVAL 6 DAY)";

    const [summary] = await pool.query(
      `
      SELECT
        ${groupStart} AS period_start,
        ${groupEnd} AS period_end,
        COUNT(*) AS shifts,
        ROUND(SUM(CASE WHEN a.timestamp_basis='UTC' THEN a.total_minutes/60 ELSE IFNULL(a.total_hours,0) END), 2) AS total_hours,
        MIN(a.work_date) AS first_shift,
        MAX(a.work_date) AS last_shift
      FROM staff_attendance a
      WHERE IFNULL(a.deleted, 0) = 0 AND a.user_id = ?
      GROUP BY period_start, period_end
      ORDER BY period_start ASC
      `,
      [userId]
    );

    const [records] = await pool.query(
      `
      SELECT
        a.id,
        a.user_id,
        u.name,
        u.email,
        a.clock_in,
        a.clock_out,
        a.total_hours,
        a.work_date,
        a.notes
      FROM staff_attendance a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE IFNULL(a.deleted, 0) = 0 AND a.user_id = ?
      ORDER BY a.work_date ASC, a.clock_in ASC
      `,
      [userId]
    );

    res.json({
      period,
      summary,
      records
    });
  } catch (err) {
    console.error('USER TIMESHEETS ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to load staff timesheets',
      error: err.message
    });
  }
};

/* ================= ADMIN MANAGE ATTENDANCE ================= */

exports.saveAttendance = async (req, res) => {
  let connection;
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Attendance editing is not enabled for your account' });
    const id = Number(req.body.id || 0), userId = Number(req.body.user_id);
    if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(userId) || userId <= 0) return res.status(422).json({ message: 'Select valid staff and attendance.', fields: { user_id: 'Select valid staff' } });
    let entry = attendanceTime.manualWorkedEntry(req.body, req.user.id);
    const notes = String(req.body.notes || '').trim();
    if (notes.length > 10000) return res.status(422).json({ message: 'Attendance notes are too long', fields: { notes: 'Maximum 10,000 characters' } });
    await ensureAttendanceTables();
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [[identity]] = id ? await connection.query('SELECT user_id FROM staff_attendance WHERE id=?', [id]) : [[]];
    if (id && !identity) { await connection.rollback(); return res.status(404).json({ message: 'Attendance record not found' }); }
    for (const employeeId of [...new Set([userId, Number(identity?.user_id || userId)])].sort((x,y) => x-y)) {
      const [[user]] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [employeeId]);
      if (!user) { await connection.rollback(); return res.status(404).json({ message: 'Staff member not found' }); }
    }
    let previous = null, recordId = id;
    if (id) {
      const [[row]] = await connection.query('SELECT * FROM staff_attendance WHERE id = ? AND IFNULL(deleted, 0) = 0 FOR UPDATE', [id]);
      if (!row) { await connection.rollback(); return res.status(404).json({ message: 'Attendance record not found' }); }
      if (Number(row.user_id) !== Number(identity.user_id)) { await connection.rollback(); return res.status(409).json({ message: 'The employee for this shift changed. Refresh before retrying.', code: 'ATTENDANCE_EDIT_CONFLICT' }); }
      previous = row;
      if (!Object.hasOwn(req.body, 'break_minutes')) entry = attendanceTime.manualWorkedEntry({ ...req.body, break_minutes: previous.break_minutes }, req.user.id);
    }
    if (!entry.clock_out) {
      const [[open]] = await connection.query('SELECT id FROM staff_attendance WHERE user_id = ? AND IFNULL(deleted, 0) = 0 AND clock_out IS NULL AND id <> ? LIMIT 1', [userId, id]);
      if (open) { await connection.rollback(); return res.status(409).json({ message: 'This staff member already has an active shift', code: 'ACTIVE_SHIFT_CONFLICT' }); }
    }
    if (!id) {
      const [[duplicate]] = await connection.query(`SELECT id FROM staff_attendance WHERE user_id=? AND IFNULL(deleted,0)=0
        AND clock_in=? AND clock_out <=> ? AND total_minutes=? AND notes <=> ? AND timestamp_basis='UTC' LIMIT 1`,
        [userId, entry.clock_in, entry.clock_out, entry.total_minutes, notes]);
      if (duplicate) { await connection.commit(); return res.json({ message: 'This worked attendance entry is already saved', attendance_id: duplicate.id, unchanged: true }); }
    }
    const fields = ['clock_in','clock_out','work_date','total_minutes','total_hours','break_minutes','entry_source','timestamp_basis','clock_out_timestamp_basis','recorded_timezone','manual_authorised_by','manual_authorised_at','attendance_status','review_required','review_reason'];
    const values = fields.map((field) => entry[field]);
    if (id) await connection.query(`UPDATE staff_attendance SET user_id=?,${fields.map((field) => field+'=?').join(',')},notes=? WHERE id=? AND IFNULL(deleted,0)=0`, [userId,...values,notes,id]);
    else {
      const [result] = await connection.query(`INSERT INTO staff_attendance (user_id,${fields.join(',')},notes) VALUES (${Array(fields.length+2).fill('?').join(',')})`, [userId,...values,notes]);
      recordId = result.insertId;
    }
    await require('../services/auditService').logAudit(connection, {
      actorId: req.user.id, action: id ? 'ATTENDANCE_UPDATED' : 'ATTENDANCE_CREATED', module: 'Attendance', recordType: 'staff_attendance', recordId,
      oldValue: previous, newValue: { user_id: userId, ...entry, notes },
      ipAddress: req.ip, userAgent: req.get?.('user-agent')
    });
    await connection.commit(); connection.release(); connection = null;
    let timesheetStatus = 'refreshed';
    try {
      if (previous) await refreshWeekForDate(previous.user_id, previous.work_date);
      await refreshWeekForDate(userId, entry.work_date);
    } catch (error) { timesheetStatus = 'pending_refresh'; console.error('Attendance timesheet refresh pending:', error.code || error.name); }
    return res.json({ message: entry.review_required ? 'Incomplete attendance saved for review; it is excluded from automatic delivery.' : 'Authorised worked attendance saved successfully', attendance_id: recordId, timesheet_status: timesheetStatus, review_required: Boolean(entry.review_required) });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.statusCode && error.statusCode < 500) return res.status(error.statusCode).json({ message: error.message, code: error.code, fields: error.fields });
    console.error('Attendance save failed:', error.code || error.name);
    return res.status(500).json({ message: 'Attendance could not be saved. Refresh before retrying.', code: 'ATTENDANCE_SAVE_FAILED' });
  } finally { if (connection) connection.release(); }
};

async function archiveAttendance(req, res, archived) {
  let connection;
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Attendance editing is not enabled for your account' });
    const id = Number(req.body.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Select a valid attendance record' });
    await ensureAttendanceTables(); connection = await pool.getConnection(); await connection.beginTransaction();
    const [[identity]] = await connection.query('SELECT user_id FROM staff_attendance WHERE id = ?', [id]);
    if (!identity) { await connection.rollback(); return res.status(404).json({ message: 'Attendance record not found' }); }
    await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [identity.user_id]);
    const [[row]] = await connection.query('SELECT * FROM staff_attendance WHERE id = ? FOR UPDATE', [id]);
    if (!row) { await connection.rollback(); return res.status(404).json({ message: 'Attendance record not found' }); }
    if (Number(row.user_id) !== Number(identity.user_id)) { await connection.rollback(); return res.status(409).json({ message: 'The employee for this shift changed. Refresh and retry.', code: 'ATTENDANCE_EDIT_CONFLICT' }); }
    if (Boolean(Number(row.deleted)) === archived) { await connection.commit(); return res.json({ message: 'Attendance archive state already saved', attendance_id: id, archived, unchanged: true }); }
    if (!archived && !row.clock_out) {
      const [[open]] = await connection.query('SELECT id FROM staff_attendance WHERE user_id = ? AND IFNULL(deleted, 0) = 0 AND clock_out IS NULL LIMIT 1', [row.user_id]);
      if (open) { await connection.rollback(); return res.status(409).json({ message: 'Close the active shift before restoring an unfinished shift', code: 'ACTIVE_SHIFT_CONFLICT' }); }
    }
    await connection.query('UPDATE staff_attendance SET deleted = ? WHERE id = ?', [archived ? 1 : 0, id]);
    await require('../services/auditService').logAudit(connection, { actorId: req.user.id, action: archived ? 'ATTENDANCE_ARCHIVED' : 'ATTENDANCE_RESTORED', module: 'Attendance', recordType: 'staff_attendance', recordId: id,
      oldValue: { deleted: row.deleted }, newValue: { deleted: archived ? 1 : 0 }, ipAddress: req.ip, userAgent: req.get?.('user-agent') });
    await connection.commit(); connection.release(); connection = null;
    let timesheetStatus = 'refreshed';
    try { await refreshWeekForDate(row.user_id, row.work_date); } catch (error) { timesheetStatus = 'pending_refresh'; console.error('Archived attendance timesheet refresh pending:', error.code || error.name); }
    return res.json({ message: archived ? 'Attendance archived; its ID and audit history remain available' : 'Attendance restored', attendance_id: id, archived, timesheet_status: timesheetStatus });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Attendance archive failed:', error.code || error.name);
    return res.status(500).json({ message: 'Attendance archive state could not be saved' });
  } finally { if (connection) connection.release(); }
}
exports.deleteAttendance = (req, res) => archiveAttendance(req, res, true);
exports.restoreAttendance = (req, res) => archiveAttendance(req, res, false);

/* ================= HELPERS ================= */

async function getWeekAttendance(userId, start, end) {
  const [rows] = await pool.query(
    `
    SELECT
      id,
      user_id,
      clock_in,
      clock_out,
      total_minutes,
      total_hours,
      work_date,
      notes,
      break_minutes,entry_source,timestamp_basis,clock_out_timestamp_basis,recorded_timezone,attendance_status,review_required,review_reason,
      DATE_FORMAT(clock_in,'%Y-%m-%d %H:%i:%s') AS clock_in_utc_text,
      DATE_FORMAT(clock_out,'%Y-%m-%d %H:%i:%s') AS clock_out_utc_text,
      created_at
    FROM staff_attendance
    WHERE IFNULL(deleted, 0) = 0 AND user_id = ?
    AND work_date BETWEEN ? AND ?
    ORDER BY work_date ASC, clock_in ASC
    `,
    [userId, start, end]
  );

  const totalHours = attendanceRecordedHours(rows);

  return {
    rows,
    totalHours: Number(totalHours.toFixed(2))
  };
}

async function refreshCurrentWeekTimesheet(userId) {
  const start = weekStartDate();
  const end = weekEndDate();
  const data = await getWeekAttendance(userId, start, end);

  await upsertWeeklyTimesheet(userId, start, end, data.totalHours);
}

async function refreshWeekForDate(userId, dateValue) {
  const start = weekStartForDate(dateValue);
  const end = weekEndForDate(dateValue);
  const data = await getWeekAttendance(userId, start, end);

  await upsertWeeklyTimesheet(userId, start, end, data.totalHours);
}

async function upsertWeeklyTimesheet(userId, weekStart, weekEnd, totalHours) {
  const [existing] = await pool.query(
    `
    SELECT id, status, total_hours, ordinary_hours, overtime_hours, approved_hours,
      payroll_status, submitted_at, approved_at, version_no, manager_comments
    FROM weekly_timesheets
    WHERE user_id = ?
    AND week_start = ?
    AND week_end = ?
    LIMIT 1
    `,
    [userId, weekStart, weekEnd]
  );

  if (existing.length) {
    const record = existing[0];
    const status = String(record.status || 'DRAFT').trim().toUpperCase();
    if (['DRAFT', 'CORRECTION_REQUIRED'].includes(status)) {
      const standardHours = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
      await pool.query(
        `
        UPDATE weekly_timesheets
        SET total_hours = ?, ordinary_hours = ?, overtime_hours = ?
        WHERE id = ?
        `,
        [
          totalHours,
          Math.min(Number(totalHours || 0), standardHours),
          Math.max(0, Number(totalHours || 0) - standardHours),
          record.id
        ]
      );
      record.total_hours = totalHours;
      record.ordinary_hours = Math.min(Number(totalHours || 0), standardHours);
      record.overtime_hours = Math.max(0, Number(totalHours || 0) - standardHours);
    }
    record.status = status;
    return record;
  }

  const standardHours = Number(process.env.STANDARD_WEEKLY_HOURS || 38);
  const [result] = await pool.query(
    `
    INSERT INTO weekly_timesheets
    (user_id, week_start, week_end, total_hours, ordinary_hours, overtime_hours, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      weekStart,
      weekEnd,
      totalHours,
      Math.min(Number(totalHours || 0), standardHours),
      Math.max(0, Number(totalHours || 0) - standardHours),
      'DRAFT'
    ]
  );
  return {
    id: result.insertId,
    user_id: userId,
    week_start: weekStart,
    week_end: weekEnd,
    total_hours: totalHours,
    ordinary_hours: Math.min(Number(totalHours || 0), standardHours),
    overtime_hours: Math.max(0, Number(totalHours || 0) - standardHours),
    approved_hours: 0,
    status: 'DRAFT',
    payroll_status: 'NOT_READY',
    version_no: 0
  };
}

// Compatibility export delegates to the same controlled, single-recipient
// weekly correction workflow. The old all-staff/admin-copy sender is retired.
exports.sendTimesheetSummary = require('./weeklyTimesheetDeliveryController').legacySend;

exports.ensureAttendanceTables = ensureAttendanceTables;

exports._test = { normalizeDateTime };
