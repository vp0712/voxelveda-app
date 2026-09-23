'use strict';

const crypto=require('node:crypto');
const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { ensureFinanceSchema }=require('../services/financeSchema');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');

const ENTITY_TYPES=new Set(['CUSTOMER','PROJECT','SERVICE','PRODUCT','CHANNEL','OTHER']);
function userId(req){return privacy.userId(req)}
function clean(v,max=500){const s=String(v??'').trim();return s?s.slice(0,max):null}
function round(v){return Math.round((Number(v||0)+Number.EPSILON)*10000)/10000}
function currency(v){const c=String(v||'').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(c))throw new FinanceError('Currency must be a 3-letter code.',400,'INVALID_PROFITABILITY_CURRENCY');return c}
function amount(v,label='Amount'){const n=Number(v);if(!Number.isFinite(n)||n<=0)throw new FinanceError(`${label} must be greater than zero.`,400,'INVALID_PROFITABILITY_AMOUNT');return round(n)}
function percent(v){if(v===undefined||v===null||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<-100||n>100)throw new FinanceError('Target margin must be between -100% and 100%.',400,'INVALID_MARGIN_TARGET');return round(n)}
function fullBusinessAccess(req){const s=req.bankingAccessScope;return Boolean(s&&(s.is_admin||(!s.has_explicit_grants&&s.can_view_all_business)))}
function assertFullBusiness(req){if(!fullBusinessAccess(req))throw new FinanceError('Full Company Finance visibility is required for Profitability & Margin Control.',403,'PROFITABILITY_FULL_BUSINESS_ACCESS_REQUIRED')}
function audit(req,action,recordType,recordId,oldValue,newValue){return {actorId:userId(req),action,module:'finance',recordType,recordId:String(recordId),oldValue,newValue,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null}}
function fail(res,error,message='Profitability & Margin Control failed.'){if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});console.error(message,error);return res.status(500).json({message,code:'FINANCE_PROFITABILITY_FAILED'})}
async function entity(db,uid,{forUpdate=false}={}){const suffix=forUpdate?' FOR UPDATE':'';const [[row]]=await db.query(`SELECT * FROM finance_profitability_entities WHERE entity_uid=? LIMIT 1${suffix}`,[String(uid||'')]);if(!row)throw new FinanceError('Profitability dimension not found.',404,'PROFITABILITY_ENTITY_NOT_FOUND');return row}
async function invoice(db,id,{forUpdate=false}={}){const suffix=forUpdate?' FOR UPDATE':'';const [[row]]=await db.query(`SELECT * FROM invoices WHERE id=? AND (deleted=0 OR deleted IS NULL) LIMIT 1${suffix}`,[Number(id||0)]);if(!row)throw new FinanceError('Invoice not found.',404,'PROFITABILITY_INVOICE_NOT_FOUND');return row}
async function sourceTransaction(db,id,req,{forUpdate=false}={}){
 const tx=await privacy.assertBankTransactionAccess(db,id,req,{forUpdate});
 if(String(tx.account_scope||'').toUpperCase()!=='BUSINESS')throw new FinanceError('Profitability allocation requires a BUSINESS bank transaction.',400,'PROFITABILITY_BUSINESS_TRANSACTION_REQUIRED');
 if(tx.archived_at)throw new FinanceError('Restore this bank transaction before allocating it.',409,'PROFITABILITY_TRANSACTION_ARCHIVED');
 if(String(tx.reconciliation_status||'').toUpperCase()==='IGNORED')throw new FinanceError('Ignored transactions cannot be allocated to profitability.',409,'PROFITABILITY_TRANSACTION_IGNORED');
 if(Number(tx.is_internal_transfer||0))throw new FinanceError('Internal transfers are excluded from profitability.',409,'PROFITABILITY_INTERNAL_TRANSFER_EXCLUDED');
 const debit=Number(tx.debit||0),credit=Number(tx.credit||0);
 if((debit>0&&credit>0)||(debit<=0&&credit<=0))throw new FinanceError('Transaction must have one clear debit or credit amount.',400,'PROFITABILITY_TRANSACTION_DIRECTION_INVALID');
 return {...tx,source_amount:round(debit>0?debit:credit),suggested_role:credit>0?'REVENUE':'COST'};
}

