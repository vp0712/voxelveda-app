(() => {
  'use strict';
  const state={open:false,items:[],unread:null,page:1,pages:1,loading:false,error:'',moreError:'',notice:'',pending:new Set(),request:null,returnFocus:null};
  let panel,list,status,markAll,count,backdrop,started=false,countRequest=null;
  const escape=value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const triggers=()=>[...document.querySelectorAll('[data-notification-toggle],#notificationBell,#staffNotificationBell')];
  function headers(){return {'Content-Type':'application/json',...(typeof window.authHeaders==='function'?window.authHeaders():{})};}
  async function api(path,options={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch('/api/notifications'+path,{credentials:'same-origin',headers:headers(),...options,signal:controller.signal});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message || 'Notifications could not be loaded.');
      return body;
    }catch(error){if(error.name==='AbortError')throw new Error('Notifications took too long to respond. Please retry.');throw error;}finally{clearTimeout(timer);}
  }
  function safeUrl(value) {
    if(typeof value!=='string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value))return null;
    try{const url=new URL(value,location.origin),path=decodeURIComponent(url.pathname).toLowerCase(),view=String(url.searchParams.get('view') || '').toLowerCase();if(url.origin!==location.origin || /[\\\x00-\x20\x7f%]/.test(path) || /^\/(?:api\/(?:banking|finance|erp|high-risk-finance)|finance(?:[-/.]|$)|banking(?:[/.]|$)|erp(?:[/.]|$)|personal-finance|financial-years)/.test(path) || /^(?:finance|banking|erp|personal-finance|financial-years)(?:[-_]|$)/.test(view))return null;return url.pathname+url.search+url.hash;}catch{return null;}
  }
  function badges() {
    document.querySelectorAll('#notificationBadge,#staffNotificationBadge,[data-notification-badge]').forEach(element=>{if(state.unread===null){element.hidden=true;return;}element.textContent=state.unread>99?'99+':String(state.unread);element.hidden=state.unread===0;element.classList.toggle('hidden-section',state.unread===0);});
    triggers().forEach(trigger=>{trigger.setAttribute('aria-expanded',String(state.open));trigger.setAttribute('aria-controls',panel?.id || '');trigger.setAttribute('aria-label',state.unread===null?'Open notifications':`Open notifications${state.unread?`, ${state.unread} unread`:''}`);});
    if(count)count.textContent=state.loading?'Loading…':state.unread===null?'':state.unread?`${state.unread} unread`:'All read';
    if(markAll){markAll.hidden=!(state.unread>0);markAll.parentElement.hidden=!(state.unread>0);markAll.disabled=state.loading || state.pending.has('all');}
  }
  function age(value){const time=new Date(value);if(Number.isNaN(time.getTime()))return '';const minutes=Math.floor(Math.max(0,Date.now()-time.getTime())/60000);return minutes<1?'Now':minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:time.toLocaleDateString('en-AU',{day:'numeric',month:'short'});}
  function statusMessage(message,retry=false) {
    status.replaceChildren();status.hidden=!message;status.setAttribute('role',state.error || state.moreError?'alert':'status');
    if(!message)return;const copy=document.createElement('p');copy.textContent=message;status.append(copy);
    if(retry){const button=document.createElement('button');button.type='button';button.className='vv-notification-retry';button.textContent='Retry';button.addEventListener('click',()=>refresh(Boolean(state.moreError)));status.append(button);}
  }
  function render() {
    if(!panel)return;badges();list.setAttribute('aria-busy',String(state.loading));
    list.replaceChildren();
    for(const item of state.items){
      const article=document.createElement('li');article.className='vv-notification-item '+(Number(item.is_read)?'is-read':'is-unread');
      const button=document.createElement('button');button.type='button';button.className='vv-notification-entry';button.disabled=state.pending.has(String(item.id));button.dataset.notificationId=String(item.id);button.setAttribute('aria-label',`${item.title || 'Notification'}, ${Number(item.is_read)?'read':'unread'}`);
      const dot=document.createElement('span');dot.className='vv-notification-dot';dot.setAttribute('aria-hidden','true');
      const content=document.createElement('span');content.className='vv-notification-copy';
      const title=document.createElement('strong');title.textContent=item.title || 'Notification';const message=document.createElement('span');message.className='vv-notification-message';message.textContent=item.message || '';
      const time=document.createElement('time');time.textContent=age(item.created_at);if(item.created_at)time.dateTime=String(item.created_at);
      content.append(title,message,time);button.append(dot,content);article.append(button);list.append(article);
    }
    const message=state.error || state.moreError || state.notice || (state.loading?'Loading notifications…':!state.items.length?'You have no notifications.':'');statusMessage(message,Boolean(state.error || state.moreError));
  }
  function acceptCount(value){if(Number.isSafeInteger(Number(value)) && Number(value)>=0)state.unread=Number(value);}
  async function refresh(more=false) {
    if(!init())return;
    if(!state.open && !more)return refreshCount();
    if(state.request)return state.request;
    state.loading=true;state.error='';state.moreError='';state.notice='';render();
    state.request=(async()=>{try{const next=more?state.page+1:1,data=await api(`?page=${next}&limit=30`);if(!Array.isArray(data.notifications) || !Number.isSafeInteger(Number(data.unread)))throw new Error('Notification status is unavailable. Please retry.');state.items=more?[...new Map([...state.items,...data.notifications].map(item=>[String(item.id),item])).values()]:data.notifications;state.page=Number(data.page || next);state.pages=Number(data.pages || 1);acceptCount(data.unread);}catch(error){if(more)state.moreError=error.message;else state.error=error.message;}finally{state.loading=false;state.request=null;render();}})();
    return state.request;
  }
  async function refreshCount() {
    if(state.open)return refresh();
    if(countRequest)return countRequest;
    countRequest=(async()=>{try{const data=await api('/unread-count');acceptCount(data.unread);badges();}catch{ /* Keep the last known count; opening the center exposes a retry state. */ }finally{countRequest=null;}})();return countRequest;
  }
  function position() {
    if(!panel || innerWidth<=640)return;
    const bell=document.querySelector('#notificationBell,#staffNotificationBell,[data-notification-toggle]'),rect=bell?.getBoundingClientRect();if(!rect)return;
    const width=Math.min(400,innerWidth-24);panel.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right-width))+'px';panel.style.top=Math.min(rect.bottom+10,Math.max(12,innerHeight-220))+'px';panel.style.setProperty('--notification-room',Math.max(180,innerHeight-rect.bottom-24)+'px');
  }
  function hide(reason='closed') {
    state.open=false;if(panel)panel.hidden=true;if(backdrop)backdrop.hidden=true;badges();
    if(!window.VoxelOverlay && reason!=='replacement' && state.returnFocus?.isConnected)state.returnFocus.focus({preventScroll:true});
  }
  function close(reason='closed') {if(window.VoxelOverlay?.active==='notifications')window.VoxelOverlay.close('notifications',typeof reason==='string'?reason:'closed');else hide(typeof reason==='string'?reason:'closed');}
  async function open(trigger) {
    if(!init())return;
    state.returnFocus=trigger instanceof HTMLElement?trigger:document.activeElement;
    if(typeof window.toggleMobileMenu==='function')window.toggleMobileMenu(false);
    if(typeof window.toggleStaffMobileMenu==='function')window.toggleStaffMobileMenu(false);
    if(window.VoxelOverlay)window.VoxelOverlay.open('notifications',hide,state.returnFocus);
    state.open=true;panel.hidden=false;backdrop.hidden=false;position();badges();
    requestAnimationFrame(()=>{if(state.open)panel.querySelector('[data-notification-close]')?.focus({preventScroll:true});});
    await refresh();
  }
  function toggle(event){event?.preventDefault?.();event?.stopPropagation?.();if(state.open)close();else void open(event?.currentTarget || event?.target?.closest?.('[data-notification-toggle]'));}
  function recordHtml(record,kind) {
    const labels={title:'Title',description:'Description',summary:'Summary',status:'Status',priority:'Priority',due_date:'Due date',week_start:'Week start',week_end:'Week end',total_hours:'Worked hours',classification:'Classification',quantity:'Quantity',unit:'Unit',unit_price:'Unit price',currency:'Currency',total:'Total',reason:'Reason',decision_reason:'Decision',revision:'Revision',receipt_no:'Receipt',received_date:'Received',return_no:'Return',total_amount:'Total amount',supplier_name:'Supplier',expense_date:'Expense date',customer_name:'Customer',material:'Material',staff_name:'Staff',created_at:'Requested'};
    let html='<dl class="vv-notification-record">'+Object.entries(labels).filter(([key])=>record[key]!==undefined && record[key]!==null && record[key]!=='').map(([key,label])=>`<div><dt>${label}</dt><dd>${escape(record[key])}</dd></div>`).join('')+'</dl>';
    if(kind==='ATTENDANCE_CORRECTION' && record.proposed)html+='<h4>Proposed correction</h4><dl class="vv-notification-record">'+['clock_in','clock_out','break_minutes','notes'].filter(key=>record.proposed[key]!==undefined).map(key=>`<div><dt>${escape(key.replaceAll('_',' '))}</dt><dd>${escape(record.proposed[key] ?? '—')}</dd></div>`).join('')+'</dl>';
    return html;
  }
  async function openSpecific(result,notificationId) {
    const target=result.target;if(!target)return false;
    // Fetching the target again uses current backend permissions and record scope,
    // including when a notification was received before permissions changed.
    const fresh=await api(`/${Number(notificationId)}/target`);
    if(fresh.target_status!=='AVAILABLE' || !fresh.target)throw new Error(fresh.target_message || 'This record is no longer available.');
    const current=fresh.target,id=current.record_id;
    if(current.kind==='WORKFLOW' && window.VoxelWorkflowUI?.openDetail){close('replacement');await window.VoxelWorkflowUI.openDetail(id);return true;}
    if(current.kind==='TASK' && current.record?.can_manage && typeof window.openTaskDialog==='function' && typeof window.loadTasks==='function'){
      await window.loadTasks();const checked=await api(`/${Number(notificationId)}/target`);if(checked.target_status!=='AVAILABLE')throw new Error(checked.target_message || 'This task is no longer available.');close('replacement');window.openTaskDialog(Number(id));return true;
    }
    if(current.kind==='TIMESHEET' && typeof window.openTimesheetDetail==='function'){close('replacement');await window.openTimesheetDetail(Number(id));return true;}
    if(current.kind==='ATTENDANCE_CORRECTION' && window.VoxelAttendance?.openCorrection){close('replacement');await window.VoxelAttendance.openCorrection(Number(id));return true;}
    let record=current.record;
    if(current.detail_url && !['TASK','RFQ','QUALITY'].includes(current.kind)) {
      const path=safeUrl(current.detail_url);if(!path || !/^\/api\/(?:attendance\/(?:timesheets|corrections)|procurement\/entries|workflows\/instances)\//.test(path))throw new Error('The record detail URL is unavailable.');
      const response=await fetch(path,{credentials:'same-origin',headers:headers()}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message || 'This record is no longer available.');record=data.correction || data.entry || data.timesheet || data.instance || data;
    }
    const show=typeof window.showStaffDialog==='function'?window.showStaffDialog:window.showDialog,hideDialog=typeof window.hideStaffDialog==='function'?window.hideStaffDialog:window.hideDialog;
    if(typeof show!=='function')return false;
    close('replacement');show(record.title || result.notification?.title || 'Record details',recordHtml(record,current.kind),hideDialog,'Close');return true;
  }
  async function openItem(id) {
    const key=String(id);if(state.pending.has(key))return;state.pending.add(key);state.notice='';render();
    try {
      const result=await api(`/${Number(id)}/open`,{method:'POST',body:'{}'});acceptCount(result.unread);const item=state.items.find(row=>String(row.id)===key);if(item)item.is_read=1;render();
      if(result.target_status==='UNAVAILABLE'){state.notice=result.target_message || 'This item is no longer available.';render();return;}
      if(result.target_status==='AVAILABLE'){
        if(await openSpecific(result,id))return;
        const url=safeUrl(result.action_url);if(!url)throw new Error('The notification target is unavailable.');close('replacement');location.assign(url);
      }
    }catch(error){state.error=error.message;render();}finally{state.pending.delete(key);render();}
  }
  async function allRead() {
    if(state.pending.has('all') || !(state.unread>0))return;state.pending.add('all');badges();
    try{const data=await api('/mark-all-read',{method:'POST',body:'{}'});acceptCount(data.unread);state.error='';await refresh();}catch(error){state.error=error.message;render();}finally{state.pending.delete('all');badges();}
  }
  function init() {
    if(started)return Boolean(panel);
    panel=document.querySelector('[data-notification-panel],#notificationPanel,#staffNotificationPanel');if(!panel)return false;started=true;
    panel.classList.remove('notification-panel');panel.classList.add('vv-notification-panel');panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','vvNotificationTitle');
    panel.innerHTML='<header class="vv-notification-head"><div><h2 id="vvNotificationTitle">Notifications</h2><span data-notification-count></span></div><button type="button" data-notification-close aria-label="Close notifications"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></header><div class="vv-notification-scroll" tabindex="0" aria-label="Notification list"><ul data-notification-list></ul><div data-notification-status></div></div><footer class="vv-notification-foot"><button type="button" data-notification-read-all hidden>Mark all read</button></footer>';
    list=panel.querySelector('[data-notification-list]');status=panel.querySelector('[data-notification-status]');count=panel.querySelector('[data-notification-count]');markAll=panel.querySelector('[data-notification-read-all]');
    backdrop=document.createElement('div');backdrop.className='vv-notification-backdrop';backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');document.body.append(backdrop);document.body.append(panel);
    triggers().forEach(trigger=>{trigger.dataset.notificationToggle='';trigger.removeAttribute('onclick');});
    panel.querySelector('[data-notification-close]').addEventListener('click',()=>close());backdrop.addEventListener('click',()=>close());markAll.addEventListener('click',allRead);
    list.addEventListener('click',event=>{const item=event.target.closest('[data-notification-id]');if(item)void openItem(item.dataset.notificationId);});
    panel.querySelector('.vv-notification-scroll').addEventListener('scroll',event=>{const el=event.currentTarget;if(el.scrollTop+el.clientHeight>=el.scrollHeight-60 && state.page<state.pages && !state.loading && !state.moreError)void refresh(true);},{passive:true});
    document.addEventListener('click',event=>{const trigger=event.target.closest?.('[data-notification-toggle],#notificationBell,#staffNotificationBell');if(trigger){event.preventDefault();event.stopImmediatePropagation();toggle({currentTarget:trigger,preventDefault(){},stopPropagation(){}});}},true);
    document.addEventListener('keydown',event=>{if(!state.open)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close('escape');return;}if(event.key==='Tab'){const controls=[...panel.querySelectorAll('button,[tabindex="0"]')].filter(el=>!el.disabled && !el.hidden && el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey && (document.activeElement===first || !panel.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey && (document.activeElement===last || !panel.contains(document.activeElement))){event.preventDefault();first?.focus();}}},true);
    window.addEventListener('resize',position);window.addEventListener('pagehide',()=>close('navigation'));document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshCount();});
    badges();void refreshCount();
    const selected=new URLSearchParams(location.search).get('notification_id');if(/^[1-9]\d{0,15}$/.test(selected || ''))void api('/'+selected+'/target').then(result=>openSpecific(result,selected)).catch(error=>window.showToast?.(error.message));
    return true;
  }
  async function preferences() {
    if(location.pathname!=='/profile' || document.getElementById('notifications'))return;
    const section=document.createElement('section');section.id='notifications';section.className='vv-notification-preferences card';section.innerHTML='<h2>Notification preferences</h2><p>Choose which categories appear in your notification center.</p><form data-notification-preferences></form><p data-preference-status role="status">Loading preferences…</p>';document.querySelector('main.shell,main')?.append(section);
    const form=section.querySelector('form'),message=section.querySelector('[data-preference-status]');
    async function load(){try{const data=await api('/preferences'),saved=new Map((data.preferences || []).map(row=>[row.category,row]));form.replaceChildren();for(const category of ['FINANCE','PRODUCTION','QUALITY','SECURITY','HR','TASKS','SYSTEM']){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.name=category;input.checked=Number(saved.get(category)?.in_app_enabled ?? 1)!==0;label.append(input,document.createTextNode(category.toLowerCase().replace(/\b\w/g,char=>char.toUpperCase())));form.append(label);}const button=document.createElement('button');button.type='submit';button.textContent='Save preferences';form.append(button);message.textContent='';form.onsubmit=async event=>{event.preventDefault();button.disabled=true;const controls=[...form.querySelectorAll('input')];controls.forEach(input=>{input.disabled=true;});try{await Promise.all(controls.map(input=>api('/preferences',{method:'PATCH',body:JSON.stringify({...saved.get(input.name),category:input.name,in_app_enabled:input.checked})})));message.textContent='Preferences saved.';}catch(error){message.textContent=error.message;}finally{button.disabled=false;controls.forEach(input=>{input.disabled=false;});}};}catch(error){message.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.addEventListener('click',load);message.append(retry);}}
    await load();if(location.hash==='#notifications')section.scrollIntoView({block:'start'});
  }
  window.VoxelNotificationCenter={open,toggle,close,refresh,refreshCount,get ready(){return Boolean(panel);}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{init();void preferences();});else{init();void preferences();}
})();
