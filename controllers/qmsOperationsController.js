const crypto = require('crypto');
const pool = require('../config/db');
const { ensureQmsSchema } = require('../services/qmsSchema');
const { ensureQmsAdvancedSchema } = require('../services/qmsAdvancedSchema');
const { validateRecord } = require('../services/qmsValidationService');
const gates = require('../services/qmsGateService');
const { logAudit } = require('../services/auditService');

function actor(req) { return Number(req.user?.id || req.user?.user_id || 0) || null; }
function auditContext(req) {
  return { actorId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.id || req.get('x-request-id') || null, sessionId: req.session?.id || null };
}
function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function idNo(prefix, id) { return `${prefix}-${new Date().getUTCFullYear()}-${String(id).padStart(6, '0')}`; }

async function ready() { await ensureQmsSchema(); await ensureQmsAdvancedSchema(); }

async function dashboard(req, res, next) {
  try {
    await ready();
    const queries = {
      records: "SELECT COUNT(*) total,SUM(status='DRAFT') drafts,SUM(status='UNDER_REVIEW') under_review,SUM(status='APPROVED') approved FROM qms_records",
      holds: 'SELECT COUNT(*) total FROM quality_holds WHERE active=1',
      ncr: "SELECT COUNT(*) total,SUM(status<>'CLOSED') open_count,SUM(status<>'CLOSED' AND severity='CRITICAL') critical_open FROM ncrs",
      capa: "SELECT COUNT(*) total,SUM(status<>'CLOSED') open_count,SUM(status<>'CLOSED' AND due_date<CURDATE()) overdue FROM capas",
      calibration: "SELECT COUNT(*) total,SUM(status IN ('EXPIRED','SUSPENDED','OUT_OF_TOLERANCE') OR (due_date IS NOT NULL AND due_date<CURDATE())) blocked FROM measurement_equipment",
      maintenance: "SELECT COUNT(*) total,SUM(active=1 AND blocking_when_overdue=1 AND next_due_date<CURDATE()) overdue_blocking FROM maintenance_plans",
      competency: "SELECT COUNT(*) total,SUM(status<>'VALID' OR (expires_at IS NOT NULL AND expires_at<CURDATE())) invalid_or_expired FROM employee_competencies",
      jobs: "SELECT COUNT(*) total,SUM(status='QUALITY_HOLD') quality_hold,SUM(status='IN_PRODUCTION') in_production,SUM(status='FINAL_RELEASE') released FROM manufacturing_jobs"
    };
    const out = {};
    for (const [key, sql] of Object.entries(queries)) { const [[row]] = await pool.query(sql); out[key] = row || {}; }
    return res.json({ generated_at: new Date().toISOString(), ...out });
  } catch (error) { return next(error); }
}

async function listDefinitions(req, res, next) {
  try {
    await ready();
    const [rows] = await pool.query(`SELECT d.*,v.status version_status,v.definition_json,v.effective_at
      FROM qms_form_definitions d LEFT JOIN qms_form_definition_versions v ON v.form_definition_id=d.id AND v.revision=d.current_revision
      WHERE d.active=1 ORDER BY d.document_id`);
    return res.json({ definitions: rows });
  } catch (error) { return next(error); }
}

