const fs = require('fs');
const path = require('path');
function read(p){return fs.readFileSync(path.join(__dirname,'..',p),'utf8')}
function must(text, needle, label){if(!text.includes(needle)){console.error(`Missing ${label}: ${needle}`);process.exit(1)}}
const schema=read('services/qmsEnterpriseCompletionSchema.js');
const routes=read('routes/qmsEnterpriseRoutes.js');
const app=read('app.js');
const server=read('server.js');
const perms=read('config/permissionCatalog.js');
const quality=read('public/quality.html');
const shop=read('public/shop-floor.html');
[
'audit_programmes','internal_audits','audit_findings','management_reviews','chemical_products','sds_versions','chemical_transactions','site_visitors','emergency_events','emergency_rollcall','critical_services','continuity_exercises','regulatory_reviews','qms_notifications','qms_evidence_index','recall_assessments'
].forEach(t=>must(schema,`CREATE TABLE IF NOT EXISTS ${t}`,t));
must(routes,"/command-centre",'quality command centre route');
must(routes,"/recall/material/:materialLotId",'recall impact route');
must(routes,"/shop-floor/operations/:id/transition",'shop floor operation route');
must(routes,"requireStepUp('qms:regulatory-decision')",'regulatory step-up');
must(app,"app.get('/quality'",'quality page route');
must(app,"app.get('/shop-floor'",'shop floor page route');
must(app,"/api/public/qms/coc/:no/verify",'public CoC verification');
must(server,'QMS enterprise completion schema ready.','enterprise schema startup');
['VIEW_QMS','MANAGE_QMS','QUALITY_RELEASE','MANAGE_NCR','MANAGE_CAPA','MANAGE_CALIBRATION','MANAGE_MAINTENANCE','MANAGE_TRAINING','MANAGE_SUPPLIER_QUALITY','MANAGE_DOCUMENT_CONTROL','MANAGE_INTERNAL_AUDIT','MANAGE_CHEMICALS','MANAGE_SAFETY','REGULATORY_REVIEW','EXPORT_CONTROL_REVIEW'].forEach(p=>must(perms,`'${p}'`,p));
must(quality,'Import Browser Form Records','legacy import UI');
must(quality,'/shop-floor','shop floor navigation');
must(shop,'Shop Floor','shop floor UI');
console.log('QMS enterprise completion checks passed.');
