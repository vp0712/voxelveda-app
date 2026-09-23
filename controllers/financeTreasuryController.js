'use strict';

const pool=require('../config/db');
const { ensureFinanceSchema }=require('../services/financeSchema');
const { FinanceError }=require('../services/financeDomain');

function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
function round(v){return Math.round((n(v)+Number.EPSILON)*100)/100}
function dayDiff(value){
  if(!value)return null;
  const d=new Date(String(value).slice(0,10)+'T00:00:00Z');
  const t=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
  if(Number.isNaN(d.getTime()))return null;
  return Math.floor((t-d)/86400000);
}
function bucketAge(days){
  if(days===null)return 'UNKNOWN';
  if(days<0)return 'NOT_DUE';
  if(days<=30)return '0_30';
  if(days<=60)return '31_60';
  if(days<=90)return '61_90';
  return '90_PLUS';
}
function add(map,key,amount){map[key]=(map[key]||0)+n(amount)}
function fail(res,error){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error('Treasury Control failed',error);
  return res.status(500).json({message:'Failed to load Treasury & Working Capital Control.',code:'TREASURY_CONTROL_FAILED'});
}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const [settingRows,bankAccounts,businessFlow,bills,invoices]=await Promise.all([
      pool.query("SELECT setting_key,setting_value FROM app_settings WHERE setting_key='base_currency'").then(([rows])=>rows),
      pool.query(`SELECT id,nickname,institution,currency,account_type,available_balance,current_ledger_balance,status
                    FROM bank_accounts
                   WHERE status='ACTIVE' AND ownership_scope='BUSINESS'
                   ORDER BY currency,nickname`).then(([rows])=>rows),
      pool.query(`SELECT ba.currency,
          COALESCE(SUM(CASE WHEN bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 90 DAY)
                             AND bt.debit>0 AND bt.is_internal_transfer=0 AND bt.reconciliation_status<>'IGNORED'
                            THEN bt.debit ELSE 0 END),0) AS outflow_90d,
          COALESCE(SUM(CASE WHEN bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 90 DAY)
                             AND bt.credit>0 AND bt.is_internal_transfer=0 AND bt.reconciliation_status<>'IGNORED'
                            THEN bt.credit ELSE 0 END),0) AS inflow_90d
        FROM bank_accounts ba
        LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
       WHERE ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
       GROUP BY ba.currency ORDER BY ba.currency`).then(([rows])=>rows),
      pool.query(`SELECT sb.id,sb.bill_uid,sb.supplier_invoice_no,sb.issue_date,sb.due_date,sb.status,
                          sb.total_amount,sb.paid_amount,(sb.total_amount-sb.paid_amount) AS balance,s.supplier_name
                     FROM supplier_bills sb JOIN suppliers s ON s.id=sb.supplier_id
                    WHERE sb.status NOT IN ('PAID','VOID') AND (sb.total_amount-sb.paid_amount)>0.009
                    ORDER BY COALESCE(sb.due_date,sb.issue_date),sb.id LIMIT 500`).then(([rows])=>rows),
      pool.query(`SELECT i.id,i.invoice_no,i.customer_name,i.total,i.status,i.created_at,
                          COALESCE(p.paid_amount,0) AS paid_amount,
                          GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0) AS balance_due
                     FROM invoices i
                LEFT JOIN (SELECT invoice_id,SUM(amount) AS paid_amount FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
                    WHERE COALESCE(i.deleted,0)=0
                      AND LOWER(COALESCE(i.status,'')) NOT IN ('rejected','void')
                      AND GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0)>0.009
                    ORDER BY i.created_at,i.id LIMIT 500`).then(([rows])=>rows).catch(error=>{
        if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code))return [];
        throw error;
      })
    ]);
    const settings=Object.fromEntries(settingRows.map(r=>[r.setting_key,r.setting_value]));
    const baseCurrency=String(settings.base_currency||'AUD').toUpperCase();

    const cashByCurrency={};
    for(const a of bankAccounts){
      const c=String(a.currency||'AUD').toUpperCase();
      add(cashByCurrency,c,a.available_balance==null?a.current_ledger_balance:a.available_balance);
    }

    const flowByCurrency={};
    for(const row of businessFlow){
      const c=String(row.currency||'AUD').toUpperCase();
      const out90=n(row.outflow_90d),in90=n(row.inflow_90d),avgDaily=out90/90,avgMonthly=avgDaily*30.4375,cash=n(cashByCurrency[c]);
      flowByCurrency[c]={
        outflow_90d:round(out90),inflow_90d:round(in90),average_daily_outflow_90d:round(avgDaily),
        average_monthly_outflow_90d:round(avgMonthly),runway_days:avgDaily>0?Math.floor(cash/avgDaily):null,cash_balance:round(cash)
      };
    }
    for(const [c,cash] of Object.entries(cashByCurrency)){
      if(!flowByCurrency[c])flowByCurrency[c]={outflow_90d:0,inflow_90d:0,average_daily_outflow_90d:0,average_monthly_outflow_90d:0,runway_days:null,cash_balance:round(cash)};
    }

    const payableAging={NOT_DUE:0,'0_30':0,'31_60':0,'61_90':0,'90_PLUS':0,UNKNOWN:0};
    let payables=0,overduePayables=0,due30Payables=0;
    const payableRows=bills.map(b=>{
      const bal=n(b.balance),daysPast=dayDiff(b.due_date),bucket=bucketAge(daysPast);
      payableAging[bucket]+=bal;payables+=bal;
      if(daysPast!==null&&daysPast>0)overduePayables+=bal;
      if(daysPast!==null&&daysPast<=0&&daysPast>=-30)due30Payables+=bal;
      return {...b,balance:round(bal),days_past_due:daysPast,aging_bucket:bucket};
    });

    const receivableAging={'0_30':0,'31_60':0,'61_90':0,'90_PLUS':0,UNKNOWN:0};
    let receivables=0,weightedAgeNumerator=0,weightedAgeDenominator=0;
    const receivableRows=invoices.map(i=>{
      const bal=n(i.balance_due),age=Math.max(0,dayDiff(i.created_at)??0),rawBucket=bucketAge(age),bucket=rawBucket==='NOT_DUE'?'0_30':rawBucket;
      receivableAging[bucket]=(receivableAging[bucket]||0)+bal;
      receivables+=bal;weightedAgeNumerator+=bal*age;weightedAgeDenominator+=bal;
      return {...i,balance_due:round(bal),invoice_age_days:age,aging_bucket:bucket};
    });

    const topPayables=[...payableRows].sort((a,b)=>b.balance-a.balance).slice(0,10);
    const topReceivables=[...receivableRows].sort((a,b)=>b.balance_due-a.balance_due).slice(0,10);
    const baseCash=round(cashByCurrency[baseCurrency]||0);
    const coverageRatio=due30Payables>0?baseCash/due30Payables:null;

    return res.json({
      base_currency:baseCurrency,
      rules:{
        currency:'Business bank cash is reported separately by native currency. No silent FX conversion is performed.',
        receivables:'Customer invoices do not contain a contractual due date in the current ledger, so receivables are aged from invoice creation and are not assumed as forecast cash inflows.',
        runway:'Runway uses current business-bank cash divided by the last 90 days average daily non-transfer bank outflow. It is an operational indicator, not a solvency opinion.',
        payments:'Treasury Control is read-only and never executes supplier payments, bank transfers or automatic collections.'
      },
      bank_cash_by_currency:Object.fromEntries(Object.entries(cashByCurrency).map(([c,v])=>[c,round(v)])),
      bank_accounts:bankAccounts.map(a=>({...a,recorded_balance:round(a.available_balance==null?a.current_ledger_balance:a.available_balance)})),
      operating_flow_by_currency:flowByCurrency,
      working_capital:{
        currency:baseCurrency,receivables:round(receivables),payables:round(payables),net_receivable_position:round(receivables-payables),
        overdue_payables:round(overduePayables),supplier_obligations_due_30d:round(due30Payables),base_currency_cash:baseCash,
        due_30_cash_coverage_ratio:coverageRatio===null?null:Math.round(coverageRatio*100)/100,
        weighted_receivable_age_days:weightedAgeDenominator>0?Math.round(weightedAgeNumerator/weightedAgeDenominator):null
      },
      payable_aging:Object.fromEntries(Object.entries(payableAging).map(([k,v])=>[k,round(v)])),
      receivable_aging:Object.fromEntries(Object.entries(receivableAging).map(([k,v])=>[k,round(v)])),
      top_payables:topPayables,top_receivables:topReceivables,
      counts:{open_supplier_bills:payableRows.length,open_customer_invoices:receivableRows.length}
    });
  }catch(error){return fail(res,error)}
};
