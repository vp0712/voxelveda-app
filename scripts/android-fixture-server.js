'use strict';
// Disposable Android instrumentation realm. Binds loopback only, never production.
process.env.VV_ANDROID_FIXTURE='1';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const fixture=require('./staff-mobile-browser-test');
process.env.MFA_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
process.env.ALLOWED_ORIGINS='https://app.voxelveda.com';process.env.APP_URL='https://app.voxelveda.com';
const root=path.resolve(__dirname,'..'),challenges=new Map(),secret='JBSWY3DPEHPK3PXP',mfaRecord={last_used_step:null};
const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.MFA_ENCRYPTION_KEY,'hex'),iv),encrypted=Buffer.concat([cipher.update(secret),cipher.final()]);
mfaRecord.secret_ciphertext=[iv,cipher.getAuthTag(),encrypted].map(part=>part.toString('base64url')).join('.');
const password=bcrypt.hashSync('SyntheticDevicePass123!',10);
for(const user of fixture.identities.values())user.password=password;
fixture.identities.set(9410,{id:9410,name:'Synthetic Android Admin',username:'synthetic.android.admin',email:'android-admin@example.invalid',password,role:'admin',permissions:[],active:1,account_status:'ACTIVE',session_version:1,mfa_enabled:1});
fixture.setNativeQuery(async(sql,params)=>{
 if(/FROM users/.test(sql)&&/LOWER\(email\)/.test(sql))return [[...fixture.identities.values()].filter(u=>u.email===params[0]),[]];
 if(/^UPDATE users/.test(sql))return [{affectedRows:1},[]];
 if(/^INSERT INTO mfa_login_challenges/.test(sql)){challenges.set(params[2],{id:params[0],user_id:params[1],challenge_type:params[3],attempts:0,used_at:null,expires:Date.now()+300000});return [{affectedRows:1},[]];}
 if(/FROM mfa_login_challenges/.test(sql)){const row=challenges.get(params[0]);return [[row].filter(r=>r&&!r.used_at&&r.expires>Date.now()),[]];}
 if(/^UPDATE mfa_login_challenges/.test(sql)){for(const row of challenges.values())if(/WHERE user_id/.test(sql)?row.user_id===params[0]:row.id===params[0]){if(/attempts/.test(sql))row.attempts++;else row.used_at=new Date();}return [{affectedRows:1},[]];}
 if(/FROM user_mfa_totp/.test(sql))return [[mfaRecord],[]];
 if(/^UPDATE user_mfa_totp SET last_used_step/.test(sql)){mfaRecord.last_used_step=params[0];return [{affectedRows:1},[]];}
 if(/FROM mfa_recovery_codes/.test(sql))return [[],[]];
});
const {createDocumentPdf}=require('../services/documentPdfService');
(async()=>{
 const document=await createDocumentPdf({title:'INVOICE',number:'ANDROID-FIXTURE-1',issueDate:'2026-10-15',recipient:{name:'Synthetic Android verification'},columns:[{key:'description',label:'Description',width:3},{key:'amount',label:'Amount',width:1}],rows:[['Synthetic authorised document; no production record','AUD 110.00']],totals:[{label:'Total',value:'AUD 110.00'}]});
 const server=await fixture.makeServer(path.join(root,'public'),fs.readFileSync(path.join(root,'public/logo.png')),async(app,{auth,pageAuth,authController,nativeMfaController,brand,identities,sessions})=>{
  app.set('trust proxy',1);
  const page=file=>brand.injectGlobalBrand(fs.readFileSync(path.join(root,'public',file),'utf8'));
  app.get('/__fixture/ready',(_req,res)=>res.json({fixtureOnly:true}));
  app.post('/__fixture/expire',(_req,res)=>{sessions.clear();res.json({expired:true});});
  app.get('/__fixture/totp',(_req,res)=>res.json({code:require('../services/mfaService')._test.totp(secret)}));
  app.get('/__fixture/state',(_req,res)=>res.json({fixtureOnly:true,mutations:fixture.mutations.length,requests:fixture.requests.map(r=>({path:r.path,method:r.method}))}));
  app.get('/',(_req,res)=>res.type('html').send(page('index.html')));
  for(const [route,file]of Object.entries({'/login':'login.html','/register':'register.html','/forgot-password':'forgot-password.html','/reset-password':'reset-password.html','/accept-invite':'accept-invite.html','/mfa':'mfa.html'}))app.get(route,(_req,res)=>res.type('html').send(page(file)));
  app.post('/api/auth/login',require('../middleware/publicEndpointProtection').loginContract,authController.login);
  app.post('/api/auth/mfa/verify',require('../middleware/publicEndpointProtection').mfaCodeContract,nativeMfaController.verifyLogin);
  app.post('/api/auth/logout',authController.logout);
  app.get('/dashboard',pageAuth(),(req,res)=>res.redirect(302,req.user.role==='admin'?'/admin':'/portal/staff'));
  app.get('/admin',pageAuth(),(req,res)=>req.user.role==='admin'?res.type('html').send(page('admin-dashboard.html')):res.status(403).type('html').send(page('403.html')));
  app.get('/security',pageAuth(),(_req,res)=>res.type('html').send(page('security.html')));
  app.get('/account',pageAuth(),(_req,res)=>res.type('html').send(page('workspace.html')));
  app.get('/document/view',pageAuth(),(_req,res)=>res.type('html').send(page('document-view.html')));
  app.get('/invoice/view',pageAuth(),(_req,res)=>res.type('html').send(page('invoice-pdf.html')));
  app.get('/api/invoice/91/pdf',auth,(_req,res)=>res.type('application/pdf').set('Content-Disposition','attachment; filename="ANDROID-FIXTURE-1.pdf"').send(document.buffer));
  app.get('/__fixture/gate.png',async(_req,res)=>{const token=require('../services/attendanceQrService').createSiteToken(),url=token.qr_data;res.type('png').send((await require('../services/attendanceQrRenderer').renderAttendanceQr(url,8)).buffer);});
  app.get('/a',pageAuth(),(req,res)=>res.redirect(303,'/portal/staff?attendance_code_expired=1'));
  app.get(['/finance','/banking','/erp'],(_req,res)=>res.status(410).type('html').send(page('retired.html')));
  app.get('/.well-known/assetlinks.json',require('../services/androidAssociationService').serveAssociation);
 });
 const meta={port:Number(new URL(server.origin).port),fixtureOnly:true};
 fs.writeFileSync(process.env.VV_ANDROID_FIXTURE_METADATA||'/tmp/vv-android-fixture.json',JSON.stringify(meta));
 console.log('ANDROID_FIXTURE_READY '+JSON.stringify(meta));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.server.close(()=>process.exit(0));server.server.closeAllConnections?.();});
})().catch(error=>{console.error(error.message);process.exitCode=1;});
