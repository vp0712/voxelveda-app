'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const privacy = require('../services/financePrivacyService');
const money = require('../utils/money');
const trustedTotals = require('../services/financeTrustedTotals');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');
const { ensureFinanceSchema } = require('../services/financeSchema');

const VALID_SCOPES = new Set(['ALL','PERSONAL','BUSINESS','MIXED','UNCLASSIFIED']);
const VALID_TYPES = new Set(['TRANSACTION_REGISTER','INCOME','EXPENSE','CASH_FLOW','CATEGORY','MERCHANT','TRANSFER','REFUND','REIMBURSEMENT','DATA_QUALITY']);
const VALID_RECON = new Set(['UNRECONCILED','RECONCILED','IGNORED']);
const VALID_RECEIPT = new Set(['ATTACHED','MISSING']);
const VALID_SOURCE = new Set(['STATEMENT_IMPORT','MANUAL','OPEN_BANKING','API_IMPORT']);
const REPORT_DEF_KEYS = new Set(['scope','account_ids','from','to','currency','transaction_type','category','merchant','source','reconciliation_status','receipt_status','q']);

function uid() { return `RPT_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`; }
function userId(req) { return Number(req.user?.id || req.user?.user_id || 0); }
function parseDate(value,label) {
  const v=String(value||'').trim();
  if(!v) return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FinanceError(`${label} must use YYYY-MM-DD.`,400,'INVALID_REPORT_DATE');
  return v;
}
function parseIds(value) {
  const values = Array.isArray(value) ? value : String(value||'').split(',');
  return [...new Set(values.map(Number).filter(Number.isInteger).filter(v=>v>0))].slice(0,50);
}
function safeText(value,max=120){return String(value||'').trim().slice(0,max)}
function csvCell(value) {
  const raw=String(value??'');
  const safe=/^[=+@]/.test(raw) || /^-\D/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g,'""')}"`;
}
function definitionFrom(input={}) {
  const out={};
  for(const key of REPORT_DEF_KEYS) if(input[key]!==undefined && input[key]!==null && input[key]!=='') out[key]=input[key];
  if(out.account_ids) out.account_ids=parseIds(out.account_ids);
  return out;
}
function audit(req,action,recordType,recordId,newValue){
  return {actorId:userId(req),action,module:'finance_reports',recordType,recordId:String(recordId),newValue:newValue||null,
    requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function fail(res,error,message){
  if(error instanceof FinanceError) return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_REPORT_BUILDER_ERROR'});
}

function buildFilters(req,definition=null){
  const src=definition||req.query||{};
  const scope=safeText(src.scope||'ALL',20).toUpperCase();
  if(!VALID_SCOPES.has(scope)) throw new FinanceError('Invalid report workspace.',400,'INVALID_REPORT_SCOPE');
  const from=parseDate(src.from,'From date'),to=parseDate(src.to,'To date');
  if(from&&to&&from>to) throw new FinanceError('From date cannot be after To date.',400,'INVALID_REPORT_RANGE');
  const accountIds=parseIds(src.account_ids);
  const currency=safeText(src.currency,3).toUpperCase();
  if(currency && !/^[A-Z]{3}$/.test(currency)) throw new FinanceError('Currency must be a 3-letter code.',400,'INVALID_REPORT_CURRENCY');
  const transactionType=safeText(src.transaction_type,30).toUpperCase();
  const category=safeText(src.category,120),merchant=safeText(src.merchant,120);
  const source=safeText(src.source,40).toUpperCase(),recon=safeText(src.reconciliation_status,40).toUpperCase();
  const receipt=safeText(src.receipt_status,20).toUpperCase(),q=safeText(src.q,120);
  if(source && !VALID_SOURCE.has(source)) throw new FinanceError('Invalid transaction source filter.',400,'INVALID_REPORT_SOURCE');
  if(recon && !VALID_RECON.has(recon)) throw new FinanceError('Invalid reconciliation filter.',400,'INVALID_REPORT_RECONCILIATION');
  if(receipt && !VALID_RECEIPT.has(receipt)) throw new FinanceError('Invalid receipt filter.',400,'INVALID_REPORT_RECEIPT');
  if(transactionType && !['INCOME','EXPENSE','TRANSFER','REFUND','ALL'].includes(transactionType)) throw new FinanceError('Invalid transaction type filter.',400,'INVALID_REPORT_TRANSACTION_TYPE');

  const clauses=[privacy.visibilitySql('ba',req)];
  const params=[...privacy.visibilityParams(req)];
  if(recon!=='IGNORED') clauses.push("bt.reconciliation_status<>'IGNORED'");
  if(scope!=='ALL'){clauses.push('bt.ownership_scope=?');params.push(scope)}
  if(accountIds.length){clauses.push(`bt.bank_account_id IN (${accountIds.map(()=>'?').join(',')})`);params.push(...accountIds)}
  if(from){clauses.push('bt.transaction_date>=?');params.push(from)}
  if(to){clauses.push('bt.transaction_date<=?');params.push(to)}
  if(currency){clauses.push('bt.currency=?');params.push(currency)}
  if(category){
    clauses.push("(bt.category=? OR EXISTS (SELECT 1 FROM bank_transaction_splits sx WHERE sx.parent_bank_transaction_id=bt.id AND sx.category=?))");
    params.push(category,category);
  }
  if(merchant){clauses.push('(bt.merchant_name LIKE ? OR bt.description LIKE ?)');params.push(`%${merchant}%`,`%${merchant}%`)}
  if(source){clauses.push('bt.source_type=?');params.push(source)}
  if(recon){clauses.push('bt.reconciliation_status=?');params.push(recon)}
  if(receipt==='ATTACHED') clauses.push("EXISTS (SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.record_id=CAST(bt.id AS CHAR) AND sd.deleted_at IS NULL)");
  if(receipt==='MISSING') clauses.push("NOT EXISTS (SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.record_id=CAST(bt.id AS CHAR) AND sd.deleted_at IS NULL)");
  if(transactionType==='TRANSFER') clauses.push('bt.is_internal_transfer=1');
  if(transactionType==='EXPENSE') clauses.push('bt.debit>0 AND bt.is_internal_transfer=0');
  if(transactionType==='INCOME') clauses.push("bt.credit>0 AND bt.is_internal_transfer=0 AND NOT EXISTS (SELECT 1 FROM finance_refund_links fr WHERE fr.refund_bank_transaction_id=bt.id AND fr.status='ACTIVE')");
  if(transactionType==='REFUND') clauses.push("bt.credit>0 AND EXISTS (SELECT 1 FROM finance_refund_links fr WHERE fr.refund_bank_transaction_id=bt.id AND fr.status='ACTIVE')");
  if(q){clauses.push('(bt.description LIKE ? OR bt.merchant_name LIKE ? OR bt.reference LIKE ? OR ba.nickname LIKE ? OR ba.institution LIKE ?)');const like=`%${q}%`;params.push(like,like,like,like,like)}
  return {scope,from,to,account_ids:accountIds,currency:currency||null,transaction_type:transactionType||null,category:category||null,merchant:merchant||null,source:source||null,reconciliation_status:recon||null,receipt_status:receipt||null,q:q||null,where:clauses.join(' AND '),params};
}

async function buildReport(req,definition=null){
  await ensureFinanceSchema();
  const f=buildFilters(req,definition);
  const [summaryByCurrency,categories,transactions,merchants]=await Promise.all([
    trustedTotals.cashTotalsByCurrency(pool,f.where,f.params),
    trustedTotals.categorySpendByCurrency(pool,f.where,f.params,200),
    pool.query(
      `SELECT bt.id,bt.transaction_date,bt.posting_date,bt.description,bt.reference,bt.merchant_name,bt.category,
              bt.debit,bt.credit,bt.currency,bt.ownership_scope,bt.reconciliation_status,bt.source_type,
              bt.is_internal_transfer,ba.nickname AS account_name,ba.institution,
              EXISTS(SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.record_id=CAST(bt.id AS CHAR) AND sd.deleted_at IS NULL) AS has_receipt
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${f.where}
        ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 20000`,f.params
    ).then(([rows])=>rows),
    pool.query(
      `SELECT bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown') AS merchant,
              COUNT(*) AS transaction_count,
              COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS spent,
              COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS received
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${f.where}
        GROUP BY bt.currency,COALESCE(NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown')
        ORDER BY bt.currency,spent DESC LIMIT 500`,f.params
    ).then(([rows])=>rows)
  ]);
  return {
    metadata:{
      scope:f.scope,account_ids:f.account_ids,from:f.from,to:f.to,currency:f.currency,transaction_type:f.transaction_type,
      category:f.category,merchant:f.merchant,source:f.source,reconciliation_status:f.reconciliation_status,receipt_status:f.receipt_status,q:f.q,
      generated_at:new Date().toISOString(),generated_by:userId(req),source_transaction_count:transactions.length,
      currency_treatment:'Native currencies remain separate unless a verified FX service exists.'
    },
    summary:trustedTotals.singleCurrencySummary(summaryByCurrency),
    summary_by_currency:summaryByCurrency,
    categories,merchants,transactions
  };
}

exports.generate=async(req,res)=>{
  try{return res.json(await buildReport(req))}catch(error){return fail(res,error,'Failed to build filtered Finance report.')}
};

exports.csv=async(req,res)=>{
  try{
    const report=await buildReport(req);
    const header=['Date','Posting Date','Account','Institution','Merchant','Description','Reference','Category','Scope','Currency','Debit','Credit','Type','Source','Reconciliation','Receipt'];
    const rows=report.transactions.map(t=>[
      t.transaction_date,t.posting_date,t.account_name,t.institution,t.merchant_name,t.description,t.reference,t.category,t.ownership_scope,t.currency,
      t.debit,t.credit,Number(t.is_internal_transfer)?'TRANSFER':Number(t.debit)>0?'EXPENSE':'INCOME',t.source_type,t.reconciliation_status,Number(t.has_receipt)?'ATTACHED':'MISSING'
    ]);
    const meta=[
      ['Report Scope',report.metadata.scope],['Period From',report.metadata.from||''],['Period To',report.metadata.to||''],
      ['Currency Treatment',report.metadata.currency_treatment],['Generated At',report.metadata.generated_at],['Source Transaction Count',report.metadata.source_transaction_count]
    ];
    const csv=[...meta.map(r=>r.map(csvCell).join(',')), '', header.map(csvCell).join(','), ...rows.map(r=>r.map(csvCell).join(','))].join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="voxel-veda-finance-report.csv"');
    await logAudit(pool,audit(req,'FILTERED_REPORT_EXPORTED','finance_report','CSV',{filters:report.metadata,format:'CSV'}));
    return res.send('\uFEFF'+csv);
  }catch(error){return fail(res,error,'Failed to export filtered Finance CSV.')}
};

exports.listSaved=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const [rows]=await pool.query('SELECT report_uid,name,report_type,definition_json,created_at,updated_at,last_run_at FROM finance_saved_reports WHERE created_by=? ORDER BY updated_at DESC',[userId(req)]);
    return res.json({saved_reports:rows.map(r=>({...r,definition:typeof r.definition_json==='string'?JSON.parse(r.definition_json):r.definition_json}))});
  }catch(error){return fail(res,error,'Failed to load saved Finance reports.')}
};