async function upsertDefinition(req, res, next) {
  try {
    await ready();
    const documentId = clean(req.body.document_id, 64); const title = clean(req.body.title, 255); const revision = clean(req.body.revision || '1.0', 32);
    const definition = req.body.definition && typeof req.body.definition === 'object' ? req.body.definition : null;
    if (!documentId || !title || !definition) return res.status(400).json({ message: 'document_id, title and definition are required.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`INSERT INTO qms_form_definitions(document_id,title,category,source_pack,current_revision) VALUES(?,?,?,?,?)
        ON DUPLICATE KEY UPDATE title=VALUES(title),category=VALUES(category),source_pack=VALUES(source_pack),current_revision=VALUES(current_revision),active=1`,
        [documentId,title,clean(req.body.category,80)||null,clean(req.body.source_pack,64)||null,revision]);
      const [[form]] = await connection.query('SELECT id FROM qms_form_definitions WHERE document_id=?', [documentId]);
      await connection.query(`INSERT INTO qms_form_definition_versions(form_definition_id,revision,definition_json,status,effective_at,approved_by)
        VALUES(?,?,?,'EFFECTIVE',NOW(),?) ON DUPLICATE KEY UPDATE definition_json=VALUES(definition_json),status='EFFECTIVE',effective_at=NOW(),approved_by=VALUES(approved_by)`,
        [form.id,revision,JSON.stringify(definition),actor(req)]);
      await logAudit(connection,{...auditContext(req),action:'QMS_FORM_DEFINITION_PUBLISHED',module:'QMS',recordType:'FORM_DEFINITION',recordId:documentId,newValue:{revision,fieldCount:Array.isArray(definition.fields)?definition.fields.length:0}});
      await connection.commit();
      return res.json({ document_id: documentId, revision, status: 'EFFECTIVE' });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } catch (error) { return next(error); }
}

async function validateValues(req, res, next) {
  try {
    await ready();
    const documentId = clean(req.body.document_id,64); const revision = clean(req.body.revision || '1.0',32);
    const [[row]] = await pool.query(`SELECT v.definition_json FROM qms_form_definitions d JOIN qms_form_definition_versions v ON v.form_definition_id=d.id
      WHERE d.document_id=? AND v.revision=? LIMIT 1`, [documentId,revision]);
    if (!row) return res.status(404).json({ message: 'Controlled form definition not found.' });
    const definition = typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json;
    return res.json(validateRecord(definition, req.body.values || {}));
  } catch (error) { return next(error); }
}

async function importLegacy(req, res, next) {
  try {
    await ready();
    const records = Array.isArray(req.body.records) ? req.body.records.slice(0,250) : [];
    if (!records.length) return res.status(400).json({ message: 'records array is required.' });
    const imported = []; const skipped = [];
    for (const legacy of records) {
      const documentId = clean(legacy.document_id || legacy.documentId || legacy.formId || 'LEGACY-FORM',64);
      const title = clean(legacy.document_title || legacy.title || 'Imported legacy controlled form',255);
      const values = legacy.values && typeof legacy.values === 'object' && !Array.isArray(legacy.values) ? legacy.values : legacy.data && typeof legacy.data === 'object' ? legacy.data : {};
      const clientId = clean(legacy.id || legacy.record_id || legacy.createdAt || '',120);
      const importHash = crypto.createHash('sha256').update(JSON.stringify({documentId,clientId,values})).digest('hex');
      const [[existing]] = await pool.query("SELECT qms_record_id FROM qms_record_comments WHERE comment_type='LEGACY_IMPORT_HASH' AND comment_text=? LIMIT 1", [importHash]);
      if (existing) { skipped.push({ client_id: clientId, reason: 'already imported' }); continue; }
      const uuid = crypto.randomUUID();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const sourceRevision = clean(legacy.source_revision || legacy.revision || '1.0',32);
        const integrity = crypto.createHash('sha256').update(JSON.stringify({documentId,sourceRevision,values})).digest('hex');
        const [result] = await connection.query('INSERT INTO qms_records(record_uuid,document_id,document_title,source_revision,values_json,owner_user_id,prepared_by,integrity_hash) VALUES(?,?,?,?,?,?,?,?)',[uuid,documentId,title,sourceRevision,JSON.stringify(values),actor(req),actor(req),integrity]);
        const recordNo=idNo('QMS',result.insertId);
        await connection.query('UPDATE qms_records SET record_no=? WHERE id=?',[recordNo,result.insertId]);
        await connection.query('INSERT INTO qms_record_revisions(qms_record_id,record_revision,status,values_json,integrity_hash,change_reason,changed_by) VALUES(?,1,\'DRAFT\',?,?,?,?)',[result.insertId,JSON.stringify(values),integrity,'Imported from browser-local legacy Company Forms data',actor(req)]);
        await connection.query("INSERT INTO qms_record_comments(qms_record_id,comment_text,comment_type,created_by) VALUES(?,?,'LEGACY_IMPORT_HASH',?)",[result.insertId,importHash,actor(req)]);
        await logAudit(connection,{...auditContext(req),action:'QMS_LEGACY_RECORD_IMPORTED',module:'QMS',recordType:documentId,recordId:recordNo,newValue:{clientId,sourceRevision}});
        await connection.commit(); imported.push({client_id:clientId,id:result.insertId,record_no:recordNo});
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
    return res.status(201).json({ imported, skipped, imported_count: imported.length, skipped_count: skipped.length });
  } catch (error) { return next(error); }
}

async function placeHold(req,res,next){
  try{await ready(); const entityType=clean(req.body.entity_type,40).toUpperCase(); const entityId=clean(req.body.entity_id,100); const reason=clean(req.body.reason,1000);
    if(!['MATERIAL_LOT','JOB','BUILD','SERIAL','SHIPMENT','QMS_RECORD'].includes(entityType)||!entityId||!reason)return res.status(400).json({message:'Valid entity_type, entity_id and reason are required.'});
    const [r]=await pool.query('INSERT INTO quality_holds(hold_no,entity_type,entity_id,reason,source_type,source_id,placed_by) VALUES(NULL,?,?,?,?,?,?)',[entityType,entityId,reason,clean(req.body.source_type,50)||null,clean(req.body.source_id,100)||null,actor(req)]);
    const no=idNo('QH',r.insertId); await pool.query('UPDATE quality_holds SET hold_no=? WHERE id=?',[no,r.insertId]);
    await logAudit(pool,{...auditContext(req),action:'QUALITY_HOLD_PLACED',module:'QMS',recordType:entityType,recordId:entityId,newValue:{holdNo:no,reason}});
    return res.status(201).json({id:r.insertId,hold_no:no,active:true});
  }catch(e){return next(e)}
}
async function releaseHold(req,res,next){
  try{await ready(); const reason=clean(req.body.reason,1000); if(!reason)return res.status(400).json({message:'release reason is required.'});
    const [[hold]]=await pool.query('SELECT * FROM quality_holds WHERE id=? AND active=1',[req.params.id]); if(!hold)return res.status(404).json({message:'Active quality hold not found.'});
    await pool.query('UPDATE quality_holds SET active=0,released_by=?,released_at=NOW(),release_reason=? WHERE id=?',[actor(req),reason,hold.id]);
    await logAudit(pool,{...auditContext(req),action:'QUALITY_HOLD_RELEASED',module:'QMS',recordType:hold.entity_type,recordId:hold.entity_id,newValue:{holdNo:hold.hold_no,reason}});
    return res.json({id:hold.id,hold_no:hold.hold_no,active:false});
  }catch(e){return next(e)}
}
async function listHolds(req,res,next){try{await ready();const [rows]=await pool.query('SELECT * FROM quality_holds WHERE (?=\'\' OR entity_type=?) AND (?=\'\' OR entity_id=?) ORDER BY active DESC,placed_at DESC LIMIT 500',[clean(req.query.entity_type,40),clean(req.query.entity_type,40),clean(req.query.entity_id,100),clean(req.query.entity_id,100)]);return res.json({holds:rows})}catch(e){return next(e)}}

async function createNcr(req,res,next){
  try{await ready(); const description=clean(req.body.description,4000); if(!description)return res.status(400).json({message:'description is required.'});
    const connection=await pool.getConnection(); try{await connection.beginTransaction(); const [r]=await connection.query(`INSERT INTO ncrs(ncr_no,severity,job_id,material_lot_id,build_id,inspection_run_id,supplier_id,description,containment,suspected_cause,created_by)
      VALUES(NULL,?,?,?,?,?,?,?,?,?,?)`,[clean(req.body.severity,20)||'MINOR',req.body.job_id||null,req.body.material_lot_id||null,req.body.build_id||null,req.body.inspection_run_id||null,req.body.supplier_id||null,description,clean(req.body.containment,4000)||null,clean(req.body.suspected_cause,2000)||null,actor(req)]);
      const no=idNo('NCR',r.insertId); await connection.query('UPDATE ncrs SET ncr_no=?,status=? WHERE id=?',[no,req.body.containment?'CONTAINED':'CONTAINMENT_REQUIRED',r.insertId]);
      let holdNo=null; if(req.body.place_hold&& (req.body.material_lot_id||req.body.job_id||req.body.build_id)){const type=req.body.material_lot_id?'MATERIAL_LOT':req.body.build_id?'BUILD':'JOB';const entity=String(req.body.material_lot_id||req.body.build_id||req.body.job_id);const [h]=await connection.query('INSERT INTO quality_holds(hold_no,entity_type,entity_id,reason,source_type,source_id,placed_by) VALUES(NULL,?,?,?,?,?,?)',[type,entity,`NCR ${no}: ${description.slice(0,700)}`,'NCR',String(r.insertId),actor(req)]);holdNo=idNo('QH',h.insertId);await connection.query('UPDATE quality_holds SET hold_no=? WHERE id=?',[holdNo,h.insertId]);}
      await logAudit(connection,{...auditContext(req),action:'NCR_CREATED',module:'QMS',recordType:'NCR',recordId:no,newValue:{severity:req.body.severity||'MINOR',holdNo}}); await connection.commit(); return res.status(201).json({id:r.insertId,ncr_no:no,hold_no:holdNo});
    }catch(e){await connection.rollback();throw e}finally{connection.release()}
  }catch(e){return next(e)}
}
async function listNcrs(req,res,next){try{await ready();const [rows]=await pool.query('SELECT * FROM ncrs ORDER BY created_at DESC LIMIT 500');return res.json({ncrs:rows})}catch(e){return next(e)}}
async function transitionNcr(req,res,next){
  const allowed={OPEN:['CONTAINMENT_REQUIRED','CONTAINED'],CONTAINMENT_REQUIRED:['CONTAINED'],CONTAINED:['INVESTIGATION'],INVESTIGATION:['DISPOSITION_REQUIRED'],DISPOSITION_REQUIRED:['REWORK','REINSPECTION','APPROVAL'],REWORK:['REINSPECTION'],REINSPECTION:['APPROVAL'],APPROVAL:['CLOSED']};
  try{await ready();const target=clean(req.body.status,40).toUpperCase();const [[ncr]]=await pool.query('SELECT * FROM ncrs WHERE id=?',[req.params.id]);if(!ncr)return res.status(404).json({message:'NCR not found.'});if(!(allowed[ncr.status]||[]).includes(target))return res.status(409).json({message:`Invalid NCR transition ${ncr.status} → ${target}.`});
    if(target==='CLOSED'&&!clean(req.body.closure_reason,1000))return res.status(400).json({message:'closure_reason is required.'});
    if(target==='APPROVAL'&&req.body.disposition){const d=clean(req.body.disposition,60);if(!['REWORK','SCRAP','RETURN_TO_SUPPLIER','REPAIR','USE_AS_IS_WITH_APPROVED_CONCESSION'].includes(d))return res.status(400).json({message:'Invalid NCR disposition.'});await pool.query('UPDATE ncrs SET disposition=?,concession_ref=? WHERE id=?',[d,clean(req.body.concession_ref,120)||null,ncr.id]);}
    await pool.query('UPDATE ncrs SET status=?,closed_by=IF(?=\'CLOSED\',?,closed_by),closed_at=IF(?=\'CLOSED\',NOW(),closed_at) WHERE id=?',[target,target,actor(req),target,ncr.id]);
    await logAudit(pool,{...auditContext(req),action:`NCR_${target}`,module:'QMS',recordType:'NCR',recordId:ncr.ncr_no,oldValue:{status:ncr.status},newValue:{status:target}});return res.json({id:ncr.id,ncr_no:ncr.ncr_no,status:target});
  }catch(e){return next(e)}
}

async function createCapa(req,res,next){
  try{await ready();const problem=clean(req.body.problem_statement,4000);if(!problem)return res.status(400).json({message:'problem_statement is required.'});const [r]=await pool.query('INSERT INTO capas(capa_no,source_type,source_id,problem_statement,containment,owner_user_id,due_date,created_by) VALUES(NULL,?,?,?,?,?,?,?)',[clean(req.body.source_type,50)||'MANUAL',clean(req.body.source_id,100)||null,problem,clean(req.body.containment,4000)||null,req.body.owner_user_id||actor(req),req.body.due_date||null,actor(req)]);const no=idNo('CAPA',r.insertId);await pool.query('UPDATE capas SET capa_no=? WHERE id=?',[no,r.insertId]);await logAudit(pool,{...auditContext(req),action:'CAPA_CREATED',module:'QMS',recordType:'CAPA',recordId:no,newValue:{sourceType:req.body.source_type||'MANUAL',dueDate:req.body.due_date||null}});return res.status(201).json({id:r.insertId,capa_no:no,status:'OPEN'});
  }catch(e){return next(e)}
}
async function listCapas(req,res,next){try{await ready();const [rows]=await pool.query('SELECT * FROM capas ORDER BY created_at DESC LIMIT 500');return res.json({capas:rows})}catch(e){return next(e)}}
async function addCapaAction(req,res,next){try{await ready();const text=clean(req.body.action_text,4000);if(!text)return res.status(400).json({message:'action_text is required.'});const [r]=await pool.query('INSERT INTO capa_actions(capa_id,action_type,action_text,owner_user_id,due_date) VALUES(?,?,?,?,?)',[req.params.id,clean(req.body.action_type,20)||'CORRECTIVE',text,req.body.owner_user_id||actor(req),req.body.due_date||null]);return res.status(201).json({id:r.insertId})}catch(e){return next(e)}}

async function genealogyByMaterial(req,res,next){try{await ready();const [rows]=await pool.query(`SELECT g.*,j.job_no,b.build_no,s.serial_no,j.customer_id,j.part_no,j.drawing_revision FROM material_genealogy g JOIN manufacturing_jobs j ON j.id=g.job_id LEFT JOIN job_builds b ON b.id=g.build_id LEFT JOIN job_serials s ON s.id=g.serial_id WHERE g.material_lot_id=? ORDER BY g.created_at DESC`,[req.params.id]);return res.json({material_lot_id:Number(req.params.id),impacts:rows})}catch(e){return next(e)}}
async function genealogyBySerial(req,res,next){try{await ready();const [[serial]]=await pool.query('SELECT * FROM job_serials WHERE serial_no=? OR id=? LIMIT 1',[req.params.id,req.params.id]);if(!serial)return res.status(404).json({message:'Serial not found.'});const [rows]=await pool.query(`SELECT g.*,ml.lot_no,ml.supplier_lot,ml.supplier_id,j.job_no,b.build_no,b.machine_id,b.operator_user_id,b.slicer_name,b.slicer_version,b.profile_revision,b.process_parameters_json FROM material_genealogy g JOIN material_lots ml ON ml.id=g.material_lot_id JOIN manufacturing_jobs j ON j.id=g.job_id LEFT JOIN job_builds b ON b.id=g.build_id WHERE g.serial_id=?`,[serial.id]);return res.json({serial,trace:rows})}catch(e){return next(e)}}

async function machineGate(req,res,next){try{return res.json(await gates.machineReadiness(req.params.id))}catch(e){return next(e)}}
async function operatorGate(req,res,next){try{return res.json(await gates.operatorReadiness(req.body.user_id||actor(req),req.body.machine_id,clean(req.body.required_competency_code,80)||null))}catch(e){return next(e)}}
async function calibrationGate(req,res,next){try{return res.json(await gates.measurementEquipmentReadiness(req.params.id))}catch(e){return next(e)}}
async function releaseGate(req,res,next){try{return res.json(await gates.jobReleaseReadiness(req.params.id))}catch(e){return next(e)}}

module.exports={dashboard,listDefinitions,upsertDefinition,validateValues,importLegacy,placeHold,releaseHold,listHolds,createNcr,listNcrs,transitionNcr,createCapa,listCapas,addCapaAction,genealogyByMaterial,genealogyBySerial,machineGate,operatorGate,calibrationGate,releaseGate};
