'use strict';

const pool = require('../config/db');
const privacy = require('../services/financePrivacyService');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');
const { ensureFinanceSchema } = require('../services/financeSchema');

function userId(req){return Number(req.user?.id||req.user?.user_id||0)}
function audit(req,action,id,oldValue,newValue){
  return {actorId:userId(req),action,module:'finance_transaction_lifecycle',recordType:'bank_transaction',recordId:String(id),
    oldValue:oldValue||null,newValue:newValue||null,requestId:req.requestId||null,sessionId:req.session?.id||null,
    ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_TRANSACTION_LIFECYCLE_ERROR'});
}
async function visible(db,id,req,forUpdate=false){
  const [[row]]=await db.query(
    `SELECT bt.*,ba.nickname AS account_name,ba.institution,ba.ownership_scope AS account_scope
       FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.id=? AND ${privacy.visibilitySql('ba',req)}${forUpdate?' FOR UPDATE':''}`,
    [id,...privacy.visibilityParams(req)]
  );
  if(!row)throw new FinanceError('Transaction not found.',404,'BANK_TRANSACTION_NOT_FOUND');
  return row;
}

exports.listArchived=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const scope=String(req.query.scope||'ALL').trim().toUpperCase();
    if(!['ALL','PERSONAL','BUSINESS','MIXED','UNCLASSIFIED'].includes(scope))throw new FinanceError('Invalid archive scope.',400,'INVALID_ARCHIVE_SCOPE');
    const clauses=[privacy.visibilitySql('ba',req),'bt.archived_at IS NOT NULL'];
    const params=[...privacy.visibilityParams(req)];
    if(scope!=='ALL'){clauses.push('bt.ownership_scope=?');params.push(scope)}
    const [rows]=await pool.query(
      `SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.credit,bt.currency,bt.ownership_scope,
              bt.archived_at,bt.archived_by,bt.archive_reason,bt.pre_archive_reconciliation_status,
              ba.nickname AS account_name,ba.institution
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY bt.archived_at DESC,bt.id DESC LIMIT 500`,params);
    return res.json({archived_transactions:rows,count:rows.length});
  }catch(error){return fail(res,error,'Failed to load archived Finance transactions.')}
};

exports.archive=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0),reason=String(req.body.reason||'').trim().slice(0,500);
    if(reason.length<3)throw new FinanceError('Add a short archive reason.',400,'ARCHIVE_REASON_REQUIRED');
    await db.beginTransaction();const row=await visible(db,id,req,true);
    if(row.archived_at)throw new FinanceError('Transaction is already archived.',409,'TRANSACTION_ALREADY_ARCHIVED');
    await db.query(
      `UPDATE bank_transactions SET
         archived_at=NOW(),archived_by=?,archive_reason=?,
         pre_archive_reconciliation_status=reconciliation_status,
         pre_archive_ignored_reason=ignored_reason,
         reconciliation_status='IGNORED',
         ignored_reason=?
       WHERE id=?`,
      [userId(req),reason,`Archived: ${reason}`,id]
    );
    await logAudit(db,audit(req,'BANK_TRANSACTION_ARCHIVED',id,{
      reconciliation_status:row.reconciliation_status,ignored_reason:row.ignored_reason,archived_at:row.archived_at
    },{
      reconciliation_status:'IGNORED',archive_reason:reason,archived_by:userId(req)
    }));
    await db.commit();
    return res.json({message:'Transaction archived. It is excluded from active reports but its financial source evidence is preserved.'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to archive Finance transaction.')}finally{db.release()}
};

exports.restore=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();const id=Number(req.params.id||0);
    await db.beginTransaction();const row=await visible(db,id,req,true);
    if(!row.archived_at)throw new FinanceError('Transaction is not archived.',409,'TRANSACTION_NOT_ARCHIVED');
    const previousStatus=String(row.pre_archive_reconciliation_status||'UNRECONCILED').toUpperCase();
    const safeStatus=['UNRECONCILED','RECONCILED','IGNORED'].includes(previousStatus)?previousStatus:'UNRECONCILED';
    const previousIgnored=safeStatus==='IGNORED'?(row.pre_archive_ignored_reason||'Restored to prior ignored state'):null;
    await db.query(
      `UPDATE bank_transactions SET
         archived_at=NULL,archived_by=NULL,archive_reason=NULL,
         reconciliation_status=?,ignored_reason=?,
         pre_archive_reconciliation_status=NULL,pre_archive_ignored_reason=NULL
       WHERE id=?`,
      [safeStatus,previousIgnored,id]
    );
    await logAudit(db,audit(req,'BANK_TRANSACTION_RESTORED',id,{
      archived_at:row.archived_at,archive_reason:row.archive_reason,reconciliation_status:row.reconciliation_status
    },{
      archived_at:null,reconciliation_status:safeStatus,ignored_reason:previousIgnored
    }));
    await db.commit();
    return res.json({message:'Transaction restored. Original bank/source evidence was never deleted.',reconciliation_status:safeStatus});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to restore Finance transaction.')}finally{db.release()}
};
