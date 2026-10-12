const pool = require('../config/db');
const { logAudit } = require('../services/auditService');

function parseIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))] : [];
  } catch {
    return [];
  }
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let originalSchemaPromise;
function ensureRosterTable() {
  if (!originalSchemaPromise) originalSchemaPromise = createRosterTableStructures().catch((error) => { originalSchemaPromise = null; throw error; });
  return originalSchemaPromise;
}

async function createRosterTableStructures() {
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
      break_minutes INT NOT NULL DEFAULT 0,
      hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      wage_budget DECIMAL(12,2) NOT NULL DEFAULT 0,
      published_at DATETIME NULL,
      published_by INT NULL,
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

  for (const sql of [
    'ALTER TABLE roster_shifts ADD COLUMN break_minutes INT NOT NULL DEFAULT 0',
    'ALTER TABLE roster_shifts ADD COLUMN hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE roster_shifts ADD COLUMN wage_budget DECIMAL(12,2) NOT NULL DEFAULT 0',
    'ALTER TABLE roster_shifts ADD COLUMN published_at DATETIME NULL',
    'ALTER TABLE roster_shifts ADD COLUMN published_by INT NULL'
  ]) {
    try { await pool.query(sql); } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
}

function rosterError(field, message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, fields: { [field]: message } });
}

function rosterId(value, field = 'id', optional = false) {
  if (optional && (value === undefined || value === null || value === '' || value === 0 || value === '0')) return 0;
  if (!['number', 'string'].includes(typeof value)) throw rosterError(field, 'Use a positive integer ID');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw rosterError(field, 'Use a positive integer ID');
  return id;
}

function rosterDate(value, field) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw rosterError(field, 'Enter a valid date in YYYY-MM-DD format');
  return date;
}

function rosterFields(body) {
  const fields = {};
  for (const field of ['start_time', 'end_time']) {
    const value = String(body[field] || '');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) throw rosterError(field, 'Enter a valid time in HH:MM format');
    fields[field] = value.slice(0, 5);
  }
  if (fields.start_time === fields.end_time) throw rosterError('end_time', 'Start and end times must differ');
  for (const [field, max] of Object.entries({ role_label: 120, location: 180, notes: 10000 })) {
    const value = body[field] ?? '';
    if (typeof value !== 'string') throw rosterError(field, 'Enter text for this field');
    fields[field] = value.trim();
    if (fields[field].length > max) throw rosterError(field, `Use no more than ${max} characters`);
  }
  fields.status = String(body.status || 'scheduled').toLowerCase();
  if (!['scheduled', 'published', 'confirmed', 'completed', 'cancelled'].includes(fields.status)) throw rosterError('status', 'Choose a supported roster status');
  fields.break_minutes = Number(body.break_minutes ?? 0);
  fields.hourly_rate = Number(body.hourly_rate ?? 0);
  fields.wage_budget = Number(body.wage_budget ?? 0);
  if ((body.break_minutes !== undefined && body.break_minutes !== null && !['number', 'string'].includes(typeof body.break_minutes)) || !Number.isSafeInteger(fields.break_minutes) || fields.break_minutes < 0) throw rosterError('break_minutes', 'Enter a non-negative whole number of minutes');
  const minuteOfDay = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const duration = (minuteOfDay(fields.end_time) - minuteOfDay(fields.start_time) + 1440) % 1440;
  if (fields.break_minutes >= duration) throw rosterError('break_minutes', 'Break must be shorter than the shift');
  for (const field of ['hourly_rate', 'wage_budget']) {
    const value = fields[field], max = field === 'hourly_rate' ? 99999999.99 : 9999999999.99;
    if ((body[field] !== undefined && body[field] !== null && !['number', 'string'].includes(typeof body[field])) || !Number.isFinite(value) || value < 0 || value > max || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw rosterError(field, 'Enter a non-negative amount with at most two decimal places');
  }
  return fields;
}

function rosterFailure(res, error, message) {
  console.error(message, { code: error.code, message: error.message });
  return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : message, ...(error.fields ? { fields: error.fields } : {}) });
}

