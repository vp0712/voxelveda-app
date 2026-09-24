'use strict';

const crypto=require('node:crypto');
const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { ensureFinanceSchema }=require('../services/financeSchema');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');
const custodyService=require('../services/financeCashCustodyService');

function uid(req){return privacy.userId(req)}
function clean(value,max=500){const x=String(value??'').trim();return x?x.slice(0,max):null}
function money(value,label='Amount'){const n=Number(value);if(!Number.isFinite(n)||n<0)throw new FinanceError(label+' must be a valid non-negative amount.',400,'INVALID_CASH_CUSTODY_AMOUNT');return Math.round(n*10000)/10000}
function when(value){const text=String(value||'').trim();if(!text)return new Date();const d=new Date(text);if(Number.isNaN(d.getTime()))throw new FinanceError('Cash custody date is invalid.',400,'INVALID_CASH_CUSTODY_DATE');return d}
function isCashAccount(account){return /cash|petty|till|drawer/i.test(String(account?.account_type||'')+' '+String(account?.nickname||'')+' '+String(account?.financial_purpose||''))}
function audit(req,action,id,oldValue,newValue){return {actorId:uid(req),action,module:'finance',recordType:'finance_cash_custody',recordId:String(id),oldValue,newValue,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null}}
function fail(res,error,message){if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});if(error?.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This posted expense is already linked to active cash custody.',code:'CASH_CUSTODY_EXPENSE_ALREADY_LINKED'});console.error(message,error);return res.status(500).json({message,code:'FINANCE_CASH_CUSTODY_FAILED'})}

async function wallet(db,walletId,userId,{forUpdate=false}={}){
  const suffix=forUpdate?' FOR UPDATE':'';
  const [[row]]=await db.query("SELECT id,user_id,name,currency,balance,active FROM personal_money_wallets WHERE id=? AND user_id=?"+suffix,[String(walletId||''),String(userId)]);
  if(!row)throw new FinanceError('Personal cash wallet not found.',404,'PERSONAL_CASH_WALLET_NOT_FOUND');
  if(!Number(row.active))throw new FinanceError('Restore this Personal cash wallet before using Cash Custody.',409,'PERSONAL_CASH_WALLET_ARCHIVED');
  return row;
}
async function loadCase(db,custodyUid,req,{forUpdate=false}={}){
  const suffix=forUpdate?' FOR UPDATE':'';
  const [[row]]=await db.query("SELECT * FROM finance_cash_custody_cases WHERE custody_uid=? LIMIT 1"+suffix,[String(custodyUid||'')]);
  if(!row)throw new FinanceError('Cash custody record not found.',404,'CASH_CUSTODY_NOT_FOUND');
  if(row.source_type==='BANK_ACCOUNT')await privacy.assertAccountAccess(db,row.bank_account_id,req,{forUpdate});
  else await wallet(db,row.personal_wallet_id,uid(req),{forUpdate});
  const metrics=await custodyService.metrics(db,row.id);
  return {...row,...metrics};
}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const owner=uid(req),visibility=privacy.visibilitySql('ba',req),params=privacy.visibilityParams(req);
    const [cases,events]=await Promise.all([
      pool.query(
        "SELECT c.*,ba.nickname AS account_name,ba.institution,w.name AS wallet_name,"+
        "COALESCE((SELECT SUM(e.amount) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type='RETURN' AND e.reversed_at IS NULL),0) AS returned_amount,"+
        "COALESCE((SELECT SUM(e.amount) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type='EXPENSE_CLEARANCE' AND e.reversed_at IS NULL),0) AS cleared_expense_amount,"+
        "COALESCE((SELECT COUNT(*) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type IN ('RETURN','EXPENSE_CLEARANCE') AND e.reversed_at IS NULL),0) AS active_event_count "+
        "FROM finance_cash_custody_cases c LEFT JOIN bank_accounts ba ON c.source_type='BANK_ACCOUNT' AND ba.id=c.bank_account_id "+
        "LEFT JOIN personal_money_wallets w ON c.source_type='PERSONAL_WALLET' AND w.id=c.personal_wallet_id "+
        "WHERE (c.source_type='BANK_ACCOUNT' AND "+visibility+") OR (c.source_type='PERSONAL_WALLET' AND w.user_id=?) "+
        "ORDER BY FIELD(c.status,'OVERDUE','OPEN','PARTIAL','CLOSED','CANCELLED'),c.issued_at DESC,c.id DESC LIMIT 250",
        [...params,String(owner)]
      ).then(([rows])=>rows),
      pool.query(
        "SELECT e.*,c.custody_uid,c.currency,c.custodian FROM finance_cash_custody_events e JOIN finance_cash_custody_cases c ON c.id=e.custody_id "+
        "LEFT JOIN bank_accounts ba ON c.source_type='BANK_ACCOUNT' AND ba.id=c.bank_account_id "+
        "LEFT JOIN personal_money_wallets w ON c.source_type='PERSONAL_WALLET' AND w.id=c.personal_wallet_id "+
        "WHERE (c.source_type='BANK_ACCOUNT' AND "+visibility+") OR (c.source_type='PERSONAL_WALLET' AND w.user_id=?) "+
        "ORDER BY e.occurred_at DESC,e.id DESC LIMIT 500",
        [...params,String(owner)]
      ).then(([rows])=>rows)
    ]);
    const normalized=cases.map(row=>({...row,issued_amount:Number(row.issued_amount||0),returned_amount:Number(row.returned_amount||0),cleared_expense_amount:Number(row.cleared_expense_amount||0),active_event_count:Number(row.active_event_count||0),outstanding_amount:custodyService.remaining(row),display_status:custodyService.displayStatus(row)}));
    const byCurrency={};
    for(const row of normalized){
      const c=String(row.currency||'AUD').toUpperCase();
      byCurrency[c] ||= {issued_total:0,returned_total:0,cleared_expense_total:0,outstanding_total:0,open_cases:0,overdue_cases:0};
      byCurrency[c].issued_total+=row.issued_amount;byCurrency[c].returned_total+=row.returned_amount;byCurrency[c].cleared_expense_total+=row.cleared_expense_amount;byCurrency[c].outstanding_total+=row.outstanding_amount;
      if(!['CLOSED','CANCELLED'].includes(row.display_status)&&row.outstanding_amount>0.0001)byCurrency[c].open_cases++;
      if(row.display_status==='OVERDUE')byCurrency[c].overdue_cases++;
    }
    for(const x of Object.values(byCurrency))for(const k of ['issued_total','returned_total','cleared_expense_total','outstanding_total'])x[k]=Math.round(x[k]*10000)/10000;
    return res.json({
      rule:'Cash custody records physical control/location only. Giving or returning cash does not silently create an expense or alter the source ledger.',
      expense_rule:'Custody expense clearance only links an already-posted cash expense. It never creates a duplicate expense.',
      reversal_rule:'Wrong custody events are reversed with counter-evidence; history is not deleted.',
      cases:normalized,events:events.map(e=>({...e,amount:Number(e.amount||0)})),by_currency:byCurrency
    });
  }catch(error){return fail(res,error,'Failed to load Cash Custody.')}
};

