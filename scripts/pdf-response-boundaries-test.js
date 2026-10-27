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
  let opened=0,closed=0,created=0,clicked=0,response,owner='17',sessionToken='fixture-session-17',onCreate;
  const savedBlobs=[],previews=[],listeners=new Map();
  const context=vm.createContext({TextDecoder,Blob,setTimeout,clearTimeout,location:{origin:'https://fixture.invalid'},fetch:async()=>response,
    localStorage:{getItem(key){return key==='user'?JSON.stringify(owner?{id:owner}:{}):key==='token'?sessionToken:null;}},
    URL:{createObjectURL(blob){created++;savedBlobs.push(blob);onCreate?.();return 'blob:fixture';},revokeObjectURL(){}},
    window:{open(){opened++;const preview={document:{body:{}},close(){closed++;},postMessage(){preview.messages++;},messages:0,location:{replace(){}},opener:null};previews.push(preview);return preview;},addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler);},removeEventListener(type,handler){listeners.get(type)?.delete(handler);}},
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
  // The server can finish an authorised old-session response after a logout or
  // account switch. Those bytes must never reach a download, preview or bridge.
  for(const nextAccount of ['22','']){
    owner='17';sessionToken='fixture-session-17';let release;
    response=new Promise(resolve=>{release=resolve;});
    const pending=context.openPdf('/fixture',{download:true}),rejected=assert.rejects(pending,{code:'PDF_ACCOUNT_CHANGED'});
    owner=nextAccount;sessionToken=nextAccount?'fixture-session-22':'';release(new Response(artifact.buffer,{headers}));await rejected;
  }
  assert.equal(created,1);assert.equal(clicked,1,'Late old-account responses cannot create or click a file');
  owner='17';sessionToken='fixture-session-17';let releaseBody,bodyStarted;
  const beganBody=new Promise(resolve=>{bodyStarted=resolve;}),body=new Promise(resolve=>{releaseBody=resolve;});
  response={ok:true,headers:new Headers(headers),arrayBuffer(){bodyStarted();return body;}};
  const pendingBody=context.openPdf('/fixture',{download:true}),bodyRejected=assert.rejects(pendingBody,{code:'PDF_ACCOUNT_CHANGED'});await beganBody;
  sessionToken='replacement-session-for-the-same-account';releaseBody(Uint8Array.from(artifact.buffer).buffer);await bodyRejected;
  assert.equal(clicked,1,'Changing the session while streaming bytes also blocks the download');
  owner='17';sessionToken='fixture-session-17';response=new Response(artifact.buffer,{headers});
  const createdPreview=new Promise(resolve=>{onCreate=resolve;});const previewRequest=context.openPdf('/fixture'),previewRejected=assert.rejects(previewRequest,{code:'PDF_ACCOUNT_CHANGED'});await createdPreview;onCreate=null;
  owner='22';sessionToken='fixture-session-22';const pendingPreview=previews.at(-1);for(const listener of listeners.get('message')||[])listener({source:pendingPreview,origin:'https://fixture.invalid',data:{type:'VV_PDF_VIEWER_READY'}});await previewRejected;
  assert.equal(pendingPreview.messages,0,'A viewer handshake after account change must receive no old-account bytes');assert.equal(closed,2);
  owner='17';sessionToken='fixture-session-17';let releaseNative,nativeCalls=0;context.window.VoxelNativeApp={async documentAction(){nativeCalls++;}};
  response=new Promise(resolve=>{releaseNative=resolve;});const nativeRequest=context.openPdf('/fixture',{download:true}),nativeRejected=assert.rejects(nativeRequest,{code:'PDF_ACCOUNT_CHANGED'});owner='22';sessionToken='fixture-session-22';releaseNative(new Response(artifact.buffer,{headers}));await nativeRejected;assert.equal(nativeCalls,0);delete context.window.VoxelNativeApp;
  owner='';sessionToken='';response=new Response(artifact.buffer,{headers});await context.openPdf('/public-fixture',{download:true});assert.equal(clicked,2,'An unchanged anonymous public document remains downloadable');
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
  console.log('PDF response boundary tests passed: uncertain transport requires review; definitive validation/preflight sends nothing; HTTP errors never produce files; exact valid download bytes; old-account/session responses cannot download, preview or reach the native bridge; unchanged public downloads remain available. No real email sent.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
