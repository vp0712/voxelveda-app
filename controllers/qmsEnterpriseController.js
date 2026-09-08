const crypto = require('crypto');
const pool = require('../config/db');
const { ensureQmsEnterpriseCompletionSchema } = require('../services/qmsEnterpriseCompletionSchema');
const { ensureQmsAdvancedSchema } = require('../services/qmsAdvancedSchema');
const { ensureQmsQualityGovernanceSchema } = require('../services/qmsQualityGovernanceSchema');
const { logAudit } = require('../services/auditService');

function actor(req) { return Number(req.user?.id || req.user?.user_id || 0) || null; }
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function sequence(prefix, id) { return `${prefix}-${new Date().getUTCFullYear()}-${String(id).padStart(6, '0')}`; }
function auditContext(req) {
  return {
    actorId: actor(req),
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.id || req.get('x-request-id') || null,
    sessionId: req.session?.id || null
  };
}
async function ready() {
  await ensureQmsAdvancedSchema();
  await ensureQmsQualityGovernanceSchema();
  await ensureQmsEnterpriseCompletionSchema();
}

async function count(sql, params = []) {
  const [[row]] = await pool.query(sql, params);
  return Number(row?.n || 0);
}

async function commandCentre(req, res, next) {
  try {
    await ready();
    const metrics = {
      openNcr: await count("SELECT COUNT(*) n FROM ncrs WHERE status<>'CLOSED'"),
      openCapa: await count("SELECT COUNT(*) n FROM capas WHERE status<>'CLOSED'"),
      qualityHolds: await count('SELECT COUNT(*) n FROM quality_holds WHERE active=1'),
      overdueCalibration: await count("SELECT COUNT(*) n FROM measurement_equipment WHERE status IN ('EXPIRED','SUSPENDED','OUT_OF_TOLERANCE') OR (due_date IS NOT NULL AND due_date<CURDATE())"),
      overdueMaintenance: await count("SELECT COUNT(*) n FROM maintenance_work_orders WHERE status NOT IN('COMPLETE','CANCELLED') AND due_date IS NOT NULL AND due_date<CURDATE()"),
      trainingDue: await count("SELECT COUNT(*) n FROM employee_competencies WHERE status<>'VALID' OR (expires_at IS NOT NULL AND expires_at<=DATE_ADD(CURDATE(),INTERVAL 30 DAY))"),
      openScars: await count("SELECT COUNT(*) n FROM supplier_scars WHERE status<>'CLOSED'"),
      openAuditFindings: await count("SELECT COUNT(*) n FROM audit_findings WHERE status<>'CLOSED'"),
      documentReviewsDue: await count("SELECT COUNT(*) n FROM controlled_documents WHERE next_review_date IS NOT NULL AND next_review_date<=DATE_ADD(CURDATE(),INTERVAL 30 DAY)"),
      activeVisitors: await count('SELECT COUNT(*) n FROM site_visitors WHERE checked_out_at IS NULL'),
      openRegulatoryReviews: await count("SELECT COUNT(*) n FROM regulatory_reviews WHERE status IN('PENDING','UNDER_REVIEW','ESCALATED')"),
      unacknowledgedNotifications: await count('SELECT COUNT(*) n FROM qms_notifications WHERE acknowledged_at IS NULL')
    };
    return res.json({ metrics, generated_at: new Date().toISOString() });
  } catch (error) { return next(error); }
}

async function createAudit(req, res, next) {
  try {
    await ready();
    const title = clean(req.body.title, 255);
    if (!title) return res.status(400).json({ message: 'title is required.' });
    const [result] = await pool.query(
      'INSERT INTO internal_audits(audit_no,title,scope,criteria,auditor_user_id,area_owner_user_id,scheduled_at,created_by) VALUES(NULL,?,?,?,?,?,?,?)',
      [title, clean(req.body.scope) || null, clean(req.body.criteria) || null, req.body.auditor_user_id || null, req.body.area_owner_user_id || null, req.body.scheduled_at || null, actor(req)]
    );
    const auditNo = sequence('AUD', result.insertId);
    await pool.query('UPDATE internal_audits SET audit_no=? WHERE id=?', [auditNo, result.insertId]);
    await logAudit(pool, { ...auditContext(req), action: 'QMS_AUDIT_CREATED', module: 'QMS', recordType: 'INTERNAL_AUDIT', recordId: auditNo, newValue: { title } });
    return res.status(201).json({ id: result.insertId, audit_no: auditNo, status: 'PLANNED' });
  } catch (error) { return next(error); }
}

