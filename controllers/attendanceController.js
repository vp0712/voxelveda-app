const pool = require('../config/db');
const { ensureWorkforceSchema } = require('../services/workforceSchema');
const { hasPermission } = require('../services/authorizationService');
const { dateOnly } = require('../utils/dateOnly');
const { DateTime } = require('luxon');
const attendanceTime = require('../services/attendanceTimeService');
const { ensureWeeklyTimesheetDeliverySchema } = require('../services/weeklyTimesheetDeliverySchema');
const verifiedAttendance = require('../services/attendanceVerifiedSummaryService');

const mobileActions = require('../services/attendanceActionService');
const dailyAttendance = require('../services/attendanceDailyService');
const corrections = require('../services/attendanceCorrectionService');
const qr = require('../services/attendanceQrService');
const { ensureAttendanceMobileSchema } = require('../services/attendanceMobileSchema');

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
  await ensureAttendanceMobileSchema();

}

async function incompleteShiftsForReview(userId = null) {
  await ensureAttendanceTables();
  const params = userId ? [userId] : [];
  const [rows] = await pool.query(`SELECT id,user_id FROM staff_attendance
    WHERE IFNULL(deleted,0)=0 AND clock_out IS NULL
      AND TIMESTAMPDIFF(MINUTE,clock_in,UTC_TIMESTAMP())>=720
      AND IFNULL(review_required,0)=0 ${userId ? 'AND user_id=?' : ''}`, params);
  // Detection is read-only. Stored review flags and locked attendance revisions
  // remain untouched; eligible-work assessment reports the incomplete source.
  return rows;
}

/* ================= SERVER-AUTHORITATIVE MOBILE ACTIONS ================= */
function mobileFailure(res, error) {
  if (!error.statusCode) console.error('Attendance operation failed:', error.code || error.name);
  const retryable = ['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code);
  return res.status(error.statusCode || (retryable ? 409 : 500)).json({
    message: error.statusCode ? error.message : retryable ? 'Another attendance action is being saved. Reconcile your request before retrying.' : 'Attendance could not be confirmed. Reconcile the same request before retrying.',
    code: error.code || 'ATTENDANCE_OPERATION_FAILED', fields: error.fields || null, qr_required: Boolean(error.qr_required)
  });
}
async function runMobileAction(req, res, forcedAction) {
  try {
    await ensureAttendanceTables();
    const result = await mobileActions.performAction({user:req.user,input:{...(req.body || {}),...(forcedAction?{action:forcedAction}:{})},req});
    let timesheetStatus = 'unchanged';
    if (result.action === 'CHECK_OUT') {
      try { await refreshWeekForDate(req.user.id, result.attendance.work_date); timesheetStatus = 'refreshed'; }
      catch (error) { timesheetStatus = 'pending_refresh'; console.error('Attendance timesheet refresh pending:', error.code || error.name); }
    }
    return res.json({...result,timesheet_status:timesheetStatus});
  } catch (error) { return mobileFailure(res,error); }
}
exports.action = (req,res) => runMobileAction(req,res);
// Legacy routes use the identical durable action service. A missing stable
// request ID fails clearly rather than guessing a toggle or creating a retry.
exports.clockIn = (req,res) => runMobileAction(req,res,'CHECK_IN');
exports.clockOut = (req,res) => runMobileAction(req,res,'CHECK_OUT');
exports.todayAttendance = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await dailyAttendance.readToday({user:req.user})); } catch(error) { return mobileFailure(res,error); } };
exports.reconcile = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await mobileActions.reconcileAction({user:req.user,requestId:req.query.request_id})); } catch(error) { return mobileFailure(res,error); } };
exports.validateQr = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await mobileActions.resolveQr({user:req.user,input:req.body || {}})); } catch(error) { return mobileFailure(res,error); } };
exports.saveCheckoutNote = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await mobileActions.saveCheckoutNote({user:req.user,attendanceId:req.params.id,input:req.body || {},req})); } catch(error) { return mobileFailure(res,error); } };
exports.requestCorrection = async (req,res) => { try { await ensureAttendanceTables(); const result=await corrections.requestCorrection({user:req.user,input:req.body || {},req}); return res.status(result.existing?200:201).json(result); } catch(error) { return mobileFailure(res,error); } };
exports.listCorrections = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await corrections.listCorrections({user:req.user,query:req.query})); } catch(error) { return mobileFailure(res,error); } };
exports.correctionDetail = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await corrections.getCorrection({user:req.user,id:req.params.id})); } catch(error) { return mobileFailure(res,error); } };
async function decideCorrection(req,res,decision) {
  try {
    await ensureAttendanceTables();
    const result=await corrections.decideCorrection({user:req.user,id:req.params.id,input:req.body || {},decision,req});
    if (decision==='APPROVED' && !result.existing) {
      try { if(result.previous_work_date)await refreshWeekForDate(result.user_id,result.previous_work_date); await refreshWeekForDate(result.user_id,result.work_date); result.timesheet_status='refreshed'; }
      catch(error) { result.timesheet_status='pending_refresh'; console.error('Corrected timesheet refresh pending:',error.code || error.name); }
    }
    return res.json(result);
  } catch(error) { return mobileFailure(res,error); }
}
exports.approveCorrection = (req,res) => decideCorrection(req,res,'APPROVED');
exports.rejectCorrection = (req,res) => decideCorrection(req,res,'REJECTED');

