'use strict';
const assert=require('node:assert/strict');
const {mayViewDocument} = require('../services/documentSecurityService')._test;
const {mayViewDelivery}=require('../controllers/emailController')._test;
const user=(id,permissions=[])=>({id,role:'fixture_only',permissions});
const document=(module,fields={})=>({module,owner_user_id:7,record_type:'evidence',record_id:'42',classification:'PUBLIC',access_policy:'AUTHENTICATED',...fields});
async function main(){
 const globalViewer=user(8,['VIEW_CONFIDENTIAL_FILES']);
 const requirements={rfq:'VIEW_RFQS',invoices:'VIEW_FINANCE',customers:'VIEW_CUSTOMERS',suppliers:'VIEW_SUPPLIERS',procurement:'VIEW_PROCUREMENT',stock:'VIEW_INVENTORY',materials:'VIEW_INVENTORY',expenses:'VIEW_FINANCE',qms:'VIEW_QMS',compliance:'VIEW_COMPLIANCE',careers:'VIEW_STAFF_HR',staff:'VIEW_STAFF_HR'};
 for(const [module,permission] of Object.entries(requirements)){
  assert.equal(await mayViewDocument(globalViewer,document(module)),false,`${module} must not inherit generic confidential/public access`);
  assert.equal(await mayViewDocument(user(8),document(module)),false,`${module} public metadata must not bypass module permissions`);
  assert.equal(await mayViewDocument(user(8,[permission]),document(module)),true);
  assert.equal(await mayViewDocument(user(7),document(module)),true,'The recorded owner retains access');
 }
 assert.equal(await mayViewDocument(globalViewer,document('profile',{classification:'CONFIDENTIAL',access_policy:'MODULE_OR_OWNER'})),true);
 assert.equal(await mayViewDocument(user(8),document('security')),true,'Retained account/security PUBLIC behavior remains intact');
 assert.equal(await mayViewDocument(user(7),document('finance')),false,'Banking/Finance documents remain retired even for their owner');
 assert.equal(await mayViewDocument(null,document('rfq')),false);
 const teamDb={async query(sql,args){assert.match(sql,/SELECT manager_id FROM users/);assert.equal(args[0],7);return [[{manager_id:10}]];}};
 for(const module of ['attendance','timesheets','roster']){
  assert.equal(await mayViewDocument(user(10,['VIEW_TEAM_TIMESHEET']),document(module),teamDb),true);
  assert.equal(await mayViewDocument(user(11,['VIEW_TEAM_TIMESHEET']),document(module),teamDb),false);
  assert.equal(await mayViewDocument(user(8,['VIEW_OWN_TIMESHEET']),document(module)),false);
  assert.equal(await mayViewDocument(user(8,['VIEW_ALL_TIMESHEETS']),document(module)),true);
  assert.equal(await mayViewDocument(user(10,['VIEW_TEAM_TIMESHEET']),document(module,{owner_user_id:null})),false,'Unassigned team evidence fails closed');
 }
 const taskDb={async query(sql,args){assert.match(sql,/SELECT t.assigned_to,u.manager_id FROM tasks/);assert.equal(args[0],42);return [[{assigned_to:7,manager_id:10}]];}};
 const task=document('tasks',{record_type:'task',owner_user_id:null});
 assert.equal(await mayViewDocument(user(7,['VIEW_OWN_JOBS']),task,taskDb),true);
 assert.equal(await mayViewDocument(user(8,['VIEW_OWN_JOBS']),task,taskDb),false);
 assert.equal(await mayViewDocument(user(10,['MANAGE_TEAM_JOBS']),task,taskDb),true);
 assert.equal(await mayViewDocument(user(11,['MANAGE_TEAM_JOBS']),task,taskDb),false);
 assert.equal(await mayViewDelivery(user(8,['VIEW_FINANCE']),{related_module:'invoices',related_record_id:'42'}),true,'Authorised finance viewers can inspect their exact queued PDF');
 assert.equal(await mayViewDelivery(user(8,['MANAGE_COMPANY_EMAIL']),{related_module:'invoices',related_record_id:'42'}),false,'Queue management alone does not expose business documents');
 const deliveryDb={async query(sql){if(sql.includes('weekly_timesheets'))return [[{user_id:7}]];if(sql.includes('manager_id FROM users'))return [[{manager_id:10}]];throw new Error('Unexpected delivery fixture SQL');}};
 const delivery={related_module:'timesheets',related_record_id:'42'};
 assert.equal(await mayViewDelivery(user(7,['VIEW_OWN_TIMESHEET']),delivery,deliveryDb),true);
 assert.equal(await mayViewDelivery(user(8,['VIEW_OWN_TIMESHEET']),delivery,deliveryDb),false);
 assert.equal(await mayViewDelivery(user(10,['VIEW_TEAM_TIMESHEET']),delivery,deliveryDb),true);
 assert.equal(await mayViewDelivery(user(11,['VIEW_TEAM_TIMESHEET']),delivery,deliveryDb),false);
 assert.equal(await mayViewDelivery(user(7,['VIEW_OWN_TIMESHEET']),{related_module:'timesheets',related_record_id:'7:2026-10-01:2026-10-04'},deliveryDb),true);
 assert.equal(await mayViewDelivery(user(7,['VIEW_OWN_TIMESHEET']),{related_module:'timesheets',related_record_id:'all:2026-10-01:2026-10-04'},deliveryDb),false);
 const ownClient={id:31,role:'client',email:'own@example.invalid',permissions:['VIEW_RFQS','VIEW_FINANCE']};
 const customerDb={async query(sql){return [[sql.includes('FROM rfqs')?{email:'other@example.invalid'}:{customer_email:'other@example.invalid'}]];}};
 assert.equal(await mayViewDocument(ownClient,document('rfq',{owner_user_id:31}),customerDb),false,'Client owner metadata cannot bypass the RFQ customer relationship');
 assert.equal(await mayViewDocument(ownClient,document('invoices'),customerDb),false);
 const ownDb={async query(sql){return [[sql.includes('FROM rfqs')?{email:'OWN@example.invalid'}:{customer_email:'own@example.invalid'}]];}};
 assert.equal(await mayViewDocument(ownClient,document('rfq'),ownDb),true);
 assert.equal(await mayViewDocument(ownClient,document('invoices'),ownDb),true);
 assert.equal(await mayViewDelivery(ownClient,{related_module:'invoices',related_record_id:'statement:fixture',source_json:JSON.stringify({customerEmail:'other@example.invalid'})}),false);
 assert.equal(await mayViewDelivery(ownClient,{related_module:'invoices',related_record_id:'statement:fixture',source_json:JSON.stringify({customerEmail:'own@example.invalid'})}),true);
 console.log('Document isolation tests passed: original-module permission boundaries, public/confidential bypass prevention, preserved ownership, own/team HR and task scopes, exact queued PDF authorisation and retained account behavior.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
