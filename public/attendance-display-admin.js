/* Display credentials are returned once, never stored by the portal. */
(() => {
 'use strict';
 const base='/api/attendance/display-links';let listEpoch=0;
 const body=()=>document.getElementById('dialogBody');
 function button(label,run){const b=document.createElement('button');b.type='button';b.className='secondary-btn';b.textContent=label;b.addEventListener('click',run);return b;}
 function paragraph(text){const p=document.createElement('p');p.textContent=text;return p;}
 async function api(path='',input){const response=await fetch(base+path,{method:input?'POST':'GET',headers:authHeaders(),...(input?{body:JSON.stringify(input)}:{})});const data=await safeJson(response);if(!response.ok)throw new Error(data.message||'Display settings unavailable. Retry.');return data;}
 function issued(data){listEpoch++;
  showDialog('Attendance display link','',null,'Close',{onClosed:()=>body().replaceChildren()});const target=body();
  if(!data.url){target.append(paragraph(data.message||'The display was created. Replace it if its link was not saved.'),button('Manage display links',openAttendanceDisplaySettings));return;}
  target.append(paragraph('Save this private link now. It opens only the workplace QR, without login. The link cannot be retrieved later; replace it if lost.'));
  const label=document.createElement('label'),input=document.createElement('input');label.textContent='Private display link';input.type='text';input.readOnly=true;input.value=data.url;input.setAttribute('aria-label','Private display link');input.addEventListener('focus',()=>input.select());label.append(input);target.append(label);
  target.append(button('Copy link',async()=>{try{await navigator.clipboard.writeText(input.value);showToast('Display link copied.', {kind:'info'});}catch{input.focus();input.select();showToast('Select and copy the private link.', {kind:'error'});}}));
  const link=document.createElement('a');link.textContent='Open QR display';link.href=data.url;link.target='_blank';link.rel='noopener noreferrer';link.className='secondary-btn';target.append(link,button('Manage display links',openAttendanceDisplaySettings));
 }
 function change(row,operation){listEpoch++;
  const request_id=crypto.randomUUID(),creating=!row,replacing=operation==='replace';
  const title=creating?'Create display link':replacing?'Replace display link':'Revoke display link';
  showDialog(title,(creating||replacing?'<label>Display name<input id="displayLinkName" maxlength="120" required></label>':'')+(!creating?'<label>Reason<textarea id="displayLinkReason" minlength="3" maxlength="1000" required></textarea></label>':'')+'<p id="displayLinkError" role="status"></p>',async()=>{
   const label=document.getElementById('displayLinkName'),reason=document.getElementById('displayLinkReason'),error=document.getElementById('displayLinkError');
   if(label&&(!label.value.trim()||!window.VoxelDialog.validate(label)))return;if(reason&&(reason.value.trim().length<3||!window.VoxelDialog.validate(reason)))return;
   try{const data=await api(creating?'':`/${encodeURIComponent(row.id)}/${operation}`,{request_id,...(label?{label:label.value.trim()}:{}),...(row?{expected_revision:row.revision,reason:reason.value.trim()}:{})});hideDialog();if(creating||replacing)issued(data);else await openAttendanceDisplaySettings();}
   catch(e){window.VoxelFeedback?.notify(e.message,{kind:'error'});error.textContent=e.message+' If the response was interrupted, use the same request to retry, or cancel and refresh the display list before creating another link.';}
  },creating?'Create link':replacing?'Replace link':'Revoke link');

 }
 async function openAttendanceDisplaySettings(){
  const epoch=++listEpoch;
  showDialog('Attendance display links','<p role="status">Loading displays…</p>',null,'Close');const target=body();
  try{const data=await api();if(epoch!==listEpoch||body()!==target||document.getElementById('dialogTitle').textContent!=='Attendance display links')return;target.replaceChildren(paragraph('These links grant QR display access only. They do not grant access to staff, attendance writes or management.'),button('Create display link',()=>change(null,'create')));
   if(!data.links.length)target.append(paragraph('No display links have been created.'));
   for(const row of data.links){const section=document.createElement('section');section.className='record-card';const title=document.createElement('h3');title.textContent=row.label;section.append(title,paragraph(row.revoked_at?'Revoked':'Active · '+data.site_name));if(!row.revoked_at)section.append(button('Replace link',()=>change(row,'replace')),button('Revoke link',()=>change(row,'revoke')));target.append(section);}
  }catch(e){if(epoch===listEpoch&&document.getElementById('dialogTitle').textContent==='Attendance display links')target.replaceChildren(paragraph(e.message),button('Retry',openAttendanceDisplaySettings));}
 }
 window.openAttendanceDisplaySettings=openAttendanceDisplaySettings;
})();
