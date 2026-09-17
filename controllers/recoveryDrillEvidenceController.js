const crypto = require('node:crypto');
const pool = require('../config/db');

function userId(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') {
    throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401, code: 'RECOVERY_DRILL_IDENTITY_REQUIRED' });
  }
  return String(value);
}

function failure(message, statusCode = 400, code = 'RECOVERY_DRILL_EVIDENCE_FAILED') {
  return Object.assign(new Error(message), { statusCode, code });
}

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 50, itemMax = 500) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemMax)).filter(Boolean))].slice(0, max);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function dateValue(value, field, required = false) {
  if (!value) {
    if (required) throw failure(`${field} is required.`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw failure(`${field} is invalid.`);
  return date;
}

function checks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => ({
    name: text(item?.name, 160),
    passed: item?.passed === true,
    note: text(item?.note, 600)
  })).filter((item) => item.name);
}

function hoursBetween(earlier, later) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 3600000);
}

function numberTarget(value, fallback, min = 0.01, max = 8760) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function view(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    operator_label: row.operator_label,
    backup_identifier: row.backup_identifier || null,
    backup_created_at: row.backup_created_at || null,
    recovery_environment: row.recovery_environment || null,
    started_at: row.started_at || null,
    restore_completed_at: row.restore_completed_at || null,
    validation_completed_at: row.validation_completed_at || null,
    restore_result: row.restore_result || null,
    integrity_checks: parseJson(row.integrity_checks_json, []),
    evidence_refs: parseJson(row.evidence_refs_json, []),
    findings: parseJson(row.findings_json, []),
    actual_rpo_hours: row.actual_rpo_hours === null ? null : Number(row.actual_rpo_hours),
    actual_rto_hours: row.actual_rto_hours === null ? null : Number(row.actual_rto_hours),
    rpo_target_hours: Number(row.rpo_target_hours),
    rto_target_hours: Number(row.rto_target_hours),
    rpo_objective_status: row.rpo_objective_status || null,
    rto_objective_status: row.rto_objective_status || null,
    final_decision: row.final_decision || null,
    decision_note: row.decision_note || null,
    next_drill_at: row.next_drill_at || null,
    created_by_user_id: row.created_by_user_id,
    finalized_by_user_id: row.finalized_by_user_id || null,
    finalized_at: row.finalized_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    assurance_boundary: 'Internal drill evidence does not prove Railway/provider backup scheduling or provider telemetry.'
  };
}

async function event(db, drillId, actorUserId, type, payload) {
  await db.query(
    'INSERT INTO recovery_drill_events (drill_id,actor_user_id,event_type,event_json) VALUES (?,?,?,?)',
    [drillId, actorUserId, type, JSON.stringify(payload || {})]
  );
}

async function ownedRecord(id) {
  const [[row]] = await pool.query('SELECT * FROM recovery_drill_records WHERE id=? LIMIT 1', [id]);
  if (!row) throw failure('Recovery drill record was not found.', 404, 'RECOVERY_DRILL_NOT_FOUND');
  return row;
}

function respondError(res, error) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error('Recovery drill evidence action failed.', error);
  return res.status(status).json({
    message: status >= 500 ? 'Recovery drill evidence action failed.' : error.message,
    code: error.code || 'RECOVERY_DRILL_EVIDENCE_FAILED'
  });
}

