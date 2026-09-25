'use strict';

const pool = require('../config/db');
const privacy = require('../services/financePrivacyService');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');
const { normalizeRow } = require('./statementImportController')._ingestion;

function audit(req, values) {
  return { actorId:req.user?.id, ipAddress:req.ip, userAgent:req.get('user-agent'), ...values };
}
function fail(res,error,message='Statement data-management action failed.') {
  if(error instanceof FinanceError) return res.status(error.statusCode||400).json({message:error.message,code:error.code,issues:error.issues});
  console.error(message,error);
  return res.status(500).json({message,code:'STATEMENT_DATA_MANAGEMENT_ERROR'});
}
function marker(uid,status,reason) {
  return 'STATEMENT_REMOVED::'+uid+'::'+String(status||'UNRECONCILED')+'::'+Buffer.from(String(reason||''),'utf8').toString('base64');
}
function parseMarker(value,uid) {
  const input=String(value||'');
  const prefix='STATEMENT_REMOVED::'+uid+'::';
  if(!input.startsWith(prefix)) return null;
  const rest=input.slice(prefix.length);
  const cut=rest.indexOf('::');
  const status=cut>=0?rest.slice(0,cut):'UNRECONCILED';
  const encoded=cut>=0?rest.slice(cut+2):'';
  let reason='';
  try { reason=Buffer.from(encoded,'base64').toString('utf8'); } catch {}
  return { status:status||'UNRECONCILED', reason:reason||null };
}
async function getStatement(db,req,uid,lock=false) {
  const [[file]]=await db.query(
    `SELECT sif.*,ba.nickname AS account_name,ba.institution,ba.currency,ba.ownership_scope,ba.status AS account_status
       FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
      WHERE sif.import_uid=? LIMIT 1${lock?' FOR UPDATE':''}`,
    [uid]
  );
  if(!file) throw new FinanceError('Statement not found.',404,'STATEMENT_NOT_FOUND');
  await privacy.assertAccountAccess(db,file.bank_account_id,req);
  return file;
}
async function recalcAccount(db,accountId) {
  const [[range]]=await db.query(
    `SELECT MIN(transaction_date) AS start_date,MAX(transaction_date) AS end_date
       FROM bank_transactions
      WHERE bank_account_id=? AND reconciliation_status<>'IGNORED'`,[accountId]
  );
  const [[latest]]=await db.query(
    `SELECT running_balance FROM bank_transactions
      WHERE bank_account_id=? AND reconciliation_status<>'IGNORED' AND running_balance IS NOT NULL
      ORDER BY transaction_date DESC,id DESC LIMIT 1`,[accountId]
  );
  const [[account]]=await db.query('SELECT opening_balance FROM bank_accounts WHERE id=? LIMIT 1',[accountId]);
  const balance=latest?.running_balance===null||latest?.running_balance===undefined
    ? Number(account?.opening_balance||0)
    : Number(latest.running_balance||0);
  await db.query(
    `UPDATE bank_accounts SET history_start_date=?,history_end_date=?,current_ledger_balance=?,reconciled_balance=? WHERE id=?`,
    [range?.start_date||null,range?.end_date||null,balance,balance,accountId]
  );
}
async function removeInTx(db,req,file) {
  if(String(file.parse_status).toUpperCase()==='REMOVED') return {removed:0,already_removed:true};
  if(String(file.parse_status).toUpperCase()!=='IMPORTED') throw new FinanceError('Only imported statements can be removed from history.',409,'STATEMENT_NOT_IMPORTED');
  const [rows]=await db.query(
    'SELECT id,reconciliation_status,ignored_reason FROM bank_transactions WHERE bank_account_id=? AND statement_import_uid=? FOR UPDATE',
    [file.bank_account_id,file.import_uid]
  );
  for(const row of rows) {
    await db.query(
      'UPDATE bank_transactions SET reconciliation_status="IGNORED",ignored_reason=? WHERE id=?',
      [marker(file.import_uid,row.reconciliation_status,row.ignored_reason),row.id]
    );
  }
  await db.query('UPDATE statement_import_files SET parse_status="REMOVED" WHERE import_uid=?',[file.import_uid]);
  await db.query('UPDATE statement_import_sessions SET status="REMOVED",updated_at=NOW() WHERE import_uid=? AND status="IMPORTED"',[file.import_uid]);
  await recalcAccount(db,file.bank_account_id);
  await logAudit(db,audit(req,{
    action:'STATEMENT_REMOVED',
    module:'finance_intelligence',
    recordType:'statement_import_file',
    recordId:file.import_uid,
    oldValue:{parse_status:file.parse_status,account_id:file.bank_account_id,transactions:rows.length},
    newValue:{parse_status:'REMOVED'},
    metadata:{reversible:true}
  }));
  return {removed:rows.length,already_removed:false};
}
async function restoreInTx(db,req,file) {
  if(String(file.parse_status).toUpperCase()!=='REMOVED') throw new FinanceError('Only removed statements can be restored.',409,'STATEMENT_NOT_REMOVED');
  const [rows]=await db.query(
    'SELECT id,ignored_reason FROM bank_transactions WHERE bank_account_id=? AND statement_import_uid=? AND reconciliation_status="IGNORED" FOR UPDATE',
    [file.bank_account_id,file.import_uid]
  );
  let restored=0;
  for(const row of rows) {
    const previous=parseMarker(row.ignored_reason,file.import_uid);
    if(!previous) continue;
    await db.query('UPDATE bank_transactions SET reconciliation_status=?,ignored_reason=? WHERE id=?',[previous.status,previous.reason,row.id]);
    restored+=1;
  }
  await db.query('UPDATE statement_import_files SET parse_status="IMPORTED" WHERE import_uid=?',[file.import_uid]);
  await db.query('UPDATE statement_import_sessions SET status="IMPORTED",updated_at=NOW() WHERE import_uid=? AND status="REMOVED"',[file.import_uid]);
  await recalcAccount(db,file.bank_account_id);
  await logAudit(db,audit(req,{
    action:'STATEMENT_RESTORED',
    module:'finance_intelligence',
    recordType:'statement_import_file',
    recordId:file.import_uid,
    oldValue:{parse_status:'REMOVED'},
    newValue:{parse_status:'IMPORTED',transactions_restored:restored}
  }));
  return {restored};
}

