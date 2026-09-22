'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const privacy = require('../services/financePrivacyService');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');
const { ensureFinanceSchema } = require('../services/financeSchema');

const SCOPES = new Set(['PERSONAL','BUSINESS','MIXED','UNCLASSIFIED']);
const REIMBURSEMENT_STATUSES = new Set(['DRAFT','SUBMITTED','APPROVED','REJECTED','PARTIALLY_REIMBURSED','FULLY_REIMBURSED']);

function uid(prefix) { return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`; }
function userId(req) { return Number(req.user?.id || req.user?.user_id || 0); }
function audit(req, action, recordType, recordId, oldValue, newValue) {
  return { actorId:userId(req),action,module:'finance_relationships',recordType,recordId:String(recordId),
    oldValue:oldValue||null,newValue:newValue||null,requestId:req.requestId||null,sessionId:req.session?.id||null,
    ipAddress:req.ip||null,userAgent:req.get('user-agent')||null };
}
function fail(res,error,message) {
  if (error instanceof FinanceError) return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_RELATIONSHIP_ERROR'});
}
async function transactionForUpdate(db,id,req) {
  await privacy.assertBankTransactionAccess(db, id, req);
  const [[row]]=await db.query(
    `SELECT bt.*,ba.nickname AS account_name,ba.institution,ba.ownership_scope AS account_scope
       FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id WHERE bt.id=? LIMIT 1 FOR UPDATE`,[id]
  );
  if(!row) throw new FinanceError('Transaction not found.',404,'BANK_TRANSACTION_NOT_FOUND');
  return row;
}

exports.getSplits=async(req,res)=>{
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0);
    const [rows]=await pool.query('SELECT * FROM bank_transaction_splits WHERE parent_bank_transaction_id=? ORDER BY sequence_no,id',[id]);
    return res.json({parent_transaction_id:id,splits:rows});
  }catch(error){return fail(res,error,'Failed to load transaction splits.')}
};

exports.replaceSplits=async(req,res)=>{
  let db;
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0),splits=Array.isArray(req.body.splits)?req.body.splits:[];
    if(splits.length<2) throw new FinanceError('A split transaction requires at least two split lines.',400,'SPLIT_LINES_REQUIRED');
    db=await pool.getConnection();await db.beginTransaction();const parent=await transactionForUpdate(db,id,req);
    if(Number(parent.is_internal_transfer)) throw new FinanceError('Internal transfers cannot be split into expense/income categories.',409,'TRANSFER_SPLIT_FORBIDDEN');
    const parentCents=money.toCents(Number(parent.debit)>0?parent.debit:parent.credit);
    let sum=0n;const normalized=splits.map((line,index)=>{
      const amount=money.fromCents(money.toCents(line.amount)),amountCents=money.toCents(amount);
      if(amountCents<=0n) throw new FinanceError(`Split line ${index+1} must be greater than zero.`,400,'INVALID_SPLIT_AMOUNT');
      const gst=money.fromCents(money.toCents(line.gst_amount||0));if(money.toCents(gst)<0n||money.toCents(gst)>amountCents)throw new FinanceError(`Split line ${index+1} has invalid GST.`,400,'INVALID_SPLIT_GST');
      const scope=String(line.ownership_scope||parent.ownership_scope||'UNCLASSIFIED').toUpperCase();
      if(!SCOPES.has(scope))throw new FinanceError(`Split line ${index+1} has invalid ownership.`,400,'INVALID_SPLIT_SCOPE');
      sum+=amountCents;return {sequence_no:index+1,amount,gst_amount:gst,category:String(line.category||'').trim().slice(0,120)||null,
        subcategory:String(line.subcategory||'').trim().slice(0,120)||null,ownership_scope:scope,
        project_ref:String(line.project_ref||'').trim().slice(0,120)||null,tags:Array.isArray(line.tags)?line.tags.slice(0,30).map(v=>String(v).slice(0,80)):[],
        note:String(line.note||'').trim().slice(0,1000)||null};
    });
    if(sum!==parentCents)throw new FinanceError(`Split total must equal the parent transaction amount exactly (${money.fromCents(parentCents)}).`,400,'SPLIT_TOTAL_MISMATCH');
    const [old]=await db.query('SELECT * FROM bank_transaction_splits WHERE parent_bank_transaction_id=? ORDER BY sequence_no',[id]);
    await db.query('DELETE FROM bank_transaction_splits WHERE parent_bank_transaction_id=?',[id]);
    for(const line of normalized) await db.query(
      `INSERT INTO bank_transaction_splits
       (split_uid,parent_bank_transaction_id,sequence_no,amount,gst_amount,category,subcategory,ownership_scope,project_ref,tags_json,note,created_by,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid('SPLIT'),id,line.sequence_no,line.amount,line.gst_amount,line.category,line.subcategory,line.ownership_scope,line.project_ref,JSON.stringify(line.tags),line.note,userId(req),userId(req)]
    );
    await logAudit(db,audit(req,'BANK_TRANSACTION_SPLITS_REPLACED','bank_transaction',id,old,normalized));await db.commit();
    return res.json({message:'Transaction split saved. The original source transaction remains unchanged.',parent_amount:money.fromCents(parentCents),splits:normalized});
  }catch(error){if(db)await db.rollback().catch(()=>{});return fail(res,error,'Failed to save transaction splits.')}finally{if(db)db.release()}
};

