const crypto = require('crypto');
const pool = require('../config/db');
const { ensureQmsSchema } = require('../services/qmsSchema');
const { logAudit } = require('../services/auditService');

const MUTABLE = new Set(['DRAFT', 'REJECTED']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(record) {
  return crypto.createHash('sha256').update(canonical({
    documentId: record.document_id,
    sourceRevision: record.source_revision,
    recordRevision: Number(record.record_revision),
    status: record.status,
    values: record.values_json || {}
  })).digest('hex');
}

function actor(req) {
  return Number(req.user?.id || req.user?.user_id || 0) || null;
}

function requestAudit(req) {
  return {
    actorId: actor(req),
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.id || req.get('x-request-id') || null,
    sessionId: req.session?.id || null
  };
}

async function listRecords(req, res, next) {
  try {
    await ensureQmsSchema();
    const status = String(req.query.status || '').trim().toUpperCase();
    const documentId = String(req.query.document_id || '').trim();
    const params = [];
    const where = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (documentId) { where.push('document_id = ?'); params.push(documentId); }
    const [rows] = await pool.query(`SELECT id,record_uuid,record_no,document_id,document_title,source_revision,record_revision,status,owner_user_id,prepared_by,reviewed_by,approved_by,approved_at,closed_at,integrity_hash,created_at,updated_at FROM qms_records ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 250`, params);
    return res.json({ records: rows });
  } catch (error) { return next(error); }
}

async function getRecord(req, res, next) {
  try {
    await ensureQmsSchema();
    const [[record]] = await pool.query('SELECT * FROM qms_records WHERE id = ? OR record_uuid = ? LIMIT 1', [req.params.id, req.params.id]);
    if (!record) return res.status(404).json({ message: 'Controlled record not found.' });
    const [revisions] = await pool.query('SELECT record_revision,status,integrity_hash,change_reason,changed_by,created_at FROM qms_record_revisions WHERE qms_record_id=? ORDER BY record_revision DESC', [record.id]);
    const [events] = await pool.query('SELECT from_status,to_status,actor_id,reason,created_at FROM qms_record_workflow_events WHERE qms_record_id=? ORDER BY id ASC', [record.id]);
    const [signatures] = await pool.query('SELECT record_revision,signer_user_id,signature_type,meaning_text,signed_integrity_hash,signed_at FROM qms_record_signatures WHERE qms_record_id=? ORDER BY id ASC', [record.id]);
    return res.json({ record, revisions, events, signatures });
  } catch (error) { return next(error); }
}

async function createRecord(req, res, next) {
  try {
    await ensureQmsSchema();
    const documentId = String(req.body.document_id || '').trim();
    const title = String(req.body.document_title || '').trim();
    const sourceRevision = String(req.body.source_revision || '1.0').trim();
    const values = req.body.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values) ? req.body.values : {};
    if (!documentId || !title) return res.status(400).json({ message: 'document_id and document_title are required.' });
    if (documentId.length > 64 || title.length > 255 || sourceRevision.length > 32) return res.status(400).json({ message: 'Controlled record metadata is too long.' });

    const record = {
      document_id: documentId,
      source_revision: sourceRevision,
      record_revision: 1,
      status: 'DRAFT',
      values_json: values
    };
    const hash = fingerprint(record);
    const uuid = crypto.randomUUID();
    const who = actor(req);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query('INSERT INTO qms_records (record_uuid,document_id,document_title,source_revision,values_json,owner_user_id,prepared_by,integrity_hash) VALUES (?,?,?,?,?,?,?,?)', [uuid, documentId, title, sourceRevision, JSON.stringify(values), who, who, hash]);
      const recordNo = `QMS-${new Date().getUTCFullYear()}-${String(result.insertId).padStart(6, '0')}`;
      await connection.query('UPDATE qms_records SET record_no=? WHERE id=?', [recordNo, result.insertId]);
      await connection.query('INSERT INTO qms_record_revisions (qms_record_id,record_revision,status,values_json,integrity_hash,change_reason,changed_by) VALUES (?,?,?,?,?,?,?)', [result.insertId, 1, 'DRAFT', JSON.stringify(values), hash, 'Initial controlled record', who]);
      await connection.query('INSERT INTO qms_record_workflow_events (qms_record_id,from_status,to_status,actor_id,reason) VALUES (?,?,?,?,?)', [result.insertId, null, 'DRAFT', who, 'Record created']);
      await logAudit(connection, { ...requestAudit(req), action: 'QMS_RECORD_CREATED', module: 'QMS', recordType: documentId, recordId: recordNo, newValue: { sourceRevision, status: 'DRAFT', integrityHash: hash } });
      await connection.commit();
      return res.status(201).json({ id: result.insertId, record_uuid: uuid, record_no: recordNo, integrity_hash: hash, status: 'DRAFT' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  } catch (error) { return next(error); }
}

async function updateRecord(req, res, next) {
  try {
    await ensureQmsSchema();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[current]] = await connection.query('SELECT * FROM qms_records WHERE id=? FOR UPDATE', [req.params.id]);
      if (!current) { await connection.rollback(); return res.status(404).json({ message: 'Controlled record not found.' }); }
      if (!MUTABLE.has(current.status)) { await connection.rollback(); return res.status(409).json({ message: `Record is ${current.status} and cannot be edited. Create a controlled revision instead.` }); }
      const reason = String(req.body.revision_reason || '').trim();
      const values = req.body.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values) ? req.body.values : null;
      if (!values) { await connection.rollback(); return res.status(400).json({ message: 'values object is required.' }); }
      if (!reason) { await connection.rollback(); return res.status(400).json({ message: 'revision_reason is required.' }); }
      const revision = Number(current.record_revision) + 1;
      const nextRecord = { ...current, record_revision: revision, status: 'DRAFT', values_json: values };
      const hash = fingerprint(nextRecord);
      await connection.query('UPDATE qms_records SET record_revision=?,status=?,values_json=?,revision_reason=?,reviewed_by=NULL,approved_by=NULL,approved_at=NULL,integrity_hash=? WHERE id=?', [revision, 'DRAFT', JSON.stringify(values), reason.slice(0, 1000), hash, current.id]);
      await connection.query('INSERT INTO qms_record_revisions (qms_record_id,record_revision,status,values_json,integrity_hash,change_reason,changed_by) VALUES (?,?,?,?,?,?,?)', [current.id, revision, 'DRAFT', JSON.stringify(values), hash, reason.slice(0, 1000), actor(req)]);
      await connection.query('INSERT INTO qms_record_workflow_events (qms_record_id,from_status,to_status,actor_id,reason) VALUES (?,?,?,?,?)', [current.id, current.status, 'DRAFT', actor(req), reason.slice(0, 1000)]);
      await logAudit(connection, { ...requestAudit(req), action: 'QMS_RECORD_REVISED', module: 'QMS', recordType: current.document_id, recordId: current.record_no, oldValue: { revision: current.record_revision, hash: current.integrity_hash }, newValue: { revision, hash } });
      await connection.commit();
      return res.json({ id: current.id, record_no: current.record_no, record_revision: revision, status: 'DRAFT', integrity_hash: hash });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
}

async function transition(req, res, next) {
  const target = String(req.body.status || '').trim().toUpperCase();
  const reason = String(req.body.reason || '').trim();
  const allowed = {
    DRAFT: ['SUBMITTED', 'VOID'],
    REJECTED: ['DRAFT', 'VOID'],
    SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED'],
    APPROVED: ['CLOSED', 'SUPERSEDED'],
    CLOSED: ['SUPERSEDED']
  };
  try {
    await ensureQmsSchema();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[current]] = await connection.query('SELECT * FROM qms_records WHERE id=? FOR UPDATE', [req.params.id]);
      if (!current) { await connection.rollback(); return res.status(404).json({ message: 'Controlled record not found.' }); }
      if (!(allowed[current.status] || []).includes(target)) { await connection.rollback(); return res.status(409).json({ message: `Invalid QMS workflow transition ${current.status} → ${target}.` }); }
      if (['REJECTED','VOID','SUPERSEDED'].includes(target) && !reason) { await connection.rollback(); return res.status(400).json({ message: 'A reason is required for this transition.' }); }
      const who = actor(req);
      if (target === 'APPROVED' && who && Number(current.prepared_by) === who) { await connection.rollback(); return res.status(409).json({ message: 'Separation of duties: the preparer cannot provide final approval.' }); }
      const next = { ...current, status: target };
      const hash = fingerprint(next);
      const approval = target === 'APPROVED';
      const closed = target === 'CLOSED';
      await connection.query('UPDATE qms_records SET status=?,reviewed_by=IF(?="UNDER_REVIEW",?,reviewed_by),approved_by=IF(?="APPROVED",?,approved_by),approved_at=IF(?="APPROVED",NOW(),approved_at),closed_at=IF(?="CLOSED",NOW(),closed_at),integrity_hash=? WHERE id=?', [target, target, who, target, who, target, target, hash, current.id]);
      await connection.query('INSERT INTO qms_record_workflow_events (qms_record_id,from_status,to_status,actor_id,reason) VALUES (?,?,?,?,?)', [current.id, current.status, target, who, reason || null]);
      if (approval) {
        const meaning = String(req.body.signature_meaning || 'I confirm that I reviewed this controlled record and approve it for its stated purpose.').trim();
        await connection.query('INSERT INTO qms_record_signatures (qms_record_id,record_revision,signer_user_id,signature_type,meaning_text,signed_integrity_hash) VALUES (?,?,?,?,?,?)', [current.id, current.record_revision, who, 'APPROVAL', meaning.slice(0,1000), hash]);
      }
      await logAudit(connection, { ...requestAudit(req), action: `QMS_RECORD_${target}`, module: 'QMS', recordType: current.document_id, recordId: current.record_no, oldValue: { status: current.status, hash: current.integrity_hash }, newValue: { status: target, hash } });
      await connection.commit();
      return res.json({ id: current.id, record_no: current.record_no, status: target, integrity_hash: hash, closed });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
}

module.exports = { listRecords, getRecord, createRecord, updateRecord, transition };