exports.getCenter=async(req,res)=>{
 try{
  await ensureFinanceSchema();assertFullBusiness(req);
  const [entities,allocations,invoiceLinks,candidates,invoices]=await Promise.all([
   pool.query(`SELECT * FROM finance_profitability_entities ORDER BY FIELD(status,'ACTIVE','ARCHIVED'),entity_type,name,id`).then(([r])=>r),
   pool.query(`SELECT a.*,e.entity_uid,e.name AS entity_name,e.entity_type,bt.transaction_date,bt.description,bt.merchant_name,ba.nickname AS account_name
      FROM finance_profitability_allocations a
      JOIN finance_profitability_entities e ON e.id=a.entity_id
      JOIN bank_transactions bt ON bt.id=a.bank_transaction_id
      JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE ba.ownership_scope='BUSINESS'
      ORDER BY a.created_at DESC,a.id DESC LIMIT 500`).then(([r])=>r),
   pool.query(`SELECT l.*,e.entity_uid,e.name AS entity_name,e.entity_type,i.invoice_no,i.customer_name,i.customer_email,
       i.total,COALESCE(p.paid_amount,0) AS paid_amount,GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0) AS balance_due
      FROM finance_profitability_invoice_links l
      JOIN finance_profitability_entities e ON e.id=l.entity_id
      JOIN invoices i ON i.id=l.invoice_id AND (i.deleted=0 OR i.deleted IS NULL)
      LEFT JOIN (SELECT invoice_id,SUM(amount) AS paid_amount FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
      ORDER BY l.created_at DESC,l.id DESC LIMIT 300`).then(([r])=>r),
   pool.query(`SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.credit,bt.currency,ba.nickname AS account_name,
       COALESCE(a.allocated_amount,0) AS allocated_amount,
       GREATEST(CASE WHEN bt.debit>0 THEN bt.debit ELSE bt.credit END-COALESCE(a.allocated_amount,0),0) AS remaining_amount,
       CASE WHEN bt.credit>0 THEN 'REVENUE' ELSE 'COST' END AS suggested_role
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      LEFT JOIN (SELECT bank_transaction_id,SUM(amount) AS allocated_amount FROM finance_profitability_allocations WHERE status='ACTIVE' GROUP BY bank_transaction_id) a ON a.bank_transaction_id=bt.id
      WHERE ba.ownership_scope='BUSINESS' AND bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED'
        AND bt.is_internal_transfer=0 AND ((bt.debit>0 AND bt.credit=0) OR (bt.credit>0 AND bt.debit=0))
        AND bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 730 DAY)
        AND GREATEST(CASE WHEN bt.debit>0 THEN bt.debit ELSE bt.credit END-COALESCE(a.allocated_amount,0),0)>0.005
      ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 250`).then(([r])=>r),
   pool.query(`SELECT i.id,i.invoice_no,i.customer_name,i.customer_email,i.total,i.status,i.created_at,
       COALESCE(p.paid_amount,0) AS paid_amount,GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0) AS balance_due
      FROM invoices i
      LEFT JOIN (SELECT invoice_id,SUM(amount) AS paid_amount FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
      WHERE (i.deleted=0 OR i.deleted IS NULL)
        AND NOT EXISTS(SELECT 1 FROM finance_profitability_invoice_links l WHERE l.invoice_id=i.id AND l.status='ACTIVE')
      ORDER BY i.created_at DESC,i.id DESC LIMIT 150`).then(([r])=>r)
  ]);

  const activeAlloc=allocations.filter(a=>a.status==='ACTIVE'),activeLinks=invoiceLinks.filter(l=>l.status==='ACTIVE');
  const entityMap=new Map(entities.map(e=>[Number(e.id),{...e,target_margin_percent:e.target_margin_percent===null?null:Number(e.target_margin_percent),by_currency:{},billing_by_currency:{}}]));
  for(const a of activeAlloc){const e=entityMap.get(Number(a.entity_id));if(!e)continue;const c=String(a.currency||'AUD').toUpperCase();e.by_currency[c]||={revenue:0,cost:0,margin:0,margin_percent:null,allocation_count:0};const x=e.by_currency[c];if(a.allocation_role==='REVENUE')x.revenue+=Number(a.amount||0);else x.cost+=Number(a.amount||0);x.allocation_count++}
  for(const e of entityMap.values())for(const x of Object.values(e.by_currency)){x.revenue=round(x.revenue);x.cost=round(x.cost);x.margin=round(x.revenue-x.cost);x.margin_percent=x.revenue>0?round(x.margin/x.revenue*100):null}
  for(const l of activeLinks){const e=entityMap.get(Number(l.entity_id));if(!e)continue;const c=String(l.currency||'').toUpperCase();e.billing_by_currency[c]||={invoice_value:0,paid_amount:0,balance_due:0,invoice_count:0};const x=e.billing_by_currency[c];x.invoice_value+=Number(l.total||0);x.paid_amount+=Number(l.paid_amount||0);x.balance_due+=Number(l.balance_due||0);x.invoice_count++}
  for(const e of entityMap.values())for(const x of Object.values(e.billing_by_currency)){x.invoice_value=round(x.invoice_value);x.paid_amount=round(x.paid_amount);x.balance_due=round(x.balance_due)}

  const totalsByCurrency={};let belowTarget=0;
  for(const e of entityMap.values()){if(e.status!=='ACTIVE')continue;for(const [c,x] of Object.entries(e.by_currency)){totalsByCurrency[c]||={revenue:0,cost:0,margin:0};totalsByCurrency[c].revenue+=x.revenue;totalsByCurrency[c].cost+=x.cost;if(e.target_margin_percent!==null&&x.margin_percent!==null&&x.margin_percent<e.target_margin_percent)belowTarget++}}
  for(const x of Object.values(totalsByCurrency)){x.revenue=round(x.revenue);x.cost=round(x.cost);x.margin=round(x.revenue-x.cost);x.margin_percent=x.revenue>0?round(x.margin/x.revenue*100):null}

  return res.json({
   rules:{
    cash_margin:'Cash margin uses only explicit allocations of canonical BUSINESS bank transactions. It never invents revenue or cost.',
    billing:'Invoice value, payments and receivables are billing context only and are never added to cash margin.',
    currency:'Currencies remain separate. No management FX conversion is performed in this module.',
    allocation:'A bank transaction may be partially allocated across dimensions, but total active allocations can never exceed the source amount.',
    history:'Reversal preserves the original allocation/link and audit history instead of deleting evidence.'
   },
   summary:{active_dimensions:[...entityMap.values()].filter(e=>e.status==='ACTIVE').length,below_target_positions:belowTarget,unallocated_transaction_count:candidates.length,unlinked_invoice_count:invoices.length},
   totals_by_currency:totalsByCurrency,
   entities:[...entityMap.values()],
   allocations:allocations.map(a=>({...a,amount:Number(a.amount||0)})),
   invoice_links:invoiceLinks.map(l=>({...l,total:Number(l.total||0),paid_amount:Number(l.paid_amount||0),balance_due:Number(l.balance_due||0)})),
   transaction_candidates:candidates.map(x=>({...x,debit:Number(x.debit||0),credit:Number(x.credit||0),allocated_amount:Number(x.allocated_amount||0),remaining_amount:Number(x.remaining_amount||0)})),
   invoice_candidates:invoices.map(x=>({...x,total:Number(x.total||0),paid_amount:Number(x.paid_amount||0),balance_due:Number(x.balance_due||0)}))
  });
 }catch(error){return fail(res,error,'Failed to load Profitability & Margin Control.')}
};