/* ================= WEEK ATTENDANCE ================= */

exports.weekAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    await incompleteShiftsForReview(userId);

    const start = weekStartDate();
    const end = weekEndDate();

    const data = await getWeekAttendance(userId, start, end);

    const timesheet = await upsertWeeklyTimesheet(userId, start, end, data.totalHours);

    res.json({
      week_start: start,
      week_end: end,
      total_hours: data.totalHours,
      verified_total_minutes:data.verified_total_minutes,historical_saved_hours:data.historical_saved_hours,verification_status:data.verification_status,review_required:data.review_required,review_issues:data.review_issues,duplicate_records:data.duplicate_records,
      attendance: data.rows.map(row=>({...require('../services/attendanceMobilePolicy').publicAttendance(row),total_hours:row.total_hours,total_minutes:row.total_minutes})),
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
exports.myAttendance = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await dailyAttendance.listMySessions({user:req.user,query:req.query})); } catch(error) { return mobileFailure(res,error); } };
exports.sessions = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await dailyAttendance.listSessions({user:req.user,query:req.query})); } catch(error) { return mobileFailure(res,error); } };
exports.team = async (req,res) => { try { await ensureAttendanceTables(); return res.json(await dailyAttendance.listSessions({user:req.user,query:{...req.query,scope:'team'}})); } catch(error) { return mobileFailure(res,error); } };

/* ================= ALL ATTENDANCE ADMIN ================= */

