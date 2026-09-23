'use strict';

const pool=require('../config/db');
const privacy=require('../services/financePrivacyService');
const { FinanceError }=require('../services/financeDomain');
const { ensureFinanceSchema }=require('../services/financeSchema');
const money=require('../utils/money');

function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);
  return res.status(500).json({message,code:'FINANCE_SEARCH_ERROR'});
}
function queryText(value){return String(value||'').trim().slice(0,120)}
function canViewBusiness(req){
  const scope=req.bankingAccessScope;
  return Boolean(scope&&(scope.is_admin||scope.can_view_all_business||(Array.isArray(scope.allowed_business_account_ids)&&scope.allowed_business_account_ids.length)));
}
function like(q){return `%${q}%`}

exports.search=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const q=queryText(req.query.q);
    if(q.length<2)return res.json({query:q,groups:{transactions:[],accounts:[],statements:[],receipts:[],categories:[],supplier_bills:[]},total:0});
    const pattern=like(q);
    const visibility=privacy.visibilitySql('ba',req),visibilityParams=privacy.visibilityParams(req);
    const tasks=[
      pool.query(
        `SELECT bt.id,bt.transaction_date,bt.description,bt.reference,bt.merchant_name,bt.category,bt.debit,bt.credit,bt.currency,
                ba.nickname AS account_name,ba.institution
           FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE ${visibility} AND bt.archived_at IS NULL
            AND (bt.description LIKE ? OR bt.reference LIKE ? OR bt.merchant_name LIKE ? OR bt.category LIKE ? OR ba.nickname LIKE ? OR ba.institution LIKE ?)
          ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 8`,
        [...visibilityParams,pattern,pattern,pattern,pattern,pattern,pattern]
      ).then(([rows])=>rows),
      pool.query(
        `SELECT ba.id,ba.nickname,ba.institution,ba.account_type,ba.account_number_masked,ba.currency,ba.ownership_scope
           FROM bank_accounts ba
          WHERE ${visibility} AND ba.status<>'ARCHIVED'
            AND (ba.nickname LIKE ? OR ba.institution LIKE ? OR ba.account_number_masked LIKE ? OR ba.account_type LIKE ?)
          ORDER BY ba.status='ACTIVE' DESC,ba.nickname LIMIT 8`,
        [...visibilityParams,pattern,pattern,pattern,pattern]
      ).then(([rows])=>rows),
      pool.query(
        `SELECT sif.import_uid,sif.original_name,sif.source_format,sif.statement_start_date,sif.statement_end_date,
                ba.id AS bank_account_id,ba.nickname AS account_name,ba.institution
           FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
          WHERE ${visibility}
            AND (sif.original_name LIKE ? OR sif.import_uid LIKE ? OR ba.nickname LIKE ? OR ba.institution LIKE ?)
          ORDER BY COALESCE(sif.reviewed_at,sif.uploaded_at) DESC LIMIT 8`,
        [...visibilityParams,pattern,pattern,pattern,pattern]
      ).then(([rows])=>rows),
      pool.query(
        `SELECT sd.id,sd.original_name,sd.created_at,bt.id AS bank_transaction_id,bt.transaction_date,
                bt.merchant_name,bt.description,ba.nickname AS account_name
           FROM secure_documents sd
           JOIN bank_transactions bt ON sd.module='finance' AND sd.record_type='bank_transaction' AND CAST(sd.record_id AS UNSIGNED)=bt.id
           JOIN bank_accounts ba ON ba.id=bt.bank_account_id
          WHERE sd.deleted_at IS NULL AND ${visibility}
            AND (sd.original_name LIKE ? OR bt.merchant_name LIKE ? OR bt.description LIKE ? OR ba.nickname LIKE ?)
          ORDER BY sd.created_at DESC LIMIT 8`,
        [...visibilityParams,pattern,pattern,pattern,pattern]
      ).then(([rows])=>rows),
      pool.query(
        `SELECT c.id,c.name,c.scope,c.icon,c.gst_default,p.name AS parent_name
           FROM finance_system_categories c
           LEFT JOIN finance_system_categories p ON p.id=c.parent_id
          WHERE c.active=1 AND c.archived_at IS NULL
            AND ((c.scope IN ('BUSINESS','BOTH') AND c.owner_user_id IS NULL) OR (c.scope='PERSONAL' AND c.owner_user_id=?))
            AND (c.name LIKE ? OR p.name LIKE ?)
          ORDER BY c.name LIMIT 8`,
        [privacy.userId(req),pattern,pattern]
      ).then(([rows])=>rows)
    ];
    if(canViewBusiness(req)){
      tasks.push(pool.query(
        `SELECT sb.id,sb.bill_uid,sb.supplier_invoice_no,sb.issue_date,sb.due_date,sb.status,
                sb.total_amount,sb.paid_amount,(sb.total_amount-sb.paid_amount) AS balance,s.supplier_name
           FROM supplier_bills sb JOIN suppliers s ON s.id=sb.supplier_id
          WHERE sb.status<>'VOID' AND (sb.bill_uid LIKE ? OR sb.supplier_invoice_no LIKE ? OR s.supplier_name LIKE ? OR sb.job_reference LIKE ?)
          ORDER BY sb.issue_date DESC,sb.id DESC LIMIT 8`,
        [pattern,pattern,pattern,pattern]
      ).then(([rows])=>rows));
    }else tasks.push(Promise.resolve([]));

    const [transactions,accounts,statements,receipts,categories,supplierBills]=await Promise.all(tasks);
    const groups={transactions,accounts,statements,receipts,categories,supplier_bills:supplierBills};
    return res.json({
      query:q,groups,total:Object.values(groups).reduce((sum,rows)=>sum+rows.length,0),
      privacy:'Search results are limited by Finance account visibility and business-banking permission.'
    });
  }catch(error){return fail(res,error,'Failed to search Finance.')}
};

