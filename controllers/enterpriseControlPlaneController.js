const crypto = require('crypto');
const pool = require('../config/db');
const { ensureEnterpriseControlPlaneSchema } = require('../services/enterpriseControlPlaneSchema');
const { scoreRequestRisk } = require('../services/adaptiveRiskService');
const { logAudit } = require('../services/auditService');

const text = (value, max) => String(value || '').trim().slice(0, max);
const upper = (value) => text(value, 80).toUpperCase();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

async function audit(req, action, type, id, metadata = {}) {
  await logAudit(pool, {
    actorId: req.user.id,
    action,
    module: 'enterprise_control_plane',
    recordType: type,
    recordId: id,
    newValue: metadata,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
    sessionId: req.session?.id,
    metadata
  });
}

exports.summary = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const [evidence, changes, drills, vendors, aiPolicies, traces] = await Promise.all([
      pool.query(`SELECT COUNT(*) total,
        SUM(verification_status='VERIFIED' AND (expires_at IS NULL OR expires_at>NOW())) verified,
        SUM(verification_status='VERIFIED' AND expires_at IS NOT NULL AND expires_at<=NOW()) expired
        FROM control_evidence`),
      pool.query(`SELECT COUNT(*) total,
        SUM(status='PENDING_APPROVAL') pending,
        SUM(status='APPROVED') approved,
        SUM(status='IMPLEMENTED') implemented
        FROM enterprise_change_requests`),
      pool.query(`SELECT COUNT(*) total,
        SUM(result_status='PASSED') passed,
        SUM(next_due_at IS NOT NULL AND next_due_at<NOW()) overdue
        FROM resilience_drills`),
      pool.query(`SELECT COUNT(*) total,
        SUM(status='APPROVED') approved,
        SUM(next_review_at<NOW()) overdue
        FROM vendor_risk_assessments`),
      pool.query(`SELECT COUNT(*) total,
        SUM(blocked=1) blocked,
        SUM(requires_human_approval=1) human_gate
        FROM ai_action_policies`),
      pool.query(`SELECT COUNT(*) total, COUNT(DISTINCT job_reference) jobs
        FROM manufacturing_trace_events`)
    ]);

    const row = (result) => result[0][0] || {};
    return res.json({
      generated_at: new Date().toISOString(),
      request_risk: scoreRequestRisk(req),
      evidence: row(evidence),
      change_control: row(changes),
      resilience: row(drills),
      vendor_risk: row(vendors),
      ai_governance: row(aiPolicies),
      manufacturing_traceability: row(traces),
      assurance_statement: 'Only evidence rows with VERIFIED status and a non-expired review window count as verified. Provider controls are not inferred from application code.'
    });
  } catch (error) { next(error); }
};

exports.currentRisk = async (req, res) => {
  return res.json(scoreRequestRisk(req));
};

exports.createEvidence = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const controlKey = upper(req.body.control_key);
    const evidenceType = upper(req.body.evidence_type);
    const reference = text(req.body.evidence_reference, 700);
    const notes = text(req.body.notes, 1000);
    const status = upper(req.body.verification_status || 'PENDING');
    const validDays = number(req.body.valid_for_days, 90);
    if (!controlKey || !evidenceType || reference.length < 8 || !['PENDING','VERIFIED','REJECTED','REMEDIATION_REQUIRED'].includes(status) || validDays < 1 || validDays > 365) {
      return res.status(400).json({ message: 'Valid control evidence, status and 1-365 day review window are required' });
    }
    const id = crypto.randomUUID();
    const verified = status === 'VERIFIED';
    await pool.query(`INSERT INTO control_evidence
      (id,control_key,evidence_type,evidence_reference,verification_status,verified_by,verified_at,expires_at,notes,created_by)
      VALUES (?,?,?,?,?,?,${verified ? 'NOW()' : 'NULL'},DATE_ADD(NOW(),INTERVAL ? DAY),?,?)`,
      [id, controlKey, evidenceType, reference, status, verified ? req.user.id : null, validDays, notes || null, req.user.id]);
    await audit(req, 'CONTROL_EVIDENCE_RECORDED', 'control_evidence', id, { control_key: controlKey, status, valid_for_days: validDays });
    return res.status(201).json({ id, status, verified });
  } catch (error) { next(error); }
};