function rosterAudit(connection, req, action, id, oldValue, newValue) {
  return logAudit(connection, { actorId: req.user.id, action, module: 'Roster', recordType: 'roster_shift', recordId: id, oldValue, newValue,
    ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId, sessionId: req.session?.id });
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
  let connection;
  try {
    const id = rosterId(req.body.id, 'id', true), userId = rosterId(req.body.user_id, 'user_id');
    const shiftDate = rosterDate(req.body.shift_date, 'shift_date'), fields = rosterFields(req.body);
    await ensureRosterTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[user]] = await connection.query('SELECT id, active, deleted_at FROM users WHERE id = ? FOR UPDATE', [userId]);
    let previous = null, recordId = id;
    if (id) {
      const [[existing]] = await connection.query('SELECT * FROM roster_shifts WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!existing) throw rosterError('id', 'Roster shift not found', 404);
      previous = existing;
    }
    if (!user || ((Number(previous?.user_id) !== userId) && (!Number(user.active) || user.deleted_at))) throw rosterError('user_id', 'Select an active application user');
    const [[duplicate]] = await connection.query(`SELECT id FROM roster_shifts WHERE user_id = ? AND shift_date = ?
      AND start_time = ? AND end_time = ? AND deleted = 0 AND id <> ? LIMIT 1`, [userId, shiftDate, fields.start_time, fields.end_time, id]);
    if (duplicate) throw rosterError('shift_date', `An identical shift already exists for this staff member (shift ${duplicate.id})`, 409);
    const values = [userId, shiftDate, ...Object.values(fields)];
    if (id) {
      await connection.query(`UPDATE roster_shifts SET user_id = ?, shift_date = ?, start_time = ?, end_time = ?, role_label = ?,
        location = ?, notes = ?, status = ?, break_minutes = ?, hourly_rate = ?, wage_budget = ?, updated_by = ? WHERE id = ? AND deleted = 0`,
        [...values, req.user.id, id]);
    } else {
      const [result] = await connection.query(`INSERT INTO roster_shifts
        (user_id, shift_date, start_time, end_time, role_label, location, notes, status, break_minutes, hourly_rate, wage_budget, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, req.user.id, req.user.id]);
      recordId = result.insertId;
    }
    await rosterAudit(connection, req, id ? 'UPDATE' : 'CREATE', recordId, previous, { id: recordId, user_id: userId, shift_date: shiftDate, ...fields });
    await connection.commit();
    res.status(id ? 200 : 201).json({ message: id ? 'Roster shift updated' : 'Roster shift created', shift_id: recordId });
  } catch (error) { if (connection) await connection.rollback(); rosterFailure(res, error, 'Failed to save roster shift'); }
  finally { connection?.release(); }
};

exports.generateRoster = async (req, res) => {
  let connection;
  try {
    let selectedIds = req.body.user_ids;
    if (typeof selectedIds === 'string') { try { selectedIds = JSON.parse(selectedIds); } catch { throw rosterError('user_ids', 'Select valid staff IDs'); } }
    if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 100) throw rosterError('user_ids', 'Select from 1 to 100 staff members');
    for (const id of selectedIds) rosterId(id, 'user_ids');
    const userIds = parseIds(selectedIds).sort((a, b) => a - b);
    const fromDate = rosterDate(req.body.from_date, 'from_date'), toDate = rosterDate(req.body.to_date, 'to_date');
    if (toDate < fromDate) throw rosterError('to_date', 'Roster end date must be on or after the start date');
    const dayCount = Math.round((Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / 86400000) + 1;
    if (dayCount > 45) throw rosterError('to_date', 'Generate at most 45 days at a time. No shifts were created.');
    const fields = rosterFields({ ...req.body, start_time: req.body.start_time || '08:00', end_time: req.body.end_time || '16:00', status: 'scheduled' });
    const days = Array.from({ length: dayCount }, (_, day) => addDays(fromDate, day));
    await ensureRosterTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // Lock staff in a consistent order: save and generation use the same row lock,
    // so repeated/concurrent batches cannot race their duplicate checks.
    const [users] = await connection.query(`SELECT id, active, deleted_at FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) ORDER BY id ASC FOR UPDATE`, userIds);
    const activeUsers = new Set(users.filter((user) => Number(user.active) && !user.deleted_at).map((user) => Number(user.id)));
    const [existing] = await connection.query(`SELECT id, user_id, shift_date, start_time, end_time FROM roster_shifts
      WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND shift_date BETWEEN ? AND ? AND deleted = 0`, [...userIds, fromDate, toDate]);
    const dateText = (date) => date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
    const key = (userId, date) => `${userId}:${date}`;
    const duplicates = new Set(existing.filter((row) => String(row.start_time).slice(0, 5) === fields.start_time && String(row.end_time).slice(0, 5) === fields.end_time).map((row) => key(row.user_id, dateText(row.shift_date))));
    const outcomes = [], createdIds = [];
    let skipped = 0, rejected = 0;
    for (const date of days) {
      for (const userId of userIds) {
        if (!activeUsers.has(userId)) { rejected += 1; outcomes.push({ user_id: userId, shift_date: date, status: 'rejected', reason: 'Staff member is inactive or missing' }); continue; }
        if (duplicates.has(key(userId, date))) { skipped += 1; outcomes.push({ user_id: userId, shift_date: date, status: 'duplicate', reason: 'Identical active shift already exists' }); continue; }
        const [result] = await connection.query(`INSERT INTO roster_shifts
          (user_id, shift_date, start_time, end_time, role_label, location, notes, status, break_minutes, hourly_rate, wage_budget, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [userId, date, ...Object.values(fields), req.user.id, req.user.id]);
        createdIds.push(result.insertId); duplicates.add(key(userId, date));
        outcomes.push({ user_id: userId, shift_date: date, status: 'accepted', shift_id: result.insertId });
      }
    }
    const created = createdIds.length;
    if (created) await rosterAudit(connection, req, 'GENERATE', createdIds[0], null, { from_date: fromDate, to_date: toDate, user_ids: userIds, shift_ids: createdIds,
      shift_fields: fields, created, skipped, rejected });
    await connection.commit();
    res.status(created ? 201 : 200).json({ message: `Generated ${created} roster shifts; ${skipped} duplicates skipped; ${rejected} rejected`, created, accepted: created, skipped, duplicates: skipped,
      rejected, total: days.length * userIds.length, outcomes });
  } catch (error) { if (connection) await connection.rollback(); rosterFailure(res, error, 'Failed to generate roster. No shifts from this batch were saved.'); }
  finally { connection?.release(); }
};