async function listAudits(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query('SELECT * FROM internal_audits ORDER BY created_at DESC LIMIT 300');
    return res.json({ audits: rows });
  } catch (error) { return next(error); }
}

async function addAuditFinding(req, res, next) {
  try {
    await ready();
    const finding = clean(req.body.finding, 4000);
    if (!finding) return res.status(400).json({ message: 'finding is required.' });
    const findingType = clean(req.body.finding_type, 20).toUpperCase() || 'OFI';
    if (!['CONFORMITY','OFI','MINOR_NC','MAJOR_NC'].includes(findingType)) return res.status(400).json({ message: 'Invalid finding_type.' });
    const [[audit]] = await pool.query('SELECT id FROM internal_audits WHERE id=?', [req.params.id]);
    if (!audit) return res.status(404).json({ message: 'Internal audit not found.' });
    const [result] = await pool.query(
      'INSERT INTO audit_findings(audit_id,finding_no,finding_type,requirement_ref,evidence,finding,capa_id,owner_user_id,due_date,created_by) VALUES(?,NULL,?,?,?,?,?,?,?,?)',
      [audit.id, findingType, clean(req.body.requirement_ref, 255) || null, clean(req.body.evidence) || null, finding, req.body.capa_id || null, req.body.owner_user_id || null, req.body.due_date || null, actor(req)]
    );
    const findingNo = sequence('FND', result.insertId);
    await pool.query('UPDATE audit_findings SET finding_no=? WHERE id=?', [findingNo, result.insertId]);
    return res.status(201).json({ id: result.insertId, finding_no: findingNo, status: 'OPEN' });
  } catch (error) { return next(error); }
}

async function createManagementReview(req, res, next) {
  try {
    await ready();
    const title = clean(req.body.title, 255) || 'Management Review';
    const inputs = {
      customer_feedback: req.body.customer_feedback || null,
      quality_kpis: req.body.quality_kpis || null,
      ncr_capa_trends: req.body.ncr_capa_trends || null,
      supplier_performance: req.body.supplier_performance || null,
      audit_results: req.body.audit_results || null,
      resources_capacity: req.body.resources_capacity || null,
      risks_opportunities: req.body.risks_opportunities || null,
      qms_changes: req.body.qms_changes || null,
      improvements: req.body.improvements || null
    };
    const [result] = await pool.query(
      "INSERT INTO management_reviews(review_no,title,period_start,period_end,scheduled_at,status,inputs_json,chair_user_id,created_by) VALUES(NULL,?,?,?,?, 'DRAFT',?,?,?)",
      [title, req.body.period_start || null, req.body.period_end || null, req.body.scheduled_at || null, JSON.stringify(inputs), req.body.chair_user_id || null, actor(req)]
    );
    const reviewNo = sequence('MR', result.insertId);
    await pool.query('UPDATE management_reviews SET review_no=? WHERE id=?', [reviewNo, result.insertId]);
    return res.status(201).json({ id: result.insertId, review_no: reviewNo, status: 'DRAFT' });
  } catch (error) { return next(error); }
}

async function listManagementReviews(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query('SELECT * FROM management_reviews ORDER BY created_at DESC LIMIT 200');
    return res.json({ reviews: rows });
  } catch (error) { return next(error); }
}

async function createChemical(req, res, next) {
  try {
    await ready();
    const productName = clean(req.body.product_name, 255);
    if (!productName) return res.status(400).json({ message: 'product_name is required.' });
    const [result] = await pool.query(
      'INSERT INTO chemical_products(chemical_code,product_name,manufacturer,supplier_id,hazard_classification,dg_classification,maximum_quantity,current_quantity,unit,storage_location,ppe_requirements,spill_controls,responsible_user_id) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?)',
      [productName, clean(req.body.manufacturer,255)||null, req.body.supplier_id||null, clean(req.body.hazard_classification,500)||null, clean(req.body.dg_classification,255)||null, req.body.maximum_quantity??null, req.body.current_quantity??0, clean(req.body.unit,30)||null, clean(req.body.storage_location,255)||null, clean(req.body.ppe_requirements)||null, clean(req.body.spill_controls)||null, req.body.responsible_user_id||null]
    );
    const chemicalCode = sequence('CHEM', result.insertId);
    await pool.query('UPDATE chemical_products SET chemical_code=? WHERE id=?', [chemicalCode, result.insertId]);
    return res.status(201).json({ id: result.insertId, chemical_code: chemicalCode, status: 'ACTIVE' });
  } catch (error) { return next(error); }
}

