'use strict';
const assert=require('node:assert/strict');
let state={invoices:[],items:[],payments:[],audit:[],customers:[],sequence:1},rollbackCount=0,failAudit=false;
const copy=value=>JSON.parse(JSON.stringify(value));
async function query(sql,values=[]){
 const q=sql.replace(/\s+/g,' ').trim();
 if(/^(CREATE|ALTER)/.test(q))return [{}];
 if(q.startsWith('SELECT id,status FROM email_queue'))return [[]];
 if(q.startsWith('UPDATE email_queue SET status='))return [{affectedRows:0}];
 if(q.startsWith('SELECT id,invoice_no,total,request_payload_sha256 FROM invoices'))return [[...state.invoices.filter(row=>row.request_key===values[0]).map(copy)]];
 if(q.startsWith('SELECT * FROM invoices WHERE id='))return [[...state.invoices.filter(row=>row.id===values[0]&&(!q.includes('IFNULL(deleted')||!row.deleted)).map(copy)]];
 if(q.startsWith('SELECT i.*,CASE'))return [[...state.invoices.filter(row=>row.id===values[0]&&!row.deleted).map(row=>{const paid=state.payments.filter(p=>p.invoice_id===row.id&&!p.voided_at).reduce((n,p)=>n+p.amount,0);return {...copy(row),paid_amount:paid,balance_due:row.total-paid};})]];
 if(q.startsWith('SELECT id,amount,voided_at FROM invoice_payments'))return [[...state.payments.filter(row=>row.invoice_id===values[0]&&row.request_key===values[1]).map(copy)]];
 if(q.startsWith('SELECT id FROM invoices WHERE invoice_no='))return [[...state.invoices.filter(row=>row.invoice_no===values[0]&&row.id!==values[1]&&!row.deleted).map(copy)]];
 if(q.startsWith('INSERT INTO invoices(')){
  const [reference,name,email,description,quantity,unit_price,gst_rate,total,request_key,request_payload_sha256]=values;
  if(state.invoices.some(row=>row.request_key===request_key))throw Object.assign(new Error('Duplicate request.'),{code:'ER_DUP_ENTRY'});
  const id=state.sequence++;state.invoices.push({id,invoice_no:reference,customer_name:name,customer_email:email,description,quantity,unit_price,gst_rate,total,request_key,request_payload_sha256,status:'draft',deleted:0,created_at:'2026-10-11'});return [{insertId:id,affectedRows:1}];
 }
 if(q.startsWith('INSERT INTO invoice_items(')){const [invoice_id,description,quantity,unit_price,amount]=values;const id=state.sequence++;state.items.push({id,invoice_id,description,quantity,unit_price,amount,deleted:0});return [{insertId:id}];}
 if(q.startsWith('SELECT * FROM invoice_items WHERE invoice_id='))return [[...state.items.filter(row=>row.invoice_id===values[0]&&!row.deleted).map(copy)]];
 if(q.startsWith('UPDATE invoice_items SET description=')){const row=state.items.find(row=>row.id===values[4]);Object.assign(row,{description:values[0],quantity:values[1],unit_price:values[2],amount:values[3],deleted:0});return [{affectedRows:1}];}
 if(q.startsWith('UPDATE invoice_items SET deleted=')){state.items.find(row=>row.id===values[0]).deleted=1;return [{affectedRows:1}];}
 if(q.startsWith('UPDATE invoices SET invoice_no=')){const row=state.invoices.find(row=>row.id===values[9]);Object.assign(row,{invoice_no:values[0],customer_name:values[1],customer_email:values[2],description:values[3],quantity:values[4],unit_price:values[5],gst_rate:values[6],total:values[7],status:values[8],document_revision:Number(row.document_revision || 1)+1});return [{affectedRows:1}];}
 if(q.startsWith('UPDATE invoices SET status=?')){state.invoices.find(row=>row.id===values[1]).status=values[0];return [{affectedRows:1}];}
 if(q.startsWith("UPDATE invoices SET status='approved'")){state.invoices.find(row=>row.id===values[0]).status='approved';return [{affectedRows:1}];}
 if(q.startsWith('UPDATE invoices SET deleted=')){state.invoices.find(row=>row.id===values[1]).deleted=values[0];return [{affectedRows:1}];}
 if(q.startsWith('INSERT INTO invoice_activity(')){if(failAudit)throw new Error('Fixture audit failure');const [invoice_id,action_type,notes,created_by]=values;state.audit.push({invoice_id,action_type,notes,created_by});return [{insertId:state.audit.length}];}
 if(q.startsWith('SELECT id FROM customers'))return [[]];
 if(q.startsWith('INSERT INTO customers')){state.customers.push({name:values[0],email:values[1]});return [{insertId:state.customers.length}];}
 if(q.startsWith('SELECT id,amount,request_payload_sha256,voided_at FROM invoice_payments'))return [[...state.payments.filter(row=>row.request_key===values[0]).map(copy)]];
 if(q.startsWith('SELECT COALESCE(SUM(amount),0) amount'))return [[{amount:state.payments.filter(row=>row.invoice_id===values[0]&&!row.voided_at).reduce((sum,row)=>sum+row.amount,0)}]];
 if(q.startsWith('INSERT INTO invoice_payments(')){const [invoice_id,amount,payment_date,method,reference,notes,created_by,request_key,request_payload_sha256]=values;const id=state.sequence++;state.payments.push({id,invoice_id,amount,payment_date,method,reference,notes,created_by,request_key,request_payload_sha256,voided_at:null});return [{insertId:id}];}
 if(q.startsWith('SELECT * FROM invoice_payments WHERE id='))return [[...state.payments.filter(row=>row.id===values[0]&&row.invoice_id===values[1]).map(copy)]];
 if(q.startsWith('UPDATE invoice_payments SET voided_at=')){const row=state.payments.find(row=>row.id===values[1]);row.voided_at='fixture-time';row.voided_by=values[0];return [{affectedRows:1}];}
 throw new Error('Unexpected fixture SQL: '+q);
}
const db={query,async getConnection(){let before;return {query,async beginTransaction(){before=copy(state);},async commit(){before=null;},async rollback(){if(before){state=before;before=null;}rollbackCount++;},release(){}};}};
const dbPath=require.resolve('../config/db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
const controller=require('../controllers/invoiceController');
async function call(method,body,key='fixture-request'){
 const req={body,user:{id:9,role:'admin'},get:name=>name==='Idempotency-Key'?key:undefined};const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
 await controller[method](req,res);return res;
}
async function receipt(id,key,user={id:9,role:'admin'}){const req={params:{id:String(id)},user,get:name=>name==='Idempotency-Key'?key:undefined},res={statusCode:200,status(code){this.statusCode=code;return this;},set(){return this;},json(value){this.body=value;return this;}};await controller.paymentReceipt(req,res);return res;}
async function main(){
 const body={customer_name:'Fixture Customer',customer_email:'fixture@example.invalid',gst_rate:10,items:[{description:'Fixture line',quantity:2,unit_price:20},{description:'Fixture second line',quantity:1,unit_price:10}]};
 const invalid=await call('createManualInvoice',{...body,items:[{description:'Bad fixture',quantity:1,unit_price:Infinity}]});assert.equal(invalid.statusCode,422);assert.ok(invalid.body.errors['items.0.unit_price']);assert.equal(state.invoices.length,0);
 const first=await call('createManualInvoice',body);assert.equal(first.statusCode,201);const id=first.body.invoice_id;assert.equal(state.invoices.length,1);assert.equal(state.items.length,2);assert.equal(state.audit[0].created_by,9);assert.equal(state.invoices[0].total,55);
 const duplicate=await call('createManualInvoice',body);assert.equal(duplicate.body.existing,true);assert.equal(duplicate.body.invoice_id,id);assert.equal(state.invoices.length,1);assert.equal(state.audit.length,1);
 const conflict=await call('createManualInvoice',{...body,customer_name:'Changed fixture'});assert.equal(conflict.statusCode,409);assert.equal(state.invoices.length,1);
 failAudit=true;const failed=await call('createManualInvoice',body,'fixture-failed-audit');assert.equal(failed.statusCode,500);assert.equal(state.invoices.length,1);assert.equal(state.items.length,2);assert.equal(state.customers.length,1);failAudit=false;
 const approved=await call('approveInvoice',{invoice_id:id});assert.equal(approved.body.status,'approved');assert.equal(state.invoices[0].status,'approved');
 const oldId=state.items[0].id;const edit=await call('editInvoice',{...body,invoice_id:id,invoice_no:first.body.invoice_no,status:'approved',items:[{description:'Updated fixture line',quantity:2,unit_price:25}]});assert.equal(edit.body.status,'draft');assert.equal(state.invoices[0].total,55);assert.equal(state.invoices[0].document_revision,2);assert.equal(state.items[0].id,oldId);assert.equal(state.items[1].deleted,1);assert.equal(state.items.length,2);assert.match(state.audit.at(-1).notes,/Updated fixture line/);
 const staleEdit=await call('editInvoice',{...body,invoice_id:id,invoice_no:first.body.invoice_no,status:'draft',expected_revision:1});assert.equal(staleEdit.statusCode,409);assert.equal(staleEdit.body.code,'INVOICE_REVISION_CONFLICT');assert.equal(state.invoices[0].document_revision,2);
 const draftPayment=await call('recordInvoicePayment',{invoice_id:id,amount:10,payment_date:'2026-10-11'},'draft-payment');assert.equal(draftPayment.statusCode,409);assert.equal(state.payments.length,0);
 await call('approveInvoice',{invoice_id:id});
 const payment=await call('recordInvoicePayment',{invoice_id:id,amount:30,payment_date:'2026-10-11',reference:'FIXTURE-PAY-1'},'fixture-payment');assert.equal(payment.body.balance_due,25);assert.equal(state.payments.length,1);
 const paymentAgain=await call('recordInvoicePayment',{invoice_id:id,amount:30,payment_date:'2026-10-11',reference:'FIXTURE-PAY-1'},'fixture-payment');assert.equal(paymentAgain.body.existing,true);assert.equal(state.payments.length,1);
 const confirmed=await receipt(id,'fixture-payment');assert.equal(confirmed.body.confirmed,true);assert.equal(confirmed.body.payment_id,payment.body.payment_id);assert.equal(confirmed.body.invoice.balance_due,25);
 assert.equal((await receipt(id,'not-committed')).body.confirmed,false);assert.equal((await receipt(id,'fixture-payment',{id:10,role:'admin'})).body.confirmed,false);assert.equal((await receipt(id,undefined)).statusCode,422);assert.equal(state.payments.length,1);
 const overpay=await call('recordInvoicePayment',{invoice_id:id,amount:26,payment_date:'2026-10-11'},'fixture-overpay');assert.equal(overpay.statusCode,422);assert.equal(state.payments.length,1);
 const settle=await call('markInvoicePaid',{invoice_id:id},'fixture-settle');assert.equal(settle.body.status,'paid');assert.equal(state.payments.length,2);assert.equal(state.payments[1].amount,25);
 const illegalEdit=await call('editInvoice',{...body,invoice_id:id,invoice_no:first.body.invoice_no,status:'paid'});assert.equal(illegalEdit.statusCode,409);
 const voided=await call('deleteInvoicePayment',{invoice_id:id,payment_id:payment.body.payment_id});assert.equal(voided.body.status,'approved');assert.equal(state.payments.length,2);assert.equal(state.payments[0].voided_by,9);assert.ok(state.payments[0].voided_at);
 assert.equal((await receipt(id,'fixture-payment')).body.voided,true);
 await call('deleteInvoice',{invoice_id:id});assert.equal(state.invoices[0].deleted,1);assert.equal(state.items.length,2);await call('restoreInvoice',{invoice_id:id});assert.equal(state.invoices[0].deleted,0);
 assert.ok(rollbackCount>0);assert.ok(state.audit.every(row=>row.created_by===9));
 console.log('Invoice regression tests passed: field validation; durable idempotent manual creation; reused-key conflict; full rollback on audit failure; approval authority transitions; approved edit reapproval; stable item IDs and archived removed lines; atomic payments and duplicate prevention; overpayment rejection; historical payment void; invoice archive/restore.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
