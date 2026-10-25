'use strict';
const assert=require('node:assert/strict'),express=require('express'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {canonicalApplication,CANONICAL_ORIGIN,LEGACY_HOST}=require('../middleware/canonicalApplication');
const {serveAssociation}=require('../services/androidAssociationService');
const fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=require('node:http').request(url,{method:options.method||'GET',headers:options.headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(options.body);});
(async()=>{
 let writes=0;const app=express();app.use(canonicalApplication);app.get('/.well-known/assetlinks.json',serveAssociation);app.all('/api/health',(_req,res)=>res.json({ok:true}));app.all('/api/ready',(_req,res)=>res.json({ok:true}));app.post('/api/action',(_req,res)=>{writes++;res.json({saved:true});});app.get('/login',(_req,res)=>res.send('login'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),origin='http://127.0.0.1:'+server.address().port,prior=process.env.ANDROID_APP_SIGNING_SHA256;
 try{
  for(const route of ['/login?returnTo=%2Fportal%2Fstaff','/reset-password','/a?t=controlled-fixture']){const res=await fetch(origin+route,{redirect:'manual',headers:{Host:LEGACY_HOST}});assert.equal(res.status,308);assert.equal(res.headers.get('location'),CANONICAL_ORIGIN+route);}
  for(const route of ['/api/health','/api/ready'])assert.equal((await fetch(origin+route,{headers:{Host:LEGACY_HOST}})).status,200);
  const write=await fetch(origin+'/api/action',{method:'POST',headers:{Host:LEGACY_HOST,'Content-Type':'application/json'},body:'{}',redirect:'manual'});assert.equal(write.status,409);assert.equal(writes,0);assert.equal(write.headers.get('location'),null);
  const malformed=await fetch(origin+'//evil.invalid/path',{headers:{Host:LEGACY_HOST},redirect:'manual'});assert.equal(malformed.status,400);assert.equal(malformed.headers.get('location'),null);
  assert.equal((await fetch(origin+'/login',{headers:{Host:'app.voxelveda.com'},redirect:'manual'})).status,200);
  delete process.env.ANDROID_APP_SIGNING_SHA256;let association=await fetch(origin+'/.well-known/assetlinks.json');assert.equal(association.status,503);assert.deepEqual(await association.json(),[]);
  process.env.ANDROID_APP_SIGNING_SHA256='invalid';assert.equal((await fetch(origin+'/.well-known/assetlinks.json')).status,503);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vv-dal-test-'));
  try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'fixture-key.pem'),'-out',path.join(directory,'fixture-cert.pem'),'-days','1','-subj','/CN=Voxel Veda isolated association fixture'],{stdio:'ignore'});const cert=new crypto.X509Certificate(fs.readFileSync(path.join(directory,'fixture-cert.pem')));process.env.ANDROID_APP_SIGNING_SHA256=cert.fingerprint256;association=await fetch(origin+'/.well-known/assetlinks.json');assert.equal(association.status,200);assert.match(association.headers.get('content-type'),/^application\/json/);const rows=await association.json();assert.equal(rows[0].target.package_name,'com.voxelveda.app');assert.deepEqual(rows[0].target.sha256_cert_fingerprints,[cert.fingerprint256]);}finally{fs.rmSync(directory,{recursive:true,force:true});}
  const script="console.log(require('./config/urls').absolute('/accept-invite'))";const url=execFileSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'production',PUBLIC_APP_URL:'https://'+LEGACY_HOST},encoding:'utf8'}).trim();assert.equal(url,CANONICAL_ORIGIN+'/accept-invite');assert.throws(()=>require('../config/urls').absolute('//evil.invalid'),/Invalid application path/);
  await require('./android-back-test').run();
  console.log('Android canonical tests passed: legacy safe GET and health checks, no credential/write forwarding, redirect-injection rejection, exact production origin and verified-certificate-only JSON association; missing signing identity fails closed.');
 }finally{if(prior===undefined)delete process.env.ANDROID_APP_SIGNING_SHA256;else process.env.ANDROID_APP_SIGNING_SHA256=prior;await new Promise(resolve=>server.close(resolve));server.closeAllConnections?.();}
})().catch(error=>{console.error(error);process.exitCode=1;});