exports.allAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const incomplete = new Set((await incompleteShiftsForReview()).map(row => Number(row.id)));

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
        a.break_minutes,a.entry_source,a.timestamp_basis,a.clock_out_timestamp_basis,a.recorded_timezone,a.attendance_status,a.review_required,a.review_reason,a.revision,
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
      attendance: rows.map(row => ({...row, computed_review_required: incomplete.has(Number(row.id)), computed_review_reason: incomplete.has(Number(row.id)) ? 'INCOMPLETE_SHIFT_REQUIRES_REVIEW' : null})), company_timezone: attendanceTime.companyTimezone()
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
function buildShiftQrPayload() { return qr.createSiteToken(); }
exports.shiftQrToken = async (req,res) => {
  try { if (!isAdmin(req)) return res.status(403).json({message:'Attendance administration is required.'}); res.setHeader('Cache-Control','no-store, max-age=0'); return res.json(buildShiftQrPayload()); }
  catch(error) { return mobileFailure(res,error); }
};
exports.publicShiftQrToken = async (_req,res) => {
  try { res.setHeader('Cache-Control','no-store, max-age=0'); return res.json(buildShiftQrPayload()); }
  catch(error) { return mobileFailure(res,error); }
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

    await incompleteShiftsForReview(userId);

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
      require('../services/attendanceMobilePolicy').revision(req.body.expected_revision,row.revision);
      if(Number(row.user_id)!==userId)throw Object.assign(new Error('The owner of a saved attendance session cannot be changed in an edit. Review the original record with an authorised administrator.'),{statusCode:409,code:'ATTENDANCE_OWNER_CHANGE_DENIED'});
      const reason=String(req.body.correction_reason||req.body.reason||'').trim();
      if(reason.length<3||reason.length>1000)throw Object.assign(new Error('Enter a correction reason for the audit history.'),{statusCode:422,code:'ATTENDANCE_CORRECTION_REASON_REQUIRED',fields:{correction_reason:'Explain the change'}});
      if (!Object.hasOwn(req.body, 'break_minutes')) entry = attendanceTime.manualWorkedEntry({ ...req.body, break_minutes: previous.break_minutes }, req.user.id);
    }
    await corrections.assertMutablePeriod(connection,userId,[entry.work_date]);
    if(previous)await corrections.assertMutablePeriod(connection,previous.user_id,[require('../utils/dateOnly').dateOnly(previous.work_date)]);
    const previousBreaks=previous?await corrections.effectiveBreaks(connection,previous.id):[];
    if(previousBreaks.some(interval=>!interval.ended_at))throw Object.assign(new Error('End the active break or use the supervised correction request before manually changing this session.'),{statusCode:409,code:'ATTENDANCE_BREAK_PENDING'});
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
    const [overlapping]=await connection.query('SELECT id FROM staff_attendance WHERE user_id=? AND IFNULL(deleted,0)=0 AND id<>? AND clock_in<? AND (clock_out IS NULL OR clock_out>?) FOR UPDATE',[userId,id,entry.clock_out||attendanceTime.sqlUtc(DateTime.utc()),entry.clock_in]);
    if(overlapping.length)throw Object.assign(new Error('This interval overlaps another retained attendance session. Review both records before saving.'),{statusCode:409,code:'ATTENDANCE_CORRECTION_OVERLAP'});
    const fields = ['clock_in','clock_out','work_date','total_minutes','total_hours','break_minutes','entry_source','timestamp_basis','clock_out_timestamp_basis','recorded_timezone','manual_authorised_by','manual_authorised_at','attendance_status','review_required','review_reason'];
    const values = fields.map((field) => entry[field]);
    if (id) {
      await corrections.supersedeBreaks(connection,{attendanceId:id,actorId:req.user.id,attendanceRevision:Number(previous.revision)+1});
      await connection.query(`UPDATE staff_attendance SET user_id=?,${fields.map((field) => field+'=?').join(',')},notes=?,break_tracking_base_minutes=NULL,revision=revision+1 WHERE id=? AND IFNULL(deleted,0)=0`, [userId,...values,notes,id]);
    }
    else {
      const [result] = await connection.query(`INSERT INTO staff_attendance (user_id,${fields.join(',')},notes) VALUES (${Array(fields.length+2).fill('?').join(',')})`, [userId,...values,notes]);
      recordId = result.insertId;
    }
    await require('../services/auditService').logAudit(connection, {
      actorId: req.user.id, action: id ? 'ATTENDANCE_UPDATED' : 'ATTENDANCE_CREATED', module: 'Attendance', recordType: 'staff_attendance', recordId,
      oldValue: previous?{...previous,break_intervals:previousBreaks}:null, newValue: { user_id: userId, ...entry, notes, correction_reason:req.body.correction_reason||req.body.reason||null, superseded_break_ids:previousBreaks.map(interval=>interval.id) },
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
    await corrections.assertMutablePeriod(connection,row.user_id,[require('../utils/dateOnly').dateOnly(row.work_date)]);
    const breakIntervals=await corrections.effectiveBreaks(connection,row.id);
    if(breakIntervals.some(interval=>!interval.ended_at))throw Object.assign(new Error('End the active break or use a supervised attendance correction before archiving this session.'),{statusCode:409,code:'ATTENDANCE_BREAK_PENDING'});
    if (!archived && !row.clock_out) {
      const [[open]] = await connection.query('SELECT id FROM staff_attendance WHERE user_id = ? AND IFNULL(deleted, 0) = 0 AND clock_out IS NULL LIMIT 1', [row.user_id]);
      if (open) { await connection.rollback(); return res.status(409).json({ message: 'Close the active shift before restoring an unfinished shift', code: 'ACTIVE_SHIFT_CONFLICT' }); }
    }
    await connection.query('UPDATE staff_attendance SET deleted = ?, revision=revision+1 WHERE id = ?', [archived ? 1 : 0, id]);
    await require('../services/auditService').logAudit(connection, { actorId: req.user.id, action: archived ? 'ATTENDANCE_ARCHIVED' : 'ATTENDANCE_RESTORED', module: 'Attendance', recordType: 'staff_attendance', recordId: id,
      oldValue: { deleted: row.deleted }, newValue: { deleted: archived ? 1 : 0 }, ipAddress: req.ip, userAgent: req.get?.('user-agent') });
    await connection.commit(); connection.release(); connection = null;
    let timesheetStatus = 'refreshed';
    try { await refreshWeekForDate(row.user_id, row.work_date); } catch (error) { timesheetStatus = 'pending_refresh'; console.error('Archived attendance timesheet refresh pending:', error.code || error.name); }
    return res.json({ message: archived ? 'Attendance archived; its ID and audit history remain available' : 'Attendance restored', attendance_id: id, archived, timesheet_status: timesheetStatus });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if(error.statusCode&&error.statusCode<500)return res.status(error.statusCode).json({message:error.message,code:error.code,fields:error.fields});
    console.error('Attendance archive failed:', error.code || error.name);
    return res.status(500).json({ message: 'Attendance archive state could not be saved' });
  } finally { if (connection) connection.release(); }
}
exports.deleteAttendance = (req, res) => archiveAttendance(req, res, true);
exports.restoreAttendance = (req, res) => archiveAttendance(req, res, false);

/* ================= HELPERS ================= */

async function getWeekAttendance(userId, start, end) {
  const summary=await verifiedAttendance.loadVerifiedSummary({db:pool,userId,fromDate:start,toDate:end});
  return {rows:summary.records,totalHours:summary.actualHours,...verifiedAttendance.diagnostics(summary)};
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
exports.refreshWeekForDate = refreshWeekForDate;

exports._test = { normalizeDateTime };
