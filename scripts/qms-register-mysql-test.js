'use strict';
// Append after retained-mysql-test.js. This script only writes disposable, local CI fixtures.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
if(process.env.NODE_ENV!=='test'||process.env.REPAIR_DB_TEST!=='true')throw new Error('QMS MySQL proof requires NODE_ENV=test and REPAIR_DB_TEST=true.');
if(process.env.MYSQL_TEST_DATABASE_URL){
 if(process.env.DATABASE_URL&&process.env.DATABASE_URL!==process.env.MYSQL_TEST_DATABASE_URL)throw new Error('Refusing a non-test inherited database URL.');
 process.env.DATABASE_URL=process.env.MYSQL_TEST_DATABASE_URL;
}
const options=require('../config/databaseConfig').buildDatabaseConfig(process.env).options;
if(options.database!=='voxelveda_repair_test'||!['127.0.0.1','localhost','::1','mysql'].includes(options.host))throw new Error('QMS proof only supports the existing disposable local voxelveda_repair_test database.');
process.env.OBJECT_STORAGE_DOCUMENTS_ENABLED='false';
const pool=require('../config/db'),registers=require('../services/qmsRegisterService'),enterprise=require('../controllers/qmsEnterpriseController'),pdf=require('../services/documentPdfService');
const prefix='QMS-PAGE-'+crypto.randomBytes(5).toString('hex').toUpperCase();
const proof=process.env.QMS_PROOF_DIR||path.join('/tmp','voxelveda-qms-register-proof');
function response(){return{statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
async function ack(user,id){const res=response();await enterprise.acknowledgeNotification({user,params:{id},body:{},ip:'127.0.0.1',get:()=>null},res,error=>{throw error;});return res;}
async function machineContextMysql(user) {
 const controller=require('../controllers/qmsShopFloorController'),ids=[];
 try {
  for(const label of ['main','other']){
   const [result]=await pool.query("INSERT INTO equipment_assets(equipment_code,description,status,commissioned) VALUES(?,?,'READY',1)",[prefix+'-MACHINE-'+label,'Synthetic machine context '+label]);ids.push(result.insertId);
  }
  const [machine,otherMachine]=ids;
  for(const [equipment,name] of [[machine,'Original safety plan'],[machine,'Second saved plan'],[otherMachine,'Other machine plan']])await pool.query('INSERT INTO maintenance_plans(equipment_id,plan_name,next_due_date,blocking_when_overdue,active) VALUES(?,?,?,1,1)',[equipment,prefix+' '+name,'2000-01-01']);
  const unresolved=[];
  for(const [equipment,status,severity,label] of [[machine,'OPEN','HIGH','first'],[machine,'CONTAINED','MEDIUM','second'],[machine,'RESOLVED','CRITICAL','resolved'],[otherMachine,'OPEN','HIGH','other']]){
   const [result]=await pool.query('INSERT INTO equipment_faults(equipment_id,status,severity,description,reported_at) VALUES(?,?,?,?,?)',[equipment,status,severity,prefix+' '+label,'2026-10-28 09:00:00']);if(equipment===machine&&status!=='RESOLVED')unresolved.unshift(result.insertId);
  }
  for(const [equipment,active,label] of [[machine,1,'active'],[machine,0,'released'],[otherMachine,1,'other']])await pool.query('INSERT INTO loto_permits(permit_no,equipment_id,reason,active,zero_energy_verified) VALUES(?,?,?,?,1)',[prefix+'-LOTO-'+label,equipment,'Synthetic locked-out machine',active]);
  const sourceRows=async()=>Promise.all(['equipment_assets','maintenance_plans','equipment_faults','loto_permits'].map(table=>pool.query(`SELECT * FROM ${table} WHERE ${table==='equipment_assets'?'id':'equipment_id'} IN (?,?) ORDER BY id`,ids).then(result=>result[0])));
  const original=JSON.stringify(await sourceRows());
  const res=response();await controller.machineContext({user,params:{id:String(machine)}},res,error=>{throw error;});
  assert.equal(res.statusCode,200);assert.equal(Number(res.body.machine.id),machine);assert.equal(res.body.allowed,false);assert(res.body.reasons.includes('An active LOTO permit exists.'));assert(res.body.reasons.includes('Blocking preventive maintenance is overdue.'));assert(res.body.reasons.includes('A high or critical machine fault is unresolved.'));
  assert.deepEqual(res.body.maintenance.map(row=>row.plan_name),[prefix+' Original safety plan',prefix+' Second saved plan']);assert(res.body.maintenance.every(row=>!Object.hasOwn(row,'maintenance_type')),'Return actual saved plan names rather than an invented schema field');
  assert.deepEqual(res.body.faults.map(row=>Number(row.id)),unresolved,'Actual reported_at/id ordering is stable, unresolved and machine-specific');assert.equal(res.body.loto.length,1);assert.equal(res.body.loto[0].permit_no,prefix+'-LOTO-active');
  const missing=response();await controller.machineContext({user,params:{id:'-1'}},missing,error=>{throw error;});assert.equal(missing.statusCode,404);assert.equal(missing.body.code,'MACHINE_NOT_FOUND');assert(!missing.body.maintenance);
  assert.equal(JSON.stringify(await sourceRows()),original,'Reading readiness/context never changes plans, faults, LOTO or machine state');
  return {machine_context_actual_sql:true,machine_plan_names_verified:res.body.maintenance.length,machine_unresolved_faults_verified:res.body.faults.length,machine_active_loto_verified:res.body.loto.length,machine_safety_blockers_preserved:true,machine_missing_404:true,machine_context_sources_unchanged:true};
 } finally {
  if(ids.length){const marks=ids.map(()=>'?').join(',');for(const table of ['loto_permits','equipment_faults','maintenance_plans'])await pool.query(`DELETE FROM ${table} WHERE equipment_id IN (${marks})`,ids);await pool.query(`DELETE FROM equipment_assets WHERE id IN (${marks})`,ids);}
 }
}
(async()=>{
 const [[existing]]=await pool.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?,?,?)',['internal_audits','qms_notifications','qms_records','audit_logs']);assert.equal(Number(existing.n),4,'Run the original disposable MySQL setup first');
 const [[highest]]=await pool.query('SELECT MAX(id) highest FROM users');const ownerId=Number(highest.highest||0)+10,otherId=ownerId+1;
 assert(Number.isSafeInteger(ownerId)&&otherId<2147483647);
 for(const [id,label] of [[ownerId,'owner'],[otherId,'other']])await pool.query('INSERT INTO users(id,name,username,email,password,role,permissions,active) VALUES(?,?,?,?,?,?,?,1)',[id,'Synthetic quality '+label,prefix+'-'+label,label+'-'+prefix+'@example.invalid','not-a-login-hash','isolated-fixture',JSON.stringify(['VIEW_QMS','REVIEW_QMS'])]);
 const owner={id:ownerId,role:'isolated-fixture',permissions:['VIEW_QMS','REVIEW_QMS']},other={id:otherId,role:'isolated-fixture',permissions:['VIEW_QMS','REVIEW_QMS']};
 const auditRows=Array.from({length:650},(_,i)=>[prefix+'-'+String(i).padStart(4,'0'),prefix+' inspection '+String(i).padStart(4,'0'),i%4===0?'CLOSED':'PLANNED','2026-10-25 09:00:00',ownerId,'2026-10-25 08:00:00']);
 await pool.query('INSERT INTO internal_audits(audit_no,title,status,scheduled_at,created_by,created_at) VALUES ?',[auditRows]);
 const page1=await registers.listRegister({user:owner,query:{search:prefix,sort:'audit_no',direction:'asc',page:'1',limit:'25'}},'audits');assert.equal(page1.pagination.total,650);assert.equal(page1.pagination.pages,26);assert.equal(page1.audits.length,25);
 const all=[];for(let page=1;page<=26;page++){const batch=await registers.listRegister({user:owner,query:{search:prefix,sort:'audit_no',direction:'asc',page:String(page),limit:'25'}},'audits');assert.equal(batch.pagination.total,650);all.push(...batch.audits);}
 assert.equal(new Set(all.map(row=>row.id)).size,650);assert.deepEqual(all.map(row=>row.audit_no),auditRows.map(row=>row[0]));
 const filtered=await registers.listRegister({user:owner,query:{search:prefix,status:'PLANNED',sort:'audit_no',direction:'desc',limit:'100',from_date:'2026-10-25',to_date:'2026-10-25'}},'audits');assert.equal(filtered.pagination.total,auditRows.filter(row=>row[2]==='PLANNED').length);assert(filtered.audits.every(row=>row.status==='PLANNED'));assert.equal(filtered.audits[0].audit_no,auditRows.at(-1)[0]);
 const after=await registers.listRegister({user:owner,query:{search:prefix,from_date:'2026-10-26'}},'audits');assert.equal(after.pagination.total,0);
 await assert.rejects(registers.listRegister({user:{id:ownerId,role:'isolated-fixture',permissions:[]},query:{}},'audits'),error=>error.status===403);
 const snapshotPrefix='QMS-SNAPSHOT-'+crypto.randomBytes(5).toString('hex');await pool.query('INSERT INTO internal_audits(audit_no,title,status,created_by) VALUES ?',[Array.from({length:2},(_,i)=>[snapshotPrefix+'-'+i,snapshotPrefix+' original '+i,'PLANNED',ownerId])]);
 const actualGet=pool.getConnection.bind(pool);let snapshotHook=false;
 try{
  pool.getConnection=async()=>{const connection=await actualGet();return{async query(sql,args){const result=await connection.query(sql,args);if(!snapshotHook&&sql.startsWith('SELECT COUNT(*) total FROM internal_audits')){snapshotHook=true;await assert.rejects(connection.query('INSERT INTO internal_audits(audit_no,title,status,created_by) VALUES(?,?,?,?)',[snapshotPrefix+'-forbidden',snapshotPrefix+' forbidden write','PLANNED',ownerId]),error=>error.code==='ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION');const writer=await actualGet();try{await writer.query('INSERT INTO internal_audits(audit_no,title,status,created_by) VALUES(?,?,?,?)',[snapshotPrefix+'-late',snapshotPrefix+' concurrent late row','PLANNED',ownerId]);}finally{writer.release();}}return result;},beginTransaction:()=>connection.beginTransaction(),commit:()=>connection.commit(),rollback:()=>connection.rollback(),release:()=>connection.release()};};
  const consistent=await registers.listRegister({user:owner,query:{search:snapshotPrefix,limit:'100'}},'audits');assert.equal(consistent.pagination.total,2);assert.equal(consistent.audits.length,2);assert(!consistent.audits.some(row=>row.audit_no.endsWith('-late')),'A later committed row cannot change the same report/page snapshot');
 }finally{pool.getConnection=actualGet;}
 assert(snapshotHook);const [[afterSnapshot]]=await pool.query('SELECT COUNT(*) n FROM internal_audits WHERE audit_no LIKE ?',[snapshotPrefix+'%']);assert.equal(Number(afterSnapshot.n),3,'The independent concurrent insert really committed');
 const notices=[];for(const [target,label,count] of [[null,'global',2],[ownerId,'owner',3],[otherId,'other',5]])for(let i=0;i<count;i++)notices.push([prefix+'-'+label+'-'+i,'QMS_FIXTURE','INFO',prefix+' '+label+' '+i,'Synthetic private quality alert only','QMS_FIXTURE',String(i),target]);
 await pool.query('INSERT INTO qms_notifications(dedupe_key,notification_type,severity,title,body,record_type,record_id,target_user_id) VALUES ?',[notices]);
 const own=await registers.listRegister({user:owner,query:{search:prefix,limit:'100'}},'notifications'),foreign=await registers.listRegister({user:other,query:{search:prefix,limit:'100'}},'notifications');assert.equal(own.pagination.total,5);assert.equal(foreign.pagination.total,7);assert(own.notifications.every(row=>row.target_user_id==null||Number(row.target_user_id)===ownerId));assert(!own.notifications.some(row=>row.title.includes(' other ')));
 const otherNotice=foreign.notifications.find(row=>Number(row.target_user_id)===otherId),ownNotice=own.notifications.find(row=>Number(row.target_user_id)===ownerId);
 assert.equal((await ack(owner,otherNotice.id)).statusCode,404);const [[untouched]]=await pool.query('SELECT acknowledged_at FROM qms_notifications WHERE id=?',[otherNotice.id]);assert.equal(untouched.acknowledged_at,null);
 assert.equal((await ack(owner,ownNotice.id)).statusCode,200);assert.equal((await ack(owner,ownNotice.id)).body.unchanged,true);const remaining=await registers.listRegister({user:owner,query:{search:prefix}},'notifications');assert.equal(remaining.pagination.total,4);
 const accepted=await registers.listRegister({user:owner,query:{search:prefix,acknowledged:'read'}},'notifications');assert.equal(accepted.pagination.total,1);assert.equal(accepted.notifications[0].id,ownNotice.id);
 const metrics=response();await enterprise.commandCentre({user:owner},metrics,error=>{throw error;});const [[expected]]=await pool.query('SELECT COUNT(*) n FROM qms_notifications WHERE acknowledged_at IS NULL AND (target_user_id IS NULL OR target_user_id=?)',[ownerId]);assert.equal(metrics.body.metrics.unacknowledgedNotifications,Number(expected.n));
 const report=await registers.reportArtifact({user:owner,query:{search:prefix,sort:'audit_no',direction:'asc'}},'audits');assert.equal(report.sourceCount,650);const validation=await pdf.validatePdf(report.buffer,{expectedText:[auditRows[0][0],auditRows[299][0],auditRows[649][0]]});assert(validation.pages>1);
 const immutable=crypto.createHash('sha256').update(report.buffer).digest('hex');await pool.query('UPDATE internal_audits SET title=? WHERE audit_no=?',[prefix+' corrected title',auditRows[0][0]]);const revised=await registers.reportArtifact({user:owner,query:{search:prefix,sort:'audit_no',direction:'asc'}},'audits');assert.notEqual(revised.sourceHash,report.sourceHash);assert.equal(crypto.createHash('sha256').update(report.buffer).digest('hex'),immutable,'An existing report edition remains unchanged after a saved source correction');
 const notificationPdf=await registers.reportArtifact({user:owner,query:{search:prefix,acknowledged:'all'}},'notifications');assert.equal(notificationPdf.sourceCount,5);const noticeText=await pdf.validatePdf(notificationPdf.buffer,{expectedText:[prefix+' owner 0',prefix+' global 0']});assert(!noticeText.text.includes(prefix+' other'),'Another employee alert cannot enter the PDF');
 const longMarkers=Array.from({length:250},(_,i)=>'QMSROW'+String(i).padStart(4,'0'));await pool.query('INSERT INTO ncrs(ncr_no,status,severity,description,created_by) VALUES(?,?,?,?,?)',[prefix+'-LONG','OPEN','MINOR',longMarkers.join(' '),ownerId]);const longReport=await registers.reportArtifact({user:owner,query:{search:prefix+'-LONG'}},'ncrs');const longValidation=await pdf.validatePdf(longReport.buffer,{expectedText:[prefix+'-LONG',...longMarkers]});assert(longValidation.pages>1);
 for(const meta of registers.catalog(owner)){const result=await registers.listRegister({user:owner,query:{limit:'1'}},meta.name);assert(Number.isSafeInteger(result.pagination.total),'Every advertised register executes against its actual schema');}
 const machineProof=await machineContextMysql(owner);
 await fs.promises.mkdir(proof,{recursive:true});await fs.promises.writeFile(path.join(proof,'complete-quality-audit-register.pdf'),report.buffer);await fs.promises.writeFile(path.join(proof,'complete-long-quality-record.pdf'),longReport.buffer);await fs.promises.writeFile(path.join(proof,'private-quality-alert-register.pdf'),notificationPdf.buffer);await fs.promises.writeFile(path.join(proof,'qms-register-mysql.json'),JSON.stringify({fixture_only:true,local_database_only:true,audit_rows:650,pages_traversed:26,complete_report_records:650,pdf_pages:validation.pages,first_and_300th_and_last_record_verified:true,filtered_planned_total:filtered.pagination.total,own_alerts:5,other_alerts:7,readonly_write_rejected:true,concurrent_insert_snapshot_consistent:true,other_recipient_ack_denied:true,own_ack_idempotent:true,source_revision_changes_hash:true,long_record_pages:longValidation.pages,long_record_markers_verified:longMarkers.length,advertised_registers_checked:registers.catalog(owner).length,no_email_sent:true},null,2));
 await fs.promises.writeFile(path.join(proof,'shop-floor-machine-mysql.json'),JSON.stringify({fixture_only:true,local_database_only:true,...machineProof,no_email_sent:true},null,2));
 console.log('QMS MYSQL PROOF PASSED: 650 retained-schema audit fixtures, 26 complete pages, full parsed PDF, filters/sort/dates/counts, immutable report editions, own/global alerts only, forbidden foreign acknowledgement, idempotent own acknowledgement, every advertised register SQL schema and actual machine-context maintenance/fault/LOTO SQL with preserved safety gates. Disposable CI fixtures only; no mail.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pool.end());