exports.save=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();const name=safeText(req.body.name,160);if(name.length<2)throw new FinanceError('Report name is required.',400,'REPORT_NAME_REQUIRED');
    const reportType=safeText(req.body.report_type||'TRANSACTION_REGISTER',40).toUpperCase();if(!VALID_TYPES.has(reportType))throw new FinanceError('Unsupported report type.',400,'INVALID_REPORT_TYPE');
    const definition=definitionFrom(req.body.definition||{});buildFilters(req,definition);
    const reportUid=safeText(req.body.report_uid,64)||uid();
    await db.beginTransaction();
    const [[existing]]=await db.query('SELECT id FROM finance_saved_reports WHERE report_uid=? AND created_by=? FOR UPDATE',[reportUid,userId(req)]);
    if(existing) await db.query('UPDATE finance_saved_reports SET name=?,report_type=?,definition_json=? WHERE id=?',[name,reportType,JSON.stringify(definition),existing.id]);
    else await db.query('INSERT INTO finance_saved_reports (report_uid,name,report_type,definition_json,created_by) VALUES (?,?,?,?,?)',[reportUid,name,reportType,JSON.stringify(definition),userId(req)]);
    await logAudit(db,audit(req,existing?'SAVED_REPORT_UPDATED':'SAVED_REPORT_CREATED','finance_saved_report',reportUid,{name,report_type:reportType,definition}));
    await db.commit();return res.status(existing?200:201).json({message:'Saved report definition stored.',report_uid:reportUid});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save Finance report.')}finally{db.release()}
};

