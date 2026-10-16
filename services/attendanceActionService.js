'use strict';
const pool=require('../config/db');
const {ensureAttendanceMobileSchema}=require('./attendanceMobileSchema');
const attendanceTime=require('./attendanceTimeService');
const qr=require('./attendanceQrService');
const p=require('./attendanceMobilePolicy');
const {logAudit}=require('./auditService');
const {hasAnyPermission}=require('./authorizationService');
const {assertMutablePeriod}=require('./attendanceCorrectionService');
const ACTIONS=new Set(['CHECK_IN','CHECK_OUT','BREAK_START','BREAK_END']);
function periodDates(session){const dates=[session.work_date];const start=session.timestamp_basis==='UTC'?p.instant(session.clock_in_utc_text??session.clock_in):null;if(start)dates.push(p.workDate(start));const valid=[...new Set(dates.map(value=>require('../utils/dateOnly').dateOnly(value)).filter(Boolean))];if(!valid.length)throw p.fail('This older session has no verified reporting date. Request an authorised correction.','ATTENDANCE_DATE_UNVERIFIED',409);return valid;}
async function state(user,now){return require('./attendanceDailyService').readToday({user,now});}
async function loadSession(db,userId,attendanceId,lock=false){const [[row]]=await db.query(`SELECT ${p.SELECT} FROM staff_attendance a WHERE a.id=? AND a.user_id=? AND IFNULL(a.deleted,0)=0${lock?' FOR UPDATE':''}`,[attendanceId,userId]);if(!row)throw p.fail('This attendance session is unavailable.','ATTENDANCE_SESSION_NOT_FOUND',404);return row;}
async function activeSessions(db,userId,lock=false){const [rows]=await db.query(`SELECT ${p.SELECT} FROM staff_attendance a WHERE a.user_id=? AND IFNULL(a.deleted,0)=0 AND a.clock_out IS NULL ORDER BY a.id DESC LIMIT 2${lock?' FOR UPDATE':''}`,[userId]);if(rows.length>1)throw p.fail('Multiple unfinished sessions require an authorised correction.','ATTENDANCE_MULTIPLE_OPEN',409);return rows;}
async function latestSession(db,userId){const [[row]]=await db.query('SELECT id FROM staff_attendance WHERE user_id=? AND IFNULL(deleted,0)=0 ORDER BY id DESC LIMIT 1',[userId]);return row||null;}
const summaryOptions=require('./checkoutSummaryService');
// Keep the original hash shape for old pending clock/note requests. Only a
// populated new category ID extends the existing durable idempotency contract.
function noteFields(input){return{task_id:input.task_id==null||input.task_id===''?null:p.positiveId(input.task_id,'task_id'),category:p.text(input.category,'category',120),notes:p.text(input.notes,'notes',10000),...(input.category_id==null||input.category_id===''?{}:{category_id:p.positiveId(input.category_id,'category_id')})};}
async function receipt(db,userId,requestId){const [[row]]=await db.query('SELECT * FROM attendance_action_receipts WHERE user_id=? AND request_id=? LIMIT 1',[userId,requestId]);return row||null;}
async function breakSummary(db,session,now){const [rows]=await db.query("SELECT *,DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s') started_at_utc_text,DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s') ended_at_utc_text FROM attendance_break_intervals WHERE attendance_id=? AND user_id=? AND superseded_at IS NULL ORDER BY id FOR UPDATE",[session.id,session.user_id]);const open=rows.filter(row=>!row.ended_at);if(open.length>1)throw p.fail('Multiple unfinished breaks require an authorised correction.','ATTENDANCE_MULTIPLE_OPEN_BREAKS',409);let seconds=0;for(const row of rows){const start=p.instant(row.started_at_utc_text),end=row.ended_at?p.instant(row.ended_at_utc_text):now;if(!start||!end||end.toMillis()<start.toMillis())throw p.fail('Recorded break times need an authorised correction.','ATTENDANCE_BREAK_INVALID',409);seconds+=Math.floor((end.toMillis()-start.toMillis())/1000);}const base=Number(session.break_tracking_base_minutes??(rows.length?0:session.break_minutes??0));if(!Number.isSafeInteger(base)||base<0)throw p.fail('Recorded break minutes need an authorised correction.','ATTENDANCE_BREAK_INVALID',409);return{rows,open:open[0]||null,minutes:base+Math.floor(seconds/60)};}
async function resolveQr({user,input,now=new Date()}){const userId=p.actor(user);await ensureAttendanceMobileSchema();const action=String(input.action||'').toUpperCase();if(!['CHECK_IN','CHECK_OUT'].includes(action))throw p.fail('Select check-in or check-out before scanning.','ATTENDANCE_ACTION_INVALID');qr.validateSiteToken(input.token,now);const active=(await activeSessions(pool,userId))[0]||null;if(action==='CHECK_IN'&&active)throw p.fail('You are already checked in. Refresh your attendance state.','ATTENDANCE_ALREADY_WORKING',409);const attendanceId=action==='CHECK_OUT'?p.positiveId(input.attendance_id):null;if(action==='CHECK_OUT'&&(!active||Number(active.id)!==attendanceId))throw p.fail('Refresh and select your exact active session before checking out.','ATTENDANCE_SESSION_CONFLICT',409);const latest=await latestSession(pool,userId);return qr.createActionProof({userId,action,attendanceId,priorAttendanceId:latest?.id||null,siteToken:input.token,now});}
async function performAction({user,input,req,now}){
 const userId=p.actor(user),requestId=p.requestId(input.request_id),action=String(input.action||'').toUpperCase();if(!ACTIONS.has(action))throw p.fail('Choose an explicit attendance action.','ATTENDANCE_ACTION_INVALID');
 const attendanceId=action==='CHECK_IN'?null:p.positiveId(input.attendance_id),notes=noteFields(input);
 if(action!=='CHECK_OUT'&&(notes.task_id||notes.category_id||notes.category||notes.notes))throw p.fail('Shift notes and task details belong to check-out.','ATTENDANCE_NOTE_ACTION_INVALID');
 const payloadHash=p.hash({action,attendance_id:attendanceId,...notes});await ensureAttendanceMobileSchema();const db=await pool.getConnection();let response;
 try{
  await db.beginTransaction();const [[account]]=await db.query('SELECT id,active,deleted_at FROM users WHERE id=? FOR UPDATE',[userId]);if(!account||!Number(account.active)||account.deleted_at)throw p.fail('Your staff account is unavailable.','ATTENDANCE_ACCOUNT_UNAVAILABLE',403);
  const prior=await receipt(db,userId,requestId);if(prior){if(prior.payload_sha256!==payloadHash)throw p.fail('This request ID was already used for another action.','ATTENDANCE_IDEMPOTENCY_CONFLICT',409);response={...p.parsed(prior.response_json),existing:true};await db.commit();return state(user,now).then(latest=>({...response,state:latest}));}
  let actionNow=now;if(!actionNow){const [[clock]]=await db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') server_utc");const actual=p.instant(clock?.server_utc);if(!actual)throw p.fail('The authoritative server clock is unavailable.','ATTENDANCE_SERVER_TIME_INVALID',503);actionNow=actual.toJSDate();}
  const serverNow=p.utcNow(actionNow),sqlNow=attendanceTime.sqlUtc(serverNow),active=(await activeSessions(db,userId,true))[0]||null;
  const bypass=await p.qrBypass(db,userId);let proof;
  if(['CHECK_IN','CHECK_OUT'].includes(action)&&!bypass)proof=qr.validateActionProof({token:input.qr_proof||input.shift_qr_token,userId,action,attendanceId,now:actionNow});
  let session,unchanged=false;
  if(action==='CHECK_IN'){
   if(active){session=active;unchanged=true;}
   else{
    await assertMutablePeriod(db,userId,[p.workDate(serverNow)]);
    const latest=await latestSession(db,userId);if(proof&&Number(proof.prior_attendance_id||0)!==Number(latest?.id||0))throw p.fail('Attendance changed after this scan. Refresh and scan again.','ATTENDANCE_QR_STALE_STATE',409);
    if(latest){const previous=await loadSession(db,userId,latest.id);const end=previous.timestamp_basis==='UTC'?p.instant(previous.clock_out_utc_text):null;if(end&&end>serverNow)throw p.fail('The previous session ends after the server time. Request an authorised correction.','ATTENDANCE_CLOCK_INTERVAL_INVALID',409);}
    const [insert]=await db.query(`INSERT INTO staff_attendance(user_id,clock_in,work_date,total_minutes,total_hours,entry_source,timestamp_basis,recorded_timezone,attendance_status,revision) VALUES(?,?,?,0,0,'CLOCK','UTC',?,'INCOMPLETE',1)`,[userId,sqlNow,p.workDate(serverNow),attendanceTime.companyTimezone()]);session=await loadSession(db,userId,insert.insertId);
   }
  }else{
   session=await loadSession(db,userId,attendanceId,true);
   if(session.clock_out){if(action==='CHECK_OUT')unchanged=true;else throw p.fail('This session is already completed.','ATTENDANCE_SESSION_COMPLETED',409);}
   else{
    if(!active||Number(active.id)!==attendanceId)throw p.fail('Attendance changed. Refresh your exact active session.','ATTENDANCE_SESSION_CONFLICT',409);
    const before={...session},breaks=await breakSummary(db,session,serverNow);
    if(action==='BREAK_START'){
     if(session.timestamp_basis!=='UTC')throw p.fail('This older session needs an authorised timezone correction before recording breaks.','ATTENDANCE_TIMEZONE_UNVERIFIED',409);
     if(breaks.open)unchanged=true;
     else{await assertMutablePeriod(db,userId,periodDates(session));await db.query('INSERT INTO attendance_break_intervals(attendance_id,user_id,started_at,start_request_id) VALUES(?,?,?,?)',[session.id,userId,sqlNow,requestId]);await db.query('UPDATE staff_attendance SET break_tracking_base_minutes=COALESCE(break_tracking_base_minutes,COALESCE(break_minutes,0)),revision=revision+1 WHERE id=?',[session.id]);}
    }else if(action==='BREAK_END'){
     if(!breaks.open)unchanged=true;
     else{await assertMutablePeriod(db,userId,periodDates(session));await db.query('UPDATE attendance_break_intervals SET ended_at=?,end_request_id=? WHERE id=? AND ended_at IS NULL',[sqlNow,requestId,breaks.open.id]);await db.query('UPDATE staff_attendance SET break_minutes=?,revision=revision+1 WHERE id=?',[breaks.minutes,session.id]);}
    }else{
     await assertMutablePeriod(db,userId,periodDates(session));
     const validated=await summaryOptions.validateReferences(db,user,{...session,clock_out:sqlNow,clock_out_utc_text:sqlNow},notes);
     if(breaks.open)await db.query('UPDATE attendance_break_intervals SET ended_at=?,end_request_id=? WHERE id=? AND ended_at IS NULL',[sqlNow,requestId,breaks.open.id]);
     const start=session.timestamp_basis==='UTC'?p.instant(session.clock_in_utc_text):null;
     if(start&&serverNow.toMillis()<=start.toMillis())throw p.fail('Check-out must follow your recorded check-in. Wait a moment and retry the same request.','ATTENDANCE_CLOCK_INTERVAL_INVALID',409);
     const elapsed=start?Math.floor((serverNow.toMillis()-start.toMillis())/60000):null;
     if(elapsed!==null&&breaks.minutes>elapsed)throw p.fail('Recorded breaks exceed this session. Request an authorised correction.','ATTENDANCE_BREAK_INVALID',409);
     const verified=!!start,minutes=verified?elapsed-breaks.minutes:Number(session.total_minutes||0),hours=verified?Math.round(minutes/60*100)/100:Number(session.total_hours||0);
     const resolvedIncomplete=['INCOMPLETE_SHIFT','INCOMPLETE_SHIFT_REQUIRES_REVIEW'].includes(session.review_reason);
     const review=(Number(session.review_required)&&!resolvedIncomplete)||!verified||elapsed>=720;
     const reason=!verified?'ATTENDANCE_TIMEZONE_UNVERIFIED':elapsed>=720?'LONG_SHIFT_REQUIRES_REVIEW':review?session.review_reason:null;
     await db.query(`UPDATE staff_attendance SET clock_out=?,clock_out_timestamp_basis='UTC',total_minutes=?,total_hours=?,break_minutes=?,checkout_task_id=?,checkout_category=?,notes=COALESCE(?,notes),attendance_status=?,review_required=?,review_reason=?,checkout_category_id=?,checkout_task_title=?,revision=revision+1 WHERE id=? AND clock_out IS NULL`,[sqlNow,minutes,hours,breaks.rows.length?breaks.minutes:session.break_minutes,validated.task_id,validated.category,notes.notes,review?'REVIEW_REQUIRED':'WORKED',review?1:0,reason,validated.category_id,validated.task_title,session.id]);
    }
    session=await loadSession(db,userId,session.id);
    if(!unchanged)await logAudit(db,{...p.auditMeta(user,req),action,recordId:session.id,oldValue:p.publicAttendance(before),newValue:{...p.publicAttendance(session),qr_bypass:bypass,request_id:requestId}});
   }
  }
  if(action==='CHECK_IN'&&!unchanged)await logAudit(db,{...p.auditMeta(user,req),action,recordId:session.id,newValue:{...p.publicAttendance(session),qr_bypass:bypass,request_id:requestId}});
  response={request_id:requestId,action,attendance_id:Number(session.id),attendance:p.publicAttendance(session),unchanged,existing:false};
  await db.query('INSERT INTO attendance_action_receipts(user_id,request_id,action,attendance_id,payload_sha256,response_json) VALUES(?,?,?,?,?,?)',[userId,requestId,action,session.id,payloadHash,JSON.stringify(response)]);
  await db.commit();
 }catch(error){await db.rollback();throw error;}finally{db.release();}
 return{...response,state:await state(user,now)};
}
async function reconcileAction({user,requestId,now}){const userId=p.actor(user);await ensureAttendanceMobileSchema();const saved=requestId?await receipt(pool,userId,p.requestId(requestId)):null;return{found:!!saved,receipt:saved?p.parsed(saved.response_json):null,state:await state(user,now)};}
async function saveCheckoutNote({user,attendanceId,input,req,now}){
 const userId=p.actor(user),id=p.positiveId(attendanceId),requestId=p.requestId(input.request_id),notes=noteFields(input),payloadHash=p.hash({action:'CHECKOUT_NOTE',attendance_id:id,expected_revision:Number(input.expected_revision),...notes});await ensureAttendanceMobileSchema();const db=await pool.getConnection();let response;
 try{await db.beginTransaction();await db.query('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const prior=await receipt(db,userId,requestId);if(prior){if(prior.payload_sha256!==payloadHash)throw p.fail('This request ID was already used for different notes.','ATTENDANCE_IDEMPOTENCY_CONFLICT',409);await db.commit();return state(user,now).then(latest=>({...p.parsed(prior.response_json),existing:true,state:latest}));}const before=await loadSession(db,userId,id,true);if(!before.clock_out)throw p.fail('Complete this exact session before saving check-out notes.','ATTENDANCE_SESSION_NOT_COMPLETED',409);p.revision(input.expected_revision,before.revision);await assertMutablePeriod(db,userId,periodDates(before));const validated=await summaryOptions.validateReferences(db,user,before,notes);await db.query('UPDATE staff_attendance SET notes=?,checkout_task_id=?,checkout_category=?,checkout_category_id=?,checkout_task_title=?,revision=revision+1 WHERE id=?',[notes.notes,validated.task_id,validated.category,validated.category_id,validated.task_title,id]);const session=await loadSession(db,userId,id);await logAudit(db,{...p.auditMeta(user,req),action:'CHECKOUT_NOTE',recordId:id,oldValue:p.publicAttendance(before),newValue:p.publicAttendance(session)});response={request_id:requestId,action:'CHECKOUT_NOTE',attendance_id:id,attendance:p.publicAttendance(session),unchanged:false,existing:false};await db.query('INSERT INTO attendance_action_receipts(user_id,request_id,action,attendance_id,payload_sha256,response_json) VALUES(?,?,?,?,?,?)',[userId,requestId,'CHECKOUT_NOTE',id,payloadHash,JSON.stringify(response)]);await db.commit();}catch(error){await db.rollback();throw error;}finally{db.release();}return{...response,state:await state(user,now)};
}
module.exports={performAction,reconcileAction,saveCheckoutNote,resolveQr,loadSession,activeSessions};
