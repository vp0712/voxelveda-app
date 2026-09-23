'use strict';

const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { ensureFinanceSchema }=require('../services/financeSchema');

function money(v){const n=Number(v||0);return Number.isFinite(n)?Math.round(n*100)/100:0}
function daysBetween(from,to){
  const a=new Date(String(from).slice(0,10)+'T00:00:00Z'),b=new Date(String(to).slice(0,10)+'T00:00:00Z');
  if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime()))return null;
  return Math.floor((b-a)/86400000);
}
function bucketByAge(days){
  if(days===null||days<0)return 'UNKNOWN';
  if(days<=30)return '0_30';
  if(days<=60)return '31_60';
  if(days<=90)return '61_90';
  return '90_PLUS';
}
function supplierBucket(dueDate,today){
  if(!dueDate)return 'NO_DUE_DATE';
  const delta=daysBetween(today,dueDate);
  if(delta===null)return 'UNKNOWN';
  if(delta<0)return 'OVERDUE';
  if(delta<=7)return 'DUE_7';
  if(delta<=30)return 'DUE_30';
  return 'FUTURE';
}
function sumRows(rows,key){return rows.reduce((s,r)=>s+money(r[key]),0)}
function concentration(rows,key,nameKey){
  const total=sumRows(rows,key);if(total<=0)return {top_name:null,top_amount:0,percent:0};
  const grouped={};for(const row of rows){const name=String(row[nameKey]||'Unknown');grouped[name]=(grouped[name]||0)+money(row[key])}
  const [name,amount]=Object.entries(grouped).sort((a,b)=>b[1]-a[1])[0]||[null,0];
  return {top_name:name,top_amount:money(amount),percent:Math.round((amount/total)*1000)/10};
}
function fail(res,error){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error('Counterparty Control failed',error);
  return res.status(500).json({message:'Failed to load Counterparty Control.',code:'FINANCE_COUNTERPARTY_CONTROL_FAILED'});
}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const [[baseSetting],invoiceRows,supplierRows]=await Promise.all([
      pool.query("SELECT setting_value FROM app_settings WHERE setting_key='base_currency' LIMIT 1").then(([rows])=>rows),
      pool.query(`SELECT i.id,i.invoice_no,i.customer_name,i.customer_email,i.total,i.status,i.created_at,
          COALESCE(p.paid_amount,0) AS paid_amount,
          GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0) AS balance_due,
          CASE WHEN COALESCE(p.paid_amount,0)<=0 THEN 'UNPAID'
               WHEN COALESCE(p.paid_amount,0)>=COALESCE(i.total,0) THEN 'PAID' ELSE 'PARTIAL' END AS payment_state
        FROM invoices i
        LEFT JOIN (SELECT invoice_id,SUM(amount) paid_amount FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
        WHERE COALESCE(i.deleted,0)=0 AND LOWER(COALESCE(i.status,'')) NOT IN ('rejected','void')
        ORDER BY balance_due DESC,i.created_at ASC,i.id ASC`).then(([rows])=>rows).catch(e=>['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(e?.code)?[]:Promise.reject(e)),
      pool.query(`SELECT sb.id,sb.bill_uid,sb.supplier_invoice_no,sb.issue_date,sb.due_date,sb.status,
          sb.total_amount,sb.paid_amount,GREATEST(sb.total_amount-sb.paid_amount,0) AS balance_due,
          s.id AS supplier_id,s.supplier_name
        FROM supplier_bills sb JOIN suppliers s ON s.id=sb.supplier_id
        WHERE sb.status<>'VOID'
        ORDER BY balance_due DESC,COALESCE(sb.due_date,sb.issue_date),sb.id`).then(([rows])=>rows)
    ]);
    const currency=String(baseSetting?.setting_value||'AUD').toUpperCase();
    const today=new Date().toISOString().slice(0,10);
    const customers=invoiceRows.map(r=>{
      const age=daysBetween(String(r.created_at||today).slice(0,10),today);
      return {...r,total:money(r.total),paid_amount:money(r.paid_amount),balance_due:money(r.balance_due),age_days:age,age_bucket:bucketByAge(age)};
    });
    const suppliers=supplierRows.map(r=>({...r,total_amount:money(r.total_amount),paid_amount:money(r.paid_amount),balance_due:money(r.balance_due),due_bucket:supplierBucket(r.due_date,today)}));
    const openCustomers=customers.filter(r=>r.balance_due>0.009);
    const openSuppliers=suppliers.filter(r=>r.balance_due>0.009&&!['PAID','VOID'].includes(String(r.status||'').toUpperCase()));
    const customerAging={};
    for(const k of ['0_30','31_60','61_90','90_PLUS','UNKNOWN'])customerAging[k]={amount:0,count:0};
    for(const r of openCustomers){const b=customerAging[r.age_bucket]||customerAging.UNKNOWN;b.amount+=r.balance_due;b.count++}
    const supplierAging={};
    for(const k of ['OVERDUE','DUE_7','DUE_30','FUTURE','NO_DUE_DATE','UNKNOWN'])supplierAging[k]={amount:0,count:0};
    for(const r of openSuppliers){const b=supplierAging[r.due_bucket]||supplierAging.UNKNOWN;b.amount+=r.balance_due;b.count++}
    for(const group of [customerAging,supplierAging])for(const x of Object.values(group))x.amount=money(x.amount);

    const people={};
    for(const r of customers){
      const key='CUSTOMER|'+String(r.customer_email||r.customer_name||r.id).toLowerCase();
      people[key]||={party_type:'CUSTOMER',name:r.customer_name||'Customer',email:r.customer_email||null,open_amount:0,total_value:0,paid_amount:0,record_count:0};
      const p=people[key];p.open_amount+=r.balance_due;p.total_value+=r.total;p.paid_amount+=r.paid_amount;p.record_count++;
    }
    for(const r of suppliers){
      const key='SUPPLIER|'+String(r.supplier_id);
      people[key]||={party_type:'SUPPLIER',name:r.supplier_name||'Supplier',email:null,open_amount:0,total_value:0,paid_amount:0,record_count:0};
      const p=people[key];p.open_amount+=r.balance_due;p.total_value+=r.total_amount;p.paid_amount+=r.paid_amount;p.record_count++;
    }
    const counterparties=Object.values(people).map(p=>({...p,open_amount:money(p.open_amount),total_value:money(p.total_value),paid_amount:money(p.paid_amount)})).sort((a,b)=>b.open_amount-a.open_amount);

    return res.json({
      currency,
      currency_note:'Legacy customer invoice and supplier bill ledgers do not store per-document currency. Counterparty Control therefore presents them in the configured Company base currency and never combines them with foreign-currency bank balances.',
      receivables:{
        open_balance:money(sumRows(openCustomers,'balance_due')),
        open_count:openCustomers.length,
        invoice_value:money(sumRows(customers,'total')),
        received:money(sumRows(customers,'paid_amount')),
        aging:customerAging,
        concentration:concentration(openCustomers,'balance_due','customer_name')
      },
      payables:{
        open_balance:money(sumRows(openSuppliers,'balance_due')),
        open_count:openSuppliers.length,
        bill_value:money(sumRows(suppliers,'total_amount')),
        paid:money(sumRows(suppliers,'paid_amount')),
        aging:supplierAging,
        concentration:concentration(openSuppliers,'balance_due','supplier_name')
      },
      counterparties,
      customer_invoices:customers.slice(0,250),
      supplier_bills:suppliers.slice(0,250),
      control_note:'This is a read-only relationship and working-capital control surface. Invoice receipts and supplier payments remain in their existing protected workflows.'
    });
  }catch(error){return fail(res,error)}
};