exports.createEntity=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const type=String(req.body.entity_type||'').trim().toUpperCase();if(!ENTITY_TYPES.has(type))throw new FinanceError('Choose Customer, Project, Service, Product, Channel or Other.',400,'INVALID_PROFITABILITY_ENTITY_TYPE');const name=clean(req.body.name,180);if(!name)throw new FinanceError('Dimension name is required.',400,'PROFITABILITY_ENTITY_NAME_REQUIRED');const uid=crypto.randomUUID(),target=percent(req.body.target_margin_percent);await db.query(`INSERT INTO finance_profitability_entities (entity_uid,entity_type,entity_code,name,owner_name,target_margin_percent,notes,status,created_by) VALUES (?,?,?,?,?,?,?,'ACTIVE',?)`,[uid,type,clean(req.body.entity_code,60),name,clean(req.body.owner_name,160),target,clean(req.body.notes,800),userId(req)]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_ENTITY_CREATED','finance_profitability_entity',uid,null,{entity_type:type,name,target_margin_percent:target}));await db.commit();return res.status(201).json({message:'Profitability dimension created.',entity_uid:uid})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to create profitability dimension.')}finally{db.release()}
};

exports.updateEntity=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const e=await entity(db,req.params.uid,{forUpdate:true});const type=String(req.body.entity_type||e.entity_type).trim().toUpperCase();if(!ENTITY_TYPES.has(type))throw new FinanceError('Invalid profitability dimension type.',400,'INVALID_PROFITABILITY_ENTITY_TYPE');const name=clean(req.body.name??e.name,180);if(!name)throw new FinanceError('Dimension name is required.',400,'PROFITABILITY_ENTITY_NAME_REQUIRED');const target=req.body.target_margin_percent===undefined?(e.target_margin_percent===null?null:Number(e.target_margin_percent)):percent(req.body.target_margin_percent);await db.query(`UPDATE finance_profitability_entities SET entity_type=?,entity_code=?,name=?,owner_name=?,target_margin_percent=?,notes=? WHERE id=?`,[type,clean(req.body.entity_code??e.entity_code,60),name,clean(req.body.owner_name??e.owner_name,160),target,clean(req.body.notes??e.notes,800),e.id]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_ENTITY_UPDATED','finance_profitability_entity',e.entity_uid,e,{entity_type:type,name,target_margin_percent:target}));await db.commit();return res.json({message:'Profitability dimension updated.'})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to update profitability dimension.')}finally{db.release()}
};

