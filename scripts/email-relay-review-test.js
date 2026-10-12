'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../config/db');
const servicePath=require.resolve('../services/emailService');
const schemaPath=require.resolve('../services/emailQueueSchema');
const actualService=require(servicePath);
const rows=[1,2].map(id=>({id,related_module:'security',related_record_id:`fixture-${id}`,status:'PENDING',attempts:0,max_attempts:5,to_json:'["fixture@example.invalid"]',attachments_json:'[]',subject:`fixture-${id}`,idempotency_key:`fixture-${id}`}));
const logs=[];
const db={async query(sql,values=[]){
 const query=sql.replace(/\s+/g,' ').trim();
 if(query.startsWith('SELECT * FROM email_queue'))return [[...rows.filter(row=>row.status==='PENDING')]];
 if(query.startsWith("UPDATE email_queue SET status = 'SENDING'")){const row=rows.find(row=>row.id===values[0]);row.status='SENDING';row.attempts+=1;return [{affectedRows:1}];}
 if(query.startsWith("UPDATE email_queue SET status='REVIEW_REQUIRED',provider_accepted_at=")){const row=rows.find(row=>row.id===values.at(-1));row.status='REVIEW_REQUIRED';row.provider_accepted_at=values[0]?'fixture-provider-time':null;row.last_error=values[1];return [{affectedRows:1}];}
 if(query.startsWith('UPDATE email_queue q LEFT JOIN'))return [{affectedRows:0}];
 if(query.startsWith('INSERT INTO email_logs')){logs.push(values);return [{insertId:logs.length}];}
 throw new Error('Unexpected review fixture SQL: '+query);
}};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
require.cache[schemaPath]={id:schemaPath,filename:schemaPath,loaded:true,exports:{async ensureEmailQueueSchema(){}}};
require.cache[servicePath]={id:servicePath,filename:servicePath,loaded:true,exports:{...actualService,async sendMail(message){throw Object.assign(new Error('Fixture uncertain transaction; review before retry.'),{code:'DELIVERY_REVIEW_REQUIRED',providerAccepted:message.subject==='fixture-1'});}}};
async function main(){
 const outcomes=await require('../services/emailQueue').processEmailQueue();
 assert.deepEqual(outcomes.map(row=>row.status),['REVIEW_REQUIRED','REVIEW_REQUIRED']);
 assert.deepEqual(outcomes.map(row=>row.provider_accepted),[true,false]);
 assert.ok(outcomes.every(row=>row.recipient_verified===false));
 assert.equal(rows[0].provider_accepted_at,'fixture-provider-time');assert.equal(rows[1].provider_accepted_at,null);
 assert.equal(logs.length,2);assert.ok(logs.every(log=>log[5]==='REVIEW_REQUIRED'));
 const repeated=await require('../services/emailQueue').processEmailQueue();assert.equal(repeated.length,0);assert.equal(logs.length,2);
 console.log('Relay review tests passed: uncertain outcomes remain REVIEW_REQUIRED without automatic resend; known provider acceptance has a separate timestamp; review attempts are logged; recipient verification remains false.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