exports.deleteShift = async (req, res) => {
  let connection;
  try {
    const id = rosterId(req.body.id);
    await ensureRosterTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[shift]] = await connection.query('SELECT * FROM roster_shifts WHERE id = ? FOR UPDATE', [id]);
    if (!shift) throw rosterError('id', 'Roster shift not found', 404);
    if (!Number(shift.deleted)) {
      await connection.query('UPDATE roster_shifts SET deleted = 1, updated_by = ? WHERE id = ?', [req.user.id, id]);
      await rosterAudit(connection, req, 'ARCHIVE', id, shift, { ...shift, deleted: 1, updated_by: req.user.id });
    }
    await connection.commit();
    res.json({ message: 'Roster shift archived', shift_id: id });
  } catch (error) { if (connection) await connection.rollback(); rosterFailure(res, error, 'Failed to archive roster shift'); }
  finally { connection?.release(); }
};

exports.restoreShift = async (req, res) => {
  let connection;
  try {
    const id = rosterId(req.body.id);
    await ensureRosterTable();
    const [[snapshot]] = await pool.query('SELECT user_id FROM roster_shifts WHERE id = ?', [id]);
    if (!snapshot) throw rosterError('id', 'Roster shift not found', 404);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[user]] = await connection.query('SELECT id, active, deleted_at FROM users WHERE id = ? FOR UPDATE', [snapshot.user_id]);
    const [[shift]] = await connection.query('SELECT * FROM roster_shifts WHERE id = ? FOR UPDATE', [id]);
    if (!shift) throw rosterError('id', 'Roster shift not found', 404);
    if (Number(shift.user_id) !== Number(snapshot.user_id)) throw rosterError('id', 'Shift assignment changed. Refresh and retry.', 409);
    if (!user || !Number(user.active) || user.deleted_at) throw rosterError('user_id', 'Restore or reassign this staff account before restoring its shift.', 409);
    if (Number(shift.deleted)) {
      const [[duplicate]] = await connection.query(`SELECT id FROM roster_shifts WHERE user_id = ? AND shift_date = ?
        AND start_time = ? AND end_time = ? AND deleted = 0 AND id <> ? LIMIT 1`, [shift.user_id, shift.shift_date, shift.start_time, shift.end_time, id]);
      if (duplicate) throw rosterError('shift_date', 'An identical active shift already exists. Archive it before restoring this shift.', 409);
      await connection.query('UPDATE roster_shifts SET deleted = 0, updated_by = ? WHERE id = ?', [req.user.id, id]);
      await rosterAudit(connection, req, 'RESTORE', id, shift, { ...shift, deleted: 0, updated_by: req.user.id });
    }
    await connection.commit();
    res.json({ message: 'Roster shift restored', shift_id: id });
  } catch (error) { if (connection) await connection.rollback(); rosterFailure(res, error, 'Failed to restore roster shift'); }
  finally { connection?.release(); }
};