exports.setEntityStatus=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const e=await entity(db,req.params.uid,{forUpdate:true});const status=req.body.active===false?'ARCHIVED':'ACTIVE';await db.query('UPDATE finance_profitability_entities SET status=? WHERE id=?',[status,e.id]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_ENTITY_STATUS','finance_profitability_entity',e.entity_uid,{status:e.status},{status}));await db.commit();return res.json({message:status==='ACTIVE'?'Profitability dimension restored.':'Profitability dimension archived. Historical allocations and invoice links remain preserved.',status})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to update profitability dimension status.')}finally{db.release()}
};

exports.allocate=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const e=await entity(db,req.body.entity_uid,{forUpdate:true});if(e.status!=='ACTIVE')throw new FinanceError('Restore this dimension before allocating new activity.',409,'PROFITABILITY_ENTITY_ARCHIVED');const tx=await sourceTransaction(db,req.body.bank_transaction_id,req,{forUpdate:true});const role=String(req.body.allocation_role||tx.suggested_role).trim().toUpperCase();if(!['REVENUE','COST'].includes(role))throw new FinanceError('Allocation role must be Revenue or Cost.',400,'INVALID_PROFITABILITY_ROLE');if(role!==tx.suggested_role)throw new FinanceError(`This transaction is a ${tx.suggested_role.toLowerCase()} cash movement. Profitability role must match the bank evidence.`,400,'PROFITABILITY_ROLE_DIRECTION_MISMATCH');const value=amount(req.body.amount);const [[used]]=await db.query("SELECT COALESCE(SUM(amount),0) AS allocated FROM finance_profitability_allocations WHERE bank_transaction_id=? AND status='ACTIVE'",[tx.id]);const remaining=round(tx.source_amount-Number(used.allocated||0));if(value>remaining+0.005)throw new FinanceError(`Allocation exceeds the remaining source amount of ${remaining.toFixed(2)} ${tx.currency}.`,409,'PROFITABILITY_OVERALLOCATION');const allocationUid=crypto.randomUUID();await db.query(`INSERT INTO finance_profitability_allocations (allocation_uid,entity_id,bank_transaction_id,allocation_role,amount,currency,note,status,allocated_by) VALUES (?,?,?,?,?,?,?,'ACTIVE',?)`,[allocationUid,e.id,tx.id,role,value,String(tx.currency||'AUD').toUpperCase(),clean(req.body.note,600),userId(req)]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_ALLOCATED','finance_profitability_allocation',allocationUid,null,{entity_uid:e.entity_uid,bank_transaction_id:tx.id,allocation_role:role,amount:value,currency:tx.currency}));await db.commit();return res.status(201).json({message:'Bank evidence allocated to profitability. The underlying transaction was not changed.',allocation_uid:allocationUid,remaining_amount:round(remaining-value)})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to allocate profitability evidence.')}finally{db.release()}
};

