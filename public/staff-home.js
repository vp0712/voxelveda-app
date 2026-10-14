(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const labels={NOT_STARTED:'Not started',WORKING:'Working',ON_BREAK:'On break',COMPLETED:'Completed',REVIEW_REQUIRED:'Review required'};
  const actionLabels={CHECK_IN:'Check in',CHECK_OUT:'Check out',BREAK_START:'Start break',BREAK_END:'End break'};
  let identity=null,today=null,loading=null,homeFailed=false,overlayKind=null,overlayReturn=null,submitBusy=false,serverOffset=0;
  let pending=null,history=[],corrections=[],historyScope='own',historyMeta={},correctionMeta={},historyStatus='ALL',sessionStatus='ALL',historySearch='',historyFrom='',historyTo='',historySequence=0;
  let authEpoch=0,identityPromise=null,identityFingerprint='',applyingVerifiedProfile=false,boundaryTimer=null;
  const requests=new Set(),resultLeases=new WeakMap();
  const pendingStorage='voxelveda:attendance-pending';
  function fingerprint(){try{const user=JSON.parse(localStorage.getItem('user')||'{}');return String(localStorage.getItem('token')||'')+':'+String(user.id||'');}catch{return '';}}
  function authHeaders(){const supplied=window.VoxelAvatar?.authHeaders?.()||window.authHeaders?.()||{};const headers={...supplied,Accept:'application/json'};if(headers.Authorization?.trim()==='Bearer')delete headers.Authorization;return headers;}
  function stale(){return Object.assign(new Error('The signed-in account changed. Its previous attendance view has been cleared.'),{staleAccount:true,code:'ATTENDANCE_ACCOUNT_CHANGED'});}
  function account(){if(!identity?.id||identityFingerprint!==fingerprint())throw stale();return{epoch:authEpoch,id:String(identity.id),fingerprint:identityFingerprint};}
  function current(lease){return Boolean(lease&&lease.epoch===authEpoch&&lease.id===String(identity?.id)&&lease.fingerprint===fingerprint());}
  function assertCurrent(lease){if(!current(lease))throw stale();}
  function assertResult(result){assertCurrent(resultLeases.get(result));}
  function ownerFailure(message){boundary({refreshAgain:false});showError(message);throw stale();}
  function clearPrivateView(){
    historySequence++;today=null;history=[];corrections=[];historyMeta={};correctionMeta={};historyScope='own';historyStatus='ALL';sessionStatus='ALL';historySearch='';historyFrom='';historyTo='';serverOffset=0;submitBusy=false;pending=null;
    window.VoxelOverlay?.closeAll?.();closeOverlay();window.closeStaffNotificationPanel?.();window.toggleMobileMenu?.(false);clearError();
    document.querySelectorAll('[data-avatar-self]').forEach(target=>{target.dataset.avatarName='';});
    ['staffHomeWorked','staffHomeBreak','staffHomeSessions','staffHomeFirstCheckIn','staffHomeLastCheckOut','weekHoursCount','staffHomeWeekHours'].forEach(id=>setText(id,'—'));
    ['staffHomeGreeting','staffProfileMenuName','sidebarStaffName','sidebarProfileName','profileName','profileFullName'].forEach(id=>setText(id,'Verifying account...'));
    ['sidebarProfileUsername','sidebarProfileRole','profileUsername','profileEmail','profileRole','profileRoleBadge','staffInfo','staffHomeAttendanceNote'].forEach(id=>setText(id,''));
    setText('staffHomeTeam','Verifying your workspace...');setText('staffHomeStatus','Checking...');setText('staffHomeDate','Checking workplace time...');setText('staffHomeWorkedDetail','Loading your attendance record');
    if($('staffHomeTimeline'))$('staffHomeTimeline').innerHTML='<li class="staff-home-empty">Loading your sessions...</li>';
    setText('staffHomeNextShift','Loading your next shift...');setText('staffHomeTasks','Loading assigned work...');
    if($('staffAttendanceBody'))$('staffAttendanceBody').replaceChildren();renderActions();
  }
  function boundary({refreshAgain=true}={}){
    authEpoch++;identity=null;identityFingerprint='';identityPromise=null;loading=null;for(const request of requests)request.abort();requests.clear();clearPrivateView();
    clearTimeout(boundaryTimer);if(refreshAgain)boundaryTimer=setTimeout(()=>{void refresh();},0);
  }
  async function verifyIdentity(){
    if(identityPromise)return identityPromise;
    const epoch=authEpoch,stored=fingerprint(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);requests.add(controller);
    let promise;
    promise=(async()=>{
      try{
        const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store',headers:authHeaders(),signal:controller.signal});
        const data=await response.json().catch(()=>({}));
        if(epoch!==authEpoch||stored!==fingerprint())throw stale();
        if(!response.ok||!Number.isSafeInteger(Number(data.user?.id))||Number(data.user.id)<1)throw Object.assign(new Error(data.message||'Your signed-in account could not be verified. Sign in again before changing attendance.'),{status:response.status});
        const user={...data.user,role:String(data.user.role||'').trim().toLowerCase()};
        if(['admin','super_admin','super admin','client','customer','viewer','view_only','view-only','read_only'].includes(user.role)){
          boundary({refreshAgain:false});clearPending();localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('role',user.role);
          window.location.assign(['admin','super_admin','super admin'].includes(user.role)?'/admin':'/dashboard');return null;
        }
        const old=identity;
        const authority=user=>JSON.stringify([user?.role,user?.permissions,user?.permission_boundary]);
        if(old&&(String(old.id)!==String(user.id)||authority(old)!==authority(user))){boundary({refreshAgain:false});}
        identity=user;localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('role',user.role);identityFingerprint=fingerprint();
        // Keep the original dashboard permission/navigation state in sync with the verified session.
        if(typeof currentUser!=='undefined')currentUser=user;if(typeof currentRole!=='undefined')currentRole=user.role;
        const lease=account();window.applyPermissionUI?.();window.loadWorkHubModules?.();setText('sidebarStaffName',user.name||user.username||'');setText('staffInfo',`${user.name||user.username||''} | ${user.email||''} | ${user.role}`);applyingVerifiedProfile=true;try{oldProfile?.(user);}finally{applyingVerifiedProfile=false;}
        assertCurrent(lease);applyIdentity(user);void window.VoxelAvatar?.refreshSelf();return user;
      }catch(error){if(error.staleAccount||epoch!==authEpoch)return null;identity=null;identityFingerprint='';clearPrivateView();if([401,403].includes(error.status))clearPending();showError(error.name==='AbortError'?'Account verification timed out. Retry before changing attendance.':error.message);return null;}
      finally{clearTimeout(timeout);requests.delete(controller);if(identityPromise===promise)identityPromise=null;}
    })();identityPromise=promise;return promise;
  }
  function uuid(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
  function minutes(value){const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;}
  function duration(value){const n=Math.floor(minutes(value));return `${Math.floor(n/60)}h ${String(n%60).padStart(2,'0')}m`;}
  function instant(value){if(!value)return null;const text=String(value);if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(text))return null;const date=new Date(text);return Number.isNaN(date.getTime())?null:date;}
  function formatInstant(value,options={}){const date=instant(value);if(!date||!today?.company_timezone)return 'Time requires review';try{return new Intl.DateTimeFormat('en-AU',{timeZone:today.company_timezone,day:'numeric',month:'short',hour:'numeric',minute:'2-digit',...options}).format(date);}catch{return 'Time requires review';}}
  function dateOnly(value){const text=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return 'Date not recorded';return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(text+'T12:00:00Z'));}
  function localInput(value){const date=instant(value);if(!date||!today?.company_timezone)return '';try{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:today.company_timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}catch{return '';}}
  function setText(id,value){if($(id))$(id).textContent=String(value??'');}
  function allowed(action){return Boolean(today&&Array.isArray(today.allowed_actions)&&today.allowed_actions.includes(action));}
  function activeId(){return today?.active_attendance?.id??null;}
  function correctionAccess(scope){return scope==='own'||scope==='team'&&Boolean(window.hasPermission?.('APPROVE_TEAM_TIMESHEET')||window.hasPermission?.('EDIT_ATTENDANCE')||window.hasPermission?.('APPROVE_ALL_TIMESHEETS'))||scope==='all'&&Boolean(window.hasPermission?.('EDIT_ATTENDANCE')||window.hasPermission?.('APPROVE_ALL_TIMESHEETS'));}
  function showError(message){homeFailed=true;setText('staffHomeErrorText',message);if($('staffHomeError'))$('staffHomeError').hidden=false;renderActions();}
  function clearError(){homeFailed=false;if($('staffHomeError'))$('staffHomeError').hidden=true;}
  async function api(url,options={}){
    const lease=account(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),options.method&&options.method!=='GET'?20000:12000);requests.add(controller);
    try{
      let response;
      try{response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal,headers:{...authHeaders(),...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});}
      catch(error){assertCurrent(lease);throw Object.assign(new Error('Connection lost. Your attendance has not been confirmed; check its status before trying again.'),{uncertain:Boolean(options.method&&options.method!=='GET'),cause:error});}
      assertCurrent(lease);const data=await response.json().catch(()=>({}));assertCurrent(lease);
      if(!response.ok)throw Object.assign(new Error(data.message||'The attendance request could not be completed.'),{status:response.status,code:data.code,fields:data.errors||data.fields||data.field_errors,uncertain:response.status>=500||['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ATTENDANCE_OPERATION_FAILED'].includes(data.code),...(data.review_required?{review_required:true}:{})});
      const ownedState=url.split('?')[0]==='/api/attendance/today'?data:data.state;
      if(ownedState){
        if(!Number.isSafeInteger(Number(ownedState.profile?.id))||Number(ownedState.profile.id)<1)throw new Error('The service did not confirm the attendance owner. Refresh before changing attendance.');
        if(String(ownedState.profile.id)!==lease.id)ownerFailure('The attendance owner did not match your verified account. Refresh before changing attendance.');
      }
      if(data.requested_by!=null&&String(data.requested_by)!==lease.id)ownerFailure('The returned record owner did not match your verified account. Refresh before continuing.');
      const path=url.split('?')[0],scope=new URL(url,location.origin).searchParams.get('scope')||'own';
      if(['/api/attendance/my','/api/attendance/week'].includes(path)&&data.attendance?.some(row=>String(row.user_id)!==lease.id))ownerFailure('Attendance history did not match your verified account. Refresh before continuing.');
      if(path==='/api/attendance/corrections'&&scope==='own'&&data.corrections?.some(row=>String(row.user_id)!==lease.id))ownerFailure('Correction history did not match your verified account. Refresh before continuing.');
      if(data.attendance&& !Array.isArray(data.attendance)&&String(data.attendance.user_id)!==lease.id&&!path.match(/\/corrections\/[^/]+\/(approve|reject)$/))ownerFailure('The attendance receipt did not match your verified account. Check its status before continuing.');
      if(data.receipt?.attendance&&String(data.receipt.attendance.user_id)!==lease.id)ownerFailure('The pending receipt did not match your verified account. Refresh before continuing.');
      if(path==='/api/attendance/corrections'&&data.correction&&String(data.correction.user_id)!==lease.id)ownerFailure('The correction response did not match your verified account. Refresh before continuing.');
      resultLeases.set(data,lease);
      return data;
    }finally{clearTimeout(timeout);requests.delete(controller);}
  }
  function rememberPending(request){pending=request;try{sessionStorage.setItem(pendingStorage,JSON.stringify({request_id:request.request_id,action:request.action,attendance_id:request.attendance_id??null,user_id:identity?.id}));}catch{}}
  function clearPending(){pending=null;try{sessionStorage.removeItem(pendingStorage);}catch{}}
  function hydratePending(){try{const value=JSON.parse(sessionStorage.getItem(pendingStorage)||'null');if(value&&String(value.user_id)===String(identity?.id)&&/^[0-9a-f-]{36}$/i.test(value.request_id))pending=value;else sessionStorage.removeItem(pendingStorage);}catch{}}
  function greeting(){
    if(identity){const name=identity.name||identity.username;setText('staffHomeGreeting',name?`Welcome, ${name}`:'Welcome');setText('staffHomeTeam',[String(identity.role||'').replaceAll('_',' '),today?.profile?.department||identity.team_name||identity.team||identity.department].filter(Boolean).join(' · ')||'Your workspace');setText('staffProfileMenuName',name||'Your account');document.querySelectorAll('[data-avatar-self]').forEach(node=>{node.dataset.avatarName=name||'';});}
    if(!today?.company_timezone||!instant(today.server_time))return;
    try{const at=new Date(Date.now()+serverOffset);const hour=Number(new Intl.DateTimeFormat('en-AU',{timeZone:today.company_timezone,hour:'2-digit',hourCycle:'h23'}).format(at));const name=identity?.name||identity?.username;const hello=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';setText('staffHomeGreeting',name?`${hello}, ${name}`:hello);setText('staffHomeDate',new Intl.DateTimeFormat('en-AU',{timeZone:today.company_timezone,weekday:'long',day:'numeric',month:'long'}).format(at)+` · ${today.company_timezone}`);}catch{setText('staffHomeDate','Workplace time needs review');}
  }
  function renderActions(){
    const primary=$('staffHomePrimaryAction'),secondary=$('staffHomeBreakAction');if(!primary||!secondary)return;
    const action=allowed('CHECK_OUT')?'CHECK_OUT':allowed('CHECK_IN')?'CHECK_IN':null;
    primary.dataset.attendanceAction=action||'';primary.textContent=action?(today.qr_required!==false?'Scan to '+actionLabels[action].toLowerCase():actionLabels[action]):today?.status==='REVIEW_REQUIRED'?'Attendance needs review':homeFailed?'Attendance unavailable':'Checking attendance...';primary.disabled=submitBusy||homeFailed||!action||Boolean(pending);
    const breakAction=allowed('BREAK_END')?'BREAK_END':allowed('BREAK_START')?'BREAK_START':null;secondary.hidden=!breakAction;secondary.dataset.attendanceAction=breakAction||'';secondary.textContent=breakAction?actionLabels[breakAction]:'';secondary.disabled=submitBusy||homeFailed||!breakAction||Boolean(pending);
    if(pending){primary.textContent='Check pending attendance';primary.disabled=submitBusy;primary.dataset.attendanceAction='RECONCILE';secondary.hidden=true;}
  }
  function renderToday(){
    if(!today)return;const summary=today.summary||{};
    setText('staffHomeStatus',labels[today.status]||'Needs review');$('staffHomeStatus')?.setAttribute('data-state',today.status||'REVIEW_REQUIRED');
    setText('staffHomeWorked',duration(minutes(summary.worked_minutes)+minutes(summary.live_worked_minutes)));
    const breakTotal=minutes(summary.recorded_break_minutes)+minutes(summary.live_break_minutes);
    setText('staffHomeBreak',summary.break_recording_status==='NOT_RECORDED'?'Not recorded':summary.break_recording_status==='PARTIALLY_RECORDED'?`${duration(breakTotal)} recorded`:duration(breakTotal));setText('staffHomeSessions',summary.session_count??today.sessions?.length??0);
    setText('staffHomeWorkedDetail',today.active_attendance&&today.active_attendance.live_worked_minutes==null?'Live session time requires review and is excluded from the verified total.':today.active_attendance?.overnight?`Active overnight session: ${duration(today.active_attendance.live_worked_minutes)} worked · allocated to ${dateOnly(today.active_attendance.allocated_work_date)}`:today.active_attendance?'Recorded sessions plus the current live session':'Recorded completed sessions');
    const retained=(today.sessions||[]).filter(row=>!['CANCELLED','REJECTED','DUPLICATE','DELETED'].includes(String(row.attendance_status||'').toUpperCase()));
    const unknownStart=retained.some(row=>row.clock_in_saved_text&&!instant(row.clock_in)||row.verification_status==='REVIEW_REQUIRED'&&Boolean(row.clock_in));
    const unknownEnd=retained.some(row=>row.clock_out_saved_text&&!instant(row.clock_out)||row.verification_status==='REVIEW_REQUIRED'&&Boolean(row.clock_out));
    setText('staffHomeFirstCheckIn',summary.first_check_in?formatInstant(summary.first_check_in):unknownStart?'Requires review':'Not recorded');
    setText('staffHomeLastCheckOutLabel',today.active_attendance?'Current session':'Latest check-out');
    setText('staffHomeLastCheckOut',today.active_attendance?'In progress':summary.latest_check_out?formatInstant(summary.latest_check_out):unknownEnd?'Requires review':'Not recorded');
    const notes=[...(summary.review_required?['Some attendance needs review. Unverified time is excluded from the worked total.']:[]),...(Number(summary.duplicate_session_count)>0?[`${Number(summary.duplicate_session_count)} duplicate retained attendance ${Number(summary.duplicate_session_count)===1?'entry is':'entries are'} excluded from worked hours.`]:[]),...(summary.break_recording_status==='PARTIALLY_RECORDED'?['Some sessions have no recorded break information; they have not been treated as confirmed zero-break sessions.']:[]),...(today.status==='ON_BREAK'?['Your current break is recorded separately from worked time.']:[])];setText('staffHomeAttendanceNote',notes.join(' '));
    const events=today.timeline||[];
    $('staffHomeTimeline').innerHTML=events.length?events.map(event=>`<li><div>${escape(({CHECK_IN:'Checked in',CHECK_OUT:'Checked out',BREAK_START:'Break started',BREAK_END:'Break ended',CLOCK_IN:'Checked in',CLOCK_OUT:'Checked out'})[event.type]||String(event.type||'Attendance recorded').replaceAll('_',' ').toLowerCase())}${({REVIEW_REQUIRED:'Requires review',DUPLICATE:'Duplicate; excluded from worked hours',NO_WORK:'No verified worked time'})[event.verification_status]?`<small>${escape(({REVIEW_REQUIRED:'Requires review',DUPLICATE:'Duplicate; excluded from worked hours',NO_WORK:'No verified worked time'})[event.verification_status])}</small>`:''}</div><time>${escape(formatInstant(event.at,{day:undefined,month:undefined}))}</time></li>`).join(''):'<li class="staff-home-empty">No attendance recorded today.</li>';
    const shift=today.next_roster;
    $('staffHomeNextShift').classList.toggle('staff-home-empty',!shift);$('staffHomeNextShift').innerHTML=shift?`<div class="staff-home-next-date">${escape(dateOnly(shift.shift_date||shift.work_date))}</div><p class="staff-home-next-detail">${escape(String(shift.start_time||'').slice(0,5))}–${escape(String(shift.end_time||'').slice(0,5))} · ${escape(today.company_timezone)}</p>${shift.location||shift.site_name?`<p class="staff-home-next-detail">${escape(shift.location||shift.site_name)}</p>`:''}${shift.role_notes||shift.notes?`<p class="staff-home-next-detail">${escape(shift.role_notes||shift.notes)}</p>`:''}`:'No upcoming shift is assigned.';
    const tasks=today.tasks||[];$('staffHomeTasks').classList.toggle('staff-home-empty',!tasks.length);$('staffHomeTasks').innerHTML=tasks.length?tasks.slice(0,4).map(task=>`<button type="button" class="staff-home-task" data-staff-home-section="tasksSection"><strong>${escape(task.title)}</strong><small>${escape(String(task.status||'').replaceAll('_',' '))}${task.due_date?` · Due ${escape(dateOnly(task.due_date))}`:''}</small></button>`).join(''):'No assigned tasks need attention.';
    $('staffHomeAttendance')?.setAttribute('aria-busy','false');greeting();renderActions();
  }
  async function refresh(){
    if(loading)return loading;
    let promise;
    promise=(async()=>{
      let lease;
      try{
        if(!await verifyIdentity())return null;lease=account();
        const [dailyResult,weekResult]=await Promise.allSettled([api('/api/attendance/today'),api('/api/attendance/week')]);assertCurrent(lease);if(dailyResult.status!=='fulfilled')throw dailyResult.reason;const data=dailyResult.value;assertResult(data);
        const week=weekResult.status==='fulfilled'?weekResult.value:null;if(week){assertResult(week);if(week.timesheet?.user_id!=null&&String(week.timesheet.user_id)!==lease.id)ownerFailure('The weekly timesheet owner did not match your verified account.');}else if(weekResult.reason?.staleAccount)throw weekResult.reason;
        if(!data.summary||!Array.isArray(data.allowed_actions)||!Array.isArray(data.sessions))throw new Error('Your attendance view is updating. Refresh shortly or contact your supervisor. No attendance has been changed.');
        today=data;const server=instant(data.server_time);if(server)serverOffset=server.getTime()-Date.now();clearError();renderToday();setText('staffHomeWeekHours',week&&Number.isFinite(Number(week.total_hours))?`${Number(week.total_hours).toFixed(2)} hrs`:'Unavailable');setText('staffWeekSignal',week?'Verified worked hours':'Retry in My timesheets');return data;
      }catch(error){if(!error.staleAccount&&(!lease||current(lease)))showError(error.message);return null;}
      finally{if(loading===promise)loading=null;}
    })();loading=promise;return promise;
  }
  function closeOverlay(){window.VoxelAttendanceScanner?.stop();$('staffAttendanceOverlay').hidden=true;overlayKind=null;$('staffProfileMenu').hidden=true;$('staffProfileMenuToggle').setAttribute('aria-expanded','false');}
  function close(){if(window.VoxelOverlay)window.VoxelOverlay.close('staff-attendance');else{closeOverlay();document.body.classList.remove('staff-attendance-open');overlayReturn?.focus?.();}}
  function openSheet(title,body,kind='attendance'){
    overlayReturn=document.activeElement;window.VoxelAttendanceScanner?.stop();window.closeStaffNotificationPanel?.();window.toggleMobileMenu?.(false);$('staffProfileMenu').hidden=true;$('staffProfileMenuToggle').setAttribute('aria-expanded','false');
    if(window.VoxelOverlay){if(window.VoxelOverlay.open('staff-attendance',closeOverlay,overlayReturn)===false)return;}else document.body.classList.add('staff-attendance-open');
    overlayKind=kind;setText('staffAttendanceTitle',title);$('staffAttendanceBody').innerHTML=body;$('staffAttendanceOverlay').hidden=false;document.querySelector('.staff-attendance-sheet')?.focus();
  }
  function sheetError(message,fields){
    let error=$('staffAttendanceError');if(!error){error=document.createElement('div');error.id='staffAttendanceError';error.className='staff-home-feedback';error.setAttribute('role','alert');$('staffAttendanceBody').prepend(error);}error.textContent=message;
    const entries=Array.isArray(fields)?fields.map(field=>[field.field||field.path,field.message||field.msg]):Object.entries(fields||{});
    for(const [name,detail]of entries){const input=[...$('staffAttendanceBody').querySelectorAll('input,select,textarea')].find(node=>node.name===name);if(!input)continue;input.setAttribute('aria-invalid','true');let label=document.getElementById(`${input.id}-error`);if(!label){label=document.createElement('span');label.id=`${input.id}-error`;label.className='staff-attendance-field-error field-error';input.after(label);}label.textContent=Array.isArray(detail)?detail.join(' '):String(detail);input.setAttribute('aria-describedby',label.id);}
    $('staffAttendanceBody').querySelector('[aria-invalid="true"]')?.focus();
  }
  function button(id,label,className='primary-btn'){return `<button type="button" id="${id}" class="${className}">${escape(label)}</button>`;}
  async function startCamera(action,retainedRequest=null){
    const lease=account();openSheet(actionLabels[action],`<p class="staff-sheet-subtitle">Scan the current workplace QR. You will review and confirm ${escape(actionLabels[action].toLowerCase())} before anything is saved.</p><div class="staff-scanner-camera"><video id="staffAttendanceVideo" muted autoplay playsinline></video><span class="staff-scanner-frame" aria-hidden="true"></span></div><p id="staffAttendanceScanStatus" class="staff-scanner-status" role="status">Preparing camera...</p><div class="staff-sheet-actions">${button('staffAttendanceCameraRetry','Retry camera','secondary-btn')}${button('staffAttendanceScanCancel','Cancel','secondary-btn')}</div>`,'scan');
    $('staffAttendanceCameraRetry').onclick=()=>startCamera(action,retainedRequest);$('staffAttendanceScanCancel').onclick=close;
    await window.VoxelAttendanceScanner.start({video:$('staffAttendanceVideo'),onStatus:message=>{if(current(lease)&&overlayKind==='scan')setText('staffAttendanceScanStatus',message);},onError:message=>{if(!current(lease)||overlayKind!=='scan')return;setText('staffAttendanceScanStatus',message);$('staffAttendanceScanStatus')?.setAttribute('data-error','true');},onToken:token=>current(lease)&&overlayKind==='scan'?verifyQr(action,token,retainedRequest):undefined});
  }
  async function verifyQr(action,raw,retainedRequest=null){
    const lease=account();const token=String(raw||'').trim();
    if(!token||token.length>2000){setText('staffAttendanceScanStatus','This is not a valid attendance QR. Scan the current workplace code. No attendance was changed.');$('staffAttendanceScanStatus')?.setAttribute('data-error','true');return;}
    setText('staffAttendanceScanStatus','Checking the QR and your current attendance...');
    const refreshed=await refresh();if(!current(lease))return;if(!refreshed||!allowed(action)){sheetError('Your shift state changed. Close this scanner and review the current attendance before trying again.');return;}
    if(retainedRequest&&action!=='CHECK_IN'&&String(retainedRequest.attendance_id)!==String(activeId())){sheetError('The original session is no longer active. Check the original request again; a different session will not be changed.');return;}
    try{const proof=await api('/api/attendance/qr/validate',{method:'POST',body:JSON.stringify({token,action,...(action==='CHECK_OUT'?{attendance_id:activeId()}:{})})});assertCurrent(lease);assertResult(proof);if(proof.valid!==true||proof.action!==action||!proof.qr_proof||String(proof.attendance_id??'')!==String(action==='CHECK_OUT'?activeId()??'':''))throw new Error('The QR does not match this attendance action. Scan a current workplace QR.');if(overlayKind!=='scan')return;confirmAction(action,proof.qr_proof,proof,retainedRequest);}catch(error){if(error.staleAccount||!current(lease))return;if(overlayKind==='scan'){setText('staffAttendanceScanStatus',`${error.message} No attendance was changed.`);$('staffAttendanceScanStatus')?.setAttribute('data-error','true');}}
  }
  let attendanceIntentHandled=false;
  async function acceptCameraIntent(){
    if(attendanceIntentHandled)return;
    const url=new URL(location.href),token=url.searchParams.get('attendance_intent'),expired=url.searchParams.has('attendance_code_expired');
    if(!token&&!expired)return;
    attendanceIntentHandled=true;url.searchParams.delete('attendance_intent');url.searchParams.delete('attendance_code_expired');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    if(expired){showError('This workplace code expired during sign-in. Scan the current gate code. No attendance was changed.');return;}
    if(!await verifyIdentity()||!await refresh())return;
    if(pending)return reconcileView();
    const action=allowed('CHECK_OUT')?'CHECK_OUT':allowed('CHECK_IN')?'CHECK_IN':null;
    if(!action){showError('Attendance is unavailable for your current state. No attendance was changed.');return;}
    openSheet('Verify workplace code',`<p id="staffAttendanceScanStatus" role="status">Checking the code…</p><div class="staff-sheet-actions">${button('staffAttendanceIntentCancel','Cancel','secondary-btn')}</div>`,'scan');
    $('staffAttendanceIntentCancel').onclick=close;
    await verifyQr(action,token);
  }
  async function openAction(action){
    if(submitBusy)return;if(pending)return reconcileView();
    const previous=identity?account():null;
    if(!await verifyIdentity())return;
    if(previous&&!current(previous))return;
    const lease=account(),refreshed=await refresh();if(!current(lease)||!refreshed)return;
    if(!allowed(action)){showError('This attendance action is no longer available. Your current shift has been refreshed.');return;}
    if(['CHECK_IN','CHECK_OUT'].includes(action)&&today.qr_required!==false)return startCamera(action);
    confirmAction(action,null);
  }
  function confirmAction(action,proof,verified={},retainedRequest=null){
    const lease=account();const attendanceId=action==='CHECK_IN'?null:activeId();const request={request_id:retainedRequest?.request_id||uuid(),action,...(attendanceId?{attendance_id:attendanceId}:{}),...(proof?{qr_proof:proof}:{})};
    openSheet(`Confirm ${actionLabels[action].toLowerCase()}`,`<p>${escape(identity?.name||identity?.username||'Your signed-in account')} is about to ${escape(actionLabels[action].toLowerCase())}.</p>${verified.site_name?`<p class="staff-sheet-subtitle">Workplace: ${escape(verified.site_name)}</p>`:verified.site_id?`<p class="staff-sheet-subtitle">Verified attendance site: ${escape(verified.site_id)}</p>`:''}${today.active_attendance?`<p class="staff-sheet-subtitle">Current session started ${escape(formatInstant(today.active_attendance.clock_in))}. This action applies to that session only.</p>`:''}<p class="staff-sheet-subtitle">${proof?'Workplace QR verified. ':''}Time is recorded by the server in ${escape(today.company_timezone)}.</p><div class="staff-sheet-actions">${button('staffAttendanceConfirm',`Confirm ${actionLabels[action].toLowerCase()}`)}${button('staffAttendanceCancel','Cancel','secondary-btn')}</div>`,'confirm');
    $('staffAttendanceCancel').onclick=close;$('staffAttendanceConfirm').onclick=()=>{if(current(lease))return submitAction(request);};
  }
  async function submitAction(request){
    if(submitBusy)return;const lease=account();submitBusy=true;rememberPending(request);const confirm=$('staffAttendanceConfirm');if(confirm){confirm.disabled=true;confirm.setAttribute('aria-busy','true');}renderActions();
    try{const result=await api('/api/attendance/actions',{method:'POST',body:JSON.stringify(request)});assertCurrent(lease);assertResult(result);if(String(result.request_id)!==String(request.request_id)||result.action!==request.action)throw Object.assign(new Error('The server response could not be matched to this attendance request. Check its status before trying again.'),{uncertain:true});clearPending();if(result.state){today=result.state;const at=instant(today.server_time);if(at)serverOffset=at.getTime()-Date.now();clearError();renderToday();}else await refresh();await window.loadTimesheet?.();assertCurrent(lease);if(request.action==='CHECK_OUT'){openCheckoutNote(result.attendance_id,result.attendance||{});}else{close();window.showToast?.(`${actionLabels[request.action]} recorded.`);}}
    catch(error){if(error.staleAccount||!current(lease))return;if(error.uncertain){openSheet('Check attendance status',`<p>The response was interrupted. This request may already have been saved. Do not scan again until its status has been checked.</p><div class="staff-sheet-actions">${button('staffAttendanceReconcile','Check server status')}${button('staffAttendancePendingClose','Close','secondary-btn')}</div>`,'pending');$('staffAttendanceReconcile').onclick=reconcileView;$('staffAttendancePendingClose').onclick=close;}else{clearPending();sheetError(error.message,error.fields);await refresh();if(!current(lease))return;if(String(error.code||'').startsWith('ATTENDANCE_QR_')&&overlayKind==='confirm'){if(confirm)confirm.dataset.qrExpired='true';$('staffAttendanceRescan')?.parentElement.remove();$('staffAttendanceBody').insertAdjacentHTML('beforeend',`<div class="staff-sheet-actions">${button('staffAttendanceRescan','Scan current QR again','secondary-btn')}</div>`);$('staffAttendanceRescan').onclick=()=>startCamera(request.action,request);}}}
    finally{if(current(lease)){submitBusy=false;if(confirm?.isConnected){confirm.disabled=confirm.dataset.qrExpired==='true';confirm.removeAttribute('aria-busy');}renderActions();}}
  }
  async function retryPending(retained){
    if(!pending||pending.request_id!==retained.request_id)return;
    const lease=account(),refreshed=await refresh();if(!current(lease))return;
    if(!refreshed||!allowed(retained.action)||(retained.action!=='CHECK_IN'&&String(retained.attendance_id)!==String(activeId()))){sheetError('The original action no longer matches the active session. Check its receipt again; no different session will be changed.');return;}
    if(['CHECK_IN','CHECK_OUT'].includes(retained.action)&&today.qr_required!==false)return startCamera(retained.action,retained);
    confirmAction(retained.action,null,{},retained);
  }
  async function reconcileView(){
    const previous=identity?account():null;if(!await verifyIdentity())return;if(previous&&!current(previous))return;
    if(!pending)return refresh();
    const lease=account(),retained={...pending};
    openSheet('Check attendance status','<p role="status">Checking the original request against the server...</p>','pending');
    try{
      const result=await api(`/api/attendance/reconcile?request_id=${encodeURIComponent(retained.request_id)}`);assertCurrent(lease);assertResult(result);
      if(result.state){today=result.state;const at=instant(today.server_time);if(at)serverOffset=at.getTime()-Date.now();clearError();renderToday();}
      if(result.found&&result.receipt){
        const receipt=result.receipt;
        if(String(receipt.request_id)!==String(retained.request_id))throw new Error('The returned receipt does not match the pending request. Contact your supervisor before retrying.');
        clearPending();
        if(retained.action==='CHECK_OUT')openCheckoutNote(receipt.attendance_id,receipt.attendance||{});
        else{openSheet('Attendance confirmed',`<p>${escape(actionLabels[retained.action]||'Attendance')} was recorded. No repeat action was sent.</p><div class="staff-sheet-actions">${button('staffAttendanceConfirmedClose','Done')}</div>`);$('staffAttendanceConfirmedClose').onclick=close;}
        await window.loadTimesheet?.();assertCurrent(lease);
      }else{
        const safeTarget=allowed(retained.action)&&(retained.action==='CHECK_IN'||String(retained.attendance_id)===String(activeId()));
        openSheet('Request not confirmed',`<p>The server has no completed receipt for this request. Your current attendance is shown below. A repeat action has not been sent.</p><p>${escape(labels[today?.status]||'Attendance needs review')}</p><div class="staff-sheet-actions">${button('staffAttendanceRecheck','Check again','secondary-btn')}${safeTarget?button('staffAttendanceRetryOriginal','Retry original request'):''}${button('staffAttendancePendingClose','Close','secondary-btn')}</div><p class="staff-sheet-subtitle">An authorised retry keeps the original request identity and exact session. It cannot toggle another shift. Contact your supervisor if the session no longer matches.</p>`,'pending');
        $('staffAttendanceRecheck').onclick=reconcileView;$('staffAttendancePendingClose').onclick=close;
        if($('staffAttendanceRetryOriginal'))$('staffAttendanceRetryOriginal').onclick=()=>retryPending(retained);
      }
    }catch(error){if(error.staleAccount||!current(lease))return;sheetError(error.message);$('staffAttendanceBody').insertAdjacentHTML('beforeend',`<div class="staff-sheet-actions">${button('staffAttendanceRecheck','Check again')}${button('staffAttendancePendingClose','Close','secondary-btn')}</div>`);$('staffAttendanceRecheck').onclick=reconcileView;$('staffAttendancePendingClose').onclick=close;}
    if(current(lease))renderActions();
  }
  function options(items,label){return `<option value="">${escape(label)}</option>`+(items||[]).map(item=>`<option value="${escape(typeof item==='object'?item.id:item)}">${escape(typeof item==='object'?item.title||item.name||item.label:item)}</option>`).join('');}
  function openCheckoutNote(attendanceId,attendance){
    const lease=account();if(!attendanceId){openSheet('Clock-out recorded','<p>Your shift has ended. Its note is not available yet; check attendance history before adding one.</p>');return;}
    const revision=attendance.revision??attendance.record_revision;let noteAttempt=null;const noteTasks=[...(today?.tasks||[])];if(attendance.checkout_task_id&&!noteTasks.some(task=>Number(task.id)===Number(attendance.checkout_task_id)))noteTasks.push({id:attendance.checkout_task_id,title:`Recorded task #${attendance.checkout_task_id}`});const noteCategories=[...(today?.categories||[])];if(attendance.checkout_category&&!noteCategories.includes(attendance.checkout_category))noteCategories.push(attendance.checkout_category);
    openSheet('Shift ended',`<p>Clock-out is saved for this session. An optional task summary can be added separately; skipping or a note failure does not undo clock-out.</p><label for="staffCheckoutTask">Task worked on (optional)</label><select id="staffCheckoutTask" name="task_id">${options(noteTasks,'No task selected')}</select><label for="staffCheckoutCategory">Work category (optional)</label><select id="staffCheckoutCategory" name="category">${options(noteCategories,'No category selected')}</select><label for="staffCheckoutNotes">Shift summary (optional)</label><textarea id="staffCheckoutNotes" name="notes" maxlength="10000" placeholder="Work completed, handover or issues"></textarea><div class="staff-sheet-actions">${button('staffCheckoutSave','Save summary')}${button('staffCheckoutSkip','Skip','secondary-btn')}</div>`,'note');
    $('staffCheckoutNotes').value=attendance.notes||'';$('staffCheckoutTask').value=attendance.checkout_task_id||'';$('staffCheckoutCategory').value=attendance.checkout_category||'';
    $('staffCheckoutSkip').onclick=close;$('staffCheckoutSave').onclick=async()=>{
      if(submitBusy||!current(lease))return;if(revision==null){sheetError('This session’s revision is not available. Open its saved history before adding a note. Clock-out is already saved.');return;}
      const notes=$('staffCheckoutNotes').value,task=$('staffCheckoutTask').value,category=$('staffCheckoutCategory').value;
      const payload=noteAttempt||{request_id:uuid(),expected_revision:revision,notes,...(task?{task_id:Number(task)}:{}),...(category?{category}:{})};noteAttempt=payload;
      submitBusy=true;$('staffCheckoutSave').disabled=true;
      try{const result=await api(`/api/attendance/sessions/${encodeURIComponent(attendanceId)}/note`,{method:'POST',body:JSON.stringify(payload)});assertCurrent(lease);assertResult(result);if(String(result.request_id)!==String(payload.request_id)||String(result.attendance_id)!==String(attendanceId))throw Object.assign(new Error('The summary response was interrupted. Retry the same summary request before changing it.'),{uncertain:true});if(overlayKind==='note')close();window.showToast?.('Shift summary saved.');await refresh();}
      catch(error){if(error.staleAccount||!current(lease))return;if(overlayKind==='note'){sheetError(`${error.message} Clock-out remains saved.`,error.fields);if(error.uncertain){$('staffCheckoutSave').textContent='Retry original summary';['staffCheckoutTask','staffCheckoutCategory','staffCheckoutNotes'].forEach(id=>{$(id).disabled=true;});}else noteAttempt=null;}}
      finally{if(current(lease)){submitBusy=false;if($('staffCheckoutSave'))$('staffCheckoutSave').disabled=false;}}
    };
  }
  async function openHistory(scope='own',pages={}){
    const previous=identity?account():null;if(!await verifyIdentity())return;if(previous&&!current(previous))return;const lease=account();
    const sequence=++historySequence;
    historyScope=['own','team','all'].includes(scope)?scope:'own';
    const requestedScope=historyScope,sessionPage=Number(pages.sessionPage||1),correctionPage=Number(pages.correctionPage||1);
    const sessionQuery=new URLSearchParams({page:String(sessionPage),page_size:'20',...(historyFrom?{from:historyFrom}:{}),...(historyTo?{to:historyTo}:{}),...(requestedScope!=='own'?{scope:requestedScope,status:sessionStatus,...(historySearch?{search:historySearch}:{})}:{})});
    const correctionQuery=new URLSearchParams({scope:requestedScope,status:historyStatus,page:String(correctionPage),page_size:'20'});
    openSheet('Attendance history','<p role="status">Loading recorded sessions and correction requests...</p>','history');
    try{
      const [attendance,requests]=await Promise.all([api(`${requestedScope==='own'?'/api/attendance/my':'/api/attendance/sessions'}?${sessionQuery}`),correctionAccess(requestedScope)?api(`/api/attendance/corrections?${correctionQuery}`):Promise.resolve({corrections:[],unavailable:true})]);
      assertCurrent(lease);assertResult(attendance);if(!requests.unavailable)assertResult(requests);if(sequence!==historySequence||overlayKind!=='history')return;
      history=attendance.attendance||attendance.sessions||[];corrections=requests.corrections||[];historyMeta=attendance;correctionMeta=requests;renderHistory();
    }catch(error){if(error.staleAccount||!current(lease))return;if(sequence===historySequence&&overlayKind==='history'){sheetError(error.message);$('staffAttendanceBody').insertAdjacentHTML('beforeend',`<div class="staff-sheet-actions">${button('staffHistoryRetry','Retry','secondary-btn')}</div>`);$('staffHistoryRetry').onclick=()=>openHistory(requestedScope,pages);}}
  }
  function historyPager(meta,kind){
    if(!Number.isInteger(meta.total))return '';
    return `<div class="staff-history-pagination"><span>${escape(meta.total)} ${kind==='sessions'?'sessions':'requests'} · Page ${escape(meta.page||1)} of ${escape(meta.pages||1)}</span><button type="button" class="secondary-btn" data-staff-history-page="${kind}" data-page="${Number(meta.page||1)-1}" ${Number(meta.page||1)<=1?'disabled':''}>Previous</button><button type="button" class="secondary-btn" data-staff-history-page="${kind}" data-page="${Number(meta.page||1)+1}" ${Number(meta.page||1)>=Number(meta.pages||1)?'disabled':''}>Next</button></div>`;
  }
  function correctionDetails(row){
    const before=row.before||{},proposed=row.proposed||{};
    return `${row.correction_type==='MISSING_SESSION'?'<p>Original: no retained attendance session.</p>':`<p>Original: ${escape(formatInstant(before.clock_in))} — ${before.clock_out?escape(formatInstant(before.clock_out)):'Incomplete'} · ${escape(duration(before.break_minutes))} break</p>`}<p>Proposed: ${escape(formatInstant(proposed.clock_in))} — ${proposed.clock_out?escape(formatInstant(proposed.clock_out)):'Incomplete; review required'} · ${escape(duration(proposed.break_minutes))} break</p>${proposed.notes?`<p>Proposed notes: ${escape(proposed.notes)}</p>`:''}`;
  }
  function renderHistory(){
    const sessions=history;
    const tabs=[['own','My records'],...(window.hasPermission?.('APPROVE_TEAM_TIMESHEET')||window.hasPermission?.('VIEW_TEAM_TIMESHEET')?[['team','Team attendance']]:[]),...(window.hasPermission?.('EDIT_ATTENDANCE')||window.hasPermission?.('VIEW_ALL_TIMESHEETS')||window.hasPermission?.('APPROVE_ALL_TIMESHEETS')?[['all','All authorised']]:[])];
    const filters=`<div class="staff-history-filters"><label for="staffHistoryFrom">From<input id="staffHistoryFrom" type="date" value="${escape(historyFrom)}"></label><label for="staffHistoryTo">To<input id="staffHistoryTo" type="date" value="${escape(historyTo)}"></label>${historyScope!=='own'?`<label for="staffHistorySearch">Staff or department<input id="staffHistorySearch" type="search" value="${escape(historySearch)}" maxlength="120"></label><label for="staffHistorySessionStatus">Session status<select id="staffHistorySessionStatus">${['ALL','OPEN','COMPLETED','REVIEW_REQUIRED'].map(status=>`<option value="${status}" ${status===sessionStatus?'selected':''}>${status==='ALL'?'All sessions':status==='REVIEW_REQUIRED'?'Review required':status[0]+status.slice(1).toLowerCase()}</option>`).join('')}</select></label>`:''}<button type="button" class="secondary-btn" data-staff-history-filter>Apply filters</button></div>`;
    $('staffAttendanceBody').innerHTML=`<div class="staff-history-tabs">${tabs.map(([scope,label])=>`<button type="button" class="${scope===historyScope?'primary-btn':'secondary-btn'}" data-staff-history-scope="${scope}" aria-pressed="${scope===historyScope}">${label}</button>`).join('')}</div><p class="staff-sheet-subtitle">Correction requests preserve original attendance until an authorised reviewer approves them.</p>${historyScope==='own'?'<button type="button" class="secondary-btn" id="staffRequestMissingSession" data-staff-missing-session>Request a missing shift</button>':''}${filters}${historyMeta.summary?`<p class="staff-sheet-subtitle">${escape(historyMeta.summary.session_count)} sessions · ${escape(historyMeta.summary.open_count)} open · ${escape(historyMeta.summary.review_count)} needing review</p>`:''}${sessions.length?sessions.map(row=>`<article class="staff-session-card"><strong>${historyScope!=='own'?`${escape(row.staff_name||'Authorised staff member')}${row.staff_department?` · ${escape(row.staff_department)}`:''} · `:''}${escape(dateOnly(row.work_date))} · ${escape(duration(row.total_minutes))}</strong><p>${escape(formatInstant(row.clock_in))} — ${row.clock_out?escape(formatInstant(row.clock_out)):'Not clocked out'}</p><p>${escape(row.review_required?'Review required':row.attendance_status||'Recorded')}${row.review_reason?` · ${escape(String(row.review_reason).replaceAll('_',' ').toLowerCase())}`:''}${row.notes?` · ${escape(row.notes)}`:''}</p>${historyScope==='own'?`<button type="button" class="staff-text-button" data-staff-correct-session="${escape(row.id)}">Request correction</button>${row.clock_out?`<button type="button" class="staff-text-button" data-staff-session-note="${escape(row.id)}">Edit summary</button>`:''}`:''}</article>`).join(''):'<p>No recorded sessions match these filters.</p>'}${historyPager(historyMeta,'sessions')}<div class="staff-home-card-heading"><h3>Correction requests</h3><select id="staffHistoryStatus" aria-label="Filter correction requests">${['ALL','PENDING','APPROVED','REJECTED'].map(status=>`<option value="${status}" ${status===historyStatus?'selected':''}>${status==='ALL'?'All statuses':status[0]+status.slice(1).toLowerCase()}</option>`).join('')}</select></div><div class="staff-correction-list">${corrections.length?corrections.map(row=>`<article class="staff-correction-item"><strong>${historyScope!=='own'&&row.staff_name?`${escape(row.staff_name)} · `:''}${escape(row.status||'Pending')}</strong><p>${escape(row.reason||'')}</p>${correctionDetails(row)}${row.decision_reason?`<p>Review: ${escape(row.decision_reason)}</p>`:''}${row.can_review===true?`<div class="staff-sheet-actions"><button class="primary-btn" type="button" data-staff-correction-review="${escape(row.id)}" data-decision="approve">Review approval</button><button class="secondary-btn" type="button" data-staff-correction-review="${escape(row.id)}" data-decision="reject">Review rejection</button></div>`:''}</article>`).join(''):'<p class="staff-home-muted">No correction requests in this scope.</p>'}</div>${historyPager(correctionMeta,'corrections')}`;
    if(correctionMeta.unavailable){$('staffHistoryStatus')?.parentElement.remove();$('staffAttendanceBody').querySelector('.staff-correction-list')?.remove();}
    else $('staffHistoryStatus').onchange=()=>{historyStatus=$('staffHistoryStatus').value;openHistory(historyScope,{sessionPage:historyMeta.page||1});};
  }
  function reviewCorrection(id,decision){
    const lease=account();const row=corrections.find(item=>String(item.id)===String(id));if(!row||row.can_review!==true||!['approve','reject'].includes(decision))return;let reviewAttempt=null;
    openSheet(`${decision==='approve'?'Approve':'Reject'} correction`,`${row.staff_name?`<p>${escape(row.staff_name)}</p>`:''}<p>${escape(row.reason)}</p>${correctionDetails(row)}<label for="staffCorrectionDecisionReason">Review reason</label><textarea id="staffCorrectionDecisionReason" name="reason" maxlength="1000" required></textarea><p class="staff-sheet-subtitle">${decision==='approve'?'Approval applies this exact proposed correction after checking its original record and authority.':'Rejection retains the original attendance.'}</p><div class="staff-sheet-actions">${button('staffCorrectionDecisionConfirm',`Confirm ${decision==='approve'?'approval':'rejection'}`)}${button('staffCorrectionDecisionBack','Back','secondary-btn')}</div>`,'review');
    $('staffCorrectionDecisionBack').onclick=()=>openHistory(historyScope);
    $('staffCorrectionDecisionConfirm').onclick=async()=>{if(submitBusy||!current(lease))return;const reason=$('staffCorrectionDecisionReason').value.trim();if(!reason){sheetError('Record a review reason before confirming.');return;}const payload=reviewAttempt||{expected_revision:row.revision,reason};reviewAttempt=payload;submitBusy=true;$('staffCorrectionDecisionConfirm').disabled=true;try{const result=await api(`/api/attendance/corrections/${encodeURIComponent(row.id)}/${decision}`,{method:'POST',body:JSON.stringify(payload)});assertCurrent(lease);assertResult(result);if(String(result.correction?.id)!==String(row.id)||String(result.correction?.status)!==(decision==='approve'?'APPROVED':'REJECTED'))throw Object.assign(new Error('The review outcome could not be confirmed. Retry this same decision or refresh the request before deciding again.'),{uncertain:true});window.showToast?.(`Correction ${decision==='approve'?'approved':'rejected'}.`);await refresh();assertCurrent(lease);await openHistory(historyScope);}catch(error){if(error.staleAccount||!current(lease))return;sheetError(error.message,error.fields);if(error.uncertain&&$('staffCorrectionDecisionReason')){$('staffCorrectionDecisionReason').disabled=true;$('staffCorrectionDecisionConfirm').textContent='Retry original review';}else reviewAttempt=null;}finally{if(current(lease)){submitBusy=false;if($('staffCorrectionDecisionConfirm'))$('staffCorrectionDecisionConfirm').disabled=false;}}};
  }
  function openCorrection(id=null){
    const lease=account();const missing=id===null,row=missing?{}:history.find(item=>String(item.id)===String(id));if(!row)return;
    const version=row.revision??row.record_revision;let correctionAttempt=null;
    openSheet(missing?'Request a missing shift':'Request an attendance correction',`<p class="staff-sheet-subtitle">${missing?'This requests an authorised review of a shift missing from your records. It does not clock you in or add worked hours until approval.':`This requests a review of your ${escape(dateOnly(row.work_date))} session. Original attendance stays unchanged until approval.`}</p><div class="staff-correction-grid"><div><label for="staffCorrectionStart">${missing?'Shift start':'Correct start'}</label><input id="staffCorrectionStart" name="clock_in" type="datetime-local" value="${escape(localInput(row.clock_in))}" required></div><div><label for="staffCorrectionEnd">${missing?'Shift end (if completed)':'Correct end'}</label><input id="staffCorrectionEnd" name="clock_out" type="datetime-local" value="${escape(localInput(row.clock_out))}" ${missing?'':'required'}></div><div><label for="staffCorrectionBreak">Break minutes</label><input id="staffCorrectionBreak" name="break_minutes" type="number" min="0" max="1440" step="1" value="${escape(row.break_minutes??0)}"></div><div class="staff-correction-full"><label for="staffCorrectionReason">Reason for review</label><textarea id="staffCorrectionReason" name="reason" required maxlength="1000"></textarea></div><div class="staff-correction-full"><label for="staffCorrectionNotes">${missing?'Shift notes':'Proposed notes'} (optional)</label><textarea id="staffCorrectionNotes" name="notes" maxlength="10000">${escape(row.notes||'')}</textarea></div></div><p class="staff-sheet-subtitle">These are workplace local times in ${escape(today?.company_timezone)}. Ambiguous or incomplete times require review.</p><div class="staff-sheet-actions">${button('staffCorrectionSubmit','Submit for review')}${button('staffCorrectionBack','Back','secondary-btn')}</div>`,'correction');
    $('staffCorrectionBack').onclick=()=>{openSheet('Attendance history','','history');renderHistory();};
    $('staffCorrectionSubmit').onclick=async()=>{
      if(submitBusy||!current(lease))return;const start=$('staffCorrectionStart'),end=$('staffCorrectionEnd'),reason=$('staffCorrectionReason');
      if(!start.value||(!missing&&!end.value)||!reason.value.trim()){sheetError('Provide the workplace shift times and a reason for review.');return;}
      if(!missing&&version==null){sheetError('This record’s revision is unavailable. Refresh its history before requesting a correction.');return;}
      const payload=correctionAttempt||{request_id:uuid(),...(missing?{correction_type:'MISSING_SESSION'}:{attendance_id:row.id,expected_revision:version}),clock_in:start.value,...(end.value?{clock_out:end.value}:{}),break_minutes:Number($('staffCorrectionBreak').value),notes:$('staffCorrectionNotes').value,reason:reason.value.trim()};
      correctionAttempt=payload;submitBusy=true;$('staffCorrectionSubmit').disabled=true;
      try{const result=await api('/api/attendance/corrections',{method:'POST',body:JSON.stringify(payload)});assertCurrent(lease);assertResult(result);if(!result.correction?.id||String(result.correction.request_id)!==String(payload.request_id))throw Object.assign(new Error('The correction response could not be confirmed. Retry the same request before editing its details.'),{uncertain:true});window.showToast?.('Correction submitted for authorised review.');await openHistory();}
      catch(error){if(error.staleAccount||!current(lease))return;if(overlayKind==='correction'){sheetError(error.message,error.fields);if(error.uncertain){$('staffCorrectionSubmit').textContent='Retry original request';$('staffAttendanceBody').querySelectorAll('input,textarea').forEach(input=>{input.disabled=true;});}else correctionAttempt=null;}}
      finally{if(current(lease)){submitBusy=false;if($('staffCorrectionSubmit'))$('staffCorrectionSubmit').disabled=false;}}
    };
  }
  function navigate(section){close();window.VoxelOverlay?.close('staff-profile');window.goStaffSection?.(section);setText('staffPageTitle',section==='dashboardSection'?'Home':document.querySelector(`.sidebar [data-section="${section}"]`)?.textContent?.trim()||'Workspace');}
  function profileMenu(){const menu=$('staffProfileMenu'),toggle=$('staffProfileMenuToggle');if(!menu.hidden){window.VoxelOverlay?.close('staff-profile');menu.hidden=true;toggle.setAttribute('aria-expanded','false');return;}close();if(window.VoxelOverlay?.open('staff-profile',()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');},toggle)===false)return;menu.hidden=false;toggle.setAttribute('aria-expanded','true');menu.querySelector('button')?.focus();}
  function applyIdentity(user){
    const switched=identity&&String(identity.id)!==String(user.id);identity=user;
    if(switched){historySequence++;today=null;history=[];corrections=[];clearPending();close();clearError();['staffHomeWorked','staffHomeBreak','staffHomeSessions','staffHomeFirstCheckIn','staffHomeLastCheckOut','weekHoursCount','staffHomeWeekHours'].forEach(id=>setText(id,'—'));setText('staffHomeStatus','Checking...');setText('staffHomeDate','Checking workplace time...');setText('staffHomeAttendanceNote','');setText('staffHomeWorkedDetail','Loading your attendance record');$('staffHomeTimeline').innerHTML='<li class="staff-home-empty">Loading your sessions...</li>';setText('staffHomeNextShift','Loading your next shift...');setText('staffHomeTasks','Loading assigned work...');}
    hydratePending();greeting();renderRoleWork(user);renderActions();$('staffHomeAccountOnly').hidden=window.hasPermission?.('attendance')!==false;
  }
  function renderRoleWork(user){
    let panel=$('staffRoleWork');if(!panel){panel=document.createElement('section');panel.id='staffRoleWork';panel.className='staff-role-work';$('staffHomeError').after(panel);}
    const roles={
      manager:['Team work',[['Team attendance','VIEW_TEAM_TIMESHEET','timesheetSection'],['Approvals','VIEW_APPROVALS','approvalsSection'],['Tasks','tasks','tasksSection'],['Procurement','VIEW_PROCUREMENT','procurementSection']]],
      supervisor:['Team work',[['Team attendance','VIEW_TEAM_TIMESHEET','timesheetSection'],['Approvals','VIEW_APPROVALS','approvalsSection'],['Tasks','tasks','tasksSection'],['Quality','VIEW_QMS','formsSection']]],
      hr:['People & roster',[['Staff documents','VIEW_STAFF_HR','formsSection'],['Attendance review','EDIT_ATTENDANCE','timesheetSection'],['Roster','VIEW_ATTENDANCE','rosterSection'],['Documents','VIEW_COMPLIANCE','formsSection']]],
      production:['Production work',[['Assigned jobs & stages','tasks','tasksSection'],['Materials','VIEW_INVENTORY','rawMaterialSection'],['Quality records','VIEW_QMS','formsSection']]],
      sales:['Customer work',[['RFQs & quotations','VIEW_RFQS','staffRfqSection'],['Customers','VIEW_CUSTOMERS','staffCustomerSection'],['Meetings','VIEW_MEETINGS','meetingsSection']]]
    };
    const config=roles[user.role];panel.replaceChildren();panel.hidden=!config;if(!config)return;
    const title=document.createElement('h2');title.textContent=config[0];panel.append(title);const actions=document.createElement('div');actions.className='staff-role-actions';panel.append(actions);
    for(const [label,permission,section]of config[1]){if(!window.hasPermission?.(permission)||!$(section))continue;const item=document.createElement('button');item.type='button';item.className='secondary-btn';item.textContent=label;item.onclick=()=>section==='timesheetSection'&&permission==='VIEW_TEAM_TIMESHEET'?openHistory('team'):section==='timesheetSection'&&permission==='EDIT_ATTENDANCE'?openHistory('all'):navigate(section);actions.append(item);}
    panel.hidden=!actions.childElementCount;
  }
  function install(){
    if(!$('staffHomeGreeting'))return;
    $('staffHomeRefresh').onclick=refresh;$('staffHomeRetry').onclick=refresh;$('staffHomeHistory').onclick=()=>openHistory('own');
    $('staffHomePrimaryAction').onclick=()=>$('staffHomePrimaryAction').dataset.attendanceAction==='RECONCILE'?reconcileView():openAction($('staffHomePrimaryAction').dataset.attendanceAction);$('staffHomeBreakAction').onclick=()=>openAction($('staffHomeBreakAction').dataset.attendanceAction);
    $('staffAttendanceClose').onclick=close;$('staffAttendanceOverlay').onclick=event=>{if(event.target===$('staffAttendanceOverlay'))close();};
    $('staffProfileMenuToggle').onclick=profileMenu;$('staffProfileLogout').onclick=()=>window.logout?.();
    $('staffThemeControl').onclick=()=>window.VoxelTheme?.set(window.VoxelTheme.mode==='dark'?'light':'dark');
    const updateTheme=()=>{const mode=window.VoxelTheme?.mode||'light';$('staffThemeControl').setAttribute('aria-label',`Use ${mode==='dark'?'light':'dark'} theme`);$('staffThemeControl').title=`Use ${mode==='dark'?'light':'dark'} theme`;};updateTheme();window.addEventListener('workspace:theme',updateTheme);
    document.addEventListener('click',event=>{const link=event.target.closest('[data-staff-home-section]');if(link)navigate(link.dataset.staffHomeSection);const dateFilter=event.target.closest('[data-staff-history-filter]');if(dateFilter){historyFrom=$('staffHistoryFrom').value;historyTo=$('staffHistoryTo').value;historySearch=$('staffHistorySearch')?.value||'';sessionStatus=$('staffHistorySessionStatus')?.value||'ALL';openHistory(historyScope);}const pager=event.target.closest('[data-staff-history-page]');if(pager&&!pager.disabled)openHistory(historyScope,{sessionPage:pager.dataset.staffHistoryPage==='sessions'?Number(pager.dataset.page):historyMeta.page||1,correctionPage:pager.dataset.staffHistoryPage==='corrections'?Number(pager.dataset.page):correctionMeta.page||1});const summary=event.target.closest('[data-staff-session-note]');if(summary){const row=history.find(item=>String(item.id)===summary.dataset.staffSessionNote);if(row)openCheckoutNote(row.id,row);}const missing=event.target.closest('[data-staff-missing-session]');if(missing)openCorrection();const correction=event.target.closest('[data-staff-correct-session]');if(correction)openCorrection(correction.dataset.staffCorrectSession);const historyTab=event.target.closest('[data-staff-history-scope]');if(historyTab)openHistory(historyTab.dataset.staffHistoryScope);const review=event.target.closest('[data-staff-correction-review]');if(review)reviewCorrection(review.dataset.staffCorrectionReview,review.dataset.decision);const nav=event.target.closest('.nav-btn[data-section]');if(nav){const section=nav.dataset.section;setText('staffPageTitle',section==='dashboardSection'?'Home':document.querySelector(`.sidebar [data-section="${section}"]`)?.textContent?.trim()||nav.textContent.trim());document.querySelectorAll('.staff-mobile-bottom-nav .nav-btn').forEach(button=>button.classList.toggle('active',button.dataset.section===section));if(section==='dashboardSection')refresh();}if(!event.target.closest('.staff-profile-menu-wrap')&&!$('staffProfileMenu').hidden){window.VoxelOverlay?.close('staff-profile');$('staffProfileMenu').hidden=true;$('staffProfileMenuToggle').setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){close();return;}if(event.key!=='Tab'||$('staffAttendanceOverlay').hidden)return;const controls=[...$('staffAttendanceOverlay').querySelectorAll('button,input,select,textarea,a[href]')].filter(node=>!node.disabled&&node.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
    window.addEventListener('storage',event=>{if(!event.key||['user','token','role'].includes(event.key))boundary();});
    window.addEventListener('vv:auth-changed',()=>boundary());
    window.addEventListener('vv:avatar-clear',()=>{if(!applyingVerifiedProfile)boundary();});
    window.addEventListener('vv:avatar-auth-required',()=>boundary());
    window.addEventListener('vv:avatar-profile',event=>{const id=event.detail?.profile?.id;if(!Number.isSafeInteger(Number(id))||Number(id)<1)return;if(identity&&String(identity.id)!==String(id))boundary();else if(!identity&&!identityPromise&&!loading){clearTimeout(boundaryTimer);boundaryTimer=setTimeout(()=>{void refresh();},0);}});
    window.addEventListener('pagehide',()=>boundary({refreshAgain:false}));
    window.addEventListener('pageshow',()=>{void refresh();void acceptCameraIntent();});window.addEventListener('focus',()=>{void refresh();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  }
  const oldProfile=window.renderStaffProfile;if(typeof oldProfile==='function')window.renderStaffProfile=function(){void refresh();};
  window.refreshStaffSession=verifyIdentity;
  window.loadStaffInfo=async()=>{for(let attempt=0;attempt<3;attempt++){const epoch=authEpoch,user=await verifyIdentity();if(user)return user;if(epoch===authEpoch)return null;}return null;};
  // All legacy attendance entry points now use the explicit, server-backed flow.
  window.loadAttendanceStatus=refresh;window.openShiftQrScanner=mode=>openAction(mode==='out'?'CHECK_OUT':'CHECK_IN');window.openMissionShiftScanner=()=>openAction(allowed('CHECK_OUT')?'CHECK_OUT':'CHECK_IN');
  window.clockIn=()=>openAction('CHECK_IN');window.clockOut=()=>openAction('CHECK_OUT');window.submitShiftQr=(mode,token)=>verifyQr(mode==='out'?'CHECK_OUT':'CHECK_IN',token);
  window.VoxelStaffHome={refresh,openAction,acceptCameraIntent,openHistory,closeOverlay,close,reconcile:reconcileView,get state(){return today;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
