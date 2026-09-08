const fs = require('fs');
const path = require('path');
function read(p){return fs.readFileSync(path.join(__dirname,'..',p),'utf8')}
function must(text, needle, label){if(!text.includes(needle)){console.error(`Missing ${label}: ${needle}`);process.exit(1)}}
const schema=read('services/qmsQualityGovernanceSchema.js');
const routes=read('routes/qmsRoutes.js');
const release=read('controllers/qms/qualityReleaseController.js');
const server=read('server.js');
[
'concessions','certificates_of_conformance','supplier_approvals','supplier_scars','controlled_documents','document_revisions','document_change_requests','record_retention_rules','configuration_changes'
].forEach(t=>must(schema,`CREATE TABLE IF NOT EXISTS ${t}`,t));
must(release,'VV-FRM-023','CoC source document');
must(release,'Separation of duties','approval separation of duties');
must(release,'QUALITY_RELEASE_BLOCKED','quality release gate');
must(routes,"requireStepUp('qms:issue-coc')",'CoC step-up');
must(routes,"requireAnyPermission('ISSUE_COC'",'CoC permission');
must(routes,"requireAnyPermission('APPROVE_CONCESSION'",'concession permission');
must(routes,"requireAnyPermission('MANAGE_SUPPLIER_QUALITY'",'supplier quality permission');
must(routes,"requireAnyPermission('MANAGE_DOCUMENT_CONTROL'",'document control permission');
must(server,'QMS quality-release governance schema ready.','startup schema readiness');
console.log('QMS quality-release governance checks passed.');
