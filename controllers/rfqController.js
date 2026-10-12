'use strict';
const crypto = require('node:crypto');
const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const { hasPermission } = require('../services/authorizationService');
const { ensureRfqSchema } = require('../services/rfqSchema');

const STATUSES = new Set(['pending', 'approved', 'quoted', 'rejected', 'closed']);
const CLIENT_ROLES = new Set(['client', 'customer', 'viewer', 'view_only']);
class RfqError extends Error {
  constructor(message, status = 400, fields = null, code = 'RFQ_VALIDATION_ERROR') { super(message); Object.assign(this, { status, fields, code }); }
}
function text(value, max, field, required = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max) throw new RfqError(`${field} ${!result ? 'is required' : `must have at most ${max} characters`}`, 400, { [field]: !result ? 'Required' : `Maximum ${max} characters` });
  return result;
}
function input(body) {
  const customer_name = text(body.customer_name, 255, 'customer_name', true);
  const email = text(body.email, 255, 'email', true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RfqError('Enter a valid email address', 400, { email: 'Enter a valid email address' });
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001) throw new RfqError('Quantity must be positive with at most three decimal places', 400, { quantity: 'Enter a quantity between 0.001 and 1,000,000' });
  return { customer_name, email, phone: text(body.phone, 80, 'phone'), material: text(body.material, 255, 'material'), quantity, application: text(body.application, 10000, 'application') };
}
function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RfqError('A valid RFQ ID is required', 400, { rfq_id: 'Select a valid RFQ' });
  return number;
}
function scope(req) {
  if (!CLIENT_ROLES.has(String(req.user?.role || '').toLowerCase())) return { sql: '', params: [] };
  if (!req.user?.email) throw new RfqError('RFQ not found', 404, null, 'RFQ_NOT_FOUND');
  return { sql: ' AND LOWER(email) = ?', params: [String(req.user.email).toLowerCase()] };
}
function error(res, err) {
  if (err instanceof RfqError) return res.status(err.status).json({ message: err.message, code: err.code, fields: err.fields || undefined });
  console.error('RFQ operation failed:', err.code || err.name);
  return res.status(500).json({ message: 'RFQ operation failed. Retry your request.', code: 'RFQ_OPERATION_FAILED' });
}
function audit(db, req, action, recordId, oldValue, newValue) {
  return logAudit(db, { actorId: req.user?.id || null, module: 'RFQ', recordType: 'rfq', recordId, action, oldValue, newValue, ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.id || req.headers?.['x-request-id'] });
}
async function transaction(work) {
  await ensureRfqSchema();
  const db = await pool.getConnection();
  try { await db.beginTransaction(); const result = await work(db); await db.commit(); return result; }
  catch (err) { await db.rollback().catch(() => {}); throw err; }
  finally { db.release(); }
}
async function record(db, req, recordId, archived = false) {
  const isolation = scope(req);
  const [[row]] = await db.query(`SELECT * FROM rfqs WHERE id = ? AND archived = ?${isolation.sql} FOR UPDATE`, [recordId, archived ? 1 : 0, ...isolation.params]);
  if (!row) throw new RfqError('RFQ not found', 404, null, 'RFQ_NOT_FOUND');
  return row;
}
function requestIdentity(req, data) {
  const key = String(req.get?.('Idempotency-Key') || '').trim();
  if (key && !/^[A-Za-z0-9._:-]{8,120}$/.test(key)) throw new RfqError('Idempotency key must contain 8 to 120 safe characters');
  return {
    key: key ? crypto.createHash('sha256').update(`${req.user?.id || 'public'}:${key}`).digest('hex') : null,
    hash: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
  };
}
exports.getRFQs = async (req, res) => {
  try {
    await ensureRfqSchema();
    const isolation = scope(req), params = [req.query.archived === 'true' ? 1 : 0, ...isolation.params];
    let where = `WHERE archived = ?${isolation.sql}`;
    if (req.query.status) {
      const status = String(req.query.status).toLowerCase();
      if (!STATUSES.has(status)) throw new RfqError('Select a valid status', 400, { status: 'Invalid status' });
      where += ' AND LOWER(status) = ?'; params.push(status);
    }
    if (req.query.q) {
      const q = `%${text(req.query.q, 200, 'q').replace(/[\\%_]/g, '\\$&')}%`;
      where += ' AND (customer_name LIKE ? OR email LIKE ? OR material LIKE ? OR CAST(id AS CHAR) LIKE ?)'; params.push(q, q, q, q);
    }
    const sortColumns = { id: 'id', customer: 'customer_name', status: 'status', created: 'created_at', quantity: 'quantity' };
    const sort = Object.hasOwn(sortColumns, req.query.sort) ? sortColumns[req.query.sort] : 'id';
    const direction = req.query.direction === 'desc' ? 'DESC' : 'ASC';
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = req.query.page || req.query.limit ? Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 25))) : 2000;
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM rfqs ${where}`, params);
    const [rows] = await pool.query(`SELECT * FROM rfqs ${where} ORDER BY ${sort} ${direction}, id ${direction} LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    return res.json({ rfqs: rows, total: Number(count.total), page, limit, pages: Math.ceil(Number(count.total) / limit) });
  } catch (err) { return error(res, err); }
};
exports.createRFQ = async (req, res) => {
  let identity;
  try {
    const data = input(req.body), client = scope(req);
    if (client.params.length && data.email !== client.params[0]) throw new RfqError('Use your account email address', 403, { email: 'Use your account email' });
    identity = requestIdentity(req, data);
    const result = await transaction(async (db) => {
      if (identity.key) {
        const [[existing]] = await db.query('SELECT id, request_hash FROM rfqs WHERE request_key = ? FOR UPDATE', [identity.key]);
        if (existing) {
          if (existing.request_hash !== identity.hash) throw new RfqError('This retry key was already used for different RFQ data', 409, null, 'IDEMPOTENCY_CONFLICT');
          return { rfq_id: existing.id, duplicate: true };
        }
      }
      const [insert] = await db.query(`INSERT INTO rfqs (customer_name, email, phone, material, quantity, application, status, request_key, request_hash) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [...Object.values(data), identity.key, identity.key ? identity.hash : null]);
      await audit(db, req, 'RFQ_CREATED', insert.insertId, null, { ...data, status: 'pending' });
      return { rfq_id: insert.insertId, duplicate: false };
    });
    return res.status(result.duplicate ? 200 : 201).json({ message: result.duplicate ? 'The existing RFQ was returned safely' : 'RFQ created successfully', ...result });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' && identity?.key) {
      try {
        const [[existing]] = await pool.query('SELECT id, request_hash FROM rfqs WHERE request_key = ?', [identity.key]);
        if (existing && existing.request_hash === identity.hash) return res.json({ message: 'The existing RFQ was returned safely', rfq_id: existing.id, duplicate: true });
        return res.status(409).json({ message: 'This retry key was already used for different RFQ data', code: 'IDEMPOTENCY_CONFLICT' });
      } catch (retryError) { return error(res, retryError); }
    }
    return error(res, err);
  }
};
async function transition(req, res, status, allowed) {
  try {
    const recordId = id(req.body.rfq_id || req.params.id);
    const result = await transaction(async (db) => {
      const row = await record(db, req, recordId), current = String(row.status).toLowerCase();
      if (current === status) return { status, unchanged: true };
      if (!allowed.includes(current)) throw new RfqError(`An RFQ in ${current} status cannot be ${status}`, 409, { status: 'Refresh before trying again' }, 'RFQ_STATUS_CONFLICT');
      await db.query('UPDATE rfqs SET status = ?, revision = revision + 1, updated_at = NOW() WHERE id = ?', [status, recordId]);
      await audit(db, req, 'RFQ_STATUS_CHANGED', recordId, { status: current }, { status });
      return { status, unchanged: false };
    });
    return res.json({ message: `RFQ ${status} successfully`, rfq_id: recordId, ...result });
  } catch (err) { return error(res, err); }
}
exports.approveRFQ = (req, res) => transition(req, res, 'approved', ['pending']);
exports.rejectRFQ = (req, res) => transition(req, res, 'rejected', ['pending', 'approved']);
exports.closeRFQ = (req, res) => transition(req, res, 'closed', ['pending', 'approved', 'quoted', 'rejected']);
exports.updateRFQ = async (req, res) => {
  try {
    const recordId = id(req.params.id || req.body.rfq_id), data = input(req.body);
    const revision = await transaction(async (db) => {
      const row = await record(db, req, recordId);
      if (!['pending', 'rejected'].includes(String(row.status).toLowerCase())) throw new RfqError('Only pending or rejected RFQs can be edited', 409, null, 'RFQ_EDIT_CONFLICT');
      if (req.body.revision !== undefined && Number(req.body.revision) !== Number(row.revision)) throw new RfqError('This RFQ was edited by another person. Reload it before saving.', 409, null, 'RFQ_VERSION_CONFLICT');
      await db.query('UPDATE rfqs SET customer_name = ?, email = ?, phone = ?, material = ?, quantity = ?, application = ?, revision = revision + 1, updated_at = NOW() WHERE id = ?', [...Object.values(data), recordId]);
      await audit(db, req, 'RFQ_UPDATED', recordId, row, data);
      return Number(row.revision) + 1;
    });
    return res.json({ message: 'RFQ saved successfully', rfq_id: recordId, revision });
  } catch (err) { return error(res, err); }
};
exports.getRFQ = async (req, res) => {
  try {
    await ensureRfqSchema();
    const isolation = scope(req), recordId = id(req.params.id);
    const [[rfq]] = await pool.query(`SELECT * FROM rfqs WHERE id = ?${isolation.sql}`, [recordId, ...isolation.params]);
    if (!rfq) throw new RfqError('RFQ not found', 404, null, 'RFQ_NOT_FOUND');
    const financial = hasPermission(req.user, 'VIEW_FINANCE');
    const [documents] = await pool.query(`SELECT id, invoice_no, ${financial ? 'total,' : ''} status, created_at FROM invoices WHERE rfq_id = ? AND IFNULL(deleted, 0) = 0 ORDER BY id`, [recordId]);
    const [history] = await pool.query(`SELECT a.action, a.old_value, a.new_value, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE LOWER(a.module) = 'rfq' AND a.record_id = ? ORDER BY a.id DESC LIMIT 100`, [String(recordId)]);
    return res.json({ rfq, documents, history });
  } catch (err) { return error(res, err); }
};
async function archive(req, res, archived) {
  try {
    const recordId = id(req.params.id || req.body.rfq_id);
    await transaction(async (db) => {
      const row = await record(db, req, recordId, !archived);
      if (archived && !['closed', 'rejected', 'pending'].includes(String(row.status).toLowerCase())) throw new RfqError('Close the RFQ before archiving it', 409, null, 'RFQ_ARCHIVE_CONFLICT');
      await db.query('UPDATE rfqs SET archived = ?, revision = revision + 1, updated_at = NOW() WHERE id = ?', [archived ? 1 : 0, recordId]);
      await audit(db, req, archived ? 'RFQ_ARCHIVED' : 'RFQ_RESTORED', recordId, { archived: !archived }, { archived });
    });
    return res.json({ message: archived ? 'RFQ archived; its records and links remain available' : 'RFQ restored', rfq_id: recordId, archived });
  } catch (err) { return error(res, err); }
}
exports.archiveRFQ = (req, res) => archive(req, res, true);
exports.restoreRFQ = (req, res) => archive(req, res, false);
exports._test = { input, scope, id, STATUSES };
