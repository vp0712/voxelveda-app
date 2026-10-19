/* Explicit user-action outcomes. Message wording never determines an outcome. */
(() => {
  'use strict';
  let current=null;
  const account=()=>{try{return String(JSON.parse(localStorage.getItem('user')||'{}').id||'')+'|'+(localStorage.getItem('token')||'');}catch{return '';}};
  const focusables=root=>[...root.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
  function close(value='close') { if(!current)return;current.result=value;return window.VoxelOverlay?.close('action-feedback','feedback-close') ?? cleanup(); }
  function cleanup(){const old=current;if(!old)return;current=null;old.root.remove();for(const [node,inert] of old.inert)if(node.isConnected)node.inert=inert;old.resolve(old.result||'close');requestAnimationFrame(()=>{if(!current&&old.returnFocus?.isConnected&&old.returnFocus.getClientRects().length&&!old.returnFocus.disabled)old.returnFocus.focus({preventScroll:true});});}
  function show(options={}) {
    if(current)close('replaced');
    const kind=['success','error','warning','info'].includes(options.kind)?options.kind:'info';
    const parent=window.VoxelDialog?.active,returnFocus=options.returnFocus||document.activeElement;
    const root=document.createElement('div');root.id='actionFeedback';root.className='vv-feedback-backdrop';root.dataset.kind=kind;
    const panel=document.createElement('section');panel.className='vv-feedback-panel';panel.setAttribute('role',kind==='error'?'alertdialog':'dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','actionFeedbackTitle');panel.setAttribute('aria-describedby','actionFeedbackMessage');panel.tabIndex=-1;
    const title=document.createElement('h2');title.id='actionFeedbackTitle';title.textContent=options.title||({success:'Completed',error:'Action could not be completed',warning:'Review needed',info:'Information'})[kind];
    const message=document.createElement('p');message.id='actionFeedbackMessage';message.textContent=String(options.message||'');panel.append(title,message);
    if(options.items?.length){const list=document.createElement('ul');for(const value of options.items){const li=document.createElement('li');li.textContent=String(value);list.append(li);}panel.append(list);}
    let input=null;if(options.field){const label=document.createElement('label');label.textContent=options.field.label||'Reason';input=document.createElement('textarea');input.rows=3;input.maxLength=1000;input.required=true;label.append(input);panel.append(label);}
    const footer=document.createElement('div');footer.className='vv-feedback-actions';
    const actions=options.actions?.length?options.actions:[{label:kind==='success'?'OK':parent?'Return to form':'Close',value:'close'}];
    for(const action of actions){const button=document.createElement('button');button.type='button';button.className='primary-btn';button.textContent=action.label;button.onclick=()=>{if(action.value==='input'&&!input?.value.trim()){input.setAttribute('aria-invalid','true');input.focus();return;}close(action.value==='input'?{input:input.value}:action.value||'close');action.run?.();};footer.append(button);}panel.append(footer);root.append(panel);document.body.append(root);
    const inert=[...document.body.children].filter(n=>n!==root&&n.tagName!=='SCRIPT'&&n.tagName!=='STYLE').map(n=>[n,n.inert]);
    const promise=new Promise(resolve=>{current={root,panel,resolve,result:null,inert,returnFocus};});
    const opened=window.VoxelOverlay?.open({id:'action-feedback',modal:true,root,onClose:cleanup,returnFocus});
    if(opened===false){cleanup();return promise;}for(const [node]of inert)node.inert=true;
    (focusables(panel)[0]||panel).focus({preventScroll:true});return promise;
  }
  function notify(message,options={}) {
    const running=window.VoxelDialog?.running;if(running&&running.owner!==account())return;
    let kind=options.kind||'info';if(options.httpStatus>=400)kind='error';else if(options.httpStatus===207&&kind==='success'){kind='warning';options={...options,title:'Partially completed'};}if(kind==='success')window.VoxelDialog?.markCommitted?.();else if(kind==='error'&&running?.committed){kind='warning';message='The change was saved, but a following step could not be confirmed. Refresh the record before taking another action. '+String(message||'');}
    // Routine background notices remain unobtrusive; form/action outcomes use foreground feedback.
    if(options.background||kind==='info'&&!window.VoxelDialog?.active&&!options.foreground){let node=document.getElementById('toast');if(!node){node=document.createElement('div');node.id='toast';node.className='toast';document.body.append(node);}node.textContent=String(message||'');node.setAttribute('role','status');node.style.display='block';clearTimeout(node._timer);node._timer=setTimeout(()=>node.style.display='none',3500);return;}
    return Promise.resolve().then(()=>show({...options,kind,message}));
  }
  document.addEventListener('keydown',event=>{if(!current)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}else if(event.key==='Tab'){event.stopImmediatePropagation();const nodes=focusables(current.panel),first=nodes[0],last=nodes.at(-1);if(!nodes.length){event.preventDefault();current.panel.focus();}else if(!current.panel.contains(document.activeElement)||event.shiftKey&&document.activeElement===first){event.preventDefault();(event.shiftKey?last:first).focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}},true);
  for(const name of ['vv:avatar-clear','vv:avatar-auth-required','pagehide'])window.addEventListener(name,()=>close('account-change'));
  window.addEventListener('storage',e=>{if(!e.key||['user','token'].includes(e.key))close('account-change');});
  window.VoxelFeedback={show,notify,close,confirm:async(message)=>{const owner=account();return await show({kind:'warning',title:'Confirm action',message,actions:[{label:'Cancel'},{label:'Confirm',value:'confirm'}]})==='confirm'&&owner===account();},prompt:async(message)=>{const owner=account();const value=await show({kind:'warning',title:'Reason required',message,field:{label:'Reason'},actions:[{label:'Cancel'},{label:'Continue',value:'input'}]});return owner===account()&&value?.input?value.input:null;},get active(){return Boolean(current);}};

  const pending=new Map(),uncertain=new Map();
  async function request(url,options={}){const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),15000);try{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,signal:ctl.signal,headers:{'Content-Type':'application/json',...options.headers}});const data=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error(data?.message||'The request failed. Review the record before retrying.'),{status:response.status,code:data?.code,details:data?.details,uncertain:response.status>=500&&Boolean(options.method)});if(!data)throw Object.assign(new Error('The response could not be confirmed.'),{uncertain:Boolean(options.method)});return data;}catch(error){if(options.method&&(error.name==='AbortError'||error instanceof TypeError))error.uncertain=true;throw error;}finally{clearTimeout(timeout);}}
  function committed(row,id,status,hours){return row&&Number(row.id)===Number(id)&&row.status===status&&Number.isSafeInteger(Number(row.version_no))&&(hours==null||row.approved_hours!=null&&Number(row.approved_hours)===Number(hours));}
  async function timesheet(config){
    const owner=account(),key=owner+'|timesheet:'+config.id,expectedStatus=config.status||'APPROVED';
    if(pending.has(key))return pending.get(key);
    const run=(async()=>{
      let row;
      try{
        if(uncertain.has(key)){const saved=await request('/api/attendance/timesheets/'+Number(config.id),{headers:config.headers});row=saved.timesheet;if(!committed(row,config.id,expectedStatus,config.hours)){
          if(Number(row?.version_no)!==Number(config.body.expected_version))throw Object.assign(new Error('This record changed. Refresh its source and version before taking another action.'),{status:409});
          uncertain.delete(key);row=null;
        }}
        if(!row){try{const data=await request(config.url,{method:'POST',headers:config.headers,body:JSON.stringify(config.body)});row=data.timesheet;if(!committed(row,config.id,expectedStatus,config.hours))throw Object.assign(new Error('The saved record could not be confirmed. Reconcile before retrying.'),{uncertain:true});}
        catch(error){if(!error.uncertain&&!(error.status===409&&['TIMESHEET_VERSION_CONFLICT','TIMESHEET_ALREADY_APPROVED'].includes(error.code)))throw error;uncertain.set(key,true);try{const data=await request('/api/attendance/timesheets/'+Number(config.id),{headers:config.headers});if(committed(data.timesheet,config.id,expectedStatus,config.hours))row=data.timesheet;else{if(error.status===409)uncertain.delete(key);throw error;}}catch{throw error;}}}
        if(owner!==account())return {kind:'account-changed'};
        uncertain.delete(key);config.close?.();config.onCommit?.(row);
        // A committed outcome is never replaced by a refresh failure.
        let refreshFailed=false;try{await config.refresh?.();}catch{refreshFailed=true;}
        if(owner!==account())return {kind:'account-changed'};
        await show({kind:'success',title:config.title||'Timesheet approved',message:config.context||'The saved record has been confirmed.',items:[...(config.hours==null?[]:[Number(row.approved_hours).toFixed(2)+' approved hours']),...(refreshFailed?['Approval is saved. The register could not refresh; use Refresh to reload it.']:[])]});
        return {kind:'success',record:row,refreshFailed};
      }catch(error){if(owner!==account())return {kind:'account-changed'};const unknown=uncertain.has(key)||error.uncertain;await show({kind:'error',title:unknown?'Outcome needs confirmation':error.status===409?'Review required':error.status===401?'Session expired':'Action could not be completed',message:unknown?'The server may have saved this action. Reconcile the record before trying again.':error.message,actions:unknown?[{label:'Reconcile record',run:config.reopen},{label:'Return to form'}]:error.status===401?[{label:'Log in',run:()=>location.assign('/login?returnTo='+encodeURIComponent(location.pathname+location.search+location.hash))},{label:'Close'}]:config.errorActions});return {kind:unknown?'uncertain':'error',error};}
    })();pending.set(key,run);try{return await run;}finally{pending.delete(key);}
  }
  window.VoxelActions={request,timesheet,account,committed,date:value=>{const day=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):'Date unavailable';}};
})();
