(() => {
  'use strict';
  let epoch=0;
  const body=()=>document.getElementById('dialogBody');
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(label,run)=>{const b=document.createElement('button');b.type='button';b.className='secondary-btn';b.textContent=label;b.onclick=run;return b;};
  async function api(path,input) {
    const response=await fetch('/api/settings/work-categories'+path,{method:input?'POST':'GET',headers:authHeaders(),credentials:'same-origin',cache:'no-store',...(input?{body:JSON.stringify(input)}:{})});
    const data=await safeJson(response);if(!response.ok)throw Object.assign(new Error(data.message||'Work categories are unavailable. Retry.'),{status:response.status});return data;
  }
  function edit(row,config) {
    const turn=++epoch;let attempt=null;
    showDialog(row?'Edit work category':'Add work category',`<label for="workCategoryName">Category name<input id="workCategoryName" maxlength="120" required value="${escape(row?.name)}"></label><label for="workCategorySite">Workplace<select id="workCategorySite"><option value="">All configured workplaces</option><option value="${escape(config.site_id)}">Current workplace · ${escape(config.site_id)}</option></select></label><label for="workCategoryRole">Role<select id="workCategoryRole"><option value="">All permitted staff roles</option>${config.roles.map(role=>`<option value="${escape(role)}">${escape(role.replaceAll('_',' '))}</option>`).join('')}</select></label><label for="workCategoryActive">Availability<select id="workCategoryActive"><option value="true">Active</option><option value="false">Inactive · retain history</option></select></label><label for="workCategoryReason">Reason<textarea id="workCategoryReason" required maxlength="1000"></textarea></label><p id="workCategoryError" role="alert"></p>`,async()=>{
      const get=id=>document.getElementById(id),target=body();if(turn!==epoch)return;
      for(const id of ['workCategoryName','workCategoryReason'])if(!get(id).value.trim()||!get(id).reportValidity())return;
      attempt ||= {request_id:crypto.randomUUID(),...(row?{expected_revision:row.revision}:{}),name:get('workCategoryName').value.trim(),site_id:get('workCategorySite').value||null,role_scope:get('workCategoryRole').value||null,active:get('workCategoryActive').value==='true',reason:get('workCategoryReason').value.trim()};
      try {await api(row?'/'+encodeURIComponent(row.id):'',attempt);if(turn!==epoch||body()!==target)return;hideDialog();void openWorkCategorySettings();}
      catch(error){if(turn!==epoch||body()!==target)return;get('workCategoryError').textContent=error.message+(error.status===403?' Complete the existing security verification before changing company settings.':'');if(error.status&&error.status<500)attempt=null;else{for(const node of target.querySelectorAll('input,select,textarea'))node.disabled=true;get('workCategoryError').append(' Retry Save with the same request; refresh this list before making a different change.');}}
    },'Save');
    document.getElementById('workCategorySite').value=row?.site_id||'';document.getElementById('workCategoryRole').value=row?.role_scope||'';document.getElementById('workCategoryActive').value=Number(row?.active??1)?'true':'false';
  }
  async function openWorkCategorySettings(page=1,search='') {
    const turn=++epoch;
    showDialog('Attendance work categories','<p role="status">Loading company categories…</p>',null,'Close');const target=body();
    try {
      const data=await api('?'+new URLSearchParams({page,search}));if(turn!==epoch||body()!==target||document.getElementById('dialogTitle').textContent!=='Attendance work categories')return;
      target.innerHTML='<p>Active categories appear immediately for staff without requiring previous attendance. Renaming or deactivating a category preserves recorded summaries.</p>';
      target.append(button('Add category',()=>edit(null,data)));
      const label=document.createElement('label');label.textContent='Search categories';const input=document.createElement('input');input.type='search';input.maxLength=120;input.value=search;label.append(input);target.append(label,button('Search',()=>openWorkCategorySettings(1,input.value.trim())));
      if(!data.items.length){const empty=document.createElement('p');empty.textContent=search?'No matching categories.':'No work categories configured. Add your company’s actual work categories.';target.append(empty);}
      for(const row of data.items){const section=document.createElement('section');section.className='record-card';const title=document.createElement('h3');title.textContent=row.name;const detail=document.createElement('p');detail.textContent=`${Number(row.active)?'Active':'Inactive'} · ${row.site_id||'All workplaces'} · ${row.role_scope||'All permitted staff roles'}`;section.append(title,detail,button('Edit category',()=>edit(row,data)));target.append(section);}
      const meta=document.createElement('p');meta.textContent=`${data.total} categories · Page ${data.page} of ${data.pages}`;target.append(meta);
      if(data.page>1)target.append(button('Previous',()=>openWorkCategorySettings(data.page-1,search)));
      if(data.page<data.pages)target.append(button('Next',()=>openWorkCategorySettings(data.page+1,search)));
    } catch(error){if(turn!==epoch||body()!==target)return;target.textContent=error.message;target.append(button('Retry',()=>openWorkCategorySettings(page,search)));}
  }
  window.openWorkCategorySettings=openWorkCategorySettings;
})();