exports.issue=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const owner=uid(req),source=String(req.body.source_type||'').trim().toUpperCase(),sourceId=String(req.body.source_id||'').trim();
    if(!['BANK_ACCOUNT','PERSONAL_WALLET'].includes(source))throw new FinanceError('Choose a Cash/Petty Cash account or Personal cash wallet.',400,'INVALID_CASH_CUSTODY_SOURCE');
    const custodian=clean(req.body.custodian,160);if(!custodian)throw new FinanceError('Custodian name is required.',400,'CASH_CUSTODIAN_REQUIRED');
    const amountValue=money(req.body.amount,'Custody amount');if(amountValue<=0)throw new FinanceError('Custody amount must be greater than zero.',400,'CASH_CUSTODY_AMOUNT_REQUIRED');
    let bankAccountId=null,walletId=null,scope='PERSONAL',currency='AUD',sourceName='',ledgerBalance=0;
    if(source==='BANK_ACCOUNT'){
      const account=await privacy.assertAccountAccess(db,Number(sourceId),req,{forUpdate:true});
      if(!isCashAccount(account))throw new FinanceError('Cash custody can only be issued from a Cash, Petty Cash, Till or Cash Drawer account.',400,'CASH_ACCOUNT_REQUIRED');
      bankAccountId=Number(account.id);scope=String(account.ownership_scope||'UNCLASSIFIED').toUpperCase();currency=String(account.currency||'AUD').toUpperCase();sourceName=account.nickname||'Cash account';
      ledgerBalance=Number(account.available_balance==null?account.current_ledger_balance:account.available_balance||0);
    }else{
      const w=await wallet(db,sourceId,owner,{forUpdate:true});walletId=w.id;currency=String(w.currency||'AUD').toUpperCase();sourceName=w.name||'Cash wallet';ledgerBalance=Number(w.balance||0);
    }
    const outstanding=await custodyService.outstandingForSource(db,{sourceType:source,bankAccountId,walletId}),onSite=Math.round((ledgerBalance-outstanding)*10000)/10000;
    if(amountValue>onSite+0.005)throw new FinanceError('Custody issue exceeds the expected cash currently on site for this source.',409,'CASH_CUSTODY_EXCEEDS_ON_SITE');
    const issuedAt=when(req.body.issued_at),dueAt=req.body.due_at?when(req.body.due_at):null;
    if(dueAt&&dueAt.getTime()<issuedAt.getTime())throw new FinanceError('Custody due date cannot be before the issue date.',400,'INVALID_CASH_CUSTODY_DUE_DATE');
    const custodyUid=crypto.randomUUID();
    await db.query("INSERT INTO finance_cash_custody_cases (custody_uid,source_type,bank_account_id,personal_wallet_id,ownership_scope,currency,custodian,purpose,issued_amount,issued_at,due_at,status,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [custodyUid,source,bankAccountId,walletId,scope,currency,custodian,clean(req.body.purpose,240),amountValue,issuedAt,dueAt,'OPEN',clean(req.body.note,700),owner]);
    await logAudit(db,audit(req,'FINANCE_CASH_CUSTODY_ISSUED',custodyUid,null,{source_type:source,source_id:sourceId,source_name:sourceName,custodian,amount:amountValue,currency,purpose:clean(req.body.purpose,240),ledger_balance_unchanged:true}));
    await db.commit();return res.status(201).json({message:'Cash custody issued as a location/control record. No expense or ledger movement was created.',custody_uid:custodyUid,amount:amountValue,currency,expected_on_site_after:Math.round((onSite-amountValue)*10000)/10000});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to issue Cash Custody.');}finally{db.release()}
};

