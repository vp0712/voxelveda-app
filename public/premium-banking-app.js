
(() => {
  'use strict';
  if (!['/finance-intelligence','/banking'].includes(location.pathname) || window.__vvPremiumBankInstalled) return;
  window.__vvPremiumBankInstalled = true;

  const BANK = '/api/integrations/webhooks/banking';
  const STANDALONE = location.pathname === '/banking';
  const FIN = STANDALONE ? '/api/banking/intelligence' : '/api/finance/intelligence';
  const OS = STANDALONE ? '/api/banking/os' : '/api/finance/banking-os';
  const OPEN_BANKING = STANDALONE ? '/api/banking/open-banking' : '/api/finance/intelligence/open-banking';
  const PERSONAL = '/api/finance/personal-money';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (v, currency='AUD') => new Intl.NumberFormat('en-AU',{style:'currency',currency}).format(Number(v||0));
  const pct = (v) => Number(v||0).toFixed(1) + '%';
  const day = (v) => v ? String(v).slice(0,10) : '—';
  const monthLabel = (v) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(v||''));
    if (!m) return String(v||'');
    return new Intl.DateTimeFormat('en-AU',{month:'short',year:'2-digit'}).format(new Date(Date.UTC(Number(m[1]),Number(m[2])-1,1)));
  };
  const state = {
    tab:'home', scope:'ALL', currency:'AUD', range:'1M', chart:'pie',
    status:null, connections:[], quality:null, dashboard:null, budgets:[], insights:null, attention:null,
    os:null, team:null, command:null, calendar:null, activity:[], activityQuery:'', activityCategory:'', activityAccount:'', partialErrors:[], busy:false
  };
  const palette = ['#44d7a5','#67a8ff','#f3b85b','#b89cff','#ff8f96','#5dd4e8','#98d66e','#e9a5ff'];

  async function api(path, options={}) {
    const response = await fetch(path,{
      credentials:'same-origin',
      headers:{'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})},
      ...options
    });
    let body={}; try{body=await response.json();}catch{}
    if(!response.ok){const e=new Error(body.message||('Request failed ('+response.status+')'));e.code=body.code;e.status=response.status;e.payload=body;throw e;}
    return body;
  }

  async function safeApi(path, fallback, label, options={}) {
    try { return await api(path, options); }
    catch (error) {
      if (error.status === 401) throw error;
      state.partialErrors.push({ label, message:error.message, code:error.code||null });
      return typeof fallback === 'function' ? fallback() : fallback;
    }
  }

  function rangeDates(range){
    const now=new Date(); const end=now.toISOString().slice(0,10); let start='';
    if(range==='1M'){const d=new Date(now);d.setMonth(d.getMonth()-1);start=d.toISOString().slice(0,10);}
    else if(range==='3M'){const d=new Date(now);d.setMonth(d.getMonth()-3);start=d.toISOString().slice(0,10);}
    else if(range==='6M'){const d=new Date(now);d.setMonth(d.getMonth()-6);start=d.toISOString().slice(0,10);}
    else if(range==='12M'){const d=new Date(now);d.setFullYear(d.getFullYear()-1);start=d.toISOString().slice(0,10);}
    return {from:start,to:range==='ALL'?'':end};
  }

  function healthClass(){
    const s=state.status||{};
    if(!s.configured) return 'setup';
    if(Number(s.connection_summary?.attention||0)>0) return 'attention';
    return 'healthy';
  }

  function ensureAssets(){
    if(!$('premiumBankCss')){
      const link=document.createElement('link'); link.id='premiumBankCss'; link.rel='stylesheet'; link.href='/premium-banking-app.css?v=20260919-banking-command-v1'; document.head.appendChild(link);
    }
    if(!$('financePdfV3')){
      const script=document.createElement('script'); script.id='financePdfV3'; script.src='/finance-pdf-v3.js?v=20260918-pdf-v3b'; script.defer=true; document.head.appendChild(script);
    }
  }

  function install(){
    document.getElementById('advancedBankingHub')?.remove();
    if($('premiumBankHub')) return;
    const anchor=document.querySelector('.actions.primary-actions');
    if(!anchor) return;
    const section=document.createElement('section');
    section.id='premiumBankHub';
    section.className='vv-premium-bank';
    section.innerHTML=
      '<div class="vv-pb-head">'+
        '<div class="vv-pb-headline"><div><p class="eyebrow">VOXEL VEDA BANKING</p><h2>Money, accounts & insights</h2><p id="vvPbHeadline">Loading your banking workspace…</p></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          (new URLSearchParams(location.search).get('source')==='app'?'<button type="button" class="vv-pb-status" data-pb-action="app-home">← App</button>':'')+
          (STANDALONE?'<span class="vv-pb-status healthy">Banking Portal</span>':'')+
          '<span id="vvPbStatus" class="vv-pb-status">Checking</span></div></div>'+
        '<div class="vv-pb-profile">'+
          '<button type="button" class="active" data-pb-scope="ALL">All money</button>'+
          '<button type="button" data-pb-scope="BUSINESS">Voxel Veda</button>'+
          '<button type="button" data-pb-scope="PERSONAL">Personal</button>'+
        '</div>'+
      '</div>'+
      '<div id="vvPbMessage" class="vv-pb-message" role="status" aria-live="polite" hidden></div>'+
      '<div class="vv-pb-actions">'+
        '<button class="vv-pb-action primary" type="button" data-pb-action="connect"><span>＋</span><b>Connect bank</b><small>Open Banking</small></button>'+
        '<button class="vv-pb-action" type="button" data-pb-action="sync"><span>↻</span><b>Sync</b><small>Refresh data</small></button>'+
        '<button class="vv-pb-action" type="button" data-pb-action="upload"><span>⇧</span><b>Statement</b><small>PDF / CSV / OFX</small></button>'+
        '<button class="vv-pb-action" type="button" data-pb-action="search"><span>⌕</span><b>Search</b><small>Transactions</small></button>'+
        '<button class="vv-pb-action" type="button" data-pb-action="budget"><span>◎</span><b>Budget</b><small>Set a limit</small></button>'+
        '<button class="vv-pb-action" type="button" data-pb-action="payments"><span>→</span><b>Pay & transfer</b><small>Workflow</small></button>'+'<button class="vv-pb-action" type="button" data-pb-action="space"><span>◫</span><b>Space</b><small>Allocate money</small></button>'+'<button class="vv-pb-action" type="button" data-pb-action="team"><span>◎</span><b>Team</b><small>Access control</small></button>'+'<button class="vv-pb-action" type="button" data-pb-action="calendar"><span>▦</span><b>Cash flow</b><small>90-day calendar</small></button>'+
      '</div>'+
      '<nav class="vv-pb-tabs" aria-label="Banking sections">'+
        '<button class="active" type="button" data-pb-tab="home">Home</button>'+
        '<button type="button" data-pb-tab="activity">Activity</button>'+'<button type="button" data-pb-tab="pay">Pay</button>'+
        '<button type="button" data-pb-tab="insights">Insights</button>'+
        '<button type="button" data-pb-tab="plan">Plan</button>'+'<button type="button" data-pb-tab="calendar">Calendar</button>'+'<button type="button" data-pb-tab="team">Team</button>'+
        '<button type="button" data-pb-tab="more">More</button>'+
      '</nav>'+
      '<div id="vvPbContent" class="vv-pb-content"><div class="vv-pb-empty"><strong>Loading banking data…</strong></div></div>';
    anchor.insertAdjacentElement('afterend',section);
    section.addEventListener('click',handleClick);
    ensureDialogs();
  }

  function ensureDialogs(){
    if(!$('vvPbBudgetDialog')){
      const d=document.createElement('dialog'); d.id='vvPbBudgetDialog'; d.className='vv-pb-modal';
      d.innerHTML=
        '<form id="vvPbBudgetForm" class="vv-pb-modal-inner">'+
          '<h3>Set category budget</h3><p>Tracks imported bank transactions in the selected category.</p>'+
          '<label>Money scope<select id="vvPbBudgetScope"><option value="PERSONAL">Personal</option><option value="BUSINESS">Voxel Veda Company</option><option value="ALL">All visible money</option><option value="MIXED">Mixed</option></select></label>'+
          '<label>Category<input id="vvPbBudgetCategory" list="vvPbCategoryList" maxlength="120" required placeholder="Groceries, Cash, Fuel & Vehicle..."><datalist id="vvPbCategoryList"></datalist></label>'+
          '<label>Limit amount<input id="vvPbBudgetAmount" inputmode="decimal" required placeholder="500.00"></label>'+
          '<label>Currency<input id="vvPbBudgetCurrency" maxlength="3" value="AUD" required></label>'+
          '<label>Cycle<select id="vvPbBudgetCycle"><option value="WEEKLY">Weekly</option><option value="FORTNIGHTLY">Fortnightly</option><option value="MONTHLY" selected>Monthly</option></select></label>'+
          '<label>Cycle start<input id="vvPbBudgetAnchor" type="date" required></label>'+
          '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbBudgetDialog">Cancel</button><button class="primary" type="submit">Save budget</button></div>'+
        '</form>';
      document.body.appendChild(d);
      $('vvPbBudgetForm').addEventListener('submit',saveBudget);
    }
    if(!$('vvPbPaymentDialog')){
      const d=document.createElement('dialog'); d.id='vvPbPaymentDialog'; d.className='vv-pb-modal';
      d.innerHTML=
        '<div class="vv-pb-modal-inner"><h3>Payments & transfers</h3>'+
        '<p><b>Bank payment initiation is not enabled.</b> Your current Open Banking layer is read/sync focused. Voxel Veda will not pretend to move real money without a write-enabled payment provider and the required security/compliance setup.</p>'+
        '<p>You can still identify internal transfers, manage recurring bills, categorise transactions and reconcile imported payments safely.</p>'+
        '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbPaymentDialog">Close</button><button class="primary" type="button" data-pb-action="plan">View recurring & budgets</button></div></div>';
      document.body.appendChild(d);
    }
    if(!$('vvPbSpaceDialog')){
      const d=document.createElement('dialog'); d.id='vvPbSpaceDialog'; d.className='vv-pb-modal';
      d.innerHTML='<form id="vvPbSpaceForm" class="vv-pb-modal-inner"><h3>Create Money Space</h3><p>Spaces are allocation envelopes inside Voxel Veda; they do not create a new bank account.</p>'+
        '<label>Name<input id="vvPbSpaceName" maxlength="120" required placeholder="Tax reserve, Payroll, Emergency..."></label>'+
        '<label>Scope<select id="vvPbSpaceScope"><option value="BUSINESS">Voxel Veda</option><option value="PERSONAL">Personal</option></select></label>'+
        '<label>Purpose<input id="vvPbSpacePurpose" maxlength="255" placeholder="What this money is reserved for"></label>'+
        '<label>Target amount<input id="vvPbSpaceTarget" inputmode="decimal" placeholder="10000"></label>'+
        '<label>Allocated now<input id="vvPbSpaceAllocated" inputmode="decimal" value="0"></label>'+
        '<label>Minimum reserve<input id="vvPbSpaceReserve" inputmode="decimal" value="0"></label>'+
        '<label>Currency<input id="vvPbSpaceCurrency" maxlength="3" value="AUD"></label>'+
        '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbSpaceDialog">Cancel</button><button class="primary" type="submit">Create Space</button></div></form>';
      document.body.appendChild(d); $('vvPbSpaceForm').addEventListener('submit',saveSpace);
    }
    if(!$('vvPbBeneficiaryDialog')){
      const d=document.createElement('dialog'); d.id='vvPbBeneficiaryDialog'; d.className='vv-pb-modal';
      d.innerHTML='<form id="vvPbBeneficiaryForm" class="vv-pb-modal-inner"><h3>Add beneficiary</h3><p>Store masked payment metadata and approval context. Voxel Veda will not store banking passwords or OTPs.</p>'+
        '<label>Name<input id="vvPbBenName" maxlength="180" required></label><label>Nickname<input id="vvPbBenNickname" maxlength="120"></label>'+
        '<label>Scope<select id="vvPbBenScope"><option value="BUSINESS">Voxel Veda</option><option value="PERSONAL">Personal</option></select></label>'+
        '<label>Bank<input id="vvPbBenBank" maxlength="180"></label><label>BSB (masked)<input id="vvPbBenBsb" maxlength="32" placeholder="06•-•••"></label>'+
        '<label>Account (masked)<input id="vvPbBenAccount" maxlength="64" placeholder="•••• 1234"></label><label>PayID (masked)<input id="vvPbBenPayid" maxlength="180"></label>'+
        '<label>Currency<input id="vvPbBenCurrency" maxlength="3" value="AUD"></label><label><input id="vvPbBenTrusted" type="checkbox"> Trusted beneficiary</label>'+
        '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbBeneficiaryDialog">Cancel</button><button class="primary" type="submit">Save beneficiary</button></div></form>';
      document.body.appendChild(d); $('vvPbBeneficiaryForm').addEventListener('submit',saveBeneficiary);
    }
    if(!$('vvPbPaymentDraftDialog')){
      const d=document.createElement('dialog'); d.id='vvPbPaymentDraftDialog'; d.className='vv-pb-modal';
      d.innerHTML='<form id="vvPbPaymentDraftForm" class="vv-pb-modal-inner"><h3>Prepare payment</h3><p>This creates an auditable payment workflow. External money movement remains disabled until a verified payment rail is connected.</p>'+
        '<label>From account<select id="vvPbPayAccount"><option value="">Not assigned</option></select></label>'+
        '<label>Scope<select id="vvPbPayScope"><option value="BUSINESS">Voxel Veda</option><option value="PERSONAL">Personal</option></select></label>'+
        '<label>Type<select id="vvPbPayType"><option value="EXTERNAL">External transfer</option><option value="BILL">Bill</option><option value="INTERNAL">Internal transfer</option><option value="PAYROLL">Payroll</option><option value="REIMBURSEMENT">Reimbursement</option><option value="REQUEST_MONEY">Request money</option></select></label>'+
        '<label>Payee<input id="vvPbPayPayee" maxlength="180" required></label><label>Reference<input id="vvPbPayReference" maxlength="180"></label>'+
        '<label>Amount<input id="vvPbPayAmount" inputmode="decimal" required></label><label>Currency<input id="vvPbPayCurrency" maxlength="3" value="AUD"></label>'+
        '<label>Due date<input id="vvPbPayDue" type="date"></label><label>Schedule<select id="vvPbPaySchedule"><option value="ONCE">Once</option><option value="WEEKLY">Weekly</option><option value="FORTNIGHTLY">Fortnightly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option></select></label>'+
        '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbPaymentDraftDialog">Cancel</button><button class="primary" type="submit">Create draft</button></div></form>';
      document.body.appendChild(d); $('vvPbPaymentDraftForm').addEventListener('submit',savePaymentDraft);
    }
    if(!$('vvPbAccessDialog')){
      const d=document.createElement('dialog'); d.id='vvPbAccessDialog'; d.className='vv-pb-modal';
      d.innerHTML='<form id="vvPbAccessForm" class="vv-pb-modal-inner"><h3>Banking account access</h3><p>Grant only the minimum access this user needs.</p>'+
        '<input id="vvPbAccessUser" type="hidden"><label>User<input id="vvPbAccessUserLabel" disabled></label>'+
        '<label>Business account<select id="vvPbAccessAccount"></select></label>'+
        '<label>Access<select id="vvPbAccessLevel"><option value="VIEW">View only</option><option value="PREPARE">Prepare payments</option><option value="APPROVE">Approve payments</option><option value="MANAGE">Manage account workflow</option></select></label>'+
        '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbAccessDialog">Cancel</button><button class="primary" type="submit">Save access</button></div></form>';
      document.body.appendChild(d); $('vvPbAccessForm').addEventListener('submit',saveTeamAccess);
    }
    if(!$('vvPbAlertDialog')){
      const d=document.createElement('dialog'); d.id='vvPbAlertDialog'; d.className='vv-pb-modal';
      d.innerHTML='<form id="vvPbAlertForm" class="vv-pb-modal-inner"><h3>Banking alerts</h3>'+
        '<label>Low balance threshold<input id="vvPbAlertLow" inputmode="decimal"></label><label>Large transaction threshold<input id="vvPbAlertLarge" inputmode="decimal"></label>'+
        '<label><input id="vvPbAlertBudget" type="checkbox" checked> Budget alerts</label><label><input id="vvPbAlertPayments" type="checkbox" checked> Payment workflow alerts</label>'+
        '<label><input id="vvPbAlertSync" type="checkbox" checked> Bank sync alerts</label><label><input id="vvPbAlertUnusual" type="checkbox" checked> Unusual activity alerts</label>'+
        '<div class="vv-pb-modal-actions"><button type="button" data-pb-close="vvPbAlertDialog">Cancel</button><button class="primary" type="submit">Save alerts</button></div></form>';
      document.body.appendChild(d); $('vvPbAlertForm').addEventListener('submit',saveAlerts);
    }
    if(!$('vvPbAccountDialog')){
      const d=document.createElement('dialog'); d.id='vvPbAccountDialog'; d.className='vv-pb-modal vv-pb-account-modal';
      d.innerHTML='<div class="vv-pb-modal-inner vv-pb-account-modal-inner"><div class="vv-pb-card-head"><div><h3 id="vvPbAccountTitle">Account</h3><span id="vvPbAccountSubtitle">Loading account intelligence…</span></div><button type="button" data-pb-close="vvPbAccountDialog">Close</button></div><div id="vvPbAccountBody"><div class="vv-pb-empty">Loading…</div></div></div>';
      document.body.appendChild(d);
    }
    document.addEventListener('click',(e)=>{
      const close=e.target.closest('[data-pb-close]'); if(close) document.getElementById(close.dataset.pbClose)?.close();
    });
  }

  function message(title,tone='info',detail=''){
    const node=$('vvPbMessage'); if(!node)return;
    node.hidden=!title; node.className='vv-pb-message '+tone;
    node.innerHTML=title?('<strong>'+esc(title)+'</strong>'+(detail?'<span>'+esc(detail)+'</span>':'')):'';
  }

  function selectedCurrency(){
    const currencies=(state.dashboard?.balances_by_currency||[]).map(x=>x.currency);
    if(currencies.includes(state.currency)) return state.currency;
    if(currencies.includes('AUD')) state.currency='AUD';
    else if(currencies.length) state.currency=currencies[0];
    return state.currency;
  }

  function flow(){
    const cur=selectedCurrency();
    return (state.dashboard?.flow_by_currency||[]).find(x=>x.currency===cur)||{currency:cur,money_in:0,money_out:0,net_flow:0,cash_out:0,transaction_count:0,unclassified:0};
  }

  function categories(){
    const cur=selectedCurrency();
    return (state.dashboard?.categories||[]).filter(x=>x.currency===cur);
  }

  function merchants(){
    const cur=selectedCurrency();
    return (state.dashboard?.merchants||[]).filter(x=>x.currency===cur).slice(0,12);
  }

  function monthly(){
    const cur=selectedCurrency();
    return (state.dashboard?.monthly||[]).filter(x=>x.currency===cur);
  }

  function accountBalance(a){
    const value=a.available_balance==null?a.current_ledger_balance:a.available_balance;
    return money(value,a.currency||'AUD');
  }

  function renderCurrencySelect(){
    const rows=state.dashboard?.balances_by_currency||[];
    if(rows.length<=1) return '';
    return '<select id="vvPbCurrency" class="vv-pb-select" aria-label="Analysis currency">'+rows.map(r=>'<option value="'+esc(r.currency)+'" '+(r.currency===state.currency?'selected':'')+'>'+esc(r.currency)+'</option>').join('')+'</select>';
  }

  function pieChart(rows,total,currency){
    const items=rows.filter(x=>Number(x.spent||0)>0).slice(0,7);
    const sum=items.reduce((s,x)=>s+Number(x.spent||0),0);
    if(!sum) return '<div class="vv-pb-empty"><strong>No spending yet</strong><span>Import or sync transactions to build your pie chart.</span></div>';
    let offset=0; const circles=[]; const legend=[];
    items.forEach((row,i)=>{
      const value=Number(row.spent||0); const share=value/sum*100; const color=palette[i%palette.length];
      circles.push('<circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="'+color+'" stroke-width="5.8" stroke-dasharray="'+share.toFixed(2)+' '+(100-share).toFixed(2)+'" stroke-dashoffset="'+(-offset).toFixed(2)+'"></circle>');
      legend.push('<div class="vv-pb-legend-row"><i class="vv-pb-dot" style="background:'+color+'"></i><span>'+esc(row.category)+'</span><b>'+money(value,currency)+'</b></div>');
      offset+=share;
    });
    return '<div class="vv-pb-donut-wrap"><div class="vv-pb-donut"><svg viewBox="0 0 42 42" role="img" aria-label="Spending pie chart">'+circles.join('')+'</svg><div class="vv-pb-donut-center"><span>Spent</span><strong>'+money(total,currency)+'</strong></div></div><div class="vv-pb-legend">'+legend.join('')+'</div></div>';
  }

  function barChart(rows,currency){
    const items=rows.filter(x=>Number(x.spent||0)>0).slice(0,10);
    const max=Math.max(1,...items.map(x=>Number(x.spent||0)));
    if(!items.length) return '<div class="vv-pb-empty">No category spending in this period.</div>';
    return '<div class="vv-pb-bar-list">'+items.map(row=>{
      const width=Math.max(2,Number(row.spent||0)/max*100);
      return '<div class="vv-pb-bar-row"><span>'+esc(row.category)+'</span><div class="vv-pb-bar-track"><i class="vv-pb-bar-fill" style="width:'+width.toFixed(1)+'%"></i></div><b>'+money(row.spent,currency)+'</b></div>';
    }).join('')+'</div>';
  }

  function lineChart(rows,currency){
    if(!rows.length) return '<div class="vv-pb-empty">No monthly history available.</div>';
    const width=680,height=220,pad=22;
    const max=Math.max(1,...rows.flatMap(r=>[Number(r.money_in||0),Number(r.money_out||0)]));
    const point=(value,index)=>{
      const x=pad+(rows.length===1?0:index*(width-pad*2)/(rows.length-1));
      const y=height-pad-(Number(value||0)/max)*(height-pad*2);
      return x.toFixed(1)+','+y.toFixed(1);
    };
    const inPoints=rows.map((r,i)=>point(r.money_in,i)).join(' ');
    const outPoints=rows.map((r,i)=>point(r.money_out,i)).join(' ');
    return '<div><svg class="vv-pb-line-svg" viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" role="img" aria-label="Monthly money in and money out trend">'+
      '<line x1="'+pad+'" y1="'+(height-pad)+'" x2="'+(width-pad)+'" y2="'+(height-pad)+'" stroke="#2b415a" stroke-width="1"></line>'+
      '<polyline points="'+inPoints+'" fill="none" stroke="#44d7a5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>'+
      '<polyline points="'+outPoints+'" fill="none" stroke="#67a8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>'+
      '</svg><div class="vv-pb-line-labels"><span>'+esc(monthLabel(rows[0].month))+'</span><span>● Money in &nbsp; ● Money out</span><span>'+esc(monthLabel(rows[rows.length-1].month))+'</span></div></div>';
  }

  function txRows(rows,limit=12){
    const list=(rows||[]).slice(0,limit);
    if(!list.length) return '<div class="vv-pb-empty"><strong>No transactions</strong><span>Sync a bank or import a statement.</span></div>';
    return '<div class="vv-pb-tx-list">'+list.map(t=>{
      const out=Number(t.debit||0)>0; const amount=out?Number(t.debit):Number(t.credit||0);
      const icon=(t.category==='Cash'?'$':t.is_internal_transfer?'↔':out?'−':'+');
      return '<article class="vv-pb-tx"><div class="vv-pb-tx-icon">'+icon+'</div><div><strong>'+esc(t.merchant_name||t.description||'Transaction')+'</strong><small>'+esc(day(t.transaction_date))+' · '+esc(t.category||'Unclassified')+' · '+esc(t.account_name||'Account')+(t.statement_name?' · '+esc(t.statement_name):'')+'</small><button type="button" data-pb-manage-tx="'+Number(t.id)+'">Manage</button></div><div class="vv-pb-tx-amount '+(out?'out':'in')+'">'+(out?'− ':'+ ')+money(amount,t.currency||state.currency)+'</div></article>';
    }).join('')+'</div>';
  }

  function commandMetrics(){
    const cur=selectedCurrency();
    return state.command?.summary_by_currency?.[cur]||{};
  }
  function commandAttention(){
    const rows=state.command?.attention||[];
    if(!rows.length) return '<div class="vv-pb-empty">No urgent banking attention items.</div>';
    return '<div class="vv-pb-recurring">'+rows.slice(0,8).map(a=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(String(a.code||'ATTENTION').replaceAll('_',' '))+'</strong><small>'+esc(a.message||'')+'</small></div><b>'+esc(a.severity||'INFO')+'</b></div>').join('')+'</div>';
  }
  function approvalPreview(){
    const rows=state.command?.approval_inbox||[];
    if(!rows.length) return '<div class="vv-pb-empty">No approvals waiting for you.</div>';
    return '<div class="vv-pb-recurring">'+rows.slice(0,6).map(p=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(p.payee_name)+'</strong><small>'+esc(p.account_name||'Account')+' · prepared by '+esc(p.created_by_name||'user')+' · '+esc(p.payment_type)+'</small></div><b>'+money(p.amount,p.currency)+'</b><div class="vv-pb-budget-actions"><button type="button" data-pb-approve-payment="'+esc(p.payment_uid)+'">Approve</button><button type="button" data-pb-reject-payment="'+esc(p.payment_uid)+'">Reject</button></div></div>').join('')+'</div>';
  }

  function renderHome(){
    const d=state.dashboard||{}; const cur=selectedCurrency(); const f=flow();
    const intel=(d.intelligence_by_currency||[]).find(x=>x.currency===cur)||{};
    const intelAlerts=Array.isArray(intel.alerts)?intel.alerts:[];
    const runway=intel.cash_runway_months==null?'Not enough history':(Number(intel.cash_runway_months).toFixed(1)+' months');
    const bankFeed=state.status?.configured
      ? ((state.status?.connection_summary?.active||0)>0?'Connected & syncing':'Provider ready · connect your bank')
      : 'Provider credential missing';
    const bal=(d.balances_by_currency||[]).find(x=>x.currency===cur)||{balance:0,account_count:0};
    const accounts=(d.accounts||[]).filter(a=>a.currency===cur);
    const cats=categories();
    const content=
      '<div class="vv-pb-toolbar"><div><h3>Banking home</h3><span style="color:#8fa4bb">Balances, cash flow and recent activity</span></div>'+renderCurrencySelect()+'</div>'+
      (()=>{const m=commandMetrics();const o=state.command?.obligations||{};return '<section class="vv-pb-command"><div class="vv-pb-command-head"><div><span class="vv-pb-command-label">COMMAND CENTRE</span><h3>'+esc((state.command?.role_view?.mode||'BANKING').replaceAll('_',' '))+'</h3><small>Liquidity, obligations and approvals for your access level</small></div><button type="button" class="vv-pb-select" data-pb-action="calendar">90-day cash flow</button></div><div class="vv-pb-kpis"><div class="vv-pb-kpi"><span>Projected liquidity · 30d</span><b>'+money(m.projected_liquidity_30d||0,cur)+'</b></div><div class="vv-pb-kpi"><span>Cash runway</span><b>'+(m.runway_days==null?'—':Number(m.runway_days)+' days')+'</b></div><div class="vv-pb-kpi"><span>Due next 30d</span><b>'+money(m.due_next_30d||0,cur)+'</b></div><div class="vv-pb-kpi"><span>Pending obligations</span><b>'+money(m.pending_obligations||0,cur)+'</b></div><div class="vv-pb-kpi"><span>Approvals waiting</span><b>'+Number((state.command?.approval_inbox||[]).length)+'</b></div><div class="vv-pb-kpi"><span>Overdue</span><b>'+Number(o.overdue||0)+'</b></div></div><div class="vv-pb-command-grid"><section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Needs attention</h3><span>Risk & operations</span></div>'+commandAttention()+'</section><section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Approval inbox</h3><button type="button" class="vv-pb-select" data-pb-tab="pay">Open Pay</button></div>'+approvalPreview()+'</section></div></section>';})()+
      '<div class="vv-pb-balance-grid">'+
        '<article class="vv-pb-balance"><span>Total visible balance · '+esc(cur)+'</span><strong>'+money(bal.balance,cur)+'</strong><small>'+Number(bal.account_count||0)+' active account(s)</small></article>'+
        '<article class="vv-pb-balance"><span>Money in · selected period</span><strong>'+money(f.money_in,cur)+'</strong><small>'+Number(f.transaction_count||0)+' transaction(s)</small></article>'+
        '<article class="vv-pb-balance"><span>Money out · selected period</span><strong>'+money(f.money_out,cur)+'</strong><small>Cash '+money(f.cash_out,cur)+' · '+Number(f.unclassified||0)+' uncategorised</small></article>'+
      '</div>'+
      '<section class="vv-pb-card" style="margin-top:13px"><div class="vv-pb-card-head"><div><h3>Finance Intelligence</h3><span>Explainable signals from your real transaction history</span></div><span>'+esc(intel.confidence||'LOW')+' confidence</span></div>'+
        '<div class="vv-pb-kpis">'+
          '<div class="vv-pb-kpi"><span>Avg monthly income</span><b class="in">'+money(intel.average_monthly_income||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Avg monthly spend</span><b class="out">'+money(intel.average_monthly_spend||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Free cash flow / month</span><b>'+money(intel.monthly_free_cash_flow||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Cash runway</span><b>'+esc(runway)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Recurring estimate / month</span><b>'+money(intel.recurring_monthly_estimate||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>7-day safe-to-spend</span><b>'+money(intel.safe_to_spend_7d||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>30-day forecast</span><b>'+money(intel.forecast_30d||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>90-day forecast</span><b>'+money(intel.forecast_90d||0,cur)+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Savings rate</span><b>'+(intel.savings_rate_percent==null?'—':pct(intel.savings_rate_percent))+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Recurring load</span><b>'+(intel.subscription_load_percent==null?'—':pct(intel.subscription_load_percent))+'</b></div>'+
          '<div class="vv-pb-kpi"><span>Open Banking feed</span><b>'+esc(bankFeed)+'</b></div>'+
        '</div>'+
        (intelAlerts.length?'<div class="vv-pb-recurring" style="margin-top:12px">'+intelAlerts.map(a=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(a.code.replaceAll('_',' '))+'</strong><small>'+esc(a.message)+'</small></div><b>'+esc(a.severity)+'</b></div>').join('')+'</div>':'<div class="vv-pb-empty" style="margin-top:10px">No material finance alerts from the available history.</div>')+
      '</section>'+
      '<div class="vv-pb-two">'+
        '<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Accounts</h3><button type="button" class="vv-pb-select" data-pb-action="upload">Import statement</button></div>'+
          (accounts.length?'<div class="vv-pb-account-strip">'+accounts.map(a=>'<article class="vv-pb-account"><small>'+esc(a.institution||'Bank')+' · '+esc(a.account_type||'Account')+'</small><h4>'+esc(a.nickname||'Account')+'</h4><span>'+esc(a.account_number_masked||'Number masked')+'</span><div class="amount">'+accountBalance(a)+'</div><small>'+esc(a.ownership_scope||'')+' · '+esc(a.connection_status||a.connection_type||'Manual')+'</small><div class="vv-pb-account-actions"><button type="button" data-pb-account-detail="'+Number(a.id)+'">Open account</button><button type="button" data-pb-account-activity="'+Number(a.id)+'">Transactions</button><button type="button" data-pb-account-statement="'+Number(a.id)+'">Statement</button></div></article>').join('')+'</div>':'<div class="vv-pb-empty">No active accounts in this view.</div>')+
        '</section>'+
        '<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Spending by category</h3><button type="button" data-pb-tab="insights" class="vv-pb-select">Open insights</button></div>'+pieChart(cats,f.money_out,cur)+'</section>'+
      '</div>'+
      '<section class="vv-pb-card" style="margin-top:13px"><div class="vv-pb-card-head"><h3>Recent activity</h3><button type="button" data-pb-tab="activity" class="vv-pb-select">See all</button></div>'+txRows(d.recent_transactions,8)+'</section>';
    $('vvPbContent').innerHTML=content;
    wireDynamic();
  }

  async function loadActivity(){
    const params=new URLSearchParams({scope:state.scope,limit:'120'});
    if(state.activityQuery) params.set('q',state.activityQuery);
    if(state.activityCategory) params.set('category',state.activityCategory);
    if(state.activityAccount) params.set('account_id',state.activityAccount);
    const result=await api(FIN+'/transactions?'+params.toString());
    state.activity=result.transactions||[];
  }

  function renderActivity(){
    const d=state.dashboard||{}; const cats=[...new Set((d.categories||[]).map(x=>x.category))].sort();
    $('vvPbContent').innerHTML=
      '<div class="vv-pb-toolbar"><div><h3>Activity</h3><span style="color:#8fa4bb">Search and manage transactions</span></div></div>'+
      '<div class="vv-pb-toolbar"><input id="vvPbActivitySearch" class="vv-pb-search" type="search" value="'+esc(state.activityQuery)+'" placeholder="Search merchant, description, amount source...">'+
      '<select id="vvPbActivityCategory" class="vv-pb-select"><option value="">All categories</option>'+cats.map(c=>'<option value="'+esc(c)+'" '+(c===state.activityCategory?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select>'+
      '<select id="vvPbActivityAccount" class="vv-pb-select"><option value="">All accounts</option>'+(d.accounts||[]).map(a=>'<option value="'+Number(a.id)+'" '+(String(a.id)===String(state.activityAccount)?'selected':'')+'>'+esc(a.nickname)+'</option>').join('')+'</select>'+
      '<button id="vvPbActivityGo" type="button" class="vv-pb-select">Search</button></div>'+
      txRows(state.activity,120);
    wireDynamic();
    $('vvPbActivityGo')?.addEventListener('click',async()=>{state.activityQuery=$('vvPbActivitySearch').value.trim();state.activityCategory=$('vvPbActivityCategory').value;state.activityAccount=$('vvPbActivityAccount').value;await loadActivity();renderActivity();});
    $('vvPbActivitySearch')?.addEventListener('keydown',(e)=>{if(e.key==='Enter')$('vvPbActivityGo')?.click();});
  }

  function renderInsights(){
    const cur=selectedCurrency(); const f=flow(); const cats=categories(); const merch=merchants(); const months=monthly();
    let chart='';
    if(state.chart==='pie') chart=pieChart(cats,f.money_out,cur);
    else if(state.chart==='bar') chart=barChart(cats,cur);
    else chart=lineChart(months,cur);
    $('vvPbContent').innerHTML=
      '<div class="vv-pb-toolbar"><div><h3>Insights</h3><span style="color:#8fa4bb">Understand where, when and how your money moves</span></div>'+renderCurrencySelect()+'</div>'+
      '<div class="vv-pb-toolbar"><div class="vv-pb-range">'+['1M','3M','6M','12M','ALL'].map(r=>'<button type="button" class="'+(r===state.range?'active':'')+'" data-pb-range="'+r+'">'+(r==='ALL'?'All time':r)+'</button>').join('')+'</div><div class="vv-pb-chart-switch"><button type="button" class="'+(state.chart==='pie'?'active':'')+'" data-pb-chart="pie">Pie</button><button type="button" class="'+(state.chart==='bar'?'active':'')+'" data-pb-chart="bar">Bar</button><button type="button" class="'+(state.chart==='line'?'active':'')+'" data-pb-chart="line">Line</button></div></div>'+
      '<div class="vv-pb-kpis">'+
        '<div class="vv-pb-kpi"><span>Money in</span><b class="in">'+money(f.money_in,cur)+'</b></div>'+
        '<div class="vv-pb-kpi"><span>Money out</span><b class="out">'+money(f.money_out,cur)+'</b></div>'+
        '<div class="vv-pb-kpi"><span>Net cash flow</span><b>'+money(f.net_flow,cur)+'</b></div>'+
        '<div class="vv-pb-kpi"><span>Cash / ATM</span><b>'+money(f.cash_out,cur)+'</b></div>'+
      '</div>'+
      '<section class="vv-pb-card vv-pb-chart" style="margin-top:12px">'+chart+'</section>'+
      (()=>{const intel=(state.dashboard?.intelligence_by_currency||[]).find(x=>x.currency===cur)||{};return '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-card-head"><h3>Forward view</h3><span>'+esc(intel.confidence||'LOW')+' confidence</span></div><div class="vv-pb-kpis"><div class="vv-pb-kpi"><span>30 days</span><b>'+money(intel.forecast_30d||0,cur)+'</b></div><div class="vv-pb-kpi"><span>60 days</span><b>'+money(intel.forecast_60d||0,cur)+'</b></div><div class="vv-pb-kpi"><span>90 days</span><b>'+money(intel.forecast_90d||0,cur)+'</b></div><div class="vv-pb-kpi"><span>Spend volatility</span><b>'+(intel.spend_volatility_percent==null?'—':pct(intel.spend_volatility_percent))+'</b></div></div></section>';})()+
      '<div class="vv-pb-two">'+
        '<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Top merchants</h3><span>'+esc(cur)+'</span></div><div class="vv-pb-merchant-grid">'+(merch.length?merch.map(m=>'<div class="vv-pb-merchant"><div><strong>'+esc(m.merchant)+'</strong><small>'+Number(m.transaction_count||0)+' transaction(s)</small></div><b>'+money(m.spent,cur)+'</b></div>').join(''):'<div class="vv-pb-empty">No merchant data.</div>')+'</div></section>'+
        '<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Categories</h3><span>'+cats.length+' categories</span></div>'+barChart(cats,cur)+'</section>'+
      '</div>';
    wireDynamic();
  }

  function budgetCards(){
    const cur=selectedCurrency();
    const rows=(state.budgets||[]).filter(b=>(b.currency===cur)&& (state.scope==='ALL'||b.ownership_scope===state.scope||b.ownership_scope==='ALL'));
    if(!rows.length) return '<div class="vv-pb-empty"><strong>No banking budgets yet</strong><span>Create a category budget to track imported bank spending.</span><button type="button" data-pb-action="budget">Create budget</button></div>';
    return '<div class="vv-pb-budget-grid">'+rows.map(b=>{
      const used=Math.max(0,Number(b.used_percent||0)); const width=Math.min(100,used);
      return '<article class="vv-pb-budget"><div class="vv-pb-budget-head"><div><strong>'+esc(b.category)+'</strong><small>'+esc(b.ownership_scope)+' · '+esc(b.cycle)+'</small></div><b>'+pct(used)+'</b></div><div class="vv-pb-progress"><i class="'+(used>100?'over':'')+'" style="width:'+width+'%"></i></div><small>'+money(b.spent_amount,b.currency)+' spent of '+money(b.limit_amount,b.currency)+' · '+money(b.remaining_amount,b.currency)+' remaining</small><div class="vv-pb-budget-actions"><button type="button" data-pb-edit-budget="'+esc(b.budget_uid)+'">Edit</button><button type="button" data-pb-delete-budget="'+esc(b.budget_uid)+'">Remove</button></div></article>';
    }).join('')+'</div>';
  }

  function recurringRows(){
    const cur=selectedCurrency();
    const personal=(state.attention?.recurring||[]).filter(r=>r.currency===cur);
    const detected=(state.dashboard?.detected_recurring||[]).filter(r=>r.currency===cur);
    const rows=[];
    personal.forEach(r=>rows.push({name:r.name,amount:Number(r.amount||0),frequency:r.frequency,next:r.next_due_date,source:'Scheduled'}));
    detected.forEach(r=>rows.push({name:r.merchant||r.merchant_normalized,amount:Number(r.typical_amount||0),frequency:r.recurring_frequency,next:null,source:'Detected pattern'}));
    const dedupe=[]; const seen=new Set();
    rows.forEach(r=>{const key=String(r.name).toUpperCase()+'|'+r.frequency;if(!seen.has(key)){seen.add(key);dedupe.push(r);}});
    if(!dedupe.length) return '<div class="vv-pb-empty">No recurring payments detected or scheduled yet.</div>';
    return '<div class="vv-pb-recurring">'+dedupe.slice(0,20).map(r=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(r.name)+'</strong><small>'+esc(r.source)+' · '+esc(r.frequency)+(r.next?' · due '+esc(day(r.next)):'')+'</small></div><b>'+money(r.amount,cur)+'</b><button type="button" class="vv-pb-select" data-pb-search-merchant="'+esc(r.name)+'">View</button></div>').join('')+'</div>';
  }

  function capabilityBadge(flag,onLabel='Available',offLabel='Provider required'){
    return '<span class="vv-pb-status '+(flag?'healthy':'setup')+'">'+esc(flag?onLabel:offLabel)+'</span>';
  }

  function paymentRows(){
    const rows=state.os?.payments||[];
    if(!rows.length) return '<div class="vv-pb-empty"><strong>No payment workflows</strong><span>Create a draft for a bill, transfer, reimbursement or payment request.</span></div>';
    return '<div class="vv-pb-recurring">'+rows.slice(0,80).map(p=>{
      const mine=Number(p.created_by)===Number(state.os?.current_user_id||-1);
      const approve=(state.os?.access?.can_approve && p.status==='PENDING_APPROVAL' && !mine);
      return '<div class="vv-pb-recurring-row"><div><strong>'+esc(p.payee_name)+'</strong><small>'+esc(p.payment_type)+' · '+esc(p.status)+' · '+esc(p.schedule_type)+(p.due_date?' · due '+esc(day(p.due_date)):'')+' · prepared by '+esc(p.created_by_name||'user')+'</small></div><b>'+money(p.amount,p.currency)+'</b><div class="vv-pb-budget-actions">'+
        (p.status==='DRAFT'?'<button type="button" data-pb-submit-payment="'+esc(p.payment_uid)+'">Submit</button>':'')+
        (!['COMPLETED','REJECTED','CANCELLED'].includes(p.status)?'<button type="button" data-pb-cancel-payment="'+esc(p.payment_uid)+'">Cancel</button>':'')+
        (approve?'<button type="button" data-pb-approve-payment="'+esc(p.payment_uid)+'">Approve</button><button type="button" data-pb-reject-payment="'+esc(p.payment_uid)+'">Reject</button>':'')+
        '</div></div>';
    }).join('')+'</div>';
  }

  function renderPay(){
    const caps=state.os?.capabilities||{}; const intel=state.os?.operating_intelligence||{};
    $('vvPbContent').innerHTML=
      '<div class="vv-pb-toolbar"><div><h3>Pay & Transfer</h3><span style="color:#8fa4bb">Prepare, approve, schedule and track money movement</span></div><div><button class="vv-pb-select" type="button" data-pb-action="new-payment">＋ Payment</button> <button class="vv-pb-select" type="button" data-pb-action="beneficiary">＋ Beneficiary</button></div></div>'+
      '<div class="vv-pb-kpis"><div class="vv-pb-kpi"><span>Pending approvals</span><b>'+Number(intel.pending_approvals||0)+'</b></div><div class="vv-pb-kpi"><span>Ready for execution</span><b>'+Number(intel.ready_for_execution||0)+'</b></div><div class="vv-pb-kpi"><span>Overdue</span><b>'+Number(intel.overdue||0)+'</b></div><div class="vv-pb-kpi"><span>External payment rail</span><b>'+ (caps.payment_rails?.external_transfer?'Enabled':'Not connected') +'</b></div></div>'+
      '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-card-head"><div><h3>Payment workflow</h3><span>Maker-checker controls and scheduled obligations</span></div>'+capabilityBadge(caps.payment_rails?.external_transfer,'Execution enabled','Workflow only')+'</div>'+paymentRows()+'</section>'+
      '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-card-head"><h3>Beneficiaries</h3><button type="button" class="vv-pb-select" data-pb-action="beneficiary">Add</button></div><div class="vv-pb-merchant-grid">'+
      ((state.os?.beneficiaries||[]).length?(state.os.beneficiaries.map(b=>'<div class="vv-pb-merchant"><div><strong>'+esc(b.nickname||b.name)+'</strong><small>'+esc(b.bank_name||'Bank')+' · '+esc(b.account_masked||b.payid_masked||'masked details')+' · '+esc(b.currency)+'</small></div><b>'+(b.trusted?'Trusted':'Standard')+'</b></div>').join('')):'<div class="vv-pb-empty">No saved beneficiaries.</div>')+
      '</div></section>'+
      '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-card-head"><h3>Provider capabilities</h3><span>Actions appear only when technically available</span></div><div class="vv-pb-kpis">'+
      '<div class="vv-pb-kpi"><span>Open Banking read/sync</span><b>'+(caps.open_banking?.configured?'Configured':'Credential missing')+'</b></div>'+
      '<div class="vv-pb-kpi"><span>PayID / BPAY</span><b>'+(caps.payment_rails?.payid||caps.payment_rails?.bpay?'Enabled':'Provider required')+'</b></div>'+
      '<div class="vv-pb-kpi"><span>Cards</span><b>'+(caps.payment_rails?.card_issuing?'Enabled':'Provider required')+'</b></div>'+
      '<div class="vv-pb-kpi"><span>International transfer</span><b>'+(caps.payment_rails?.international_transfer?'Enabled':'Provider required')+'</b></div></div></section>';
    wireDynamic();
  }

  function spaceRows(){
    const rows=state.os?.spaces||[];
    if(!rows.length) return '<div class="vv-pb-empty"><strong>No Money Spaces</strong><span>Create reserves for tax, payroll, emergency cash, equipment or personal goals.</span><button type="button" data-pb-action="space">Create Space</button></div>';
    return '<div class="vv-pb-budget-grid">'+rows.map(s=>{
      const target=Number(s.target_amount||0); const allocated=Number(s.allocated_amount||0); const used=target>0?Math.min(100,allocated/target*100):0;
      return '<article class="vv-pb-budget"><div class="vv-pb-budget-head"><div><strong>'+esc(s.name)+'</strong><small>'+esc(s.ownership_scope)+' · '+esc(s.purpose||'Allocation')+'</small></div><b>'+money(allocated,s.currency)+'</b></div><div class="vv-pb-progress"><i style="width:'+used.toFixed(1)+'%"></i></div><small>'+(target?money(target,s.currency)+' target · ':'')+money(s.minimum_reserve,s.currency)+' minimum reserve</small><div class="vv-pb-budget-actions"><button type="button" data-pb-archive-space="'+esc(s.space_uid)+'">Archive</button></div></article>';
    }).join('')+'</div>';
  }

  function renderCalendar(){
    const events=state.calendar?.events||[];
    const grouped={};
    events.forEach(e=>{(grouped[e.date]||(grouped[e.date]=[])).push(e);});
    const dates=Object.keys(grouped).sort();
    $('vvPbContent').innerHTML=
      '<div class="vv-pb-toolbar"><div><h3>90-day cash-flow calendar</h3><span style="color:#8fa4bb">Upcoming obligations, scheduled payments and approval-dependent outflows</span></div><button type="button" class="vv-pb-select" data-pb-action="new-payment">＋ Schedule payment</button></div>'+
      '<div class="vv-pb-kpis"><div class="vv-pb-kpi"><span>Calendar items</span><b>'+events.length+'</b></div><div class="vv-pb-kpi"><span>Due in 7 days</span><b>'+Number(state.command?.obligations?.due_7d||0)+'</b></div><div class="vv-pb-kpi"><span>Due in 30 days</span><b>'+Number(state.command?.obligations?.due_30d||0)+'</b></div><div class="vv-pb-kpi"><span>Overdue now</span><b>'+Number(state.command?.obligations?.overdue||0)+'</b></div></div>'+
      '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-calendar">'+
      (dates.length?dates.map(date=>'<div class="vv-pb-calendar-day"><div class="vv-pb-calendar-date"><strong>'+esc(date)+'</strong><span>'+grouped[date].length+' item(s)</span></div><div class="vv-pb-calendar-events">'+grouped[date].map(e=>'<div class="vv-pb-calendar-event"><div><strong>'+esc(e.title)+'</strong><small>'+esc(e.status)+' · '+esc(e.schedule_type)+(e.account_name?' · '+esc(e.account_name):'')+'</small></div><b>'+money(e.amount,e.currency)+'</b></div>').join('')+'</div></div>').join(''):'<div class="vv-pb-empty"><strong>No scheduled obligations in this window.</strong><span>Create payment drafts with due dates to build your cash-flow calendar.</span></div>')+
      '</div></section>';
    wireDynamic();
  }

  async function openAccountDetail(id){
    const dialog=$('vvPbAccountDialog'); const body=$('vvPbAccountBody');
    $('vvPbAccountTitle').textContent='Account intelligence'; $('vvPbAccountSubtitle').textContent='Loading account data…';
    body.innerHTML='<div class="vv-pb-empty">Loading account intelligence…</div>'; dialog.showModal();
    try{
      const data=await api(OS+'/accounts/'+encodeURIComponent(id));
      const a=data.account||{}; const m=data.metrics||{};
      $('vvPbAccountTitle').textContent=a.nickname||'Account';
      $('vvPbAccountSubtitle').textContent=(a.institution||'Bank')+' · '+(a.account_number_masked||'Masked account')+' · '+(a.ownership_scope||'');
      body.innerHTML='<div class="vv-pb-kpis"><div class="vv-pb-kpi"><span>Available balance</span><b>'+money(m.balance,a.currency||'AUD')+'</b></div><div class="vv-pb-kpi"><span>90d money in</span><b class="in">'+money(m.income_90d,a.currency||'AUD')+'</b></div><div class="vv-pb-kpi"><span>90d money out</span><b class="out">'+money(m.spend_90d,a.currency||'AUD')+'</b></div><div class="vv-pb-kpi"><span>90d net</span><b>'+money(m.net_90d,a.currency||'AUD')+'</b></div><div class="vv-pb-kpi"><span>Daily spend</span><b>'+money(m.average_daily_spend,a.currency||'AUD')+'</b></div><div class="vv-pb-kpi"><span>Runway</span><b>'+(m.runway_days==null?'—':m.runway_days+' days')+'</b></div></div>'+
        '<div class="vv-pb-two" style="margin-top:12px"><section class="vv-pb-card"><div class="vv-pb-card-head"><h3>12-month cash flow</h3><span>'+esc(a.currency||'AUD')+'</span></div>'+lineChart(data.monthly||[],a.currency||'AUD')+'</section><section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Top spending categories</h3><span>90 days</span></div>'+barChart(data.categories||[],a.currency||'AUD')+'</section></div>'+
        '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-card-head"><h3>Payment workflows</h3><span>'+(data.payments||[]).length+' linked</span></div>'+((data.payments||[]).length?'<div class="vv-pb-recurring">'+data.payments.slice(0,15).map(p=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(p.payee_name)+'</strong><small>'+esc(p.status)+' · '+esc(p.schedule_type)+(p.due_date?' · due '+esc(day(p.due_date)):'')+'</small></div><b>'+money(p.amount,p.currency)+'</b></div>').join('')+'</div>':'<div class="vv-pb-empty">No linked payment workflows.</div>')+'</section>'+
        '<section class="vv-pb-card" style="margin-top:12px"><div class="vv-pb-card-head"><h3>Recent transactions</h3><button type="button" class="vv-pb-select" data-pb-account-activity="'+Number(a.id)+'">Open full activity</button></div>'+txRows((data.transactions||[]).map(t=>({...t,account_name:a.nickname})),25)+'</section>';
      wireDynamic();
    }catch(err){body.innerHTML='<div class="vv-pb-empty"><strong>Account detail could not load.</strong><span>'+esc(err.message)+'</span></div>';}
  }

  function renderTeam(){
    const team=state.team||{}; const os=state.os||{};
    if(!team.can_manage){
      $('vvPbContent').innerHTML='<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Team banking access</h3></div><div class="vv-pb-empty"><strong>Your banking access is scoped to your role and assigned accounts.</strong><span>Only authorised banking administrators can change another user’s access.</span></div></section>';
      return;
    }
    const grantMap=new Map((team.grants||[]).map(g=>[String(g.user_id)+'|'+String(g.bank_account_id),g]));
    const businessAccounts=(os.accounts||[]).filter(a=>a.ownership_scope==='BUSINESS');
    $('vvPbContent').innerHTML='<div class="vv-pb-toolbar"><div><h3>Team banking</h3><span style="color:#8fa4bb">Account-level least-privilege access</span></div></div>'+
      '<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Users</h3><span>View · Prepare · Approve · Manage</span></div><div class="vv-pb-recurring">'+
      ((team.users||[]).map(u=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(u.name||u.email)+'</strong><small>'+esc(u.email)+' · '+esc(u.role)+(u.department?' · '+esc(u.department):'')+'</small></div><div>'+businessAccounts.map(a=>{const g=grantMap.get(String(u.id)+'|'+String(a.id));return '<button type="button" class="vv-pb-select" data-pb-grant-user="'+Number(u.id)+'" data-pb-grant-account="'+Number(a.id)+'" data-pb-grant-level="'+esc(g?.access_level||'VIEW')+'" data-pb-grant-label="'+esc((u.name||u.email)+' · '+a.nickname)+'">'+esc(a.nickname)+': '+esc(g?.access_level||'Set access')+'</button>';}).join(' ')+'</div></div>').join('')||'<div class="vv-pb-empty">No active users.</div>')+
      '</div></section>';
    wireDynamic();
  }

  async function saveSpace(e){e.preventDefault();try{await api(OS+'/spaces',{method:'POST',body:JSON.stringify({name:$('vvPbSpaceName').value,ownership_scope:$('vvPbSpaceScope').value,purpose:$('vvPbSpacePurpose').value,target_amount:$('vvPbSpaceTarget').value,allocated_amount:$('vvPbSpaceAllocated').value,minimum_reserve:$('vvPbSpaceReserve').value,currency:$('vvPbSpaceCurrency').value})});$('vvPbSpaceDialog').close();message('Money Space created.','success');await refresh();state.tab='plan';render();}catch(err){message('Space could not be created.','error',err.message);}}
  async function saveBeneficiary(e){e.preventDefault();try{await api(OS+'/beneficiaries',{method:'POST',body:JSON.stringify({name:$('vvPbBenName').value,nickname:$('vvPbBenNickname').value,ownership_scope:$('vvPbBenScope').value,bank_name:$('vvPbBenBank').value,bsb_masked:$('vvPbBenBsb').value,account_masked:$('vvPbBenAccount').value,payid_masked:$('vvPbBenPayid').value,currency:$('vvPbBenCurrency').value,trusted:$('vvPbBenTrusted').checked})});$('vvPbBeneficiaryDialog').close();message('Beneficiary saved.','success');await refresh();state.tab='pay';render();}catch(err){message('Beneficiary could not be saved.','error',err.message);}}
  function openPaymentDraft(){const select=$('vvPbPayAccount');select.innerHTML='<option value="">Not assigned</option>'+(state.os?.accounts||[]).map(a=>'<option value="'+Number(a.id)+'">'+esc(a.nickname)+' · '+esc(a.currency)+'</option>').join('');$('vvPbPayCurrency').value=selectedCurrency();$('vvPbPaymentDraftDialog').showModal();}
  async function savePaymentDraft(e){e.preventDefault();try{const result=await api(OS+'/payments',{method:'POST',body:JSON.stringify({bank_account_id:$('vvPbPayAccount').value||null,ownership_scope:$('vvPbPayScope').value,payment_type:$('vvPbPayType').value,payee_name:$('vvPbPayPayee').value,reference_text:$('vvPbPayReference').value,amount:$('vvPbPayAmount').value,currency:$('vvPbPayCurrency').value,due_date:$('vvPbPayDue').value||null,schedule_type:$('vvPbPaySchedule').value})});$('vvPbPaymentDraftDialog').close();message(result.message,'success');await refresh();state.tab='pay';render();}catch(err){message('Payment draft could not be created.','error',err.message);}}
  async function submitPayment(uid){try{const r=await api(OS+'/payments/'+encodeURIComponent(uid)+'/submit',{method:'POST',body:'{}'});message(r.message,'success');await refresh();state.tab='pay';render();}catch(err){message('Payment could not be submitted.','error',err.message);}}
  async function cancelPayment(uid){if(!confirm('Cancel this payment workflow?'))return;try{const r=await api(OS+'/payments/'+encodeURIComponent(uid)+'/cancel',{method:'POST',body:'{}'});message(r.message,'success');await refresh();state.tab='pay';render();}catch(err){message('Payment could not be cancelled.','error',err.message);}}
  async function archiveSpace(uid){if(!confirm('Archive this Money Space?'))return;try{const r=await api(OS+'/spaces/'+encodeURIComponent(uid)+'/archive',{method:'POST',body:'{}'});message(r.message,'success');await refresh();state.tab='plan';render();}catch(err){message('Space could not be archived.','error',err.message);}}
  async function decidePayment(uid,decision){const note=prompt(decision==='APPROVE'?'Approval note (optional)':'Reason for rejection');if(decision==='REJECT'&&!note)return;try{const r=await api(OS+'/payments/'+encodeURIComponent(uid)+'/decision',{method:'POST',body:JSON.stringify({decision,note:note||''})});message(r.message,'success');await refresh();state.tab='pay';render();}catch(err){message('Decision could not be recorded.','error',err.message);}}
  function openTeamAccess(userId,accountId,level,label){$('vvPbAccessUser').value=userId;$('vvPbAccessUserLabel').value=label;$('vvPbAccessAccount').innerHTML=(state.os?.accounts||[]).filter(a=>a.ownership_scope==='BUSINESS').map(a=>'<option value="'+a.id+'" '+(String(a.id)===String(accountId)?'selected':'')+'>'+esc(a.nickname)+'</option>').join('');$('vvPbAccessLevel').value=level||'VIEW';$('vvPbAccessDialog').showModal();}
  async function saveTeamAccess(e){e.preventDefault();try{const r=await api(OS+'/team/'+encodeURIComponent($('vvPbAccessUser').value)+'/access',{method:'POST',body:JSON.stringify({bank_account_id:$('vvPbAccessAccount').value,access_level:$('vvPbAccessLevel').value})});$('vvPbAccessDialog').close();message(r.message,'success');await refresh();state.tab='team';render();}catch(err){message('Access could not be updated.','error',err.message);}}
  function openAlerts(){const a=state.os?.alerts||{};$('vvPbAlertLow').value=a.low_balance_threshold??'';$('vvPbAlertLarge').value=a.large_transaction_threshold??'';$('vvPbAlertBudget').checked=Boolean(Number(a.notify_budget??1));$('vvPbAlertPayments').checked=Boolean(Number(a.notify_payments??1));$('vvPbAlertSync').checked=Boolean(Number(a.notify_bank_sync??1));$('vvPbAlertUnusual').checked=Boolean(Number(a.notify_unusual_activity??1));$('vvPbAlertDialog').showModal();}
  async function saveAlerts(e){e.preventDefault();try{const r=await api(OS+'/alerts',{method:'POST',body:JSON.stringify({low_balance_threshold:$('vvPbAlertLow').value,large_transaction_threshold:$('vvPbAlertLarge').value,notify_budget:$('vvPbAlertBudget').checked,notify_payments:$('vvPbAlertPayments').checked,notify_bank_sync:$('vvPbAlertSync').checked,notify_unusual_activity:$('vvPbAlertUnusual').checked})});$('vvPbAlertDialog').close();message(r.message,'success');await refresh();}catch(err){message('Alerts could not be saved.','error',err.message);}}

  function renderPlan(){
    $('vvPbContent').innerHTML=
      '<div class="vv-pb-toolbar"><div><h3>Plan</h3><span style="color:#8fa4bb">Budgets, recurring payments and upcoming obligations</span></div><div><button type="button" class="vv-pb-select" data-pb-action="budget">＋ Budget</button></div></div>'+
      '<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Money Spaces</h3><button type="button" class="vv-pb-select" data-pb-action="space">＋ Space</button></div>'+spaceRows()+'</section>'+'<section class="vv-pb-card" style="margin-top:13px"><div class="vv-pb-card-head"><h3>Category budgets</h3><span>Bank-connected spending</span></div>'+budgetCards()+'</section>'+
      '<section class="vv-pb-card" style="margin-top:13px"><div class="vv-pb-card-head"><h3>Bills & recurring</h3><span>Scheduled + detected</span></div>'+recurringRows()+'</section>'+
      ((state.attention?.goals||[]).length?'<section class="vv-pb-card" style="margin-top:13px"><div class="vv-pb-card-head"><h3>Savings goals</h3><span>Personal Money</span></div><div class="vv-pb-budget-grid">'+state.attention.goals.filter(g=>g.status==='ACTIVE').slice(0,8).map(g=>'<article class="vv-pb-budget"><div class="vv-pb-budget-head"><strong>'+esc(g.name)+'</strong><b>'+pct(g.progress_percent)+'</b></div><div class="vv-pb-progress"><i style="width:'+Math.min(100,Number(g.progress_percent||0))+'%"></i></div><small>'+money(g.current_amount,g.currency)+' of '+money(g.target_amount,g.currency)+'</small></article>').join('')+'</div></section>':'');
    wireDynamic();
  }

  function renderMore(){
    const q=state.quality||{};
    $('vvPbContent').innerHTML=
      '<div class="vv-pb-toolbar"><div><h3>More banking tools</h3><span style="color:#8fa4bb">Statements, reports, privacy and data quality</span></div></div>'+
      '<div class="vv-pb-more-grid">'+
        '<article class="vv-pb-more-item"><h4>Statements & reports</h4><p>Open imported statements, transaction-source history, CSV exports and printable reports.</p><button type="button" data-pb-action="statements">Open statements</button></article>'+
        '<article class="vv-pb-more-item"><h4>Spending report</h4><p>Generate detailed category, merchant, account and period analysis.</p><button type="button" data-pb-action="reports">Open report</button></article>'+
        '<article class="vv-pb-more-item"><h4>Consent & privacy</h4><p>Review bank connection consent and provider data-sharing status.</p><button type="button" data-pb-action="consent">Open consent centre</button></article>'+
        '<article class="vv-pb-more-item"><h4>Data quality</h4><p>'+Number(q.transactions?.unclassified||0)+' unclassified · '+Number(q.transactions?.unreconciled||0)+' unreconciled · '+Number(q.connections?.attention||0)+' connection(s) need attention.</p><button type="button" data-pb-action="analyse">Run smart analysis</button></article>'+'<article class="vv-pb-more-item"><h4>Banking alerts</h4><p>Set low-balance, large-transaction, payment, sync and unusual-activity alerts.</p><button type="button" data-pb-action="alerts">Alert settings</button></article>'+
      '</div>';
    wireDynamic();
  }

  function render(){
    const status=$('vvPbStatus'); const klass=healthClass();
    status.className='vv-pb-status '+klass;
    status.textContent=!state.status?.configured?'Provider setup required':klass==='attention'?'Needs attention':'Banking ready';
    $('vvPbHeadline').textContent=!state.status?.configured
      ? 'Your banking dashboard and statement intelligence are active. Direct bank connection needs the server-side provider credential.'
      : 'Accounts, transactions, budgets and insights in one banking workspace.';
    document.querySelectorAll('[data-pb-scope]').forEach(b=>b.classList.toggle('active',b.dataset.pbScope===state.scope));
    document.querySelectorAll('[data-pb-tab]').forEach(b=>b.classList.toggle('active',b.dataset.pbTab===state.tab));
    if(state.tab==='home') renderHome();
    else if(state.tab==='activity') renderActivity();
    else if(state.tab==='pay') renderPay();
    else if(state.tab==='insights') renderInsights();
    else if(state.tab==='plan') renderPlan();
    else if(state.tab==='calendar') renderCalendar();
    else if(state.tab==='team') renderTeam();
    else renderMore();
  }

  async function loadCore(){
    state.partialErrors=[];
    const dates=rangeDates(state.range);
    const query=new URLSearchParams({scope:state.scope});
    if(dates.from) query.set('from',dates.from);
    if(dates.to) query.set('to',dates.to);
    const requests=[
      safeApi(BANK+'/status',{configured:false,connection_summary:{total:0,active:0,attention:0,last_sync:null}},'Open Banking status'),
      safeApi(BANK+'/connections',{connections:[]},'Bank connections'),
      safeApi(BANK+'/data-quality',{score:null,transactions:{},connections:{}},'Bank data quality'),
      safeApi(FIN+'/banking-dashboard?'+query.toString(),{balances_by_currency:[],flow_by_currency:[],categories:[],merchants:[],monthly:[],accounts:[],recent_transactions:[],intelligence_by_currency:[],detected_recurring:[]},'Banking dashboard'),
      safeApi(FIN+'/budgets',{budgets:[]},'Budgets'),
      safeApi(FIN+'/insights?scope='+encodeURIComponent(state.scope),{insights:[]},'Insights'),
      safeApi(OS+'',{payments:[],spaces:[],beneficiaries:[],capabilities:{},operating_intelligence:{},access:{}},'Banking operating system'),
      safeApi(OS+'/team',{can_manage:false,users:[],grants:[]},'Team access'),
      safeApi(OS+'/command-center',{summary_by_currency:{},attention:[],approval_inbox:[],obligations:{},role_view:{mode:'BANKING'}},'Command centre'),
      safeApi(OS+'/cashflow-calendar?days=90',{obligations:[],calendar:[]},'Cash-flow calendar')
    ];
    if(!STANDALONE && (state.scope==='PERSONAL'||state.scope==='ALL')) requests.push(safeApi(PERSONAL+'/attention',null,'Personal money attention'));
    else requests.push(Promise.resolve(null));
    const [status,connections,quality,dashboard,budgets,insights,os,team,command,calendar,attention]=await Promise.all(requests);
    state.status=status; state.connections=connections.connections||[]; state.quality=quality; state.dashboard=dashboard;
    state.budgets=budgets.budgets||[]; state.insights=insights; state.os=os; state.team=team; state.command=command; state.calendar=calendar; state.attention=attention;
    selectedCurrency();
    try { await loadActivity(); }
    catch (error) {
      if (error.status===401) throw error;
      state.partialErrors.push({label:'Transactions',message:error.message,code:error.code||null});
      state.activity=[];
    }
  }

  async function refresh(){
    if(state.busy) return;
    state.busy=true;
    try{
      await loadCore();
      render();
      if(state.partialErrors.length){
        const names=[...new Set(state.partialErrors.map(x=>x.label))].slice(0,4);
        message('Banking loaded with limited services.','warning',names.join(', ')+' could not refresh. Your available accounts, statements and reports remain usable.');
      } else {
        message('');
      }
    }
    catch(e){
      if(e.status===401){window.location.assign('/login?next='+encodeURIComponent(location.pathname));return;}
      message('Banking workspace could not load.','error',e.message);
      const host=$('vvPbContent');
      if(host)host.innerHTML='<div class="vv-pb-empty"><strong>Banking data is temporarily unavailable</strong><span>'+esc(e.message)+'</span><button type="button" class="vv-pb-select" data-pb-action="refresh">Try again</button></div>';
    }
    finally{state.busy=false;}
  }

  async function connectBank(){
    message('Preparing secure bank connection…','info');
    try{
      const providers=await api(OPEN_BANKING+'/providers');
      const chosen=providers.selected_provider||'BASIQ';
      const result=await api(OPEN_BANKING+'/consent',{method:'POST',body:JSON.stringify({provider:chosen})});
      if(result.consent_url){window.location.assign(result.consent_url);return;}
      message('Bank connection could not start.','error','No hosted consent URL was returned.');
    }catch(e){
      if(e.code==='PROVIDER_CREDENTIALS_MISSING') message('Direct bank connection needs provider setup.','setup','Your statement import, transaction ledger and analytics remain available.');
      else message('Bank connection could not start.','error',e.message);
    }
  }

  async function syncNow(){
    if(state.busy) return; state.busy=true; message('Syncing connected bank data…','info');
    try{const result=await api(BANK+'/sync',{method:'POST',body:JSON.stringify({trigger:'MANUAL'})});message('Bank sync completed.','success',result.message||'Balances and transactions are refreshed.');state.busy=false;await refresh();}
    catch(e){state.busy=false;message('Bank sync could not run.','error',e.message);}
  }

  function openBudget(existingUid){
    const existing=existingUid?(state.budgets||[]).find(x=>x.budget_uid===existingUid):null;
    $('vvPbBudgetScope').value=existing?.ownership_scope||(state.scope==='ALL'?'PERSONAL':state.scope);
    $('vvPbBudgetCategory').value=existing?.category||'';
    $('vvPbBudgetAmount').value=existing?.limit_amount||'';
    $('vvPbBudgetCurrency').value=existing?.currency||selectedCurrency();
    $('vvPbBudgetCycle').value=existing?.cycle||'MONTHLY';
    $('vvPbBudgetAnchor').value=existing?.cycle_anchor_date?day(existing.cycle_anchor_date):new Date().toISOString().slice(0,10);
    const cats=[...new Set((state.dashboard?.categories||[]).map(x=>x.category))].sort();
    $('vvPbCategoryList').innerHTML=cats.map(c=>'<option value="'+esc(c)+'"></option>').join('');
    $('vvPbBudgetDialog').showModal();
  }

  async function saveBudget(e){
    e.preventDefault();
    const button=e.submitter; if(button){button.disabled=true;button.textContent='Saving…';}
    try{
      const body={
        ownership_scope:$('vvPbBudgetScope').value,
        category:$('vvPbBudgetCategory').value,
        limit_amount:$('vvPbBudgetAmount').value,
        currency:$('vvPbBudgetCurrency').value,
        cycle:$('vvPbBudgetCycle').value,
        cycle_anchor_date:$('vvPbBudgetAnchor').value
      };
      const result=await api(FIN+'/budgets',{method:'POST',body:JSON.stringify(body)});
      $('vvPbBudgetDialog').close(); message(result.message,'success'); await refresh(); state.tab='plan'; render();
    }catch(err){message('Budget could not be saved.','error',err.message);}
    finally{if(button){button.disabled=false;button.textContent='Save budget';}}
  }

  async function deleteBudget(uid){
    if(!confirm('Remove this active budget? Historical transactions will not be changed.')) return;
    try{const result=await api(FIN+'/budgets/'+encodeURIComponent(uid),{method:'DELETE'});message(result.message,'success');await refresh();state.tab='plan';render();}
    catch(e){message('Budget could not be removed.','error',e.message);}
  }

  async function runAnalysis(){
    message('Analysing transaction patterns…','info');
    try{const result=await api(FIN+'/analyse',{method:'POST',body:JSON.stringify({scope:state.scope})});message(result.message||'Analysis complete.','success');await refresh();}
    catch(e){message('Smart analysis could not run.','error',e.message);}
  }

  async function showConsent(){
    try{
      const data=await api(BANK+'/consents');
      const provider=data.provider_consents||[]; const local=data.local_receipts||[];
      $('vvPbContent').innerHTML='<section class="vv-pb-card"><div class="vv-pb-card-head"><h3>Consent & privacy</h3><button type="button" class="vv-pb-select" data-pb-tab="more">Back</button></div><p>Voxel Veda does not store your bank password, PIN or OTP.</p><div class="vv-pb-recurring">'+
        (provider.length?provider.map(c=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(c.status||c.type||'Consent')+'</strong><small>Provider consent</small></div><b>'+esc(c.id||c.consentId||'')+'</b></div>').join(''):'<div class="vv-pb-empty">No provider consent visible.</div>')+
        (local.length?local.map(c=>'<div class="vv-pb-recurring-row"><div><strong>'+esc(c.provider)+' · '+esc(c.consent_status)+'</strong><small>Local consent receipt</small></div><b>'+esc(day(c.created_at))+'</b></div>').join(''):'')+
        '</div><p style="color:#8ea3b9">This screen describes the provider/data-sharing flow only and does not claim independent CDR accreditation.</p></section>';
      wireDynamic();
    }catch(e){message('Consent information could not load.','error',e.message);}
  }

  function openStatementForAccount(id){
    const button=$('importStatement'); if(button) button.click();
    setTimeout(()=>{const select=$('importAccount'); if(select && [...select.options].some(o=>String(o.value)===String(id))) select.value=String(id);},0);
  }

  function manageTransaction(id){
    if(window.VoxelVedaFinanceLedger?.openTransactionEditor) return window.VoxelVedaFinanceLedger.openTransactionEditor(id);
    state.tab='activity'; state.activityQuery=''; render(); message('Open the transaction Manage button in the ledger below for editing.','info');
  }

  function wireDynamic(){
    $('vvPbCurrency')?.addEventListener('change',(e)=>{state.currency=e.target.value;render();});
    document.querySelectorAll('[data-pb-manage-tx]').forEach(b=>b.addEventListener('click',()=>manageTransaction(Number(b.dataset.pbManageTx))));
  }

  async function handleClick(e){
    const scope=e.target.closest('[data-pb-scope]');
    if(scope){state.scope=scope.dataset.pbScope;state.activityAccount='';state.activityQuery='';await refresh();return;}
    const tab=e.target.closest('[data-pb-tab]');
    if(tab){state.tab=tab.dataset.pbTab;if(state.tab==='activity'&&!state.activity.length)await loadActivity();render();return;}
    const range=e.target.closest('[data-pb-range]');
    if(range){state.range=range.dataset.pbRange;await refresh();state.tab='insights';render();return;}
    const chart=e.target.closest('[data-pb-chart]');
    if(chart){state.chart=chart.dataset.pbChart;renderInsights();return;}
    const accountDetail=e.target.closest('[data-pb-account-detail]');
    if(accountDetail){return openAccountDetail(Number(accountDetail.dataset.pbAccountDetail));}
    const account=e.target.closest('[data-pb-account-activity]');
    if(account){state.activityAccount=account.dataset.pbAccountActivity;state.tab='activity';await loadActivity();render();return;}
    const statement=e.target.closest('[data-pb-account-statement]');
    if(statement){openStatementForAccount(statement.dataset.pbAccountStatement);return;}
    const recurring=e.target.closest('[data-pb-search-merchant]');
    if(recurring){state.activityQuery=recurring.dataset.pbSearchMerchant;state.tab='activity';await loadActivity();render();return;}
    const submitPaymentButton=e.target.closest('[data-pb-submit-payment]'); if(submitPaymentButton){return submitPayment(submitPaymentButton.dataset.pbSubmitPayment);}
    const cancelPaymentButton=e.target.closest('[data-pb-cancel-payment]'); if(cancelPaymentButton){return cancelPayment(cancelPaymentButton.dataset.pbCancelPayment);}
    const archiveSpaceButton=e.target.closest('[data-pb-archive-space]'); if(archiveSpaceButton){return archiveSpace(archiveSpaceButton.dataset.pbArchiveSpace);}
    const approvePaymentButton=e.target.closest('[data-pb-approve-payment]'); if(approvePaymentButton){return decidePayment(approvePaymentButton.dataset.pbApprovePayment,'APPROVE');}
    const rejectPaymentButton=e.target.closest('[data-pb-reject-payment]'); if(rejectPaymentButton){return decidePayment(rejectPaymentButton.dataset.pbRejectPayment,'REJECT');}
    const grant=e.target.closest('[data-pb-grant-user]'); if(grant){openTeamAccess(grant.dataset.pbGrantUser,grant.dataset.pbGrantAccount,grant.dataset.pbGrantLevel,grant.dataset.pbGrantLabel);return;}
    const edit=e.target.closest('[data-pb-edit-budget]'); if(edit){openBudget(edit.dataset.pbEditBudget);return;}
    const del=e.target.closest('[data-pb-delete-budget]'); if(del){await deleteBudget(del.dataset.pbDeleteBudget);return;}
    const action=e.target.closest('[data-pb-action]');
    if(!action) return;
    const name=action.dataset.pbAction;
    if(name==='app-home'){window.location.assign('/admin?view=finance');return;}
    if(name==='connect') return connectBank();
    if(name==='sync') return syncNow();
    if(name==='upload') return $('importStatement')?.click();
    if(name==='search'){state.tab='activity';render();setTimeout(()=>$('vvPbActivitySearch')?.focus(),0);return;}
    if(name==='budget') return openBudget();
    if(name==='payments'){state.tab='pay';render();return;}
    if(name==='new-payment') return openPaymentDraft();
    if(name==='beneficiary') return $('vvPbBeneficiaryDialog').showModal();
    if(name==='space'){ $('vvPbSpaceCurrency').value=selectedCurrency(); $('vvPbSpaceScope').value=state.scope==='PERSONAL'?'PERSONAL':'BUSINESS'; return $('vvPbSpaceDialog').showModal(); }
    if(name==='team'){state.tab='team';render();return;}
    if(name==='calendar'){state.tab='calendar';render();return;}
    if(name==='alerts') return openAlerts();
    if(name==='plan'){$('vvPbPaymentDialog')?.close();state.tab='plan';render();return;}
    if(name==='statements'){document.getElementById('vvStatementReportCenter')?.scrollIntoView({behavior:'smooth',block:'start'});return;}
    if(name==='reports'){const b=$('vvOverallReport');if(b)b.click();else document.getElementById('vvStatementReportCenter')?.scrollIntoView({behavior:'smooth'});return;}
    if(name==='consent') return showConsent();
    if(name==='analyse') return runAnalysis();
  }

  function init(){
    ensureAssets(); install(); refresh();
    window.addEventListener('voxelveda:network-restored',()=>{ if(!state.busy) refresh(); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
