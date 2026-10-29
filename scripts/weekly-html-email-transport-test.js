'use strict';
// Real queue/policy/transport code with synthetic messages only. No remote
// provider, staff/customer mailbox or production database is contacted.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const contentService=require('../services/weeklyTimesheetEmailService');
const policyService=require('../services/weeklyDeliveryPolicy');
const content={subject:'Voxel Veda weekly timesheet | 2026-10-19 to 2026-10-25',html:'<!doctype html><html><body><h1>TIMESHEET</h1><p>Fixture Staff A · 19–25 October 2026</p><p>Recorded hours: 8.00 (8h 00m)</p></body></html>',text:'TIMESHEET\nFixture Staff A · 19–25 October 2026\nRecorded hours: 8.00 (8h 00m)',layoutVersion:'weekly-html-v1'};
const contentHash=contentService.contentHashFor(content);
const policy={type:'WEEKLY_TIMESHEET',staffId:31,deliveryId:81,revision:1,fromDate:'2026-10-19',toDate:'2026-10-25',sourceHash:crypto.createHash('sha256').update('synthetic verified attendance').digest('hex'),recipient:'fixture-a@example.invalid',format:'HTML',layoutVersion:content.layoutVersion,contentHash};
const key='weekly-timesheet:31:2026-10-19:2026-10-25:v1';
const message={to:[policy.recipient],cc:[],bcc:[],...content,attachments:[],deliveryKey:key,deliveryPolicy:policy};
async function smtpMimeFixture(mail){
 const nodemailer=require('nodemailer'),create=nodemailer.createTransport;
 const stream=create({streamTransport:true,buffer:true,newline:'unix'});let mime;
 try{
  process.env.SMTP_PASSWORD=crypto.randomBytes(32).toString('hex');
  nodemailer.createTransport=()=>({async sendMail(input){assert.deepEqual(input.to,[policy.recipient]);assert.equal(input.cc,undefined);assert.equal(input.bcc,undefined);assert.deepEqual(input.attachments,[]);assert.equal(input.html,content.html);assert.equal(input.text,content.text);mime=(await stream.sendMail(input)).message;return {response:'250 2.0.0 Synthetic accepted',accepted:input.to,rejected:[],messageId:'synthetic-html-smtp'};},close(){}});
  const result=await mail.sendViaSmtp(message);assert.equal(result.messageId,'synthetic-html-smtp');assert.equal(result.receivedVerified,false);
  const raw=mime.toString('utf8');assert.match(raw,/Content-Type: multipart\/alternative;/i);assert.doesNotMatch(raw,/Content-Disposition:\s*attachment|application\/pdf|filename=/i);
  const boundary=/boundary="([^"]+)"/i.exec(raw)?.[1];assert(boundary);
  const decoded={};
  for(const part of raw.split('--'+boundary)){
   const type=/Content-Type:\s*(text\/(?:plain|html));/i.exec(part)?.[1]?.toLowerCase();if(!type)continue;
   const split=/\r?\n\r?\n/.exec(part);assert(split);let body=part.slice(split.index+split[0].length).replace(/\r?\n$/,'');
   if(/Content-Transfer-Encoding:\s*base64/i.test(part))body=Buffer.from(body.replace(/\s/g,''),'base64').toString('utf8');
   else if(/Content-Transfer-Encoding:\s*quoted-printable/i.test(part))body=Buffer.from(body.replace(/=\r?\n/g,'').replace(/=([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))),'binary').toString('utf8');
   decoded[type]=body.replace(/\r\n/g,'\n');
  }
  assert.equal(decoded['text/plain'],content.text);assert.equal(decoded['text/html'],content.html,'Actual generated MIME carries the full intended HTML body');
  const output='/tmp/voxel-weekly-html-evidence';fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'message.eml'),mime);fs.writeFileSync(path.join(output,'transport-mime-verification.json'),JSON.stringify({fixtureOnly:true,recipientReceiptVerified:false,toCount:1,ccCount:0,bccCount:0,attachmentCount:0,contentHash,plainTextMatches:true,htmlMatches:true},null,2));
 }finally{nodemailer.createTransport=create;stream.close();}
}
async function relayFailureDiagnosticFixtures(mail){
 const fetchBefore=global.fetch,warnBefore=console.warn,urlBefore=process.env.WORDPRESS_MAIL_RELAY_URL,websiteBefore=process.env.PUBLIC_WEBSITE_URL;
 const sensitive={username:'fixture-private-user',password:crypto.randomBytes(24).toString('hex'),query:crypto.randomBytes(24).toString('hex')},warnings=[];
 try{
  process.env.PUBLIC_WEBSITE_URL='https://fixture.invalid';console.warn=value=>warnings.push(String(value));
  global.fetch=async(_url,options)=>{assert.equal(options.headers.Accept,'application/json');return {ok:true,status:200,headers:{get:()=> 'text/html; charset=UTF-8'},json:async()=>{throw new Error('Synthetic non-JSON response');}};};
  const cases=[
   [`https://${sensitive.username}:${sensitive.password}@fixture.invalid/?rest_route=%2Fvoxel-veda%2Fv1%2Fmail-relay&access_token=${sensitive.query}`,'WORDPRESS_QUERY','yes','yes'],
   [`https://fixture.invalid/wp-json/voxel-veda/v1/mail-relay?access_token=${sensitive.query}`,'WORDPRESS_PRETTY','yes','yes'],
   ['https://another-fixture.invalid/private-mail-receiver','OTHER','no','no']
  ];
  for(const [url,form,sameHost,queryPresent] of cases){
   process.env.WORDPRESS_MAIL_RELAY_URL=url;
   await assert.rejects(()=>mail.verifyConnection(),error=>error.code==='EMAIL_HTTPS_RELAY_FAILED'&&error.relayReason==='RELAY_HEALTH_JSON_NOT_READY');
   const logged=warnings.at(-1);assert.match(logged,new RegExp(`url_form=${form} host_matches_company=${sameHost} query_present=${queryPresent}$`));assert.match(logged,/http_status=200 reason=RELAY_HEALTH_JSON_NOT_READY/);
   assert.match(logged,/response_type=HTML json_parsed=no redirected=no endpoint_unchanged=unknown/);
   for(const value of [url,...Object.values(sensitive),'access_token','rest_route','voxel-veda','private-mail-receiver'])assert(!logged.includes(value),'Failure diagnostics never disclose raw URL, credentials, paths or query names/values');
  }
  process.env.WORDPRESS_MAIL_RELAY_URL='https://fixture.invalid/wp-json/voxel-veda/v1/mail-relay';
  global.fetch=async()=>({ok:true,status:200,url:'https://fixture.invalid/',redirected:true,headers:{get:()=> 'text/html'},json:async()=>{throw new Error('Synthetic redirected homepage');}});
  await assert.rejects(()=>mail.verifyConnection(),{code:'EMAIL_HTTPS_RELAY_FAILED'});
  assert.match(warnings.at(-1),/response_type=HTML json_parsed=no redirected=yes endpoint_unchanged=no/);
  global.fetch=async()=>({ok:true,status:200,url:process.env.WORDPRESS_MAIL_RELAY_URL+'/health',headers:{get:()=> 'application/json'},json:async()=>({status:'ready'})});
  await assert.rejects(()=>mail.verifyConnection(),{code:'EMAIL_HTTPS_RELAY_FAILED'});
  assert.match(warnings.at(-1),/response_type=JSON json_parsed=yes redirected=no endpoint_unchanged=yes/,'A wrong JSON contract is distinguished from HTML or a redirect without disclosing its body');
 }finally{global.fetch=fetchBefore;console.warn=warnBefore;process.env.WORDPRESS_MAIL_RELAY_URL=urlBefore;if(websiteBefore===undefined)delete process.env.PUBLIC_WEBSITE_URL;else process.env.PUBLIC_WEBSITE_URL=websiteBefore;}
}
async function transportFixtures(){
 const oldEnv={...process.env},oldFetch=global.fetch;
 const pdf=require('../services/documentPdfService'),originalValidate=pdf.validatePdf;
 let pdfCalls=0,posts=0,mode='SUCCESS',seen;
 const health={ok:true,weekly_html_contract_version:1,weekly_html_content_preserved:true,weekly_recipient_privacy_enforced:true,
   attachment_contract_version:0,pdf_bytes_validated:false,attachment_filename_preserved:false};
 try{
  process.env.EMAIL_PRIMARY_TRANSPORT='https_relay';process.env.WORDPRESS_MAIL_RELAY_URL='https://fixture.invalid/relay';process.env.WORDPRESS_MAIL_RELAY_TOKEN='synthetic-fixture-only';
  // The new HTML route must continue when the actual PDF parser is unavailable.
  pdf.validatePdf=async()=>{pdfCalls++;throw new Error('Synthetic PDF generation/parser failure');};
  delete require.cache[require.resolve('../services/emailService')];
  const mail=require('../services/emailService');
  global.fetch=async(url,options={})=>{
   assert.match(String(url),/^https:\/\/fixture\.invalid\/relay/,'Fixture network boundary');
   if(options.method==='GET')return {ok:true,status:200,json:async()=>{if(mode==='HEALTH_HTML')throw new Error('Synthetic HTML response');return mode==='PDF_ONLY'?{ok:true,attachment_contract_version:3,pdf_bytes_validated:true,attachment_filename_preserved:true,weekly_recipient_privacy_enforced:true}:health;}};
   posts++;seen=JSON.parse(options.body);assert.deepEqual(seen.to,[policy.recipient]);assert.deepEqual(seen.cc,[]);assert.deepEqual(seen.bcc,[]);assert.deepEqual(seen.attachments,[]);assert.equal(seen.html,content.html);assert.equal(seen.text,content.text);assert.equal(seen.delivery_policy.contentHash,contentHash);assert.equal(seen.request_id,key);assert.equal(seen.attachment_contract_version,undefined);assert.equal(seen.preserve_attachment_filenames,undefined);
   if(mode==='LOST')throw Object.assign(new Error('Synthetic response lost after attempted dispatch'),{name:'AbortError'});
   if(mode==='REJECTED')return {ok:false,status:422,text:async()=>JSON.stringify({code:'WEEKLY_HTML_RELAY_VALIDATION_FAILED',message:'Synthetic pre-transport refusal'})};
   const receipt={sent:true,provider_accepted:true,request_id:key,...health,weekly_html_sha256:contentHash,layout_version:content.layoutVersion,designated_recipient:policy.recipient,attachments:[],provider_message_id:'synthetic-provider-id'};
   if(mode==='MISSING_ACCEPTANCE')delete receipt.provider_accepted;
   if(mode==='FALSE_ACCEPTANCE')receipt.provider_accepted=false;
   if(mode==='UNCONFIRMED')delete receipt.weekly_html_sha256;
   if(mode==='WRONG_KEY')receipt.request_id='unrelated-request';
   if(mode==='EXTRA_ATTACHMENT')receipt.attachments=[{filename:'not-authorised.pdf'}];
   if(mode==='NO_PROVIDER_ID')delete receipt.provider_message_id;
   if(mode==='MIME_ID'){delete receipt.provider_message_id;receipt.message_id='<synthetic-mime@example.invalid>';}
   return {ok:true,status:200,text:async()=>JSON.stringify(receipt)};
  };
  const sent=await mail.sendMail(message);assert.equal(sent.messageId,'synthetic-provider-id');assert.equal(sent.transport,'https_relay');assert.equal(sent.receivedVerified,false);assert.equal(pdfCalls,0,'HTML-only send never invokes the PDF parser');assert.equal(posts,1);
  mode='NO_PROVIDER_ID';const noProviderId=await mail.sendMail(message);assert.equal(noProviderId.messageId,null);assert.equal(noProviderId.requestId,key,'A relay request key is not invented as a provider message ID');
  mode='MIME_ID';const mimeId=await mail.sendMail(message);assert.equal(mimeId.messageId,'<synthetic-mime@example.invalid>');assert.equal(mimeId.mimeMessageId,mimeId.messageId);assert.equal(mimeId.providerMessageId,null,'An observed MIME Message-ID is distinct from a provider-assigned ID');
  for(const testMode of ['HEALTH_HTML','PDF_ONLY']){mode=testMode;const before=posts;await assert.rejects(()=>mail.sendMail(message),error=>error.code==='WEEKLY_HTML_RELAY_CONTRACT_REQUIRED'&&error.deliveryOutcome==='NOT_DISPATCHED');assert.equal(posts,before,'Incompatible receiver never reaches send');}
  mode='SUCCESS';const before=posts;
  await assert.rejects(()=>mail.sendMail({...message,cc:['manager@example.invalid']}),{code:'DELIVERY_REVIEW_REQUIRED'});
  await assert.rejects(()=>mail.sendMail({...message,html:content.html.replace('8.00','80.00')}),error=>error.reasonCode==='WEEKLY_HTML_CONTENT_HASH_MISMATCH');
  await assert.rejects(()=>mail.sendMail({...message,deliveryPolicy:{...policy,format:'CSV'}}),error=>error.reasonCode==='WEEKLY_FORMAT_INVALID');assert.equal(posts,before);
  for(const testMode of ['UNCONFIRMED','WRONG_KEY','EXTRA_ATTACHMENT']){mode=testMode;await assert.rejects(()=>mail.sendMail(message),error=>error.code==='DELIVERY_REVIEW_REQUIRED'&&error.providerAccepted===true);}
  for(const testMode of ['MISSING_ACCEPTANCE','FALSE_ACCEPTANCE']){mode=testMode;const before=posts;await assert.rejects(()=>mail.sendMail(message),error=>error.code==='DELIVERY_REVIEW_REQUIRED'&&error.reasonCode==='WEEKLY_HTML_ACCEPTANCE_UNCONFIRMED'&&error.providerAccepted===false&&error.retryable===false);assert.equal(posts,before+1,'An unconfirmed attempted send is held without another transport attempt');}
  mode='LOST';await assert.rejects(()=>mail.sendMail(message),{code:'DELIVERY_REVIEW_REQUIRED'});
  mode='REJECTED';await assert.rejects(()=>mail.sendMail(message),error=>error.code==='WEEKLY_HTML_RELAY_VALIDATION_FAILED'&&error.deliveryOutcome==='NOT_ACCEPTED'&&error.retryable===false);
  // Legacy weekly reports are not silently converted to HTML to bypass their PDF.
  await assert.rejects(()=>mail.sendMail({...message,deliveryPolicy:{...policy,format:undefined}}),error=>error.reasonCode==='WEEKLY_ATTACHMENT_COUNT_INVALID');
  await relayFailureDiagnosticFixtures(mail);
  await smtpMimeFixture(mail);
  assert.equal(pdfCalls,0);
 }finally{pdf.validatePdf=originalValidate;global.fetch=oldFetch;for(const name of Object.keys(process.env))if(!(name in oldEnv))delete process.env[name];Object.assign(process.env,oldEnv);delete require.cache[require.resolve('../services/emailService')];}
}
async function queueFixtures(){
 const actual=require('../services/emailService');
 const base={related_module:'timesheets',related_record_id:'51',template_key:'weekly_timesheet_html',status:'PENDING',attempts:0,max_attempts:5,to_json:JSON.stringify([policy.recipient]),cc_json:'[]',bcc_json:'[]',attachments_json:'[]',delivery_policy_json:JSON.stringify(policy),subject:content.subject,html_body:content.html,text_body:content.text,idempotency_key:key};
 const forged={...content,html:content.html.replace('8.00','80.00')};
 const rows=[{...base,id:1},{...base,id:2,html_body:forged.html,delivery_policy_json:JSON.stringify({...policy,contentHash:contentService.contentHashFor(forged)})},{...base,id:3,related_module:'invoices'},{...base,id:4,delivery_policy_json:JSON.stringify({...policy,format:undefined})},{...base,id:5,bcc_json:'["payroll@example.invalid"]'},{...base,id:6},{...base,id:7,attempts:4},{...base,id:8,text_body:null}];
 const delivered=[],logs=[],weekly=new Map();let active=false,commitFailure=true,current;
 const db={async query(sql,values=[]){const query=sql.replace(/\s+/g,' ').trim();
  if(query.startsWith('UPDATE email_queue q LEFT JOIN'))return [{affectedRows:0}];
  if(query.startsWith('SELECT * FROM email_queue'))return [rows.filter(r=>['PENDING','RETRY'].includes(r.status))];
  if(query.startsWith("UPDATE email_queue SET status = 'SENDING'")){assert.match(query,/attempts < max_attempts/);current=rows.find(r=>r.id===values[0]);if(!['PENDING','RETRY'].includes(current.status))return [{affectedRows:0}];current.status='SENDING';return [{affectedRows:1}];}
  if(query.startsWith("UPDATE email_queue SET status = 'SENT'")){assert(active);current.status='SENT';return [{affectedRows:1}];}
  if(query.startsWith("UPDATE email_queue SET status='REVIEW_REQUIRED',provider_accepted_at=")){const row=rows.find(r=>r.id===values.at(-1));row.status='REVIEW_REQUIRED';row.provider_accepted=values[0]===1;return [{affectedRows:1}];}
  if(query.startsWith('UPDATE email_queue SET status = ?')){rows.find(r=>r.id===values.at(-1)).status=values[0];return [{affectedRows:1}];}
  if(query.startsWith('INSERT INTO email_logs')){logs.push(values);return [{insertId:logs.length}];}
  throw new Error('Unexpected HTML queue SQL: '+query);
 },async getConnection(){let snapshot;return {query:db.query,async beginTransaction(){assert.equal(active,false);active=true;snapshot=JSON.parse(JSON.stringify(rows));},async commit(){if(current.id===6&&commitFailure){commitFailure=false;throw new Error('Synthetic lost bookkeeping commit');}active=false;},async rollback(){rows.splice(0,rows.length,...snapshot);active=false;},release(){assert.equal(active,false);}};}};
 const scheduler={async validateQueuedWeeklyDelivery(row,connection){assert(active&&connection);return {delivery_id:policy.deliveryId,staff_id:policy.staffId,version:policy.revision,source_sha256:policy.sourceHash,format:'HTML',contentHash,contentSnapshot:content};},async markWeeklyDeliveryResult(_db,row,status,metadata){weekly.set(row.id,{status,accepted:metadata.providerAccepted===true});}};
 const queueRequire=Module.createRequire(require.resolve('../services/emailQueue'));
 const queueModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../services/emailQueue'),'utf8'),{module:queueModule,exports:queueModule.exports,Buffer,console,process,require:name=>name==='../config/db'?db:name==='./emailQueueSchema'?{async ensureEmailQueueSchema(){}}:name==='./weeklyTimesheetScheduler'?scheduler:name==='./emailService'?{...actual,async sendMail(input){assert(active,'Final HTML dispatch holds source/recipient locks');policyService.assertWeeklyDeliveryContent(input,input.deliveryPolicy);assert.deepEqual(Array.from(input.to),[policy.recipient]);assert.deepEqual(Array.from(input.cc),[]);assert.deepEqual(Array.from(input.bcc),[]);assert.deepEqual(Array.from(input.attachments),[]);assert.equal(input.html,content.html);assert.equal(input.text,content.text);if(current.id===7)throw Object.assign(new Error('Synthetic connection failure before dispatch'),{code:'ECONNECTION',deliveryOutcome:'NOT_DISPATCHED'});delivered.push(current.id);return {messageId:'synthetic-'+current.id};}}:queueRequire(name)},{filename:require.resolve('../services/emailQueue')});
 const queue=queueModule.exports;
 // Valid HTML exemption is deliberately narrower than arbitrary document mail.
 assert.throws(()=>queue._test.assertExpectedDocumentAttachment({relatedModule:'invoices',templateKey:'invoice',subject:'Invoice'},[]),{code:'PDF_ATTACHMENT_MISSING'});
 assert.throws(()=>queue._test.assertExpectedDocumentAttachment({relatedModule:'rfq',templateKey:'quotation',subject:'Quotation'},[]),{code:'PDF_ATTACHMENT_MISSING'});
 const queueMessage={relatedModule:'timesheets',relatedRecordId:'51',templateKey:'weekly_timesheet_html',idempotencyKey:key,...message};
 const duplicateDb={async query(sql){if(/INSERT INTO email_queue/.test(sql))throw Object.assign(new Error('Synthetic unique delivery key'),{code:'ER_DUP_ENTRY'});if(sql==='SELECT * FROM email_queue WHERE idempotency_key = ? LIMIT 1')return [[rows[0]]];throw new Error('Unexpected idempotency fixture query: '+sql);}};
 assert.equal(await queue.queueEmail(queueMessage,duplicateDb),1,'An exact HTML retry reuses its existing durable queue record');
 await assert.rejects(()=>queue.queueEmail({...queueMessage,idempotencyKey:null},duplicateDb),error=>error.reasonCode==='WEEKLY_POLICY_IDENTITY_MISMATCH','A transport-only delivery key cannot replace persistent queue idempotency');
 await assert.rejects(()=>queue.queueEmail({...queueMessage,html:forged.html,deliveryPolicy:{...policy,contentHash:contentService.contentHashFor(forged)}},duplicateDb),error=>error.reasonCode==='WEEKLY_HTML_IDEMPOTENCY_CONFLICT');
 await assert.rejects(()=>queue.queueEmail({...queueMessage,to:['changed@example.invalid'],deliveryPolicy:{...policy,recipient:'changed@example.invalid'}},duplicateDb),error=>error.reasonCode==='WEEKLY_HTML_IDEMPOTENCY_CONFLICT','A completed report recipient is never rewritten by a retry');
 const outcomes=await queue.processEmailQueue();
 assert.deepEqual(Array.from(outcomes,x=>x.status),['SENT','REVIEW_REQUIRED','REVIEW_REQUIRED','FAILED','REVIEW_REQUIRED','REVIEW_REQUIRED','FAILED','REVIEW_REQUIRED']);
 assert.deepEqual(delivered,[1,6],'Only the authorised immutable HTML content reaches transport');
 assert.equal(weekly.get(6).accepted,true,'Accepted uncertain bookkeeping is held, not blindly resent');
 assert.equal((await queue.processEmailQueue()).length,0,'Restart cannot repeat accepted, uncertain or repaired-only records');assert.deepEqual(delivered,[1,6]);
}
(async()=>{await transportFixtures();await queueFixtures();console.log('Weekly HTML transport tests passed: no PDF dependency; exact frozen body and single designated recipient; strict legacy document/PDF validation; HTML-only relay capability and immutable receipt; bounded retries, uncertainty and restart holds. Synthetic fixtures only; no recipient receipt claimed.');})().catch(error=>{console.error(error);process.exitCode=1;});
