'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const pool = require('../config/db');
const privacy = require('../services/financePrivacyService');
const money = require('../utils/money');
const trustedTotals = require('../services/financeTrustedTotals');
const { buildCoreBankTransactionFilter, parseAccountIds } = require('../services/financeFilterContract');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { companyProfile } = require('../config/companyProfile');
const { buildFinancePdfArtifact } = require('../services/financeReportPdfService');
const { sendMail, isEmailTransportError, emailFailureDetails, isHostingerMailApiConfigured, isRelayConfigured } = require('../services/emailService');
const { brandedLayout } = require('../services/emailTemplates');

const VALID_SCOPES = new Set(['ALL','PERSONAL','BUSINESS','MIXED','UNCLASSIFIED']);
const VALID_TYPES = new Set(['TRANSACTION_REGISTER','INCOME','EXPENSE','INCOME_VS_EXPENSE','CASH_FLOW','ACCOUNT_ACTIVITY','ACCOUNT_STATEMENT','CATEGORY','MERCHANT','CASH','TRANSFER','REFUND','REIMBURSEMENT','GST_SUMMARY','RECONCILIATION','DATA_QUALITY','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY']);
const VALID_RECON = new Set(['UNRECONCILED','RECONCILED','IGNORED']);
const VALID_RECEIPT = new Set(['ATTACHED','MISSING']);
const VALID_SOURCE = new Set(['STATEMENT_IMPORT','MANUAL','OPEN_BANKING','API_IMPORT']);
const REPORT_DEF_KEYS = new Set(['report_type','scope','account_ids','from','to','currency','transaction_type','category','merchant','source','reconciliation_status','receipt_status','q']);

function uid() { return `RPT_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`; }
function userId(req) { return Number(req.user?.id || req.user?.user_id || 0); }
function parseDate(value,label) {
  const v=String(value||'').trim();
  if(!v) return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FinanceError(`${label} must use YYYY-MM-DD.`,400,'INVALID_REPORT_DATE');
  return v;
}
function parseIds(value) {
  return parseAccountIds(value);
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
  const reportType=safeText(src.report_type||'TRANSACTION_REGISTER',40).toUpperCase();
  if(!VALID_TYPES.has(reportType)) throw new FinanceError('Unsupported report type.',400,'INVALID_REPORT_TYPE');
  let scope=safeText(src.scope||'ALL',20).toUpperCase();
  if(reportType==='PERSONAL_MONTHLY_SUMMARY') scope='PERSONAL';
  if(reportType==='COMPANY_MONTHLY_SUMMARY') scope='BUSINESS';
  if(!VALID_SCOPES.has(scope)) throw new FinanceError('Invalid report workspace.',400,'INVALID_REPORT_SCOPE');
  const accountIds=parseIds(src.account_ids);
  if(reportType==='ACCOUNT_STATEMENT' && accountIds.length!==1) throw new FinanceError('Account Statement requires exactly one account.',400,'ACCOUNT_STATEMENT_ACCOUNT_REQUIRED');
  const currency=safeText(src.currency,3).toUpperCase();
  let transactionType=safeText(src.transaction_type,30).toUpperCase();
  if(!transactionType && ['INCOME','EXPENSE','TRANSFER','REFUND'].includes(reportType)) transactionType=reportType;
  const category=safeText(src.category,120),merchant=safeText(src.merchant,120);
  const source=safeText(src.source,40).toUpperCase(),recon=safeText(src.reconciliation_status,40).toUpperCase();
  const receipt=safeText(src.receipt_status,20).toUpperCase(),q=safeText(src.q,120);
  if(source && !VALID_SOURCE.has(source)) throw new FinanceError('Invalid transaction source filter.',400,'INVALID_REPORT_SOURCE');
  if(recon && !VALID_RECON.has(recon)) throw new FinanceError('Invalid reconciliation filter.',400,'INVALID_REPORT_RECONCILIATION');
  if(receipt && !VALID_RECEIPT.has(receipt)) throw new FinanceError('Invalid receipt filter.',400,'INVALID_REPORT_RECEIPT');
  if(transactionType && !['INCOME','EXPENSE','TRANSFER','REFUND','ALL'].includes(transactionType)) throw new FinanceError('Invalid transaction type filter.',400,'INVALID_REPORT_TRANSACTION_TYPE');

  const core=buildCoreBankTransactionFilter(req,{scope,account_ids:accountIds,from:src.from,to:src.to,currency},{includeIgnored:recon==='IGNORED'});
  const {from,to}=core;
  const clauses=[...core.clauses];
  const params=[...core.params];
  if(category){
    clauses.push("(bt.category=? OR EXISTS (SELECT 1 FROM bank_transaction_splits sx WHERE sx.parent_bank_transaction_id=bt.id AND sx.category=?))");
    params.push(category,category);
  }
  if(merchant){clauses.push('(bt.merchant_name LIKE ? OR bt.description LIKE ?)');params.push(`%${merchant}%`,`%${merchant}%`)}
  if(source){clauses.push('bt.source_type=?');params.push(source)}
  if(recon){clauses.push('bt.reconciliation_status=?');params.push(recon)}
  if(receipt==='ATTACHED') clauses.push("EXISTS (SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND CAST(sd.record_id AS UNSIGNED)=bt.id AND sd.deleted_at IS NULL)");
  if(receipt==='MISSING') clauses.push("NOT EXISTS (SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND CAST(sd.record_id AS UNSIGNED)=bt.id AND sd.deleted_at IS NULL)");
  if(transactionType==='TRANSFER') clauses.push('bt.is_internal_transfer=1');
  if(transactionType==='EXPENSE') clauses.push('bt.debit>0 AND bt.is_internal_transfer=0');
  if(transactionType==='INCOME') clauses.push("bt.credit>0 AND bt.is_internal_transfer=0 AND NOT EXISTS (SELECT 1 FROM finance_refund_links fr WHERE fr.refund_bank_transaction_id=bt.id AND fr.status='ACTIVE')");
  if(transactionType==='REFUND') clauses.push("bt.credit>0 AND EXISTS (SELECT 1 FROM finance_refund_links fr WHERE fr.refund_bank_transaction_id=bt.id AND fr.status='ACTIVE')");
  if(reportType==='CASH') clauses.push("(UPPER(COALESCE(ba.account_type,'')) LIKE '%CASH%' OR UPPER(COALESCE(ba.nickname,'')) LIKE '%CASH%' OR UPPER(COALESCE(ba.financial_purpose,'')) LIKE '%CASH%')");
  if(q){clauses.push('(bt.description LIKE ? OR bt.merchant_name LIKE ? OR bt.reference LIKE ? OR ba.nickname LIKE ? OR ba.institution LIKE ?)');const like=`%${q}%`;params.push(like,like,like,like,like)}
  return {report_type:reportType,scope,from,to,account_ids:accountIds,currency:core.currency,transaction_type:transactionType||null,category:category||null,merchant:merchant||null,source:source||null,reconciliation_status:recon||null,receipt_status:receipt||null,q:q||null,where:clauses.join(' AND '),params};
}

