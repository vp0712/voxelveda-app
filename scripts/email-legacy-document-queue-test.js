'use strict';
const assert = require('node:assert/strict');
const dbPath = require.resolve('../config/db');
const servicePath = require.resolve('../services/emailService');
const schemaPath = require.resolve('../services/emailQueueSchema');
const actualService = require(servicePath);
const fixtures = [
  {related_module:'invoices',subject:'Invoice INV-LEGACY',attachments_json:null},
  {related_module:'timesheets',subject:'Weekly hours',idempotency_key:'weekly-timesheet:42:2026-09-28:2026-10-04:v1',attachments_json:'[]'},
  {related_module:'procurement',subject:'Order',template_key:'purchase_order_email',attachments_json:'not JSON'},
  {related_module:'rfq',subject:'Quotation',text_body:'Please find your quotation PDF attached.',attachments_json:'[]'},
  {related_module:'security',subject:'Verification',template_key:'document_pdf',attachments_json:'[]'},
  {related_module:'roster',subject:'Roster published',text_body:'Review your assigned shifts in the app.',attachments_json:'[]'},
  {related_module:'timesheets',subject:'Timesheet approved',text_body:'Your approved hours are ready for payroll review.',idempotency_key:'timesheet-approved-42-v2',attachments_json:'[]'},
  {related_module:'auth',subject:'Password reset',text_body:'Open the authorised reset link.',attachments_json:'[]'},
  {related_module:'procurement',subject:'Order',attachments_json:'{}'}
];
const rows = fixtures.map((row,index)=>({...row,id:index+1,status:'PENDING',attempts:0,max_attempts:5,to_json:'["fixture@example.invalid"]'}));
const logs=[]; const sent=[];
const db={async query(sql,values=[]){
  const query=sql.replace(/\s+/g,' ').trim();
  if(query.startsWith('SELECT * FROM email_queue'))return [[...rows.filter(row=>['PENDING','RETRY'].includes(row.status))]];
  if(query.startsWith("UPDATE email_queue SET status = 'SENDING'")){const row=rows.find(row=>row.id===values[0]);row.status='SENDING';return [{affectedRows:1}];}
  if(query.startsWith('UPDATE email_queue q LEFT JOIN'))return [{affectedRows:0}];
  if(query.startsWith("UPDATE email_queue SET status = 'SENT'")){const row=rows.find(row=>row.id===values[1]);row.status='SENT';return [{affectedRows:1}];}
  if(query.startsWith('UPDATE email_queue SET status = ?')){const row=rows.find(row=>row.id===values.at(-1));row.status=values[0];row.last_error=values[1];return [{affectedRows:1}];}
  if(query.startsWith('INSERT INTO email_logs')){logs.push(values);return [{insertId:logs.length}];}
  throw new Error('Unexpected legacy document fixture SQL: '+query);
}};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
require.cache[schemaPath]={id:schemaPath,filename:schemaPath,loaded:true,exports:{async ensureEmailQueueSchema(){}}};
require.cache[servicePath]={id:servicePath,filename:servicePath,loaded:true,exports:{...actualService,async sendMail(message){sent.push(message);return {messageId:`fixture-${sent.length}`};}}};
async function main(){
  const queue = require('../services/emailQueue');
  const outcomes=await queue.processEmailQueue();
  assert.deepEqual(outcomes.map(row=>row.status),['FAILED','FAILED','FAILED','FAILED','FAILED','SENT','SENT','SENT','FAILED']);
  assert.deepEqual(sent.map(message=>message.subject),['Roster published','Timesheet approved','Password reset']);
  assert.ok(rows.filter(row=>row.status==='FAILED').every(row=>/attachment/.test(row.last_error)));
  assert.equal(logs.length,9);assert.equal(rows.length,9);
  assert.ok(rows.slice(0,5).every(row=>row.attachments_json===fixtures[row.id-1].attachments_json));
  await assert.rejects(queue.queueEmail({relatedModule:'invoices',subject:'Invoice without a document',to:'fixture@example.invalid'}),error=>error.code==='PDF_ATTACHMENT_MISSING');
  const repeated=await queue.processEmailQueue();assert.equal(repeated.length,0);assert.equal(sent.length,3);
  console.log('Legacy document queue tests passed: missing/malformed PDFs fail without transport; source rows remain intact; plain roster, review and reset notifications remain available; no automatic document retry.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
