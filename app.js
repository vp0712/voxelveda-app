'use strict';
const express=require('express');
const path=require('node:path');
const fs=require('node:fs');
const cors=require('cors');
const authRoutes=require('./routes/authRoutes');
const userRoutes=require('./routes/userRoutes');
const profileRoutes=require('./routes/profileRoutes');
const settingsRoutes=require('./routes/settingsRoutes');
const documentSecurityRoutes=require('./routes/documentSecurityRoutes');
const securityDashboardRoutes=require('./routes/securityDashboardRoutes');
const securityIncidentRoutes=require('./routes/securityIncidentRoutes');
const readinessRoutes=require('./routes/readinessRoutes');
const backgroundJobRoutes=require('./routes/backgroundJobRoutes');
const securityTelemetry=require('./controllers/securityTelemetryController');
const readiness=require('./controllers/readinessController');
const auth=require('./middleware/auth');
const pageAuth=require('./middleware/pageAuth');
const {injectGlobalBrand}=require('./services/globalBrandRenderer');
const urls=require('./config/urls');
const {corsOptions,csrfProtection,enforceHttps,rateLimitPolicy,safeApiResponses,securityHeaders,safeErrorHandler}=require('./middleware/securityMiddleware');
const {retiredRequest,retiredAsset}=require('./services/applicationRetirement');
const requirePermission=require('./middleware/permissionMiddleware');
const {hasPermission}=require('./services/authorizationService');
const QRCode=require('qrcode');
const {publicRfqContract,aiLeadContract,shiftQrContract,cocVerificationContract,qrGenerationContract}=require('./middleware/publicEndpointProtection');
const {botChallenge}=require('./services/botChallengeService');
const {publicSubmissionDedupe}=require('./services/publicSubmissionDedupeService');
const {publicRouter:publicCareersRoutes,adminRouter:adminCareersRoutes}=require('./routes/careersRoutes');
const app=express();
const publicDir=path.join(__dirname,'public');
const pageCache=new Map();
const raw=(req,res,buffer)=>{req.rawBody=Buffer.from(buffer)};
app.disable('x-powered-by');app.set('trust proxy',1);app.set('query parser','simple');
app.use(enforceHttps);app.use(securityHeaders);app.use(safeApiResponses);
const applicationCors=cors(corsOptions());
app.use((req,res,next)=>req.method==='POST'&&req.path==='/api/security/csp-report'&&req.headers.origin==='null'?next():applicationCors(req,res,next));
app.use('/api/auth',express.json({limit:'8kb',type:'application/json',verify:raw}));
app.use(express.json({limit:process.env.JSON_BODY_LIMIT||'1mb',type:['application/json','application/csp-report','application/reports+json'],verify:raw}));
app.use(express.urlencoded({extended:false,limit:process.env.FORM_BODY_LIMIT||'1mb'}));
app.post('/api/security/csp-report',rateLimitPolicy('csp_report'),securityTelemetry.recordCspViolation);
app.use(csrfProtection);
app.get('/api/health',readiness.health);app.get('/api/ready',readiness.ready);
app.use((req,res,next)=>{
 if(process.env.FORCE_CANONICAL_HOST!=='true'||['/api/health','/api/ready'].includes(req.path))return next();
 const host=String(req.hostname||'').toLowerCase(),canonical=new URL(urls.app).hostname;
 if(host!==String(process.env.RAILWAY_FALLBACK_HOST||'voxelveda-app-production.up.railway.app').toLowerCase()||host===canonical)return next();
 return res.redirect(302,new URL(req.originalUrl||'/',`${urls.app}/`).toString());
});
function noIndex(req,res,next){res.set('X-Robots-Tag','noindex, nofollow, noarchive').set('Cache-Control','private, no-store');next()}
function sendPage(filename,status=200){return(req,res)=>{
 const source=path.join(publicDir,filename);let html=pageCache.get(source);
 if(!html||process.env.NODE_ENV!=='production'){html=injectGlobalBrand(fs.readFileSync(source,'utf8'));if(process.env.NODE_ENV==='production')pageCache.set(source,html)}
 return res.status(status).type('html').send(html);
}}
function redirect(target){return(req,res)=>{const index=req.originalUrl.indexOf('?');return res.redirect(302,target+(index>=0?req.originalUrl.slice(index):''));}}
app.get('/',sendPage('index.html'));
app.get('/login',noIndex,sendPage('login.html'));
app.get('/register',noIndex,sendPage('register.html'));
app.get('/privacy',sendPage('privacy-policy.html'));
app.get('/terms',sendPage('terms.html'));
app.get('/support',sendPage('support.html'));
app.get('/careers',sendPage('careers.html'));
app.get('/forgot-password',noIndex,sendPage('forgot-password.html'));
app.get('/reset-password',noIndex,sendPage('reset-password.html'));
app.get('/accept-invite',noIndex,sendPage('accept-invite.html'));
app.get('/mfa',noIndex,sendPage('mfa.html'));
app.get('/security',noIndex,pageAuth({allowMfaSetup:true}),sendPage('security.html'));
function portalPath(user){
 const role=String(user?.role||'staff').toLowerCase();
 if(['viewer','view_only','client','customer'].includes(role))return '/client';
 if(['super_admin','admin','finance_admin','finance_user','accountant'].includes(role))return '/admin';
 return '/portal/'+(['hr','manager','supervisor','sales','production','staff'].includes(role)?role:'staff');
}
app.get('/dashboard',noIndex,pageAuth(),(req,res)=>res.redirect(302,portalPath(req.user)));
app.get('/profile',noIndex,pageAuth(),sendPage('profile.html'));
app.get('/account',noIndex,pageAuth(),sendPage('workspace.html'));
app.get('/admin',noIndex,pageAuth(),(req,res)=>portalPath(req.user)==='/admin'?sendPage('admin-dashboard.html')(req,res):res.redirect(302,portalPath(req.user)));
app.get('/client',noIndex,pageAuth(),(req,res)=>portalPath(req.user)==='/client'?sendPage('client-portal.html')(req,res):res.redirect(302,portalPath(req.user)));
app.get('/portal/:role',noIndex,pageAuth(),(req,res)=>portalPath(req.user)===req.path?sendPage('staff-dashboard.html')(req,res):res.redirect(302,portalPath(req.user)));
app.get(['/admin-dashboard.html','/staff-dashboard.html','/client-portal.html'],noIndex,pageAuth(),redirect('/dashboard'));
app.get('/request-quote',sendPage('customer.html'));
function pagePermissions(permissions){return(req,res,next)=>permissions.some(permission=>hasPermission(req.user,permission))?next():sendPage('403.html',403)(req,res)}
for(const [route,file,permissions] of [
 ['/quality','quality.html',['VIEW_QMS','VIEW_COMPLIANCE']],
 ['/shop-floor','shop-floor.html',['VIEW_QMS','VIEW_COMPLIANCE']],
 ['/employee-id','employee-id.html',['MANAGE_USERS']],
 ['/careers-admin','careers-admin.html',['VIEW_STAFF_HR','MANAGE_USERS']],
 ['/invoice/view','invoice-pdf.html',['VIEW_FINANCE']]
])app.get(route,noIndex,pageAuth(),pagePermissions(permissions),sendPage(file));
app.get('/attendance-terminal',noIndex,sendPage('shift-qr.html'));
app.get('/employee/verify/:token',noIndex,sendPage('employee-verify.html'));
for(const [alias,target] of Object.entries({'/quality.html':'/quality','/shop-floor.html':'/shop-floor','/employee-id.html':'/employee-id','/careers-admin.html':'/careers-admin','/invoice-pdf.html':'/invoice/view'}))app.get(alias,noIndex,pageAuth(),redirect(target));
app.get(['/rfqs','/quotations','/invoices','/customers','/suppliers','/procurement','/stock','/inventory','/raw-material','/packaging','/expenses','/workforce','/timesheets','/roster','/staff','/compliance','/forms','/settings','/meetings','/tasks','/trash','/approvals'],noIndex,pageAuth(),(req,res)=>res.redirect(302,portalPath(req.user)+'?view='+encodeURIComponent(req.path.slice(1))));
const aliases={'/index.html':'/','/login.html':'/login','/register.html':'/register','/privacy-policy.html':'/privacy','/profile.html':'/profile','/dashboard.html':'/dashboard','/workspace.html':'/dashboard','/security.html':'/security','/mfa.html':'/mfa','/forgot-password.html':'/forgot-password','/reset-password.html':'/reset-password','/accept-invite.html':'/accept-invite','/support.html':'/support','/terms.html':'/terms','/careers.html':'/careers'};
for(const [from,to] of Object.entries(aliases))app.get(from,redirect(to));
for(const status of [401,403,404,429,500])app.get('/'+status,noIndex,sendPage(status+'.html',status));
app.get('/maintenance',noIndex,sendPage('maintenance.html',503));
app.use((req,res,next)=>{
 if(!retiredRequest(req.path)&&!retiredAsset(req.path))return next();
 res.set('Cache-Control','private, no-store').set('X-Robots-Tag','noindex, nofollow, noarchive');
 if(req.path.startsWith('/api/'))return res.status(410).json({code:'MODULE_RETIRED',message:'This module has been removed from Voxel Veda.'});
 return sendPage('retired.html',410)(req,res);
});
// Public pages/assets and internal liveness probes do not consume an API quota.
// In particular, the gateway probes /api/health every second; limiting those
// probes could make a healthy backend appear unavailable every quota window.
const apiRateLimit=rateLimitPolicy('authenticated_api');
app.use((req,res,next)=>req.path.startsWith('/api/')?apiRateLimit(req,res,next):next());
app.use('/api/auth',authRoutes);
app.use('/api/users',auth,userRoutes);
app.use('/api/profile',auth,profileRoutes);
app.use('/api/settings',auth,settingsRoutes);
app.get('/api/documents/reports/:type.pdf',auth,require('./controllers/originalReportController').download);
app.use('/api/documents',auth,documentSecurityRoutes);
app.use('/api/security/readiness',auth,readinessRoutes);
app.use('/api/security/workers',auth,backgroundJobRoutes);
app.use('/api/security',auth,securityDashboardRoutes);
app.use('/api/security',auth,securityIncidentRoutes);
app.use('/api/security/operations',auth,require('./routes/operationalTrustRoutes'));
app.use('/api/security/assurance',auth,require('./routes/continuousAssuranceRoutes'));
app.use('/api/security/governance',auth,require('./routes/securityGovernanceRoutes'));
// Restore only historically original modules; retired Banking/ERP routes are
// intercepted above and none of their controllers/services are required here.
const originalModules=[
 ['rfq','VIEW_RFQS'],['invoice','VIEW_FINANCE'],['customers','VIEW_CUSTOMERS'],
 ['suppliers','VIEW_SUPPLIERS'],['stock','VIEW_INVENTORY'],['materials','VIEW_INVENTORY'],
 ['meetings','VIEW_MEETINGS'],['roster','VIEW_ATTENDANCE'],['attendance','VIEW_ATTENDANCE'],
 ['expenses','VIEW_FINANCE'],['compliance','VIEW_COMPLIANCE'],['competitors','VIEW_CUSTOMERS']
];
// Preserve the historical public certificate verification alias before the
// authenticated quality router; it exposes verification, not quality records.
app.get('/api/qms/coc/:no/verify',rateLimitPolicy('coc_verification'),cocVerificationContract,require('./controllers/qms/qualityReleaseController').verifyCoc);
const routeFiles={rfq:'rfq',invoice:'invoice',customers:'customer',suppliers:'supplier',materials:'material',meetings:'meeting',expenses:'expense',competitors:'competitor'};
for(const [module,permission] of originalModules)app.use('/api/'+module,auth,requirePermission(permission),require('./routes/'+(routeFiles[module]||module)+'Routes'));
for(const [module,file] of Object.entries({dashboard:'dashboard',tasks:'task',procurement:'procurement',qms:'qms',notifications:'notification',workflows:'workflow',trash:'trash',upload:'upload',email:'email','employee-identities':'employeeIdentity','access-attempts':'accessAttempt'}))app.use('/api/'+module,auth,require('./routes/'+file+'Routes'));
app.use('/api/careers',auth,adminCareersRoutes);
app.use('/api/public/careers',publicCareersRoutes);
const rfqController=require('./controllers/rfqController'),attendanceController=require('./controllers/attendanceController');
app.post('/api/public/rfq',rateLimitPolicy('public_rfq'),publicRfqContract,botChallenge('public_rfq'),publicSubmissionDedupe({submissionType:'public_rfq'}),rfqController.createRFQ);
app.post('/api/public/ai-lead',rateLimitPolicy('ai_lead'),aiLeadContract,botChallenge('ai_lead'),publicSubmissionDedupe({submissionType:'ai_lead'}),require('./controllers/aiLeadController').createLead);
app.get('/api/public/shift-qr',rateLimitPolicy('shift_qr'),shiftQrContract,attendanceController.publicShiftQrToken);
app.get('/api/public/employee-id/:token/verify',rateLimitPolicy('coc_verification'),require('./controllers/employeeIdentityController').verify);
app.get('/api/public/qms/coc/:no/verify',rateLimitPolicy('coc_verification'),cocVerificationContract,require('./controllers/qms/qualityReleaseController').verifyCoc);
app.get('/api/qr',rateLimitPolicy('qr_generation'),qrGenerationContract,async(req,res,next)=>{try{res.type('png').set('Cache-Control','private, no-store').send(await QRCode.toBuffer(String(req.query.data||'').trim(),{width:1024,margin:8,errorCorrectionLevel:'H'}))}catch(error){next(error)}});
app.get('/vendor/chart.umd.js',(req,res)=>res.type('js').sendFile(path.join(__dirname,'node_modules/chart.js/dist/chart.umd.js')));
app.get('/vendor/jsQR.js',(req,res)=>res.type('js').sendFile(path.join(__dirname,'node_modules/jsqr/dist/jsQR.js')));
app.get('/forms/company/:filename',async(req,res,next)=>{
 try{
  if(!/^[a-z0-9][a-z0-9-]*\.pdf$/i.test(req.params.filename))return res.status(404).json({message:'Document not found'});
  const source=path.join(publicDir,'forms','company',req.params.filename);
  if(!fs.existsSync(source))return res.status(404).json({message:'Document not found'});
  const {validatePdf,sendPdfResponse}=require('./services/documentPdfService');
  const buffer=await fs.promises.readFile(source);
  const validation=await validatePdf(buffer);
  return await sendPdfResponse(res,{buffer,filename:req.params.filename,validation},req.query.download==='1');
 }catch(error){next(error)}
});
const noStore=new Set(['workspace.html','workspace.js','workspace.css','workspace-theme.css','workspace-theme.js','style.css','global-brand.css','global-brand.js','public-pages.css','auth-entry.css','login.js','register.js','auth-lifecycle.js','mfa.js','security-page.js','profile.js','step-up.js','step-up.css','service-worker.js']);
app.use(express.static(publicDir,{dotfiles:'deny',index:false,setHeaders(res,file){res.set('X-Content-Type-Options','nosniff');if(noStore.has(path.basename(file))||/\.(?:js|css|html)$/.test(file))res.set('Cache-Control','no-store, max-age=0')}}));
app.use((req,res)=>{if(!req.path.startsWith('/api/')&&req.accepts('html'))return sendPage('404.html',404)(req,res);return res.status(404).json({message:'Route not found'})});
app.use(safeErrorHandler);
module.exports=app;