async function reportCoverage(req,filters){
  const clauses=[privacy.visibilitySql('ba',req)];
  const params=[...privacy.visibilityParams(req)];
  if(filters.scope!=='ALL'){clauses.push('ba.ownership_scope=?');params.push(filters.scope)}
  if(filters.account_ids.length){clauses.push(`ba.id IN (${filters.account_ids.map(()=>'?').join(',')})`);params.push(...filters.account_ids)}
  const [rows]=await pool.query(
    `SELECT ba.id,ba.nickname,ba.currency,ba.history_start_date,ba.history_end_date,
            MIN(bt.transaction_date) AS earliest_transaction,MAX(bt.transaction_date) AS latest_transaction,
            MAX(sif.statement_end_date) AS last_statement_date
       FROM bank_accounts ba
       LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id AND bt.reconciliation_status<>'IGNORED'
       LEFT JOIN statement_import_files sif ON sif.bank_account_id=ba.id AND sif.parse_status='IMPORTED'
      WHERE ${clauses.join(' AND ')}
      GROUP BY ba.id ORDER BY ba.nickname`,params
  );
  const accounts=rows.map(row=>{
    const start=String(row.history_start_date||row.earliest_transaction||'').slice(0,10)||null;
    const end=String(row.history_end_date||row.latest_transaction||'').slice(0,10)||null;
    const status=!start||!end?'UNKNOWN':(filters.from&&start>filters.from)||(filters.to&&end<filters.to)?'PARTIAL':'COMPLETE';
    return {account_id:row.id,account_name:row.nickname,currency:row.currency,status,history_start:start,history_end:end,last_statement_date:String(row.last_statement_date||'').slice(0,10)||null};
  });
  const statuses=new Set(accounts.map(row=>row.status));
  const status=statuses.has('UNKNOWN')?'UNKNOWN':statuses.has('PARTIAL')?'PARTIAL':accounts.length?'COMPLETE':'UNKNOWN';
  return {status,accounts,note:status==='COMPLETE'?'Selected account history covers the requested period.':status==='PARTIAL'?'Historical report may be incomplete because selected account coverage does not span the full period.':'Historical completeness is unknown because one or more selected accounts have no verified coverage range.'};
}

