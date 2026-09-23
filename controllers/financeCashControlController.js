'use strict';

const crypto=require('node:crypto');
const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { ensureFinanceSchema }=require('../services/financeSchema');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');

function uid(req){return privacy.userId(req)}
function clean(value,max=500){const text=String(value??'').trim();return text?text.slice(0,max):null}
function money(value,label='Amount'){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new FinanceError(`${label} must be a valid non-negative amount.`,400,'INVALID_CASH_AMOUNT');
  return Math.round(n*10000)/10000;
}
function dateTime(value){
  const text=String(value||'').trim();
  if(!text)return new Date();
  const d=new Date(text);
  if(Number.isNaN(d.getTime()))throw new FinanceError('Count date is invalid.',400,'INVALID_CASH_DATE');
  return d;
}
function isCashAccount(account){
  return /cash|petty|till|drawer/i.test(String(account?.account_type||'')+' '+String(account?.nickname||'')+' '+String(account?.financial_purpose||''));
}
function audit(req,action,recordType,recordId,oldValue,newValue){
  return {actorId:uid(req),action,module:'finance',recordType,recordId:String(recordId),oldValue,newValue,
    requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_CASH_CONTROL_FAILED'});
}
async function wallet(db,walletId,userId,{forUpdate=false}={}){
  const suffix=forUpdate?' FOR UPDATE':'';
  const [[row]]=await db.query(`SELECT id,user_id,name,currency,balance,active FROM personal_money_wallets WHERE id=? AND user_id=?${suffix}`,[String(walletId||''),String(userId)]);
  if(!row)throw new FinanceError('Personal cash wallet not found.',404,'PERSONAL_CASH_WALLET_NOT_FOUND');
  if(!Number(row.active))throw new FinanceError('Restore this personal wallet before using Cash Control.',409,'PERSONAL_CASH_WALLET_ARCHIVED');
  return row;
}
async function assertCountVisible(db,row,req,{forUpdate=false}={}){
  if(!row)throw new FinanceError('Cash count record not found.',404,'CASH_COUNT_NOT_FOUND');
  if(row.source_type==='BANK_ACCOUNT'){
    await privacy.assertAccountAccess(db,row.bank_account_id,req,{forUpdate});
  }else{
    await wallet(db,row.personal_wallet_id,uid(req),{forUpdate});
  }
  return row;
}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const owner=uid(req),visibility=privacy.visibilitySql('ba',req),visibilityParams=privacy.visibilityParams(req);
    const [allAccounts,wallets,counts,transfers,candidates]=await Promise.all([
      pool.query(`SELECT ba.id,ba.nickname,ba.institution,ba.currency,ba.ownership_scope,ba.account_type,ba.financial_purpose,
          ba.available_balance,ba.current_ledger_balance,ba.status
        FROM bank_accounts ba WHERE ba.status='ACTIVE' AND ${visibility}
        ORDER BY ba.ownership_scope,ba.currency,ba.nickname`,visibilityParams).then(([rows])=>rows.filter(isCashAccount)),
      pool.query(`SELECT id,name,currency,balance,active,updated_at FROM personal_money_wallets
        WHERE user_id=? AND active=1 ORDER BY currency,name`,[String(owner)]).then(([rows])=>rows),
      pool.query(`SELECT cc.*,ba.nickname AS account_name,ba.institution,w.name AS wallet_name
        FROM finance_cash_counts cc
        LEFT JOIN bank_accounts ba ON cc.source_type='BANK_ACCOUNT' AND ba.id=cc.bank_account_id
        LEFT JOIN personal_money_wallets w ON cc.source_type='PERSONAL_WALLET' AND w.id=cc.personal_wallet_id
        WHERE (cc.source_type='BANK_ACCOUNT' AND ${visibility})
           OR (cc.source_type='PERSONAL_WALLET' AND w.user_id=?)
        ORDER BY cc.counted_at DESC,cc.id DESC LIMIT 200`,[...visibilityParams,String(owner)]).then(([rows])=>rows),
      pool.query(`SELECT l.transfer_uid,l.bank_transaction_id,l.personal_wallet_id,l.direction,l.amount,l.currency,l.status,
          l.created_at,l.reversed_at,l.note,bt.transaction_date,bt.description,bt.merchant_name,
          ba.nickname AS account_name,w.name AS wallet_name
        FROM finance_cash_transfer_links l
        JOIN bank_transactions bt ON bt.id=l.bank_transaction_id
        JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        JOIN personal_money_wallets w ON w.id=l.personal_wallet_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND w.user_id=?
        ORDER BY l.created_at DESC,l.id DESC LIMIT 150`,[owner,String(owner)]).then(([rows])=>rows),
      pool.query(`SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.credit,bt.currency,
          ba.nickname AS account_name,ba.institution,
          CASE WHEN bt.debit>0 THEN 'BANK_TO_CASH' ELSE 'CASH_TO_BANK' END AS suggested_direction,
          CASE WHEN LOWER(CONCAT_WS(' ',bt.description,bt.merchant_name)) REGEXP 'atm|cash|withdraw|deposit' THEN 1 ELSE 0 END AS cash_likelihood
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
          AND bt.reconciliation_status<>'IGNORED' AND bt.is_internal_transfer=0
          AND ((bt.debit>0 AND bt.credit=0) OR (bt.credit>0 AND bt.debit=0))
          AND bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 120 DAY)
          AND NOT EXISTS (SELECT 1 FROM finance_cash_transfer_links l WHERE l.bank_transaction_id=bt.id AND l.status='ACTIVE')
        ORDER BY cash_likelihood DESC,bt.transaction_date DESC,bt.id DESC LIMIT 150`,[owner]).then(([rows])=>rows)
    ]);
    const byCurrency={};
    for(const row of counts){
      const c=String(row.currency||'AUD').toUpperCase();
      byCurrency[c] ||= {count_records:0,review_required:0,balanced:0,variance_total:0};
      byCurrency[c].count_records++;
      if(row.status==='REVIEW_REQUIRED')byCurrency[c].review_required++;
      if(row.status==='BALANCED'||row.status==='REVIEWED')byCurrency[c].balanced++;
      byCurrency[c].variance_total=Math.round((byCurrency[c].variance_total+Number(row.variance_amount||0))*10000)/10000;
    }
    return res.json({
      rule:'Physical cash counts compare the current recorded balance with an observed count. A variance never silently changes the ledger.',
      transfer_rule:'Personal bank withdrawal/deposit links are explicit internal transfers. The original bank transaction remains preserved; reversal creates counter-evidence instead of deleting history.',
      cash_accounts:allAccounts.map(a=>({...a,expected_balance:Number(a.available_balance==null?a.current_ledger_balance:a.available_balance||0)})),
      personal_wallets:wallets.map(w=>({...w,balance:Number(w.balance||0)})),
      counts:counts.map(r=>({...r,expected_amount:Number(r.expected_amount||0),actual_amount:Number(r.actual_amount||0),variance_amount:Number(r.variance_amount||0)})),
      transfers:transfers.map(r=>({...r,amount:Number(r.amount||0)})),
      transfer_candidates:candidates.map(r=>({...r,debit:Number(r.debit||0),credit:Number(r.credit||0)})),
      count_summary_by_currency:byCurrency
    });
  }catch(error){return fail(res,error,'Failed to load Cash Control.')}
};

