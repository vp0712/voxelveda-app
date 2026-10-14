'use strict';
const money=require('../utils/money');
const {createHash}=require('node:crypto');
const {DateTime}=require('luxon');
const {companyTimezone}=require('./attendanceTimeService');
function issueDate(invoice){const value=invoice.issue_date||invoice.created_at;if(!value)return null;const text=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;const date=value instanceof Date?DateTime.fromJSDate(value,{zone:'utc'}):DateTime.fromISO(text.replace(' ','T'),{zone:'utc'});return date.isValid?date.setZone(companyTimezone()).toISODate():null;}
const REVIEW_LABEL='Payment details require review';
function amount(value){if(value===null||value===undefined||String(value).trim()===''||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;try{return money.toCents(value);}catch{return null;}}
const decimal=value=>value===null?null:money.fromCents(value);
function paymentSql(){
 const recorded='COALESCE(p.recorded_payment_amount,0)';
 const review=`(i.total IS NULL OR COALESCE(p.invalid_payment_count,0)>0 OR ${recorded}>i.total OR (LOWER(COALESCE(i.status,''))='paid' AND ${recorded}<i.total))`;
 const paid=`CASE WHEN ${review} THEN NULL ELSE ${recorded} END`,due=`CASE WHEN ${review} THEN NULL ELSE i.total-${recorded} END`;
 return {recorded,review,paid,due,state:`CASE WHEN ${review} THEN 'review_required' WHEN i.total>0 AND ${recorded}=i.total THEN 'paid' WHEN ${recorded}>0 THEN 'partial' ELSE 'unpaid' END`,join:`LEFT JOIN (SELECT invoice_id,SUM(amount) AS recorded_payment_amount,COUNT(*) AS recorded_payment_count,SUM(amount IS NULL OR amount<=0) AS invalid_payment_count FROM invoice_payments WHERE voided_at IS NULL GROUP BY invoice_id) p ON p.invoice_id=i.id`};
}
function receivableSelect(where='WHERE i.deleted=0 OR i.deleted IS NULL'){
 const s=paymentSql();return `SELECT i.*,${s.paid} AS paid_amount,${s.due} AS balance_due,${s.state} AS payment_state,${s.recorded} AS recorded_payment_amount,COALESCE(p.recorded_payment_count,0) AS recorded_payment_count,COALESCE(p.invalid_payment_count,0) AS invalid_payment_count,${s.review} AS payment_review_required FROM invoices i ${s.join} ${where}`;
}
function paymentSummary(invoice,payments){
 const total=amount(invoice.total);let recorded,invalid=false,count;
 if(Array.isArray(payments)){recorded=0n;count=0;for(const p of payments){if(p.voided_at)continue;count++;const n=amount(p.amount);if(n===null||n<=0n)invalid=true;else recorded+=n;}}
 else{recorded=amount(invoice.recorded_payment_amount??invoice.paid_amount);count=invoice.recorded_payment_count==null?null:Number(invoice.recorded_payment_count);invalid=Number(invoice.invalid_payment_count)>0;}
 const review=total===null||recorded===null||invalid||recorded>total||(String(invoice.status).toLowerCase()==='paid'&&recorded<total);
 const state=review?'review_required':total>0n&&recorded===total?'paid':recorded>0n?'partial':'unpaid';
 return {currency:'AUD',document_status:String(invoice.status||'unknown'),payment_state:state,payment_label:review?REVIEW_LABEL:state==='partial'?'Partially paid':state==='paid'?'Paid':'Unpaid',total:decimal(total),paid_amount:review?null:decimal(recorded),balance_due:review?null:decimal(total-recorded),recorded_payment_amount:invalid?null:decimal(recorded),recorded_payment_count:count,review_required:review,review_reason:review?(invalid?'The payment register contains an invalid amount.':total===null?'The saved invoice total is unavailable.':recorded===null?'Payment records could not be confirmed.':recorded>total?'Recorded payments exceed the saved total.':'The saved paid status is not supported by complete payment records.'):null};
}
function applyPaymentSummary(invoice){const s=paymentSummary(invoice);return {...invoice,paid_amount:s.paid_amount===null?null:Number(s.paid_amount),balance_due:s.balance_due===null?null:Number(s.balance_due),payment_state:s.payment_state,payment_review_required:s.review_required,payment_summary:s};}
function invoiceSummary(invoice,items=[],payments){
 const payment=paymentSummary(invoice,payments),rate=invoice.gst_rate==null||invoice.gst_rate===''?null:Number(invoice.gst_rate),validRate=rate!==null&&amount(invoice.gst_rate)!==null&&Number.isFinite(rate)&&rate>=0&&rate<=100;
 const source=items.length?items:[{description:invoice.description,quantity:invoice.quantity,unit_price:invoice.unit_price}];
 let valid=true,subtotal=0n;
 const lines=source.map(row=>{const quantity=row.qty??row.quantity,price=amount(row.unit_price);let line=amount(row.total??row.amount);
  if(line===null&&row.total==null&&row.amount==null&&price!==null){try{line=money.toCents(money.multiplyQuantity(decimal(price),quantity));}catch{}}
  if(line===null||price===null||quantity==null||!/^\d+(?:\.\d{1,3})?$/.test(String(quantity))||Number(quantity)<=0)valid=false;
  if(line!==null)subtotal+=line;
  return {id:row.id??null,description:row.description||row.product_name||'Description not recorded',quantity:quantity??null,unit:row.unit||row.unit_label||null,unit_price:decimal(price),tax_rate:validRate?rate:null,amount:decimal(line)};
 });
 const explicitInclusive=invoice.tax_inclusive===true||invoice.tax_inclusive===1||invoice.tax_inclusive==='1'||invoice.tax_treatment==='inclusive';
 let tax=null,net=valid?subtotal:null;
 if(valid&&validRate){if(explicitInclusive){tax=money.toCents(money.gstFromGross(decimal(subtotal),String(rate)));net=subtotal-tax;}else tax=money.toCents(money.percentageOf(decimal(subtotal),String(rate)));}
 const total=amount(invoice.total),expected=net===null||tax===null?null:net+tax,consistent=total!==null&&expected!==null&&total===expected;
 return {...payment,subtotal:decimal(net),tax_amount:decimal(tax),tax_rate:validRate?rate:null,tax_treatment:explicitInclusive?'inclusive':'exclusive',tax_verified:consistent,tax_review_reason:consistent?null:'Stored line items, tax treatment and total require review; no amounts have been changed.',lines};
}
function version(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function paymentVersion(invoice,payments){return version({id:Number(invoice.id),status:invoice.status,total:invoice.total,revision:invoice.document_revision,payments:payments.map(p=>({id:p.id,amount:p.amount,voided_at:p.voided_at||null})).sort((a,b)=>Number(a.id)-Number(b.id))});}
function publicActivity(row){
 const labels={created:'Invoice created',edited:'Invoice edited',approved:'Invoice approved',sent:'Invoice sent',paid:'Marked paid (historical)',payment:'Payment recorded',payment_voided:'Payment voided',payment_review_resolved:'Payment review resolved',archived:'Invoice archived',restored:'Invoice restored',rejected:'Invoice rejected',email_queued:'Invoice PDF queued'};
 let data;try{data=JSON.parse(row.notes);}catch{}
 let summary=labels[row.action_type]||'Invoice activity';
 if(row.action_type==='payment'&&data&&amount(data.amount)!==null)summary+=` · AUD ${decimal(amount(data.amount))}`;
 if(['payment_review_resolved','payment_voided'].includes(row.action_type)&&data)summary+=` · ${data.reason||''}`;
 if(!data&&typeof row.notes==='string'&&!/^[{\[]/.test(row.notes.trim())&&!['email_queued','sent'].includes(row.action_type))summary=row.notes.slice(0,500);
 return {id:row.id,action_type:row.action_type,action_label:labels[row.action_type]||'Invoice activity',created_at:row.created_at,actor_name:row.actor_name||null,summary};
}
module.exports={amount,decimal,paymentSql,receivableSelect,paymentSummary,applyPaymentSummary,invoiceSummary,version,paymentVersion,publicActivity,issueDate,REVIEW_LABEL};