exports.listRemoved = async (req,res) => {
  try {
    await ensureFinanceSchema();
    const [rows]=await pool.query(
      `SELECT sif.import_uid,sif.original_name,sif.source_format,sif.statement_start_date,sif.statement_end_date,
              sif.imported_rows,sif.duplicate_rows,sif.rejected_rows,sif.reviewed_at,
              ba.id AS bank_account_id,ba.nickname AS account_name,ba.institution,ba.currency,ba.ownership_scope
         FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
        WHERE sif.parse_status='REMOVED' AND ${privacy.visibilitySql('ba', req)}
        ORDER BY sif.reviewed_at DESC,sif.id DESC LIMIT 250`,
      privacy.visibilityParams(req)
    );
    return res.json({removed_statements:rows});
  } catch(error){return fail(res,error,'Failed to load removed statements.');}
};

exports.remove = async (req,res) => {
  let db;
  try {
    await ensureFinanceSchema();
    db=await pool.getConnection(); await db.beginTransaction();
    const file=await getStatement(db,req,String(req.params.uid||''),true);
    const result=await removeInTx(db,req,file);
    await db.commit();
    return res.json({message:result.already_removed?'Statement is already removed.':'Statement removed from all reports and analysis. You can restore it from Removed Statements.',import_uid:file.import_uid,...result});
  } catch(error){if(db)await db.rollback();return fail(res,error,'Failed to remove statement.');}
  finally{if(db)db.release();}
};