async function listChemicals(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query(`SELECT c.*,s.version_label sds_version,s.issue_date sds_issue_date,s.review_due sds_review_due,s.status sds_status
      FROM chemical_products c
      LEFT JOIN sds_versions s ON s.id=(SELECT s2.id FROM sds_versions s2 WHERE s2.chemical_id=c.id ORDER BY s2.id DESC LIMIT 1)
      ORDER BY c.product_name`);
    const warnings = rows
      .filter((row) => row.maximum_quantity !== null && Number(row.current_quantity) > Number(row.maximum_quantity))
      .map((row) => ({ chemical_code: row.chemical_code, message: 'Configured internal maximum quantity exceeded; compliance review required.' }));
    return res.json({ chemicals: rows, warnings, advisory: 'Automated quantity warnings are internal review triggers and are not definitive legal or dangerous-goods advice.' });
  } catch (error) { return next(error); }
}

async function checkInVisitor(req, res, next) {
  try {
    await ready();
    const visitorName = clean(req.body.visitor_name, 255);
    if (!visitorName) return res.status(400).json({ message: 'visitor_name is required.' });
    const uuid = crypto.randomUUID();
    const visitorType = clean(req.body.visitor_type, 20).toUpperCase() === 'CONTRACTOR' ? 'CONTRACTOR' : 'VISITOR';
    const [result] = await pool.query(
      'INSERT INTO site_visitors(visit_uuid,visitor_name,company,visitor_type,host_user_id,purpose,nda_required,induction_required,induction_completed,permitted_zones_json,badge_no,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuid, visitorName, clean(req.body.company,255)||null, visitorType, req.body.host_user_id||null, clean(req.body.purpose,1000)||null, req.body.nda_required?1:0, req.body.induction_required?1:0, req.body.induction_completed?1:0, JSON.stringify(req.body.permitted_zones||[]), clean(req.body.badge_no,80)||null, actor(req)]
    );
    return res.status(201).json({ id: result.insertId, visit_uuid: uuid, checked_in: true });
  } catch (error) { return next(error); }
}

async function checkOutVisitor(req, res, next) {
  try {
    await ready();
    const [result] = await pool.query('UPDATE site_visitors SET checked_out_at=NOW() WHERE id=? AND checked_out_at IS NULL', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Active visitor record not found.' });
    return res.json({ id: Number(req.params.id), checked_out: true });
  } catch (error) { return next(error); }
}

async function activeVisitors(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query('SELECT * FROM site_visitors WHERE checked_out_at IS NULL ORDER BY checked_in_at');
    return res.json({ visitors: rows });
  } catch (error) { return next(error); }
}

async function startEmergency(req, res, next) {
  try {
    await ready();
    const title = clean(req.body.title, 255) || 'Emergency / Evacuation';
    const requestedType = clean(req.body.event_type, 30).toUpperCase();
    const eventType = ['DRILL','EVACUATION','FIRE','CHEMICAL_SPILL','OTHER'].includes(requestedType) ? requestedType : 'OTHER';
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query('INSERT INTO emergency_events(event_no,event_type,title,assembly_point,started_by) VALUES(NULL,?,?,?,?)', [eventType, title, clean(req.body.assembly_point,255)||null, actor(req)]);
      const eventNo = sequence('EMG', result.insertId);
      await connection.query('UPDATE emergency_events SET event_no=? WHERE id=?', [eventNo, result.insertId]);
      const [visitors] = await connection.query('SELECT id,visitor_name,visitor_type FROM site_visitors WHERE checked_out_at IS NULL');
      for (const visitor of visitors) {
        await connection.query('INSERT IGNORE INTO emergency_rollcall(emergency_event_id,person_type,person_ref,display_name) VALUES(?,?,?,?)', [result.insertId, visitor.visitor_type, String(visitor.id), visitor.visitor_name]);
      }
      const [staff] = await connection.query('SELECT id,name FROM users WHERE active=1 AND deleted_at IS NULL ORDER BY name');
      for (const user of staff) {
        await connection.query('INSERT IGNORE INTO emergency_rollcall(emergency_event_id,person_type,person_ref,display_name) VALUES(?,?,?,?)', [result.insertId, 'STAFF', String(user.id), user.name || `User ${user.id}`]);
      }
      await logAudit(connection, { ...auditContext(req), action: 'EMERGENCY_EVENT_STARTED', module: 'QMS', recordType: 'EMERGENCY_EVENT', recordId: eventNo, newValue: { eventType, rollcallCount: visitors.length + staff.length } });
      await connection.commit();
      return res.status(201).json({ id: result.insertId, event_no: eventNo, status: 'ACTIVE', rollcall_count: visitors.length + staff.length });
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  } catch (error) { return next(error); }
}

