'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
exports.run=async({page,origin,out,phase})=>{
 const proof={fixtureOnly:true,physicalDevice:false,phase,widths:[],checks:[]};
 if(phase==='before'){
  for(const file of ['admin-dashboard.js','workspace-dialog.css','compact-header.css'])await page.route('**/'+file+'*',route=>route.fulfill({contentType:file.endsWith('.js')?'application/javascript':'text/css',body:execFileSync('git',['show','9dde6da30685722f3a64fdb64331fc96ac232d35:public/'+file],{maxBuffer:4*1024*1024})}));
  await page.reload();await page.waitForFunction(()=>document.getElementById('adminInfo')?.textContent.includes('Admin fixture'));
 }
 await page.evaluate(()=>goSection('attendanceSection'));await page.evaluate(async()=>{staffCache=[];populateTimesheetFilterStaffSelects();await loadStaff();});
 const options=await page.locator('#timesheetReportStaffSelect option').count();
 if(phase==='before')assert.equal(options,1,'reproduce staff cache completed without repopulating filters');else assert(options>1);
 proof.checks.push({staffOptionsAfterLoad:options});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,phase+'-admin-staff-filter.png'),fullPage:true});
 await page.evaluate(async()=>{await loadAttendance();await openAttendanceDialog(21);});await page.locator('#dialogBackdrop.active').waitFor();await page.screenshot({path:path.join(out,phase+'-admin-attendance-edit.png')});await page.locator('#dialogCancelBtn').click();
 if(phase==='after'){
  await page.selectOption('#timesheetReportStaffSelect','902');
  let order=0;await page.route('**/api/users',async route=>{const n=++order;await new Promise(r=>setTimeout(r,n===1?550:30));await route.fulfill({contentType:'application/json',body:JSON.stringify({users:[{id:902,name:n===1?'Stale response':'Current authorised staff with a very long name and team label',email:'designated@example.invalid',role:'staff',active:1}]})});});
  await page.evaluate(async()=>{const first=loadStaff();await new Promise(r=>setTimeout(r,50));await Promise.all([first,loadStaff()]);});
  assert.equal(await page.locator('#timesheetReportStaffSelect').inputValue(),'902');assert.match(await page.locator('#timesheetReportStaffSelect option[value="902"]').textContent(),/Current authorised/);await page.unroute('**/api/users');proof.checks.push('Delayed/out-of-order staff fetch: newest response wins and valid stable-ID selection survives');
  await page.route('**/api/attendance/timesheets/501',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({timesheet:{id:501,user_id:902,name:'Authorised synthetic staff',week_start:'2026-10-05',week_end:'2026-10-11',version_no:7,status:'PENDING_APPROVAL',total_hours:1},summary:{actualHours:8,verified_total_minutes:480,reviewRequired:false}})}));
  await page.evaluate(()=>openTimesheetDecision(501,'approve',1));await page.locator('#timesheetDecisionHours').waitFor();assert.equal(await page.locator('#timesheetDecisionHours').inputValue(),'8.00');assert.match(await page.locator('#dialogBody').innerText(),/Verified source: 8.00 hrs/);await page.locator('#dialogCancelBtn').click();proof.checks.push('Approval reloads authoritative source instead of prefilling stale one-hour register value');
  for(const viewport of [...[320,360,390,430,768,1024,1440].map(width=>({width,height:844})),{width:844,height:390},{width:390,height:400}])for(const mode of ['light','dark']){
   await page.setViewportSize(viewport);await page.evaluate(v=>VoxelTheme.set(v),mode);await page.evaluate(()=>openAttendanceDialog(21));await page.locator('#dialogBackdrop.active').waitFor();
   assert(await page.locator('#attendanceUserId').isDisabled());assert.equal(await page.locator('#attendanceClockIn').inputValue(),'2026-10-09T09:00');assert.equal(await page.locator('#attendanceClockOut').inputValue(),'2026-10-09T17:30');
   const metrics=await page.evaluate(()=>{const p=document.querySelector('.vv-managed-dialog'),r=p.getBoundingClientRect(),body=document.getElementById('dialogBody');return{width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,dialog:{x:r.x,right:r.right,top:r.top,bottom:r.bottom},inputs:[...p.querySelectorAll('input,select,textarea')].map(n=>{const b=n.getBoundingClientRect();return{left:b.left,right:b.right}}),footer:[...p.querySelectorAll('.dialog-actions button')].filter(n=>n.getClientRects().length).map(n=>{const b=n.getBoundingClientRect();const s=getComputedStyle(n);return{label:n.textContent,bottom:b.bottom,top:b.top,height:b.height,position:s.position,flex:s.flex,minHeight:s.minHeight,transform:s.transform,margin:s.margin}}),footerStyle:(()=>{const n=p.querySelector('.dialog-actions'),s=getComputedStyle(n),r=n.getBoundingClientRect();return{rect:r.toJSON(),display:s.display,direction:s.flexDirection,height:s.height,minHeight:s.minHeight,position:s.position,flex:s.flex}})(),bodyScroll:body.scrollHeight>body.clientHeight}});
   fs.writeFileSync(path.join(out,'latest-modal-metrics.json'),JSON.stringify(metrics,null,2));
   assert(metrics.scroll<=viewport.width+1);assert(metrics.dialog.x>=-1&&metrics.dialog.right<=viewport.width+1&&metrics.dialog.top>=-1&&metrics.dialog.bottom<=viewport.height+1);assert(metrics.inputs.every(r=>r.left>=0&&r.right<=viewport.width+1));assert(metrics.footer.every(r=>r.bottom<=viewport.height+1));assert.equal(metrics.footer.length,2);proof.widths.push({mode,...metrics});
   if(viewport.width===390&&viewport.height===844)await page.screenshot({path:path.join(out,'after-admin-edit-'+mode+'.png')});await page.locator('#dialogCancelBtn').click();
  }
  await page.evaluate(()=>openAttendanceDialog(22));assert.doesNotMatch(await page.locator('#dialogBody').innerText(),/TIMESTAMP_BASIS_UNVERIFIED/);assert.match(await page.locator('#dialogBody').innerText(),/historical|timestamp/i);await page.locator('#dialogCancelBtn').click();proof.checks.push('Editable modal: labelled company-local dates, immutable owner, reason, compact viewport fit, reachable actions, human review explanation');
 }
 fs.writeFileSync(path.join(out,phase+'-attendance-workflow-proof.json'),JSON.stringify(proof,null,2));console.log('ATTENDANCE_WORKFLOW_BROWSER_OK '+phase);
};