exports.createChange = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const title = text(req.body.title, 180);
    const changeType = upper(req.body.change_type);
    const riskLevel = upper(req.body.risk_level);
    const description = text(req.body.description, 2000);
    const rollback = text(req.body.rollback_plan, 2000);
    const validation = text(req.body.validation_plan, 2000);
    if (title.length < 5 || description.length < 20 || rollback.length < 20 || validation.length < 20 || !['LOW','MEDIUM','HIGH','CRITICAL'].includes(riskLevel)) {
      return res.status(400).json({ message: 'Complete change description, rollback plan, validation plan and valid risk level are required' });
    }
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO enterprise_change_requests
      (id,title,change_type,risk_level,description,rollback_plan,validation_plan,requested_by)
      VALUES (?,?,?,?,?,?,?,?)`, [id, title, changeType || 'APPLICATION', riskLevel, description, rollback, validation, req.user.id]);
    await audit(req, 'CHANGE_REQUESTED', 'change_request', id, { title, risk_level: riskLevel, change_type: changeType || 'APPLICATION' });
    return res.status(201).json({ id, status: 'PENDING_APPROVAL' });
  } catch (error) { next(error); }
};

exports.approveChange = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const [[item]] = await pool.query('SELECT * FROM enterprise_change_requests WHERE id=? LIMIT 1', [req.params.id]);
    if (!item) return res.status(404).json({ message: 'Change request not found' });
    if (Number(item.requested_by) === Number(req.user.id)) return res.status(403).json({ message: 'Requester cannot approve their own change' });
    if (item.status !== 'PENDING_APPROVAL') return res.status(409).json({ message: 'Change request is not pending approval' });
    const confirmation = text(req.body.confirmation, 80);
    if (confirmation !== 'APPROVE CONTROLLED CHANGE') return res.status(400).json({ message: 'Exact approval confirmation is required' });
    await pool.query(`UPDATE enterprise_change_requests SET status='APPROVED',approved_by=?,approved_at=NOW() WHERE id=? AND status='PENDING_APPROVAL'`, [req.user.id, item.id]);
    await audit(req, 'CHANGE_APPROVED', 'change_request', item.id, { risk_level: item.risk_level });
    return res.json({ message: 'Controlled change approved.' });
  } catch (error) { next(error); }
};

exports.recordDrill = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const drillType = upper(req.body.drill_type);
    const scenario = text(req.body.scenario, 1200);
    const status = upper(req.body.result_status);
    const evidence = text(req.body.evidence_reference, 700);
    const lessons = text(req.body.lessons_learned, 1800);
    const rto = number(req.body.recovery_time_minutes, null);
    const rpo = number(req.body.recovery_point_minutes, null);
    const nextDays = number(req.body.next_due_days, 90);
    if (!drillType || scenario.length < 20 || !['PASSED','PARTIAL','FAILED'].includes(status) || nextDays < 1 || nextDays > 365) {
      return res.status(400).json({ message: 'Valid drill type, scenario, result and next due window are required' });
    }
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO resilience_drills
      (id,drill_type,scenario,recovery_time_minutes,recovery_point_minutes,result_status,evidence_reference,lessons_learned,performed_by,next_due_at)
      VALUES (?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY))`, [id, drillType, scenario, rto, rpo, status, evidence || null, lessons || null, req.user.id, nextDays]);
    await audit(req, 'RESILIENCE_DRILL_RECORDED', 'resilience_drill', id, { drill_type: drillType, result_status: status, rto, rpo });
    return res.status(201).json({ id, result_status: status });
  } catch (error) { next(error); }
};

