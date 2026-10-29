const pool = require('../config/db');
const { ensureQmsAdvancedSchema } = require('../services/qmsAdvancedSchema');
const { machineReadiness, operatorReadiness } = require('../services/qmsGateService');
const { logAudit } = require('../services/auditService');
const { hasPermission, hasAnyPermission, isManagerOf } = require('../services/authorizationService');
function actor(req){return Number(req.user?.id||req.user?.user_id||0)||null}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function audit(req){return{actorId:actor(req),ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.id||req.get('x-request-id')||null,sessionId:req.session?.id||null}}
function lookupReference(value, maximum) {
  if (!['string','number'].includes(typeof value)) return null;
  const text=String(value).trim();
  if (!text || text.length>maximum || /[\u0000-\u001f\u007f]/.test(text)) return null;
  if (/^\d+$/.test(text)) {
    const id=Number(text);
    return Number.isSafeInteger(id)&&id>0 ? {id} : null;
  }
  return {reference:text};
}
function invalidReference(res, label, maximum) {
  return res.status(400).json({code:'SHOP_FLOOR_REFERENCE_INVALID',message:`Enter a positive numeric ID or an exact saved ${label} of up to ${maximum} characters.`});
}
async function jobContext(req, res, next) {
  try {
    const reference=lookupReference(req.params.id,50);
    if (!reference) return invalidReference(res,'job number',50);
    await ensureQmsAdvancedSchema();
    const [[job]]=reference.id
      ? await pool.query('SELECT * FROM manufacturing_jobs WHERE id=? LIMIT 1',[reference.id])
      : await pool.query('SELECT * FROM manufacturing_jobs WHERE job_no=? LIMIT 1',[reference.reference]);
    if (!job) return res.status(404).json({message:'Job not found.'});
    const [operations]=await pool.query('SELECT * FROM job_operations WHERE job_id=? ORDER BY operation_no',[job.id]);
    const [materials]=await pool.query(`SELECT ml.id,ml.lot_no,ml.material_code,ml.grade,ml.release_status,a.quantity_allocated,a.quantity_consumed FROM job_material_allocations a JOIN material_lots ml ON ml.id=a.material_lot_id WHERE a.job_id=?`,[job.id]);
    const [builds]=await pool.query('SELECT id,build_no,machine_id,operator_user_id,status,started_at,completed_at FROM job_builds WHERE job_id=? ORDER BY id DESC',[job.id]);
    const [holds]=await pool.query("SELECT * FROM quality_holds WHERE active=1 AND ((entity_type='JOB' AND entity_id=?) OR (entity_type='BUILD' AND entity_id IN (SELECT CAST(id AS CHAR) FROM job_builds WHERE job_id=?)))",[String(job.id),job.id]);
    return res.json({job,operations,materials,builds,holds});
  } catch (error) { return next(error); }
}
async function machineContext(req, res, next) {
  try {
    const reference=lookupReference(req.params.id,80);
    if (!reference) return invalidReference(res,'equipment code',80);
    await ensureQmsAdvancedSchema();
    let machineId=reference.id;
    if (!machineId) {
      const [[machine]]=await pool.query('SELECT id FROM equipment_assets WHERE equipment_code=? LIMIT 1',[reference.reference]);
      if (!machine) return res.status(404).json({allowed:false,code:'MACHINE_NOT_FOUND',reasons:['Machine not found.']});
      machineId=Number(machine.id);
    }
    const gate = await machineReadiness(machineId);
    if (!gate.machine) return res.status(404).json(gate);
    const [plans] = await pool.query('SELECT id,plan_name,next_due_date,blocking_when_overdue,active FROM maintenance_plans WHERE equipment_id=? ORDER BY next_due_date,id', [gate.machine.id]);
    const [faults] = await pool.query("SELECT * FROM equipment_faults WHERE equipment_id=? AND status<>'RESOLVED' ORDER BY reported_at DESC,id DESC", [gate.machine.id]);
    const [loto] = await pool.query('SELECT * FROM loto_permits WHERE equipment_id=? AND active=1', [gate.machine.id]);
    return res.json({ ...gate, maintenance: plans, faults, loto });
  } catch (error) { return next(error); }
}
async function materialContext(req, res, next) {
  try {
    const reference=lookupReference(req.params.id,80);
    if (!reference) return invalidReference(res,'material lot number',80);
    await ensureQmsAdvancedSchema();
    const [[lot]]=reference.id
      ? await pool.query('SELECT * FROM material_lots WHERE id=? LIMIT 1',[reference.id])
      : await pool.query('SELECT * FROM material_lots WHERE lot_no=? LIMIT 1',[reference.reference]);
    if (!lot) return res.status(404).json({message:'Material lot not found.'});
    const [genealogy]=await pool.query(`SELECT g.*,j.job_no,b.build_no,s.serial_no FROM material_genealogy g LEFT JOIN manufacturing_jobs j ON j.id=g.job_id LEFT JOIN job_builds b ON b.id=g.build_id LEFT JOIN job_serials s ON s.id=g.serial_id WHERE g.material_lot_id=? ORDER BY g.created_at DESC`,[lot.id]);
    const [holds]=await pool.query("SELECT * FROM quality_holds WHERE active=1 AND entity_type='MATERIAL_LOT' AND entity_id=?",[String(lot.id)]);
    return res.json({lot,genealogy,holds,usable:lot.release_status==='RELEASED'&&!holds.length});
  } catch (error) { return next(error); }
}
async function transitionOperation(req, res, next) {
  let connection;
  try {
    const operationId = Number(req.params.id), action = clean(req.body.action,20).toUpperCase();
    const transitions = { START:['READY','PLANNED'], PAUSE:['RUNNING'], RESUME:['PAUSED'], COMPLETE:['RUNNING','PAUSED'] };
    const nextStatus = { START:'RUNNING', PAUSE:'PAUSED', RESUME:'RUNNING', COMPLETE:'COMPLETE' }[action];
    if (!Number.isSafeInteger(operationId) || operationId <= 0 || !nextStatus) return res.status(400).json({ message:'Choose a valid operation and action.' });
    if (!hasAnyPermission(req.user,['MANAGE_JOBS','MANAGE_TEAM_JOBS','EDIT_QMS_RECORD','MANAGE_QMS'])) return res.status(403).json({ message:'Production operation control is not enabled for your account.' });
    await ensureQmsAdvancedSchema(); connection=await pool.getConnection(); await connection.beginTransaction();
    const [[op]]=await connection.query('SELECT jo.*,j.job_no,j.status job_status,j.created_by job_created_by FROM job_operations jo JOIN manufacturing_jobs j ON j.id=jo.job_id WHERE jo.id=? FOR UPDATE',[operationId]);
    if (!op) { await connection.rollback(); return res.status(404).json({ message:'Operation not found.' }); }
    let ownerId=Number(op.owner_user_id)||null;
    if (!ownerId && ['RUNNING','PAUSED'].includes(op.status)) {
      const [[event]]=await connection.query("SELECT actor_id FROM job_operation_events WHERE job_operation_id=? AND event_type IN('START','RESUME') ORDER BY id DESC LIMIT 1",[op.id]);
      ownerId=Number(event?.actor_id)||null;
    }
    const managesAll=hasAnyPermission(req.user,['MANAGE_JOBS','MANAGE_QMS']);
    const managesOwner=ownerId && hasPermission(req.user,'MANAGE_TEAM_JOBS') && await isManagerOf(actor(req),ownerId,connection);
    if (ownerId && ownerId !== actor(req) && !managesAll && !managesOwner) { await connection.rollback(); return res.status(403).json({ message:'Only the assigned operator or an authorised manager can change this operation.', code:'OPERATION_OWNER_REQUIRED' }); }
    if (!ownerId && action !== 'START' && !managesAll) { await connection.rollback(); return res.status(409).json({ message:'Ask a production manager to review this legacy operation before changing its status.',code:'OPERATION_OWNER_REVIEW_REQUIRED' }); }
    if (op.status===nextStatus) { await connection.commit(); return res.json({id:op.id,status:op.status,job_id:op.job_id,owner_user_id:ownerId,unchanged:true}); }
    if (!transitions[action].includes(op.status)) { await connection.rollback(); return res.status(409).json({ message:`Cannot ${action} operation from ${op.status}.` }); }
    if (action !== 'PAUSE' && ['QUALITY_HOLD','CANCELLED','FINAL_RELEASE','PACKING','DISPATCHED','COMPLETE'].includes(op.job_status)) { await connection.rollback(); return res.status(409).json({message:'The job status blocks this production operation.',code:'JOB_OPERATION_BLOCKED'}); }
    if (['START','RESUME'].includes(action)) {
      if (!op.machine_id) { await connection.rollback(); return res.status(409).json({message:'Assign a machine before starting this operation.'}); }
      const machine=await machineReadiness(op.machine_id,connection);
      if (!machine.allowed) { await connection.rollback(); return res.status(409).json({code:'MACHINE_GATE_BLOCKED',message:'Machine readiness gate blocked operation.',reasons:machine.reasons}); }
      const operator=await operatorReadiness(actor(req),op.machine_id,op.required_competency_code,connection);
      if (!operator.allowed) { await connection.rollback(); return res.status(409).json({code:'OPERATOR_GATE_BLOCKED',message:'Operator competency/authorisation gate blocked operation.',reasons:operator.reasons}); }
    }
    const assignedOwner=ownerId || actor(req);
    await connection.query("UPDATE job_operations SET status=?,owner_user_id=COALESCE(owner_user_id,?),actual_start=IF(?='START' AND actual_start IS NULL,NOW(),actual_start),actual_end=IF(?='COMPLETE',COALESCE(actual_end,NOW()),actual_end) WHERE id=?",[nextStatus,assignedOwner,action,action,op.id]);
    await connection.query('INSERT INTO job_operation_events(job_operation_id,event_type,actor_id,metadata_json) VALUES(?,?,?,?)',[op.id,action,actor(req),JSON.stringify({note:clean(req.body.note,500)||null,owner_user_id:assignedOwner})]);
    if (['START','RESUME'].includes(action)) {
      await connection.query("UPDATE manufacturing_jobs SET status='IN_PRODUCTION' WHERE id=? AND status NOT IN('QUALITY_HOLD','CANCELLED')",[op.job_id]);
      await connection.query("UPDATE equipment_assets SET status='RUNNING' WHERE id=?",[op.machine_id]);
    }
    if (['PAUSE','COMPLETE'].includes(action) && op.machine_id) await connection.query("UPDATE equipment_assets SET status='READY' WHERE id=? AND status='RUNNING' AND NOT EXISTS(SELECT 1 FROM job_operations WHERE machine_id=? AND id<>? AND status='RUNNING')",[op.machine_id,op.machine_id,op.id]);
    if (action==='COMPLETE') {
      const [[remaining]]=await connection.query("SELECT COUNT(*) n FROM job_operations WHERE job_id=? AND id<>? AND status<>'COMPLETE'",[op.job_id,op.id]);
      if (Number(remaining.n)===0) await connection.query("UPDATE manufacturing_jobs SET status='INSPECTION' WHERE id=? AND status='IN_PRODUCTION'",[op.job_id]);
    }
    await logAudit(connection,{...audit(req),action:`SHOP_FLOOR_OPERATION_${action}`,module:'QMS',recordType:'JOB_OPERATION',recordId:String(op.id),oldValue:{status:op.status,owner_user_id:ownerId},newValue:{status:nextStatus,jobNo:op.job_no,machineId:op.machine_id,owner_user_id:assignedOwner}});
    await connection.commit(); return res.json({id:op.id,status:nextStatus,job_id:op.job_id,owner_user_id:assignedOwner,unchanged:false});
  } catch(error) { if(connection) await connection.rollback().catch(()=>{}); return next(error); }
  finally {if(connection)connection.release();}
}
module.exports={jobContext,machineContext,materialContext,transitionOperation};