exports.publishRoster = async (req, res) => {
  let connection;
  try {
    await ensureRosterTable();
    const { dateOnly } = require('../utils/dateOnly');
    const fromDate = req.body.from_date ? dateOnly(req.body.from_date) : '';
    const toDate = req.body.to_date ? dateOnly(req.body.to_date) : '';
    if ((req.body.from_date && !fromDate) || (req.body.to_date && !toDate) || (fromDate && toDate && toDate < fromDate)) {
      return res.status(400).json({ message: 'Choose a valid roster date range.', fields: { from_date: 'Use a valid date range', to_date: 'Use a valid date range' } });
    }
    const actorId = Number(req.user.id), params = [];
    let where = "r.deleted = 0 AND r.status IN ('scheduled','published')";
    if (fromDate) { where += ' AND r.shift_date >= ?'; params.push(fromDate); }
    if (toDate) { where += ' AND r.shift_date <= ?'; params.push(toDate); }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT r.*, u.email AS staff_email FROM roster_shifts r
      JOIN users u ON u.id = r.user_id WHERE ${where} AND u.active = 1 AND u.deleted_at IS NULL
      ORDER BY r.user_id, r.shift_date, r.start_time, r.id FOR UPDATE`, params);
    if (!rows.length) { await connection.rollback(); return res.status(400).json({ message: 'No active roster shifts are available for this range.' }); }
    const ids = rows.map((row) => row.id);
    await connection.query(`UPDATE roster_shifts SET status = 'published', published_at = COALESCE(published_at, NOW()), published_by = ?
      WHERE id IN (${ids.map(() => '?').join(',')})`, [actorId, ...ids]);
    await require('../services/auditService').logAudit(connection, {
      actorId, action: 'ROSTER_PUBLISHED', module: 'Roster', recordType: 'roster_publication', recordId: rows[0].id,
      oldValue: { unpublished_ids: rows.filter((row) => row.status === 'scheduled').map((row) => row.id) },
      newValue: { shift_ids: ids, from_date: fromDate || null, to_date: toDate || null }
    });
    await connection.commit();
    connection.release(); connection = null;
    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }
    const outcomes = [];
    for (const [userId, shifts] of byUser) {
      const address = shifts[0].staff_email;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(address || ''))) { outcomes.push({ user_id: userId, status: 'NO_VALID_ADDRESS' }); continue; }
      const content = shifts.map((shift) => [shift.id, dateOnly(shift.shift_date), String(shift.start_time), String(shift.end_time), shift.role_label, shift.location, shift.notes]);
      const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(content)).digest('hex');
      const actionUrl = require('../config/urls').absolute('/dashboard?view=roster');
      try {
        const queueId = await require('../services/emailQueue').queueEmail({
          to: address, subject: 'Your Voxel Veda roster is available',
          html: `<p>Your roster is available in Voxel Veda.</p><p><a href="${actionUrl}">View your roster</a></p>`,
          text: `Your roster is available in Voxel Veda: ${actionUrl}`,
          relatedModule: 'roster', relatedRecordId: shifts[0].id, createdBy: actorId,
          idempotencyKey: `roster:${userId}:${hash}`
        });
        outcomes.push({ user_id: userId, status: 'QUEUED', queue_id: queueId });
      } catch (error) {
        outcomes.push({ user_id: userId, status: 'QUEUE_FAILED', retryable: true });
        console.error('Roster notification queue failed:', error.code || error.name);
      }
    }
    const queued = outcomes.filter((outcome) => outcome.status === 'QUEUED').length;
    const failed = outcomes.filter((outcome) => outcome.status === 'QUEUE_FAILED').length;
    return res.json({ message: `Published ${rows.length} shifts; ${queued} individual notifications queued${failed ? `, ${failed} require retry` : ''}.`,
      published: rows.length, email_status: failed ? 'pending_retry' : queued ? 'queued' : 'skipped', notification_outcomes: outcomes,
      provider_accepted: false, recipient_verified: false });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Roster publication failed:', error.code || error.name);
    return res.status(500).json({ message: 'Roster publication failed. Refresh the roster before retrying.', code: 'ROSTER_PUBLICATION_FAILED' });
  } finally { if (connection) connection.release(); }
};

exports.ensureRosterTable = ensureRosterTable;