async function buildReport(req,definition=null){
  await ensureFinanceSchema();
  const f=buildFilters(req,definition);
  const needMonthly=['CASH_FLOW','INCOME_VS_EXPENSE','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY'].includes(f.report_type);
  const needGst=f.report_type==='GST_SUMMARY';
  const needReimbursements=f.report_type==='REIMBURSEMENT';

  const [summaryByCurrency,categories,transactions,merchants,coverage,monthly,gstSummary,reimbursements]=await Promise.all([
    trustedTotals.cashTotalsByCurrency(pool,f.where,f.params),
    trustedTotals.categorySpendByCurrency(pool,f.where,f.params,200),
    pool.query(
      `SELECT bt.id,bt.bank_account_id,bt.transaction_date,bt.posting_date,bt.description,bt.reference,bt.merchant_name,bt.merchant_normalized,bt.category,
              bt.debit,bt.credit,bt.running_balance,bt.currency,bt.ownership_scope,bt.reconciliation_status,bt.source_type,
              bt.is_internal_transfer,bt.project_ref,bt.gst_treatment,bt.reviewed_at,ba.nickname AS account_name,ba.institution,ba.account_type,
              EXISTS(SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND CAST(sd.record_id AS UNSIGNED)=bt.id AND sd.deleted_at IS NULL) AS has_receipt
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
    ).then(([rows])=>rows),
    reportCoverage(req,f),
    needMonthly?pool.query(
      `SELECT bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,COUNT(*) AS transaction_count,
              COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
              COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out,
              COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 AND bt.credit>0 AND NOT EXISTS (SELECT 1 FROM finance_refund_links fr WHERE fr.refund_bank_transaction_id=bt.id AND fr.status='ACTIVE') THEN bt.credit ELSE 0 END),0) AS ordinary_money_in,
              COALESCE(SUM(CASE WHEN bt.credit>0 AND EXISTS (SELECT 1 FROM finance_refund_links fr WHERE fr.refund_bank_transaction_id=bt.id AND fr.status='ACTIVE') THEN bt.credit ELSE 0 END),0) AS refund_inflow
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${f.where}
        GROUP BY bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
        ORDER BY bt.currency,month`,f.params
    ).then(([rows])=>rows.map(row=>({...row,net_cash_flow:Number(row.money_in||0)-Number(row.money_out||0)}))):Promise.resolve([]),
    needGst?pool.query(
      `SELECT bt.currency,COALESCE(NULLIF(bt.gst_treatment,''),'UNREVIEWED') AS gst_treatment,
              COUNT(DISTINCT bt.id) AS transaction_count,
              COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS gross_expense,
              COALESCE(SUM(COALESCE(gs.recorded_split_gst,0)),0) AS recorded_split_gst
         FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         LEFT JOIN (SELECT parent_bank_transaction_id,SUM(gst_amount) AS recorded_split_gst FROM bank_transaction_splits GROUP BY parent_bank_transaction_id) gs ON gs.parent_bank_transaction_id=bt.id
        WHERE ${f.where}
        GROUP BY bt.currency,COALESCE(NULLIF(bt.gst_treatment,''),'UNREVIEWED')
        ORDER BY bt.currency,gst_treatment`,f.params
    ).then(([rows])=>rows):Promise.resolve([]),
    needReimbursements?pool.query(
      `SELECT fr.id,fr.reimbursement_uid,fr.expense_bank_transaction_id,fr.claimant_user_id,fr.requested_amount,fr.currency,fr.status,
              fr.created_at,fr.submitted_at,fr.approved_at,fr.rejected_at,fr.rejection_reason,
              bt.transaction_date,bt.merchant_name,bt.description,ba.nickname AS account_name,
              COALESCE(SUM(frp.amount),0) AS paid_amount
         FROM finance_reimbursements fr
         JOIN bank_transactions bt ON bt.id=fr.expense_bank_transaction_id
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         LEFT JOIN finance_reimbursement_payments frp ON frp.reimbursement_id=fr.id
        WHERE ${f.where}
        GROUP BY fr.id
        ORDER BY fr.created_at DESC LIMIT 5000`,f.params
    ).then(([rows])=>rows.map(row=>({...row,remaining_amount:Math.max(0,Number(row.requested_amount||0)-Number(row.paid_amount||0))}))):Promise.resolve([])
  ]);

  const reconciliationSummary={};
  for(const row of transactions){
    const key=String(row.reconciliation_status||'UNKNOWN').toUpperCase();
    reconciliationSummary[key]=(reconciliationSummary[key]||0)+1;
  }
  const dataQuality={
    source_transactions:transactions.length,
    unclassified:transactions.filter(row=>!String(row.category||'').trim()).length,
    ownership_unclassified:transactions.filter(row=>String(row.ownership_scope||'').toUpperCase()==='UNCLASSIFIED').length,
    unreconciled:transactions.filter(row=>String(row.reconciliation_status||'').toUpperCase()==='UNRECONCILED').length,
    missing_receipts:transactions.filter(row=>Number(row.debit||0)>0&&!Number(row.has_receipt)).length,
    unreviewed:transactions.filter(row=>!row.reviewed_at).length,
    coverage_status:coverage.status
  };
  let accountStatement=null;
  if(f.report_type==='ACCOUNT_STATEMENT'){
    const ordered=[...transactions].sort((a,b)=>String(a.transaction_date).localeCompare(String(b.transaction_date))||Number(a.id)-Number(b.id));
    const first=ordered[0]||null,last=ordered[ordered.length-1]||null;
    const accountId=f.account_ids[0];
    const [[accountMeta]]=await pool.query(
      `SELECT ba.id,ba.nickname,ba.institution,ba.bsb_masked,ba.account_number_masked,ba.currency,
              ba.account_type,ba.ownership_scope,ba.entity_name,ba.opening_balance,ba.current_ledger_balance,
              ba.available_balance,ba.created_by,u.name AS created_by_name
         FROM bank_accounts ba
         LEFT JOIN users u ON u.id=ba.created_by
        WHERE ba.id=? AND ${privacy.visibilitySql('ba',req)}
        LIMIT 1`,
      [accountId,...privacy.visibilityParams(req)]
    );
    if(!accountMeta) throw new FinanceError('Account Statement account is unavailable.',404,'ACCOUNT_STATEMENT_ACCOUNT_NOT_FOUND');
    const openingFromFirst=first?.running_balance===null||first?.running_balance===undefined
      ? null
      : Number(first.running_balance||0)+Number(first.debit||0)-Number(first.credit||0);
    const movementNet=ordered.reduce((sum,row)=>sum+Number(row.credit||0)-Number(row.debit||0),0);
    const opening=openingFromFirst!==null?openingFromFirst:Number(accountMeta.opening_balance||0);
    const closing=last?.running_balance===null||last?.running_balance===undefined
      ? opening+movementNet
      : Number(last.running_balance||0);
    accountStatement={
      account_id:accountId,
      account_name:accountMeta.nickname||first?.account_name||last?.account_name||coverage.accounts[0]?.account_name||null,
      account_holder:accountMeta.entity_name||accountMeta.created_by_name||accountMeta.nickname||'Account holder',
      institution:accountMeta.institution||'Voxel Veda Finance Platform',
      bsb_masked:accountMeta.bsb_masked||null,
      account_number_masked:accountMeta.account_number_masked||null,
      account_type:accountMeta.account_type||'Account',
      ownership_scope:accountMeta.ownership_scope||null,
      currency:accountMeta.currency||first?.currency||last?.currency||coverage.accounts[0]?.currency||'AUD',
      statement_from:f.from||first?.transaction_date||coverage.accounts[0]?.history_start||null,
      statement_to:f.to||last?.transaction_date||coverage.accounts[0]?.history_end||null,
      opening_running_balance:opening,
      closing_running_balance:closing,
      total_debits:ordered.reduce((sum,row)=>sum+Number(row.debit||0),0),
      total_credits:ordered.reduce((sum,row)=>sum+Number(row.credit||0),0),
      transaction_count:ordered.length
    };
  }

  const reportTransactions=f.report_type==='ACCOUNT_STATEMENT'
    ? [...transactions].sort((a,b)=>String(a.transaction_date).localeCompare(String(b.transaction_date))||Number(a.id)-Number(b.id))
    : transactions;

  const reportId=uid();
  return {
    metadata:{
      report_id:reportId,report_version:3,
      report_type:f.report_type,scope:f.scope,account_ids:f.account_ids,from:f.from,to:f.to,currency:f.currency,transaction_type:f.transaction_type,
      category:f.category,merchant:f.merchant,source:f.source,reconciliation_status:f.reconciliation_status,receipt_status:f.receipt_status,q:f.q,
      generated_at:new Date().toISOString(),generated_by:userId(req),source_transaction_count:transactions.length,
      currency_treatment:'Native currencies remain separate unless a verified FX service exists.',
      history_completeness:coverage.status,history_completeness_note:coverage.note
    },
    summary:trustedTotals.singleCurrencySummary(summaryByCurrency),
    summary_by_currency:summaryByCurrency,
    categories,merchants,transactions:reportTransactions,coverage,monthly,gst_summary:gstSummary,reimbursements,
    reconciliation_summary:reconciliationSummary,data_quality:dataQuality,account_statement:accountStatement
  };
}
exports.generate=async(req,res)=>{
  try{return res.json(await buildReport(req))}catch(error){return fail(res,error,'Failed to build filtered Finance report.')}
};

function csvDataset(report){
  const type=report.metadata.report_type;
  if(type==='CATEGORY') return {header:['Currency','Category','Source Transactions','Split Lines','Amount'],rows:report.categories.map(r=>[r.currency,r.category,r.source_transaction_count,r.split_line_count,r.spent])};
  if(type==='MERCHANT') return {header:['Currency','Merchant','Transactions','Spent','Received'],rows:report.merchants.map(r=>[r.currency,r.merchant,r.transaction_count,r.spent,r.received])};
  if(['CASH_FLOW','INCOME_VS_EXPENSE','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY'].includes(type)) return {header:['Month','Currency','Transactions','Money In','Ordinary Money In','Refund Inflow','Money Out','Net Cash Flow'],rows:report.monthly.map(r=>[r.month,r.currency,r.transaction_count,r.money_in,r.ordinary_money_in,r.refund_inflow,r.money_out,r.net_cash_flow])};
  if(type==='GST_SUMMARY') return {header:['Currency','GST Treatment','Transactions','Gross Expense','Recorded Split GST'],rows:report.gst_summary.map(r=>[r.currency,r.gst_treatment,r.transaction_count,r.gross_expense,r.recorded_split_gst])};
  if(type==='REIMBURSEMENT') return {header:['UID','Date','Account','Merchant','Currency','Requested','Paid','Remaining','Status'],rows:report.reimbursements.map(r=>[r.reimbursement_uid,r.transaction_date,r.account_name,r.merchant_name||r.description,r.currency,r.requested_amount,r.paid_amount,r.remaining_amount,r.status])};
  if(type==='RECONCILIATION') return {header:['Status','Transactions'],rows:Object.entries(report.reconciliation_summary||{})};
  if(type==='DATA_QUALITY') return {header:['Metric','Value'],rows:Object.entries(report.data_quality||{})};
  const statement=type==='ACCOUNT_STATEMENT';
  return {
    header:statement?['Date','Posting Date','Description','Reference','Category','Debit','Credit','Running Balance','Currency','Reconciliation','Receipt']:
      ['Date','Posting Date','Account','Institution','Merchant','Description','Reference','Category','Scope','Currency','Debit','Credit','Type','Source','Reconciliation','Receipt'],
    rows:report.transactions.map(t=>statement?
      [t.transaction_date,t.posting_date,t.description,t.reference,t.category||'Unclassified',t.debit,t.credit,t.running_balance,t.currency,t.reconciliation_status,Number(t.has_receipt)?'ATTACHED':'MISSING']:
      [t.transaction_date,t.posting_date,t.account_name,t.institution,t.merchant_name,t.description,t.reference,t.category,t.ownership_scope,t.currency,t.debit,t.credit,Number(t.is_internal_transfer)?'TRANSFER':Number(t.debit)>0?'EXPENSE':'INCOME',t.source_type,t.reconciliation_status,Number(t.has_receipt)?'ATTACHED':'MISSING'])
  };
}
exports.csv=async(req,res)=>{
  try{
    const report=await buildReport(req),dataset=csvDataset(report);
    const meta=[
      ['Report Type',report.metadata.report_type],['Report Scope',report.metadata.scope],['Period From',report.metadata.from||''],['Period To',report.metadata.to||''],
      ['History Completeness',report.metadata.history_completeness],['Currency Treatment',report.metadata.currency_treatment],['Generated At',report.metadata.generated_at],['Source Transaction Count',report.metadata.source_transaction_count]
    ];
    const csv=[...meta.map(r=>r.map(csvCell).join(',')), '', dataset.header.map(csvCell).join(','), ...dataset.rows.map(r=>r.map(csvCell).join(','))].join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="voxel-veda-finance-report.csv"');
    await logAudit(pool,audit(req,'FILTERED_REPORT_EXPORTED','finance_report','CSV',{filters:report.metadata,format:'CSV'}));
    return res.send('\uFEFF'+csv);
  }catch(error){return fail(res,error,'Failed to export filtered Finance CSV.')}
};

function excelDate(value){
  const raw=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(`${raw}T00:00:00Z`):null;
}

function addWorkbookMetadata(sheet,report,profile,title){
  const meta=report.metadata;
  sheet.addRow([profile.legalName,title]);
  sheet.addRow(['Report ID',meta.report_id,'Version',meta.report_version]);
  sheet.addRow(['Workspace',meta.scope,'Period',`${meta.from||'All'} to ${meta.to||'Now'}`]);
  sheet.addRow(['Accounts',meta.account_ids.length?meta.account_ids.join(', '):'All permitted','Currency',meta.currency||'Native currencies']);
  sheet.addRow(['Generated',new Date(meta.generated_at),'Generated by user',meta.generated_by]);
  sheet.addRow(['History completeness',meta.history_completeness,'Source transactions',meta.source_transaction_count]);
  sheet.addRow(['Filters',[meta.transaction_type,meta.category,meta.merchant,meta.source,meta.reconciliation_status,meta.receipt_status,meta.q].filter(Boolean).join(' | ')||'None']);
  sheet.addRow(['Currency treatment',meta.currency_treatment]);
  sheet.addRow(['Coverage note',meta.history_completeness_note]);
  sheet.addRow([]);
  sheet.mergeCells('A1:P1');
  const titleCell=sheet.getCell('A1');
  titleCell.font={bold:true,size:16,color:{argb:'FF111111'}};
  titleCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF8BC34A'}};
  titleCell.alignment={vertical:'middle'};
  sheet.getRow(1).height=26;
  for(let row=2;row<=9;row+=1){
    sheet.getCell(row,1).font={bold:true,color:{argb:'FF444444'}};
    sheet.getCell(row,3).font={bold:true,color:{argb:'FF444444'}};
  }
  sheet.getCell('B5').numFmt='dd/mm/yyyy hh:mm';
}

function styleTable(sheet,headerRow,lastColumn,lastRow){
  const header=sheet.getRow(headerRow);
  header.font={bold:true,color:{argb:'FFFFFFFF'}};
  header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF111111'}};
  header.alignment={vertical:'middle'};
  header.height=22;
  sheet.views=[{state:'frozen',ySplit:headerRow,xSplit:0}];
  sheet.autoFilter={from:{row:headerRow,column:1},to:{row:Math.max(headerRow,lastRow),column:lastColumn}};
  for(let row=headerRow+1;row<=lastRow;row+=1){
    if((row-headerRow)%2===0)sheet.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F5F7'}};
  }
}

async function createReportWorkbook(report,profile,title){
    const workbook=new ExcelJS.Workbook();
    workbook.creator=profile.legalName;
    workbook.company=profile.legalName;
    workbook.subject=title;
    workbook.created=new Date(report.metadata.generated_at);
    workbook.modified=workbook.created;

    const transactions=workbook.addWorksheet('Transactions',{properties:{tabColor:{argb:'FF8BC34A'}}});
    addWorkbookMetadata(transactions,report,profile,title);
    const txHeader=transactions.addRow(['Date','Posting Date','Account','Institution','Merchant','Description','Reference','Category','Scope','Currency','Debit','Credit','Type','Source','Reconciliation','Receipt']);
    for(const row of report.transactions){
      transactions.addRow([
        excelDate(row.transaction_date),excelDate(row.posting_date),row.account_name||'',row.institution||'',row.merchant_name||'',row.description||'',
        row.reference||'',row.category||'',row.ownership_scope||'',row.currency||'',Number(row.debit||0),Number(row.credit||0),
        Number(row.is_internal_transfer)?'TRANSFER':Number(row.debit)>0?'EXPENSE':'INCOME',row.source_type||'',row.reconciliation_status||'',Number(row.has_receipt)?'ATTACHED':'MISSING'
      ]);
    }
    transactions.columns=[12,12,22,22,24,38,20,22,15,11,14,14,14,18,18,12].map(width=>({width}));
    for(let row=txHeader.number+1;row<=transactions.rowCount;row+=1){
      transactions.getCell(row,1).numFmt='dd/mm/yyyy';transactions.getCell(row,2).numFmt='dd/mm/yyyy';
      transactions.getCell(row,11).numFmt='#,##0.00;[Red]-#,##0.00';transactions.getCell(row,12).numFmt='#,##0.00;[Red]-#,##0.00';
    }
    styleTable(transactions,txHeader.number,16,transactions.rowCount);

    const summary=workbook.addWorksheet('Summary');
    addWorkbookMetadata(summary,report,profile,title);
    const summaryHeader=summary.addRow(['Currency','Transactions','Money In','Ordinary Money In','Refund Inflow','Money Out','Net Cash Flow','Net Economic Expense','Transfer Movement','Cash In','Cash Out','Unclassified']);
    for(const row of report.summary_by_currency)summary.addRow([row.currency,row.source_transaction_count,Number(row.money_in),Number(row.ordinary_money_in),Number(row.linked_refund_inflow),Number(row.money_out),Number(row.net_cash_flow),Number(row.net_economic_expense),Number(row.transfer_movement),Number(row.cash_in),Number(row.cash_out),row.unclassified]);
    summary.columns=[12,14,16,19,16,16,17,21,18,14,14,14].map(width=>({width}));
    for(let row=summaryHeader.number+1;row<=summary.rowCount;row+=1)for(let col=3;col<=11;col+=1)summary.getCell(row,col).numFmt='#,##0.00;[Red]-#,##0.00';
    styleTable(summary,summaryHeader.number,12,summary.rowCount);

    const categories=workbook.addWorksheet('Categories');
    addWorkbookMetadata(categories,report,profile,title);
    const categoryHeader=categories.addRow(['Currency','Category','Source Transactions','Split Lines','Amount']);
    for(const row of report.categories)categories.addRow([row.currency,row.category,row.source_transaction_count,row.split_line_count,Number(row.spent)]);
    categories.columns=[12,30,20,14,18].map(width=>({width}));
    for(let row=categoryHeader.number+1;row<=categories.rowCount;row+=1)categories.getCell(row,5).numFmt='#,##0.00;[Red]-#,##0.00';
    styleTable(categories,categoryHeader.number,5,categories.rowCount);

    const coverage=workbook.addWorksheet('Coverage');
    addWorkbookMetadata(coverage,report,profile,title);
    const coverageHeader=coverage.addRow(['Account ID','Account','Currency','Status','History Start','History End','Last Statement']);
    for(const row of report.coverage.accounts)coverage.addRow([row.account_id,row.account_name,row.currency,row.status,excelDate(row.history_start),excelDate(row.history_end),excelDate(row.last_statement_date)]);
    coverage.columns=[12,26,12,14,16,16,16].map(width=>({width}));
    for(let row=coverageHeader.number+1;row<=coverage.rowCount;row+=1)for(let col=5;col<=7;col+=1)coverage.getCell(row,col).numFmt='dd/mm/yyyy';
    styleTable(coverage,coverageHeader.number,7,coverage.rowCount);

    if(report.monthly?.length){
      const monthly=workbook.addWorksheet('Monthly');
      addWorkbookMetadata(monthly,report,profile,title);
      const h=monthly.addRow(['Month','Currency','Transactions','Money In','Ordinary Money In','Refund Inflow','Money Out','Net Cash Flow']);
      for(const row of report.monthly)monthly.addRow([row.month,row.currency,row.transaction_count,Number(row.money_in||0),Number(row.ordinary_money_in||0),Number(row.refund_inflow||0),Number(row.money_out||0),Number(row.net_cash_flow||0)]);
      monthly.columns=[14,12,14,16,20,16,16,18].map(width=>({width}));
      for(let row=h.number+1;row<=monthly.rowCount;row+=1)for(let col=4;col<=8;col+=1)monthly.getCell(row,col).numFmt='#,##0.00;[Red]-#,##0.00';
      styleTable(monthly,h.number,8,monthly.rowCount);
    }
    if(report.gst_summary?.length){
      const gst=workbook.addWorksheet('GST Review');
      addWorkbookMetadata(gst,report,profile,title);
      const h=gst.addRow(['Currency','GST Treatment','Transactions','Gross Expense','Recorded Split GST']);
      for(const row of report.gst_summary)gst.addRow([row.currency,row.gst_treatment,row.transaction_count,Number(row.gross_expense||0),Number(row.recorded_split_gst||0)]);
      gst.columns=[12,24,14,18,20].map(width=>({width}));
      for(let row=h.number+1;row<=gst.rowCount;row+=1){gst.getCell(row,4).numFmt='#,##0.00;[Red]-#,##0.00';gst.getCell(row,5).numFmt='#,##0.00;[Red]-#,##0.00'}
      styleTable(gst,h.number,5,gst.rowCount);
    }
    if(report.reimbursements?.length){
      const reimb=workbook.addWorksheet('Reimbursements');
      addWorkbookMetadata(reimb,report,profile,title);
      const h=reimb.addRow(['UID','Expense Date','Account','Merchant','Currency','Requested','Paid','Remaining','Status']);
      for(const row of report.reimbursements)reimb.addRow([row.reimbursement_uid,excelDate(row.transaction_date),row.account_name||'',row.merchant_name||row.description||'',row.currency,Number(row.requested_amount||0),Number(row.paid_amount||0),Number(row.remaining_amount||0),row.status]);
      reimb.columns=[24,14,22,30,12,16,16,16,18].map(width=>({width}));
      for(let row=h.number+1;row<=reimb.rowCount;row+=1){reimb.getCell(row,2).numFmt='dd/mm/yyyy';for(let col=6;col<=8;col+=1)reimb.getCell(row,col).numFmt='#,##0.00;[Red]-#,##0.00'}
      styleTable(reimb,h.number,9,reimb.rowCount);
    }
    if(report.metadata.report_type==='RECONCILIATION'){
      const recon=workbook.addWorksheet('Reconciliation');
      addWorkbookMetadata(recon,report,profile,title);
      const h=recon.addRow(['Status','Transactions']);
      for(const [status,count] of Object.entries(report.reconciliation_summary||{}))recon.addRow([status,count]);
      recon.columns=[24,16].map(width=>({width}));styleTable(recon,h.number,2,recon.rowCount);
    }
    if(report.metadata.report_type==='DATA_QUALITY'){
      const quality=workbook.addWorksheet('Data Quality');
      addWorkbookMetadata(quality,report,profile,title);
      const h=quality.addRow(['Metric','Value']);
      for(const [metric,value] of Object.entries(report.data_quality||{}))quality.addRow([metric,value]);
      quality.columns=[30,22].map(width=>({width}));styleTable(quality,h.number,2,quality.rowCount);
    }
    return workbook;
}

exports.xlsx=async(req,res)=>{
  try{
    const report=await buildReport(req),profile=await reportCompanyProfile(),title=reportTitle(report.metadata.report_type);
    const workbook=await createReportWorkbook(report,profile,title);
    const buffer=await workbook.xlsx.writeBuffer();
    const safeName=title.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
    await logAudit(pool,audit(req,'FILTERED_REPORT_EXPORTED','finance_report',report.metadata.report_id,{filters:report.metadata,format:'XLSX',worksheets:workbook.worksheets.length}));
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="Voxel-Veda-${safeName}.xlsx"`);
    res.setHeader('Content-Length',buffer.length);
    return res.send(buffer);
  }catch(error){return fail(res,error,'Failed to export filtered Finance XLSX.')}
};