exports.list = async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 25)));
    const [rows] = await pool.query('SELECT * FROM recovery_drill_records ORDER BY created_at DESC LIMIT ?', [limit]);
    const items = rows.map(view);
    const latestFinal = items.find((item) => item.finalized_at) || null;
    return res.json({
      scope: 'SECURITY_RECOVERY_GOVERNANCE',
      production_restore_available: false,
      provider_telemetry_claimed: false,
      summary: {
        total: items.length,
        finalized: items.filter((item) => item.finalized_at).length,
        passed: items.filter((item) => String(item.final_decision || '').startsWith('PASS')).length,
        failed: items.filter((item) => item.final_decision === 'FAILED').length,
        objectives_missed: items.filter((item) => item.final_decision === 'PASS_OBJECTIVES_MISSED').length
      },
      latest_finalized: latestFinal,
      items
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    const id = text(req.params?.id, 36);
    const drill = view(await ownedRecord(id));
    const [rows] = await pool.query(
      'SELECT id,actor_user_id,event_type,event_json,created_at FROM recovery_drill_events WHERE drill_id=? ORDER BY id ASC',
      [id]
    );
    return res.json({
      drill,
      events: rows.map((row) => ({
        id: row.id,
        actor_user_id: row.actor_user_id,
        event_type: row.event_type,
        event: parseJson(row.event_json, {}),
        created_at: row.created_at
      }))
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.create = async (req, res) => {
  try {
    const actor = userId(req);
    const id = crypto.randomUUID();
    const title = text(req.body?.title, 160) || `Recovery drill ${new Date().toISOString().slice(0, 10)}`;
    const operator = text(req.body?.operator_label, 120);
    if (!operator) throw failure('Operator name or role is required.');
    const rpoTarget = numberTarget(req.body?.rpo_target_hours, Number(process.env.RECOVERY_RPO_HOURS || 24));
    const rtoTarget = numberTarget(req.body?.rto_target_hours, Number(process.env.RECOVERY_RTO_HOURS || 4));
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await db.query(
        'INSERT INTO recovery_drill_records (id,title,status,operator_label,rpo_target_hours,rto_target_hours,created_by_user_id) VALUES (?,?,?,?,?,?,?)',
        [id, title, 'DRAFT', operator, rpoTarget, rtoTarget, actor]
      );
      await event(db, id, actor, 'DRILL_CREATED', {
        title,
        operator_label: operator,
        rpo_target_hours: rpoTarget,
        rto_target_hours: rtoTarget,
        production_restore_available: false,
        provider_telemetry_claimed: false
      });
      await db.commit();
    } catch (error) {
      await db.rollback().catch(() => {});
      throw error;
    } finally {
      db.release();
    }
    return res.status(201).json({ drill: view(await ownedRecord(id)) });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.update = async (req, res) => {
  try {
    const actor = userId(req);
    const id = text(req.params?.id, 36);
    const existing = await ownedRecord(id);
    if (existing.finalized_at) throw failure('Finalized recovery drill records are immutable.', 409, 'RECOVERY_DRILL_FINALIZED');

    const backupIdentifier = text(req.body?.backup_identifier, 255) || null;
    const backupCreated = dateValue(req.body?.backup_created_at, 'backup_created_at');
    const environment = text(req.body?.recovery_environment, 255) || null;
    const started = dateValue(req.body?.started_at, 'started_at');
    const restoreCompleted = dateValue(req.body?.restore_completed_at, 'restore_completed_at');
    const validationCompleted = dateValue(req.body?.validation_completed_at, 'validation_completed_at');
    const restoreResult = req.body?.restore_result ? String(req.body.restore_result).toUpperCase() : null;
    if (restoreResult && !['SUCCESS', 'FAILED', 'PARTIAL'].includes(restoreResult)) throw failure('restore_result must be SUCCESS, FAILED, or PARTIAL.');
    const integrity = checks(req.body?.integrity_checks);
    const evidence = list(req.body?.evidence_refs, 50, 500);
    const findings = list(req.body?.findings, 50, 1000);
    const nextDrill = dateValue(req.body?.next_drill_at, 'next_drill_at');
    const status = started ? 'IN_PROGRESS' : 'DRAFT';

    await pool.query(
      `UPDATE recovery_drill_records SET status=?,backup_identifier=?,backup_created_at=?,recovery_environment=?,started_at=?,restore_completed_at=?,validation_completed_at=?,restore_result=?,integrity_checks_json=?,evidence_refs_json=?,findings_json=?,next_drill_at=? WHERE id=?`,
      [status, backupIdentifier, backupCreated, environment, started, restoreCompleted, validationCompleted, restoreResult, JSON.stringify(integrity), JSON.stringify(evidence), JSON.stringify(findings), nextDrill, id]
    );
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await event(db, id, actor, 'DRILL_EVIDENCE_UPDATED', {
        backup_identifier_present: Boolean(backupIdentifier),
        recovery_environment_present: Boolean(environment),
        restore_result: restoreResult,
        integrity_check_count: integrity.length,
        evidence_ref_count: evidence.length,
        finding_count: findings.length,
        production_restore_executed: false
      });
      await db.commit();
    } finally {
      db.release();
    }
    return res.json({ drill: view(await ownedRecord(id)) });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.finalize = async (req, res) => {
  try {
    const actor = userId(req);
    const id = text(req.params?.id, 36);
    const row = await ownedRecord(id);
    if (row.finalized_at) return res.json({ drill: view(row), already_finalized: true });

    const backupCreated = dateValue(row.backup_created_at, 'backup_created_at', true);
    const started = dateValue(row.started_at, 'started_at', true);
    const validationCompleted = dateValue(row.validation_completed_at, 'validation_completed_at', true);
    if (backupCreated > started) throw failure('Backup timestamp cannot be later than drill start.', 409, 'RECOVERY_DRILL_TIME_ORDER_INVALID');
    if (validationCompleted < started) throw failure('Validation completion cannot be earlier than drill start.', 409, 'RECOVERY_DRILL_TIME_ORDER_INVALID');
    if (!row.backup_identifier || !row.recovery_environment) throw failure('Backup identifier and isolated recovery environment are required before finalization.', 409);

    const integrity = checks(parseJson(row.integrity_checks_json, []));
    const evidence = list(parseJson(row.evidence_refs_json, []), 50, 500);
    if (integrity.length < 3) throw failure('At least three named integrity checks are required before finalization.', 409, 'RECOVERY_DRILL_INTEGRITY_EVIDENCE_REQUIRED');
    if (evidence.length < 2) throw failure('At least two evidence references are required before finalization.', 409, 'RECOVERY_DRILL_EVIDENCE_REQUIRED');
    if (!row.restore_result) throw failure('Restore result is required before finalization.', 409);

    const actualRpo = hoursBetween(backupCreated, started);
    const actualRto = hoursBetween(started, validationCompleted);
    const rpoTarget = Number(row.rpo_target_hours);
    const rtoTarget = Number(row.rto_target_hours);
    const rpoStatus = actualRpo <= rpoTarget ? 'MET' : 'MISSED';
    const rtoStatus = actualRto <= rtoTarget ? 'MET' : 'MISSED';
    const technicalPass = row.restore_result === 'SUCCESS' && integrity.every((item) => item.passed === true);
    const decision = technicalPass
      ? (rpoStatus === 'MET' && rtoStatus === 'MET' ? 'PASS_OBJECTIVES_MET' : 'PASS_OBJECTIVES_MISSED')
      : 'FAILED';
    const note = text(req.body?.decision_note, 4000);
    if (!note) throw failure('A final decision note is required.');

    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await db.query(
        `UPDATE recovery_drill_records SET status='FINALIZED',actual_rpo_hours=?,actual_rto_hours=?,rpo_objective_status=?,rto_objective_status=?,final_decision=?,decision_note=?,finalized_by_user_id=?,finalized_at=NOW(3) WHERE id=? AND finalized_at IS NULL`,
        [actualRpo, actualRto, rpoStatus, rtoStatus, decision, note, actor, id]
      );
      await event(db, id, actor, 'DRILL_FINALIZED', {
        restore_result: row.restore_result,
        integrity_check_count: integrity.length,
        all_integrity_checks_passed: integrity.every((item) => item.passed === true),
        evidence_ref_count: evidence.length,
        actual_rpo_hours: Number(actualRpo.toFixed(3)),
        actual_rto_hours: Number(actualRto.toFixed(3)),
        rpo_objective_status: rpoStatus,
        rto_objective_status: rtoStatus,
        final_decision: decision,
        provider_telemetry_verified_by_this_record: false,
        production_restore_executed: false
      });
      await db.commit();
    } catch (error) {
      await db.rollback().catch(() => {});
      throw error;
    } finally {
      db.release();
    }
    return res.json({
      drill: view(await ownedRecord(id)),
      explanation: decision === 'PASS_OBJECTIVES_MET'
        ? 'Restore and integrity checks passed and both recovery objectives were met.'
        : decision === 'PASS_OBJECTIVES_MISSED'
          ? 'Restore and integrity checks passed, but one or more recovery objectives were missed.'
          : 'The drill failed because the restore or at least one integrity check failed.',
      provider_telemetry_verified: false
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports._test = { checks, hoursBetween, numberTarget, view };
