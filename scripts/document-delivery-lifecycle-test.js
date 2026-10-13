'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../config/db');
const queuePath=require.resolve('../services/emailQueue');
const pdfPath=require.resolve('../services/documentPdfService');
const actualPdf=require(pdfPath);
const crypto=require('node:crypto');
const requests=new Map(),messages=[];let failRender=false,failBookkeeping=false,sendCount=0;
const db={async query(sql,values=[]){
  if(/^(CREATE TABLE|ALTER TABLE)/.test(sql))return [{}];
  if(sql.startsWith('INSERT INTO document_delivery_requests')){
    if(!requests.has(values[0]))requests.set(values[0],{id:requests.size+1,request_key:values[0],related_module:values[1],related_record_id:values[2],source_json:values[3],recipients_json:values[4],created_by:values[5],generation_status:'PENDING',email_queue_id:null});
    return [{affectedRows:1}];
  }
  if(sql.startsWith('SELECT * FROM document_delivery_requests'))return [[requests.get(values[0])]];
  if(sql.startsWith('SELECT attachments_json')){const part=messages[values[0]-1].attachments[0],bytes=part.content;return [[{attachments_json:JSON.stringify([{filename:part.filename,content:bytes.toString('base64'),encoding:'base64',byteLength:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}])}]];}
  if(sql.startsWith('SELECT id,status'))return [[{id:values[0],status:'SENT',message_id:'fixture-provider-acceptance'}]];
  const request=[...requests.values()].find(row=>row.id===values[values.length-1]);
  if(sql.includes("generation_status='GENERATING'")){
    if(!['PENDING','GENERATION_FAILED'].includes(request.generation_status))return [{affectedRows:0}];
    request.generation_status='GENERATING';return [{affectedRows:1}];
  }
  if(sql.includes("generation_status='VALIDATED'")){if(failBookkeeping)throw new Error('Fixture document bookkeeping failure.');Object.assign(request,{generation_status:'VALIDATED',pdf_sha256:values[0],pdf_pages:values[1],email_queue_id:values[2],last_error:null});return [{affectedRows:1}];}
  if(sql.includes("generation_status='GENERATION_FAILED'")){request.generation_status='GENERATION_FAILED';request.last_error=values[0];return [{affectedRows:1}];}
  throw new Error('Unexpected fixture SQL: '+sql);
},async getConnection(){let before, messageCount, priorCount;return {query:db.query,async beginTransaction(){before=JSON.parse(JSON.stringify([...requests]));messageCount=messages.length;priorCount=sendCount;},async commit(){before=null;},async rollback(){if(before){requests.clear();for(const [key,row] of before)requests.set(key,row);messages.length=messageCount;sendCount=priorCount;before=null;}},release(){}};}};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
require.cache[queuePath]={id:queuePath,filename:queuePath,loaded:true,exports:{restoreAttachments:items=>items.map(item=>({...item,content:Buffer.from(item.content,'base64')})),async queueEmail(message){messages.push(message);return ++sendCount;}}};
require.cache[pdfPath]={id:pdfPath,filename:pdfPath,loaded:true,exports:{...actualPdf,async createDocumentPdf(data){if(failRender)throw Object.assign(new Error('Fixture renderer failed.'),{code:'PDF_GENERATION_FAILED'});return actualPdf.createDocumentPdf(data);}}};
const {queueDocumentEmail}=require('../services/documentDeliveryService');
async function main(){
 const data={title:'DELIVERY FIXTURE',reference:'FIXTURE-RETRY-1',issueDate:'2026-10-11',columns:[{label:'Expected field',width:1},{label:'Value',width:1}],rows:[['Identity','FIXTURE-RETRY-1']],notes:['Authorised automated fixture; no business records.']};
 const message={module:'invoices',recordId:'fixture',data,to:['fixture@example.invalid'],subject:'Fixture only',text:'Validated fixture PDF is attached.',createdBy:4};
 failRender=true;await assert.rejects(()=>queueDocumentEmail(message),{code:'PDF_GENERATION_FAILED'});
 assert.equal(sendCount,0);assert.equal(requests.size,1);assert.equal([...requests.values()][0].generation_status,'GENERATION_FAILED');assert.equal([...requests.values()][0].source_json,JSON.stringify(data));
 failRender=false;const delivery=await queueDocumentEmail(message);assert.equal(sendCount,1);assert.equal(delivery.generation_status,'VALIDATED');assert.equal(delivery.email_status,'PENDING');assert.equal(delivery.provider_accepted,false);assert.equal(delivery.recipient_verified,false);
 assert.ok([...requests.values()][0].pdf_pages>0);assert.ok([...requests.values()][0].pdf_sha256);
 const duplicate=await queueDocumentEmail(message);assert.equal(sendCount,1);assert.equal(duplicate.email_status,'SENT');assert.equal(duplicate.provider_accepted,true);assert.equal(duplicate.recipient_verified,false);assert.equal(duplicate.existing,true);
 await actualPdf.validatePdf(messages[0].attachments[0].content,{expectedText:['FIXTURE-RETRY-1']});
 assert.equal(messages[0].attachments.length,1);assert.equal(messages[0].attachments[0].contentType,'application/pdf');assert.match(messages[0].attachments[0].filename,/\.pdf$/);assert.equal(messages[0].attachments[0].path,undefined);
 const changed={...message,data:{...data,reference:'FIXTURE-RETRY-2',rows:[['Identity','FIXTURE-RETRY-2']]}};
 failBookkeeping=true;await assert.rejects(()=>queueDocumentEmail(changed),/bookkeeping failure/);assert.equal(sendCount,1);assert.equal(messages.length,1);assert.equal([...requests.values()].at(-1).generation_status,'GENERATION_FAILED');
 failBookkeeping=false;await queueDocumentEmail(changed);assert.equal(sendCount,2);assert.equal(messages.length,2);
 const stale={...message,data:{...data,reference:'FIXTURE-STALE-3',rows:[['Identity','FIXTURE-STALE-3']]},beforeQueue:async()=>{throw Object.assign(new Error('Document changed while rendering.'),{code:'PDF_DOCUMENT_CHANGED'});}};
 await assert.rejects(()=>queueDocumentEmail(stale),{code:'PDF_DOCUMENT_CHANGED'});assert.equal(sendCount,2);assert.equal([...requests.values()].at(-1).generation_status,'GENERATION_FAILED');
 const frozenData={...data,title:'FROZEN PROCUREMENT FIXTURE',reference:'FIXTURE-FROZEN-4',filename:'FIXTURE-FROZEN-4',rows:[['Identity','FIXTURE-FROZEN-4']]};
 const frozen=await actualPdf.createDocumentPdf(frozenData);const frozenMessage={...message,module:'procurement',recordId:'report:fixture',data:frozenData,validatedArtifact:{buffer:frozen.buffer,filename:frozen.filename,sha256:frozen.validation.sha256}};
 failRender=true;const retained=await queueDocumentEmail(frozenMessage);assert.equal(retained.generation_status,'VALIDATED');assert.deepEqual(messages.at(-1).attachments[0].content,frozen.buffer,'Frozen preview/download bytes must be queued unchanged without re-rendering');
 const mismatchData={...frozenData,reference:'FIXTURE-MISMATCH-5',filename:'FIXTURE-MISMATCH-5',rows:[['Identity','FIXTURE-MISMATCH-5']]};const mismatch=await actualPdf.createDocumentPdf(mismatchData);const beforeInvalid=sendCount;
 await assert.rejects(()=>queueDocumentEmail({...frozenMessage,data:mismatchData,validatedArtifact:{buffer:mismatch.buffer,filename:mismatch.filename,sha256:'0'.repeat(64)}}),{code:'PDF_SNAPSHOT_MISMATCH'});assert.equal(sendCount,beforeInvalid,'Invalid retained PDF hash must not enqueue or send');
 failRender=false;
 console.log('Document lifecycle tests passed: generation failure retains immutable source and sends nothing; controlled retry queues one validated PDF; duplicate request reuses queue; bookkeeping failure atomically rolls back the queue; changed-source guard sends nothing; provider acceptance remains separate from recipient receipt.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
