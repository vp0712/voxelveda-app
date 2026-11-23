(() => {
  'use strict';
  const state={open:false,items:[],unread:null,page:1,pages:1,loading:false,error:'',moreError:'',notice:'',pending:new Set(),request:null,returnFocus:null};
  let panel,list,status,markAll,count,backdrop,started=false,countRequest=null,countRevision=0;
  const teamState={open:false,profile:null,items:[],before:null,detail:null,view:'feed',error:'',busy:false,revision:0,trigger:null};
  let teamPanel,teamContent,teamCount,teamBackdrop,teamStatusRequest;
  let accountEpoch=0,profileUserId='',accountIdentity=fingerprint(),preferenceForm,preferenceStatus,preferenceReload,notificationDialogClose;
  const requests=new Set();
  const escape=value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const triggers=()=>[...document.querySelectorAll('[data-notification-toggle],#notificationBell,#staffNotificationBell')];
  function headers(){return {'Content-Type':'application/json',...(typeof window.authHeaders==='function'?window.authHeaders():window.VoxelAvatar?.authHeaders?.() || {})};}
  function fingerprint(){try{const storedId=String(JSON.parse(localStorage.getItem('user') || '{}').id || '');return String(localStorage.getItem('token') || '')+':'+storedId+':'+(profileUserId || storedId);}catch{return ':'+profileUserId;}}
  function resetAccount() {
    accountEpoch+=1;accountIdentity=fingerprint();countRevision+=1;
    for(const controller of requests)controller.abort();requests.clear();
    notificationDialogClose?.();notificationDialogClose=null;
    close('account-change');state.items=[];state.unread=null;state.page=1;state.pages=1;state.loading=false;state.error='';state.moreError='';state.notice='';state.pending.clear();state.request=null;state.returnFocus=null;countRequest=null;render();badges();
    closeTeam('account-change');
    Object.assign(teamState,{profile:null,items:[],before:null,detail:null,view:'feed',error:'',busy:false,revision:teamState.revision+1,trigger:null});
    teamStatusRequest=null;renderTeam();teamBadges();
    if(preferenceForm){preferenceForm.onsubmit=null;preferenceForm.replaceChildren();preferenceStatus.textContent='Reload preferences for your current account.';const retry=document.createElement('button');retry.type='button';retry.textContent='Reload preferences';retry.addEventListener('click',()=>preferenceReload?.());preferenceStatus.append(retry);}
  }
  function checkAccount(){
    if(fingerprint()!==accountIdentity){
      resetAccount();
      // The dashboard may set its public identity while our first fetch is in flight.
      // Restart after clearing stale results so the new account gets its own counts.
      refreshAccountNotices();
    }
    return accountEpoch;
  }
  function refreshAccountNotices(){
    if(panel)Promise.resolve().then(()=>{void refreshCount();void refreshTeamStatus();void followTeamNotice();});
  }
  function sameAccount(epoch){return checkAccount()===epoch;}
  function accountChanged(){return Object.assign(new Error('Your account changed. Reopen notifications for your current account.'),{code:'NOTIFICATION_ACCOUNT_CHANGED'});}
  async function requestJson(url,options={}) {
    const epoch=checkAccount(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);requests.add(controller);
    try {
      const response=await fetch(url,{credentials:'same-origin',...options,headers:{...headers(),...(options.headers || {})},signal:controller.signal});
      if(!sameAccount(epoch))throw accountChanged();
      const body=await response.json().catch(()=>({}));
      if(!sameAccount(epoch))throw accountChanged();
      if(!response.ok)throw Object.assign(new Error(body.message || 'Notifications could not be loaded.'),{status:response.status});
      return body;
    }catch(error){if(!sameAccount(epoch))throw accountChanged();if(error.name==='AbortError')throw new Error('Notifications took too long to respond. Please retry.');throw error;}finally{clearTimeout(timer);requests.delete(controller);}
  }
  function api(path,options={}){return requestJson('/api/notifications'+path,options);}
  function safeUrl(value) {
    if(typeof value!=='string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value))return null;
    try{const url=new URL(value,location.origin),path=decodeURIComponent(url.pathname).toLowerCase(),view=String(url.searchParams.get('view') || '').toLowerCase();if(url.origin!==location.origin || /[\\\x00-\x20\x7f%]/.test(path) || /^\/(?:api\/(?:banking|finance|erp|high-risk-finance)|finance(?:[-/.]|$)|banking(?:[/.]|$)|erp(?:[/.]|$)|personal-finance|financial-years)/.test(path) || /^(?:finance|banking|erp|personal-finance|financial-years)(?:[-_]|$)/.test(view))return null;return url.pathname+url.search+url.hash;}catch{return null;}
  }
  function badges() {
    document.querySelectorAll('#notificationBadge,#staffNotificationBadge,[data-notification-badge]').forEach(element=>{if(state.unread===null){element.hidden=true;return;}element.textContent=state.unread>99?'99+':String(state.unread);element.hidden=state.unread===0;element.classList.toggle('hidden-section',state.unread===0);});
    triggers().forEach(trigger=>{trigger.setAttribute('aria-expanded',String(state.open));trigger.setAttribute('aria-controls',panel?.id || '');trigger.setAttribute('aria-label',state.unread===null?'Open notifications':`Open notifications${state.unread?`, ${state.unread} unread`:''}`);});
    if(count)count.textContent=state.loading?'Loading…':state.unread===null?'':state.unread?`${state.unread} unread`:'All read';
    if(markAll){markAll.hidden=!(state.unread>0);markAll.parentElement.hidden=!(state.unread>0);markAll.disabled=state.loading || state.pending.size>0;}
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
      const button=document.createElement('button');button.type='button';button.className='vv-notification-entry';button.disabled=state.loading || state.pending.size>0;button.dataset.notificationId=String(item.id);button.setAttribute('aria-label',`${item.title || 'Notification'}, ${Number(item.is_read)?'read':'unread'}`);
      const dot=document.createElement('span');dot.className='vv-notification-dot';dot.setAttribute('aria-hidden','true');
      const content=document.createElement('span');content.className='vv-notification-copy';
      const title=document.createElement('strong');title.textContent=item.title || 'Notification';const message=document.createElement('span');message.className='vv-notification-message';message.textContent=item.message || '';
      const time=document.createElement('time');time.textContent=age(item.created_at);if(item.created_at)time.dateTime=String(item.created_at);
      content.append(title,message,time);button.append(dot,content);article.append(button);list.append(article);
    }
    const message=state.error || state.moreError || state.notice || (state.loading?'Loading notifications…':!state.items.length?'You have no notifications.':'');statusMessage(message,Boolean(state.error || state.moreError));
  }
  function acceptCount(value){if(Number.isSafeInteger(Number(value)) && Number(value)>=0)state.unread=Number(value);}
  async function refresh(more=false,afterWrite=false) {
    const epoch=checkAccount();
    if(!init())return;
    if(state.pending.size && !afterWrite)return state.request;
    if(!state.open && !more)return refreshCount();
    if(state.request)return state.request;
    countRevision+=1;state.loading=true;state.error='';state.moreError='';state.notice='';render();
    state.request=(async()=>{try{const next=more?state.page+1:1,data=await api(`?page=${next}&limit=30`);if(!sameAccount(epoch))return;if(!Array.isArray(data.notifications) || !Number.isSafeInteger(Number(data.unread)))throw new Error('Notification status is unavailable. Please retry.');state.items=more?[...new Map([...state.items,...data.notifications].map(item=>[String(item.id),item])).values()]:data.notifications;state.page=Number(data.page || next);state.pages=Number(data.pages || 1);acceptCount(data.unread);}catch(error){if(!sameAccount(epoch))return;if(more)state.moreError=error.message;else state.error=error.message;}finally{if(sameAccount(epoch)){state.loading=false;state.request=null;render();}}})();
    return state.request;
  }
  async function refreshCount() {
    const epoch=checkAccount();
    if(state.pending.size)return;
    if(state.open)return refresh();
    if(countRequest)return countRequest;
    const revision=++countRevision;countRequest=(async()=>{try{const data=await api('/unread-count');if(sameAccount(epoch) && revision===countRevision){acceptCount(data.unread);badges();}}catch{ /* Keep the last known count; opening the center exposes a retry state. */ }finally{if(sameAccount(epoch))countRequest=null;}})();return countRequest;
  }
  function positionPanel(element,trigger) {
    if(!element || !trigger || innerWidth<=640)return;
    const rect=trigger.getBoundingClientRect(),width=Math.min(400,innerWidth-24);
    element.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right-width))+'px';
    element.style.top=Math.min(rect.bottom+10,Math.max(12,innerHeight-220))+'px';
    element.style.setProperty('--notification-room',Math.max(180,innerHeight-rect.bottom-24)+'px');
  }
  function position(){positionPanel(panel,document.querySelector('#notificationBell,#staffNotificationBell,[data-notification-toggle]'));positionPanel(teamPanel,teamState.trigger);}
  function hide(reason='closed') {
    state.open=false;if(panel)panel.hidden=true;if(backdrop)backdrop.hidden=true;badges();
    if(!window.VoxelOverlay && reason!=='replacement' && state.returnFocus?.isConnected)state.returnFocus.focus({preventScroll:true});
  }
  function close(reason='closed') {if(window.VoxelOverlay?.active==='notifications')window.VoxelOverlay.close('notifications',typeof reason==='string'?reason:'closed');else hide(typeof reason==='string'?reason:'closed');}
  async function open(trigger) {
    checkAccount();
    if(!init())return;
    state.returnFocus=trigger instanceof HTMLElement?trigger:document.activeElement;
    if(typeof window.toggleMobileMenu==='function')window.toggleMobileMenu(false);
    if(typeof window.toggleStaffMobileMenu==='function')window.toggleStaffMobileMenu(false);
    if(window.VoxelOverlay&&window.VoxelOverlay.open('notifications',hide,state.returnFocus)===false)return;
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
  function showRecord(title,body) {
    notificationDialogClose?.();
    const returnFocus=state.returnFocus,cover=document.createElement('div');cover.className='vv-notification-record-cover';
    const dialog=document.createElement('section');dialog.className='vv-notification-record-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','vvNotificationRecordTitle');
    dialog.innerHTML='<header class="vv-notification-head"><h2 id="vvNotificationRecordTitle"></h2><button type="button" data-record-close aria-label="Close record details">Close</button></header><div class="vv-notification-record-content" tabindex="0">'+body+'</div>';
    dialog.querySelector('h2').textContent=title;
    let dismissed=false;
    const dismiss=()=>{if(dismissed)return;dismissed=true;cover.remove();document.removeEventListener('keydown',keyboard,true);notificationDialogClose=null;if(window.VoxelOverlay?.active==='notification-record')window.VoxelOverlay.close('notification-record');else if(!window.VoxelOverlay && returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};
    const keyboard=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dismiss();}else if(event.key==='Tab'){const controls=[...dialog.querySelectorAll('button,[tabindex="0"]')],first=controls[0],last=controls.at(-1);if(event.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}}};
    close('replacement');if(window.VoxelOverlay&&window.VoxelOverlay.open('notification-record',dismiss,returnFocus)===false){cover.remove();return;}
    notificationDialogClose=dismiss;cover.append(dialog);document.body.append(cover);dialog.querySelector('[data-record-close]').addEventListener('click',dismiss);cover.addEventListener('click',event=>{if(event.target===cover)dismiss();});document.addEventListener('keydown',keyboard,true);dialog.querySelector('[data-record-close]').focus({preventScroll:true});
  }
  async function openSpecific(result,notificationId) {
    const epoch=checkAccount();
    const target=result.target;if(!target)return false;
    // Fetching the target again uses current backend permissions and record scope,
    // including when a notification was received before permissions changed.
    const fresh=await api(`/${Number(notificationId)}/target`);
    if(!sameAccount(epoch))throw accountChanged();
    if(fresh.target_status!=='AVAILABLE' || !fresh.target)throw new Error(fresh.target_message || 'This record is no longer available.');
    const current=fresh.target;
    let record=current.record;
    if(current.detail_url && !['TASK','RFQ','QUALITY'].includes(current.kind)) {
      const path=safeUrl(current.detail_url);if(!path || !/^\/api\/(?:attendance\/(?:timesheets|corrections)|procurement\/entries|workflows\/instances)\//.test(path))throw new Error('The record detail URL is unavailable.');
      const data=await requestJson(path);if(!sameAccount(epoch))throw accountChanged();record=data.correction || data.entry || data.timesheet || data.instance || data;
    }
    if(!sameAccount(epoch))throw accountChanged();
    showRecord(record.title || result.notification?.title || 'Record details',recordHtml(record,current.kind));
    return true;
  }
  async function openItem(id) {
    const epoch=checkAccount();
    const key=String(id);if(state.loading || state.pending.size)return;state.pending.add(key);countRevision+=1;state.notice='';render();
    try {
      const result=await api(`/${Number(id)}/open`,{method:'POST',body:'{}'});if(!sameAccount(epoch))return;acceptCount(result.unread);const item=state.items.find(row=>String(row.id)===key);if(item)item.is_read=1;render();
      if(result.target_status==='UNAVAILABLE'){state.notice=result.target_message || 'This item is no longer available.';render();return;}
      if(result.target_status==='AVAILABLE'){
        if(await openSpecific(result,id))return;if(!sameAccount(epoch))return;
        const url=safeUrl(result.action_url);if(!url)throw new Error('The notification target is unavailable.');close('replacement');location.assign(url);
      }
    }catch(error){if(sameAccount(epoch)){state.error=error.message;render();}}finally{if(sameAccount(epoch)){state.pending.delete(key);render();}}
  }
  async function allRead() {
    const epoch=checkAccount();
    if(state.loading || state.pending.size || !(state.unread>0))return;state.pending.add('all');countRevision+=1;render();
    try{const data=await api('/mark-all-read',{method:'POST',body:'{}'});if(!sameAccount(epoch))return;acceptCount(data.unread);state.error='';await refresh(false,true);}catch(error){if(sameAccount(epoch)){state.error=error.message;render();}}finally{if(sameAccount(epoch)){state.pending.delete('all');render();}}
  }

  const teamApi=(path,options)=>requestJson('/api/ai-team'+path,options);
  const teamTriggers=()=>[...document.querySelectorAll('[data-ai-team-toggle]')];
  const teamSources={
    CODEX_CLI:['Codex CLI','<path d="m5 7 5 5-5 5m8 0h6"/>'],
    GITHUB_ACTIONS:['GitHub Actions','<path d="m9 8 7 4-7 4V8Z"/><circle cx="12" cy="12" r="9"/>'],
    GITHUB_PULL_REQUESTS:['GitHub Pull Requests','<circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/><path d="M7 7v10m10 0V8a3 3 0 0 0-3-3h-2m2-2-2 2 2 2"/>'],
    GITHUB_RELEASES:['GitHub Releases','<path d="M4 5h8l8 8-7 7-9-9V5Z"/><circle cx="8" cy="9" r="1"/>']
  };
  const teamGlyph='<path d="M14 3l1.2 4.8L20 9l-4.8 1.2L14 15l-1.2-4.8L8 9l4.8-1.2L14 3ZM6 13l.8 2.2L9 16l-2.2.8L6 19l-.8-2.2L3 16l2.2-.8L6 13Z"/>';
  function teamIcon(path) {
    const icon=document.createElement('span');icon.className='vv-team-icon';icon.setAttribute('aria-hidden','true');
    icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
    return icon;
  }
  function teamButton(text,action,className='vv-team-action') {
    const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;button.addEventListener('click',action);return button;
  }
  function teamText(tag,text,className='') {
    const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;return element;
  }
  function teamBadges() {
    const count=Number(teamState.profile?.unread || 0);
    teamTriggers().forEach(trigger=>{
      trigger.hidden=!teamState.profile?.eligible;
      trigger.setAttribute('aria-label',count>0?`AI Team, ${count} unread`:'AI Team activity');
      trigger.setAttribute('aria-expanded',String(teamState.open && trigger===teamState.trigger));
      const badge=trigger.querySelector('[data-ai-team-badge]');
      badge.hidden=count<1;badge.textContent=count>99?'99+':String(count);
    });
    if(teamCount)teamCount.textContent=count>0?`${count} unread`:'';
  }
  function addTeamTriggers() {
    document.querySelectorAll('#notificationBell,#staffNotificationBell').forEach(bell=>{
      if(bell.hasAttribute('data-ai-team-initialized'))return;
      bell.setAttribute('data-ai-team-initialized','');
      const button=teamButton('',()=>teamState.open?closeTeam():void openTeam(button),'vv-ai-team-trigger');
      button.hidden=true;button.setAttribute('data-ai-team-toggle','');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','vvAiTeamPanel');
      const badge=teamText('span','0','vv-ai-team-badge');badge.setAttribute('data-ai-team-badge','');badge.setAttribute('aria-hidden','true');badge.hidden=true;
      button.append(teamIcon(teamGlyph),teamText('span','AI Team','vv-ai-team-label'),badge);
      bell.insertAdjacentElement('afterend',button);
    });
  }
  function receiveTeamProfile(profile) {
    teamState.profile=profile;
    if(profile.eligible)prepareTeamPanel();
    else {
      closeTeam('access-changed');
      Object.assign(teamState,{items:[],before:null,detail:null,view:'feed',error:''});
    }
    teamBadges();renderTeam();
  }
  async function refreshTeamStatus() {
    const epoch=checkAccount();
    if(!teamTriggers().length)return null;
    if(teamStatusRequest)return teamStatusRequest;
    const revision=teamState.revision;
    teamStatusRequest=(async()=>{
      try {
        const profile=await teamApi('/status');
        if(sameAccount(epoch) && revision===teamState.revision)receiveTeamProfile(profile);
        return sameAccount(epoch)?teamState.profile:null;
      } catch(error) {
        if(sameAccount(epoch) && [401,403].includes(error.status))receiveTeamProfile({eligible:false});
        return null;
      } finally {
        if(sameAccount(epoch))teamStatusRequest=null;
      }
    })();
    return teamStatusRequest;
  }
  function hideTeam(reason) {
    teamState.open=false;
    if(teamPanel)teamPanel.hidden=true;
    if(teamBackdrop)teamBackdrop.hidden=true;
    teamBadges();
    if(!window.VoxelOverlay && reason!=='replacement' && teamState.trigger?.isConnected && !teamState.trigger.hidden)teamState.trigger.focus();
  }
  function closeTeam(reason='closed') {
    if(window.VoxelOverlay?.active==='ai-team')window.VoxelOverlay.close('ai-team',reason);
    else if(teamState.open)hideTeam(reason);
  }
  function prepareTeamPanel() {
    if(teamPanel)return;
    teamPanel=document.createElement('section');teamPanel.id='vvAiTeamPanel';teamPanel.className='vv-notification-panel vv-ai-team-panel';teamPanel.hidden=true;
    teamPanel.setAttribute('role','dialog');teamPanel.setAttribute('aria-modal','true');teamPanel.setAttribute('aria-labelledby','vvAiTeamTitle');
    const header=document.createElement('header');header.className='vv-notification-head';
    const heading=teamText('h2','AI Team');heading.id='vvAiTeamTitle';
    teamCount=teamText('span','');teamCount.setAttribute('data-notification-count','');teamCount.setAttribute('aria-live','polite');
    const label=document.createElement('div');label.append(heading,teamCount);
    const close=teamButton('',()=>closeTeam());close.setAttribute('data-ai-team-close','');close.setAttribute('aria-label','Close AI Team activity');
    close.append(teamIcon('<path d="m6 6 12 12M6 18 18 6"/>'));
    header.append(label,close);
    teamContent=document.createElement('div');teamContent.className='vv-notification-scroll vv-team-content';teamContent.setAttribute('tabindex','0');teamContent.setAttribute('aria-label','AI Team activity');
    teamPanel.append(header,teamContent);
    teamBackdrop=document.createElement('div');teamBackdrop.className='vv-notification-backdrop';teamBackdrop.hidden=true;teamBackdrop.setAttribute('aria-hidden','true');
    teamBackdrop.addEventListener('click',()=>closeTeam());document.body.append(teamBackdrop,teamPanel);
    document.addEventListener('keydown',event=>{
      if(!teamState.open)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeTeam('escape');}
      if(event.key==='Tab'){
        const controls=[...teamPanel.querySelectorAll('button,input,[tabindex="0"]')].filter(node=>!node.disabled && !node.hidden && node.getClientRects().length);
        const first=controls[0],last=controls.at(-1),outside=!teamPanel.contains(document.activeElement);
        if(event.shiftKey && (outside || document.activeElement===first)){event.preventDefault();last?.focus();}
        if(!event.shiftKey && (outside || document.activeElement===last)){event.preventDefault();first?.focus();}
      }
    },true);
  }
  function focusTeamContent(){if(teamState.open)teamContent.focus({preventScroll:true});}
  function teamTime(value,full=false) {
    const date=new Date(value),text=full && !Number.isNaN(date.getTime())?date.toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}):age(value);
    const element=teamText('time',text);if(value)element.dateTime=value;return element;
  }
  function teamCard(item) {
    const [source,glyph]=teamSources[item.source] || ['Activity',teamGlyph];
    const unread=!Number(item.is_read);
    const row=document.createElement('li');row.className='vv-team-card'+(unread?' is-unread':'');
    const button=teamButton('',()=>void openTeamItem(item.id),'vv-team-entry');button.disabled=teamState.busy;
    button.setAttribute('aria-label',`${item.title} · ${source} · ${unread?'Unread':'Read'}`);
    const message=document.createElement('span');message.className='vv-team-copy';
    message.append(teamText('span',source,'vv-team-source'),teamText('strong',item.title),teamText('span',item.summary,'vv-team-summary'));
    const meta=document.createElement('span');meta.className='vv-team-meta';meta.append(teamTime(item.created_at));
    if(unread){const dot=teamText('span','','vv-notification-dot');dot.setAttribute('aria-hidden','true');meta.append(dot);}
    button.append(teamIcon(glyph),message,meta);row.append(button);return row;
  }
  function renderTeamPreferences() {
    const form=document.createElement('form');form.className='vv-team-preferences';
    const options=[['in_app_enabled','Show activity in the AI Team feed'],['push_enabled','Allow generic alerts on enrolled personal devices']];
    const inputs=options.map(([name,label])=>{
      const input=document.createElement('input');input.type='checkbox';input.name=name;input.checked=teamState.profile[name];input.disabled=teamState.busy;
      const row=document.createElement('label');row.append(input,teamText('span',label));form.append(row);return input;
    });
    form.append(teamText('p','Personal devices can be linked or unlinked in notification settings.'));
    const save=teamText('button','Save preferences','vv-team-action');save.type='submit';save.disabled=teamState.busy;form.append(save);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const values=Object.fromEntries(inputs.map(input=>[input.name,input.checked]));
      void teamOperation(async current=>{
        const profile=await teamApi('/preferences',{method:'PUT',body:JSON.stringify(values)});
        if(!current())return;
        const enabling=profile.in_app_enabled && !teamState.profile.in_app_enabled;
        receiveTeamProfile(profile);
        if(!profile.in_app_enabled){teamState.items=[];teamState.before=null;}
        if(enabling)await loadTeamPage(null,current);
        if(current())teamState.view='feed';
      });
    });
    teamContent.append(form);
  }
  function showTeamView(view) {
    teamState.view=view;teamState.error='';renderTeam();focusTeamContent();
  }
  function renderTeam() {
    if(!teamContent)return;
    teamContent.replaceChildren();teamContent.setAttribute('aria-busy',String(teamState.busy));
    if(!teamState.profile?.eligible)return;
    if(teamState.view!=='feed'){
      const back=teamButton('Back to activity',()=>showTeamView('feed'));back.disabled=teamState.busy;teamContent.append(back);
    }
    if(teamState.error){
      const error=teamText('p',teamState.error,'vv-team-status');error.setAttribute('role','alert');teamContent.append(error);
    }
    if(teamState.view==='preferences'){renderTeamPreferences();return;}
    if(teamState.view==='detail' && teamState.detail){
      const item=teamState.detail,article=document.createElement('article');article.className='vv-team-detail';
      article.append(teamText('p',teamSources[item.source]?.[0] || 'Activity','vv-team-source'),teamText('h3',item.title),teamText('p',item.summary));
      if(item.reference_label)article.append(teamText('p',item.reference_label));
      article.append(teamTime(item.created_at,true));teamContent.append(article);return;
    }
    if(!teamState.profile.in_app_enabled)teamContent.append(teamText('p','The AI Team feed is turned off in your preferences.','vv-team-status'));
    else if(teamState.items.length){
      const cards=document.createElement('ul');cards.className='vv-team-cards';teamState.items.forEach(item=>cards.append(teamCard(item)));teamContent.append(cards);
    } else if(!teamState.error) {
      const empty=teamText('p',teamState.busy?'Loading activity…':'No AI Team activity yet.','vv-team-status');empty.setAttribute('role','status');teamContent.append(empty);
    } else {
      const retry=teamButton('Retry',()=>void teamOperation(current=>loadTeamPage(null,current)));teamContent.append(retry);
    }
    const actions=document.createElement('div');actions.className='vv-team-actions';
    if(teamState.before)actions.append(teamButton('Load earlier activity',()=>void teamOperation(current=>loadTeamPage(teamState.before,current))));
    if(teamState.profile.unread>0)actions.append(teamButton('Mark all read',()=>void markTeamRead()));
    actions.append(teamButton('Preferences',()=>showTeamView('preferences')));
    if(teamState.busy)for(const action of actions.children)action.disabled=true;
    teamContent.append(actions);
  }
  async function teamOperation(work) {
    const epoch=checkAccount();
    if(teamState.busy || !teamState.profile?.eligible)return;
    const revision=++teamState.revision;
    const current=()=>sameAccount(epoch) && revision===teamState.revision;
    teamState.busy=true;teamState.error='';renderTeam();
    try {await work(current);} catch(error) {
      if(current() && [401,403].includes(error.status))receiveTeamProfile({eligible:false});
      else if(current())teamState.error=error.message;
    } finally {
      if(current()){teamState.busy=false;renderTeam();}
    }
  }
  async function loadTeamPage(before,current) {
    const result=await teamApi('/events'+(before?'?before='+encodeURIComponent(before):''));
    if(!current())return;
    if(!Array.isArray(result.items))throw new Error('AI Team activity could not be loaded. Please retry.');
    teamState.items=before?[...teamState.items,...result.items]:result.items;
    teamState.before=result.before;
  }
  async function openTeamItem(id) {
    await teamOperation(async current=>{
      const result=await teamApi('/events/'+encodeURIComponent(id)+'/open',{method:'POST',body:'{}'});
      if(!current())return;
      teamState.profile.unread=result.unread;teamBadges();
      const row=teamState.items.find(item=>item.id===id);if(row)row.is_read=1;
      teamState.detail=result.item;teamState.view='detail';
    });
    focusTeamContent();
  }
  async function markTeamRead() {
    await teamOperation(async current=>{
      const result=await teamApi('/mark-all-read',{method:'POST',body:'{}'});
      if(!current())return;
      teamState.profile.unread=result.unread;teamBadges();
      await loadTeamPage(null,current);
    });
    focusTeamContent();
  }
  async function openTeam(trigger) {
    if(!teamState.profile?.eligible || !trigger || trigger.hidden)return false;
    prepareTeamPanel();
    if(window.VoxelOverlay?.open('ai-team',hideTeam,trigger)===false)return false;
    if(!window.VoxelOverlay)close('replacement');
    Object.assign(teamState,{trigger,open:true,view:'feed',detail:null,error:''});
    teamPanel.hidden=false;teamBackdrop.hidden=false;position();teamBadges();renderTeam();
    teamPanel.querySelector('[data-ai-team-close]').focus({preventScroll:true});
    if(teamState.profile.in_app_enabled)await teamOperation(current=>loadTeamPage(null,current));
    return true;
  }
  async function openFromNotice() {
    if(!init())return false;
    const epoch=checkAccount();
    const profile=await refreshTeamStatus();
    if(!sameAccount(epoch) || !profile?.eligible)return false;
    return teamState.open || openTeam(teamTriggers().find(trigger=>!trigger.hidden && trigger.getClientRects().length));
  }
  async function followTeamNotice() {
    if(new URLSearchParams(location.search).get('team_activity')!=='1' || !await openFromNotice())return;
    const remaining=new URLSearchParams(location.search);remaining.delete('team_activity');
    const query=remaining.toString();window.history?.replaceState(window.history.state,'',location.pathname+(query?'?'+query:'')+location.hash);
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
    window.addEventListener('resize',position);window.addEventListener('pagehide',()=>{close('navigation');closeTeam('navigation');});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshCount();void refreshTeamStatus();}});
    addTeamTriggers();badges();void refreshCount();void refreshTeamStatus();void followTeamNotice();
    const selected=new URLSearchParams(location.search).get('notification_id'),epoch=checkAccount();if(/^[1-9]\d{0,15}$/.test(selected || ''))void api('/'+selected+'/target').then(result=>sameAccount(epoch)?openSpecific(result,selected):undefined).catch(error=>{if(sameAccount(epoch))window.showToast?.(error.message);});
    return true;
  }
  async function preferences() {
    if(location.pathname!=='/profile' || document.getElementById('notifications'))return;
    const section=document.createElement('section');section.id='notifications';section.className='vv-notification-preferences card';section.innerHTML='<h2>Notification preferences</h2><p>Choose which categories appear in your notification center.</p><form data-notification-preferences></form><p data-preference-status role="status">Loading preferences…</p>';document.querySelector('main.shell,main')?.append(section);
    const form=section.querySelector('form'),message=section.querySelector('[data-preference-status]');preferenceForm=form;preferenceStatus=message;
    async function load(){const epoch=checkAccount();form.onsubmit=null;form.replaceChildren();message.textContent='Loading preferences…';try{const data=await api('/preferences');if(!sameAccount(epoch))return;const saved=new Map((data.preferences || []).map(row=>[row.category,row]));for(const category of ['FINANCE','PRODUCTION','QUALITY','SECURITY','HR','TASKS','SYSTEM']){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.name=category;input.checked=Number(saved.get(category)?.in_app_enabled ?? 1)!==0;label.append(input,document.createTextNode(category==='FINANCE'?'Invoices and expenses':category.toLowerCase().replace(/\b\w/g,char=>char.toUpperCase())));form.append(label);}const button=document.createElement('button');button.type='submit';button.textContent='Save preferences';form.append(button);message.textContent='';form.onsubmit=async event=>{event.preventDefault();if(!sameAccount(epoch) || button.disabled)return;button.disabled=true;const controls=[...form.querySelectorAll('input')];controls.forEach(input=>{input.disabled=true;});try{await Promise.all(controls.map(input=>api('/preferences',{method:'PATCH',body:JSON.stringify({...saved.get(input.name),category:input.name,in_app_enabled:input.checked})})));if(sameAccount(epoch))message.textContent='Preferences saved.';}catch(error){if(sameAccount(epoch))message.textContent=error.message;}finally{if(sameAccount(epoch)){button.disabled=false;controls.forEach(input=>{input.disabled=false;});}}};}catch(error){if(!sameAccount(epoch))return;message.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.addEventListener('click',load);message.append(retry);}}
    preferenceReload=load;
    await load();if(location.hash==='#notifications')section.scrollIntoView({block:'start'});
  }
  window.VoxelNotificationCenter={open,toggle,close,refresh,refreshCount,get ready(){return Boolean(panel);}};
  window.VoxelAITeam={openFromNotice};
  window.addEventListener('vv:avatar-clear',()=>{profileUserId='';resetAccount();refreshAccountNotices();});
  window.addEventListener('vv:auth-changed',()=>{profileUserId='';resetAccount();refreshAccountNotices();});
  window.addEventListener('storage',event=>{if(!event.key || ['token','user'].includes(event.key)){checkAccount();if(panel){void refreshCount();void refreshTeamStatus();}}});
  window.addEventListener('vv:avatar-profile',event=>{const id=String(event.detail?.profile?.id || '');if(id && id!==profileUserId){const previousEpoch=accountEpoch;profileUserId=id;checkAccount();if(panel && (previousEpoch!==accountEpoch || state.unread===null)){void refreshCount();void refreshTeamStatus();}}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{init();void preferences();});else{init();void preferences();}
})();
