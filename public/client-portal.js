let vvClientUser={};

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
  clientStatus('Submitting RFQ...');
  try{
    const res=await fetch('/api/public/rfq',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await clientJson(res);
    if(!res.ok){clientStatus(data.message||'RFQ submission failed.','error');return}
    clientStatus('RFQ submitted successfully. Reference #'+data.rfq_id+'.','success');
    ['clientPhone','clientMaterial','clientDeadline','clientApplication'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
    document.getElementById('clientQuantity').value='1'; document.getElementById('clientPrivacy').checked=false;
  }catch{clientStatus('Unable to submit right now. Contact info@voxelveda.com if the problem continues.','error')}
}

async function clientLogout(){
  try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})}catch{}
  localStorage.removeItem('user');localStorage.removeItem('role');localStorage.removeItem('token');
  window.location.href='/login';
}

document.addEventListener('DOMContentLoaded',loadClientIdentity);
async function loadClientRecords(){
  const permissions=[...(Array.isArray(vvClientUser.permissions)?vvClientUser.permissions:[]),...(Array.isArray(vvClientUser.effective_permissions)?vvClientUser.effective_permissions:[])];
  const sources=[];if(permissions.includes('VIEW_RFQS')||permissions.includes('rfqs'))sources.push(['/api/rfq','rfqs','RFQ']);if(permissions.includes('VIEW_FINANCE')||permissions.includes('finance'))sources.push(['/api/invoice','invoices','Invoice']);
  const panel=document.getElementById('clientRecords'),list=document.getElementById('clientRecordList');list.replaceChildren();panel.hidden=!sources.length;
  for(const [url,key,label]of sources){
    const heading=document.createElement('h3');heading.textContent=label==='RFQ'?'RFQs & quotations':'Invoices & documents';list.append(heading);
    try{const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('These records could not be loaded.');const data=await clientJson(response),rows=Array.isArray(data)?data:data[key]||data.rows||[];
      if(!rows.length){const empty=document.createElement('p');empty.textContent='No authorised records to show.';list.append(empty);}
      for(const row of rows){const item=document.createElement('p');item.textContent=`${label} ${row.rfq_no||row.invoice_no||row.id} · ${row.status||'Recorded'}`;if(label==='Invoice'&&Number.isSafeInteger(Number(row.id))){const link=document.createElement('a');link.href=`/api/invoice/${Number(row.id)}/pdf`;link.textContent='View document';item.append(' · ',link);}list.append(item);}
    }catch(error){const message=document.createElement('p');message.textContent=error.message;list.append(message);}
  }
}