exports.recordVendorAssessment = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const vendor = text(req.body.vendor_name, 180);
    const scope = text(req.body.service_scope, 500);
    const access = upper(req.body.data_access_level);
    const criticality = upper(req.body.criticality);
    const score = number(req.body.risk_score, -1);
    const status = upper(req.body.status);
    const evidence = text(req.body.evidence_reference, 700);
    const reviewDays = number(req.body.review_days, 180);
    if (vendor.length < 2 || scope.length < 10 || score < 0 || score > 100 || !['LOW','MEDIUM','HIGH','CRITICAL'].includes(criticality) || !['APPROVED','CONDITIONAL','REJECTED','REMEDIATION_REQUIRED'].includes(status) || reviewDays < 1 || reviewDays > 365) {
      return res.status(400).json({ message: 'Complete vendor risk assessment is required' });
    }
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO vendor_risk_assessments
      (id,vendor_name,service_scope,data_access_level,criticality,risk_score,status,evidence_reference,owner_user_id,reviewed_by,next_review_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY))`, [id, vendor, scope, access || 'UNKNOWN', criticality, score, status, evidence || null, req.body.owner_user_id || null, req.user.id, reviewDays]);
    await audit(req, 'VENDOR_RISK_ASSESSED', 'vendor_risk', id, { vendor_name: vendor, criticality, risk_score: score, status });
    return res.status(201).json({ id, status, risk_score: score });
  } catch (error) { next(error); }
};

exports.upsertAiPolicy = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const key = upper(req.body.action_key);
    const autonomy = upper(req.body.autonomy_level || 'SUGGEST_ONLY');
    const maxRisk = number(req.body.max_risk_score, 25);
    const human = req.body.requires_human_approval !== false;
    const stepUp = req.body.requires_step_up === true;
    const blocked = req.body.blocked === true;
    const reason = text(req.body.policy_reason, 1000);
    if (!key || !['SUGGEST_ONLY','DRAFT_ONLY','HUMAN_APPROVED','AUTOMATED_LOW_RISK'].includes(autonomy) || maxRisk < 0 || maxRisk > 100 || reason.length < 20) {
      return res.status(400).json({ message: 'Valid AI action policy is required' });
    }
    await pool.query(`INSERT INTO ai_action_policies
      (id,action_key,autonomy_level,max_risk_score,requires_human_approval,requires_step_up,blocked,policy_reason,updated_by)
      VALUES (UUID(),?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE autonomy_level=VALUES(autonomy_level),max_risk_score=VALUES(max_risk_score),requires_human_approval=VALUES(requires_human_approval),requires_step_up=VALUES(requires_step_up),blocked=VALUES(blocked),policy_reason=VALUES(policy_reason),updated_by=VALUES(updated_by)`,
      [key, autonomy, maxRisk, human ? 1 : 0, stepUp ? 1 : 0, blocked ? 1 : 0, reason, req.user.id]);
    await audit(req, 'AI_ACTION_POLICY_UPDATED', 'ai_policy', key, { autonomy_level: autonomy, max_risk_score: maxRisk, human_approval: human, step_up: stepUp, blocked });
    return res.json({ action_key: key, autonomy_level: autonomy, blocked });
  } catch (error) { next(error); }
};

exports.recordTrace = async (req, res, next) => {
  try {
    await ensureEnterpriseControlPlaneSchema();
    const job = text(req.body.job_reference, 120);
    const batch = text(req.body.batch_reference, 120);
    const type = upper(req.body.event_type);
    const asset = text(req.body.asset_reference, 160);
    const lot = text(req.body.material_lot, 120);
    const quality = upper(req.body.quality_status);
    const payload = req.body.event_payload && typeof req.body.event_payload === 'object' ? req.body.event_payload : {};
    if (!job || !type) return res.status(400).json({ message: 'Job reference and event type are required' });
    const canonical = JSON.stringify({ job, batch, type, asset, lot, quality, payload, actor: req.user.id });
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO manufacturing_trace_events
      (id,job_reference,batch_reference,event_type,asset_reference,material_lot,operator_user_id,quality_status,event_payload,integrity_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, job, batch || null, type, asset || null, lot || null, req.user.id, quality || null, JSON.stringify(payload), hash]);
    await audit(req, 'MANUFACTURING_TRACE_RECORDED', 'manufacturing_trace', id, { job_reference: job, batch_reference: batch || null, event_type: type, integrity_hash: hash });
    return res.status(201).json({ id, integrity_hash: hash });
  } catch (error) { next(error); }
};
