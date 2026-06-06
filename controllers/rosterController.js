const pool = require('../config/db');

function parseIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function ensureRosterTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roster_shifts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      shift_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      role_label VARCHAR(120) NULL,
      location VARCHAR(180) NULL,
      notes TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'scheduled',
      created_by INT NULL,
      updated_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_roster_user_date (user_id, shift_date),
      INDEX idx_roster_date (shift_date),
      INDEX idx_roster_deleted (deleted)
    )
  `);
}

exports.listRoster = async (req, res) => {
  try {
    await ensureRosterTable();

    const [rows] = await pool.query(`
      SELECT
        r.*,
        u.name AS staff_name,
        u.email AS staff_email,
        creator.name AS created_by_name,
        updater.name AS updated_by_name
      FROM roster_shifts r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN users creator ON creator.id = r.created_by
      LEFT JOIN users updater ON updater.id = r.updated_by
      WHERE r.deleted = 0
      ORDER BY r.shift_date ASC, r.start_time ASC, r.id ASC
    `);

    res.json({ roster: rows });
  } catch (err) {
    console.error('LIST ROSTER ERROR:', err);
    res.status(500).json({ message: 'Failed to load roster', error: err.message });
  }
};

exports.listMyRoster = async (req, res) => {
  try {
    await ensureRosterTable();

    const userId = Number(req.user?.id);
    const today = new Date().toISOString().slice(0, 10);

    const [rows] = await pool.query(`
      SELECT
        r.*,
        u.name AS staff_name,
        u.email AS staff_email
      FROM roster_shifts r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.deleted = 0
      AND r.user_id = ?
      AND r.shift_date >= ?
      ORDER BY r.shift_date ASC, r.start_time ASC, r.id ASC
    `, [userId, today]);

    res.json({ roster: rows });
  } catch (err) {
    console.error('LIST MY ROSTER ERROR:', err);
    res.status(500).json({ message: 'Failed to load your roster', error: err.message });
  }
};

exports.saveShift = async (req, res) => {
  try {
    await ensureRosterTable();

    const id = Number(req.body.id || 0);
    const userId = Number(req.body.user_id || 0);
    const shiftDate = String(req.body.shift_date || '').slice(0, 10);
    const startTime = String(req.body.start_time || '').slice(0, 5);
    const endTime = String(req.body.end_time || '').slice(0, 5);
    const roleLabel = String(req.body.role_label || '').trim();
    const location = String(req.body.location || '').trim();
    const notes = String(req.body.notes || '').trim();
    const status = String(req.body.status || 'scheduled').trim();
    const actorId = Number(req.user?.id || 0) || null;

    if (!userId || !shiftDate || !startTime || !endTime) {
      return res.status(400).json({ message: 'Staff, date, start time and end time are required' });
    }

    if (id) {
      await pool.query(`
        UPDATE roster_shifts
        SET user_id = ?,
            shift_date = ?,
            start_time = ?,
            end_time = ?,
            role_label = ?,
            location = ?,
            notes = ?,
            status = ?,
            updated_by = ?
        WHERE id = ? AND deleted = 0
      `, [userId, shiftDate, startTime, endTime, roleLabel, location, notes, status, actorId, id]);
      return res.json({ message: 'Roster shift updated' });
    }

    await pool.query(`
      INSERT INTO roster_shifts
        (user_id, shift_date, start_time, end_time, role_label, location, notes, status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, shiftDate, startTime, endTime, roleLabel, location, notes, status, actorId, actorId]);

    res.status(201).json({ message: 'Roster shift created' });
  } catch (err) {
    console.error('SAVE ROSTER SHIFT ERROR:', err);
    res.status(500).json({ message: 'Failed to save roster shift', error: err.message });
  }
};

exports.generateRoster = async (req, res) => {
  try {
    await ensureRosterTable();

    const userIds = parseIds(req.body.user_ids);
    const fromDate = String(req.body.from_date || '').slice(0, 10);
    const toDate = String(req.body.to_date || '').slice(0, 10);
    const startTime = String(req.body.start_time || '08:00').slice(0, 5);
    const endTime = String(req.body.end_time || '16:00').slice(0, 5);
    const roleLabel = String(req.body.role_label || 'Production').trim();
    const location = String(req.body.location || 'Voxel Veda Workshop').trim();
    const notes = String(req.body.notes || '').trim();
    const actorId = Number(req.user?.id || 0) || null;

    if (!userIds.length || !fromDate || !toDate) {
      return res.status(400).json({ message: 'Select staff and date range to generate roster' });
    }

    if (toDate < fromDate) {
      return res.status(400).json({ message: 'Roster end date must be after the start date' });
    }

    const days = [];
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      days.push(date);
      if (days.length > 45) break;
    }

    let created = 0;
    for (const date of days) {
      for (const userId of userIds) {
        await pool.query(`
          INSERT INTO roster_shifts
            (user_id, shift_date, start_time, end_time, role_label, location, notes, status, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
        `, [userId, date, startTime, endTime, roleLabel, location, notes, actorId, actorId]);
        created += 1;
      }
    }

    res.status(201).json({ message: `Generated ${created} roster shifts`, created });
  } catch (err) {
    console.error('GENERATE ROSTER ERROR:', err);
    res.status(500).json({ message: 'Failed to generate roster', error: err.message });
  }
};

exports.deleteShift = async (req, res) => {
  try {
    await ensureRosterTable();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Roster shift id is required' });

    await pool.query('UPDATE roster_shifts SET deleted = 1, updated_by = ? WHERE id = ?', [
      Number(req.user?.id || 0) || null,
      id
    ]);

    res.json({ message: 'Roster shift deleted' });
  } catch (err) {
    console.error('DELETE ROSTER ERROR:', err);
    res.status(500).json({ message: 'Failed to delete roster shift', error: err.message });
  }
};
