'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createDocumentPdf}=require('../services/documentPdfService');
const {readReleasePdfEvidence,releaseVerificationData}=require('../services/releasePdfVerificationService');
async function main(){
 const data=releaseVerificationData('fixture-only'),artifact=await createDocumentPdf(data),source=JSON.stringify(data);
 const request={id:1,related_module:'security',related_record_id:'release:fixture-only',source_json:source,generation_status:'VALIDATED',pdf_sha256:artifact.validation.sha256,pdf_pages:artifact.validation.pages,email_queue_id:157};
 const queue={id:157,status:'FAILED',attempts:1,max_attempts:5,last_error:'The company email relay must support validated PDF bytes and original .pdf filenames before document email can be sent.',to_json:JSON.stringify(['fixture-only@example.invalid']),attachments_json:JSON.stringify([{filename:artifact.filename,contentType:'application/pdf',content:artifact.buffer.toString('base64'),encoding:'base64',byteLength:artifact.buffer.length,sha256:artifact.validation.sha256}])};
 const sql=[];const db={query:async(statement)=>{sql.push(statement);assert.match(statement,/^SELECT /);return [[statement.includes('document_delivery_requests')?request:queue]];}};
 const result=await readReleasePdfEvidence(1,'fixture-only',db);
 assert.equal(result.failure_boundary,'RELAY_PREFLIGHT_CONTRACT');assert.equal(result.queue_pdf.matches_request,true);assert.equal(result.queue_pdf.sha256,artifact.validation.sha256);assert.equal(result.queue_pdf.pages,artifact.validation.pages);
 assert.equal(result.to_count,1);assert.equal(result.cc_count,0);assert.equal(result.bcc_count,0);assert.equal(result.provider_accepted,false);assert.equal(result.recipient_verified,false);assert.equal(result.source_sha256,crypto.createHash('sha256').update(source).digest('hex'));
 assert.doesNotMatch(JSON.stringify(result),/example\.invalid|Genuine parser-validated PDF|base64|The company email relay/);
 await assert.rejects(()=>readReleasePdfEvidence(1,'different-fixture',db),{code:'RELEASE_FIXTURE_MISMATCH'});
 request.related_module='timesheets';await assert.rejects(()=>readReleasePdfEvidence(1,'fixture-only',db),{code:'RELEASE_FIXTURE_MISMATCH'});request.related_module='security';
 queue.attachments_json='[{"encoding":"base64","content":"bad","sha256":"bad","byteLength":1}]';const corrupted=await readReleasePdfEvidence(1,'fixture-only',db);assert.equal(corrupted.queue_pdf.valid,false);assert.equal(corrupted.queue_pdf.error_code,'PDF_ATTACHMENT_INVALID');
 assert.ok(sql.length>0);console.log('Release PDF evidence tests passed: read-only exact authorised fixture, parsed retained bytes, immutable hash, recipient counts, no sensitive contents or blind retry.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