function reportTitle(reportType) {
  return ({
    TRANSACTION_REGISTER:'Transaction Register',INCOME:'Income Report',EXPENSE:'Expense Report',
    INCOME_VS_EXPENSE:'Income vs Expense',CASH_FLOW:'Cash Flow Report',ACCOUNT_ACTIVITY:'Account Activity',
    ACCOUNT_STATEMENT:'Account Statement',CATEGORY:'Category Analysis',MERCHANT:'Merchant Analysis',
    CASH:'Cash Report',TRANSFER:'Transfers Report',REFUND:'Refunds Report',REIMBURSEMENT:'Reimbursements Report',
    GST_SUMMARY:'GST Summary',RECONCILIATION:'Reconciliation Report',DATA_QUALITY:'Data Quality Report',
    PERSONAL_MONTHLY_SUMMARY:'Personal Monthly Summary',COMPANY_MONTHLY_SUMMARY:'Company Monthly Summary'
  })[reportType] || 'Finance Report';
}

async function reportCompanyProfile() {
  const defaults=companyProfile();
  const keys=['company_legal_name','trading_name','company_address','company_email','abn','website','support_phone','report_footer'];
  const [rows]=await pool.query(`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN (${keys.map(()=>'?').join(',')})`,keys).catch(()=>[[]]);
  const configured=Object.fromEntries((rows||[]).map(row=>[row.setting_key,row.setting_value]));
  return {
    legalName:configured.company_legal_name||defaults.legalName,
    tradingName:configured.trading_name||defaults.name,
    address:configured.company_address||defaults.address,
    email:configured.company_email||defaults.email,
    abn:configured.abn||defaults.abn,
    website:configured.website||defaults.website,
    phone:configured.support_phone||defaults.phone,
    footer:configured.report_footer||'Confidential Financial Information'
  };
}