async function emergencyRollcall(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query('SELECT * FROM emergency_rollcall WHERE emergency_event_id=? ORDER BY person_type,display_name', [req.params.id]);
    const summary = rows.reduce((acc, row) => { acc.total += 1; if (row.accounted) acc.accounted += 1; else acc.missing += 1; return acc; }, { total: 0, accounted: 0, missing: 0 });
    return res.json({ rollcall: rows, summary });
  } catch (error) { return next(error); }
}

async function markAccounted(req, res, next) {
  try {
    await ready();
    const [result] = await pool.query('UPDATE emergency_rollcall SET accounted=1,accounted_by=?,accounted_at=NOW() WHERE emergency_event_id=? AND id=?', [actor(req), req.params.id, req.params.itemId]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Roll-call item not found for this emergency.' });
    return res.json({ accounted: true });
  } catch (error) { return next(error); }
}

async function createCriticalService(req, res, next) {
  try {
    await ready();
    const serviceName = clean(req.body.service_name, 255);
    if (!serviceName) return res.status(400).json({ message: 'service_name is required.' });
    const criticality = clean(req.body.criticality, 20).toUpperCase() || 'MEDIUM';
    if (!['LOW','MEDIUM','HIGH','CRITICAL'].includes(criticality)) return res.status(400).json({ message: 'Invalid criticality.' });
    const [result] = await pool.query(
      'INSERT INTO critical_services(service_code,service_name,owner_user_id,criticality,rto_minutes,rpo_minutes,dependency_json,alternate_method) VALUES(NULL,?,?,?,?,?,?,?)',
      [serviceName, req.body.owner_user_id||null, criticality, req.body.rto_minutes??null, req.body.rpo_minutes??null, JSON.stringify(req.body.dependencies||[]), clean(req.body.alternate_method)||null]
    );
    const serviceCode = sequence('SVC', result.insertId);
    await pool.query('UPDATE critical_services SET service_code=? WHERE id=?', [serviceCode, result.insertId]);
    return res.status(201).json({ id: result.insertId, service_code: serviceCode });
  } catch (error) { return next(error); }
}

async function listContinuity(req, res, next) {
  try {
    await ready();
    const [services] = await pool.query('SELECT * FROM critical_services ORDER BY FIELD(criticality,\'CRITICAL\',\'HIGH\',\'MEDIUM\',\'LOW\'),service_name');
    const [exercises] = await pool.query('SELECT * FROM continuity_exercises ORDER BY performed_at DESC LIMIT 200');
    return res.json({ services, exercises, assurance_note: 'Backup/restore configuration is not treated as successful evidence unless an actual exercise/evidence record exists.' });
  } catch (error) { return next(error); }
}

async function recordContinuityExercise(req, res, next) {
  try {
    await ready();
    const scenario = clean(req.body.scenario);
    if (!scenario) return res.status(400).json({ message: 'scenario is required.' });
    const exerciseType = clean(req.body.exercise_type, 30).toUpperCase() || 'TABLETOP';
    const exerciseResult = clean(req.body.result, 20).toUpperCase() || 'PARTIAL';
    if (!['TABLETOP','RESTORE_TEST','FAILOVER','SUPPLIER','MACHINE'].includes(exerciseType)) return res.status(400).json({ message: 'Invalid exercise_type.' });
    if (!['PASSED','PARTIAL','FAILED'].includes(exerciseResult)) return res.status(400).json({ message: 'Invalid result.' });
    const [result] = await pool.query(
      'INSERT INTO continuity_exercises(exercise_no,service_id,exercise_type,scenario,result,actual_rto_minutes,actual_rpo_minutes,evidence_ref,lessons,performed_by,next_due) VALUES(NULL,?,?,?,?,?,?,?,?,?,?)',
      [req.body.service_id||null, exerciseType, scenario, exerciseResult, req.body.actual_rto_minutes??null, req.body.actual_rpo_minutes??null, clean(req.body.evidence_ref,255)||null, clean(req.body.lessons)||null, actor(req), req.body.next_due||null]
    );
    const exerciseNo = sequence('BCP', result.insertId);
    await pool.query('UPDATE continuity_exercises SET exercise_no=? WHERE id=?', [exerciseNo, result.insertId]);
    return res.status(201).json({ id: result.insertId, exercise_no: exerciseNo });
  } catch (error) { return next(error); }
}

async function createRegulatoryReview(req, res, next) {
  try {
    await ready();
    const requestedSector = clean(req.body.sector, 20).toUpperCase();
    const sector = ['GENERAL','AEROSPACE','DEFENCE','MEDICAL','AUTOMOTIVE','OTHER'].includes(requestedSector) ? requestedSector : 'GENERAL';
    const flags = {
      sensitive_technical_data: Boolean(req.body.sensitive_technical_data),
      export_review_required: Boolean(req.body.export_review_required),
      customer_confidential: Boolean(req.body.customer_confidential),
      medical_review_required: Boolean(req.body.medical_review_required),
      aerospace_quality_requirements: Boolean(req.body.aerospace_quality_requirements)
    };
    const status = (flags.export_review_required || flags.medical_review_required || sector === 'DEFENCE') ? 'ESCALATED' : 'PENDING';
    const [result] = await pool.query(
      'INSERT INTO regulatory_reviews(review_no,job_id,rfq_id,sector,sensitive_technical_data,export_review_required,customer_confidential,medical_review_required,aerospace_quality_requirements,status,created_by) VALUES(NULL,?,?,?,?,?,?,?,?,?,?)',
      [req.body.job_id||null, req.body.rfq_id||null, sector, flags.sensitive_technical_data?1:0, flags.export_review_required?1:0, flags.customer_confidential?1:0, flags.medical_review_required?1:0, flags.aerospace_quality_requirements?1:0, status, actor(req)]
    );
    const reviewNo = sequence('REG', result.insertId);
    await pool.query('UPDATE regulatory_reviews SET review_no=? WHERE id=?', [reviewNo, result.insertId]);
    return res.status(201).json({ id: result.insertId, review_no: reviewNo, status, sector, certification_claims: false });
  } catch (error) { return next(error); }
}

async function listRegulatoryReviews(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query('SELECT * FROM regulatory_reviews ORDER BY created_at DESC LIMIT 300');
    return res.json({ reviews: rows, notice: 'Sector/review gates do not represent ISO 9001, AS9100, ISO 13485, DISP, TGA/ARTG or export-control certification/approval.' });
  } catch (error) { return next(error); }
}

