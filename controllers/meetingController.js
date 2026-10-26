const pool = require('../config/db');
const { assertOriginalRegisterSchema } = require('../services/originalRegisterSchema');
const { moveToTrash } = require('../services/trashService');
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

function ensureMeetingTable() {
  return assertOriginalRegisterSchema('meetings', pool);
}

function normalizeMeeting(row) {
  return {
    ...row,
    assigned_user_ids: parseIds(row.assigned_user_ids)
  };
}

const MEETING_TYPES = ['internal', 'client', 'council', 'government', 'inspection', 'supplier', 'conference'];
const LOCATION_TYPES = ['site', 'office', 'client_site', 'council_office', 'government_office', 'online', 'conference'];
const MEETING_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled'];

function meetingError(field, message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, fields: { [field]: message } });
}

function meetingId(value, optional = false) {
  if (optional && (value === undefined || value === null || value === '' || value === 0 || value === '0')) return 0;
  if (!['number', 'string'].includes(typeof value)) throw meetingError('id', 'Use a positive integer meeting ID');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw meetingError('id', 'Use a positive integer meeting ID');
  return id;
}

function meetingDate(value, field = 'meeting_date') {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw meetingError(field, 'Enter a valid date in YYYY-MM-DD format');
  return date;
}

function meetingFields(body) {
  const fields = {};
  for (const [field, max] of Object.entries({ title: 255, meeting_type: 80, organisation: 255, contact_person: 255, contact_details: 255, location_type: 80, location_details: 10000, meeting_date: 10, meeting_time: 8, agenda: 10000, required_preparation: 10000 })) {
    const value = body[field] ?? ({ meeting_type: 'internal', location_type: 'site' }[field] || '');
    if (typeof value !== 'string') throw meetingError(field, 'Enter text for this field');
    fields[field] = value.trim();
    if (fields[field].length > max) throw meetingError(field, `Use no more than ${max} characters`);
  }
  if (!fields.title) throw meetingError('title', 'Meeting title is required');
  fields.meeting_date = meetingDate(fields.meeting_date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(fields.meeting_time)) throw meetingError('meeting_time', 'Enter a valid time in HH:MM format');
  if (!MEETING_TYPES.includes(fields.meeting_type)) throw meetingError('meeting_type', 'Choose a supported meeting type');
  if (!LOCATION_TYPES.includes(fields.location_type)) throw meetingError('location_type', 'Choose a supported location type');
  let ids = body.assigned_user_ids;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { throw meetingError('assigned_user_ids', 'Select valid meeting attendees'); } }
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => !['string', 'number'].includes(typeof id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || Number(id) > 2147483647)) throw meetingError('assigned_user_ids', 'Select from 1 to 100 valid meeting attendees');
  fields.assigned_user_ids = parseIds(ids);
  fields.status = String(body.status || 'scheduled').trim().toLowerCase();
  if (!MEETING_STATUSES.includes(fields.status)) throw meetingError('status', 'Choose scheduled, confirmed, completed or cancelled');
  return fields;
}

function meetingListOptions(query) {
  const columns = { date: 'm.meeting_date', title: 'm.title', status: 'm.status', created_at: 'm.created_at', id: 'm.id' };
  const sort = query.sort || 'date', direction = String(query.direction || 'asc').toLowerCase();
  if (!Object.hasOwn(columns, sort)) throw meetingError('sort', 'Choose a supported sort field');
  if (!['asc', 'desc'].includes(direction)) throw meetingError('direction', 'Sort direction must be asc or desc');
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = Number(query.page || 1), limit = Number(query.limit || 50);
  if (paginated && (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger((page - 1) * limit))) throw meetingError('page', 'Use a positive page and a limit from 1 to 200');
  return { order: `${columns[sort]} ${direction.toUpperCase()}, m.meeting_time ASC, m.id DESC`, paginated, page, limit };
}

function meetingFailure(res, error, message) {
  console.error(message, { code: error.code, message: error.message });
  res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) });
}