exports.restore = async (req,res) => {
  let db;
  try {
    await ensureFinanceSchema();
    db=await pool.getConnection(); await db.beginTransaction();
    const file=await getStatement(db,req,String(req.params.uid||''),true);
    const result=await restoreInTx(db,req,file);
    await db.commit();
    return res.json({message:'Statement and its transaction history restored.',import_uid:file.import_uid,...result});
  } catch(error){if(db)await db.rollback();return fail(res,error,'Failed to restore statement.');}
  finally{if(db)db.release();}
};

exports.clearAccountStatements = async (req,res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const accountId=Number(req.params.id||0);
    if(!accountId) throw new FinanceError('Bank account not found.',404,'BANK_ACCOUNT_NOT_FOUND');
    db=await pool.getConnection(); await db.beginTransaction();
    await privacy.assertAccountAccess(db,accountId,req);
    const [files]=await db.query(
      'SELECT * FROM statement_import_files WHERE bank_account_id=? AND parse_status="IMPORTED" ORDER BY id FOR UPDATE',
      [accountId]
    );
    let statements=0,transactions=0;
    for(const file of files){
      const result=await removeInTx(db,req,file);
      if(!result.already_removed){statements+=1;transactions+=Number(result.removed||0);}
    }
    await logAudit(db,audit(req,{
      action:'ACCOUNT_STATEMENT_HISTORY_CLEARED',
      module:'finance_intelligence',
      recordType:'bank_account',
      recordId:accountId,
      newValue:{statements_removed:statements,transactions_removed:transactions,reversible:true}
    }));
    await db.commit();
    return res.json({message:`${statements} statement(s) removed from this account's analysis. They can be restored individually.`,statements_removed:statements,transactions_removed:transactions});
  } catch(error){if(db)await db.rollback();return fail(res,error,'Failed to clear account statement history.');}
  finally{if(db)db.release();}
};