async function decideRegulatoryReview(req, res, next) {
  try {
    await ready();
    const status = clean(req.body.status, 30).toUpperCase();
    const decisionBasis = clean(req.body.decision_basis);
    if (!['CLEARED','RESTRICTED','ESCALATED'].includes(status)) return res.status(400).json({ message: 'status must be CLEARED, RESTRICTED or ESCALATED.' });
    if (!decisionBasis) return res.status(400).json({ message: 'decision_basis is required.' });
    const [result] = await pool.query('UPDATE regulatory_reviews SET status=?,decision_basis=?,reviewer_user_id=?,reviewed_at=NOW() WHERE id=?', [status, decisionBasis, actor(req), req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Regulatory review not found.' });
    await logAudit(pool, { ...auditContext(req), action: 'REGULATORY_REVIEW_DECIDED', module: 'QMS', recordType: 'REGULATORY_REVIEW', recordId: String(req.params.id), newValue: { status, decisionBasis: decisionBasis.slice(0,500) } });
    return res.json({ id: Number(req.params.id), status });
  } catch (error) { return next(error); }
}

async function generateNotifications(req, res, next) {
  try {
    await ready();
    let generated = 0;
    async function add(key, type, severity, title, body, recordType, recordId, dueAt) {
      const [result] = await pool.query(
        'INSERT IGNORE INTO qms_notifications(dedupe_key,notification_type,severity,title,body,record_type,record_id,due_at) VALUES(?,?,?,?,?,?,?,?)',
        [key, type, severity, title, body, recordType, recordId, dueAt || null]
      );
      generated += Number(result.affectedRows || 0);
    }
    const [calibration] = await pool.query("SELECT id,equipment_code,due_date FROM measurement_equipment WHERE due_date IS NOT NULL AND due_date<=DATE_ADD(CURDATE(),INTERVAL 30 DAY) AND status NOT IN('SUSPENDED','OUT_OF_TOLERANCE')");
    for (const row of calibration) await add(`cal:${row.id}:${row.due_date}`, 'CALIBRATION_DUE', new Date(row.due_date)<new Date()?'HIGH':'WARNING', `Calibration due: ${row.equipment_code}`, 'Measurement equipment requires calibration review.', 'MEASUREMENT_EQUIPMENT', String(row.id), row.due_date);
    const [maintenance] = await pool.query("SELECT id,work_order_no,due_date FROM maintenance_work_orders WHERE status NOT IN('COMPLETE','CANCELLED') AND due_date IS NOT NULL AND due_date<=DATE_ADD(CURDATE(),INTERVAL 14 DAY)");
    for (const row of maintenance) await add(`maint:${row.id}:${row.due_date}`, 'MAINTENANCE_DUE', new Date(row.due_date)<new Date()?'HIGH':'WARNING', `Maintenance due: ${row.work_order_no}`, 'Maintenance work order requires attention.', 'MAINTENANCE', String(row.id), row.due_date);
    const [capa] = await pool.query("SELECT id,capa_no,due_date FROM capas WHERE status<>'CLOSED' AND due_date IS NOT NULL AND due_date<=DATE_ADD(CURDATE(),INTERVAL 14 DAY)");
    for (const row of capa) await add(`capa:${row.id}:${row.due_date}`, 'CAPA_DUE', new Date(row.due_date)<new Date()?'HIGH':'WARNING', `CAPA due: ${row.capa_no}`, 'Corrective action requires review.', 'CAPA', String(row.id), row.due_date);
    const [training] = await pool.query("SELECT ec.id,ec.user_id,ec.expires_at,c.competency_code FROM employee_competencies ec JOIN competencies c ON c.id=ec.competency_id WHERE ec.expires_at IS NOT NULL AND ec.expires_at<=DATE_ADD(CURDATE(),INTERVAL 30 DAY) AND ec.status<>'SUSPENDED'");
    for (const row of training) await add(`training:${row.id}:${row.expires_at}`, 'TRAINING_DUE', new Date(row.expires_at)<new Date()?'HIGH':'WARNING', `Competency due: ${row.competency_code}`, 'Employee competency requires review or renewal.', 'EMPLOYEE_COMPETENCY', String(row.id), row.expires_at);
    const [scars] = await pool.query("SELECT id,scar_no,due_date FROM supplier_scars WHERE status<>'CLOSED' AND due_date IS NOT NULL AND due_date<=DATE_ADD(CURDATE(),INTERVAL 14 DAY)");
    for (const row of scars) await add(`scar:${row.id}:${row.due_date}`, 'SCAR_DUE', new Date(row.due_date)<new Date()?'HIGH':'WARNING', `SCAR due: ${row.scar_no}`, 'Supplier corrective action requires attention.', 'SCAR', String(row.id), row.due_date);
    const [documents] = await pool.query("SELECT id,document_id,next_review_date FROM controlled_documents WHERE next_review_date IS NOT NULL AND next_review_date<=DATE_ADD(CURDATE(),INTERVAL 30 DAY) AND status NOT IN('OBSOLETE','WITHDRAWN')");
    for (const row of documents) await add(`doc:${row.id}:${row.next_review_date}`, 'DOCUMENT_REVIEW_DUE', 'WARNING', `Document review due: ${row.document_id}`, 'Controlled document review is due.', 'CONTROLLED_DOCUMENT', String(row.id), row.next_review_date);
    const [sds] = await pool.query("SELECT s.id,s.chemical_id,s.review_due,c.chemical_code FROM sds_versions s JOIN chemical_products c ON c.id=s.chemical_id WHERE s.status='CURRENT' AND s.review_due IS NOT NULL AND s.review_due<=DATE_ADD(CURDATE(),INTERVAL 30 DAY)");
    for (const row of sds) await add(`sds:${row.id}:${row.review_due}`, 'SDS_REVIEW_DUE', 'WARNING', `SDS review due: ${row.chemical_code}`, 'Current SDS requires review.', 'SDS_VERSION', String(row.id), row.review_due);
    return res.json({ generated });
  } catch (error) { return next(error); }
}

async function listNotifications(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query("SELECT * FROM qms_notifications WHERE acknowledged_at IS NULL ORDER BY FIELD(severity,'CRITICAL','HIGH','WARNING','INFO'),COALESCE(due_at,created_at) ASC LIMIT 300");
    return res.json({ notifications: rows });
  } catch (error) { return next(error); }
}

async function acknowledgeNotification(req, res, next) {
  try {
    await ready();
    const [result] = await pool.query('UPDATE qms_notifications SET acknowledged_at=NOW(),acknowledged_by=? WHERE id=? AND acknowledged_at IS NULL', [actor(req), req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Open notification not found.' });
    return res.json({ acknowledged: true });
  } catch (error) { return next(error); }
}

async function recallImpact(req, res, next) {
  try {
    await ready();
    const materialLotId = Number(req.params.materialLotId);
    if (!Number.isInteger(materialLotId) || materialLotId <= 0) return res.status(400).json({ message: 'A valid material lot ID is required.' });
    const [[lot]] = await pool.query('SELECT * FROM material_lots WHERE id=?', [materialLotId]);
    if (!lot) return res.status(404).json({ message: 'Material lot not found.' });
    const [genealogy] = await pool.query(`SELECT g.*,j.job_no,j.customer_id,j.part_no,j.part_description,j.status job_status,b.build_no,s.serial_no
      FROM material_genealogy g
      LEFT JOIN manufacturing_jobs j ON j.id=g.job_id
      LEFT JOIN job_builds b ON b.id=g.build_id
      LEFT JOIN job_serials s ON s.id=g.serial_id
      WHERE g.material_lot_id=?`, [materialLotId]);
    const jobIds = [...new Set(genealogy.map((row) => Number(row.job_id)).filter(Boolean))];
    let releases = [];
    let cocs = [];
    if (jobIds.length) {
      const placeholders = jobIds.map(() => '?').join(',');
      [releases] = await pool.query(`SELECT id,release_no,job_id,quantity_released,released_at FROM production_releases WHERE job_id IN (${placeholders})`, jobIds);
      [cocs] = await pool.query(`SELECT id,coc_no,job_id,production_release_id,issued_at,voided_at FROM certificates_of_conformance WHERE job_id IN (${placeholders})`, jobIds);
    }
    const impact = {
      material_lot: { id: lot.id, lot_no: lot.lot_no, material_code: lot.material_code, supplier_lot: lot.supplier_lot, release_status: lot.release_status },
      jobs: genealogy,
      production_releases: releases,
      cocs,
      summary: {
        jobs: jobIds.length,
        builds: new Set(genealogy.map((row) => row.build_id).filter(Boolean)).size,
        serials: new Set(genealogy.map((row) => row.serial_no).filter(Boolean)).size,
        releases: releases.length,
        certificates: cocs.length,
        customers: new Set(genealogy.map((row) => row.customer_id).filter(Boolean)).size
      }
    };
    return res.json(impact);
  } catch (error) { return next(error); }
}

module.exports = {
  commandCentre,
  createAudit,
  listAudits,
  addAuditFinding,
  createManagementReview,
  listManagementReviews,
  createChemical,
  listChemicals,
  checkInVisitor,
  checkOutVisitor,
  activeVisitors,
  startEmergency,
  emergencyRollcall,
  markAccounted,
  createCriticalService,
  listContinuity,
  recordContinuityExercise,
  createRegulatoryReview,
  listRegulatoryReviews,
  decideRegulatoryReview,
  generateNotifications,
  listNotifications,
  acknowledgeNotification,
  recallImpact
};