function printableAmount(value,currency) {
  return `${String(currency||'').toUpperCase()} ${money.fromCents(money.toCents(value||0))}`.trim();
}

function bankStatementMoney(value,currency){
  const amount=Number(value||0);
  try{return new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount)+(currency?' '+String(currency).toUpperCase():'')}
  catch{return amount.toFixed(2)+(currency?' '+String(currency).toUpperCase():'')}
}
function bankStatementDate(value){
  const raw=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '—';
  const [y,m,d]=raw.split('-');
  return `${d}/${m}/${y}`;
}
function renderBankStatementPageChrome(doc,profile,report,reportId,pageNumber,pageCount){
  const statement=report.account_statement||{};
  const logoPath=path.join(__dirname,'..','public','Frame 1.png');
  if(fs.existsSync(logoPath)){try{doc.image(logoPath,42,24,{fit:[56,46]})}catch{}}
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#111827').text(profile.tradingName||profile.legalName||'Voxel Veda',106,25,{width:250});
  doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text(profile.legalName||'Voxel Veda Pty Ltd',106,42,{width:250});
  doc.fontSize(6.8).text([profile.abn?`ABN ${profile.abn}`:null,profile.website||null].filter(Boolean).join(' · '),106,54,{width:250});
  doc.font('Helvetica').fontSize(20).fillColor('#0877FF').text('Your Statement',370,24,{width:183,align:'right'});
  doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#111827').text(`Statement ${statement.account_id||'—'}`,397,52,{width:156,align:'right'});
  doc.font('Helvetica').fontSize(6.8).fillColor('#64748B').text(`Page ${pageNumber} of ${pageCount}`,397,64,{width:156,align:'right'});
  doc.moveTo(42,88).lineTo(553,88).strokeColor('#D9E6F3').lineWidth(0.8).stroke();
  doc.font('Helvetica').fontSize(6.5).fillColor('#64748B').text(
    `Account ${statement.account_number_masked||'masked'} · ${bankStatementDate(statement.statement_from)} – ${bankStatementDate(statement.statement_to)} · Statement ID ${reportId}`,
    42,96,{width:511,align:'right'}
  );
}