exports.recordCount=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const owner=uid(req),source=String(req.body.source_type||'').trim().toUpperCase(),sourceId=String(req.body.source_id||'').trim();
    if(!['BANK_ACCOUNT','PERSONAL_WALLET'].includes(source))throw new FinanceError('Choose a bank/cash account or personal wallet.',400,'INVALID_CASH_SOURCE');
    let expected=0,currency='AUD',scope='PERSONAL',bankAccountId=null,walletId=null,sourceName='';
    if(source==='BANK_ACCOUNT'){
      const account=await privacy.assertAccountAccess(db,Number(sourceId),req,{forUpdate:true});
      if(!isCashAccount(account))throw new FinanceError('Physical counts are limited to accounts identified as Cash, Petty Cash, Till or Cash Drawer.',400,'CASH_ACCOUNT_REQUIRED');
      expected=Number(account.available_balance==null?account.current_ledger_balance:account.available_balance||0);
      currency=String(account.currency||'AUD').toUpperCase();scope=String(account.ownership_scope||'UNCLASSIFIED').toUpperCase();bankAccountId=Number(account.id);sourceName=account.nickname||'Cash account';
    }else{
      const row=await wallet(db,sourceId,owner,{forUpdate:true});expected=Number(row.balance||0);currency=String(row.currency||'AUD').toUpperCase();walletId=row.id;sourceName=row.name||'Cash wallet';
    }
    const actual=money(req.body.actual_amount,'Actual cash count'),variance=Math.round((actual-expected)*10000)/10000;
    const status=Math.abs(variance)<=0.005?'BALANCED':'REVIEW_REQUIRED',countUid=crypto.randomUUID();
    await db.query(`INSERT INTO finance_cash_counts
      (count_uid,source_type,bank_account_id,personal_wallet_id,ownership_scope,currency,expected_amount,actual_amount,variance_amount,
       status,custodian,counted_at,note,recorded_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [countUid,source,bankAccountId,walletId,scope,currency,expected,actual,variance,status,clean(req.body.custodian,160),dateTime(req.body.counted_at),clean(req.body.note,700),owner]);
    await logAudit(db,audit(req,'FINANCE_CASH_COUNT_RECORDED','finance_cash_count',countUid,null,
      {source_type:source,source_id:sourceId,source_name:sourceName,currency,expected_amount:expected,actual_amount:actual,variance_amount:variance,status}));
    await db.commit();
    return res.status(201).json({message:status==='BALANCED'?'Cash count balanced with the recorded balance.':'Cash variance recorded for review. No ledger balance was changed.',count_uid:countUid,status,expected_amount:expected,actual_amount:actual,variance_amount:variance,currency});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to record cash count.');}finally{db.release()}
};

exports.reviewCount=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const [[row]]=await db.query('SELECT * FROM finance_cash_counts WHERE count_uid=? LIMIT 1 FOR UPDATE',[String(req.params.uid||'')]);
    await assertCountVisible(db,row,req,{forUpdate:true});
    if(row.status==='REVIEWED')throw new FinanceError('This cash count is already reviewed.',409,'CASH_COUNT_ALREADY_REVIEWED');
    const note=clean(req.body.review_note,700);
    if(Math.abs(Number(row.variance_amount||0))>0.005&&!note)throw new FinanceError('Enter a review note explaining how this variance was checked.',400,'CASH_VARIANCE_REVIEW_NOTE_REQUIRED');
    await db.query(`UPDATE finance_cash_counts SET status='REVIEWED',review_note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?`,[note,uid(req),row.id]);
    await logAudit(db,audit(req,'FINANCE_CASH_COUNT_REVIEWED','finance_cash_count',row.count_uid,{status:row.status},{status:'REVIEWED',review_note:note,variance_amount:Number(row.variance_amount||0)}));
    await db.commit();return res.json({message:'Cash count reviewed. The recorded financial balance was not changed.',status:'REVIEWED'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to review cash count.');}finally{db.release()}
};

exports.createTransfer=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const owner=uid(req),tx=await privacy.assertBankTransactionAccess(db,req.body.bank_transaction_id,req,{forUpdate:true});
    if(String(tx.account_scope||tx.ownership_scope||'').toUpperCase()!=='PERSONAL'||Number(tx.account_created_by||0)!==owner)
      throw new FinanceError('Cash-wallet transfer linking is owner-only and requires a PERSONAL bank transaction.',403,'PERSONAL_CASH_TRANSFER_REQUIRED');
    const w=await wallet(db,req.body.wallet_id,owner,{forUpdate:true});
    const currency=String(tx.currency||'AUD').toUpperCase();
    if(String(w.currency||'').toUpperCase()!==currency)throw new FinanceError('Bank transaction and cash wallet must use the same currency. No FX rate is invented for cash transfers.',400,'CASH_TRANSFER_CURRENCY_MISMATCH');
    const direction=String(req.body.direction||'').trim().toUpperCase();
    if(!['BANK_TO_CASH','CASH_TO_BANK'].includes(direction))throw new FinanceError('Choose Bank to Cash or Cash to Bank.',400,'INVALID_CASH_TRANSFER_DIRECTION');
    const sourceAmount=direction==='BANK_TO_CASH'?Number(tx.debit||0):Number(tx.credit||0);
    if(sourceAmount<=0)throw new FinanceError(direction==='BANK_TO_CASH'?'Selected bank transaction is not a withdrawal/debit.':'Selected bank transaction is not a deposit/credit.',400,'CASH_TRANSFER_DIRECTION_MISMATCH');
    const amount=money(req.body.amount,'Transfer amount');
    if(amount<=0||Math.abs(amount-sourceAmount)>0.005)throw new FinanceError('Cash transfer amount must match the full selected bank transaction amount so only a true whole transfer is excluded from income/expense.',400,'CASH_TRANSFER_FULL_AMOUNT_REQUIRED');
    const [[active]]=await db.query("SELECT COUNT(*) count FROM finance_cash_transfer_links WHERE bank_transaction_id=? AND status='ACTIVE'",[tx.id]);
    if(Number(active.count||0)>0)throw new FinanceError('This bank transaction is already linked to an active cash transfer.',409,'CASH_TRANSFER_ALREADY_LINKED');
    const transferUid=crypto.randomUUID(),entryId=crypto.randomUUID(),entryType=direction==='BANK_TO_CASH'?'CASH_IN':'CASH_OUT',delta=direction==='BANK_TO_CASH'?amount:-amount;
    const occurredAt=String(tx.transaction_date||'').slice(0,10)+' 12:00:00';
    await db.query(`INSERT INTO personal_money_entries
      (id,user_id,wallet_id,entry_type,amount,currency,fx_rate_to_wallet,wallet_amount,category,counterparty,note,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [entryId,String(owner),w.id,entryType,amount,currency,1,amount,'Cash transfer','Bank account',clean(req.body.note,500)||`Linked to bank transaction #${tx.id}`,occurredAt]);
    await db.query('UPDATE personal_money_wallets SET balance=balance+? WHERE id=? AND user_id=?',[delta,w.id,String(owner)]);
    await db.query(`INSERT INTO finance_cash_transfer_links
      (transfer_uid,bank_transaction_id,personal_wallet_id,personal_money_entry_id,direction,amount,currency,previous_internal_transfer,status,note,linked_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [transferUid,tx.id,w.id,entryId,direction,amount,currency,Number(tx.is_internal_transfer||0),'ACTIVE',clean(req.body.note,500),owner]);
    await db.query('UPDATE bank_transactions SET is_internal_transfer=1 WHERE id=?',[tx.id]);
    await logAudit(db,audit(req,'FINANCE_CASH_TRANSFER_LINKED','finance_cash_transfer',transferUid,
      {bank_transaction_id:tx.id,is_internal_transfer:Number(tx.is_internal_transfer||0)},
      {bank_transaction_id:tx.id,wallet_id:w.id,direction,amount,currency,is_internal_transfer:1,wallet_delta:delta}));
    await db.commit();
    return res.status(201).json({message:'Bank↔cash movement linked as an internal transfer. It is excluded from ordinary income/expense and the original bank source remains preserved.',transfer_uid:transferUid,wallet_delta:delta,currency});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to link cash transfer.');}finally{db.release()}
};

exports.reverseTransfer=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const owner=uid(req);
    const [[row]]=await db.query(`SELECT l.*,bt.transaction_date,bt.is_internal_transfer,ba.ownership_scope AS account_scope,ba.created_by AS account_created_by,
        w.user_id,w.active AS wallet_active,w.name AS wallet_name
      FROM finance_cash_transfer_links l
      JOIN bank_transactions bt ON bt.id=l.bank_transaction_id
      JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      JOIN personal_money_wallets w ON w.id=l.personal_wallet_id
      WHERE l.transfer_uid=? LIMIT 1 FOR UPDATE`,[String(req.params.uid||'')]);
    if(!row||Number(row.account_created_by||0)!==owner||String(row.account_scope||'').toUpperCase()!=='PERSONAL'||String(row.user_id)!==String(owner))
      throw new FinanceError('Cash transfer link not found.',404,'CASH_TRANSFER_NOT_FOUND');
    if(row.status!=='ACTIVE')throw new FinanceError('This cash transfer has already been reversed.',409,'CASH_TRANSFER_ALREADY_REVERSED');
    if(!Number(row.wallet_active))throw new FinanceError('Restore the cash wallet before reversing this transfer.',409,'PERSONAL_CASH_WALLET_ARCHIVED');
    const amount=Number(row.amount||0),reverseDelta=row.direction==='BANK_TO_CASH'?-amount:amount,reversalEntryId=crypto.randomUUID();
    await db.query('UPDATE personal_money_wallets SET balance=balance+? WHERE id=? AND user_id=?',[reverseDelta,row.personal_wallet_id,String(owner)]);
    await db.query(`INSERT INTO personal_money_entries
      (id,user_id,wallet_id,entry_type,amount,currency,fx_rate_to_wallet,wallet_amount,category,counterparty,note,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [reversalEntryId,String(owner),row.personal_wallet_id,row.direction==='BANK_TO_CASH'?'CASH_OUT':'CASH_IN',amount,row.currency,1,amount,'Cash transfer reversal','Bank account',clean(req.body.reason,500)||`Reversal of cash transfer ${row.transfer_uid}`]);
    await db.query('UPDATE bank_transactions SET is_internal_transfer=? WHERE id=?',[Number(row.previous_internal_transfer||0),row.bank_transaction_id]);
    await db.query(`UPDATE finance_cash_transfer_links SET status='REVERSED',reversal_entry_id=?,reversed_by=?,reversed_at=NOW(),reversal_reason=? WHERE id=?`,
      [reversalEntryId,owner,clean(req.body.reason,500),row.id]);
    await logAudit(db,audit(req,'FINANCE_CASH_TRANSFER_REVERSED','finance_cash_transfer',row.transfer_uid,
      {status:'ACTIVE',is_internal_transfer:Number(row.is_internal_transfer||0)},
      {status:'REVERSED',wallet_delta:reverseDelta,is_internal_transfer:Number(row.previous_internal_transfer||0),reversal_entry_id:reversalEntryId}));
    await db.commit();return res.json({message:'Cash transfer link reversed with counter-evidence. Original history was retained.',wallet_delta:reverseDelta});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to reverse cash transfer.');}finally{db.release()}
};
