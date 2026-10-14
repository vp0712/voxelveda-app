'use strict';
// Isolated relay and browser response contracts. No provider or inbox is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mail = require('../services/emailService');
const { createDocumentPdf } = require('../services/documentPdfService');

async function relayChecks(artifact) {
  const savedFetch = global.fetch;
  const keys = ['WORDPRESS_MAIL_RELAY_URL','WORDPRESS_MAIL_RELAY_TOKEN','EMAIL_PRIMARY_TRANSPORT'];
  const savedEnv = keys.map(key=>process.env[key]);
  process.env.WORDPRESS_MAIL_RELAY_URL='https://fixture.invalid/mail-relay';
  process.env.WORDPRESS_MAIL_RELAY_TOKEN='disposable-fixture-only';
  process.env.EMAIL_PRIMARY_TRANSPORT='https_relay';
  const health={ok:true,attachment_contract_version:3,pdf_bytes_validated:true,attachment_filename_preserved:true};
  const message={to:'fixture@example.invalid',subject:'Isolated PDF boundary fixture',deliveryKey:'isolated:response-boundary',attachments:[{filename:artifact.filename,content:artifact.buffer}]};
  let posts=0;
  try {
    for (const outcome of [
      ()=>new Response('<html>Gateway failure</html>',{status:502}),
      ()=>new Response('<html>Unexpected success page</html>',{status:200}),
      ()=>new Response('{invalid JSON',{status:200}),
      ()=>new Response(JSON.stringify({sent:false}),{status:500}),
      ()=>new Response('null',{status:200}),
      ()=>new Response(JSON.stringify({code:'UNKNOWN_PROVIDER_FAILURE',message:'Unknown outcome'}),{status:500}),
      ()=>({ok:true,status:200,async text(){throw Object.assign(new Error('Lost body stream'),{code:'EPIPE'});}}),
      ()=>{throw Object.assign(new Error('Unconfirmed POST network outcome'),{code:'ENOTFOUND'});}
    ]) {
      global.fetch=async(_url,options)=>{if(options.method==='GET')return Response.json(health);posts++;return outcome();};
      await assert.rejects(()=>mail.sendMail(message),error=>error.code==='DELIVERY_REVIEW_REQUIRED' && error.providerAccepted!==true);
    }
    assert.equal(posts,8,'Every uncertain case attempts once and requires review.');
    for (const code of ['PDF_RELAY_VALIDATION_FAILED','INVALID_REQUEST_ID']) {
      global.fetch=async(_url,options)=>options.method==='GET'?Response.json(health):Response.json({code,message:'Rejected before transport.',data:{provider_accepted:false}},{status:422});
      await assert.rejects(()=>mail.sendMail(message),{code:'PDF_RELAY_VALIDATION_FAILED'});
    }
    global.fetch=async(_url,options)=>options.method==='GET'?Response.json(health):Response.json({sent:true,provider_accepted:true},{status:500});
    await assert.rejects(()=>mail.sendMail(message),error=>error.code==='DELIVERY_REVIEW_REQUIRED' && error.providerAccepted===true);
    const beforePreflight=posts;
    global.fetch=async(_url,options)=>{if(options.method==='POST')posts++;return new Response('<html>Not the health API</html>',{status:200});};
    await assert.rejects(()=>mail.sendMail(message),{code:'PDF_RELAY_CONTRACT_REQUIRED'});
    assert.equal(posts,beforePreflight,'A malformed preflight cannot initiate mail transport.');
    for (const response of [()=>new Response('<html>Health page</html>'),()=>Response.json(null),()=>Response.json([]),()=>Response.json({}),()=>Response.json({ok:false})]) {
      global.fetch=async()=>response();
      await assert.rejects(()=>mail.verifyConnection(),{code:'EMAIL_HTTPS_RELAY_FAILED'});
    }
    global.fetch=async()=>Response.json({ok:true,attachment_contract_version:2});
    const legacy=await mail.verifyConnection();
    assert.equal(legacy.ok,true);assert.equal(legacy.transport,'https_relay');assert.equal(legacy.pdf_attachments_supported,false);assert.equal(legacy.recipient_verified,false);
  } finally {
    global.fetch=savedFetch;
    keys.forEach((key,index)=>savedEnv[index]===undefined?delete process.env[key]:process.env[key]=savedEnv[index]);
  }
}

