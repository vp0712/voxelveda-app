const crypto = require('crypto');
const { createDocumentPdf, sendPdfResponse } = require('../../services/documentPdfService');
const QRCode = require('qrcode');
const pool = require('../../config/db');
const { ensureQmsAdvancedSchema } = require('../../services/qmsAdvancedSchema');
const { ensureQmsQualityGovernanceSchema } = require('../../services/qmsQualityGovernanceSchema');
const { jobReleaseReadiness } = require('../../services/qmsGateService');
const { logAudit } = require('../../services/auditService');
const { hasAnyPermission } = require('../../services/authorizationService');

// Controlled statement from VV-FRM-023 Rev 1.0. Do not modify without a controlled source revision.
const COC_STATEMENT = 'Voxel Veda certifies that the items identified on this certificate were manufactured, processed and inspected in accordance with the purchase order, drawing revision and applicable requirements listed above, except for any specifically identified and approved concessions. Supporting records are retained in accordance with the applicable contract and Voxel Veda record-control requirements.';

function actor(req) { return Number(req.user?.id || req.user?.user_id || 0) || null; }
function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function sequence(prefix, id) { return `${prefix}-${new Date().getUTCFullYear()}-${String(id).padStart(6, '0')}`; }
function auditContext(req) { return { actorId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.id || req.get('x-request-id') || null, sessionId: req.session?.id || null }; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
async function ready() { await ensureQmsAdvancedSchema(); await ensureQmsQualityGovernanceSchema(); }

async function createConcession(req, res, next) {
  try {
    await ready();
    for (const key of ['affected_requirement', 'actual_condition', 'technical_justification', 'risk_assessment', 'validity_scope']) {
      if (!clean(req.body[key], 4000)) return res.status(400).json({ message: `${key} is required.` });
    }
    const [result] = await pool.query(
      `INSERT INTO concessions
       (concession_no,job_id,ncr_id,affected_requirement,actual_condition,affected_quantity,affected_lot,
        technical_justification,risk_assessment,validity_scope,customer_approval_required,valid_until,requested_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`PENDING-${crypto.randomUUID()}`,req.body.job_id || null, req.body.ncr_id || null, clean(req.body.affected_requirement, 2000), clean(req.body.actual_condition, 2000),
       req.body.affected_quantity ?? null, clean(req.body.affected_lot, 120) || null, clean(req.body.technical_justification, 4000),
       clean(req.body.risk_assessment, 4000), clean(req.body.validity_scope, 2000), req.body.customer_approval_required ? 1 : 0,
       req.body.valid_until || null, actor(req)]
    );
    const concessionNo = sequence('CON', result.insertId);
    await pool.query('UPDATE concessions SET concession_no=? WHERE id=?', [concessionNo, result.insertId]);
    await logAudit(pool, { ...auditContext(req), action: 'CONCESSION_CREATED', module: 'QMS', recordType: 'CONCESSION', recordId: concessionNo, newValue: { jobId: req.body.job_id || null, customerApprovalRequired: Boolean(req.body.customer_approval_required) } });
    return res.status(201).json({ id: result.insertId, concession_no: concessionNo, status: 'DRAFT' });
  } catch (error) { return next(error); }
}

async function listConcessions(req,res,next){
  try { await ready(); return res.json(await require('../../services/qmsRegisterService').listRegister(req,'concessions')); } catch(error) { return next(error); }
}

async function approveConcession(req, res, next) {
  if(!hasAnyPermission(req.user,['APPROVE_CONCESSION','MANAGE_QMS']))return res.status(403).json({message:'Explicit concession approval authority is required.'});
  try {
    await ready();
    const [[concession]] = await pool.query('SELECT * FROM concessions WHERE id=?', [req.params.id]);
    if (!concession) return res.status(404).json({ message: 'Concession not found.' });
    if (!['DRAFT', 'INTERNAL_REVIEW', 'CUSTOMER_REVIEW'].includes(concession.status)) return res.status(409).json({ message: 'Concession is not approvable in its current state.' });
    if (Number(concession.requested_by) === actor(req)) return res.status(409).json({ message: 'Separation of duties: requester cannot provide final concession approval.' });
    const customerRef = clean(req.body.customer_approval_ref, 255);
    if (concession.customer_approval_required && !customerRef) return res.status(409).json({ message: 'Customer approval evidence/reference is required.' });
    if (concession.valid_until && new Date(concession.valid_until) < new Date(new Date().toDateString())) return res.status(409).json({ message: 'Concession validity has expired.' });
    await pool.query("UPDATE concessions SET status='APPROVED',internally_approved_by=?,internally_approved_at=NOW(),approved_by=?,approved_at=NOW(),customer_approval_ref=COALESCE(NULLIF(?,''),customer_approval_ref) WHERE id=?", [actor(req), actor(req), customerRef, concession.id]);
    await logAudit(pool, { ...auditContext(req), action: 'CONCESSION_APPROVED', module: 'QMS', recordType: 'CONCESSION', recordId: concession.concession_no, newValue: { customerApprovalRef: customerRef || null } });
    return res.json({ id: concession.id, status: 'APPROVED' });
  } catch (error) { return next(error); }
}

async function releaseJob(req,res,next) {
  if(!hasAnyPermission(req.user,['QUALITY_RELEASE','MANAGE_QMS']))return res.status(403).json({message:'Explicit final product release authority is required.'});
  let connection;
  try {
    await ready();const jobId=Number(req.params.id);
    if(!Number.isSafeInteger(jobId)||jobId<=0)return res.status(400).json({message:'Choose a valid manufacturing job.'});
    connection=await pool.getConnection();await connection.beginTransaction();
    const [[job]]=await connection.query('SELECT * FROM manufacturing_jobs WHERE id=? FOR UPDATE',[jobId]);
    if(!job){await connection.rollback();return res.status(404).json({message:'Manufacturing job not found.'});}
    const quantity=Number(req.body.quantity_released??job.quantity??0);
    if(!Number.isFinite(quantity)||quantity<=0||quantity>=100000000000000||!/^\d+(?:\.\d{1,4})?$/.test(String(req.body.quantity_released??job.quantity??0))){await connection.rollback();return res.status(400).json({message:'Enter a positive finite release quantity with at most four decimal places.',fields:{quantity_released:'Enter a positive quantity with at most four decimal places'}});}
    if(job.quantity!=null&&quantity>Number(job.quantity)){await connection.rollback();return res.status(409).json({message:'Released quantity cannot exceed the authorised job quantity.',code:'RELEASE_QUANTITY_EXCEEDED'});}
    const [[existing]]=await connection.query('SELECT * FROM production_releases WHERE job_id=? ORDER BY id DESC LIMIT 1',[job.id]);
    if(existing){if(Number(existing.quantity_released)!==quantity){await connection.rollback();return res.status(409).json({message:'This job already has a release for a different quantity. Review its retained release record.',code:'RELEASE_ALREADY_EXISTS'});}await connection.commit();return res.json({id:existing.id,release_no:existing.release_no,integrity_hash:existing.release_integrity_hash,unchanged:true});}
    if(['QUALITY_HOLD','CANCELLED','PACKING','DISPATCHED','COMPLETE','FINAL_RELEASE'].includes(job.status)){await connection.rollback();return res.status(409).json({message:'The current job status does not permit a new final release.',code:'RELEASE_STATUS_INVALID'});}
    const gate=await jobReleaseReadiness(job.id,connection);
    if(!gate.allowed){await connection.rollback();return res.status(409).json({code:'QUALITY_RELEASE_BLOCKED',message:'Job is not ready for final release.',reasons:gate.reasons});}
    const [[finalInspection]]=await connection.query("SELECT ir.* FROM inspection_runs ir JOIN inspection_plans ip ON ip.id=ir.inspection_plan_id WHERE ir.job_id=? AND ip.inspection_type='FINAL' AND ir.status='APPROVED' ORDER BY ir.completed_at DESC LIMIT 1 FOR UPDATE",[job.id]);
    if(!finalInspection){await connection.rollback();return res.status(409).json({message:'An approved final inspection is required before product release.'});}
    const [approvedConcessions]=await connection.query("SELECT concession_no FROM concessions WHERE job_id=? AND status='APPROVED' AND (valid_until IS NULL OR valid_until>=CURDATE())",[job.id]);
    const concessionRefs=approvedConcessions.map((row)=>row.concession_no),releasedAt=new Date().toISOString();
    const integrity=fingerprint({jobId:job.id,jobNo:job.job_no,quantity,finalInspectionRunId:finalInspection.id,concessions:concessionRefs,releasedBy:actor(req),releasedAt});
    const [result]=await connection.query('INSERT INTO production_releases(release_no,job_id,quantity_released,final_inspection_run_id,concession_ref,released_by,release_integrity_hash) VALUES(?,?,?,?,?,?,?)',[`PENDING-${crypto.randomUUID()}`,job.id,quantity,finalInspection.id,concessionRefs.join(', ')||null,actor(req),integrity]);
    const releaseNo=sequence('REL',result.insertId);
    await connection.query('UPDATE production_releases SET release_no=? WHERE id=?',[releaseNo,result.insertId]);await connection.query("UPDATE manufacturing_jobs SET status='FINAL_RELEASE' WHERE id=?",[job.id]);
    await logAudit(connection,{...auditContext(req),action:'FINAL_PRODUCT_RELEASED',module:'QMS',recordType:'PRODUCTION_RELEASE',recordId:releaseNo,newValue:{jobNo:job.job_no,quantity,finalInspection:finalInspection.run_no,concessions:concessionRefs,integrity}});
    await connection.commit();return res.status(201).json({id:result.insertId,release_no:releaseNo,integrity_hash:integrity,concessions:concessionRefs});
  }catch(error){if(connection)await connection.rollback().catch(()=>{});return next(error);}finally{if(connection)connection.release();}
}

async function issueCoc(req, res, next) {
  if(!hasAnyPermission(req.user,['ISSUE_COC','QUALITY_RELEASE','MANAGE_QMS']))return res.status(403).json({message:'Explicit certificate issue authority is required.'});
  try {
    await ready();
    const [[release]] = await pool.query(
      `SELECT
         pr.id AS production_release_id, pr.release_no, pr.job_id, pr.quantity_released,
         pr.final_inspection_run_id, pr.release_integrity_hash, pr.released_by, pr.released_at,
         j.job_no, j.customer_id, j.customer_po, j.part_no, j.part_description,
         j.drawing_no, j.drawing_revision, j.sector
       FROM production_releases pr
       JOIN manufacturing_jobs j ON j.id=pr.job_id
       WHERE pr.id=? LIMIT 1`,
      [req.body.production_release_id]
    );
    if (!release) return res.status(404).json({ message: 'Production release not found.' });
    const [[existing]] = await pool.query('SELECT id,coc_no FROM certificates_of_conformance WHERE production_release_id=? AND voided_at IS NULL LIMIT 1', [release.production_release_id]);
    if (existing) return res.json({ message: 'The existing validated CoC was returned.', id: existing.id, coc_no: existing.coc_no, unchanged: true });

    const [materials] = await pool.query(
      `SELECT ml.lot_no,ml.material_code,ml.grade,ml.supplier_lot,ml.certificate_ref
       FROM material_genealogy g JOIN material_lots ml ON ml.id=g.material_lot_id
       WHERE g.job_id=? GROUP BY ml.id ORDER BY ml.lot_no`, [release.job_id]
    );
    const [inspectionRows] = await pool.query(
      `SELECT ir.run_no,ip.inspection_type FROM inspection_runs ir JOIN inspection_plans ip ON ip.id=ir.inspection_plan_id
       WHERE ir.job_id=? AND ir.status='APPROVED' ORDER BY ir.id`, [release.job_id]
    );
    const finalInspection = inspectionRows.find((row) => row.inspection_type === 'FINAL');
    if (!finalInspection) return res.status(409).json({ message: 'Approved final inspection evidence is required before issuing a CoC.' });
    const fai = inspectionRows.find((row) => row.inspection_type === 'FAI');
    const [concessions] = await pool.query("SELECT concession_no FROM concessions WHERE job_id=? AND status='APPROVED' AND (valid_until IS NULL OR valid_until>=CURDATE()) ORDER BY concession_no", [release.job_id]);
    const concessionRefs = concessions.map((row) => row.concession_no);
    const manufacturingProcess = clean(req.body.manufacturing_process, 1000);
    const applicableSpecifications = clean(req.body.applicable_specifications, 2000);
    if (!manufacturingProcess || !applicableSpecifications) return res.status(400).json({ message: 'manufacturing_process and applicable_specifications are required for VV-FRM-023.' });

    const authoritativePayload = {
      sourceDocument: 'VV-FRM-023', sourceRevision: '1.0', productionReleaseId: release.production_release_id,
      releaseNo: release.release_no, releaseIntegrityHash: release.release_integrity_hash, jobId: release.job_id,
      jobNo: release.job_no, customerId: release.customer_id, customerPo: release.customer_po,
      partNo: release.part_no, partDescription: release.part_description, drawingNo: release.drawing_no,
      drawingRevision: release.drawing_revision, quantity: Number(release.quantity_released), materials,
      manufacturingProcess, applicableSpecifications, inspections: inspectionRows, fai: fai?.run_no || null,
      concessions: concessionRefs, statement: COC_STATEMENT, issuedBy: actor(req)
    };
    const integrity = fingerprint(authoritativePayload);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT id FROM production_releases WHERE id=? FOR UPDATE',[release.production_release_id]);
      const [[currentCoc]]=await connection.query('SELECT id,coc_no FROM certificates_of_conformance WHERE production_release_id=? AND voided_at IS NULL LIMIT 1',[release.production_release_id]);
      if(currentCoc){await connection.commit();return res.json({id:currentCoc.id,coc_no:currentCoc.coc_no,unchanged:true});}
      const [result] = await connection.query(
        `INSERT INTO certificates_of_conformance
         (coc_no,job_id,production_release_id,customer_id,customer_po,part_no,part_description,drawing_no,drawing_revision,
          quantity,material_trace_json,manufacturing_process,applicable_specifications,inspection_refs_json,fai_ref,
          concession_refs_json,conformity_statement,integrity_hash,issued_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`PENDING-${crypto.randomUUID()}`,release.job_id, release.production_release_id, release.customer_id, release.customer_po, release.part_no,
         release.part_description, release.drawing_no, release.drawing_revision, release.quantity_released,
         JSON.stringify(materials), manufacturingProcess, applicableSpecifications, JSON.stringify(inspectionRows),
         fai?.run_no || null, JSON.stringify(concessionRefs), COC_STATEMENT, integrity, actor(req)]
      );
      const cocNo = sequence('COC', result.insertId);
      await connection.query('UPDATE certificates_of_conformance SET coc_no=? WHERE id=?', [cocNo, result.insertId]);
      await logAudit(connection, { ...auditContext(req), action: 'COC_ISSUED', module: 'QMS', recordType: 'VV-FRM-023', recordId: cocNo, newValue: { jobNo: release.job_no, releaseNo: release.release_no, productionReleaseId: release.production_release_id, integrity, sourceRevision: '1.0' } });
      await connection.commit();
      return res.status(201).json({ id: result.insertId, coc_no: cocNo, revision: 1, integrity_hash: integrity, source_document: 'VV-FRM-023', source_revision: '1.0' });
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  } catch (error) { return next(error); }
}

async function listCocs(req,res,next){
  try { await ready(); return res.json(await require('../../services/qmsRegisterService').listRegister(req,'cocs')); } catch(error) { return next(error); }
}

async function cocPdf(req, res, next) {
  try {
    await ready();
    const [[coc]] = await pool.query('SELECT c.*,j.job_no FROM certificates_of_conformance c JOIN manufacturing_jobs j ON j.id=c.job_id WHERE c.id=? OR c.coc_no=? ORDER BY c.revision DESC LIMIT 1', [req.params.id, req.params.id]);
    if (!coc) return res.status(404).json({ message: 'CoC not found.' });
    const inspectionRefs = typeof coc.inspection_refs_json === 'string' ? JSON.parse(coc.inspection_refs_json) : (coc.inspection_refs_json || []);
    const concessionRefs = typeof coc.concession_refs_json === 'string' ? JSON.parse(coc.concession_refs_json) : (coc.concession_refs_json || []);
    const data = { title: 'CERTIFICATE OF CONFORMANCE', reference: coc.coc_no, issueDate: coc.issued_at, filename: coc.coc_no,
      columns: [{label:'Field',width:2},{label:'Value',width:5}], rows: [
        ['Job reference', coc.job_no], ['Customer PO',coc.customer_po], ['Part / description',[coc.part_no,coc.part_description].filter(Boolean).join(' - ')],
        ['Drawing / revision',[coc.drawing_no,coc.drawing_revision].filter(Boolean).join(' / ')], ['Quantity',coc.quantity],
        ['Manufacturing process',coc.manufacturing_process],['Applicable specifications',coc.applicable_specifications],['FAI reference',coc.fai_ref],
        ['Inspection references',inspectionRefs.map(row=>row.run_no).join(', ')],['Approved concessions',concessionRefs.join(', ') || 'None identified'] ],
      notes: ['VV-FRM-023 | Controlled quality document | Revision 1.0', COC_STATEMENT, coc.voided_at ? 'VOID - this certificate is no longer valid.' : ''] .filter(Boolean) };
    return await sendPdfResponse(res, await createDocumentPdf(data), Boolean(req.query.download));

  } catch (error) { return next(error); }
}

async function verifyCoc(req, res, next) {
  try {
    await ready();
    const [[coc]] = await pool.query('SELECT coc_no,revision,integrity_hash,issued_at,voided_at FROM certificates_of_conformance WHERE coc_no=? ORDER BY revision DESC LIMIT 1', [req.params.no]);
    if (!coc) return res.status(404).json({ valid: false, message: 'Certificate not found.' });
    const supplied = clean(req.query.hash, 64);
    const integrityMatch = !supplied || supplied === coc.integrity_hash;
    return res.json({ valid: !coc.voided_at && integrityMatch, coc_no: coc.coc_no, revision: coc.revision, integrity_match: integrityMatch, voided: Boolean(coc.voided_at), issued_at: coc.issued_at });
  } catch (error) { return next(error); }
}

module.exports = { createConcession, listConcessions, approveConcession, releaseJob, issueCoc, listCocs, cocPdf, verifyCoc, COC_STATEMENT };
