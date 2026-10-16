'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module'),path=require('node:path');
process.env.SHIFT_QR_SIGNING_KEY=crypto.randomBytes(32).toString('hex');process.env.SHIFT_QR_SITE_ID='display-fixture-site';delete process.env.ATTENDANCE_DISPLAY_BOOTSTRAP_SHA256;
const db=require('./fixtures/attendance-display-db')(),original=Module._load,root=path.resolve(__dirname,'..');
Module._load=function(request,parent){const target=request.startsWith('.')?path.resolve(path.dirname(parent.filename),request).replace(/\.js$/,''):request;if(target===path.join(root,'config/db'))return db;if(target===path.join(root,'services/auditService'))return{logAudit:db.audit};return original.apply(this,arguments);};
let service;try{service=require('../services/attendanceDisplayService');}finally{Module._load=original;}
const user={id:107},qr=require('../services/attendanceQrService');
async function main(){
 const input={request_id:crypto.randomUUID(),label:'Fixture tablet'},created=await service.create({user,input}),credential=new URL(created.url).hash.slice('#display='.length);
 assert.match(credential,/^vvd1_[A-Za-z0-9_-]{43}$/);assert.equal(new URL(created.url).origin,'https://app.voxelveda.com');assert.equal(new URL(created.url).search,'');
 assert.ok(!JSON.stringify(db.rows()).includes(credential));assert.ok(!JSON.stringify(db.audits()).includes(credential));assert.ok(!JSON.stringify(await service.list()).includes('credential_hash'));
 const replay=await service.create({user,input});assert.equal(replay.already_created,true);assert.equal(replay.url,undefined);assert.equal(db.rows().length,1);
 await assert.rejects(()=>service.create({user,input:{...input,label:'Changed'}}),{code:'ATTENDANCE_DISPLAY_REQUEST_CONFLICT'});
 const code=await service.current({credential});assert.ok(code.image_png_base64);assert.equal(code.token,undefined);assert.equal(qr.validateSiteToken(code.qr_data).site_id,process.env.SHIFT_QR_SITE_ID);
 await assert.rejects(()=>service.current({credential:'invalid'}),{statusCode:403});await assert.rejects(()=>service.current({credential:'vvd1_'+crypto.randomBytes(32).toString('base64url')}),{statusCode:403});
 process.env.SHIFT_QR_SITE_ID='other-site';await assert.rejects(()=>service.current({credential}),{statusCode:403});process.env.SHIFT_QR_SITE_ID='display-fixture-site';
 await assert.rejects(()=>service.revoke({user,id:created.display.id,input:{request_id:crypto.randomUUID(),expected_revision:2,reason:'Fixture stale'}}),{code:'ATTENDANCE_DISPLAY_REVISION_CONFLICT'});
 const replacement={request_id:crypto.randomUUID(),expected_revision:1,label:'Replacement tablet',reason:'Fixture rotation'},changed=await service.create({user,input:replacement,replaceId:created.display.id});
 await assert.rejects(()=>service.current({credential}),{statusCode:403});const newKey=new URL(changed.url).hash.slice('#display='.length);await service.current({credential:newKey});
 const revoke={request_id:crypto.randomUUID(),expected_revision:1,reason:'Fixture revoke'};await service.revoke({user,id:changed.display.id,input:revoke});assert.equal((await service.revoke({user,id:changed.display.id,input:revoke})).existing,true);await assert.rejects(()=>service.current({credential:newKey}),{statusCode:403});
 db.failAudit=true;const count=db.rows().length;await assert.rejects(()=>service.create({user,input:{request_id:crypto.randomUUID(),label:'Rolled back'}}),/Synthetic audit failure/);assert.equal(db.rows().length,count);db.failAudit=false;
 const bootstrap='vvd1_'+crypto.randomBytes(32).toString('base64url');process.env.ATTENDANCE_DISPLAY_BOOTSTRAP_SHA256=crypto.createHash('sha256').update(bootstrap).digest('hex');const bootstrapDb=require('./fixtures/attendance-display-db')();
 await service.current({credential:bootstrap,db:bootstrapDb});let row=(await service.list({db:bootstrapDb})).links[0];await service.revoke({user,id:row.id,input:{request_id:crypto.randomUUID(),expected_revision:1,reason:'Fixture permanent revocation'},db:bootstrapDb});
 const restarted={query:bootstrapDb.query,getConnection:bootstrapDb.getConnection};await assert.rejects(()=>service.current({credential:bootstrap,db:restarted}),{statusCode:403});assert.equal(bootstrapDb.rows().length,1);delete process.env.ATTENDANCE_DISPLAY_BOOTSTRAP_SHA256;
 console.log('ATTENDANCE_DISPLAY_TEST_OK: scoped hashed credential, no secret in audit/list, one-time issuance/replay, wrong-site/invalid rejection, atomic audited replacement/revocation, rollback and no resurrection after restart');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