exports.getRefundLinks=async(req,res)=>{
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0);
    const [rows]=await pool.query(
      `SELECT fr.*,orig.transaction_date AS original_date,orig.description AS original_description,orig.debit AS original_debit,
              refund.transaction_date AS refund_date,refund.description AS refund_description,refund.credit AS refund_credit,refund.currency
         FROM finance_refund_links fr
         JOIN bank_transactions orig ON orig.id=fr.original_expense_transaction_id
         JOIN bank_transactions refund ON refund.id=fr.refund_bank_transaction_id
        WHERE (fr.refund_bank_transaction_id=? OR fr.original_expense_transaction_id=?) AND fr.status='ACTIVE'
        ORDER BY fr.created_at DESC`,[id,id]);
    return res.json({transaction_id:id,links:rows});
  }catch(error){return fail(res,error,'Failed to load refund links.')}
};

exports.linkRefund=async(req,res)=>{
  let db;
  try{
    await ensureFinanceSchema();const refundId=Number(req.params.id||0),expenseId=Number(req.body.original_expense_transaction_id||0);
    if(!expenseId||expenseId===refundId)throw new FinanceError('Choose a different original expense transaction.',400,'ORIGINAL_EXPENSE_REQUIRED');
    await privacy.assertBankTransactionAccess(pool,expenseId,req);
    db=await pool.getConnection();await db.beginTransaction();
    const refund=await transactionForUpdate(db,refundId,req),expense=await transactionForUpdate(db,expenseId,req);
    if(money.toCents(refund.credit||0)<=0n)throw new FinanceError('The refund transaction must be a credit.',400,'REFUND_CREDIT_REQUIRED');
    if(money.toCents(expense.debit||0)<=0n)throw new FinanceError('The original transaction must be an expense debit.',400,'ORIGINAL_EXPENSE_DEBIT_REQUIRED');
    if(String(refund.currency)!==String(expense.currency))throw new FinanceError('Cross-currency refund linking requires verified FX evidence and is not enabled.',409,'REFUND_FX_EVIDENCE_REQUIRED');
    const [[refundUsed]]=await db.query("SELECT COALESCE(SUM(linked_amount),0) AS used FROM finance_refund_links WHERE refund_bank_transaction_id=? AND status='ACTIVE'",[refundId]);
    const [[expenseUsed]]=await db.query("SELECT COALESCE(SUM(linked_amount),0) AS used FROM finance_refund_links WHERE original_expense_transaction_id=? AND status='ACTIVE'",[expenseId]);
    const refundAvailable=money.toCents(refund.credit)-money.toCents(refundUsed.used||0),expenseAvailable=money.toCents(expense.debit)-money.toCents(expenseUsed.used||0);
    const requested=req.body.linked_amount===undefined||req.body.linked_amount===''?(refundAvailable<expenseAvailable?refundAvailable:expenseAvailable):money.toCents(req.body.linked_amount);
    if(requested<=0n||requested>refundAvailable||requested>expenseAvailable)throw new FinanceError('Linked refund amount exceeds the remaining refund or original expense balance.',400,'REFUND_LINK_AMOUNT_INVALID');
    const linkUid=uid('REFUND');await db.query(
      `INSERT INTO finance_refund_links (link_uid,refund_bank_transaction_id,original_expense_transaction_id,linked_amount,note,created_by)
       VALUES (?,?,?,?,?,?)`,
      [linkUid,refundId,expenseId,money.fromCents(requested),String(req.body.note||'').trim().slice(0,1000)||null,userId(req)]
    );
    await logAudit(db,audit(req,'REFUND_LINK_CREATED','bank_transaction',refundId,null,{link_uid:linkUid,original_expense_transaction_id:expenseId,linked_amount:money.fromCents(requested),currency:refund.currency}));
    await db.commit();return res.status(201).json({message:'Refund linked to the original expense. It must not be treated as ordinary revenue.',link_uid:linkUid,linked_amount:money.fromCents(requested),currency:refund.currency});
  }catch(error){if(db)await db.rollback().catch(()=>{});return fail(res,error,'Failed to link refund.')}finally{if(db)db.release()}
};

