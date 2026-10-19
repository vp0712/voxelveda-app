let vvClientUser={};
let clientRequestBusy=false,clientRecordEpoch=0;
const clientRecordState={RFQ:{page:1,search:''},Invoice:{page:1,search:''}};
const clientOwner=()=>String(vvClientUser.id||'')+':'+String(localStorage.getItem('user')||'');

async function clientJson(res){try{return await res.json()}catch{return {}}}

async function loadClientIdentity(){
  const res=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
  if(!res.ok){window.location.replace('/login?message='+encodeURIComponent('Please login to open the client portal.'));return}
  const data=await clientJson(res); vvClientUser=data.user||{};
  const role=String(vvClientUser.role||'').toLowerCase();
  if(!['viewer','view_only','client','customer'].includes(role)){
    window.location.replace(role==='admin'||role==='super_admin'?'/admin':'/dashboard'); return;
  }
  localStorage.setItem('user',JSON.stringify(vvClientUser));localStorage.setItem('role',vvClientUser.role);
  const name=vvClientUser.name||'Client';
  document.getElementById('clientWelcome').textContent='Welcome, '+name;
  document.getElementById('clientProfileName').textContent=name;
  document.getElementById('clientProfileEmail').textContent=vvClientUser.email||'-';
  document.getElementById('clientName').value=name;
  document.getElementById('clientEmail').value=vvClientUser.email||'';
  await loadClientRecords();
  window.VoxelAvatar?.refreshSelf({force:true});
}

function clientStatus(message,tone='info'){
  const el=document.getElementById('clientRfqStatus'); if(!el)return;
  el.textContent=message;
  el.style.color=tone==='error'?'#f87171':tone==='success'?'#22c55e':'#94a3b8';
}

async function submitClientRfq(){
  if(clientRequestBusy)return;
  if(!document.getElementById('clientPrivacy')?.checked){clientStatus('Accept the Privacy Policy before submitting.','error');return}
  const application=[
    document.getElementById('clientApplication')?.value.trim(),
    document.getElementById('clientDeadline')?.value.trim()?('Target date / urgency: '+document.getElementById('clientDeadline').value.trim()):''
  ].filter(Boolean).join('\n');
  const body={
    customer_name:document.getElementById('clientName')?.value.trim(),
    email:document.getElementById('clientEmail')?.value.trim(),
    phone:document.getElementById('clientPhone')?.value.trim(),
    material:document.getElementById('clientMaterial')?.value.trim(),
    quantity:Number(document.getElementById('clientQuantity')?.value||1),
    application
  };
  if(!body.customer_name||!body.email){clientStatus('Customer name and email are required.','error');return}
  const button=document.getElementById('clientSubmitRfq'),owner=clientOwner();clientRequestBusy=true;if(button)button.disabled=true;
  clientStatus('Submitting RFQ...');
  try{
    const res=await fetch('/api/public/rfq',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await clientJson(res);
    if(owner!==clientOwner())return;
    if(!res.ok){clientStatus(data.message||'RFQ submission failed.','error');return}
    clientStatus('RFQ submitted successfully. Reference #'+data.rfq_id+'.','success');
    ['clientPhone','clientMaterial','clientDeadline','clientApplication'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
    document.getElementById('clientQuantity').value='1'; document.getElementById('clientPrivacy').checked=false;
  }catch{if(owner===clientOwner())clientStatus('The submission outcome could not be confirmed. Check your enquiries before submitting again.','error')}finally{clientRequestBusy=false;if(button)button.disabled=false;}
}

async function clientLogout(){
  try{const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});if(!response.ok)throw new Error();}catch{clientStatus('Sign out could not be confirmed. Retry when connected.','error');return;}
  clientRecordEpoch++;
  localStorage.removeItem('user');localStorage.removeItem('role');localStorage.removeItem('token');
  window.location.href='/login';
}