async function browserChecks(artifact) {
  const source=fs.readFileSync(path.join(__dirname,'..','public','operations-ui.js'),'utf8');
  const start=source.indexOf('  async function openPdf('),end=source.indexOf('  window.VoxelOperations =',start);
  assert.ok(start>=0 && end>start);
  let opened=0,closed=0,created=0,clicked=0,response;
  const savedBlobs=[];
  const context=vm.createContext({TextDecoder,Blob,setTimeout,clearTimeout,location:{origin:'https://fixture.invalid'},fetch:async()=>response,
    URL:{createObjectURL(blob){created++;savedBlobs.push(blob);return 'blob:fixture';},revokeObjectURL(){}},
    window:{open(){opened++;return {document:{body:{}},close(){closed++;},location:{replace(){}},opener:null};},addEventListener(){},removeEventListener(){}},
    document:{body:{append(){}},createElement(){return {click(){clicked++;},remove(){}};}}
  });
  vm.runInContext(source.slice(start,end)+'\nglobalThis.openPdf = openPdf;',context);
  const headers={'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="response-fixture.pdf"'};
  for (const invalid of [
    ()=>Response.json({message:'A clear generation failure.'},{status:422}),
    ()=>new Response('<html>Error</html>',{headers:{...headers,'Content-Type':'text/html'}}),
    ()=>new Response(artifact.buffer,{headers:{...headers,'Content-Disposition':'attachment; filename="response-fixture.tmp"'}}),
    ()=>new Response('Error '.repeat(100),{headers})
  ]) {
    response=invalid();await assert.rejects(()=>context.openPdf('/fixture',{download:true}));
  }
  assert.equal(created,0);assert.equal(clicked,0);assert.equal(opened,0,'Invalid downloads create neither file nor popup.');
  response=Response.json({message:'The source document is unavailable.'},{status:409});
  await assert.rejects(()=>context.openPdf('/fixture'),/source document is unavailable/);
  assert.equal(opened,1);assert.equal(closed,1,'Failed preview closes its pending window.');
  response=new Response(artifact.buffer,{headers});await context.openPdf('/fixture',{download:true});
  assert.equal(created,1);assert.equal(clicked,1);assert.deepEqual(Buffer.from(await savedBlobs[0].arrayBuffer()),artifact.buffer);
  for (const [file,name,route] of [
    ['staff.js','openStaffInvoicePdf','/api/invoice/'],
    ['admin-dashboard.js','viewSupplierFile','/api/suppliers/files/'],
    ['admin-dashboard.js','viewExpenseFile','/api/expenses/files/']
  ]) {
    const text=fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');
    const match=text.match(new RegExp(`async function ${name}\\([^]*?\\n}\\n`));assert.ok(match,name);
    let request;const errors=[];
    const c=vm.createContext({token:'disposable-fixture-only',window:{VoxelOperations:{async openPdf(url,options){request={url,options};}}},encodeURIComponent,showToast(message){errors.push(message);}});
    vm.runInContext(match[0],c);await c[name](42);
    assert.ok(request.url.startsWith(route));assert.equal(request.options.headers.Authorization,'Bearer disposable-fixture-only');
    c.window.VoxelOperations.openPdf=async()=>{throw new Error('The PDF failed validation.');};await c[name](42);
    assert.deepEqual(errors,['The PDF failed validation.']);assert.doesNotMatch(match[0],/\.blob\(|createObjectURL/);
  }
}

async function main(){
  const artifact=await createDocumentPdf({title:'PDF RESPONSE VERIFICATION',reference:'ISOLATED-RESPONSE-001',party:'Fixture only',notes:['No business record and no real delivery.']});
  await relayChecks(artifact);await browserChecks(artifact);
  console.log('PDF response boundary tests passed: uncertain POST errors/HTML/malformed responses require review; definitive validation rejects and preflight send nothing; health JSON is truthful; legacy viewers share PDF checks; HTTP errors never produce downloads; valid download bytes are exact. No real email sent.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