exports.correctPostedTransaction = async (req,res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const uid=String(req.params.uid||'').trim();
    const transactionId=Number(req.params.transactionId||0);
    const reason=String(req.body?.reason||'').trim();
    if(!uid||!transactionId) throw new FinanceError('Statement transaction not found.',404,'STATEMENT_TRANSACTION_NOT_FOUND');
    if(reason.length<3) throw new FinanceError('Add a short reason for this post-import correction.',400,'CORRECTION_REASON_REQUIRED');

    db=await pool.getConnection(); await db.beginTransaction();
    const file=await getStatement(db,req,uid,true);
    if(String(file.parse_status||'').toUpperCase()!=='IMPORTED') {
      throw new FinanceError('Only active imported statements can be edited from Statement Vault.',409,'STATEMENT_NOT_ACTIVE');
    }
    const [[session]]=await db.query('SELECT * FROM statement_import_sessions WHERE import_uid=? FOR UPDATE',[uid]);
    if(!session||String(session.status||'').toUpperCase()!=='IMPORTED') {
      throw new FinanceError('This statement has not completed review and posting.',409,'STATEMENT_NOT_POSTED');
    }
    const [[tx]]=await db.query(
      'SELECT * FROM bank_transactions WHERE id=? AND bank_account_id=? AND statement_import_uid=? FOR UPDATE',
      [transactionId,file.bank_account_id,uid]
    );
    if(!tx) throw new FinanceError('Posted transaction was not found in this statement.',404,'STATEMENT_TRANSACTION_NOT_FOUND');
    if(String(tx.reconciliation_status||'').toUpperCase()==='RECONCILED') {
      throw new FinanceError('Reconciled transactions cannot be changed here. Undo or reopen the reconciliation first.',409,'RECONCILED_TRANSACTION_LOCKED');
    }

    const [[sourceRow]]=await db.query(
      'SELECT * FROM statement_import_rows WHERE import_session_id=? AND final_posted_transaction_id=? LIMIT 1 FOR UPDATE',
      [session.id,transactionId]
    );

    const direction=String(req.body?.direction||'').trim().toUpperCase();
    const amount=req.body?.amount;
    let debit=tx.debit,credit=tx.credit;
    if(amount!==undefined&&amount!==null&&String(amount).trim()!==''){
      if(direction==='DEBIT'){debit=amount;credit='0.00';}
      else if(direction==='CREDIT'){credit=amount;debit='0.00';}
      else throw new FinanceError('Choose Money out or Money in for the corrected amount.',400,'CORRECTION_DIRECTION_REQUIRED');
    }

    const candidate=normalizeRow(file.bank_account_id,file.currency,{
      transaction_date:req.body?.transaction_date ?? tx.transaction_date,
      posting_date:req.body?.posting_date ?? tx.posting_date,
      description:req.body?.description ?? tx.description,
      reference:req.body?.reference ?? tx.reference,
      debit,credit,
      running_balance:req.body?.running_balance ?? tx.running_balance,
      merchant_name:req.body?.merchant_name ?? tx.merchant_name,
      currency:tx.currency||file.currency
    },sourceRow?.row_no||tx.statement_row_id||transactionId);

    if(candidate.validation_status==='REJECTED'||!candidate.row_hash){
      throw new FinanceError(candidate.validation_message||'Correct the date and choose exactly one money-out or money-in amount.',422,'POSTED_CORRECTION_INVALID');
    }
    const [[duplicate]]=await db.query(
      'SELECT id FROM bank_transactions WHERE bank_account_id=? AND row_hash=? AND id<>? LIMIT 1',
      [file.bank_account_id,candidate.row_hash,transactionId]
    );
    if(duplicate) throw new FinanceError('This correction would duplicate another transaction, so it was not saved.',409,'POSTED_CORRECTION_DUPLICATE');

    const oldValue={
      transaction_date:tx.transaction_date,posting_date:tx.posting_date,description:tx.description,reference:tx.reference,
      debit:tx.debit,credit:tx.credit,running_balance:tx.running_balance,merchant_name:tx.merchant_name,row_hash:tx.row_hash
    };
    await db.query(
      `UPDATE bank_transactions
          SET transaction_date=?,posting_date=?,description=?,reference=?,debit=?,credit=?,running_balance=?,
              merchant_name=?,row_hash=?,manual_override=1,review_source_status='CORRECTED'
        WHERE id=?`,
      [candidate.transaction_date,candidate.posting_date,candidate.description,candidate.reference,candidate.debit,candidate.credit,
       candidate.running_balance,candidate.merchant_name,candidate.row_hash,transactionId]
    );

    if(sourceRow){
      const original=sourceRow.override_original_json||JSON.stringify({
        transaction_date:sourceRow.transaction_date,posting_date:sourceRow.posting_date,description:sourceRow.description,
        reference:sourceRow.reference,debit:sourceRow.debit,credit:sourceRow.credit,running_balance:sourceRow.running_balance,
        merchant_name:sourceRow.merchant_name,currency:sourceRow.currency,validation_status:sourceRow.validation_status
      });
      const message=('Post-import correction: '+reason).slice(0,500);
      await db.query(
        `UPDATE statement_import_rows
            SET transaction_date=?,posting_date=?,description=?,reference=?,debit=?,credit=?,running_balance=?,merchant_name=?,
                row_hash=?,validation_status='WARNING',validation_message=?,manual_override=1,override_reason=?,
                override_original_json=?,corrected_values_json=?,review_status='POSTED',overridden_by=?,overridden_at=NOW(),
                override_version=override_version+1
          WHERE id=? AND import_session_id=?`,
        [candidate.transaction_date,candidate.posting_date,candidate.description,candidate.reference,candidate.debit,candidate.credit,
         candidate.running_balance,candidate.merchant_name,candidate.row_hash,message,reason.slice(0,500),
         typeof original==='string'?original:JSON.stringify(original),JSON.stringify(candidate),req.user.id,sourceRow.id,session.id]
      );
    }

    await recalcAccount(db,file.bank_account_id);
    await logAudit(db,audit(req,{
      action:'STATEMENT_POSTED_TRANSACTION_CORRECTED',
      module:'finance_intelligence',
      recordType:'bank_transaction',
      recordId:transactionId,
      oldValue,
      newValue:{
        transaction_date:candidate.transaction_date,posting_date:candidate.posting_date,description:candidate.description,
        reference:candidate.reference,debit:candidate.debit,credit:candidate.credit,running_balance:candidate.running_balance,
        merchant_name:candidate.merchant_name,row_hash:candidate.row_hash,reason,source_statement_uid:uid
      },
      metadata:{original_bank_evidence_preserved:true,post_import_correction:true}
    }));
    await db.commit();
    return res.json({
      message:'Statement transaction corrected. Original bank evidence is preserved in the audit/source record.',
      transaction_id:transactionId,
      import_uid:uid,
      corrected:true
    });
  } catch(error){
    if(db) await db.rollback();
    return fail(res,error,'Failed to correct posted statement transaction.');
  } finally { if(db) db.release(); }
};