exports.recordReturn=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const row=await loadCase(db,req.params.uid,req,{forUpdate:true});
    if(row.status==='CANCELLED')throw new FinanceError('Cancelled custody cannot receive a return.',409,'CASH_CUSTODY_CANCELLED');
    if(row.outstanding_amount<=0.0001)throw new FinanceError('This custody record has no outstanding cash.',409,'CASH_CUSTODY_ALREADY_CLOSED');
    const returned=money(req.body.amount,'Returned cash');if(returned<=0||returned>row.outstanding_amount+0.005)throw new FinanceError('Returned cash cannot exceed the custody outstanding amount.',400,'INVALID_CASH_CUSTODY_RETURN');
    const eventUid=crypto.randomUUID();
    await db.query("INSERT INTO finance_cash_custody_events (event_uid,custody_id,event_type,amount,occurred_at,reference_text,note,recorded_by) VALUES (?,?,?,?,?,?,?,?)",
      [eventUid,row.id,'RETURN',returned,when(req.body.occurred_at),clean(req.body.reference,240),clean(req.body.note,500),uid(req)]);
    const updated=await custodyService.refreshStatus(db,row.id,uid(req));
    await logAudit(db,audit(req,'FINANCE_CASH_CUSTODY_RETURNED',row.custody_uid,{outstanding_amount:row.outstanding_amount},{returned_amount:returned,outstanding_amount:updated.outstanding_amount,status:updated.status,ledger_balance_unchanged:true}));
    await db.commit();return res.json({message:'Cash return recorded against custody. The source ledger was not changed.',event_uid:eventUid,outstanding_amount:updated.outstanding_amount,status:updated.status});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to record Cash Custody return.');}finally{db.release()}
};