exports.remove=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const reportUid=safeText(req.params.uid,64);await db.beginTransaction();
    const [result]=await db.query('DELETE FROM finance_saved_reports WHERE report_uid=? AND created_by=?',[reportUid,userId(req)]);
    if(!result.affectedRows)throw new FinanceError('Saved report not found.',404,'SAVED_REPORT_NOT_FOUND');
    await logAudit(db,audit(req,'SAVED_REPORT_DELETED','finance_saved_report',reportUid,null));await db.commit();
    return res.json({message:'Saved report deleted.'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to delete saved Finance report.')}finally{db.release()}
};

exports.runSaved=async(req,res)=>{
  try{
    const reportUid=safeText(req.params.uid,64);
    const [[row]]=await pool.query('SELECT id,definition_json FROM finance_saved_reports WHERE report_uid=? AND created_by=? LIMIT 1',[reportUid,userId(req)]);
    if(!row)throw new FinanceError('Saved report not found.',404,'SAVED_REPORT_NOT_FOUND');
    const definition=typeof row.definition_json==='string'?JSON.parse(row.definition_json):row.definition_json;
    const report=await buildReport(req,definition);
    await pool.query('UPDATE finance_saved_reports SET last_run_at=NOW() WHERE id=?',[row.id]);
    return res.json(report);
  }catch(error){return fail(res,error,'Failed to run saved Finance report.')}
};

module.exports._test={buildFilters,definitionFrom};