function bankStatementTableHeader(doc,y){
  doc.save();
  doc.rect(42,y,511,22).fill('#0B5ED7');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(6.4);
  doc.text('Date',48,y+7,{width:42});
  doc.text('Description',92,y+7,{width:128});
  doc.text('Reference',222,y+7,{width:80});
  doc.text('Category',304,y+7,{width:80});
  doc.text('Debit',388,y+7,{width:48,align:'right'});
  doc.text('Credit',440,y+7,{width:48,align:'right'});
  doc.text('Running balance',492,y+5,{width:55,align:'right'});
  doc.restore();
  return y+22;
}
function renderBankStyleAccountStatement(doc,report,profile,reportId){
  const statement=report.account_statement||{};
  const currency=statement.currency||'AUD';
  const statementNo=`STMT-${statement.account_id||'A'}-${String(statement.statement_from||'ALL').replace(/-/g,'')}-${String(statement.statement_to||'NOW').replace(/-/g,'')}`;
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0F172A').text(statement.account_type||'Finance Account',42,120,{width:320});
  doc.font('Helvetica').fontSize(7.4).fillColor('#64748B').text('Secure account activity statement',42,143,{width:260});
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155').text(statementNo,390,124,{width:163,align:'right'});

  const summaryY=163;
  doc.roundedRect(42,summaryY,511,101,10).fillAndStroke('#F8FBFF','#DCE8F5');
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10).text(statement.account_holder||statement.account_name||'Account holder',56,summaryY+14,{width:260});
  doc.font('Helvetica').fontSize(7.5).fillColor('#5E718A').text(`${statement.account_type||'Account'} · ${statement.account_name||''}`,56,summaryY+31,{width:260});
  const brandedIssuer=profile.tradingName||profile.legalName||'Voxel Veda';
  const leftDetails=[
    brandedIssuer,
    statement.bsb_masked?`BSB ${statement.bsb_masked}`:null,
    statement.account_number_masked?`Account ${statement.account_number_masked}`:null
  ].filter(Boolean).join(' · ');
  doc.text(leftDetails,56,summaryY+46,{width:280});
  doc.fillColor('#334155').font('Helvetica-Bold').text('Statement period',354,summaryY+14,{width:90});
  doc.font('Helvetica').fillColor('#475569').text(`${bankStatementDate(statement.statement_from)} – ${bankStatementDate(statement.statement_to)}`,446,summaryY+14,{width:94,align:'right'});
  doc.font('Helvetica-Bold').fillColor('#334155').text('Opening balance',354,summaryY+33,{width:90});
  doc.font('Helvetica').fillColor('#0F172A').text(bankStatementMoney(statement.opening_running_balance,currency),446,summaryY+33,{width:94,align:'right'});
  doc.font('Helvetica-Bold').fillColor('#334155').text('Closing balance',354,summaryY+52,{width:90});
  doc.font('Helvetica-Bold').fillColor('#0B5ED7').text(bankStatementMoney(statement.closing_running_balance,currency),446,summaryY+52,{width:94,align:'right'});
  doc.font('Helvetica-Bold').fillColor('#334155').text('Transactions',354,summaryY+71,{width:90});
  doc.font('Helvetica').fillColor('#0F172A').text(String(statement.transaction_count||0),446,summaryY+71,{width:94,align:'right'});

  doc.font('Helvetica').fontSize(7).fillColor('#64748B').text(
    'This statement is generated from the Voxel Veda Finance ledger for the signed-in account holder. Source-bank transaction descriptions are preserved for audit accuracy. Voxel Veda branding identifies this generated document; it does not represent the source bank and does not claim that Voxel Veda is an authorised deposit-taking institution.',
    42,279,{width:511}
  );

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A').text('Transaction activity',42,307,{width:220});
  doc.font('Helvetica').fontSize(6.8).fillColor('#64748B').text('Debits are money out. Credits are money in. Balance is the recorded running balance where supplied by the source statement.',42,322,{width:511});

  let y=346;
  y=bankStatementTableHeader(doc,y);
  const rows=[...(report.transactions||[])].sort((a,b)=>String(a.transaction_date).localeCompare(String(b.transaction_date))||Number(a.id)-Number(b.id));
  for(const row of rows){
    const description=String(row.description||row.merchant_name||'Transaction').replace(/\s+/g,' ').trim();
    const ref=row.reference?String(row.reference).replace(/\s+/g,' ').trim():'';
    const category=String(row.category||'Unclassified').replace(/\s+/g,' ').trim();
    const textHeight=Math.max(
      doc.heightOfString(description,{width:124,lineGap:1}),
      doc.heightOfString(ref,{width:76,lineGap:1}),
      doc.heightOfString(category,{width:76,lineGap:1})
    );
    const rowH=Math.max(28,Math.min(45,textHeight+10));
    if(y+rowH>746){
      doc.addPage();
      y=118;
      y=bankStatementTableHeader(doc,y);
    }
    if(Math.floor((y-323)/28)%2===1)doc.rect(42,y,511,rowH).fill('#FAFCFF');
    doc.moveTo(42,y+rowH).lineTo(553,y+rowH).strokeColor('#E5EDF6').lineWidth(0.45).stroke();
    doc.fillColor('#334155').font('Helvetica').fontSize(6.3);
    doc.text(bankStatementDate(row.transaction_date),48,y+8,{width:42});
    doc.fillColor('#172033').text(description,92,y+7,{width:128,height:rowH-8,ellipsis:true,lineGap:1});
    doc.fillColor('#475569').text(ref,222,y+7,{width:80,height:rowH-8,ellipsis:true,lineGap:1});
    doc.fillColor('#334155').text(category,304,y+7,{width:80,height:rowH-8,ellipsis:true,lineGap:1});
    doc.text(Number(row.debit||0)>0?bankStatementMoney(row.debit,''): '',388,y+8,{width:48,align:'right'});
    doc.text(Number(row.credit||0)>0?bankStatementMoney(row.credit,''): '',440,y+8,{width:48,align:'right'});
    doc.font('Helvetica-Bold').fillColor('#172033').text(row.running_balance===null||row.running_balance===undefined?'—':bankStatementMoney(row.running_balance,''),492,y+8,{width:55,align:'right'});
    y+=rowH;
  }
  if(y+78>746){doc.addPage();y=118}
  doc.roundedRect(42,y+14,511,58,8).fillAndStroke('#F8FBFF','#DCE8F5');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155').text('Statement totals',56,y+27,{width:150});
  doc.font('Helvetica').fontSize(7.3).fillColor('#475569').text(`Debits ${bankStatementMoney(statement.total_debits,currency)}`,245,y+27,{width:130,align:'right'});
  doc.text(`Credits ${bankStatementMoney(statement.total_credits,currency)}`,380,y+27,{width:159,align:'right'});
  doc.font('Helvetica-Bold').fillColor('#0B5ED7').text(`Closing ${bankStatementMoney(statement.closing_running_balance,currency)}`,380,y+45,{width:159,align:'right'});
  doc.font('Helvetica').fontSize(6.5).fillColor('#64748B').text(`Statement ID ${reportId} · Generated from permission-scoped ledger data`,56,y+46,{width:300});
}