exports.companySummary=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    if(!canViewBusiness(req))throw new FinanceError('Company Finance is not available to this user.',403,'BUSINESS_FINANCE_FORBIDDEN');
    const [settingRows,bills,queries,assets]=await Promise.all([
      pool.query("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('base_currency','gst_registration')").then(([rows])=>rows),
      pool.query(
        `SELECT sb.id,sb.bill_uid,sb.supplier_invoice_no,sb.issue_date,sb.due_date,sb.status,sb.total_amount,sb.paid_amount,
                (sb.total_amount-sb.paid_amount) AS balance,s.supplier_name
           FROM supplier_bills sb JOIN suppliers s ON s.id=sb.supplier_id
          WHERE sb.status<>'VOID' ORDER BY COALESCE(sb.due_date,sb.issue_date),sb.id LIMIT 100`
      ).then(([rows])=>rows),
      pool.query(
        `SELECT id,query_uid,question,status,raised_at,assigned_to
           FROM accountant_queries WHERE status<>'RESOLVED' ORDER BY raised_at LIMIT 100`
      ).then(([rows])=>rows),
      pool.query(
        `SELECT id,asset_number,description,category,purchase_date,purchase_cost,accounting_status
           FROM assets WHERE COALESCE(accounting_status,'ACTIVE')<>'DISPOSED' ORDER BY purchase_date DESC,id DESC LIMIT 100`
      ).then(([rows])=>rows)
    ]);
    const settings=Object.fromEntries(settingRows.map(r=>[r.setting_key,r.setting_value]));
    const outstanding=bills.filter(b=>!['PAID','VOID'].includes(String(b.status).toUpperCase()));
    const payableCents=outstanding.reduce((sum,b)=>sum+money.toCents(b.balance||0),0n);
    const capexCents=assets.reduce((sum,a)=>sum+money.toCents(a.purchase_cost||0),0n);
    const currency=String(settings.base_currency||'AUD').toUpperCase();
    return res.json({
      currency,supplier_payables:money.fromCents(payableCents),supplier_bill_count:outstanding.length,
      pending_supplier_approvals:bills.filter(b=>String(b.status).toUpperCase()==='PENDING_APPROVAL').length,
      open_accountant_queries:queries.length,active_asset_count:assets.length,recorded_asset_cost:money.fromCents(capexCents),
      gst_registration:settings.gst_registration||'UNKNOWN',bills:bills.slice(0,20),accountant_queries:queries.slice(0,12),assets:assets.slice(0,12),
      receivables:{status:'NOT_CONFIGURED',note:'No dedicated customer receivables workflow is exposed here; no receivable balance is invented.'}
    });
  }catch(error){return fail(res,error,'Failed to load Company Finance summary.')}
};