async function listMeetings(req, res, own) {
  try {
    await ensureMeetingTable();
    const query = req.query || {}, options = meetingListOptions(query), params = [];
    let where = 'm.deleted = 0';
    if (own) {
      const userId = Number(req.user?.id);
      if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(401).json({ message: 'Authentication required' });
      where += " AND m.status IN ('scheduled', 'confirmed') AND m.meeting_date >= ? AND CASE WHEN JSON_VALID(m.assigned_user_ids) THEN JSON_CONTAINS(m.assigned_user_ids, JSON_ARRAY(?)) ELSE 0 END = 1";
      params.push(new Date().toISOString().slice(0, 10), userId);
    }
    const search = String(query.search || '').trim().slice(0, 255);
    if (search) { where += ' AND (m.title LIKE ? OR m.organisation LIKE ? OR m.location_details LIKE ?)'; params.push(...Array(3).fill(`%${search}%`)); }
    if (query.status) {
      if (!MEETING_STATUSES.includes(query.status)) throw meetingError('status', 'Choose a supported meeting status');
      where += ' AND m.status = ?'; params.push(query.status);
    }
    if (query.meeting_type) {
      if (!MEETING_TYPES.includes(query.meeting_type)) throw meetingError('meeting_type', 'Choose a supported meeting type');
      where += ' AND m.meeting_type = ?'; params.push(query.meeting_type);
    }
    if (query.date_from) { where += ' AND m.meeting_date >= ?'; params.push(meetingDate(query.date_from, 'date_from')); }
    if (query.date_to) { where += ' AND m.meeting_date <= ?'; params.push(meetingDate(query.date_to, 'date_to')); }
    if (query.date_from && query.date_to && query.date_from > query.date_to) throw meetingError('date_to', 'End date must be on or after start date');
    const [rows] = await pool.query(`SELECT m.*, creator.name AS created_by_name, updater.name AS updated_by_name
      FROM meetings m LEFT JOIN users creator ON creator.id = m.created_by LEFT JOIN users updater ON updater.id = m.updated_by
      WHERE ${where} ORDER BY ${options.order} ${options.paginated ? 'LIMIT ? OFFSET ?' : ''}`,
      [...params, ...(options.paginated ? [options.limit, (options.page - 1) * options.limit] : [])]);
    let pagination;
    if (options.paginated) {
      const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM meetings m WHERE ${where}`, params);
      pagination = { page: options.page, limit: options.limit, total: Number(count.total), pages: Math.ceil(Number(count.total) / options.limit) };
    }
    res.json({ meetings: rows.map(normalizeMeeting).filter((row) => !own || row.assigned_user_ids.includes(Number(req.user.id))), ...(pagination ? { pagination } : {}) });
  } catch (error) { meetingFailure(res, error, own ? 'Failed to load your meetings' : 'Failed to load meetings'); }
}

exports.listMeetings = (req, res) => listMeetings(req, res, false);
exports.listMyMeetings = (req, res) => listMeetings(req, res, true);

exports.saveMeeting = async (req, res) => {
  let connection;
  try {
    const id = meetingId(req.body.id, true), fields = meetingFields(req.body);
    await ensureMeetingTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let previous = null, recordId = id;
    if (id) {
      const [[existing]] = await connection.query('SELECT * FROM meetings WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!existing) throw meetingError('id', 'Meeting not found', 404);
      previous = existing;
      if (existing.status === 'completed' && fields.status !== 'completed') throw meetingError('status', 'Completed meetings retain their status. Schedule a new meeting for follow-up.', 409);
      if (existing.status === 'cancelled' && !['cancelled', 'scheduled'].includes(fields.status)) throw meetingError('status', 'Reschedule the cancelled meeting before confirming or completing it.', 409);
    }
    const retainedIds = new Set(parseIds(previous?.assigned_user_ids));
    const [attendees] = await connection.query(`SELECT id, active, deleted_at FROM users WHERE id IN (${fields.assigned_user_ids.map(() => '?').join(',')})`, fields.assigned_user_ids);
    const users = new Map(attendees.map((user) => [Number(user.id), user]));
    if (fields.assigned_user_ids.some((userId) => !users.has(userId) || (!retainedIds.has(userId) && (!Number(users.get(userId).active) || users.get(userId).deleted_at)))) throw meetingError('assigned_user_ids', 'New attendees must be active application users');
    const values = Object.values(fields).map((value) => Array.isArray(value) ? JSON.stringify(value) : value);
    if (id) {
      await connection.query(`UPDATE meetings SET title = ?, meeting_type = ?, organisation = ?, contact_person = ?, contact_details = ?,
        location_type = ?, location_details = ?, meeting_date = ?, meeting_time = ?, agenda = ?, required_preparation = ?, assigned_user_ids = ?,
        status = ?, updated_by = ? WHERE id = ? AND deleted = 0`, [...values, req.user.id, id]);
    } else {
      const [result] = await connection.query(`INSERT INTO meetings
        (title, meeting_type, organisation, contact_person, contact_details, location_type, location_details, meeting_date, meeting_time,
        agenda, required_preparation, assigned_user_ids, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, req.user.id, req.user.id]);
      recordId = result.insertId;
    }
    await logAudit(connection, { actorId: req.user.id, action: id ? 'UPDATE' : 'CREATE', module: 'Meetings', recordType: 'meeting', recordId,
      oldValue: previous, newValue: { id: recordId, ...fields }, ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId, sessionId: req.session?.id });
    await connection.commit();
    res.json({ message: id ? 'Meeting updated successfully' : 'Meeting scheduled successfully', meeting_id: recordId });
  } catch (error) { if (connection) await connection.rollback(); meetingFailure(res, error, 'Failed to save meeting'); }
  finally { connection?.release(); }
};

exports.deleteMeeting = async (req, res) => {
  try {
    const id = meetingId(req.body.id || req.params.id);
    await ensureMeetingTable();
    const trash = await moveToTrash({ entityType: 'meeting', entityId: id, actorId: req.user.id,
      reason: req.body.reason || 'Removed from Meetings', req });
    res.json({ message: 'Meeting moved to Trash', ...trash });
  } catch (error) { meetingFailure(res, error, 'Failed to archive meeting'); }
};

exports.ensureMeetingTable = ensureMeetingTable;
