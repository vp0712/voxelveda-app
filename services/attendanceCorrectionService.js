'use strict';
const pool=require('../config/db');
const {ensureAttendanceMobileSchema}=require('./attendanceMobileSchema');
const attendanceTime=require('./attendanceTimeService');
const {hasPermission,isManagerOf}=require('./authorizationService');
const {logAudit}=require('./auditService');
const {createNotification}=require('./notificationService');
const {dateOnly}=require('../utils/dateOnly');
const p=require('./attendanceMobilePolicy');
const CORRECTION_SELECT="c.*,u.name AS staff_name,a.deleted AS attendance_deleted,DATE_FORMAT(c.created_at,'%Y-%m-%d %H:%i:%s') created_at_utc_text,DATE_FORMAT(c.decided_at,'%Y-%m-%d %H:%i:%s') decided_at_utc_text";
function publicCorrection(row){const before=p.parsed(row.before_json);return{...row,correction_type:before===null?'MISSING_SESSION':'UPDATE_SESSION',proposed:p.parsed(row.proposed_json),before,proposed_json:undefined,before_json:undefined,payload_sha256:undefined,revision:Number(row.revision),attendance_revision:row.attendance_revision==null?null:Number(row.attendance_revision),created_at:p.instant(row.created_at_utc_text??row.created_at)?.toISO()||null,decided_at:p.instant(row.decided_at_utc_text??row.decided_at)?.toISO()||null,created_at_utc_text:undefined,decided_at_utc_text:undefined};}
async function canReview(user,target,db=pool){if(Number(user.id)===Number(target))return false;if(hasPermission(user,'EDIT_ATTENDANCE')||hasPermission(user,'APPROVE_ALL_TIMESHEETS'))return true;return hasPermission(user,'APPROVE_TEAM_TIMESHEET')&&await isManagerOf(user.id,target,db);}
function scopedWhere(user,scope='own'){
 const global=hasPermission(user,'EDIT_ATTENDANCE')||hasPermission(user,'APPROVE_ALL_TIMESHEETS');
 if(scope==='all'){if(!global)throw p.fail('All-staff correction access is not enabled.','ATTENDANCE_CORRECTION_ACCESS_DENIED',403);return{sql:'1=1',params:[]};}
 if(scope==='team'){if(!global&&!hasPermission(user,'APPROVE_TEAM_TIMESHEET'))throw p.fail('Team correction access is not enabled.','ATTENDANCE_CORRECTION_ACCESS_DENIED',403);return{sql:'u.manager_id=? AND c.user_id<>? AND u.active=1 AND u.deleted_at IS NULL',params:[Number(user.id),Number(user.id)]};}
 if(scope!=='own')throw p.fail('Choose own, team or all corrections.','ATTENDANCE_FILTER_INVALID');return{sql:'c.user_id=?',params:[Number(user.id)]};
}
async function getCorrection({user,id,db=pool}){
 p.actor(user);await ensureAttendanceMobileSchema();
 const [[row]]=await db.query(`SELECT ${CORRECTION_SELECT} FROM attendance_correction_requests c JOIN users u ON u.id=c.user_id LEFT JOIN staff_attendance a ON a.id=c.attendance_id WHERE c.id=?`,[p.positiveId(id,'correction_id')]);
 if(!row||Number(row.user_id)!==Number(user.id)&&!await canReview(user,row.user_id,db))throw p.fail('This correction is unavailable within your access.','ATTENDANCE_CORRECTION_NOT_FOUND',404);
 return{correction:{...publicCorrection(row),attendance_deleted:Boolean(Number(row.attendance_deleted)),can_review:row.status==='PENDING'&&!Number(row.attendance_deleted)&&await canReview(user,row.user_id,db)}};
}
async function listCorrections({user,query={}}){
 p.actor(user);await ensureAttendanceMobileSchema();const page=Number(query.page||1),size=Number(query.page_size||25);if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100||(page-1)*size>10000000)throw p.fail('Choose a valid correction page.','ATTENDANCE_PAGINATION_INVALID');
 const scope=scopedWhere(user,String(query.scope||'own').toLowerCase()),clauses=[scope.sql],params=[...scope.params];
 if(query.status&&String(query.status).toUpperCase()!=='ALL'){const status=String(query.status).toUpperCase();if(!['PENDING','APPROVED','REJECTED'].includes(status))throw p.fail('Choose a valid correction status.','ATTENDANCE_FILTER_INVALID');clauses.push('c.status=?');params.push(status);}
 const [[count]]=await pool.query(`SELECT COUNT(*) total FROM attendance_correction_requests c JOIN users u ON u.id=c.user_id WHERE ${clauses.join(' AND ')}`,params);
 const [rows]=await pool.query(`SELECT ${CORRECTION_SELECT} FROM attendance_correction_requests c JOIN users u ON u.id=c.user_id LEFT JOIN staff_attendance a ON a.id=c.attendance_id WHERE ${clauses.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,[...params,size,(page-1)*size]);
 return{corrections:await Promise.all(rows.map(async row=>({...publicCorrection(row),attendance_deleted:Boolean(Number(row.attendance_deleted)),can_review:row.status==='PENDING'&&!Number(row.attendance_deleted)&&await canReview(user,row.user_id)}))),scope:String(query.scope||'own').toLowerCase(),page,page_size:size,total:Number(count.total),pages:Math.max(1,Math.ceil(Number(count.total)/size))};
}
async function effectiveBreaks(db,attendanceId){const [rows]=await db.query("SELECT *,DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s') started_at_utc_text,DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s') ended_at_utc_text FROM attendance_break_intervals WHERE attendance_id=? AND superseded_at IS NULL ORDER BY id FOR UPDATE",[attendanceId]);return rows;}
async function supersedeBreaks(db,{attendanceId,actorId,attendanceRevision,correctionId=null,now=new Date()}){const rows=await effectiveBreaks(db,attendanceId);if(rows.length)await db.query('UPDATE attendance_break_intervals SET superseded_at=?,superseded_by=?,superseded_attendance_revision=?,superseded_by_correction_id=? WHERE attendance_id=? AND superseded_at IS NULL',[attendanceTime.sqlUtc(p.utcNow(now)),actorId,attendanceRevision,correctionId,attendanceId]);return rows;}
async function requestCorrection({user,input,req,now=new Date()}){
 const userId=p.actor(user),requestId=p.requestId(input.request_id),kind=String(input.correction_type||'UPDATE_SESSION').toUpperCase();
 if(!['UPDATE_SESSION','MISSING_SESSION'].includes(kind))throw p.fail('Choose a recorded-session correction or missing session.','ATTENDANCE_CORRECTION_TYPE_INVALID');
 const attendanceId=kind==='MISSING_SESSION'?null:p.positiveId(input.attendance_id);if(kind==='MISSING_SESSION'&&input.attendance_id!=null)throw p.fail('A missing-session request cannot replace another attendance record.','ATTENDANCE_CORRECTION_TYPE_INVALID');
 const reason=p.text(input.reason,'reason',1000,true),notes=p.text(input.notes,'notes',10000),payloadHash=p.hash({correction_type:kind,attendance_id:attendanceId,expected_revision:kind==='MISSING_SESSION'?null:Number(input.expected_revision),clock_in:input.clock_in,clock_out:input.clock_out,break_minutes:input.break_minutes,notes,reason});await ensureAttendanceMobileSchema();const db=await pool.getConnection();let output;
 try{
  await db.beginTransaction();await db.query('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const [[prior]]=await db.query('SELECT * FROM attendance_correction_requests WHERE user_id=? AND request_id=?',[userId,requestId]);
  if(prior){if(prior.payload_sha256!==payloadHash)throw p.fail('This correction request ID was already used with other values.','ATTENDANCE_IDEMPOTENCY_CONFLICT',409);await db.commit();return{correction:publicCorrection(prior),existing:true};}
  let before=null,breaks=[];
  if(attendanceId){[[before]]=await db.query(`SELECT ${p.SELECT} FROM staff_attendance a WHERE a.id=? AND a.user_id=? AND IFNULL(a.deleted,0)=0 FOR UPDATE`,[attendanceId,userId]);if(!before)throw p.fail('This attendance session is unavailable.','ATTENDANCE_SESSION_NOT_FOUND',404);p.revision(input.expected_revision,before.revision);breaks=await effectiveBreaks(db,attendanceId);}
  const entry=attendanceTime.manualWorkedEntry({...input,break_minutes:Object.hasOwn(input,'break_minutes')?input.break_minutes:before?.break_minutes},userId,now);
  const proposed={clock_in:p.instant(entry.clock_in).toISO({suppressMilliseconds:true}),clock_out:entry.clock_out?p.instant(entry.clock_out).toISO({suppressMilliseconds:true}):null,break_minutes:entry.break_minutes,notes:Object.hasOwn(input,'notes')?notes:before?.notes||null};
  const beforeSnapshot=before?{...p.publicAttendance(before),break_intervals:breaks.map(row=>({...row,started_at:p.instant(row.started_at_utc_text).toISO(),ended_at:p.instant(row.ended_at_utc_text)?.toISO()||null}))}:null;
  const [insert]=await db.query('INSERT INTO attendance_correction_requests(user_id,attendance_id,request_id,payload_sha256,attendance_revision,reason,proposed_json,before_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',[userId,attendanceId,requestId,payloadHash,before?Number(before.revision):null,reason,JSON.stringify(proposed),JSON.stringify(beforeSnapshot),attendanceTime.sqlUtc(p.utcNow(now))]);
  await logAudit(db,{...p.auditMeta(user,req),action:'ATTENDANCE_CORRECTION_REQUESTED',recordId:attendanceId||`correction:${insert.insertId}`,oldValue:beforeSnapshot,newValue:{correction_id:insert.insertId,correction_type:kind,proposed,reason}});
  const [[manager]]=await db.query('SELECT m.id,m.role,m.permissions FROM users u JOIN users m ON m.id=u.manager_id WHERE u.id=? AND m.active=1 AND m.deleted_at IS NULL',[userId]);
  if(manager&&await canReview(manager,userId,db))await createNotification(db,{userId:manager.id,type:'ATTENDANCE_CORRECTION',category:'HR',title:'Attendance correction needs review',message:'An assigned team member requested a correction to recorded attendance.',linkedModule:'ATTENDANCE_CORRECTIONS',linkedRecordId:insert.insertId,actionUrl:'/dashboard?view=attendance',dedupeKey:`attendance-correction:${insert.insertId}:requested`});
  const [[saved]]=await db.query('SELECT * FROM attendance_correction_requests WHERE id=?',[insert.insertId]);output={correction:publicCorrection(saved),existing:false};await db.commit();
 }catch(error){await db.rollback();throw error;}finally{db.release();}return output;
}
async function assertMutablePeriod(db,userId,dates){
 const values=[...new Set(dates.filter(Boolean))];if(!values.length)return;
 const where=values.map(()=>'(wt.week_start<=? AND wt.week_end>=?)').join(' OR '),params=values.flatMap(date=>[date,date]);
 const [locked]=await db.query(`SELECT wt.id,wt.status,wt.payroll_status,pr.status AS payroll_ready_status,pr.locked_at,pr.processed_at,pr.exported_at FROM weekly_timesheets wt LEFT JOIN payroll_ready pr ON pr.timesheet_id=wt.id WHERE wt.user_id=? AND (${where}) FOR UPDATE`,[userId,...params]);
 if(locked.some(row=>['APPROVED','PAYROLL_PROCESSED','LOCKED'].includes(String(row.status).toUpperCase())||['PROCESSED','LOCKED','EXPORTED'].includes(String(row.payroll_ready_status||row.payroll_status).toUpperCase())||row.locked_at||row.processed_at||row.exported_at))throw p.fail('This period is approved or payroll locked. Attendance was not changed; a separately authorised versioned amendment is required.','ATTENDANCE_PERIOD_LOCKED',409);
}
async function decideCorrection({user,id,input,decision,req,now=new Date()}){
 p.actor(user);const correctionId=p.positiveId(id,'correction_id'),reason=p.text(input.reason,'reason',1000,true);if(!['APPROVED','REJECTED'].includes(decision))throw p.fail('Choose approve or reject.','ATTENDANCE_CORRECTION_ACTION_INVALID');await ensureAttendanceMobileSchema();
 const [[identity]]=await pool.query('SELECT user_id,attendance_id FROM attendance_correction_requests WHERE id=?',[correctionId]);if(!identity||!await canReview(user,identity.user_id))throw p.fail('This correction is unavailable within your review authority.','ATTENDANCE_CORRECTION_ACCESS_DENIED',403);const db=await pool.getConnection();let output;
 try{
  await db.beginTransaction();await db.query('SELECT id FROM users WHERE id=? FOR UPDATE',[identity.user_id]);if(!await canReview(user,identity.user_id,db))throw p.fail('Your review authority changed. Refresh before retrying.','ATTENDANCE_CORRECTION_ACCESS_DENIED',403);
  let before=null;if(identity.attendance_id){[[before]]=await db.query(`SELECT ${p.SELECT} FROM staff_attendance a WHERE a.id=? AND a.user_id=? AND IFNULL(a.deleted,0)=0 FOR UPDATE`,[identity.attendance_id,identity.user_id]);if(!before)throw p.fail('The attendance session is archived or unavailable.','ATTENDANCE_SESSION_NOT_FOUND',404);}
  const [[correction]]=await db.query('SELECT * FROM attendance_correction_requests WHERE id=? FOR UPDATE',[correctionId]);if(!correction||Number(correction.user_id)!==Number(identity.user_id)||Number(correction.attendance_id||0)!==Number(identity.attendance_id||0))throw p.fail('The correction identity changed. Refresh before retrying.','ATTENDANCE_CORRECTION_CONFLICT',409);
  if(correction.status!=='PENDING'){if(correction.status===decision){await db.commit();return{correction:publicCorrection(correction),attendance:p.publicAttendance(before),existing:true};}throw p.fail('This correction has already received a different decision.','ATTENDANCE_CORRECTION_DECIDED',409);}
  p.revision(input.expected_revision,correction.revision);let after=before,entry,superseded=[];
  if(decision==='APPROVED'){
   if(before)p.revision(correction.attendance_revision,before.revision);const proposed=p.parsed(correction.proposed_json);entry=attendanceTime.manualWorkedEntry(proposed,user.id,now);await assertMutablePeriod(db,identity.user_id,[dateOnly(before?.work_date),entry.work_date]);
   const [overlaps]=await db.query('SELECT id FROM staff_attendance WHERE user_id=? AND IFNULL(deleted,0)=0 AND id<>? AND clock_in<? AND (clock_out IS NULL OR clock_out>?) FOR UPDATE',[identity.user_id,before?.id||0,entry.clock_out||attendanceTime.sqlUtc(p.utcNow(now)),entry.clock_in]);if(overlaps.length)throw p.fail('The corrected interval overlaps another retained session. Review both records.','ATTENDANCE_CORRECTION_OVERLAP',409);
   if(!entry.clock_out){const [[otherOpen]]=await db.query('SELECT id FROM staff_attendance WHERE user_id=? AND IFNULL(deleted,0)=0 AND clock_out IS NULL AND id<>? FOR UPDATE',[identity.user_id,before?.id||0]);if(otherOpen)throw p.fail('Another session is still active.','ATTENDANCE_SESSION_CONFLICT',409);}
   const fields=['clock_in','clock_out','work_date','total_minutes','total_hours','break_minutes','entry_source','timestamp_basis','clock_out_timestamp_basis','recorded_timezone','manual_authorised_by','manual_authorised_at','attendance_status','review_required','review_reason'];
   let recordId=before?.id;
   if(before){superseded=await supersedeBreaks(db,{attendanceId:before.id,actorId:user.id,attendanceRevision:Number(before.revision)+1,correctionId,now});await db.query(`UPDATE staff_attendance SET ${fields.map(field=>`${field}=?`).join(',')},notes=?,break_tracking_base_minutes=NULL,revision=revision+1 WHERE id=?`,[...fields.map(field=>entry[field]),proposed.notes,before.id]);}
   else{const [insert]=await db.query(`INSERT INTO staff_attendance(user_id,${fields.join(',')},notes,revision) VALUES(${Array(fields.length+2).fill('?').join(',')},1)`,[identity.user_id,...fields.map(field=>entry[field]),proposed.notes]);recordId=insert.insertId;}
   const [[row]]=await db.query(`SELECT ${p.SELECT} FROM staff_attendance a WHERE a.id=?`,[recordId]);after=row;
  }
  await db.query('UPDATE attendance_correction_requests SET status=?,attendance_id=?,decision_reason=?,decided_by=?,decided_at=?,revision=revision+1 WHERE id=?',[decision,after?.id||null,reason,user.id,attendanceTime.sqlUtc(p.utcNow(now)),correctionId]);
  await logAudit(db,{...p.auditMeta(user,req),action:`ATTENDANCE_CORRECTION_${decision}`,recordId:after?.id||`correction:${correctionId}`,oldValue:before?{...p.publicAttendance(before),break_intervals:superseded}:null,newValue:{attendance:p.publicAttendance(after),correction_id:correctionId,decision,reason,superseded_break_ids:superseded.map(row=>row.id)}});
  await createNotification(db,{userId:identity.user_id,type:'ATTENDANCE_CORRECTION',category:'HR',title:decision==='APPROVED'?'Attendance correction approved':'Attendance correction rejected',message:reason,linkedModule:'ATTENDANCE_CORRECTIONS',linkedRecordId:correctionId,actionUrl:'/dashboard?view=attendance',dedupeKey:`attendance-correction:${correctionId}:${decision}`});
  const [[saved]]=await db.query('SELECT * FROM attendance_correction_requests WHERE id=?',[correctionId]);output={correction:publicCorrection(saved),attendance:p.publicAttendance(after),existing:false,previous_work_date:dateOnly(before?.work_date)||null,work_date:entry?.work_date||dateOnly(before?.work_date)||null,user_id:Number(identity.user_id),timesheet_status:decision==='APPROVED'?'pending_refresh':'unchanged'};await db.commit();
 }catch(error){await db.rollback();throw error;}finally{db.release();}return output;
}
module.exports={requestCorrection,listCorrections,getCorrection,decideCorrection,canReview,assertMutablePeriod,effectiveBreaks,supersedeBreaks};