exports.unlinkRefund=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();const refundId=Number(req.params.id||0),linkId=Number(req.params.linkId||0);await transactionForUpdate(db,refundId,req);
    const [[link]]=await db.query("SELECT * FROM finance_refund_links WHERE id=? AND refund_bank_transaction_id=? AND status='ACTIVE' FOR UPDATE",[linkId,refundId]);
    if(!link)throw new FinanceError('Active refund link not found.',404,'REFUND_LINK_NOT_FOUND');
    await db.query("UPDATE finance_refund_links SET status='VOID',voided_by=?,voided_at=NOW() WHERE id=?",[userId(req),linkId]);
    await logAudit(db,audit(req,'REFUND_LINK_VOIDED','finance_refund_link',linkId,link,{status:'VOID'}));await db.commit();
    return res.json({message:'Refund link removed. Source transactions remain unchanged.'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to remove refund link.')}finally{db.release()}
};

exports.listReimbursements=async(req,res)=>{
  try{
    await ensureFinanceSchema();const clauses=[privacy.visibilitySql('ba',req)],params=[...privacy.visibilityParams(req)];
    const status=String(req.query.status||'').toUpperCase();if(status&&REIMBURSEMENT_STATUSES.has(status)){clauses.push('r.status=?');params.push(status)}
    const [rows]=await pool.query(
      `SELECT r.*,bt.transaction_date,bt.description,bt.merchant_name,bt.debit AS expense_amount,ba.nickname AS account_name,ba.institution,
              COALESCE(SUM(rp.amount),0) AS paid_amount
         FROM finance_reimbursements r JOIN bank_transactions bt ON bt.id=r.expense_bank_transaction_id
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id LEFT JOIN finance_reimbursement_payments rp ON rp.reimbursement_id=r.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY r.id,bt.id,ba.id ORDER BY r.created_at DESC LIMIT 250`,params);
    return res.json({reimbursements:rows.map(row=>({...row,remaining_amount:money.fromCents(money.toCents(row.requested_amount)-money.toCents(row.paid_amount||0))}))});
  }catch(error){return fail(res,error,'Failed to load reimbursements.')}
};

exports.createReimbursement=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();const expenseId=Number(req.body.expense_bank_transaction_id||0);await db.beginTransaction();const expense=await transactionForUpdate(db,expenseId,req);
    if(money.toCents(expense.debit||0)<=0n)throw new FinanceError('Reimbursement must reference an expense debit.',400,'REIMBURSEMENT_EXPENSE_REQUIRED');
    const requested=req.body.requested_amount?money.toCents(req.body.requested_amount):money.toCents(expense.debit);
    if(requested<=0n||requested>money.toCents(expense.debit))throw new FinanceError('Requested reimbursement cannot exceed the expense amount.',400,'REIMBURSEMENT_AMOUNT_INVALID');
    const rid=uid('REIMB');await db.query(
      `INSERT INTO finance_reimbursements
       (reimbursement_uid,expense_bank_transaction_id,claimant_user_id,requested_amount,currency,status,note,created_by)
       VALUES (?,?,?,?,?,'DRAFT',?,?)`,
      [rid,expenseId,userId(req),money.fromCents(requested),expense.currency,String(req.body.note||'').trim().slice(0,2000)||null,userId(req)]
    );
    await logAudit(db,audit(req,'REIMBURSEMENT_CREATED','bank_transaction',expenseId,null,{reimbursement_uid:rid,requested_amount:money.fromCents(requested),currency:expense.currency,claimant_user_id:userId(req)}));
    await db.commit();return res.status(201).json({message:'Reimbursement draft created.',reimbursement_uid:rid,status:'DRAFT'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to create reimbursement.')}finally{db.release()}
};

exports.transitionReimbursement=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0),action=String(req.params.action||'').toUpperCase();await db.beginTransaction();
    const [[row]]=await db.query(`SELECT r.*,bt.bank_account_id FROM finance_reimbursements r JOIN bank_transactions bt ON bt.id=r.expense_bank_transaction_id WHERE r.id=? FOR UPDATE`,[id]);
    if(!row)throw new FinanceError('Reimbursement not found.',404,'REIMBURSEMENT_NOT_FOUND');await privacy.assertBankTransactionAccess(db,row.expense_bank_transaction_id,req);
    let next=row.status,extra={};
    if(action==='SUBMIT'&&row.status==='DRAFT'){next='SUBMITTED';extra={submitted_at:new Date()}}
    else if(action==='APPROVE'&&row.status==='SUBMITTED'){next='APPROVED';extra={approved_by:userId(req),approved_at:new Date()}}
    else if(action==='REJECT'&&['DRAFT','SUBMITTED'].includes(row.status)){const reason=String(req.body.reason||'').trim();if(reason.length<3)throw new FinanceError('A rejection reason is required.',400,'REIMBURSEMENT_REJECTION_REASON_REQUIRED');next='REJECTED';extra={rejected_by:userId(req),rejected_at:new Date(),rejection_reason:reason}}
    else throw new FinanceError(`Cannot ${action.toLowerCase()} reimbursement from ${row.status}.`,409,'INVALID_REIMBURSEMENT_TRANSITION');
    if(action==='SUBMIT')await db.query("UPDATE finance_reimbursements SET status=?,submitted_at=NOW() WHERE id=?",[next,id]);
    if(action==='APPROVE')await db.query("UPDATE finance_reimbursements SET status=?,approved_by=?,approved_at=NOW() WHERE id=?",[next,userId(req),id]);
    if(action==='REJECT')await db.query("UPDATE finance_reimbursements SET status=?,rejected_by=?,rejected_at=NOW(),rejection_reason=? WHERE id=?",[next,userId(req),extra.rejection_reason,id]);
    await logAudit(db,audit(req,`REIMBURSEMENT_${action}`,'finance_reimbursement',id,{status:row.status},{status:next,...extra}));await db.commit();
    return res.json({message:`Reimbursement ${next.toLowerCase()}.`,status:next});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to update reimbursement.')}finally{db.release()}
};

