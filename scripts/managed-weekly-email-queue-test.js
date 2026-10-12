'use strict';
// Actual queue/privacy/PDF code with a transactional local fixture. No provider,
// staff mailbox or production database is contacted.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const actual=require('../services/emailService');
const pdf=require('../services/documentPdfService');
async function main(){
 const data={title:'TIMESHEET',reference:'QUEUE-FIXTURE-A',party:'Fixture Staff A',period:'2026-09-28 to 2026-10-04',columns:[{label:'Worked hours'}],rows:[['8.00']],notes:['Isolated queue verification only.']};
 const artifact=await pdf.createDocumentPdf(data);
 const part={filename:artifact.filename,contentType:'application/pdf',contentDisposition:'attachment',content:artifact.buffer.toString('base64'),encoding:'base64',byteLength:artifact.buffer.length,sha256:artifact.validation.sha256};
 const policy={type:'WEEKLY_TIMESHEET',staffId:31,deliveryId:81,revision:1,fromDate:'2026-09-28',toDate:'2026-10-04',sourceHash:crypto.createHash('sha256').update('fixture snapshot').digest('hex'),recipient:'fixture-a@example.invalid'};
 const base={related_module:'timesheets',related_record_id:'51',template_key:'document_pdf',status:'PENDING',attempts:0,max_attempts:5,to_json:JSON.stringify([policy.recipient]),cc_json:'[]',bcc_json:'[]',attachments_json:JSON.stringify([part]),delivery_policy_json:JSON.stringify(policy),subject:'Weekly timesheet fixture',idempotency_key:'weekly-timesheet:31:2026-09-28:2026-10-04:v1'};
 const rows=[{...base,id:1},{...base,id:2,subject:'Weekly timesheet changed staff'},{...base,id:3,template_key:'weekly_timesheet_summary',idempotency_key:null,delivery_policy_json:null},{...base,id:4,cc_json:'["manager@example.invalid"]'},{...base,id:5,attachments_json:JSON.stringify([{...part,content:'corrupt'}])},{...base,id:6,status:'SENDING'},{...base,id:7,subject:'Weekly timesheet uncertain bookkeeping'}];
 const delivered=[],logs=[],weekly=new Map(rows.map(row=>[row.id,{status:row.status}]));
 let activeTransaction=false,commitFailure=true;
 const db={async query(sql,values=[]){
  const query=sql.replace(/\s+/g,' ').trim();
  if(query.startsWith('UPDATE email_queue q LEFT JOIN')){assert.match(query,/weekly_timesheet_delivery_versions/);for(const row of rows.filter(row=>row.status==='SENDING')){row.status='REVIEW_REQUIRED';weekly.get(row.id).status='REVIEW_REQUIRED';}return [{affectedRows:1}];}
  if(query.startsWith('SELECT * FROM email_queue'))return [rows.filter(row=>['PENDING','RETRY'].includes(row.status))];
  if(query.startsWith("UPDATE email_queue SET status = 'SENDING'")){const row=rows.find(row=>row.id===values[0]);if(!['PENDING','RETRY'].includes(row.status))return [{affectedRows:0}];row.status='SENDING';return [{affectedRows:1}];}
  if(query.startsWith("UPDATE email_queue SET status = 'SENT'")){assert.ok(activeTransaction);const row=rows.find(row=>row.id===values[1]);row.status='SENT';row.provider_accepted_at='fixture-acceptance';return [{affectedRows:1}];}
  if(query.startsWith("UPDATE email_queue SET status='REVIEW_REQUIRED',provider_accepted_at=")){const row=rows.find(row=>row.id===values.at(-1));row.status='REVIEW_REQUIRED';row.provider_accepted_at=values[0]?'fixture-acceptance':null;return [{affectedRows:1}];}
  if(query.startsWith('UPDATE email_queue SET status = ?')){const row=rows.find(row=>row.id===values.at(-1));row.status=values[0];return [{affectedRows:1}];}
  if(query.startsWith('INSERT INTO email_logs')){logs.push(values);return [{insertId:logs.length}];}
  throw new Error('Unexpected managed queue SQL: '+query);
 },async getConnection(){let snapshot,priorLogs;return {query:db.query,async beginTransaction(){assert.equal(activeTransaction,false);activeTransaction=true;snapshot=JSON.parse(JSON.stringify(rows));priorLogs=logs.length;},async commit(){if(rows[6].status==='SENT'&&commitFailure){commitFailure=false;throw new Error('Fixture lost bookkeeping commit');}activeTransaction=false;},async rollback(){rows.splice(0,rows.length,...snapshot);logs.length=priorLogs;activeTransaction=false;},release(){assert.equal(activeTransaction,false);}};}};
 const install=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
 install('../config/db',db);
 install('../services/emailQueueSchema',{async ensureEmailQueueSchema(){}});
 install('../services/weeklyTimesheetScheduler',{
  async validateQueuedWeeklyDelivery(row,connection){assert.ok(activeTransaction,'Eligibility locks stay held until transport returns');assert.ok(connection);if(row.id===2)throw Object.assign(new Error('The staff account is no longer eligible.'),{code:'DELIVERY_REVIEW_REQUIRED',reasonCode:'STAFF_OR_RECIPIENT_CHANGED'});return {delivery_id:policy.deliveryId,staff_id:policy.staffId,version:policy.revision,source_sha256:policy.sourceHash,documentData:data};},
  async markWeeklyDeliveryResult(_db,row,status,metadata){weekly.get(row.id).status=status;weekly.get(row.id).providerAccepted=metadata.providerAccepted===true;}
 });
 install('../services/emailService',{...actual,async sendMail(message){assert.ok(activeTransaction,'Delivery remains inside the employee/source lock transaction');assert.deepEqual(message.to,[policy.recipient]);assert.deepEqual(message.cc,[]);assert.deepEqual(message.bcc,[]);assert.deepEqual(message.attachments[0].content,artifact.buffer);await pdf.validatePdf(message.attachments[0].content,{expectedText:['Fixture Staff A','QUEUE-FIXTURE-A']});delivered.push(message);return {messageId:'fixture-'+delivered.length};}});
 const queue=require('../services/emailQueue');
 const outcomes=await queue.processEmailQueue();
 assert.deepEqual(outcomes.map(row=>row.status),['SENT','REVIEW_REQUIRED','REVIEW_REQUIRED','REVIEW_REQUIRED','FAILED','REVIEW_REQUIRED']);
 assert.equal(delivered.length,2,'Only eligible normal and uncertain-accepted messages attempted transport');
 assert.equal(rows[0].status,'SENT');assert.equal(rows[5].status,'REVIEW_REQUIRED');assert.equal(weekly.get(6).status,'REVIEW_REQUIRED','Stale queue and staff/week history must agree');
 assert.equal(rows[6].provider_accepted_at,'fixture-acceptance');assert.equal(weekly.get(7).providerAccepted,true,'Known acceptance survives failed bookkeeping');
 assert.equal(activeTransaction,false);assert.equal((await queue.processEmailQueue()).length,0);assert.equal(delivered.length,2,'Restart cannot resend accepted or uncertain reports');
 console.log('Managed weekly queue tests passed: locked eligibility; exact staff PDF bytes and one designated recipient; legacy policy/copies/invalid bytes block sending; stale state synchronizes; accepted bookkeeping failure is held; restart never duplicates.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