function buildBankStatementPdfArtifact(report,profile,title){
  const reportId='FIN-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const filename='Voxel-Veda-' + title.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'') + '.pdf';
  return new Promise((resolve,reject)=>{
    const chunks=[];
    let pageCount=0;
    const doc=new PDFDocument({
      size:'A4',
      margins:{top:112,left:42,right:42,bottom:66},
      bufferPages:true,
      info:{Title:(profile.tradingName||profile.legalName||'Voxel Veda') + ' - ' + title,Author:profile.legalName||'Voxel Veda Pty Ltd'}
    });
    doc.on('data',chunk=>chunks.push(chunk));
    doc.on('error',reject);
    doc.on('end',()=>resolve({buffer:Buffer.concat(chunks),reportId,filename,pages:pageCount}));
    try{
      renderBankStyleAccountStatement(doc,report,profile,reportId);
      const pages=doc.bufferedPageRange();
      pageCount=pages.count;
      for(let index=0;index<pages.count;index+=1){
        doc.switchToPage(index);
        renderBankStatementPageChrome(doc,profile,report,reportId,index+1,pages.count);
        doc.moveTo(42,774).lineTo(553,774).strokeColor('#D9E6F3').lineWidth(0.6).stroke();
        doc.font('Helvetica').fontSize(6.5).fillColor('#64748B').text(
          (profile.footer||'Confidential Financial Information') + ' · ' + (profile.website||'') + ' · Page ' + (index+1) + ' of ' + pages.count,
          42,782,{width:511,align:'center'}
        );
      }
      doc.end();
    }catch(error){
      try{doc.end()}catch{}
      reject(error);
    }
  });
}

