const crypto = require('node:crypto');
const pool = require('../../config/db');
const { ensureQmsAdvancedSchema } = require('../../services/qmsAdvancedSchema');
const { measurementEquipmentReadiness } = require('../../services/qmsGateService');
const { hasAnyPermission } = require('../../services/authorizationService');
const { logAudit } = require('../../services/auditService');

function actor(req) { return Number(req.user?.id || req.user?.user_id || 0) || null; }
function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function reference(prefix, id) { return `${prefix}-${new Date().getUTCFullYear()}-${String(id).padStart(6, '0')}`; }
function audit(req) { return { actorId: actor(req), ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId || req.id || req.get?.('x-request-id') || null, sessionId: req.session?.id || null }; }
function fail(message, status = 400, code = 'QMS_INSPECTION_INVALID', fields) { throw Object.assign(new Error(message), { status, code, fields }); }
function id(value, field, optional = false) {
  if (optional && (value == null || value === '')) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail('Choose a valid inspection record.', 400, 'QMS_INSPECTION_INVALID', { [field]: 'Choose a valid record' });
  return number;
}
function numeric(value, field, optional = false) {
  if (optional && (value == null || value === '')) return null;
  const number = Number(value), text = String(value).trim();
  if (!['number','string'].includes(typeof value) || !/^-?\d+(?:\.\d{1,6})?$/.test(text) || !Number.isFinite(number) || Math.abs(number) >= 1000000000000) fail('Enter a finite measurement with at most six decimal places.', 400, 'QMS_INSPECTION_INVALID', { [field]: 'Enter a finite number with at most six decimal places' });
  return number;
}
function permittedApproval(req) {
  if (!hasAnyPermission(req.user, ['APPROVE_QMS','APPROVE_FAI','QUALITY_RELEASE','MANAGE_QMS'])) fail('Inspection approval is not enabled for your account.', 403, 'QMS_APPROVAL_DENIED');
}
function endpoint(work, transactional = true) {
  return async (req, res, next) => {
    let connection;
    try {
      await ensureQmsAdvancedSchema();
      if (transactional) { connection = await pool.getConnection(); await connection.beginTransaction(); }
      const result = await work(req, connection || pool);
      if (connection) await connection.commit();
      return res.status(result.httpStatus || 200).json(result.body || result);
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (error.status) return res.status(error.status).json({ message: error.message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) });
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This inspection reference or characteristic already exists.', code: 'QMS_INSPECTION_DUPLICATE' });
      return next(error);
    } finally { if (connection) connection.release(); }
  };
}
const listPlans = endpoint(async (_req, db) => {
  const [plans] = await db.query('SELECT * FROM inspection_plans ORDER BY id DESC LIMIT 500'); return { plans };
}, false);
const createPlan = endpoint(async (req, db) => {
  const name = clean(req.body.name,255), type = clean(req.body.inspection_type,20).toUpperCase();
  if (!name || !['INCOMING','IN_PROCESS','FINAL','FAI'].includes(type)) fail('Name and a valid inspection type are required.');
  const [result] = await db.query("INSERT INTO inspection_plans(plan_no,name,inspection_type,part_no,drawing_revision,status) VALUES(?,?,?,?,?,'DRAFT')", [`PENDING-${crypto.randomUUID()}`, name, type, clean(req.body.part_no,100) || null, clean(req.body.drawing_revision,40) || null]);
  const planNo = reference('INSP',result.insertId);
  await db.query('UPDATE inspection_plans SET plan_no=? WHERE id=?',[planNo,result.insertId]);
  await logAudit(db,{...audit(req),action:'INSPECTION_PLAN_CREATED',module:'QMS',recordType:type,recordId:planNo,newValue:{name,status:'DRAFT'}});
  return { httpStatus:201,body:{id:result.insertId,plan_no:planNo,status:'DRAFT'} };
});
const addCharacteristic = endpoint(async (req, db) => {
  const planId=id(req.params.id,'inspection_plan_id'), description=clean(req.body.description,255), charNo=clean(req.body.characteristic_no,80);
  if (!description || !charNo) fail('Characteristic reference and description are required.');
  const nominal=numeric(req.body.nominal,'nominal',true), lower=numeric(req.body.lower_limit,'lower_limit',true), upper=numeric(req.body.upper_limit,'upper_limit',true);
  if (lower !== null && upper !== null && lower > upper) fail('Lower limit must not exceed upper limit.',400,'QMS_LIMITS_INVALID',{lower_limit:'Must not exceed upper limit'});
  const sequence=id(req.body.sequence_no ?? 1,'sequence_no');
  const [[plan]]=await db.query('SELECT * FROM inspection_plans WHERE id=? FOR UPDATE',[planId]);
  if (!plan) fail('Inspection plan not found.',404,'QMS_PLAN_NOT_FOUND');
  if (plan.status !== 'DRAFT') fail('Approved inspection plans are immutable. Create a new controlled plan.',409,'QMS_PLAN_LOCKED');
  const [result]=await db.query('INSERT INTO inspection_characteristics(inspection_plan_id,characteristic_no,description,nominal,lower_limit,upper_limit,unit,blocking,sequence_no) VALUES(?,?,?,?,?,?,?,?,?)',[plan.id,charNo,description,nominal,lower,upper,clean(req.body.unit,40)||null,req.body.blocking===false?0:1,sequence]);
  await logAudit(db,{...audit(req),action:'INSPECTION_CHARACTERISTIC_ADDED',module:'QMS',recordType:'INSPECTION_PLAN',recordId:plan.plan_no,newValue:{characteristic_id:result.insertId,characteristic_no:charNo,lower_limit:lower,upper_limit:upper}});
  return { httpStatus:201,body:{id:result.insertId} };
});
const approvePlan = endpoint(async (req, db) => {
  permittedApproval(req);
  const [[plan]]=await db.query('SELECT * FROM inspection_plans WHERE id=? FOR UPDATE',[id(req.params.id,'inspection_plan_id')]);
  if (!plan) fail('Inspection plan not found.',404,'QMS_PLAN_NOT_FOUND');
  if (plan.status==='APPROVED') return {id:plan.id,status:'APPROVED',unchanged:true};
  if (plan.status!=='DRAFT') fail('Only a draft inspection plan can be approved.',409,'QMS_PLAN_LOCKED');
  const [[count]]=await db.query('SELECT COUNT(*) total FROM inspection_characteristics WHERE inspection_plan_id=?',[plan.id]);
  if (!Number(count.total)) fail('Inspection plan must contain at least one characteristic.',409,'QMS_PLAN_EMPTY');
  await db.query("UPDATE inspection_plans SET status='APPROVED' WHERE id=?",[plan.id]);
  await logAudit(db,{...audit(req),action:'INSPECTION_PLAN_APPROVED',module:'QMS',recordType:plan.inspection_type,recordId:plan.plan_no,oldValue:{status:plan.status},newValue:{status:'APPROVED'}});
  return {id:plan.id,status:'APPROVED'};
});
const createRun = endpoint(async (req, db) => {
  const [[plan]]=await db.query("SELECT * FROM inspection_plans WHERE id=? AND status='APPROVED' FOR UPDATE",[id(req.body.inspection_plan_id,'inspection_plan_id')]);
  if (!plan) fail('An approved inspection plan is required.',409,'QMS_PLAN_APPROVAL_REQUIRED');
  const references=['job_id','material_lot_id','build_id','serial_id'].map((field)=>id(req.body[field],field,true));
  const [result]=await db.query('INSERT INTO inspection_runs(run_no,inspection_plan_id,job_id,material_lot_id,build_id,serial_id,inspected_by) VALUES(?,?,?,?,?,?,?)',[`PENDING-${crypto.randomUUID()}`,plan.id,...references,actor(req)]);
  const runNo=reference(plan.inspection_type==='FAI'?'FAI':'IR',result.insertId);
  await db.query('UPDATE inspection_runs SET run_no=? WHERE id=?',[runNo,result.insertId]);
  await logAudit(db,{...audit(req),action:'INSPECTION_RUN_CREATED',module:'QMS',recordType:plan.inspection_type,recordId:runNo,newValue:{plan_no:plan.plan_no,status:'OPEN'}});
  return {httpStatus:201,body:{id:result.insertId,run_no:runNo,status:'OPEN'}};
});
const recordMeasurement = endpoint(async (req, db) => {
  const actual=numeric(req.body.actual_value,'actual_value',true), sample=id(req.body.sample_no ?? 1,'sample_no'), characteristicId=id(req.body.characteristic_id,'characteristic_id');
  if (sample>10000) fail('Sample number must not exceed 10,000.');
  const [[run]]=await db.query('SELECT * FROM inspection_runs WHERE id=? FOR UPDATE',[id(req.params.id,'inspection_run_id')]);
  if (!run || run.status!=='OPEN') fail('An open inspection run is required.',409,'INSPECTION_RUN_LOCKED');
  const [[characteristic]]=await db.query('SELECT * FROM inspection_characteristics WHERE id=? AND inspection_plan_id=?',[characteristicId,run.inspection_plan_id]);
  if (!characteristic) fail('Characteristic is not part of this inspection plan.');
  const textValue=clean(req.body.text_value,1000)||null, declaredResult=String(req.body.result||'').toUpperCase();
  if (actual===null && (!textValue || !['PASS','FAIL'].includes(declaredResult) || characteristic.nominal!=null || characteristic.lower_limit!=null || characteristic.upper_limit!=null)) fail('Enter a numeric measurement, or text and an explicit pass/fail decision for a qualitative characteristic.',400,'INSPECTION_MEASUREMENT_REQUIRED',{actual_value:'Enter the measurement; qualitative checks need text and a pass/fail decision'});
  const equipmentId=id(req.body.measurement_equipment_id,'measurement_equipment_id',true);
  if (equipmentId) {const gate=await measurementEquipmentReadiness(equipmentId,db);if(!gate.allowed)fail('Measurement equipment is not valid for inspection.',409,'CALIBRATION_GATE_BLOCKED',{measurement_equipment_id:gate.reasons.join('; ')});}
  const result=actual===null?declaredResult:((characteristic.lower_limit==null||actual>=Number(characteristic.lower_limit))&&(characteristic.upper_limit==null||actual<=Number(characteristic.upper_limit)))?'PASS':'FAIL';
  const [[previous]]=await db.query('SELECT * FROM inspection_measurements WHERE inspection_run_id=? AND characteristic_id=? AND sample_no=?',[run.id,characteristic.id,sample]);
  if(previous&&(previous.actual_value==null?actual===null:Number(previous.actual_value)===actual)&&(previous.text_value||null)===textValue&&(Number(previous.measurement_equipment_id)||null)===equipmentId&&previous.result===result)return{result,sample_no:sample,unchanged:true};
  await db.query('INSERT INTO inspection_measurements(inspection_run_id,characteristic_id,sample_no,actual_value,text_value,measurement_equipment_id,result,measured_by) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE actual_value=VALUES(actual_value),text_value=VALUES(text_value),measurement_equipment_id=VALUES(measurement_equipment_id),result=VALUES(result),measured_by=VALUES(measured_by),measured_at=NOW()',[run.id,characteristic.id,sample,actual,textValue,equipmentId,result,actor(req)]);
  await logAudit(db,{...audit(req),action:'INSPECTION_MEASUREMENT_RECORDED',module:'QMS',recordType:'INSPECTION_RUN',recordId:run.run_no,oldValue:previous||null,newValue:{characteristic_id:characteristic.id,sample_no:sample,actual_value:actual,result}});
  return {result,sample_no:sample};
});
const completeRun = endpoint(async (req, db) => {
  const [[run]]=await db.query('SELECT ir.*,ip.inspection_type,ip.plan_no FROM inspection_runs ir JOIN inspection_plans ip ON ip.id=ir.inspection_plan_id WHERE ir.id=? FOR UPDATE',[id(req.params.id,'inspection_run_id')]);
  if (!run) fail('Inspection run not found.',404,'INSPECTION_RUN_NOT_FOUND');
  if (['PASS','FAIL','APPROVED'].includes(run.status)) return {id:run.id,run_no:run.run_no,status:run.status,unchanged:true};
  if (run.status!=='OPEN') fail('Only open inspection runs can be completed.',409,'INSPECTION_RUN_LOCKED');
  const [characteristics]=await db.query('SELECT id,blocking FROM inspection_characteristics WHERE inspection_plan_id=?',[run.inspection_plan_id]);
  const [measurements]=await db.query('SELECT characteristic_id,result,sample_no FROM inspection_measurements WHERE inspection_run_id=?',[run.id]);
  const samples=new Map();for(const measurement of measurements){const key=Number(measurement.characteristic_id);if(!samples.has(key))samples.set(key,[]);samples.get(key).push(measurement);}
  const missing=characteristics.filter((characteristic)=>Number(characteristic.blocking)&&(!samples.has(Number(characteristic.id))||samples.get(Number(characteristic.id)).some((sample)=>!['PASS','FAIL'].includes(sample.result))));
  if (missing.length) fail('Blocking inspection characteristics need complete numeric measurements.',409,'INSPECTION_INCOMPLETE',{characteristic_ids:missing.map((characteristic)=>characteristic.id)});
  const failed=characteristics.some((characteristic)=>Number(characteristic.blocking)&&samples.get(Number(characteristic.id))?.some((sample)=>sample.result==='FAIL'));
  const status=failed?'FAIL':'PASS';
  await db.query('UPDATE inspection_runs SET status=?,completed_at=NOW() WHERE id=?',[status,run.id]);
  await logAudit(db,{...audit(req),action:`INSPECTION_${status}`,module:'QMS',recordType:run.inspection_type,recordId:run.run_no,oldValue:{status:run.status},newValue:{status,samples:measurements.length}});
  return {id:run.id,run_no:run.run_no,status};
});
const approveRun = endpoint(async (req, db) => {
  permittedApproval(req);
  const [[run]]=await db.query('SELECT ir.*,ip.inspection_type FROM inspection_runs ir JOIN inspection_plans ip ON ip.id=ir.inspection_plan_id WHERE ir.id=? FOR UPDATE',[id(req.params.id,'inspection_run_id')]);
  if (!run) fail('Inspection run not found.',404,'INSPECTION_RUN_NOT_FOUND');
  if (run.status==='APPROVED') return {id:run.id,status:'APPROVED',unchanged:true};
  if (run.status!=='PASS') fail('Only a passing inspection can be approved.',409,'INSPECTION_APPROVAL_NOT_READY');
  const [[ownMeasurement]]=await db.query('SELECT id FROM inspection_measurements WHERE inspection_run_id=? AND measured_by=? LIMIT 1',[run.id,actor(req)]);
  if (Number(run.inspected_by)===actor(req)||ownMeasurement) fail('Separation of duties: the inspector or a measurer cannot provide final approval.',409,'INSPECTION_SELF_APPROVAL_DENIED');
  await db.query("UPDATE inspection_runs SET status='APPROVED',approved_by=? WHERE id=?",[actor(req),run.id]);
  await logAudit(db,{...audit(req),action:run.inspection_type==='FAI'?'FAI_APPROVED':'INSPECTION_APPROVED',module:'QMS',recordType:run.inspection_type,recordId:run.run_no,oldValue:{status:run.status},newValue:{status:'APPROVED'}});
  return {id:run.id,status:'APPROVED'};
});
const getRun = endpoint(async (req, db) => {
  const [[run]]=await db.query('SELECT ir.*,ip.plan_no,ip.name,ip.inspection_type FROM inspection_runs ir JOIN inspection_plans ip ON ip.id=ir.inspection_plan_id WHERE ir.id=?',[id(req.params.id,'inspection_run_id')]);
  if (!run) fail('Inspection run not found.',404,'INSPECTION_RUN_NOT_FOUND');
  const [measurements]=await db.query('SELECT ic.characteristic_no,ic.description,ic.nominal,ic.lower_limit,ic.upper_limit,ic.unit,ic.blocking,im.sample_no,im.actual_value,im.text_value,im.result,im.measured_at FROM inspection_characteristics ic LEFT JOIN inspection_measurements im ON im.characteristic_id=ic.id AND im.inspection_run_id=? WHERE ic.inspection_plan_id=? ORDER BY ic.sequence_no,ic.id,im.sample_no',[run.id,run.inspection_plan_id]);
  return {run,measurements};
},false);
module.exports={listPlans,createPlan,addCharacteristic,approvePlan,createRun,recordMeasurement,completeRun,approveRun,getRun};