exports.expenseCandidates=async(req,res)=>{
  try{
    await ensureFinanceSchema();const row=await loadCase(pool,req.params.uid,req);
    if(row.status==='CANCELLED'||row.outstanding_amount<=0.0001)return res.json({custody_uid:row.custody_uid,currency:row.currency,outstanding_amount:row.outstanding_amount,candidates:[]});
    let candidates=[];
    if(row.source_type==='BANK_ACCOUNT'){
      const [rows]=await pool.query(
        "SELECT bt.id,bt.transaction_date AS occurred_at,bt.description,bt.merchant_name,bt.debit AS amount,bt.currency FROM bank_transactions bt "+
        "WHERE bt.bank_account_id=? AND bt.debit>0 AND bt.is_internal_transfer=0 AND bt.transaction_date>=DATE(?) AND bt.archived_at IS NULL "+
        "AND NOT EXISTS (SELECT 1 FROM finance_cash_custody_events e WHERE e.bank_transaction_id=bt.id AND e.event_type='EXPENSE_CLEARANCE' AND e.reversed_at IS NULL) "+
        "ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 150",[row.bank_account_id,row.issued_at]);
      candidates=rows.map(x=>({candidate_type:'BANK_TRANSACTION',id:x.id,occurred_at:x.occurred_at,description:x.merchant_name||x.description||('Transaction #'+x.id),amount:Number(x.amount||0),currency:x.currency}));
    }else{
      const [rows]=await pool.query(
        "SELECT e.id,e.occurred_at,e.counterparty,e.category,e.note,e.wallet_amount AS amount,w.currency FROM personal_money_entries e "+
        "JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id WHERE e.user_id=? AND e.wallet_id=? "+
        "AND e.entry_type IN ('EXPENSE','CASH_OUT') AND e.occurred_at>=? "+
        "AND NOT EXISTS (SELECT 1 FROM finance_cash_custody_events ce WHERE ce.personal_money_entry_id=e.id AND ce.event_type='EXPENSE_CLEARANCE' AND ce.reversed_at IS NULL) "+
        "ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT 150",[String(uid(req)),row.personal_wallet_id,row.issued_at]);
      candidates=rows.map(x=>({candidate_type:'PERSONAL_ENTRY',id:x.id,occurred_at:x.occurred_at,description:x.counterparty||x.category||x.note||('Personal entry '+x.id),amount:Number(x.amount||0),currency:x.currency}));
    }
    candidates=candidates.filter(x=>x.amount>0&&x.amount<=row.outstanding_amount+0.005&&String(x.currency||'').toUpperCase()===String(row.currency||'').toUpperCase());
    return res.json({custody_uid:row.custody_uid,currency:row.currency,outstanding_amount:row.outstanding_amount,candidates});
  }catch(error){return fail(res,error,'Failed to load Cash Custody expense candidates.')}
};

