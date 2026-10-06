(function erpWorkspaceFactory(){
  'use strict';
  const root=document.getElementById('erpSection');
  if(!root) return;
  const state={workspace:null,tab:'home',query:'',pending:null,lastLoaded:0};
  const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const text=v=>escapeHtml(v);
  const pretty=v=>String(v||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  const date=v=>v?String(v).slice(0,10):'Not set';
  const chip=v=>`<span class="erp-chip ${text(String(v||'').toLowerCase())}">${text(pretty(v))}</span>`;
  const modules=()=>state.workspace?.modules||[];
  const data=()=>state.workspace?.data||{};
  const moduleByKey=key=>modules().find(m=>m.key===key);
  const accessible=section=>typeof canAccessAdminSection==='function'&&canAccessAdminSection(section);
  const can=permission=>typeof hasCurrentPermission==='function'&&hasCurrentPermission(permission);
  const msg=value=>{document.getElementById('erpStatus').textContent=value;};
  async function api(path,options={}) {
    const response=await fetch('/api/erp'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(15000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.message||'ERP request failed. Refresh before retrying.');
    return result;
  }
  async function load(force=false) {
    if(state.pending) return state.pending;
    if(!force && state.workspace && Date.now()-state.lastLoaded<30000) { render(); return; }
    msg('Checking live company registers…');
    state.pending=(async()=>{
      try { state.workspace=await api('/workspace'); state.lastLoaded=Date.now();
        document.querySelectorAll('.nav-btn[data-erp-focus]').forEach(btn=>{
          const key=btn.dataset.erpFocus; btn.classList.toggle('hidden-section',key!=='home'&&!moduleByKey(key));
        });
        if(state.tab!=='home'&&!moduleByKey(state.tab)) state.tab='home';
        render();
        const unavailable=state.workspace.checks.filter(c=>c.status!=='READY').length;
        msg(`${modules().length} permitted departments · updated ${new Date(state.workspace.generated_at).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}${unavailable?' · '+unavailable+' register(s) unavailable':''}`);
      } catch(error) { msg(error.message); document.getElementById('erpContent').innerHTML='<div class="erp-empty">Workspace could not load. Use Refresh workspace to retry. No figures have been invented.</div>'; }
      finally { state.pending=null; }
    })();
    return state.pending;
  }
  function open(tab='home') { state.tab=tab==='home'||moduleByKey(tab)?tab:'home'; render(); return load(); }
  function button(section,label) { return accessible(section)?`<button class="erp-action" type="button" data-erp-section="${text(section)}">${text(label)}</button>`:''; }
  function page(url,label) { return `<button class="erp-action" type="button" data-erp-page="${text(url)}">${text(label)}</button>`; }
  function empty(key,message) { return `<div class="erp-empty">${data()[key]===null?'Register unavailable. Refresh to retry; no zero total has been substituted.':text(message)}</div>`; }
  function table(headers,rows) { return `<div class="erp-table-wrap"><table class="erp-table"><thead><tr>${headers.map(h=>`<th scope="col">${text(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`; }
  const metric=(label,value,hint)=>`<article class="erp-metric"><span>${text(label)}</span><strong>${text(value)}</strong><small>${text(hint)}</small></article>`;
  function home() {
    const d=data(),sales=d.sales?.reduce((n,r)=>n+Number(r.count),0),production=d.production?.filter(r=>!['COMPLETE','CANCELLED'].includes(r.status)).length;
    const metrics=[];
    if(moduleByKey('sales')&&can('VIEW_RFQS')) metrics.push(metric('Sales enquiries',sales??'—','All recorded enquiry statuses'));
    if(moduleByKey('planning')) metrics.push(metric('Open work orders',production??'—','Within latest 100 work orders'));
    if(moduleByKey('inventory')) metrics.push(metric('Stock batches',d.inventory?.[0]?.batches??'—','Excludes deleted stock'));
    if(moduleByKey('hr')&&can('VIEW_STAFF_HR')) metrics.push(metric('Active people',d.hr?.[0]?.active_staff??'—','From active user records'));
    const attention=[];
    for(const check of state.workspace?.checks||[]) if(check.status!=='READY') attention.push(`<div class="erp-attention-item warning"><div><strong>${text(pretty(check.key))} register unavailable</strong><small>Figures are unknown until this register can be read.</small></div></div>`);
    const holds=d.production?.filter(j=>['QUALITY_HOLD','MATERIAL_WAITING'].includes(j.status))||[];
    if(holds.length) attention.push(`<div class="erp-attention-item warning"><div><strong>${holds.length} loaded work order(s) need attention</strong><small>Material waiting or quality hold. Release gates are still enforced.</small></div><button class="erp-action" data-erp-tab="planning">Review work orders</button></div>`);
    const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part=type=>parts.find(p=>p.type===type).value;
    const today=part('year')+'-'+part('month')+'-'+part('day');
    const overdue=d.supply?.filter(p=>['APPROVED','PART_RECEIVED'].includes(p.status)&&p.expected_date&&date(p.expected_date)<today)||[];
    if(overdue.length) attention.push(`<div class="erp-attention-item warning"><div><strong>${overdue.length} loaded purchase order(s) overdue</strong><small>Expected delivery date has passed; receiving remains controlled.</small></div><button class="erp-action" data-erp-tab="supply">Review deliveries</button></div>`);
    if(moduleByKey('approvals')) attention.push(`<div class="erp-attention-item"><div><strong>Your approval inbox</strong><small>Open requests assigned to you. This is not an organisation-wide approval count.</small></div>${button('approvalsSection','Open approvals')}</div>`);
    const cards=modules().filter(m=>[m.title,m.hint,m.key].join(' ').toLowerCase().includes(state.query));
    return `<div class="erp-metrics">${metrics.join('')}</div><div class="erp-section-head"><div><h2>Your departments</h2><p>Open a workspace without creating another copy of its records.</p></div></div><div class="erp-departments">${cards.map(m=>`<button class="erp-department" data-erp-tab="${text(m.key)}"><span class="erp-icon">${text(m.key.slice(0,2).toUpperCase())}</span><strong>${text(m.title)}</strong><small>${text(m.hint)}</small><span>Open workspace →</span></button>`).join('')||'<div class="erp-empty">No permitted departments match that search.</div>'}</div><section class="erp-panel"><div class="erp-section-head"><h2>Needs attention</h2></div><div class="erp-attention">${attention.join('')||'<p class="erp-note">No flagged items in the loaded ERP registers. Bank statement review still lives in Finance OS.</p>'}</div></section><p class="erp-note">${text(state.workspace?.note)} Operational lists show the latest 100 records; open the full register for complete history.</p>`;
  }
  function input(name,label,type='text',value='',extra='') { return `<label>${text(label)}<input name="${text(name)}" type="${text(type)}" value="${text(value)}" ${extra}></label>`; }
  function select(name,label,values,selected='') { return `<label>${text(label)}<select name="${text(name)}">${values.map(v=>`<option value="${text(v)}" ${v===selected?'selected':''}>${text(pretty(v))}</option>`).join('')}</select></label>`; }
  function campaignForm(row={}) {
    return `<form class="erp-form" data-erp-form="campaign" data-record-id="${text(row.id||'')}" data-revision="${text(row.revision||'')}"><div class="erp-form-grid">${input('name','Campaign name','text',row.name,'required maxlength="180"')}${select('channel','Channel',['EMAIL','SOCIAL','SEARCH','EVENT','PARTNERSHIP','OTHER'],row.channel)}${select('status','Plan status',['DRAFT','PLANNED','ACTIVE','COMPLETE','CANCELLED'],row.status)}${input('currency','Budget currency','text',row.currency||'AUD','required pattern="[A-Z]{3}" maxlength="3"')}${input('planned_budget','Planned budget (not a payment)','number',row.planned_budget||'0','min="0" step="0.01" required')}${input('start_date','Start date','date',row.start_date?date(row.start_date):'')}${input('end_date','End date','date',row.end_date?date(row.end_date):'')}${input('customer_id','Linked customer ID (optional)','number',row.customer_id||'','min="1"')}${can('VIEW_RFQS')?input('rfq_id','Linked enquiry ID (optional)','number',row.rfq_id||'','min="1"'):''}</div><label>Objective<textarea name="objective" required minlength="5" maxlength="1000">${text(row.objective||'')}</textarea></label><p class="erp-note">Saving a plan does not send email, publish advertising or post an expense. Actual spend is recorded in Finance.</p><p class="erp-form-error" role="alert"></p><button type="submit">Save campaign plan</button><button type="button" class="erp-action" data-erp-cancel>Cancel</button></form>`;
  }
  function marketing() {
    const rows=(data().campaigns||[]).filter(r=>[r.name,r.channel,r.status,r.objective].join(' ').toLowerCase().includes(state.query));
    const edit=state.workspace?.capabilities.campaign_edit;
    return `<section class="erp-panel"><div class="erp-section-head"><div><h2>Marketing campaigns</h2><p>Plans are saved centrally and linked to the existing customer/enquiry register.</p></div>${edit?'<button class="primary" data-erp-new="campaign">New campaign</button>':''}</div><div id="erpFormHost"></div>${rows.length?table(['Campaign','Channel / stage','Period','Planned budget','Links','Action'],rows.map(r=>[text(r.name)+'<small>'+text(r.objective)+'</small>',text(pretty(r.channel))+'<br>'+chip(r.status),text(date(r.start_date))+' → '+text(date(r.end_date)),text(r.currency)+' '+text(r.planned_budget),text(r.customer_id?'Customer #'+r.customer_id:'—')+'<small>'+text(r.rfq_id?'Enquiry #'+r.rfq_id:'')+'</small>',edit?`<button class="erp-action" data-erp-edit="${text(r.id)}">Edit plan</button>`:'Read only'])):empty('campaigns','No campaign plans in this view. Create a plan when ready.')}<div class="erp-links">${button('customerSection','Customer register')}${button('rfqSection','Enquiry register')}${button('expenseSection','Record actual spend')}</div></section>`;
  }
  function jobForm() {
    return `<form class="erp-form" data-erp-form="job"><div class="erp-form-grid">${input('part_no','Part / product number','text','','required maxlength="100"')}${input('part_description','Description','text','','required minlength="3" maxlength="255"')}${input('quantity','Quantity','number','1','required min="0.0001" step="0.0001"')}${select('sector','Sector',['GENERAL','AEROSPACE','DEFENCE','MEDICAL','AUTOMOTIVE','OTHER'])}${input('drawing_no','Drawing number (optional)')}${input('drawing_revision','Drawing revision (optional)')}${can('VIEW_RFQS')?input('rfq_id','Existing enquiry ID (optional)','number','','min="1"'):''}</div><p class="erp-note">Creates a PLANNING work order only. Materials, competency, machine readiness and quality-release gates remain mandatory. Regulated sectors are flagged for review.</p><p class="erp-form-error" role="alert"></p><button type="submit">Create planning work order</button><button type="button" class="erp-action" data-erp-cancel>Cancel</button></form>`;
  }
  function operationForm(id) {
    const machines=data().machines||[];
    return `<form class="erp-form" data-erp-form="operation" data-record-id="${text(id)}"><div class="erp-form-grid">${input('operation_name','Operation name','text','','required minlength="3" maxlength="160"')}<label>Machine<select name="machine_id" required><option value="">Choose machine</option>${machines.filter(m=>m.commissioned&&!m.critical_safety_issue&&['READY','RUNNING'].includes(m.status)).map(m=>`<option value="${text(m.id)}">${text(m.equipment_code)} · ${text(m.description)}</option>`).join('')}</select></label>${input('planned_start','Start (your browser local time)','datetime-local','','required')}${input('planned_end','End (your browser local time)','datetime-local','','required')}${input('required_competency_code','Required competency code (optional)')}${input('work_instruction_ref','Work instruction reference (optional)')}</div><p class="erp-note">Times are saved in UTC. Overlapping bookings are blocked. A reservation does not authorise production start.</p><p class="erp-form-error" role="alert"></p><button type="submit">Reserve machine time</button><button type="button" class="erp-action" data-erp-cancel>Cancel</button></form>`;
  }
  function planning() {
    const rows=(data().production||[]).filter(r=>[r.job_no,r.part_no,r.part_description,r.status].join(' ').toLowerCase().includes(state.query)),edit=state.workspace?.capabilities.production_edit;
    const schedule=data().schedule||[];
    return `<section class="erp-panel"><div class="erp-section-head"><div><h2>Production planning</h2><p>Work orders use the existing manufacturing register, not a second job database.</p></div>${edit?'<button class="primary" data-erp-new="job">New work order</button>':''}</div><div id="erpFormHost"></div>${rows.length?table(['Work order','Part / quantity','Stage','Enquiry','Actions'],rows.map(r=>[text(r.job_no),text(r.part_no)+'<small>'+text(r.part_description)+' · '+text(r.quantity)+'</small>',chip(r.status),text(r.rfq_id?'#'+r.rfq_id:'—'),page('/shop-floor?type=job&id='+encodeURIComponent(r.id),'Shop floor')+(edit&&['PLANNING','MATERIAL_WAITING','READY'].includes(r.status)?` <button class="erp-action" data-erp-schedule="${text(r.id)}">Plan operation</button>`:'')])):empty('production','No work orders in this view. Start with a planning work order.')}</section><section class="erp-panel"><div class="erp-section-head"><h2>Machine schedule</h2></div>${schedule.length?table(['Work order / operation','Machine','Start → end (local time)','Stage'],schedule.map(o=>[text(o.job_no)+'<small>'+text(o.operation_name)+'</small>',text(o.equipment_code||'Unassigned'),text(localTime(o.planned_start))+' → '+text(localTime(o.planned_end)),chip(o.status)])):empty('schedule','No active scheduled operations. Machine time is reserved from a planning-stage work order.')}<p class="erp-note">Machine setup and commissioning remain in the Quality/Manufacturing workspace.</p>${page('/quality','Quality & manufacturing controls')}</section>`;
  }
  function localTime(value) { if(!value)return 'Unscheduled'; const s=String(value);const dt=new Date(s.includes('T')?s:s.replace(' ','T')+'Z');return Number.isFinite(dt.getTime())?dt.toLocaleString('en-AU'):'Unknown time'; }
  function supply() {
    const rows=(data().supply||[]).filter(r=>[r.po_number,r.status].join(' ').toLowerCase().includes(state.query));
    return `<section class="erp-panel"><div class="erp-section-head"><div><h2>Supply chain & deliveries</h2><p>Approved orders, partial receipts and expected delivery dates from Procurement.</p></div>${button('procurementSection','Open procurement workflow')}</div><div class="erp-callout">Request → supplier quote → approval → purchase order → goods receipt → inspection → bill match. Recording a delivery here does not create another stock movement.</div>${rows.length?table(['Purchase order','Expected date','Stage','Outstanding units'],rows.map(r=>[text(r.po_number),text(date(r.expected_date)),chip(r.status),text(r.outstanding_units)])):empty('supply','No open purchase orders in this view. Draft and pending orders must be approved before receiving.')}<div class="erp-links">${button('supplierSection','Suppliers')}${button('stockSection','Inventory')}${button('approvalsSection','Approvals')}</div></section>`;
  }
  function department(key) {
    const m=moduleByKey(key); if(!m)return '<div class="erp-empty">This department is not permitted for your account.</div>';
    let content='';
    if(key==='sales') content=(data().sales?.length?table(['Enquiry stage','Records'],data().sales.map(r=>[chip(r.status),text(r.count)])):empty('sales','No enquiries recorded.'))+`<div class="erp-links">${button('rfqSection','Quotes & enquiries')}${button('customerSection','Customers')}${button('invoiceSection','Invoices')}</div>`;
    if(key==='hr') content=`<div class="erp-links">${button('staffSection','People directory')}${button('rosterSection','Roster planning')}${button('attendanceSection','Attendance & timesheets')}${button('companyFormsSection','Onboarding & training forms')}</div><p class="erp-note">Sensitive HR and payroll records retain their existing access controls.</p>`;
    if(key==='inventory') content=`${data().inventory?.length?metric('Active batches',data().inventory[0].batches,'Empty batches: '+data().inventory[0].empty_batches):empty('inventory','No inventory batches.')}<div class="erp-links">${button('stockSection','Stock in / batches')}${button('stockUsageSection','Stock out')}${button('rawMaterialSection','Raw material')}${button('packagingSection','Packaging')}</div>`;
    if(key==='finance') content=`<div class="erp-callout">Company accounting and banking are different records. Personal balances and different currencies are never added into these ERP counts.</div>${data().accounting?.length?table(['Invoice stage','Records'],data().accounting.map(r=>[chip(r.status),text(r.count)])):empty('accounting','No company invoices recorded.')}<div class="erp-links">${button('financeSection','Company accounting')}${button('invoiceSection','Invoices')}${button('expenseSection','Expenses')}${page('/finance-intelligence','Open existing Finance OS')}</div>`;
    if(key==='manufacturing') content=`<div class="erp-links">${page('/quality','Quality & manufacturing')}${page('/shop-floor','Shop floor')}<button class="erp-action" data-erp-tab="planning">Work orders & planning</button></div><p class="erp-note">Inspections, traceability, calibration and controlled releases remain in the existing QMS. Production start is not bypassed from ERP.</p>`;
    if(key==='procurement') content=`<div class="erp-links">${button('procurementSection','Requests, orders & receiving')}${button('supplierSection','Supplier register')}<button class="erp-action" data-erp-tab="supply">Delivery overview</button></div><p class="erp-note">The existing requisition, approval, receiving, inspection and three-way bill-match controls are reused.</p>`;
    if(key==='approvals') content=`<div class="erp-links">${button('approvalsSection','My approvals & requests')}${button('companyFormsSection','Company forms')}${button('complianceSection','Compliance')}</div>`;
    return `<section class="erp-panel"><div class="erp-section-head"><div><h2>${text(m.title)}</h2><p>${text(m.hint)}</p></div></div>${content}</section>`;
  }
  function render() {
    if(!state.workspace)return;
    document.getElementById('erpTabs').innerHTML=[{key:'home',title:'All departments'},...modules()].map(m=>`<button type="button" data-erp-tab="${text(m.key)}" aria-current="${m.key===state.tab}">${text(m.title)}</button>`).join('');
    document.getElementById('erpContent').innerHTML=state.tab==='home'?home():state.tab==='marketing'?marketing():state.tab==='planning'?planning():state.tab==='supply'?supply():department(state.tab);
  }
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.erpTab)return open(b.dataset.erpTab);
    if(b.dataset.erpSection)return accessible(b.dataset.erpSection)?goSection(b.dataset.erpSection):msg('This section is not permitted.');
    if(b.dataset.erpPage)return openSystemPage(b.dataset.erpPage);
    const host=document.getElementById('erpFormHost');
    if(b.hasAttribute('data-erp-cancel'))return host.replaceChildren();
    if(b.dataset.erpNew==='campaign')host.innerHTML=campaignForm();
    if(b.dataset.erpNew==='job')host.innerHTML=jobForm();
    if(b.dataset.erpEdit) { const row=data().campaigns?.find(r=>String(r.id)===b.dataset.erpEdit);if(row)host.innerHTML=campaignForm(row); }
    if(b.dataset.erpSchedule)host.innerHTML=operationForm(b.dataset.erpSchedule);
  });
  root.addEventListener('submit',async event=>{
    const form=event.target;if(!form.dataset.erpForm)return;event.preventDefault();
    if(form.dataset.busy==='true')return;
    const error=form.querySelector('[role="alert"]');error.textContent='';
    const payload=Object.fromEntries(new FormData(form)),kind=form.dataset.erpForm;
    let endpoint=kind==='campaign'?'/campaigns':kind==='job'?'/work-orders':`/work-orders/${encodeURIComponent(form.dataset.recordId)}/operations`,method='POST';
    if(kind==='campaign'&&form.dataset.recordId){endpoint+='/'+encodeURIComponent(form.dataset.recordId);method='PUT';payload.revision=Number(form.dataset.revision);}
    if(kind==='operation') { try { payload.planned_start=new Date(payload.planned_start).toISOString();payload.planned_end=new Date(payload.planned_end).toISOString(); } catch {error.textContent='Choose valid schedule times.';return;} }
    form.dataset.busy='true';form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try { await api(endpoint,{method,body:JSON.stringify(payload)});form.reset();form.remove();window.showToast?.(kind==='campaign'?'Campaign plan saved. No messages or payments were sent.':'Planning record saved. Production safety gates remain in place.');await load(true); }
    catch(e) { error.textContent=e.message; }
    finally { form.dataset.busy='false';form.querySelectorAll('button').forEach(b=>b.disabled=false); }
  });
  document.getElementById('erpRefresh').addEventListener('click',()=>load(true));
  document.getElementById('erpSearch').addEventListener('input',event=>{state.query=event.target.value.trim().toLowerCase();render();});
  window.VoxelERP={load,open};
})();