exports.purge = async (req,res) => {
  let db;
  try {
    await ensureFinanceSchema();
    const uid=String(req.params.uid||'');
    if(String(req.body?.confirmation||'')!==`PURGE ${uid}`) {
      throw new FinanceError(`Type PURGE ${uid} to permanently delete this removed statement.`,400,'PURGE_CONFIRMATION_REQUIRED');
    }
    db=await pool.getConnection(); await db.beginTransaction();
    const file=await getStatement(db,req,uid,true);
    if(String(file.parse_status).toUpperCase()!=='REMOVED') throw new FinanceError('Remove the statement first before permanent purge.',409,'PURGE_REQUIRES_REMOVED');
    const [tx]=await db.query('SELECT id,import_batch_uid FROM bank_transactions WHERE bank_account_id=? AND statement_import_uid=? FOR UPDATE',[file.bank_account_id,uid]);
    const ids=tx.map(r=>Number(r.id)).filter(Boolean);
    if(ids.length){
      const placeholders=ids.map(()=>'?').join(',');
      await db.query(`DELETE FROM reconciliation_matches WHERE bank_transaction_id IN (${placeholders})`,ids);
      await db.query(`DELETE FROM bank_transactions WHERE id IN (${placeholders})`,ids);
    }
    const [[session]]=await db.query('SELECT id FROM statement_import_sessions WHERE import_uid=? LIMIT 1',[uid]);
    if(session?.id) await db.query('DELETE FROM statement_import_rows WHERE import_session_id=?',[session.id]);
    await db.query('DELETE FROM statement_import_sessions WHERE import_uid=?',[uid]);
    await db.query('DELETE FROM statement_import_files WHERE import_uid=?',[uid]);
    const batches=[...new Set(tx.map(r=>r.import_batch_uid).filter(Boolean))];
    for(const batch of batches){
      const [[left]]=await db.query('SELECT COUNT(*) AS total FROM bank_transactions WHERE import_batch_uid=?',[batch]);
      if(Number(left?.total||0)===0) await db.query('DELETE FROM bank_import_batches WHERE batch_uid=?',[batch]);
    }
    await recalcAccount(db,file.bank_account_id);
    await logAudit(db,audit(req,{
      action:'STATEMENT_PURGED',
      module:'finance_intelligence',
      recordType:'statement_import_file',
      recordId:uid,
      oldValue:{original_name:file.original_name,account_id:file.bank_account_id,transactions:ids.length},
      newValue:null,
      metadata:{permanent:true,confirmation_verified:true}
    }));
    await db.commit();
    return res.json({message:'Statement and its imported transaction records permanently deleted.',purged:true,transactions_deleted:ids.length});
  } catch(error){if(db)await db.rollback();return fail(res,error,'Failed to permanently purge statement.');}
  finally{if(db)db.release();}
};

exports._test={marker,parseMarker};