document.addEventListener('DOMContentLoaded',loadClientIdentity);
async function loadClientRecords(){
  const epoch=++clientRecordEpoch,owner=clientOwner();
  const permissions=[...(Array.isArray(vvClientUser.permissions)?vvClientUser.permissions:[]),...(Array.isArray(vvClientUser.effective_permissions)?vvClientUser.effective_permissions:[])];
  const sources=[];if(permissions.includes('VIEW_RFQS')||permissions.includes('rfqs'))sources.push(['/api/rfq','rfqs','RFQ']);if(permissions.includes('VIEW_FINANCE')||permissions.includes('finance'))sources.push(['/api/invoice','invoices','Invoice']);
  const panel=document.getElementById('clientRecords'),list=document.getElementById('clientRecordList');list.replaceChildren();panel.hidden=!sources.length;
  for(const [url,key,label]of sources){
    const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=label==='RFQ'?'RFQs & quotations':'Invoices & documents';section.append(heading);list.append(section);
    const state=clientRecordState[label],form=document.createElement('form'),input=document.createElement('input'),search=document.createElement('button');input.type='search';input.value=state.search;input.maxLength=120;input.setAttribute('aria-label','Search '+label+' records');search.type='submit';search.textContent='Search';form.append(input,search);section.append(form);form.onsubmit=event=>{event.preventDefault();state.search=input.value.trim();state.page=1;loadClientRecords();};
    const loading=document.createElement('p');loading.textContent='Loading authorised records…';loading.setAttribute('role','status');section.append(loading);
    try{const params=new URLSearchParams({page:String(state.page),limit:'20',...(state.search?{[label==='RFQ'?'q':'search']:state.search}:{})});const response=await fetch(url+'?'+params,{credentials:'same-origin',cache:'no-store'});const data=await clientJson(response);if(epoch!==clientRecordEpoch||owner!==clientOwner())return;if(!response.ok)throw new Error(response.status===403?'These records are restricted for this account.':data.message||'These records could not be loaded.');const rows=Array.isArray(data)?data:data[key]||data.rows||[];loading.remove();
      const info=document.createElement('p');info.textContent=Number.isSafeInteger(Number(data.total))?`${data.total} matching records · Page ${state.page}`:`${rows.length} records on this page`;section.append(info);
      if(!rows.length){const empty=document.createElement('p');empty.textContent='No authorised records match this search.';section.append(empty);}
      for(const row of rows){const item=document.createElement('article');item.className='client-record';const title=document.createElement('strong');title.textContent=`${label} ${row.rfq_no||row.invoice_no||row.id}`;const status=document.createElement('p');status.textContent=String(row.status||'Recorded').replaceAll('_',' ');item.append(title,status);if(label==='Invoice'&&Number.isSafeInteger(Number(row.id))){const link=document.createElement('button');link.type='button';link.textContent='View PDF';link.onclick=async()=>{try{await window.VoxelOperations.openPdf(`/api/invoice/${Number(row.id)}/pdf`);}catch(error){clientStatus(error.message,'error');}};item.append(link);}section.append(item);}
      const pages=Math.max(1,Number(data.pages||Math.ceil(Number(data.total||rows.length)/20)));const nav=document.createElement('nav');nav.setAttribute('aria-label',label+' pages');for(const [text,page,disabled]of [['Previous',state.page-1,state.page<=1],['Next',state.page+1,state.page>=pages]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=disabled;button.onclick=()=>{state.page=page;loadClientRecords();};nav.append(button);}section.append(nav);
    }catch(error){if(epoch!==clientRecordEpoch||owner!==clientOwner())return;loading.textContent=error.message;loading.setAttribute('role','alert');const retry=document.createElement('button');retry.type='button';retry.textContent='Retry '+label+' records';retry.onclick=loadClientRecords;section.append(retry);}
  }
}
window.addEventListener('storage',event=>{if(!event.key||['user','token'].includes(event.key)){clientRecordEpoch++;document.getElementById('clientRecordList')?.replaceChildren();}});
