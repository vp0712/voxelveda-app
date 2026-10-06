'use strict';
const crypto = require('node:crypto');
const { hasAnyPermission, hasPermission } = require('./authorizationService');
const { logAudit } = require('./auditService');

const MODULES = Object.freeze([
  { key:'sales', title:'Sales & CRM', hint:'Enquiries, quotes, customers and invoices', permission:['VIEW_RFQS','VIEW_CUSTOMERS'], section:'rfqSection' },
  { key:'marketing', title:'Marketing', hint:'Campaign plans, budgets and linked enquiries', permission:['VIEW_CUSTOMERS'], section:'erpSection' },
  { key:'procurement', title:'Procurement', hint:'Requisition → supplier quote → approved purchase order', permission:['VIEW_PROCUREMENT'], section:'procurementSection' },
  { key:'planning', title:'Production Planning', hint:'Work orders, machine time and operation scheduling', permission:['VIEW_QMS','VIEW_COMPLIANCE'], section:'erpSection' },
  { key:'manufacturing', title:'Manufacturing & Quality', hint:'Shop floor, inspections, holds and controlled release', permission:['VIEW_QMS','VIEW_COMPLIANCE'], url:'/quality' },
  { key:'inventory', title:'Inventory', hint:'Stock batches, material and packaging movements', permission:['VIEW_INVENTORY'], section:'stockSection' },
  { key:'supply', title:'Supply Chain', hint:'Supplier deliveries, receipts, inspection and bill matching', permission:['VIEW_PROCUREMENT'], section:'erpSection' },
  { key:'hr', title:'People & HR', hint:'Staff, roster, attendance, training and timesheets', permission:['VIEW_STAFF_HR','VIEW_ATTENDANCE'], section:'staffSection' },
  { key:'finance', title:'Finance & Accounting', hint:'Company ledger, invoices and the existing Finance OS', permission:['VIEW_FINANCE'], section:'financeSection' },
  { key:'approvals', title:'Approvals & Controls', hint:'Your approval queue, evidence and company forms', permission:['VIEW_APPROVALS'], section:'approvalsSection' }
]);
class ErpError extends Error {
  constructor(message, statusCode=400, code='ERP_VALIDATION_ERROR') { super(message); this.statusCode=statusCode; this.code=code; }
}
const clean = (value, max) => String(value ?? '').trim().slice(0,max);
function positiveId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isSafeInteger(Number(value)) || Number(value)<=0) throw new ErpError(`${field} is invalid.`);
  return Number(value);
}
function date(value) {
  if (!value) return null;
  const s=String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number(s.slice(0,4))<1000 || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10)!==s) throw new ErpError('Use a valid calendar date.');
  return s;
}
function normalizeCampaign(input) {
  const result={name:clean(input.name,180),channel:clean(input.channel,30).toUpperCase(),objective:clean(input.objective,1000),status:clean(input.status||'DRAFT',20).toUpperCase(),
    start_date:date(input.start_date),end_date:date(input.end_date),currency:clean(input.currency||'AUD',3).toUpperCase(),planned_budget:String(input.planned_budget ?? '0'),
    customer_id:positiveId(input.customer_id,'Customer'),rfq_id:positiveId(input.rfq_id,'RFQ')};
  if(result.name.length<3 || result.objective.length<5) throw new ErpError('Campaign name and objective are required.');
  if(!['EMAIL','SOCIAL','SEARCH','EVENT','PARTNERSHIP','OTHER'].includes(result.channel)) throw new ErpError('Choose a supported channel.');
  if(!['DRAFT','PLANNED','ACTIVE','COMPLETE','CANCELLED'].includes(result.status)) throw new ErpError('Choose a supported campaign status.');
  if(!/^[A-Z]{3}$/.test(result.currency) || !/^\d{1,9}(?:\.\d{1,2})?$/.test(result.planned_budget)) throw new ErpError('Use a currency code and a non-negative budget with at most two decimals.');
  if(result.start_date && result.end_date && result.end_date<result.start_date) throw new ErpError('End date must be on or after start date.');
  return result;
}
async function linkedRecords(db,user,input) {
  if(input.customer_id) {
    if(!hasPermission(user,'VIEW_CUSTOMERS')) throw new ErpError('Customer access is required.',403);
    const [[row]]=await db.query('SELECT id FROM customers WHERE id=? AND deleted=0 FOR UPDATE',[input.customer_id]);
    if(!row) throw new ErpError('The linked customer is unavailable.',404);
  }
  if(input.rfq_id) {
    if(!hasPermission(user,'VIEW_RFQS')) throw new ErpError('RFQ access is required.',403);
    const [[row]]=await db.query('SELECT id FROM rfqs WHERE id=? FOR UPDATE',[input.rfq_id]);
    if(!row) throw new ErpError('The linked RFQ is unavailable.',404);
  }
}
async function transaction(pool,fn) {
  const db=await pool.getConnection();
  try { await db.beginTransaction(); const result=await fn(db); await db.commit(); return result; }
  catch(error) { await db.rollback(); throw error; } finally { db.release(); }
}
function audit(req,action,type,id,oldValue,newValue) {
  return {actorId:req.user.id,action,module:'ERP',recordType:type,recordId:String(id),oldValue,newValue,
    ipAddress:req.ip,userAgent:req.get?.('user-agent'),requestId:req.requestId||req.id,sessionId:req.session?.id};
}
async function saveCampaign(pool,req,id=null) {
  const input=normalizeCampaign(req.body);
  return transaction(pool,async db=>{
    await linkedRecords(db,req.user,input);
    let old=null,revision=1;
    if(id) {
      const [[row]]=await db.query('SELECT * FROM erp_campaigns WHERE id=? FOR UPDATE',[id]);
      if(!row) throw new ErpError('Campaign not found.',404);
      if(Number(req.body.revision)!==Number(row.revision)) throw new ErpError('This campaign changed. Refresh before saving.',409,'ERP_REVISION_CONFLICT');
      old=row; revision=Number(row.revision)+1;
      await db.query('UPDATE erp_campaigns SET name=?,channel=?,objective=?,status=?,start_date=?,end_date=?,currency=?,planned_budget=?,customer_id=?,rfq_id=?,revision=?,updated_by=? WHERE id=?',
        [...Object.values(input),revision,req.user.id,id]);
    } else {
      const [created]=await db.query('INSERT INTO erp_campaigns(name,channel,objective,status,start_date,end_date,currency,planned_budget,customer_id,rfq_id,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [...Object.values(input),req.user.id,req.user.id]); id=created.insertId;
    }
    await logAudit(db,audit(req,old?'ERP_CAMPAIGN_UPDATED':'ERP_CAMPAIGN_CREATED','CAMPAIGN',id,old,{...input,revision}));
    return {id,revision,...input};
  });
}
async function createJob(pool,req) {
  const input={part_no:clean(req.body.part_no,100),part_description:clean(req.body.part_description,255),quantity:String(req.body.quantity??''),
    sector:clean(req.body.sector||'GENERAL',30).toUpperCase(),drawing_no:clean(req.body.drawing_no,100),drawing_revision:clean(req.body.drawing_revision,40),rfq_id:positiveId(req.body.rfq_id,'RFQ')};
  if(!input.part_no || input.part_description.length<3 || !/^\d{1,8}(?:\.\d{1,4})?$/.test(input.quantity) || Number(input.quantity)<=0) throw new ErpError('Part, description and positive quantity are required.');
  if(!['GENERAL','AEROSPACE','DEFENCE','MEDICAL','AUTOMOTIVE','OTHER'].includes(input.sector)) throw new ErpError('Choose a supported sector.');
  const jobNo=`WO-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  return transaction(pool,async db=>{
    await linkedRecords(db,req.user,input);
    const [created]=await db.query("INSERT INTO manufacturing_jobs(job_no,part_no,part_description,quantity,sector,drawing_no,drawing_revision,rfq_id,status,regulatory_review_required,export_review_required,created_by) VALUES(?,?,?,?,?,?,?,?,'PLANNING',?,?,?)",
      [jobNo,input.part_no,input.part_description,input.quantity,input.sector,input.drawing_no||null,input.drawing_revision||null,input.rfq_id,['MEDICAL','AEROSPACE','DEFENCE'].includes(input.sector)?1:0,input.sector==='DEFENCE'?1:0,req.user.id]);
    await logAudit(db,audit(req,'ERP_WORK_ORDER_CREATED','MANUFACTURING_JOB',created.insertId,null,{...input,job_no:jobNo,status:'PLANNING'}));
    return {id:created.insertId,job_no:jobNo,status:'PLANNING'};
  });
}
function utcTime(value) {
  const s=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) || Number(s.slice(0,4))<1000 || !Number.isFinite(Date.parse(s))) throw new ErpError('Supply an explicit UTC schedule time.');
  const d=new Date(s);
  if(d.toISOString().slice(0,19)!==s.slice(0,19)) throw new ErpError('Schedule date is invalid.');
  return d.toISOString().slice(0,19).replace('T',' ');
}
async function scheduleOperation(pool,req,jobId) {
  const name=clean(req.body.operation_name,160),machineId=positiveId(req.body.machine_id,'Machine');
  const start=utcTime(req.body.planned_start),end=utcTime(req.body.planned_end);
  if(name.length<3 || !machineId || end<=start) throw new ErpError('Operation, machine and increasing schedule times are required.');
  return transaction(pool,async db=>{
    const [[job]]=await db.query('SELECT id,status FROM manufacturing_jobs WHERE id=? FOR UPDATE',[jobId]);
    if(!job) throw new ErpError('Work order not found.',404);
    if(!['PLANNING','MATERIAL_WAITING','READY'].includes(job.status)) throw new ErpError('Only a planning-stage work order can receive new operations.',409);
    // Serialize reservations on the machine itself, including reservations for different jobs.
    const [[machine]]=await db.query('SELECT id,status,commissioned,critical_safety_issue FROM equipment_assets WHERE id=? FOR UPDATE',[machineId]);
    if(!machine || !machine.commissioned || machine.critical_safety_issue || !['READY','RUNNING'].includes(machine.status)) throw new ErpError('Machine is unavailable or has not passed commissioning.',409,'ERP_MACHINE_UNAVAILABLE');
    const [[conflict]]=await db.query("SELECT o.id FROM job_operations o JOIN manufacturing_jobs j ON j.id=o.job_id WHERE o.machine_id=? AND o.status IN ('PLANNED','READY','BLOCKED','RUNNING','PAUSED') AND j.status NOT IN ('CANCELLED','COMPLETE') AND (o.planned_start IS NULL OR o.planned_end IS NULL OR (o.planned_start<? AND o.planned_end>?)) LIMIT 1 FOR UPDATE",[machineId,end,start]);
    if(conflict) throw new ErpError('This machine has an overlapping or unscheduled active operation. Resolve it before reserving time.',409,'ERP_MACHINE_CONFLICT');
    const [[seq]]=await db.query('SELECT COALESCE(MAX(operation_no),0)+10 next_no FROM job_operations WHERE job_id=?',[jobId]);
    const [created]=await db.query("INSERT INTO job_operations(job_id,operation_no,operation_name,machine_id,required_competency_code,work_instruction_ref,planned_start,planned_end,status) VALUES(?,?,?,?,?,?,?,?,'PLANNED')",
      [jobId,seq.next_no,name,machineId,clean(req.body.required_competency_code,80)||null,clean(req.body.work_instruction_ref,160)||null,start,end]);
    await logAudit(db,audit(req,'ERP_OPERATION_PLANNED','JOB_OPERATION',created.insertId,null,{job_id:jobId,machine_id:machineId,planned_start:start,planned_end:end}));
    return {id:created.insertId,status:'PLANNED',job_id:jobId};
  });
}
async function workspace(pool,user) {
  const modules=MODULES.filter(m=>hasAnyPermission(user,m.permission)).map(m=>({key:m.key,title:m.title,hint:m.hint,section:m.section,url:m.url}));
  const data={},checks=[];
  async function read(key,sql,params=[]) {
    try { const [rows]=await pool.query({sql,timeout:5000},params); data[key]=rows; checks.push({key,status:'READY'}); }
    catch { data[key]=null; checks.push({key,status:'UNAVAILABLE',message:'This register could not be read. No zero total has been substituted.'}); }
  }
  const jobs=[];
  if(hasPermission(user,'VIEW_RFQS')) jobs.push(read('sales',"SELECT status,COUNT(*) count FROM rfqs GROUP BY status"));
  if(hasPermission(user,'VIEW_CUSTOMERS')) jobs.push(read('campaigns','SELECT id,name,channel,objective,status,start_date,end_date,currency,planned_budget,customer_id,rfq_id,revision FROM erp_campaigns ORDER BY updated_at DESC,id DESC LIMIT 100'));
  if(hasPermission(user,'VIEW_INVENTORY')) jobs.push(read('inventory','SELECT COUNT(*) batches,COALESCE(SUM(current_unit_qty<=0),0) empty_batches FROM stock_batches WHERE deleted=0'));
  if(hasPermission(user,'VIEW_PROCUREMENT')) jobs.push(read('supply',"SELECT po.id,po.po_number,po.expected_date,po.status,COUNT(i.id) lines,COALESCE(SUM(GREATEST(i.quantity-i.received_quantity,0)),0) outstanding_units FROM purchase_orders po LEFT JOIN purchase_order_items i ON i.purchase_order_id=po.id WHERE po.status NOT IN ('CANCELLED','CLOSED','RECEIVED') GROUP BY po.id,po.po_number,po.expected_date,po.status ORDER BY po.expected_date,po.id LIMIT 100"));
  if(hasAnyPermission(user,['VIEW_QMS','VIEW_COMPLIANCE'])) {
    jobs.push(read('production',"SELECT id,job_no,part_no,part_description,quantity,status,sector,rfq_id FROM manufacturing_jobs ORDER BY updated_at DESC,id DESC LIMIT 100"));
    jobs.push(read('schedule',"SELECT o.id,o.job_id,o.operation_name,o.machine_id,o.status,o.planned_start,o.planned_end,j.job_no,e.equipment_code FROM job_operations o JOIN manufacturing_jobs j ON j.id=o.job_id LEFT JOIN equipment_assets e ON e.id=o.machine_id WHERE j.status NOT IN ('CANCELLED','COMPLETE') AND o.status<>'COMPLETE' ORDER BY o.planned_start,o.id LIMIT 100"));
    jobs.push(read('machines','SELECT id,equipment_code,description,status,commissioned,critical_safety_issue FROM equipment_assets ORDER BY equipment_code LIMIT 100'));
  }
  if(hasPermission(user,'VIEW_FINANCE')) jobs.push(read('accounting',"SELECT status,COUNT(*) count FROM invoices WHERE deleted=0 GROUP BY status"));
  if(hasPermission(user,'VIEW_STAFF_HR')) jobs.push(read('hr',"SELECT COUNT(*) active_staff FROM users WHERE active=1 AND deleted_at IS NULL"));
  await Promise.all(jobs);
  return {modules,data,checks,generated_at:new Date().toISOString(),capabilities:{campaign_edit:hasPermission(user,'EDIT_CUSTOMERS'),production_edit:hasAnyPermission(user,['MANAGE_JOBS','MANAGE_QMS','EDIT_COMPLIANCE'])&&hasAnyPermission(user,['VIEW_QMS','VIEW_COMPLIANCE'])},limits:{register_rows:100},note:'Company operations only. Personal banking balances are not aggregated into this workspace.'};
}
module.exports={MODULES,ErpError,normalizeCampaign,utcTime,workspace,saveCampaign,createJob,scheduleOperation};
