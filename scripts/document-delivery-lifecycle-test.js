'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../config/db');
const queuePath=require.resolve('../services/emailQueue');
const pdfPath=require.resolve('../services/documentPdfService');
const actualPdf=require(pdfPath);
const crypto=require('node:crypto');
const requests=new Map(),messages=[];let failRender=false,failBookkeeping=false,sendCount=0,queueStatus='SENT',mutateQueuedBytes=false;
const db={async query(sql,values=[]){
  if(/^(CREATE TABLE|ALTER TABLE)/.test(sql))return [{}];
  if(sql.startsWith('INSERT INTO document_delivery_requests')){
    if(!requests.has(values[0]))requests.set(values[0],{id:requests.size+1,request_key:values[0],related_module:values[1],related_record_id:values[2],source_json:values[3],recipients_json:values[4],created_by:values[5],generation_status:'PENDING',email_queue_id:null});
    return [{affectedRows:1}];
  }
  if(sql.startsWith('SELECT * FROM document_delivery_requests'))return [[requests.get(values[0])]];
  if(sql.startsWith('SELECT attachments_json')){const part=messages[values[0]-1].attachments[0],bytes=mutateQueuedBytes?Buffer.concat([part.content,Buffer.from('\n% queue fixture changed bytes\n')]):part.content;return [[{attachments_json:JSON.stringify([{filename:part.filename,content:bytes.toString('base64'),encoding:'base64',byteLength:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}])}]];}
  if(sql.startsWith('SELECT id,status'))return [[{id:values[0],status:queueStatus,message_id:queueStatus==='SENT'?'fixture-provider-acceptance':null,last_error:queueStatus==='FAILED'?'Fixture transport failure':null}]];
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
const {queueDocumentEmail,deliveryMessage}=require('../services/documentDeliveryService');
async function main(){
 const data={title:'DELIVERY FIXTURE',reference:'FIXTURE-RETRY-1',issueDate:'2026-10-11',columns:[{label:'Expected field',width:1},{label:'Value',width:1}],rows:[['Identity','FIXTURE-RETRY-1']],notes:['Authorised automated fixture; no business records.']};
 const message={module:'invoices',recordId:'fixture',data,to:['fixture@example.invalid'],subject:'Fixture only',text:'Validated fixture PDF is attached.',createdBy:4};
 failRender=true;await assert.rejects(()=>queueDocumentEmail(message),{code:'PDF_GENERATION_FAILED'});
 assert.equal(sendCount,0);assert.equal(requests.size,1);assert.equal([...requests.values()][0].generation_status,'GENERATION_FAILED');assert.equal([...requests.values()][0].source_json,JSON.stringify(data));
 failRender=false;const delivery=await queueDocumentEmail(message);assert.equal(sendCount,1);assert.equal(delivery.generation_status,'VALIDATED');assert.equal(delivery.email_status,'PENDING');assert.equal(delivery.provider_accepted,false);assert.equal(delivery.recipient_verified,false);
 assert.ok([...requests.values()][0].pdf_pages>0);assert.ok([...requests.values()][0].pdf_sha256);
 const duplicate=await queueDocumentEmail(message);assert.equal(sendCount,1);assert.equal(duplicate.email_status,'SENT');assert.equal(duplicate.provider_accepted,true);assert.equal(duplicate.recipient_verified,false);assert.equal(duplicate.existing,true);
 queueStatus='FAILED';const failed=await queueDocumentEmail(message);assert.equal(sendCount,1);assert.equal(failed.email_queued,false);assert.equal(failed.provider_accepted,false);assert.equal(failed.last_error,'Fixture transport failure');assert.match(deliveryMessage(failed),/failed/);assert.doesNotMatch(deliveryMessage(failed),/validated and queued/);
 queueStatus='REVIEW_REQUIRED';const uncertain=await queueDocumentEmail(message);assert.equal(sendCount,1);assert.equal(uncertain.email_queued,false);assert.equal(uncertain.provider_accepted,false);assert.match(deliveryMessage(uncertain),/requires review/);assert.match(deliveryMessage(uncertain),/No automatic resend/);
 queueStatus='SENT';
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
 const paragraph=Array.from({length:140},(_,i)=>`PARTY${String(i).padStart(4,'0')} authorised fixture information.`).join(' '),note=Array.from({length:180},(_,i)=>`NOTE${String(i).padStart(4,'0')} preserve the complete original terms.`).join(' ');
 const longData={...data,title:'LARGE DOCUMENT SNAPSHOT',reference:'FIXTURE-LONG-6',filename:'FIXTURE-LONG-6',party:paragraph,period:'19 to 25 October 2026',rows:[['Evidence','Repeated source evidence. '.repeat(220)+'FINAL-EVIDENCE-TOKEN'],['Amount','AUD 123.45']],notes:[note]};
 const longMessage={...message,recordId:'long:fresh',data:longData};
 const longFresh=await queueDocumentEmail(longMessage);assert.equal(longFresh.generation_status,'VALIDATED');assert([...requests.values()].at(-1).pdf_pages>=4);await actualPdf.validatePdf(messages.at(-1).attachments[0].content,{expectedText:['PARTY0139','NOTE0179','FINAL-EVIDENCE-TOKEN','AUD 123.45']});
 const longFrozen=await actualPdf.createDocumentPdf(longData),proof=await actualPdf.deriveDocumentContentProof(longData);assert.deepEqual(proof,longFrozen.contentProof,'Measure-only identity must cover the exact canonical source/layout without caller fragments');
 const retainedMessage={...longMessage,recordId:'long:frozen',validatedArtifact:{buffer:longFrozen.buffer,filename:longFrozen.filename,sha256:longFrozen.validation.sha256,contentProof:longFrozen.contentProof}};
 failRender=true;try{await queueDocumentEmail(retainedMessage);}finally{failRender=false;}
 const retainedPart=messages.at(-1).attachments[0];assert.deepEqual(retainedPart.content,longFrozen.buffer,'A long frozen PDF must queue the original preview/download bytes while attachment rendering is unavailable');
 const nodemailer=require('nodemailer'),mimeResult=await nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'}).sendMail({from:'Voxel Veda <info@voxelveda.com>',to:'fixture@example.invalid',subject:'Retained long PDF fixture',text:'Validated synthetic document.',attachments:[retainedPart]}),mime=mimeResult.message.toString('utf8');
 assert.equal((mime.match(/Content-Disposition: attachment/g)||[]).length,1);assert.match(mime,/Content-Type: application\/pdf; name=FIXTURE-LONG-6.pdf/);assert.doesNotMatch(mime,/\.tmp|application\/octet-stream|^Cc:|^Bcc:/mi);
 const pdfPart=mime.split(/--[^\n]+\n/).find(part=>/Content-Type: application\/pdf/.test(part));assert(pdfPart);const decoded=Buffer.from(pdfPart.split('\n\n')[1].trim(),'base64');assert.deepEqual(decoded,longFrozen.buffer);await actualPdf.validatePdf(decoded,{expectedText:proof.fragments,orderedExpectedText:true});
 const beforeForged=sendCount;
 await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:forged',validatedArtifact:{...retainedMessage.validatedArtifact,contentProof:{...proof,fragments:proof.fragments.slice(0,3)}}}),{code:'PDF_CONTENT_PROOF_MISMATCH'});
 await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:unsupported',validatedArtifact:{...retainedMessage.validatedArtifact,contentProof:{...proof,schema_version:999}}}),{code:'PDF_CONTENT_PROOF_UNSUPPORTED'});
 await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:unsupported-layout',validatedArtifact:{...retainedMessage.validatedArtifact,contentProof:{...proof,layout_version:'unknown-layout'}}}),{code:'PDF_CONTENT_PROOF_UNSUPPORTED'});
 await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:wrong-source',validatedArtifact:{...retainedMessage.validatedArtifact,contentProof:{...proof,source_sha256:'0'.repeat(64)}}}),{code:'PDF_CONTENT_PROOF_MISMATCH'});
 const partial=await actualPdf.createDocumentPdf({...longData,party:paragraph.slice(0,paragraph.length/2),rows:[['Evidence','Repeated source evidence. '.repeat(110)],['Amount','AUD 123.45']],notes:[note.slice(0,note.length/2)]});
 await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:partial',validatedArtifact:{buffer:partial.buffer,filename:partial.filename,sha256:partial.validation.sha256}}),{code:'PDF_CONTENT_MISMATCH'});
 const repeatedData={...data,title:'REPEATED CONTENT FIXTURE',reference:'FIXTURE-REPEATED',filename:'FIXTURE-REPEATED',rows:[['Evidence','Repeated source evidence. '.repeat(400)]]};
 const repeatedPartial=await actualPdf.createDocumentPdf({...repeatedData,rows:[['Evidence','Repeated source evidence. '.repeat(200)]]});
 await assert.rejects(()=>queueDocumentEmail({...message,recordId:'long:repeated',data:repeatedData,validatedArtifact:{buffer:repeatedPartial.buffer,filename:repeatedPartial.filename,sha256:repeatedPartial.validation.sha256}}),{code:'PDF_CONTENT_MISMATCH'});
 await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:wrong-record',data:{...longData,reference:'FIXTURE-OTHER-RECORD'},validatedArtifact:{buffer:longFrozen.buffer,filename:longFrozen.filename,sha256:longFrozen.validation.sha256}}),{code:'PDF_CONTENT_MISMATCH'});
 mutateQueuedBytes=true;try{await assert.rejects(()=>queueDocumentEmail({...retainedMessage,recordId:'long:changed-queue'}),{code:'PDF_SNAPSHOT_MISMATCH'});}finally{mutateQueuedBytes=false;}
 assert.equal(sendCount,beforeForged,'Forged/partial/repeated/wrong-record/changed-queue content cannot commit another message');
 console.log('Document lifecycle tests passed: retained immutable source; controlled generation retry; duplicate queue reuse; atomic bookkeeping rollback; changed-source rejection; complete long-field generated/frozen PDF and decoded MIME round trip; trusted measure-only proof; forged/unsupported/wrong-source/partial/repeated/wrong-record/changed-queue rejection; no re-rendered attachments; provider acceptance separate from recipient receipt.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
