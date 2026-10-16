/* Provisional display only. Never changes saved attendance or eligible payroll time. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VoxelAttendanceClock=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const ms=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:null;};
 function project(snapshot,elapsed=0){
  const active=snapshot?.active_attendance,summary=snapshot?.summary||{};
  if(!active)return {worked:summary.worked_minutes??null,active:null,breakMinutes:summary.recorded_break_minutes??null,breakElapsed:null,overnight:false};
  const server=ms(snapshot.server_time),start=ms(active.clock_in),breakStart=ms(active.break_started_at);
  const valid=active.live_worked_minutes!=null&&server!=null&&start!=null;
  const delta=Math.max(0,Number.isFinite(elapsed)?elapsed:0),at=server+delta;
  const recorded=Number(active.recorded_break_milliseconds??Number(active.recorded_break_minutes||0)*60000);
  const ongoing=active.on_break&&breakStart!=null?Math.max(0,at-breakStart):Number(active.live_break_minutes||0)*60000+(active.on_break?delta:0);
  // Preserve the existing whole-minute deduction policy; the active break freezes work at its start.
  const effective=active.on_break&&breakStart!=null?breakStart:at;
  const activeMs=valid?Math.max(0,effective-start-Math.floor(recorded/60000)*60000):null;
  const activeMinutes=activeMs==null?null:Math.floor(activeMs/60000);
  return {worked:active.overnight?summary.worked_minutes??null:activeMinutes==null?null:Number(summary.worked_minutes||0)+activeMinutes,active:activeMinutes,activeMilliseconds:activeMs,breakMinutes:active.overnight?summary.recorded_break_minutes??null:Number(summary.recorded_break_minutes||0)+Math.floor(ongoing/60000),breakElapsed:active.on_break?Math.floor(ongoing/1000):null,overnight:!!active.overnight};
 }
 const reasons={INCOMPLETE_SHIFT:'An unfinished session is excluded from verified hours. Check out, or request an authorised correction.',INCOMPLETE_SHIFT_REQUIRES_REVIEW:'A long unfinished session needs an authorised review of its actual start and finish.',LONG_SHIFT_REQUIRES_REVIEW:'This long shift needs an authorised review. Its saved time has not been capped.',ATTENDANCE_TIMEZONE_UNVERIFIED:'The original timezone is unverified. Confirm the actual workplace times through a correction.',RECORDED_TIMEZONE_INVALID:'Confirm the workplace timezone for this saved record.',CLOCK_INTERVAL_INVALID:'The recorded start and finish need correction.',RECORDED_DURATION_INCONSISTENT:'Saved hours disagree with the recorded minutes. Review the source session.',WORK_AND_BREAK_INCONSISTENT:'Worked time and recorded breaks disagree. Review the source session.',OVERLAPPING_WORKED_ENTRIES:'Two recorded sessions overlap. Review both before submitting.',ATTENDANCE_REVIEW_REQUIRED:'An authorised attendance review is required.',MANUAL_AUTHORISATION_REQUIRED:'This manual entry needs an authorised correction.',NO_WORKED_ATTENDANCE:'There is no eligible completed work in this period.'};
 function explain(code){return reasons[code]||'A saved attendance record needs authorised review. Open its source history for the next step.';}
 return {project,explain};
});
