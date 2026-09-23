'use strict';

const pool=require('../config/db');
const { ensureFinanceSchema }=require('../services/financeSchema');
const { FinanceError }=require('../services/financeDomain');

const REVENUE_TYPES=['SALE'];
const DIRECT_COST_TYPES=['EXPENSE','SUPPLIER_BILL','PAYROLL'];
const EXCLUDED_TYPES=['CUSTOMER_PAYMENT','SUPPLIER_PAYMENT','TRANSFER','ASSET_PURCHASE','OWNER_CONTRIBUTION','OWNER_DRAWING','JOURNAL_ADJUSTMENT','OTHER'];
const REVIEW_TYPES=['REFUND'];

function dateOnly(value){
  const text=String(value||'').trim();
  if(!text)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text+'T00:00:00Z')))throw new FinanceError('Date must use YYYY-MM-DD.',400,'INVALID_PROFITABILITY_DATE');
  return text;
}
function n(value){return Math.round(Number(value||0)*10000)/10000}
function pct(value){return Math.round(Number(value||0)*10)/10}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const [[settings]]=await pool.query("SELECT default_currency FROM finance_settings WHERE id=1 LIMIT 1");
    const [[fy]]=await pool.query("SELECT label,start_date,end_date FROM financial_years WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1");
    const today=new Date().toISOString().slice(0,10);
    const fallbackFrom=fy?.start_date?new Date(fy.start_date).toISOString().slice(0,10):today.slice(0,4)+'-01-01';
    const fallbackTo=fy?.end_date?new Date(fy.end_date).toISOString().slice(0,10):today;
    const from=dateOnly(req.query.from)||fallbackFrom;
    const to=dateOnly(req.query.to)||fallbackTo;
    if(from>to)throw new FinanceError('From date cannot be after To date.',400,'INVALID_PROFITABILITY_RANGE');

    const economic=[...REVENUE_TYPES,...DIRECT_COST_TYPES];
    const placeholders=arr=>arr.map(()=>'?').join(',');

    const [jobs]=await pool.query(
      `SELECT TRIM(job_reference) job_reference,
        COUNT(*) transaction_count,
        SUM(CASE WHEN transaction_type IN (${placeholders(REVENUE_TYPES)}) THEN net_amount ELSE 0 END) recognized_revenue,
        SUM(CASE WHEN transaction_type IN (${placeholders(DIRECT_COST_TYPES)}) THEN net_amount ELSE 0 END) direct_cost,
        SUM(CASE WHEN transaction_type IN (${placeholders(REVIEW_TYPES)}) THEN gross_amount ELSE 0 END) refund_review_amount,
        SUM(CASE WHEN transaction_type IN (${placeholders(EXCLUDED_TYPES)}) THEN gross_amount ELSE 0 END) excluded_flow_amount,
        SUM(CASE WHEN transaction_type IN (${placeholders(economic)}) THEN 1 ELSE 0 END) economic_transaction_count,
        MIN(effective_date) first_activity_date,MAX(effective_date) last_activity_date,
        COUNT(DISTINCT NULLIF(TRIM(party_name),'')) party_count
       FROM finance_transactions
       WHERE status='POSTED' AND effective_date BETWEEN ? AND ?
         AND job_reference IS NOT NULL AND TRIM(job_reference)<>''
       GROUP BY TRIM(job_reference)
       ORDER BY last_activity_date DESC,job_reference`,
      [...REVENUE_TYPES,...DIRECT_COST_TYPES,...REVIEW_TYPES,...EXCLUDED_TYPES,...economic,from,to]
    );

    const [categories]=await pool.query(
      `SELECT TRIM(job_reference) job_reference,COALESCE(NULLIF(TRIM(category),''),'Uncategorised') category,
        SUM(CASE WHEN transaction_type IN (${placeholders(REVENUE_TYPES)}) THEN net_amount ELSE 0 END) recognized_revenue,
        SUM(CASE WHEN transaction_type IN (${placeholders(DIRECT_COST_TYPES)}) THEN net_amount ELSE 0 END) direct_cost,
        COUNT(*) transaction_count
       FROM finance_transactions
       WHERE status='POSTED' AND effective_date BETWEEN ? AND ?
         AND job_reference IS NOT NULL AND TRIM(job_reference)<>''
         AND transaction_type IN (${placeholders(economic)})
       GROUP BY TRIM(job_reference),COALESCE(NULLIF(TRIM(category),''),'Uncategorised')
       ORDER BY job_reference,direct_cost DESC,recognized_revenue DESC`,
      [...REVENUE_TYPES,...DIRECT_COST_TYPES,from,to,...economic]
    );

    const [[coverage]]=await pool.query(
      `SELECT
        SUM(CASE WHEN job_reference IS NOT NULL AND TRIM(job_reference)<>'' THEN 1 ELSE 0 END) allocated_count,
        COUNT(*) economic_count,
        SUM(CASE WHEN (job_reference IS NULL OR TRIM(job_reference)='') AND transaction_type IN (${placeholders(REVENUE_TYPES)}) THEN net_amount ELSE 0 END) unallocated_revenue,
        SUM(CASE WHEN (job_reference IS NULL OR TRIM(job_reference)='') AND transaction_type IN (${placeholders(DIRECT_COST_TYPES)}) THEN net_amount ELSE 0 END) unallocated_direct_cost
       FROM finance_transactions
       WHERE status='POSTED' AND effective_date BETWEEN ? AND ?
         AND transaction_type IN (${placeholders(economic)})`,
      [...REVENUE_TYPES,...DIRECT_COST_TYPES,from,to,...economic]
    );

    const [unallocatedRows]=await pool.query(
      `SELECT id,transaction_uid,effective_date,transaction_type,description,party_name,category,net_amount,gross_amount
       FROM finance_transactions
       WHERE status='POSTED' AND effective_date BETWEEN ? AND ?
         AND transaction_type IN (${placeholders(economic)})
         AND (job_reference IS NULL OR TRIM(job_reference)='')
       ORDER BY effective_date DESC,id DESC LIMIT 100`,
      [from,to,...economic]
    );

    const categoryMap={};
    for(const row of categories){
      (categoryMap[row.job_reference] ||= []).push({
        category:row.category,
        recognized_revenue:n(row.recognized_revenue),
        direct_cost:n(row.direct_cost),
        transaction_count:Number(row.transaction_count||0)
      });
    }
    const normalized=jobs.map(row=>{
      const revenue=n(row.recognized_revenue),cost=n(row.direct_cost),margin=n(revenue-cost);
      return {...row,
        transaction_count:Number(row.transaction_count||0),
        economic_transaction_count:Number(row.economic_transaction_count||0),
        party_count:Number(row.party_count||0),
        recognized_revenue:revenue,direct_cost:cost,contribution_margin:margin,
        contribution_margin_percent:revenue>0?pct(margin/revenue*100):null,
        refund_review_amount:n(row.refund_review_amount),excluded_flow_amount:n(row.excluded_flow_amount),
        categories:(categoryMap[row.job_reference]||[]).slice(0,20)
      };
    });
    const totals=normalized.reduce((a,r)=>{a.recognized_revenue+=r.recognized_revenue;a.direct_cost+=r.direct_cost;a.contribution_margin+=r.contribution_margin;a.refund_review_amount+=r.refund_review_amount;a.excluded_flow_amount+=r.excluded_flow_amount;return a;},{recognized_revenue:0,direct_cost:0,contribution_margin:0,refund_review_amount:0,excluded_flow_amount:0});
    Object.keys(totals).forEach(k=>totals[k]=n(totals[k]));
    const economicCount=Number(coverage?.economic_count||0),allocated=Number(coverage?.allocated_count||0);

    return res.json({
      period:{from,to,financial_year_label:fy?.label||null},
      currency:String(settings?.default_currency||'AUD').toUpperCase(),
      accounting_basis:'Posted Finance transactions in the configured accounting currency.',
      margin_rule:'Contribution margin = posted SALE net amount minus posted EXPENSE, SUPPLIER_BILL and PAYROLL net amounts carrying the same job reference.',
      exclusion_rule:'Customer/supplier payments, transfers, asset purchases, owner flows, journal adjustments and OTHER are excluded from margin to avoid cash-settlement or balance-sheet double counting. REFUND is shown separately for review because direction is context-dependent.',
      overhead_rule:'Unallocated and company-wide overhead is not silently assigned to jobs. This is job-coded contribution margin, not statutory net profit.',
      jobs:normalized,totals,
      allocation:{economic_transaction_count:economicCount,allocated_transaction_count:allocated,unallocated_transaction_count:Math.max(0,economicCount-allocated),allocation_coverage_percent:economicCount?pct(allocated/economicCount*100):100,unallocated_revenue:n(coverage?.unallocated_revenue),unallocated_direct_cost:n(coverage?.unallocated_direct_cost)},
      unallocated_evidence:unallocatedRows.map(r=>({...r,net_amount:n(r.net_amount),gross_amount:n(r.gross_amount)}))
    });
  }catch(error){
    if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
    console.error('Failed to load Job Profitability Control',error);
    return res.status(500).json({message:'Failed to load Job Profitability Control.',code:'JOB_PROFITABILITY_FAILED'});
  }
};