exports.reverseAllocation=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const [[a]]=await db.query('SELECT * FROM finance_profitability_allocations WHERE allocation_uid=? LIMIT 1 FOR UPDATE',[String(req.params.uid||'')]);if(!a)throw new FinanceError('Profitability allocation not found.',404,'PROFITABILITY_ALLOCATION_NOT_FOUND');if(a.status!=='ACTIVE')throw new FinanceError('This allocation is already reversed.',409,'PROFITABILITY_ALLOCATION_ALREADY_REVERSED');const reason=clean(req.body.reason,600);if(!reason)throw new FinanceError('Enter a reversal reason.',400,'PROFITABILITY_REVERSAL_REASON_REQUIRED');await db.query("UPDATE finance_profitability_allocations SET status='REVERSED',reversed_by=?,reversed_at=NOW(),reversal_reason=? WHERE id=?",[userId(req),reason,a.id]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_ALLOCATION_REVERSED','finance_profitability_allocation',a.allocation_uid,a,{status:'REVERSED',reason}));await db.commit();return res.json({message:'Profitability allocation reversed. Source bank evidence and allocation history remain preserved.'})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to reverse profitability allocation.')}finally{db.release()}
};

exports.linkInvoice=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const e=await entity(db,req.body.entity_uid,{forUpdate:true});if(e.status!=='ACTIVE')throw new FinanceError('Restore this dimension before linking invoices.',409,'PROFITABILITY_ENTITY_ARCHIVED');const inv=await invoice(db,req.body.invoice_id,{forUpdate:true}),cur=currency(req.body.currency);const [[existing]]=await db.query("SELECT id FROM finance_profitability_invoice_links WHERE invoice_id=? AND status='ACTIVE' LIMIT 1 FOR UPDATE",[inv.id]);if(existing)throw new FinanceError('This invoice is already linked to an active profitability dimension.',409,'PROFITABILITY_INVOICE_ALREADY_LINKED');const uid=crypto.randomUUID();await db.query(`INSERT INTO finance_profitability_invoice_links (link_uid,entity_id,invoice_id,currency,status,note,linked_by) VALUES (?,?,?,?,'ACTIVE',?,?)`,[uid,e.id,inv.id,cur,clean(req.body.note,600),userId(req)]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_INVOICE_LINKED','finance_profitability_invoice_link',uid,null,{entity_uid:e.entity_uid,invoice_id:inv.id,currency:cur,invoice_no:inv.invoice_no}));await db.commit();return res.status(201).json({message:'Invoice linked as billing context. It is not added to cash margin.',link_uid:uid})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to link profitability invoice.')}finally{db.release()}
};

exports.reverseInvoiceLink=async(req,res)=>{
 const db=await pool.getConnection();
 try{await ensureFinanceSchema();assertFullBusiness(req);await db.beginTransaction();const [[l]]=await db.query('SELECT * FROM finance_profitability_invoice_links WHERE link_uid=? LIMIT 1 FOR UPDATE',[String(req.params.uid||'')]);if(!l)throw new FinanceError('Profitability invoice link not found.',404,'PROFITABILITY_INVOICE_LINK_NOT_FOUND');if(l.status!=='ACTIVE')throw new FinanceError('This invoice link is already reversed.',409,'PROFITABILITY_INVOICE_LINK_ALREADY_REVERSED');const reason=clean(req.body.reason,600);if(!reason)throw new FinanceError('Enter a reversal reason.',400,'PROFITABILITY_REVERSAL_REASON_REQUIRED');await db.query("UPDATE finance_profitability_invoice_links SET status='REVERSED',reversed_by=?,reversed_at=NOW(),reversal_reason=? WHERE id=?",[userId(req),reason,l.id]);await logAudit(db,audit(req,'FINANCE_PROFITABILITY_INVOICE_LINK_REVERSED','finance_profitability_invoice_link',l.link_uid,l,{status:'REVERSED',reason}));await db.commit();return res.json({message:'Invoice link reversed. Historical evidence remains preserved.'})}
 catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to reverse invoice link.')}finally{db.release()}
};
