const crypto = require('node:crypto');
const pool = require('../config/db');
const governance = require('./recoveryDrillGovernanceController');

function actor(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}

function text(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function parseJson(value, fallback = []) { if (!value) return fallback; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return fallback; } }
function list(value, max = 50) { return Array.isArray(value) ? [...new Set(value.map((x) => text(x, 500)).filter(Boolean))].slice(0, max) : []; }
function dateValue(value) { if (!value) return null; const d = new Date(value); if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Invalid date.'), { statusCode: 400 }); return d; }
function fail(message, statusCode = 400, code = 'RECOVERY_REMEDIATION_FAILED') { return Object.assign(new Error(message), { statusCode, code }); }

function priorityFromSeverity(severity) {
  return { CRITICAL: 'URGENT', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', OK: 'LOW' }[String(severity || '').toUpperCase()] || 'MEDIUM';
}

function view(row) {
  return {
    id: row.id,
    drill_id: row.drill_id,
    title: row.title,
    source_severity: row.source_severity,
    priority: row.priority,
    status: row.status,
    owner_label: row.owner_label || null,
    due_at: row.due_at || null,
    remediation_note: row.remediation_note || null,
    closure_evidence: parseJson(row.closure_evidence_json, []),
    source_reasons: parseJson(row.source_reasons_json, []),
    created_by_user_id: row.created_by_user_id,
    closed_by_user_id: row.closed_by_user_id || null,
    closed_at: row.closed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    overdue: Boolean(!row.closed_at && row.due_at && new Date(row.due_at).getTime() < Date.now())
  };
}

async function event(db, id, actorUserId, type, payload = {}) {
  await db.query('INSERT INTO recovery_remediation_events (remediation_id,actor_user_id,event_type,event_json) VALUES (?,?,?,?)', [id, actorUserId, type, JSON.stringify(payload)]);
}

async function getItem(id) {
  const [[row]] = await pool.query('SELECT * FROM recovery_remediation_items WHERE id=? LIMIT 1', [id]);
  if (!row) throw fail('Remediation item not found.', 404, 'RECOVERY_REMEDIATION_NOT_FOUND');
  return row;
}

function respondError(res, error) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error('Recovery remediation action failed.', error);
  return res.status(status).json({ message: status >= 500 ? 'Recovery remediation action failed.' : error.message, code: error.code || 'RECOVERY_REMEDIATION_FAILED' });
}

exports.list = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM recovery_remediation_items ORDER BY closed_at IS NULL DESC, priority DESC, due_at IS NULL, due_at ASC, created_at DESC LIMIT 200');
    const items = rows.map(view);
    return res.json({
      summary: {
        total: items.length,
        open: items.filter((x) => !x.closed_at).length,
        overdue: items.filter((x) => x.overdue).length,
        urgent: items.filter((x) => !x.closed_at && x.priority === 'URGENT').length,
        unassigned: items.filter((x) => !x.closed_at && !x.owner_label).length,
        closed: items.filter((x) => Boolean(x.closed_at)).length
      },
      items,
      production_restore_available: false
    });
  } catch (error) { return respondError(res, error); }
};

exports.create = async (req, res) => {
  try {
    const user = actor(req);
    const drillId = text(req.body?.drill_id, 36);
    if (!drillId) throw fail('drill_id is required.');
    const [[drill]] = await pool.query('SELECT * FROM recovery_drill_records WHERE id=? LIMIT 1', [drillId]);
    if (!drill) throw fail('Recovery drill not found.', 404);
    const classified = governance._test.classify(drill);
    if (classified.severity === 'OK') throw fail('This drill does not currently require remediation.', 409);
    const [[existing]] = await pool.query("SELECT * FROM recovery_remediation_items WHERE drill_id=? AND status<>'CLOSED' LIMIT 1", [drillId]);
    if (existing) return res.status(200).json({ item: view(existing), already_exists: true });

    const id = crypto.randomUUID();
    const due = dateValue(req.body?.due_at) || new Date(Date.now() + (classified.severity === 'CRITICAL' ? 24 : classified.severity === 'HIGH' ? 72 : 168) * 3600000);
    const owner = text(req.body?.owner_label, 120) || null;
    const title = text(req.body?.title, 180) || `Remediate: ${classified.title}`;
    const priority = priorityFromSeverity(classified.severity);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await db.query('INSERT INTO recovery_remediation_items (id,drill_id,title,source_severity,priority,status,owner_label,due_at,source_reasons_json,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, drillId, title, classified.severity, priority, owner ? 'ASSIGNED' : 'OPEN', owner, due, JSON.stringify(classified.reasons || []), user]);
      await event(db, id, user, 'REMEDIATION_CREATED', { priority, owner_label: owner, due_at: due.toISOString(), source_reasons: classified.reasons || [] });
      await db.commit();
    } catch (error) { await db.rollback().catch(() => {}); throw error; } finally { db.release(); }
    return res.status(201).json({ item: view(await getItem(id)) });
  } catch (error) { return respondError(res, error); }
};