function buildReportPdfArtifact(report,profile,title){
  if(report.metadata.report_type==='ACCOUNT_STATEMENT') return buildBankStatementPdfArtifact(report,profile,title);
  return buildFinancePdfArtifact(report,profile,title);
}

function assertPdfArtifact(artifact){
  const buffer=artifact?.buffer;
  if(!Buffer.isBuffer(buffer)||buffer.length<5||buffer.subarray(0,5).toString('ascii')!=='%PDF-'){
    const error=new FinanceError('Generated report is not a valid PDF attachment.',500,'PDF_ATTACHMENT_INVALID');
    throw error;
  }
  if(!String(artifact?.filename||'').toLowerCase().endsWith('.pdf')){
    throw new FinanceError('Generated report filename is not a PDF.',500,'PDF_ATTACHMENT_FILENAME_INVALID');
  }
  return artifact;
}

exports.pdf=async(req,res)=>{
  try{
    const report=await buildReport(req);
    const profile=await reportCompanyProfile();
    const title=reportTitle(report.metadata.report_type);
    const artifact=await buildReportPdfArtifact(report,profile,title);
    await logAudit(pool,audit(req,'FILTERED_REPORT_EXPORTED','finance_report',artifact.reportId,{
      filters:report.metadata,format:'PDF',pages:artifact.pages
    }));
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="' + artifact.filename + '"');
    res.setHeader('Content-Length',artifact.buffer.length);
    return res.send(artifact.buffer);
  }catch(error){
    return fail(res,error,'Failed to export filtered Finance PDF.');
  }
};

exports.emailPdf=async(req,res)=>{
  try{
    const definition=definitionFrom(req.body && req.body.definition ? req.body.definition : (req.body||{}));
    const recipient=safeText(req.body && req.body.to,254);
    const deliveryNote=safeText(req.body && req.body.note,500);
    if(!recipient) throw new FinanceError('Recipient email is required.',400,'REPORT_EMAIL_RECIPIENT_REQUIRED');

    const report=await buildReport(req,definition);
    const profile=await reportCompanyProfile();
    const title=reportTitle(report.metadata.report_type);
    const artifact=assertPdfArtifact(await buildReportPdfArtifact(report,profile,title));
    const period=(report.metadata.from||'All history') + ' to ' + (report.metadata.to||'Now');
    const companyName=profile.tradingName||profile.legalName||'Voxel Veda';

    const textBody=[
      companyName + ' Finance',
      '',
      'Attached PDF: ' + artifact.filename,
      'Report: ' + title,
      'Period: ' + period,
      'Report ID: ' + artifact.reportId,
      deliveryNote ? 'Note: ' + deliveryNote : null,
      '',
      'The attached file is the requested Finance report in PDF format.'
    ].filter((line)=>line!==null).join('\n');

    const htmlBody=brandedLayout(
      '<h2 style="margin-top:0">' + title + '</h2>' +
      '<p>Your requested Finance report is attached as a PDF document.</p>' +
      '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:18px 0">' +
      '<tr><td style="padding:8px 0;color:#607080">File</td><td style="padding:8px 0"><strong>' + artifact.filename.replace(/[<>&"]/g,'') + '</strong></td></tr>' +
      '<tr><td style="padding:8px 0;color:#607080">Period</td><td style="padding:8px 0">' + period.replace(/[<>&"]/g,'') + '</td></tr>' +
      '<tr><td style="padding:8px 0;color:#607080">Report ID</td><td style="padding:8px 0">' + artifact.reportId.replace(/[<>&"]/g,'') + '</td></tr>' +
      '</table>' +
      (deliveryNote ? '<p><strong>Note:</strong> ' + deliveryNote.replace(/[<>&"]/g,'') + '</p>' : '') +
      '<p style="font-size:12px;color:#607080">Attachment type: application/pdf. Filename ends in .pdf.</p>',
      title + ' PDF attached'
    );

    const result=await sendMail({
      to:recipient,
      subject:companyName + ' | ' + title + ' | ' + period,
      text:textBody,
      html:htmlBody,
      replyTo:profile.email,
      attachments:[{
        filename:artifact.filename,
        content:artifact.buffer,
        contentType:'application/pdf',
        contentDisposition:'attachment'
      }]
    });

    if(!result?.attachmentFilenameGuaranteed){
      const error=new Error('Email provider did not verify the PDF attachment filename.');
      error.code='PDF_ATTACHMENT_FILENAME_UNVERIFIED';
      throw error;
    }

    await logAudit(pool,audit(req,'FILTERED_REPORT_EMAILED','finance_report',artifact.reportId,{
      filters:report.metadata,
      format:'PDF',
      pages:artifact.pages,
      recipient_count:1,
      provider_message_id:result && result.messageId ? result.messageId : null,
      delivery_mode:'pdf_attachment',
      filename:artifact.filename
    }));

    return res.json({
      message:'PDF report sent successfully to ' + recipient + '.',
      report_id:artifact.reportId,
      filename:artifact.filename,
      message_id:result && result.messageId ? result.messageId : null,
      sender:profile.email,
      attachment_content_type:'application/pdf',
      attachment_bytes:artifact.buffer.length,
      delivery_transport:result?.transport||null,
      delivery_mode:'pdf_attachment',
      attachment_filename_verified:true,
      attachment_contract_version:4
    });
  }catch(error){
    if(isEmailTransportError(error)){
      const details=emailFailureDetails(error);
      return res.status(details.status).json(details);
    }
    return fail(res,error,'Failed to email filtered Finance PDF.');
  }
};

exports.listSaved=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const [rows]=await pool.query("SELECT report_uid,name,report_type,definition_json,created_at,updated_at,last_run_at FROM finance_saved_reports WHERE created_by=? AND report_type<>'EMAIL_PDF_BLOB' ORDER BY updated_at DESC",[userId(req)]);
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
    const stored=typeof row.definition_json==='string'?JSON.parse(row.definition_json):row.definition_json;
    const overrides=definitionFrom(req.query||{});
    const definition={...stored,...overrides};
    return res.json(await buildReport(req,definition));
  }catch(error){return fail(res,error,'Failed to run saved Finance report.')}
};

module.exports._test={buildFilters,definitionFrom,createReportWorkbook,assertPdfArtifact};
