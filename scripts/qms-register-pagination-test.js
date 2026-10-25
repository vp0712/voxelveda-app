'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const pdf=require('../services/documentPdfService');
const actor={id:43,role:'isolated-fixture',permissions:['VIEW_QMS']};
function fixture({rows=[],total=rows.length,pdfFailure=false,queryFailure=null}={}){
 const calls=[],state={commits:0,rollbacks:0,releases:0,pdfs:0};
 const connection={
  async query(sql,args=[]){calls.push({sql,args});if(queryFailure&&sql.startsWith('SELECT'))throw queryFailure;if(sql.startsWith('SELECT COUNT'))return [[{total}]];if(sql.startsWith('SELECT'))return [rows];return [{}];},
  async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){state.commits++;},async rollback(){state.rollbacks++;},release(){state.releases++;}
 };
 const mock={async getConnection(){calls.push({sql:'CONNECTION'});return connection;}};
 const exports={},module={exports},file=path.join(__dirname,'../services/qmsRegisterService.js');
 new vm.Script(fs.readFileSync(file,'utf8'),{filename:file}).runInNewContext({module,exports,Buffer,Date,Intl,Set,Map,require(name){
  if(name==='../config/db')return mock;
  if(name==='./authorizationService')return require('../services/authorizationService');
  if(name==='./documentPdfService')return{...pdf,async createDocumentPdf(input){state.pdfs++;if(pdfFailure)throw Object.assign(new Error('Injected PDF failure'),{code:'PDF_GENERATION_FAILED'});return pdf.createDocumentPdf(input);}};
  if(name==='node:crypto')return require(name);
  throw new Error('Unexpected quality register dependency: '+name);
 }});
 return {service:module.exports,calls,state};
}
(async()=>{
 const f=fixture();
 for(const user of [null,{id:43,role:'isolated-fixture',permissions:[]},{id:43,role:'isolated-fixture',permissions:['MANAGE_QMS']}]){
  await assert.rejects(f.service.listRegister({user,query:{}},'audits'),error=>[401,403].includes(error.status));
 }
 assert.equal(f.calls.length,0,'Unauthorised requests never acquire a database connection');
 for(const query of [{sort:'created_at; DROP TABLE users'},{direction:'SIDEWAYS'},{page:'0'},{limit:101},{page:['1','2']},{from_date:'2026-02-30'},{from_date:'2026-10-26',to_date:'2026-10-25'},{status:'invalid'},{search:['a','b']},{search:'a',q:'b'}]){
  await assert.rejects(f.service.listRegister({user:actor,query},'audits'),error=>error.status===400);
 }
 assert.equal(f.calls.length,0);
 await assert.rejects(f.service.listRegister({user:actor,query:{from_date:'2026-10-01'}},'inspection-plans'),error=>error.status===400);
 const q=f.service.buildQuery('notifications',actor,{search:'_100%!',severity:'HIGH',acknowledged:'all',from_date:'2026-10-04',to_date:'2026-10-04',sort:'created_at',direction:'asc'});
 assert.match(q.from,/\(r\.target_user_id IS NULL OR r\.target_user_id=\?\)/);
 assert.equal(q.params[0],43);assert(q.params.includes('%!_100!%!!%'),'Search wildcards are literal user data');
 assert.match(q.order,/r\.created_at asc,r\.id asc/);
 for(const date of ['2026-04-05','2026-10-04'])assert.equal(f.service._test.dateCell(date),new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z')));
 const rows=Array.from({length:3},(_,i)=>({id:i+1,audit_no:'AUD-QMS-UNIT-'+i,title:'Synthetic quality audit '+i,status:'PLANNED',scheduled_at:'2026-10-25',completed_at:null,created_at:'2026-10-25'}));
 const complete=fixture({rows,total:3});const body=await complete.service.listRegister({user:actor,query:{page:'1',limit:'3'}},'audits');
 assert.equal(body.pagination.total,3);assert.equal(body.pagination.pages,1);assert.equal(body.audits.length,3);
 assert.match(complete.calls[1].sql,/REPEATABLE READ, READ ONLY/);assert.equal(complete.state.commits,1);assert.equal(complete.state.releases,1);
 const partial=fixture({rows:rows.slice(0,2),total:3});await assert.rejects(partial.service.reportArtifact({user:actor,query:{}},'audits'),error=>error.code==='QMS_REGISTER_SOURCE_INCOMPLETE');assert.equal(partial.state.pdfs,0);assert.equal(partial.state.rollbacks,1);
 const duplicates=fixture({rows:[rows[0],rows[0]],total:2});await assert.rejects(duplicates.service.reportArtifact({user:actor,query:{}},'audits'),error=>error.code==='QMS_REGISTER_SOURCE_INCOMPLETE');assert.equal(duplicates.state.pdfs,0);
 const large=fixture({total:10001});await assert.rejects(large.service.reportArtifact({user:actor,query:{}},'audits'),error=>error.code==='QMS_REPORT_LIMIT_EXCEEDED');assert.equal(large.state.pdfs,0);
 const brokenSchema=fixture({queryFailure:Object.assign(new Error('secret SQL column diagnostic'),{code:'ER_BAD_FIELD_ERROR'})});await assert.rejects(brokenSchema.service.listRegister({user:actor,query:{}},'audits'),error=>error.code==='QMS_REGISTER_SCHEMA_UNAVAILABLE'&&!error.message.includes('secret'));
 const invalid=fixture({rows,total:3,pdfFailure:true});await assert.rejects(invalid.service.reportArtifact({user:actor,query:{}},'audits'),error=>error.code==='PDF_GENERATION_FAILED');
 const artifact=await complete.service.reportArtifact({user:actor,query:{}},'audits');
 assert.equal(artifact.sourceCount,3);assert.match(artifact.sourceHash,/^[a-f0-9]{64}$/);assert.equal(artifact.contentType,'application/pdf');assert.match(artifact.filename,/\.pdf$/);
 const validation=await pdf.validatePdf(artifact.buffer,{expectedText:['Internal audit register',...rows.map(row=>row.audit_no)]});assert(validation.pages>=1);
 const markers=Array.from({length:250},(_,i)=>'ROWMARK'+String(i).padStart(4,'0'));const long=fixture({rows:[{id:77,ncr_no:'NCR-LONG-REGISTER',description:markers.join(' '),severity:'MINOR',status:'OPEN',closed_at:null,created_at:'2026-10-25'}],total:1});const longPdf=await long.service.reportArtifact({user:actor,query:{}},'ncrs');const longValidation=await pdf.validatePdf(longPdf.buffer,{expectedText:['NCR-LONG-REGISTER',...markers]});assert(longValidation.pages>1,'A valid long record continues across pages without truncation');
 console.log('QMS register tests passed: explicit read authority; validated filters/sort/pagination; literal search; own/global alert scope; read-only consistent count/page snapshots; incomplete/duplicate/overlarge reports blocked; clear schema failure; actual parser-validated register PDF identity and rows. Fixtures only, no email.');
})().catch(error=>{console.error(error);process.exitCode=1;});

