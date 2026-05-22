const pool = require('../config/db');

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartDate() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function weekEndDate() {
  const d = new Date(weekStartDate());
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function weekStartForDate(value) {
  const d = new Date(value);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function weekEndForDate(value) {
  const d = new Date(weekStartForDate(value));
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function normalizeDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.replace('T', ' ').slice(0, 19);
}

function isAdmin(req) {
  return String(req.user?.role || '').trim().toLowerCase() === 'admin';
}

async function ensureAttendanceTables() {
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
  await pool.query(`ALTER TABLE staff_attendance ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN user_id INT NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN week_start DATE NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN week_end DATE NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN total_hours DECIMAL(8,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'open'`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE weekly_timesheets ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`
    UPDATE staff_attendance
    SET work_date = DATE(clock_in)
    WHERE work_date IS NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE staff_attendance
    SET
      total_minutes = CASE
        WHEN clock_out IS NULL THEN total_minutes
        ELSE TIMESTAMPDIFF(MINUTE, clock_in, clock_out)
      END,
      total_hours = CASE
        WHEN clock_out IS NULL THEN total_hours
        ELSE ROUND(TIMESTAMPDIFF(MINUTE, clock_in, clock_out) / 60, 2)
      END
  `).catch(() => {});
}

async function autoClockOutExpiredShifts(userId = null) {
  await ensureAttendanceTables();

  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = 'AND user_id = ?';
    params.push(userId);
  }

  const [expired] = await pool.query(
    `
    SELECT id, user_id
    FROM staff_attendance
    WHERE clock_out IS NULL
    AND TIMESTAMPDIFF(MINUTE, clock_in, NOW()) >= 720
    ${userFilter}
    `,
    params
  );

  if (!expired.length) return [];

  const ids = expired.map((row) => row.id);

  await pool.query(
    `
    UPDATE staff_attendance
    SET
      clock_out = DATE_ADD(clock_in, INTERVAL 12 HOUR),
      total_minutes = 720,
      total_hours = 12,
      notes = TRIM(CONCAT(IFNULL(notes, ''), ' Auto clock-out after 12 hours.'))
    WHERE id IN (?)
    `,
    [ids]
  );

  const affectedUsers = [...new Set(expired.map((row) => row.user_id))];

  for (const affectedUserId of affectedUsers) {
    await refreshCurrentWeekTimesheet(affectedUserId);
  }

  return expired;
}

/* ================= CLOCK IN ================= */

exports.clockIn = async (req, res) => {
  try {
    await ensureAttendanceTables();

    const userId = Number(req.user?.id);
    const workDate = todayDate();

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    const autoClosed = await autoClockOutExpiredShifts(userId);

    const [open] = await pool.query(
      `
      SELECT id, clock_in
      FROM staff_attendance
      WHERE user_id = ?
      AND clock_out IS NULL
      LIMIT 1
      `,
      [userId]
    );

    if (open.length) {
      return res.status(400).json({
        message: 'You are already clocked in'
      });
    }

    const [result] = await pool.query(
      `
      INSERT INTO staff_attendance
      (user_id, clock_in, work_date, total_minutes, total_hours)
      VALUES (?, NOW(), ?, 0, 0)
      `,
      [userId, workDate]
    );

    res.json({
      message: autoClosed.length
        ? 'Previous shift was auto clocked-out after 12 hours. New shift started successfully.'
        : 'Clocked in successfully',
      attendance_id: result.insertId
    });
  } catch (err) {
    console.error('CLOCK IN ERROR FULL:', err);
    res.status(500).json({
      message: 'Clock in failed',
      error: err.message
    });
  }
};

/* ================= CLOCK OUT ================= */

exports.clockOut = async (req, res) => {
  try {
    await ensureAttendanceTables();

    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    const autoClosed = await autoClockOutExpiredShifts(userId);

    if (autoClosed.length) {
      return res.json({
        message: 'Your shift was already auto clocked-out after 12 hours.',
        auto_clocked_out: true
      });
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM staff_attendance
      WHERE user_id = ?
      AND clock_out IS NULL
      ORDER BY clock_in DESC
      LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(400).json({
        message: 'No active clock-in found'
      });
    }

    const attendance = rows[0];

    await pool.query(
      `
      UPDATE staff_attendance
      SET
        clock_out = NOW(),
        total_minutes = TIMESTAMPDIFF(MINUTE, clock_in, NOW()),
        total_hours = ROUND(TIMESTAMPDIFF(MINUTE, clock_in, NOW()) / 60, 2)
      WHERE id = ?
      `,
      [attendance.id]
    );

    const [[updated]] = await pool.query(
      `
      SELECT *
      FROM staff_attendance
      WHERE id = ?
      LIMIT 1
      `,
      [attendance.id]
    );

    await refreshCurrentWeekTimesheet(userId);

    res.json({
      message: 'Clocked out successfully',
      attendance: updated
    });
  } catch (err) {
    console.error('CLOCK OUT ERROR FULL:', err);
    res.status(500).json({
      message: 'Clock out failed',
      error: err.message
    });
  }
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

    await autoClockOutExpiredShifts(userId);

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
        created_at
      FROM staff_attendance
      WHERE user_id = ?
      AND work_date = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId, workDate]
    );

    res.json({
      attendance: rows[0] || null
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

    await autoClockOutExpiredShifts(userId);

    const start = weekStartDate();
    const end = weekEndDate();

    const data = await getWeekAttendance(userId, start, end);

    await upsertWeeklyTimesheet(userId, start, end, data.totalHours);

    res.json({
      week_start: start,
      week_end: end,
      total_hours: data.totalHours,
      attendance: data.rows
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

    await autoClockOutExpiredShifts(userId);

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
        created_at
      FROM staff_attendance
      WHERE user_id = ?
      ORDER BY work_date DESC, clock_in DESC
      `,
      [userId]
    );

    res.json({
      attendance: rows
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

    await autoClockOutExpiredShifts();

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
        a.created_at
      FROM staff_attendance a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.work_date DESC, a.clock_in DESC
      `
    );

    res.json({
      attendance: rows
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
      ORDER BY wt.week_start DESC, u.name ASC
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

    await autoClockOutExpiredShifts(userId);

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
        ROUND(SUM(IFNULL(a.total_hours, 0)), 2) AS total_hours,
        MIN(a.work_date) AS first_shift,
        MAX(a.work_date) AS last_shift
      FROM staff_attendance a
      WHERE a.user_id = ?
      GROUP BY period_start, period_end
      ORDER BY period_start DESC
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
      WHERE a.user_id = ?
      ORDER BY a.work_date DESC, a.clock_in DESC
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
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const id = Number(req.body.id || 0);
    const userId = Number(req.body.user_id);
    const clockIn = normalizeDateTime(req.body.clock_in);
    const clockOut = normalizeDateTime(req.body.clock_out);
    const notes = String(req.body.notes || '').trim();

    if (!userId || !clockIn) {
      return res.status(400).json({ message: 'Staff and clock-in time are required' });
    }

    if (clockOut && new Date(clockOut) < new Date(clockIn)) {
      return res.status(400).json({ message: 'Clock-out cannot be before clock-in' });
    }

    const workDate = clockIn.slice(0, 10);

    if (id) {
      const [[existing]] = await pool.query(
        'SELECT user_id, work_date FROM staff_attendance WHERE id = ? LIMIT 1',
        [id]
      );

      if (!existing) {
        return res.status(404).json({ message: 'Attendance record not found' });
      }

      await pool.query(
        `
        UPDATE staff_attendance
        SET
          user_id = ?,
          clock_in = ?,
          clock_out = ?,
          work_date = ?,
          total_minutes = CASE WHEN ? IS NULL THEN 0 ELSE TIMESTAMPDIFF(MINUTE, ?, ?) END,
          total_hours = CASE WHEN ? IS NULL THEN 0 ELSE ROUND(TIMESTAMPDIFF(MINUTE, ?, ?) / 60, 2) END,
          notes = ?
        WHERE id = ?
        `,
        [
          userId,
          clockIn,
          clockOut,
          workDate,
          clockOut,
          clockIn,
          clockOut,
          clockOut,
          clockIn,
          clockOut,
          notes,
          id
        ]
      );

      await refreshWeekForDate(existing.user_id, existing.work_date);
      await refreshWeekForDate(userId, workDate);

      return res.json({ message: 'Attendance record updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO staff_attendance
      (user_id, clock_in, clock_out, work_date, total_minutes, total_hours, notes)
      VALUES (
        ?, ?, ?, ?,
        CASE WHEN ? IS NULL THEN 0 ELSE TIMESTAMPDIFF(MINUTE, ?, ?) END,
        CASE WHEN ? IS NULL THEN 0 ELSE ROUND(TIMESTAMPDIFF(MINUTE, ?, ?) / 60, 2) END,
        ?
      )
      `,
      [
        userId,
        clockIn,
        clockOut,
        workDate,
        clockOut,
        clockIn,
        clockOut,
        clockOut,
        clockIn,
        clockOut,
        notes || 'Added by admin'
      ]
    );

    await refreshWeekForDate(userId, workDate);

    res.json({
      message: 'Attendance record added successfully',
      attendance_id: result.insertId
    });
  } catch (err) {
    console.error('SAVE ATTENDANCE ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to save attendance',
      error: err.message
    });
  }
};

exports.deleteAttendance = async (req, res) => {
  try {
    await ensureAttendanceTables();

    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const id = Number(req.body.id);

    if (!id) {
      return res.status(400).json({ message: 'Attendance ID is required' });
    }

    const [[existing]] = await pool.query(
      'SELECT user_id, work_date FROM staff_attendance WHERE id = ? LIMIT 1',
      [id]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    await pool.query('DELETE FROM staff_attendance WHERE id = ?', [id]);
    await refreshWeekForDate(existing.user_id, existing.work_date);

    res.json({ message: 'Attendance record deleted successfully' });
  } catch (err) {
    console.error('DELETE ATTENDANCE ERROR FULL:', err);
    res.status(500).json({
      message: 'Failed to delete attendance',
      error: err.message
    });
  }
};

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
      created_at
    FROM staff_attendance
    WHERE user_id = ?
    AND work_date BETWEEN ? AND ?
    ORDER BY work_date ASC, clock_in ASC
    `,
    [userId, start, end]
  );

  const totalHours = rows.reduce(
    (sum, row) => sum + Number(row.total_hours || 0),
    0
  );

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
    SELECT id
    FROM weekly_timesheets
    WHERE user_id = ?
    AND week_start = ?
    AND week_end = ?
    LIMIT 1
    `,
    [userId, weekStart, weekEnd]
  );

  if (existing.length) {
    await pool.query(
      `
      UPDATE weekly_timesheets
      SET total_hours = ?
      WHERE id = ?
      `,
      [totalHours, existing[0].id]
    );
    return;
  }

  await pool.query(
    `
    INSERT INTO weekly_timesheets
    (user_id, week_start, week_end, total_hours, status)
    VALUES (?, ?, ?, ?, ?)
    `,
    [userId, weekStart, weekEnd, totalHours, 'open']
  );
}
