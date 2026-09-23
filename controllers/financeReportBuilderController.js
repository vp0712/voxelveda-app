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
  if(receipt==='ATTACHED') clauses.push("EXISTS (SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.record_id=CAST(bt.id AS CHAR) AND sd.deleted_at IS NULL)");
  if(receipt==='MISSING') clauses.push("NOT EXISTS (SELECT 1 FROM secure_documents sd WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND sd.record_id=CAST(bt.id AS CHAR) AND sd.deleted_at IS NULL)");
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
    accountStatement={
      account_id:f.account_ids[0],
      account_name:first?.account_name||last?.account_name||coverage.accounts[0]?.account_name||null,
      currency:first?.currency||last?.currency||coverage.accounts[0]?.currency||null,
      opening_running_balance:first?.running_balance??null,
      closing_running_balance:last?.running_balance??null,
      transaction_count:ordered.length
    };
  }

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
    categories,merchants,transactions,coverage,monthly,gst_summary:gstSummary,reimbursements,
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
    header:statement?['Date','Posting Date','Description','Reference','Debit','Credit','Running Balance','Currency','Reconciliation','Receipt']:
      ['Date','Posting Date','Account','Institution','Merchant','Description','Reference','Category','Scope','Currency','Debit','Credit','Type','Source','Reconciliation','Receipt'],
    rows:report.transactions.map(t=>statement?
      [t.transaction_date,t.posting_date,t.description,t.reference,t.debit,t.credit,t.running_balance,t.currency,t.reconciliation_status,Number(t.has_receipt)?'ATTACHED':'MISSING']:
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

exports.pdf=async(req,res)=>{
  try{
    const report=await buildReport(req),profile=await reportCompanyProfile(),title=reportTitle(report.metadata.report_type);
    const reportId=`FIN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const generatedAt=new Date();
    const doc=new PDFDocument({size:'A4',margins:{top:112,left:42,right:42,bottom:66},bufferPages:true,info:{Title:`${profile.legalName} - ${title}`,Author:profile.legalName}});
    const safeName=title.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="Voxel-Veda-${safeName}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#111827').text(title);
    doc.moveDown(0.25).fontSize(9).fillColor('#4b5563').text(
      `Workspace: ${report.metadata.scope} · Period: ${report.metadata.from||'All'} to ${report.metadata.to||'Now'} · Transactions: ${report.metadata.source_transaction_count}`
    );
    doc.text(`Currency treatment: ${report.metadata.currency_treatment}`);
    doc.moveDown(0.7).fontSize(13).fillColor('#111827').text('Financial summary');
    for(const row of report.summary_by_currency||[]){
      doc.fontSize(9).text(
        `${row.currency}: Money In ${printableAmount(row.money_in,row.currency)} · Money Out ${printableAmount(row.money_out,row.currency)} · Net ${printableAmount(row.net_cash_flow,row.currency)}`
      );
      doc.fontSize(8).fillColor('#6b7280').text(
        `Ordinary inflow ${printableAmount(row.ordinary_money_in,row.currency)} · Linked refunds ${printableAmount(row.linked_refund_inflow,row.currency)} · Net economic expense ${printableAmount(row.net_economic_expense,row.currency)}`
      ).fillColor('#111827');
    }

    if(report.metadata.report_type==='CATEGORY'){
      doc.moveDown().fontSize(13).text('Category analysis');
      for(const row of (report.categories||[]).slice(0,500)){
        if(doc.y>724)doc.addPage();
        doc.fontSize(8).text(`${row.category||'Uncategorised'} · ${row.currency} · ${printableAmount(row.spent,row.currency)}`);
      }
    }else if(report.metadata.report_type==='MERCHANT'){
      doc.moveDown().fontSize(13).text('Merchant analysis');
      for(const row of (report.merchants||[]).slice(0,500)){
        if(doc.y>724)doc.addPage();
        doc.fontSize(8).text(`${row.merchant||'Unknown'} · ${row.currency} · spent ${printableAmount(row.spent,row.currency)} · received ${printableAmount(row.received,row.currency)} · ${row.transaction_count} transaction(s)`);
      }
    }else if(['CASH_FLOW','INCOME_VS_EXPENSE','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY'].includes(report.metadata.report_type)){
      doc.moveDown().fontSize(13).text('Monthly cash flow');
      for(const row of report.monthly||[]){
        if(doc.y>724)doc.addPage();
        doc.fontSize(8).text(`${row.month} · ${row.currency} · in ${printableAmount(row.money_in,row.currency)} · out ${printableAmount(row.money_out,row.currency)} · net ${printableAmount(row.net_cash_flow,row.currency)}`);
      }
    }else if(report.metadata.report_type==='GST_SUMMARY'){
      doc.moveDown().fontSize(13).text('GST review summary');
      doc.fontSize(7.5).fillColor('#6b7280').text('Recorded split GST is reported from reviewed split data only; this report does not invent GST where none is recorded.').fillColor('#111827');
      for(const row of report.gst_summary||[]){
        if(doc.y>724)doc.addPage();
        doc.fontSize(8).text(`${row.currency} · ${row.gst_treatment} · ${row.transaction_count} transaction(s) · gross expense ${printableAmount(row.gross_expense,row.currency)} · recorded split GST ${printableAmount(row.recorded_split_gst,row.currency)}`);
      }
    }else if(report.metadata.report_type==='REIMBURSEMENT'){
      doc.moveDown().fontSize(13).text('Reimbursements');
      for(const row of report.reimbursements||[]){
        if(doc.y>716)doc.addPage();
        doc.fontSize(8).text(`${String(row.transaction_date||'').slice(0,10)} · ${row.account_name||''} · ${row.merchant_name||row.description||''} · ${row.status}`);
        doc.fontSize(7.5).fillColor('#6b7280').text(`Requested ${printableAmount(row.requested_amount,row.currency)} · paid ${printableAmount(row.paid_amount,row.currency)} · remaining ${printableAmount(row.remaining_amount,row.currency)}`).fillColor('#111827');
      }
    }else if(report.metadata.report_type==='RECONCILIATION'){
      doc.moveDown().fontSize(13).text('Reconciliation summary');
      for(const [status,count] of Object.entries(report.reconciliation_summary||{}))doc.fontSize(8).text(`${status}: ${count} transaction(s)`);
    }else if(report.metadata.report_type==='DATA_QUALITY'){
      doc.moveDown().fontSize(13).text('Data quality summary');
      for(const [metric,value] of Object.entries(report.data_quality||{}))doc.fontSize(8).text(`${String(metric).replaceAll('_',' ')}: ${value}`);
    }else{
      doc.moveDown().fontSize(13).text(report.metadata.report_type==='ACCOUNT_STATEMENT'?'Account statement transactions':'Transactions');
      for(const row of report.transactions||[]){
        if(doc.y>716)doc.addPage();
        const amount=Number(row.debit)>0?-Number(row.debit||0):Number(row.credit||0);
        doc.fontSize(8).fillColor('#111827').text(
          `${String(row.transaction_date||'').slice(0,10)}  ${row.account_name||''}  ${row.merchant_name||row.description||''}`,
          {width:380,continued:true}
        );
        doc.text(printableAmount(Math.abs(amount),row.currency),{width:115,align:'right'});
        if(report.metadata.report_type==='ACCOUNT_STATEMENT'){
          doc.fontSize(7).fillColor('#6b7280').text(`Debit ${printableAmount(row.debit,row.currency)} · Credit ${printableAmount(row.credit,row.currency)} · Running balance ${row.running_balance===null||row.running_balance===undefined?'—':printableAmount(row.running_balance,row.currency)} · ${row.reconciliation_status||''}`);
        }else if(row.category||row.reconciliation_status){
          doc.fontSize(7).fillColor('#6b7280').text(`${row.category||'Uncategorised'} · ${row.reconciliation_status||''} · ${row.source_type||''}`);
        }
      }
    }

    const logoPath=path.join(__dirname,'..','public','Frame 1.png');
    const pages=doc.bufferedPageRange();
    for(let index=0;index<pages.count;index+=1){
      doc.switchToPage(index);
      if(fs.existsSync(logoPath)){try{doc.image(logoPath,42,28,{fit:[54,42]})}catch{}}
      doc.fontSize(10.5).fillColor('#111827').text(profile.legalName,106,28,{width:260});
      const identity=[profile.abn?`ABN ${profile.abn}`:null,profile.website||null,profile.email||null].filter(Boolean).join(' · ');
      doc.fontSize(7.2).fillColor('#6b7280').text(identity,106,44,{width:440});
      doc.fontSize(7.2).text(`${title} · ${report.metadata.from||'All'} to ${report.metadata.to||'Now'} · Generated ${generatedAt.toLocaleString('en-AU')} · ${reportId}`,42,78,{width:510});
      doc.moveTo(42,94).lineTo(553,94).strokeColor('#d1d5db').lineWidth(0.6).stroke();
      doc.moveTo(42,774).lineTo(553,774).strokeColor('#d1d5db').lineWidth(0.6).stroke();
      doc.fontSize(7.2).fillColor('#6b7280').text(`${profile.footer} · Page ${index+1} of ${pages.count}`,42,782,{width:510,align:'center'});
    }
    await logAudit(pool,audit(req,'FILTERED_REPORT_EXPORTED','finance_report',reportId,{filters:report.metadata,format:'PDF',pages:pages.count}));
    doc.end();
  }catch(error){
    if(!res.headersSent)return fail(res,error,'Failed to export filtered Finance PDF.');
    res.end();
  }
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
    const stored=typeof row.definition_json==='string'?JSON.parse(row.definition_json):row.definition_json;
    const overrides=definitionFrom(req.query||{});
    const definition={...stored,...overrides};
    return res.json(await buildReport(req,definition));
  }catch(error){return fail(res,error,'Failed to run saved Finance report.')}
};

module.exports._test={buildFilters,definitionFrom,createReportWorkbook};