exports.clearExpense=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();const row=await loadCase(db,req.params.uid,req,{forUpdate:true});
    if(row.status==='CANCELLED'||row.outstanding_amount<=0.0001)throw new FinanceError('This custody record is not open for expense clearance.',409,'CASH_CUSTODY_NOT_OPEN');
    const type=String(req.body.candidate_type||'').trim().toUpperCase(),id=String(req.body.candidate_id||'').trim();
    if(!['BANK_TRANSACTION','PERSONAL_ENTRY'].includes(type)||!id)throw new FinanceError('Choose a posted cash expense to clear.',400,'CASH_CUSTODY_EXPENSE_REQUIRED');
    let amountValue=0,currency='',occurredAt=null,description='',bankTransactionId=null,personalEntryId=null,activeKey='';
    if(type==='BANK_TRANSACTION'){
      if(row.source_type!=='BANK_ACCOUNT')throw new FinanceError('Expense source does not match this custody source.',400,'CASH_CUSTODY_SOURCE_MISMATCH');
      const [[tx]]=await db.query("SELECT id,transaction_date,description,merchant_name,debit,currency,is_internal_transfer,archived_at FROM bank_transactions WHERE id=? AND bank_account_id=? LIMIT 1 FOR UPDATE",[Number(id),row.bank_account_id]);
      if(!tx||Number(tx.debit||0)<=0||Number(tx.is_internal_transfer)||tx.archived_at)throw new FinanceError('Selected bank item is not an eligible posted cash expense.',400,'INVALID_CASH_CUSTODY_EXPENSE');
      amountValue=Number(tx.debit||0);currency=tx.currency;occurredAt=tx.transaction_date;description=tx.merchant_name||tx.description||('Transaction #'+tx.id);bankTransactionId=tx.id;activeKey='BANK:'+tx.id;
    }else{
      if(row.source_type!=='PERSONAL_WALLET')throw new FinanceError('Expense source does not match this custody source.',400,'CASH_CUSTODY_SOURCE_MISMATCH');
      const [[entry]]=await db.query("SELECT e.id,e.entry_type,e.wallet_amount,e.occurred_at,e.counterparty,e.category,e.note,w.currency FROM personal_money_entries e JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id WHERE e.id=? AND e.user_id=? AND e.wallet_id=? LIMIT 1 FOR UPDATE",[id,String(uid(req)),row.personal_wallet_id]);
      if(!entry||!['EXPENSE','CASH_OUT'].includes(String(entry.entry_type||'').toUpperCase()))throw new FinanceError('Selected Personal Money item is not an eligible posted cash expense.',400,'INVALID_CASH_CUSTODY_EXPENSE');
      amountValue=Number(entry.wallet_amount||0);currency=entry.currency;occurredAt=entry.occurred_at;description=entry.counterparty||entry.category||entry.note||('Personal entry '+entry.id);personalEntryId=entry.id;activeKey='PERSONAL:'+entry.id;
    }
    if(String(currency||'').toUpperCase()!==String(row.currency||'').toUpperCase())throw new FinanceError('Custody and posted expense currencies do not match.',400,'CASH_CUSTODY_CURRENCY_MISMATCH');
    if(amountValue<=0||amountValue>row.outstanding_amount+0.005)throw new FinanceError('Posted expense exceeds custody outstanding. Split the source expense first if only part belongs to this float.',400,'CASH_CUSTODY_CLEARANCE_AMOUNT_MISMATCH');
    const [[existing]]=await db.query("SELECT id FROM finance_cash_custody_events WHERE active_link_key=? AND reversed_at IS NULL LIMIT 1 FOR UPDATE",[activeKey]);
    if(existing)throw new FinanceError('This posted expense is already linked to active cash custody.',409,'CASH_CUSTODY_EXPENSE_ALREADY_LINKED');
    const eventUid=crypto.randomUUID();
    await db.query("INSERT INTO finance_cash_custody_events (event_uid,custody_id,event_type,amount,occurred_at,bank_transaction_id,personal_money_entry_id,active_link_key,reference_text,note,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [eventUid,row.id,'EXPENSE_CLEARANCE',amountValue,occurredAt,bankTransactionId,personalEntryId,activeKey,description,clean(req.body.note,500),uid(req)]);
    const updated=await custodyService.refreshStatus(db,row.id,uid(req));
    await logAudit(db,audit(req,'FINANCE_CASH_CUSTODY_EXPENSE_CLEARED',row.custody_uid,{outstanding_amount:row.outstanding_amount},{expense_source:type,expense_id:id,amount:amountValue,outstanding_amount:updated.outstanding_amount,status:updated.status,ledger_balance_unchanged:true,duplicate_expense_created:false}));
    await db.commit();return res.json({message:'Posted cash expense linked to custody. The expense was not duplicated and the ledger was not changed.',event_uid:eventUid,amount:amountValue,outstanding_amount:updated.outstanding_amount,status:updated.status});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to clear Cash Custody expense.');}finally{db.release()}
};

