(() => {
'use strict';
const ROOT='financeMarginAllocationMount',VERSION='20260924-margin-allocation-v1';
let data=null,loading=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0);
const money=(v,c='AUD')=>{try{return new Intl.NumberFormat('en-AU',{style:'currency',currency:c||'AUD'}).format(num(v))}catch{return num(v).toFixed(2)+' '+c}};
const date=v=>v?new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(String(v).slice(0,10)+'T00:00:00')):'—';
const api=(path,options={})=>window.__voxelFinanceApi(path,options);
const notice=(m,bad=false)=>window.__voxelFinanceNotice(m,bad);
const active=()=>data?.entities?.filter(e=>e.status==='ACTIVE')||[];
const options=()=>active().map(e=>'<option value="'+esc(e.entity_uid)+'">'+esc(e.entity_type+' · '+e.name)+'</option>').join('');

function modal(title,body,save){
 const host=document.createElement('div');host.innerHTML='<dialog class="fm-modal" open><div class="fm-modal-body"><form id="pfcForm" class="fm-form"><h2>'+esc(title)+'</h2>'+body+'<div class="fm-form-actions"><button type="button" data-cancel>Cancel</button><button class="primary">Save</button></div></form></div></dialog>';
 document.body.appendChild(host);const dialog=host.querySelector('dialog'),form=host.querySelector('form');
 host.querySelector('[data-cancel]').onclick=()=>host.remove();
 form.onsubmit=async e=>{e.preventDefault();try{await save(new FormData(form));host.remove()}catch(error){notice(error.message,true)}};
}
function entityForm(e=null){
 modal(e?'Edit margin dimension':'Add margin dimension',
 '<div class="fm-form-grid"><label>Type<select name="entity_type">'+['CUSTOMER','PROJECT','SERVICE','PRODUCT','CHANNEL','OTHER'].map(v=>'<option '+(e?.entity_type===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label>Name<input name="name" required value="'+esc(e?.name||'')+'"></label></div>'+
 '<div class="fm-form-grid"><label>Code<input name="entity_code" value="'+esc(e?.entity_code||'')+'"></label><label>Owner<input name="owner_name" value="'+esc(e?.owner_name||'')+'"></label></div>'+
 '<label>Target cash margin %<input name="target_margin_percent" type="number" step="0.01" min="-100" max="100" value="'+esc(e?.target_margin_percent??'')+'"></label>'+
 '<label>Notes<textarea name="notes">'+esc(e?.notes||'')+'</textarea></label>',
 async fd=>{const body=Object.fromEntries(fd.entries());const path=e?'/api/finance/margin-allocation/entities/'+encodeURIComponent(e.entity_uid):'/api/finance/margin-allocation/entities';const x=await api(path,{method:e?'PUT':'POST',body:JSON.stringify(body)});notice(x.message);await load()});
}
function allocationForm(tx){
 if(!active().length)return notice('Create an active margin dimension first.',true);
 modal('Allocate BUSINESS bank evidence',
 '<p class="fm-helper">'+esc((tx.merchant_name||tx.description||'Transaction')+' · '+money(tx.remaining_amount,tx.currency)+' remaining')+'</p>'+
 '<label>Dimension<select name="entity_uid">'+options()+'</select></label>'+
 '<label>Role<select name="allocation_role"><option>'+esc(tx.suggested_role)+'</option></select></label>'+
 '<label>Amount<input name="amount" type="number" step="0.01" min="0.01" max="'+esc(tx.remaining_amount)+'" value="'+esc(tx.remaining_amount)+'" required></label>'+
 '<label>Note<textarea name="note"></textarea></label>',
 async fd=>{const body=Object.fromEntries(fd.entries());body.bank_transaction_id=tx.id;const x=await api('/api/finance/margin-allocation/allocations',{method:'POST',body:JSON.stringify(body)});notice(x.message);await load()});
}
function invoiceForm(inv){
 if(!active().length)return notice('Create an active margin dimension first.',true);
 modal('Link invoice billing context',
 '<p class="fm-helper">'+esc((inv.invoice_no||('Invoice #'+inv.id))+' · '+(inv.customer_name||'Customer'))+'</p>'+
 '<label>Dimension<select name="entity_uid">'+options()+'</select></label>'+
 '<label>Invoice currency<input name="currency" maxlength="3" pattern="[A-Za-z]{3}" placeholder="AUD" value="" required></label>'+
 '<label>Note<textarea name="note"></textarea></label>',
 async fd=>{const body=Object.fromEntries(fd.entries());body.invoice_id=inv.id;const x=await api('/api/finance/margin-allocation/invoice-links',{method:'POST',body:JSON.stringify(body)});notice(x.message);await load()});
}
function render(){
 const root=document.getElementById(ROOT);if(!root)return;
 const totals=Object.entries(data?.totals_by_currency||{}).map(([c,x])=>'<div class="fm-kpi"><span>'+esc(c)+' cash margin</span><strong>'+money(x.margin,c)+'</strong><small>'+money(x.revenue,c)+' revenue · '+money(x.cost,c)+' cost · '+(x.margin_percent===null?'—':num(x.margin_percent).toFixed(1)+'%')+'</small></div>').join('');
 const entities=(data?.entities||[]).map(e=>{
  const cash=Object.entries(e.by_currency||{}).map(([c,x])=>'<p>'+esc(c)+' · '+money(x.revenue,c)+' revenue · '+money(x.cost,c)+' cost · <b>'+money(x.margin,c)+' margin</b> · '+(x.margin_percent===null?'—':num(x.margin_percent).toFixed(1)+'%')+'</p>').join('');
  const billing=Object.entries(e.billing_by_currency||{}).map(([c,x])=>'<p class="fm-helper">'+esc(c)+' billing · '+money(x.invoice_value,c)+' invoiced · '+money(x.paid_amount,c)+' paid · '+money(x.balance_due,c)+' due</p>').join('');
  return '<div class="fm-row"><div><h3>'+esc(e.name)+'</h3><p>'+esc(e.entity_type)+(e.entity_code?' · '+esc(e.entity_code):'')+(e.owner_name?' · owner '+esc(e.owner_name):'')+'</p>'+cash+billing+'</div><div class="fm-row-right"><b>'+(e.target_margin_percent===null?'No target':'Target '+num(e.target_margin_percent).toFixed(1)+'%')+'</b><div class="fm-inline-actions"><button data-edit="'+esc(e.entity_uid)+'">Edit</button><button data-status="'+esc(e.entity_uid)+'" data-active="'+(e.status==='ACTIVE'?'false':'true')+'">'+(e.status==='ACTIVE'?'Archive':'Restore')+'</button></div></div></div>';
 }).join('');
 const tx=(data?.transaction_candidates||[]).slice(0,80).map(t=>'<div class="fm-row"><div><h3>'+esc(t.merchant_name||t.description||'Bank transaction')+'</h3><p>'+date(t.transaction_date)+' · '+esc(t.account_name||'Business account')+' · '+esc(t.suggested_role)+'</p></div><div class="fm-row-right"><b>'+money(t.remaining_amount,t.currency)+'</b><small>'+money(t.allocated_amount,t.currency)+' allocated</small><button data-allocate="'+t.id+'">Allocate</button></div></div>').join('');
 const invoices=(data?.invoice_candidates||[]).slice(0,60).map(i=>'<div class="fm-row"><div><h3>'+esc(i.invoice_no||('Invoice #'+i.id))+'</h3><p>'+esc(i.customer_name||'Customer')+' · currency not assumed</p></div><div class="fm-row-right"><b>'+num(i.total).toFixed(2)+'</b><small>'+num(i.balance_due).toFixed(2)+' due</small><button data-invoice="'+i.id+'">Link invoice</button></div></div>').join('');
 const alloc=(data?.allocations||[]).filter(x=>x.status==='ACTIVE').slice(0,50).map(a=>'<div class="fm-row"><div><h3>'+esc(a.entity_name)+' · '+esc(a.allocation_role)+'</h3><p>'+date(a.transaction_date)+' · '+esc(a.merchant_name||a.description||'Bank transaction')+'</p></div><div class="fm-row-right"><b>'+money(a.amount,a.currency)+'</b><button data-reverse="'+esc(a.allocation_uid)+'">Reverse</button></div></div>').join('');
 const links=(data?.invoice_links||[]).filter(x=>x.status==='ACTIVE').slice(0,40).map(l=>'<div class="fm-row"><div><h3>'+esc(l.entity_name)+' · '+esc(l.invoice_no||('Invoice #'+l.invoice_id))+'</h3><p>'+esc(l.currency)+' billing context</p></div><div class="fm-row-right"><b>'+money(l.total,l.currency)+'</b><small>'+money(l.balance_due,l.currency)+' due</small><button data-unlink="'+esc(l.link_uid)+'">Unlink</button></div></div>').join('');
 root.innerHTML='<div class="fm-control-intro"><p>MARGIN ALLOCATION CONTROL</p><h2>Know which customer, project, service or product is actually producing cash margin.</h2><span>Cash margin comes only from explicit BUSINESS bank allocations. Invoice billing stays separate so bank receipts and invoice revenue are never double-counted.</span><div class="fm-control-quick"><button id="pfcAdd">+ Add dimension</button><button id="pfcRefresh">Refresh</button></div></div>'+
 '<div class="fm-grid four"><div class="fm-kpi"><span>Active dimensions</span><strong>'+num(data?.summary?.active_dimensions)+'</strong></div><div class="fm-kpi"><span>Below target</span><strong>'+num(data?.summary?.below_target_positions)+'</strong></div><div class="fm-kpi"><span>Unallocated transactions</span><strong>'+num(data?.summary?.unallocated_transaction_count)+'</strong></div><div class="fm-kpi"><span>Unlinked invoices</span><strong>'+num(data?.summary?.unlinked_invoice_count)+'</strong></div></div>'+
 '<div class="fm-grid four">'+(totals||'<div class="fm-kpi"><span>Cash margin</span><strong>—</strong><small>No allocated BUSINESS bank evidence yet.</small></div>')+'</div>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Dimensions & margin</h2><p>Native-currency customer/project/service/product margin allocation.</p></div></div><div class="fm-list">'+(entities||'<div class="fm-empty">No margin dimensions yet.</div>')+'</div></div></article>'+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><h2>Unallocated business transactions</h2><div class="fm-list">'+(tx||'<div class="fm-empty">No unallocated BUSINESS bank transaction.</div>')+'</div></div></article><article class="fm-card"><div class="fm-pad"><h2>Unlinked invoices</h2><div class="fm-list">'+(invoices||'<div class="fm-empty">No unlinked invoice.</div>')+'</div></div></article></div>'+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><h2>Active cash allocations</h2><div class="fm-list">'+(alloc||'<div class="fm-empty">No active allocation.</div>')+'</div></div></article><article class="fm-card"><div class="fm-pad"><h2>Active invoice links</h2><div class="fm-list">'+(links||'<div class="fm-empty">No active invoice link.</div>')+'</div></div></article></div>'+
 '<div class="fm-state"><strong>Control boundary</strong><p>This module does not edit bank transactions, post journals, create invoices, invent FX or infer invoice currency. Reversals preserve audit history.</p><small>'+VERSION+'</small></div>';
 bind();
}
async function load(){
 if(loading)return;loading=true;const root=document.getElementById(ROOT);if(root)root.innerHTML='<div class="fm-state">Loading Margin Allocation Control…</div>';
 try{data=await api('/api/finance/margin-allocation');render()}catch(error){if(root)root.innerHTML='<div class="fm-state fm-state-error"><strong>Margin Allocation Control could not load</strong><p>'+esc(error.message)+'</p><button id="pfcRetry">Retry</button></div>';document.getElementById('pfcRetry')?.addEventListener('click',load)}finally{loading=false}
}
function bind(){
 document.getElementById('pfcAdd')?.addEventListener('click',()=>entityForm());
 document.getElementById('pfcRefresh')?.addEventListener('click',load);
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>entityForm(data.entities.find(e=>e.entity_uid===b.dataset.edit)));
 document.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{try{const x=await api('/api/finance/margin-allocation/entities/'+encodeURIComponent(b.dataset.status)+'/status',{method:'POST',body:JSON.stringify({active:b.dataset.active==='true'})});notice(x.message);await load()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-allocate]').forEach(b=>b.onclick=()=>allocationForm(data.transaction_candidates.find(x=>String(x.id)===String(b.dataset.allocate))));
 document.querySelectorAll('[data-invoice]').forEach(b=>b.onclick=()=>invoiceForm(data.invoice_candidates.find(x=>String(x.id)===String(b.dataset.invoice))));
 document.querySelectorAll('[data-reverse]').forEach(b=>b.onclick=async()=>{const reason=prompt('Reversal reason:')||'';if(!reason.trim())return;try{const x=await api('/api/finance/margin-allocation/allocations/'+encodeURIComponent(b.dataset.reverse)+'/reverse',{method:'POST',body:JSON.stringify({reason})});notice(x.message);await load()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-unlink]').forEach(b=>b.onclick=async()=>{const reason=prompt('Unlink reason:')||'';if(!reason.trim())return;try{const x=await api('/api/finance/margin-allocation/invoice-links/'+encodeURIComponent(b.dataset.unlink)+'/reverse',{method:'POST',body:JSON.stringify({reason})});notice(x.message);await load()}catch(error){notice(error.message,true)}});
}
function mount(){if(document.getElementById(ROOT))load()}
window.__financeMarginAllocationMount=mount;
window.addEventListener('finance:margin-allocation-mount',mount);
if(document.readyState!=='loading')setTimeout(mount,0);else document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0));
})();