exports.addReimbursementPayment=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0),paymentId=Number(req.body.payment_bank_transaction_id||0);await db.beginTransaction();
    const [[row]]=await db.query("SELECT * FROM finance_reimbursements WHERE id=? FOR UPDATE",[id]);if(!row)throw new FinanceError('Reimbursement not found.',404,'REIMBURSEMENT_NOT_FOUND');
    await privacy.assertBankTransactionAccess(db,row.expense_bank_transaction_id,req);const payment=await transactionForUpdate(db,paymentId,req);
    if(!['APPROVED','PARTIALLY_REIMBURSED'].includes(row.status))throw new FinanceError('Reimbursement must be approved before a payment can be linked.',409,'REIMBURSEMENT_NOT_APPROVED');
    if(String(payment.currency)!==String(row.currency))throw new FinanceError('Cross-currency reimbursement settlement requires verified FX evidence.',409,'REIMBURSEMENT_FX_EVIDENCE_REQUIRED');
    const [[paid]]=await db.query('SELECT COALESCE(SUM(amount),0) AS amount FROM finance_reimbursement_payments WHERE reimbursement_id=?',[id]);
    const remaining=money.toCents(row.requested_amount)-money.toCents(paid.amount||0);const requested=req.body.amount?money.toCents(req.body.amount):remaining;
    if(requested<=0n||requested>remaining)throw new FinanceError('Payment amount exceeds the reimbursement balance.',400,'REIMBURSEMENT_PAYMENT_INVALID');
    await db.query('INSERT INTO finance_reimbursement_payments (reimbursement_id,payment_bank_transaction_id,amount,created_by) VALUES (?,?,?,?)',[id,paymentId,money.fromCents(requested),userId(req)]);
    const next=requested===remaining?'FULLY_REIMBURSED':'PARTIALLY_REIMBURSED';await db.query('UPDATE finance_reimbursements SET status=? WHERE id=?',[next,id]);
    await logAudit(db,audit(req,'REIMBURSEMENT_PAYMENT_LINKED','finance_reimbursement',id,{status:row.status},{status:next,payment_bank_transaction_id:paymentId,amount:money.fromCents(requested)}));await db.commit();
    return res.status(201).json({message:'Reimbursement payment linked.',status:next,remaining_amount:money.fromCents(remaining-requested)});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to link reimbursement payment.')}finally{db.release()}
};