exports.update = async (req, res) => {
  try {
    const user = actor(req);
    const id = text(req.params?.id, 36);
    const existing = await getItem(id);
    if (existing.closed_at) throw fail('Closed remediation records are immutable.', 409, 'RECOVERY_REMEDIATION_CLOSED');
    const owner = text(req.body?.owner_label, 120) || null;
    const note = text(req.body?.remediation_note, 4000) || null;
    const due = dateValue(req.body?.due_at) || existing.due_at;
    const priority = ['URGENT','HIGH','MEDIUM','LOW'].includes(String(req.body?.priority || '').toUpperCase()) ? String(req.body.priority).toUpperCase() : existing.priority;
    const status = owner ? (req.body?.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'ASSIGNED') : 'OPEN';
    await pool.query('UPDATE recovery_remediation_items SET owner_label=?,due_at=?,priority=?,status=?,remediation_note=? WHERE id=?', [owner, due, priority, status, note, id]);
    const db = await pool.getConnection();
    try { await db.beginTransaction(); await event(db, id, user, 'REMEDIATION_UPDATED', { owner_label: owner, due_at: due, priority, status, remediation_note_present: Boolean(note) }); await db.commit(); } finally { db.release(); }
    return res.json({ item: view(await getItem(id)) });
  } catch (error) { return respondError(res, error); }
};

exports.close = async (req, res) => {
  try {
    const user = actor(req);
    const id = text(req.params?.id, 36);
    const existing = await getItem(id);
    if (existing.closed_at) return res.json({ item: view(existing), already_closed: true });
    const evidence = list(req.body?.closure_evidence, 50);
    const note = text(req.body?.remediation_note, 4000) || text(existing.remediation_note, 4000);
    if (!existing.owner_label) throw fail('Assign an owner before closure.', 409);
    if (!note) throw fail('Remediation note is required before closure.', 409);
    if (evidence.length < 1) throw fail('At least one closure evidence reference is required.', 409);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await db.query("UPDATE recovery_remediation_items SET status='CLOSED',remediation_note=?,closure_evidence_json=?,closed_by_user_id=?,closed_at=NOW(3) WHERE id=? AND closed_at IS NULL", [note, JSON.stringify(evidence), user, id]);
      await event(db, id, user, 'REMEDIATION_CLOSED', { evidence_count: evidence.length, note_present: true });
      await db.commit();
    } catch (error) { await db.rollback().catch(() => {}); throw error; } finally { db.release(); }
    return res.json({ item: view(await getItem(id)), message: 'Remediation closed and locked with evidence.' });
  } catch (error) { return respondError(res, error); }
};

exports.sync = async (req, res) => {
  try {
    const user = actor(req);
    const [rows] = await pool.query('SELECT * FROM recovery_drill_records ORDER BY created_at DESC LIMIT 100');
    let created = 0;
    for (const drill of rows) {
      const item = governance._test.classify(drill);
      if (item.severity === 'OK') continue;
      const [[existing]] = await pool.query("SELECT id FROM recovery_remediation_items WHERE drill_id=? AND status<>'CLOSED' LIMIT 1", [drill.id]);
      if (existing) continue;
      const id = crypto.randomUUID();
      const priority = priorityFromSeverity(item.severity);
      const dueHours = item.severity === 'CRITICAL' ? 24 : item.severity === 'HIGH' ? 72 : 168;
      const due = new Date(Date.now() + dueHours * 3600000);
      await pool.query('INSERT INTO recovery_remediation_items (id,drill_id,title,source_severity,priority,status,due_at,source_reasons_json,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?)', [id, drill.id, `Remediate: ${item.title}`, item.severity, priority, 'OPEN', due, JSON.stringify(item.reasons || []), user]);
      const db = await pool.getConnection();
      try { await db.beginTransaction(); await event(db, id, user, 'REMEDIATION_AUTO_CREATED', { priority, due_at: due.toISOString(), source_reasons: item.reasons || [] }); await db.commit(); } finally { db.release(); }
      created += 1;
    }
    return res.json({ created, message: created ? `${created} remediation item(s) created from governance findings.` : 'No new remediation items were required.' });
  } catch (error) { return respondError(res, error); }
};

exports._test = { priorityFromSeverity, view };
