/* Optional, exact-session summaries. Loading and saving never send a clock action. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let epoch=0;
  function open(host,attendanceId,initial={}) {
    const generation=++epoch,lease=host.account();let saved=initial,sequence=0,busy=false,attempt=null,first=true;
    const pendingKey=`vv.checkout-summary.${lease.id}.${attendanceId}`;
    try { const retained=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(retained?.request_id&&Number(retained.expected_revision)>0)attempt=retained; } catch {}
    const remember=()=>{try {if(attempt)sessionStorage.setItem(pendingKey,JSON.stringify(attempt));else sessionStorage.removeItem(pendingKey);}catch{}};
    const pages={task:1,category:1},search={task:'',category:''},seen={task:new Map(),category:new Map()};
    const group=(kind,label)=>`<div class="checkout-option-group"><label for="staffCheckout${kind==='task'?'Task':'Category'}">${label} (optional)</label><select id="staffCheckout${kind==='task'?'Task':'Category'}" name="${kind==='task'?'task_id':'category_id'}" disabled><option value="">Loading…</option></select><p id="checkout-${kind}-state" class="staff-sheet-subtitle" role="status">Loading ${kind==='task'?'assigned tasks':'company categories'}…</p><div id="checkout-${kind}-search-row" class="checkout-option-search" hidden><input id="checkout-${kind}-search" type="search" maxlength="120" aria-label="Search ${label.toLowerCase()}"><button type="button" class="secondary-btn" id="checkout-${kind}-search-button">Search</button></div><div id="checkout-${kind}-pages" class="checkout-option-search" hidden><button type="button" class="secondary-btn" id="checkout-${kind}-previous">Previous</button><span id="checkout-${kind}-page"></span><button type="button" class="secondary-btn" id="checkout-${kind}-next">Next</button></div></div>`;
    host.openSheet('What did you work on?',`<p>Checkout is saved. This optional summary applies only to this completed session.</p><div id="checkout-options-error" role="alert" hidden></div>${group('task','Task worked on')}${group('category','Work category')}<label for="staffCheckoutNotes">Shift summary (optional)</label><textarea id="staffCheckoutNotes" name="notes" maxlength="10000" placeholder="Work completed, handover or issues"></textarea><div class="staff-sheet-actions">${host.button('staffCheckoutSave','Save summary')}${host.button('staffCheckoutSkip','Skip','secondary-btn')}</div>`,'note');
    const target=$('staffCheckoutNotes'),active=()=>generation===epoch&&host.current(lease)&&target.isConnected&&host.isNote();
    const select=kind=>$(kind==='task'?'staffCheckoutTask':'staffCheckoutCategory');
    target.value=saved.notes||'';
    function retained() {
      if(saved.checkout_task_id)seen.task.set(String(saved.checkout_task_id),{id:saved.checkout_task_id,title:saved.checkout_task_title||`Recorded task #${saved.checkout_task_id}`,historical:true});
      if(saved.checkout_category_id)seen.category.set(String(saved.checkout_category_id),{id:saved.checkout_category_id,name:saved.checkout_category||'Recorded category',historical:true});
      else if(saved.checkout_category)seen.category.set('legacy',{id:'legacy',name:saved.checkout_category,historical:true});
    }
    function fill(kind,items=[],value=select(kind).value) {
      const node=select(kind);node.replaceChildren(new Option(kind==='task'?'No task selected':'No category selected',''));
      const combined=new Map(items.map(row=>[String(row.id),row]));
      if(value&&seen[kind].has(value)&&(!combined.has(value)||seen[kind].get(value).historical))combined.set(value,seen[kind].get(value));
      for(const row of combined.values()) {seen[kind].set(String(row.id),row);node.add(new Option((row.title||row.name)+(row.status&&['done','completed'].includes(row.status.toLowerCase())?' · Completed':'')+(row.historical?' · Recorded selection':''),String(row.id)));}
      node.value=value||'';
    }
    retained();fill('task',[],String(saved.checkout_task_id||''));fill('category',[],saved.checkout_category_id?String(saved.checkout_category_id):saved.checkout_category?'legacy':'');
    $('staffCheckoutSkip').onclick=host.close;
    for(const kind of ['task','category']) {
      $(`checkout-${kind}-search-button`).onclick=()=>{search[kind]=$(`checkout-${kind}-search`).value.trim();pages[kind]=1;void load();};
      $(`checkout-${kind}-search`).onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$(`checkout-${kind}-search-button`).click();}};
      for(const [direction,delta]of [['previous',-1],['next',1]])$(`checkout-${kind}-${direction}`).onclick=()=>{pages[kind]+=delta;void load();};
    }
    async function load() {
      const turn=++sequence,values={task:select('task').value,category:select('category').value};
      for(const kind of ['task','category']){select(kind).disabled=true;$(`checkout-${kind}-state`).textContent='Loading…';$(`checkout-${kind}-pages`).hidden=true;}
      $('checkout-options-error').hidden=true;
      try {
        const params=new URLSearchParams({task_page:pages.task,category_page:pages.category,task_search:search.task,category_search:search.category});
        const result=await host.api(`/api/attendance/sessions/${encodeURIComponent(attendanceId)}/summary-options?${params}`);host.assertResult(result);
        if(!active()||turn!==sequence)return;
        if(String(result.user_id)!==lease.id||String(result.attendance?.id)!==String(attendanceId)||!result.attendance.clock_out)throw new Error('Summary options could not be matched to this saved shift.');
        if(first){saved=result.attendance;retained();if(target.value===(initial.notes||''))target.value=saved.notes||'';values.task=String(saved.checkout_task_id||'');values.category=saved.checkout_category_id?String(saved.checkout_category_id):saved.checkout_category?'legacy':'';first=false;}
        for(const kind of ['task','category']) {
          const data=result[kind==='task'?'tasks':'categories'];if(!data||!Array.isArray(data.items))throw new Error('The options response is incomplete. Retry.');
          fill(kind,data.items,values[kind]);select(kind).disabled=busy||data.state==='RESTRICTED'||!data.items.length&&!values[kind];
          const status=$(`checkout-${kind}-state`);
          status.textContent=data.state==='RESTRICTED'?'Task selection is restricted by your account permissions. Ask an administrator if access is required.':data.total?`${data.total} ${kind==='task'?(data.total===1?'assigned task':'assigned tasks'):(data.total===1?'active category':'active categories')}${data.pages>1?` · Page ${data.page} of ${data.pages}`:''}`:search[kind]?'No matching options. Clear the search and try again.':kind==='task'?'No assigned tasks available for this shift.':'No work categories are configured for your workplace and role. Ask an administrator to set them up in Settings → Attendance work categories.';
          if(kind==='category'&&!data.total&&result.can_manage_categories){const a=document.createElement('a');a.href='/admin?view=settings';a.textContent='Open category settings';status.append(' ',a);}
          $(`checkout-${kind}-search-row`).hidden=data.state==='RESTRICTED'||!(data.total>50||search[kind]||pages[kind]>1);
          $(`checkout-${kind}-pages`).hidden=data.pages<=1&&pages[kind]<=1;
          $(`checkout-${kind}-previous`).disabled=data.page<=1;$(`checkout-${kind}-next`).disabled=data.page>=data.pages;
          $(`checkout-${kind}-page`).textContent=`${data.page} / ${data.pages}`;
        }
        if(attempt){target.value=attempt.notes||'';for(const node of [target,select('task'),select('category')])node.disabled=true;$('staffCheckoutSave').textContent='Retry original summary';}
      } catch(error) {
        if(!active()||turn!==sequence)return;
        const box=$('checkout-options-error');box.replaceChildren(document.createTextNode(`${error.message} Checkout remains saved. Notes and Skip are still available. `));box.hidden=false;
        const retry=document.createElement('button');retry.type='button';retry.className='secondary-btn';retry.textContent='Retry options';retry.onclick=()=>void load();box.append(retry);
        for(const kind of ['task','category']){$(`checkout-${kind}-state`).textContent=error.status===403?'You do not have permission to load these options.':'Options are unavailable. Use Retry options.';select(kind).disabled=true;}
      }
    }
    $('staffCheckoutSave').onclick=async()=>{
      if(busy||!active())return;
      if(saved.revision==null){host.sheetError('The saved session revision is unavailable. Retry loading options before saving. Checkout remains saved.');return;}
      const task=select('task').value,category=select('category').value;
      const payload=attempt||{request_id:crypto.randomUUID(),expected_revision:saved.revision,notes:target.value,task_id:task?Number(task):null,category_id:category&&category!=='legacy'?Number(category):null,...(category==='legacy'?{category:saved.checkout_category}:{})};
      attempt=payload;remember();sequence++;busy=true;$('staffCheckoutSave').disabled=true;
      for(const node of [target,select('task'),select('category')])node.disabled=true;
      try {
        const result=await host.api(`/api/attendance/sessions/${encodeURIComponent(attendanceId)}/note`,{method:'POST',body:JSON.stringify(payload)});host.assertResult(result);
        if(!active())return;
        if(String(result.request_id)!==payload.request_id||String(result.attendance_id)!==String(attendanceId))throw Object.assign(new Error('The summary response was interrupted. Retry the original summary.'),{uncertain:true});
        attempt=null;remember();host.close();window.showToast?.('Shift summary saved.');await host.refresh();
      } catch(error) {
        if(!active())return;
        host.sheetError(`${error.message} Checkout remains saved.`,error.fields);
        if(error.uncertain){$('staffCheckoutSave').textContent='Retry original summary';}
        else {attempt=null;remember();busy=false;target.disabled=false;await load();if(error.code==='ATTENDANCE_REVISION_CONFLICT'){const reload=document.createElement('button');reload.type='button';reload.className='secondary-btn';reload.textContent='Reload saved summary';reload.onclick=()=>{if(confirm('Discard this draft and reload the saved summary?'))open(host,attendanceId,{});};$('staffAttendanceError')?.append(reload);}}
      } finally {busy=false;if(active())$('staffCheckoutSave').disabled=false;}
    };
    void load();
  }
  window.VoxelCheckoutSummary={open};
})();
