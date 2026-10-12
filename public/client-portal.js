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
  const name=vvClientUser.name||'Client';
  document.getElementById('clientWelcome').textContent='Welcome, '+name;
  document.getElementById('clientProfileName').textContent=name;
  document.getElementById('clientProfileEmail').textContent=vvClientUser.email||'-';
  document.getElementById('clientName').value=name;
  document.getElementById('clientEmail').value=vvClientUser.email||'';
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