exports.reverseEvent=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const [[event]]=await db.query("SELECT * FROM finance_cash_custody_events WHERE event_uid=? LIMIT 1 FOR UPDATE",[String(req.params.eventUid||'')]);
    if(!event||!['RETURN','EXPENSE_CLEARANCE'].includes(String(event.event_type||'').toUpperCase()))throw new FinanceError('Reversible Cash Custody event not found.',404,'CASH_CUSTODY_EVENT_NOT_FOUND');
    if(event.reversed_at)throw new FinanceError('This Cash Custody event is already reversed.',409,'CASH_CUSTODY_EVENT_ALREADY_REVERSED');
    const [[base]]=await db.query("SELECT custody_uid FROM finance_cash_custody_cases WHERE id=? LIMIT 1",[event.custody_id]);
    const row=await loadCase(db,base?.custody_uid,req,{forUpdate:true});
    const reason=clean(req.body.reason,500);if(!reason)throw new FinanceError('Enter a reason for reversing this event.',400,'CASH_CUSTODY_REVERSAL_REASON_REQUIRED');
    await db.query("UPDATE finance_cash_custody_events SET reversed_by=?,reversed_at=NOW(),reversal_reason=?,active_link_key=NULL WHERE id=?",[uid(req),reason,event.id]);
    const reversalUid=crypto.randomUUID();
    await db.query("INSERT INTO finance_cash_custody_events (event_uid,custody_id,event_type,amount,occurred_at,reversal_of_event_id,reference_text,note,recorded_by) VALUES (?,?,?,?,NOW(),?,?,?,?)",
      [reversalUid,event.custody_id,'REVERSAL',Number(event.amount||0),event.id,'Reversal of '+event.event_uid,reason,uid(req)]);
    const updated=await custodyService.refreshStatus(db,row.id,uid(req));
    await logAudit(db,audit(req,'FINANCE_CASH_CUSTODY_EVENT_REVERSED',row.custody_uid,{event_uid:event.event_uid,event_type:event.event_type,amount:Number(event.amount||0)},{reversal_event_uid:reversalUid,outstanding_amount:updated.outstanding_amount,status:updated.status,reason}));
    await db.commit();return res.json({message:'Cash Custody event reversed with counter-evidence. No history was deleted.',reversal_event_uid:reversalUid,outstanding_amount:updated.outstanding_amount,status:updated.status});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to reverse Cash Custody event.');}finally{db.release()}
};

exports.cancel=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();const row=await loadCase(db,req.params.uid,req,{forUpdate:true});
    if(row.status==='CANCELLED')throw new FinanceError('This custody issue is already cancelled.',409,'CASH_CUSTODY_ALREADY_CANCELLED');
    if(Number(row.active_event_count||0)>0)throw new FinanceError('Custody with return or expense-clearance activity cannot be cancelled. Reverse the child event first if it was wrong.',409,'CASH_CUSTODY_HAS_ACTIVITY');
    const reason=clean(req.body.reason,500);if(!reason)throw new FinanceError('Enter why this custody issue is being cancelled.',400,'CASH_CUSTODY_CANCEL_REASON_REQUIRED');
    await db.query("UPDATE finance_cash_custody_cases SET status='CANCELLED',cancelled_by=?,cancelled_at=NOW(),cancel_reason=?,closed_by=NULL,closed_at=NULL WHERE id=?",[uid(req),reason,row.id]);
    await logAudit(db,audit(req,'FINANCE_CASH_CUSTODY_CANCELLED',row.custody_uid,{status:row.status},{status:'CANCELLED',reason,ledger_balance_unchanged:true}));
    await db.commit();return res.json({message:'Mistaken Cash Custody issue cancelled without deleting evidence or changing the ledger.',status:'CANCELLED'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to cancel Cash Custody.');}finally{db.release()}
};
