'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const scopes=require('../services/retainedSecurityScopes');
const {retiredRequest}=require('../services/applicationRetirement');
function isolated(relative,dependencies){
 const fixture={exports:{}};
 const filename=path.resolve(__dirname,'..',relative);
 new vm.Script(fs.readFileSync(filename,'utf8'),{filename}).runInNewContext({module:fixture,exports:fixture.exports,Buffer,Date,Set,Map,JSON,Number,Object,console,process,require(name){if(!Object.hasOwn(dependencies,name))throw new Error('Unexpected scope fixture dependency: '+name);return dependencies[name];}});
 return fixture.exports;
}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
async function main(){
 for(const prefix of ['operations','assurance','governance'])assert.equal(retiredRequest('/api/security/'+prefix+'/summary'),false);
 for(const prefix of ['finance','banking','erp'])assert.equal(retiredRequest('/api/'+prefix+'/summary'),true);
 for(const value of [{module:'banking'},{export_type:'ACCOUNTANT_PACK'},{change_type:'FINANCE_CONFIGURATION'},{allowed_events:['BANKING_SYNC']},{event_payload:{linked_module:'erp'}},{parameters_json:'{"module":"finance"}'}]){
  // ACCOUNTANT_PACK is excluded by the explicit export allowlist.
  assert.ok(scopes.hasRetiredScope(value)||value.export_type==='ACCOUNTANT_PACK'&&!scopes.retainedExportType(value.export_type));
 }
 for(const value of [{module:'procurement'},{permission:'VIEW_FINANCE'},{permission:'VIEW_ATTENDANCE'},{event_payload:{linked_module:'qms'}}])assert.equal(scopes.hasRetiredScope(value),false,'Original scopes survive selective retirement');
 assert.deepEqual(scopes.filterScopedRows([{module:'rfq'},{module:'finance'},{module:'qms'},{module:'erp'}]),[{module:'rfq'},{module:'qms'}]);
 const reply=response();let proceeded=false;scopes.rejectRetiredSecurityScope({body:{event_payload:{module:'banking'}},query:{}},reply,()=>proceeded=true);assert.equal(reply.statusCode,410);assert.equal(proceeded,false);
 let selected={id:'fixture',export_type:'BANKING',requested_by:1,status:'PENDING_APPROVAL',expires_at:new Date(Date.now()+60000)},writes=0,audits=0;
 const db={async query(sql){if(/^SELECT \*/.test(sql))return [[selected]];if(/^UPDATE/.test(sql)){writes++;return [{affectedRows:0}];}throw new Error('Unexpected SQL '+sql);}};
 const operation=isolated('controllers/operationalTrustController.js',{
  crypto,'../config/db':db,'../services/operationalTrustSchema':{async ensureOperationalTrustSchema(){}},'../services/securityOperationsSchema':{async ensureSecurityOperationsSchema(){}},'../services/apiTokenService':{createApiToken(){}},'../services/authorizationService':require('../services/authorizationService'),'../services/auditService':{async logAudit(){audits++;}},'../services/sessionService':{async logSecurityEvent(){}},'../services/aiSecurityPolicy':require('../services/aiSecurityPolicy'),'../services/securityAlertService':{async evaluateSecurityAlerts(){return [];}},'../services/retainedSecurityScopes':scopes,'../services/securityDataScope':require('../services/securityDataScope'),'../services/applicationRetirement':require('../services/applicationRetirement')
 });
 const request={user:{id:2,role:'super_admin'},body:{reason:'Authorised test reason',confirmation:'APPROVE SENSITIVE EXPORT'},params:{id:'fixture'},get:()=>'',ip:'127.0.0.1'};
 let error;let res=response();await operation.approveExport(request,res,e=>error=e);assert.equal(error,undefined);assert.equal(res.statusCode,410);assert.equal(writes,0);assert.equal(audits,0,'Retired export must never activate or claim success');
 selected={...selected,export_type:'STAFF'};res=response();await operation.approveExport(request,res,e=>error=e);assert.equal(error,undefined);assert.equal(res.statusCode,409);assert.equal(writes,1);assert.equal(audits,0,'A lost concurrent approval must not create a success audit');
 const enterprise=isolated('controllers/enterpriseControlPlaneController.js',{
  crypto,'../config/db':db,'../services/enterpriseControlPlaneSchema':{async ensureEnterpriseControlPlaneSchema(){}},'../services/adaptiveRiskService':{scoreRequestRisk:()=>({})},'../services/auditService':{async logAudit(){audits++;}},'../services/retainedSecurityScopes':scopes
 });
 selected={id:'fixture',change_type:'ERP_WORKSPACE',requested_by:1,status:'PENDING_APPROVAL'};res=response();await enterprise.approveChange({...request,body:{confirmation:'APPROVE CONTROLLED CHANGE'}},res,e=>error=e);assert.equal(res.statusCode,410);assert.equal(writes,1);
 selected={...selected,change_type:'SECURITY_CONFIGURATION'};res=response();await enterprise.approveChange({...request,body:{confirmation:'APPROVE CONTROLLED CHANGE'}},res,e=>error=e);assert.equal(error,undefined);assert.equal(res.statusCode,409);assert.equal(writes,2);assert.equal(audits,0);
 console.log('Restored shared security scopes passed: original APIs retained, retired scopes/exports denied, historical and concurrent approvals cannot claim success.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
