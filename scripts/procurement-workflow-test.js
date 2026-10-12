'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const money = require('../utils/money');
function plain(value){return JSON.parse(JSON.stringify(value));}
function fixture(){
  const state={po:{id:1,status:'APPROVED',approval_instance_id:'approval-original-1'},item:{id:1,purchase_order_id:1,quantity:10,received_quantity:8,description:'Original material',unit_price:'1.01'},receipts:[],receiptItems:[],inspections:[],requisitions:[],requisitionItems:[],audits:[],notifications:[],queries:[],next:1,auditFailure:false,approved:true};
  async function query(sql,params=[],transaction=false){
    const text=sql.replace(/\s+/g,' ').trim();state.queries.push({sql:text,params:[...params],transaction});
    assert(!/supplier_bills|procurement_bill_matches|finance_/.test(text),'an original procurement workflow must not load a retired Finance table');
    if(/SELECT \* FROM purchase_orders WHERE id/.test(text))return [[...(params[0]===1?[plain(state.po)]:[])]];
    if(/SELECT status FROM workflow_instances/.test(text))return [[{status:state.approved?'APPROVED':'PENDING'}]];
    if(/SELECT \* FROM purchase_order_items/.test(text))return [[plain(state.item)]];
    if(/INSERT INTO procurement_sequences/.test(text))return[{affectedRows:1}];
    if(/SELECT next_value FROM procurement_sequences/.test(text))return[[{next_value:state.next}]];
    if(/UPDATE procurement_sequences/.test(text)){state.next=params[0];return[{affectedRows:1}];}
    if(/INSERT INTO goods_receipts/.test(text)){assert(transaction);const row={id:state.receipts.length+1,receipt_no:params[0],purchase_order_id:params[1],received_date:params[2],status:'PENDING_INSPECTION'};state.receipts.push(row);return[{insertId:row.id}];}
    if(/INSERT INTO goods_receipt_items/.test(text)){assert(transaction);state.receiptItems.push({id:state.receiptItems.length+1,goods_receipt_id:params[0],purchase_order_item_id:params[1],quantity_received:params[2]});return[{insertId:state.receiptItems.length}];}
    if(/UPDATE purchase_order_items SET received_quantity/.test(text)){assert(transaction);state.item.received_quantity+=params[0];return[{affectedRows:1}];}
    if(/SELECT SUM\(GREATEST\(quantity - received_quantity/.test(text))return [[{outstanding:Math.max(0,state.item.quantity-state.item.received_quantity)}]];
    if(/UPDATE purchase_orders SET status/.test(text)){assert(transaction);state.po.status=params[0];return[{affectedRows:1}];}
    if(/SELECT id, role, permissions/.test(text))return [[{id:4,permissions:['INSPECT_GOODS_RECEIPT']}]];
    if(/SELECT \* FROM goods_receipts WHERE id/.test(text))return[[...state.receipts.filter((row)=>row.id===params[0]).map(plain)]];
    if(/SELECT id FROM receiving_inspections/.test(text))return [[...state.inspections.filter((row)=>row.goods_receipt_id===params[0]).map(plain)]];
    if(/SELECT SUM\(quantity_received\)/.test(text))return [[{quantity:state.receiptItems.filter((row)=>row.goods_receipt_id===params[0]).reduce((sum,row)=>sum+row.quantity_received,0)}]];
    if(/INSERT INTO receiving_inspections/.test(text)){assert(transaction);const row={id:state.inspections.length+1,goods_receipt_id:params[1],result:params[2],accepted_quantity:params[3],rejected_quantity:params[4]};state.inspections.push(row);return[{insertId:row.id}];}
    if(/UPDATE goods_receipts SET status/.test(text)){assert(transaction);state.receipts.find((row)=>row.id===params[1]).status=params[0];return[{affectedRows:1}];}
    if(/UPDATE goods_receipt_items SET condition_status/.test(text)){assert(transaction);return[{affectedRows:1}];}
    if(/INSERT INTO purchase_requisitions/.test(text)){assert(transaction);const row={id:state.requisitions.length+1,requisition_no:params[0],estimated_total:params[6]};state.requisitions.push(row);return[{insertId:row.id}];}
    if(/INSERT INTO purchase_requisition_items/.test(text)){assert(transaction);state.requisitionItems.push({purchase_requisition_id:params[0],quantity:params[4],estimated_unit_price:params[6]});return[{insertId:state.requisitionItems.length}];}
    throw new Error('Unexpected procurement fixture SQL: '+text);
  }
  let queue=Promise.resolve();const db={query,async getConnection(){let transaction=false,snapshot,unlock;return{query:(sql,params)=>query(sql,params,transaction),async beginTransaction(){const previous=queue;queue=new Promise((resolve)=>unlock=resolve);await previous;snapshot=plain({po:state.po,item:state.item,receipts:state.receipts,receiptItems:state.receiptItems,inspections:state.inspections,requisitions:state.requisitions,requisitionItems:state.requisitionItems,audits:state.audits,notifications:state.notifications,next:state.next});transaction=true;},async commit(){transaction=false;unlock();},async rollback(){if(transaction){Object.assign(state,snapshot);transaction=false;unlock();}},release(){assert(!transaction);}};}};
  const dependencies={'../config/db':db,'../utils/money':money,'../utils/dateOnly':require('../utils/dateOnly'),'./authorizationService':{hasPermission:(user,permission)=>user.permissions.includes(permission)},'./auditService':{async logAudit(_db,entry){if(state.auditFailure)throw new Error('Injected audit failure');state.audits.push(plain(entry));}},'./notificationService':{async createNotification(_db,entry){state.notifications.push(plain(entry));}},'./procurementSchema':{async ensureProcurementSchema(){}},'./procurementCatalogData':{},'./workflowService':{}};
  const module={exports:{}};const filename=path.join(__dirname,'../services/procurementService.js');new vm.Script(fs.readFileSync(filename,'utf8'),{filename}).runInNewContext({module,exports:module.exports,Date,Buffer,require(name){if(name==='crypto')return require('crypto');if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected dependency '+name);}});
  const user={id:99},req={user,get:()=>null};return{state,service:module.exports,context:{user,req}};
}
(async()=>{
  const {state,service,context}=fixture();
  const requisition={title:'Original procurement',items:[{description:'Original material',quantity:'1.005',estimated_unit_price:'1.00'}]};
  await assert.rejects(service.createRequisition({...context,input:{...requisition,items:[{description:'Original material',quantity:'1.0001'}]}}),(error)=>error.code==='INVALID_NUMBER');
  await assert.rejects(service.createRequisition({...context,input:{...requisition,items:[{description:'Original material',quantity:1,estimated_unit_price:'1.001'}]}}),(error)=>error.code==='INVALID_NUMBER');assert.equal(state.queries.length,0);
  const created=await service.createRequisition({...context,input:requisition});assert.equal(created.estimated_total,'1.01','decimal quantity times cents rounds once without binary float drift');assert.equal(state.requisitions[0].estimated_total,'1.01');assert.equal(state.requisitionItems[0].quantity,1.005);
  const input={purchase_order_id:1,received_date:'2026-10-11',items:[{purchase_order_item_id:1,quantity_received:2}]};
  state.approved=false;await assert.rejects(service.receiveGoods({...context,input}),(error)=>error.code==='APPROVAL_REQUIRED');state.approved=true;
  await assert.rejects(service.receiveGoods({...context,input:{...input,items:[{purchase_order_item_id:1,quantity_received:3}]}}),(error)=>error.code==='OVER_RECEIPT');assert.equal(state.item.received_quantity,8);assert.equal(state.receipts.length,0);
  await assert.rejects(service.receiveGoods({...context,input:{...input,received_date:'2026-02-30'}}),(error)=>error.code==='DATE_REQUIRED');
  await assert.rejects(service.receiveGoods({...context,input:{...input,items:[input.items[0],input.items[0]]}}),(error)=>error.code==='DUPLICATE_RECEIPT_LINE');
  const beforeFailure=plain({item:state.item,receipts:state.receipts,receiptItems:state.receiptItems});state.auditFailure=true;await assert.rejects(service.receiveGoods({...context,input}),/Injected audit failure/);assert.deepEqual({item:state.item,receipts:state.receipts,receiptItems:state.receiptItems},beforeFailure);state.auditFailure=false;
  const results=await Promise.allSettled([service.receiveGoods({...context,input}),service.receiveGoods({...context,input})]);assert.equal(results.filter((entry)=>entry.status==='fulfilled').length,1);assert.equal(state.item.received_quantity,10);assert.equal(state.receipts.length,1);assert.equal(state.po.status,'RECEIVED');assert.equal(state.notifications.length,1);
  await assert.rejects(service.inspectReceipt({...context,receiptId:1,input:{result:'PASS',accepted_quantity:1,rejected_quantity:0}}),(error)=>error.code==='INSPECTION_QUANTITY_MISMATCH');
  await assert.rejects(service.inspectReceipt({...context,receiptId:1,input:{result:'PASS',accepted_quantity:1,rejected_quantity:1}}),(error)=>error.code==='INSPECTION_RESULT_MISMATCH');
  const inspected=await service.inspectReceipt({...context,receiptId:1,input:{result:'PASS',accepted_quantity:2,rejected_quantity:0}});assert.equal(inspected.receipt_status,'ACCEPTED');assert.equal(state.receipts[0].status,'ACCEPTED');assert.equal(state.inspections.length,1);
  await assert.rejects(service.inspectReceipt({...context,receiptId:1,input:{result:'PASS',accepted_quantity:2,rejected_quantity:0}}),(error)=>error.code==='RECEIPT_ALREADY_INSPECTED');assert.equal(state.inspections.length,1);
  state.po.status='CANCELLED';await assert.rejects(service.receiveGoods({...context,input}),(error)=>error.code==='PO_RECEIPT_STATUS_INVALID');assert.equal((await service.cancelPurchaseOrder({...context,id:1,reason:'Repeat request'})).unchanged,true);
  await assert.rejects(service.createBillMatch(),(error)=>error.statusCode===410&&error.code==='MODULE_RETIRED');
  assert(state.audits.every((entry)=>entry.actorId===99));assert(state.queries.filter((entry)=>/FOR UPDATE/.test(entry.sql)).every((entry)=>entry.transaction));
  const {STATEMENTS}=require('../services/procurementSchema');assert(!STATEMENTS.some((statement)=>statement.includes('procurement_bill_matches')),'additive original initializer cannot recreate Finance handoff');await require('../config/db').end();
  console.log('Procurement tests passed: decimal line totals, quantity/price/calendar validation, approval authority, over-receipt/duplicate-line prevention, atomic audit rollback, competing receipt quantities, truthful receipt/inspection statuses, single inspection and retired Finance table isolation.');
})().catch((error)=>{console.error(error);process.exitCode=1;});
