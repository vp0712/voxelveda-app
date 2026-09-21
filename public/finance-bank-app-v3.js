(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const FIN = '/api/finance/intelligence';
  const OS = '/api/finance/banking-os';
  const state = {
    view:'home',
    scope:'ALL',
    currency:'AUD',
    os:null,
    command:null,
    dashboard:null,
    transactions:[],
    statements:[],
    budgets:[],
    insights:[],
    calendar:[],
    team:null,
    capabilities:null,
    connections:null,
    loading:false
  };

  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v)=>Number(v||0);
  const money=(v,c='AUD')=>{try{return new Intl.NumberFormat('en-AU',{style:'currency',currency:c}).format(num(v))}catch{return c+' '+num(v).toFixed(2)}};
  const date=(v)=>v?String(v).slice(0,10):'—';

  async function api(path, options={}) {
    const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})},...options});
    let p={};try{p=await r.json()}catch{}
    if(!r.ok){const e=new Error(p.message||('Request failed ('+r.status+')'));e.code=p.code;e.status=r.status;throw e}
    return p;
  }
  async function safe(path,fallback,options){try{return await api(path,options)}catch{return fallback}}

  function toast(message,tone='info'){
    document.querySelector('.bank-v3-toast')?.remove();
    const el=document.createElement('div');el.className='bank-v3-toast'+(tone==='error'?' error':'');el.textContent=message;document.body.appendChild(el);setTimeout(()=>el.remove(),3600);
  }

  function activeCurrency(){
    const currencies=(state.dashboard?.balances_by_currency||[]).map(x=>x.currency);
    if(!currencies.length)return state.currency||'AUD';
    if(!currencies.includes(state.currency))state.currency=currencies.includes('AUD')?'AUD':currencies[0];
    return state.currency;
  }
  function balanceRow(){const c=activeCurrency();return (state.dashboard?.balances_by_currency||[]).find(x=>x.currency===c)||{}}
  function flowRow(){const c=activeCurrency();return (state.dashboard?.flow_by_currency||[]).find(x=>x.currency===c)||{}}
  function intelRow(){const c=activeCurrency();return (state.dashboard?.intelligence_by_currency||[]).find(x=>x.currency===c)||{}}

  function setHeader(title,subtitle){
    $('bankPageTitle').textContent=title;
    $('bankPageSubtitle').textContent=subtitle;
  }

  function renderTopActions(){
    const host=$('bankV3TopActions');
    const common=[
      ['accent','＋ Add account','add-account'],
      ['primary','⇧ Import statement','import'],
      ['','⌕ Search activity','activity']
    ];
    const extra={
      home:[['','✦ Run analysis','analyse']],
      accounts:[['','↻ Refresh accounts','refresh']],
      activity:[['','▤ Statements','statements']],
      payments:[['accent','＋ New payment draft','new-payment']],
      plan:[['accent','＋ New Space','new-space']],
      insights:[['accent','✦ Run analysis','analyse']],
      statements:[['accent','⇧ Import statement','import'],['','✓ Review queue','review']],
      reports:[['','⤓ Full history','full-report']],
      team:[['','↗ Open Banking portal','banking-portal']],
      settings:[['','↻ Refresh status','refresh']]
    }[state.view]||[];
    host.innerHTML=[...common,...extra].map(x=>'<button class="bank-v3-action '+x[0]+'" data-bank-action="'+x[2]+'">'+x[1]+'</button>').join('');
  }

  function nav(view){
    state.view=view;
    document.querySelectorAll('[data-bank-view]').forEach(b=>b.classList.toggle('active',b.dataset.bankView===view));
    renderTopActions();
    renderView();
    history.replaceState(null,'','#'+view);
  }

  function kpi(label,value,small,tone=''){
    return '<div class="bank-kpi"><span>'+esc(label)+'</span><strong class="'+tone+'">'+esc(value)+'</strong><small>'+esc(small||'')+'</small></div>';
  }

  function accountRows(limit=999){
    const c=activeCurrency();
    return (state.os?.accounts||[]).filter(a=>a.currency===c).slice(0,limit);
  }
  function accountListHtml(rows){
    if(!rows.length)return '<div class="bank-empty"><strong>No accounts yet</strong>Add an account or import a statement to begin.</div>';
    return '<div class="bank-account-list">'+rows.map(a=>{
      const bal=num(a.available_balance==null?a.current_ledger_balance:a.available_balance);
      return '<div class="bank-account-row" data-account-id="'+Number(a.id)+'"><div class="bank-account-main"><span class="bank-account-icon">'+esc((a.institution||a.nickname||'A').slice(0,1).toUpperCase())+'</span><div><h3>'+esc(a.nickname||'Account')+'</h3><p>'+esc(a.institution||'Manual account')+' · '+esc(a.account_number_masked||a.account_type||'Account')+'</p></div></div><div class="bank-account-value"><b>'+esc(money(bal,a.currency||c))+'</b><small>'+esc(a.ownership_scope||'')+'</small></div></div>';
    }).join('')+'</div>';
  }

  function lineChart(rows,currency){
    if(!rows?.length)return '<div class="bank-empty">More history is needed for this chart.</div>';
    const w=700,h=220,p=24,max=Math.max(1,...rows.flatMap(r=>[num(r.money_in),num(r.money_out)]));
    const pt=(v,i)=>[p+(rows.length===1?0:i*(w-p*2)/(rows.length-1)),h-p-(num(v)/max)*(h-p*2)];
    const path=k=>rows.map((r,i)=>pt(r[k],i).join(',')).join(' ');
    const grid=[.25,.5,.75,1].map(x=>'<line class="bank-chart-grid" x1="'+p+'" y1="'+(h-p-x*(h-p*2))+'" x2="'+(w-p)+'" y2="'+(h-p-x*(h-p*2))+'"/>').join('');
    return '<div class="bank-chart"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+grid+'<polyline class="bank-chart-line" points="'+path('money_out')+'"/><polyline class="bank-chart-accent" points="'+path('money_in')+'"/></svg></div><div style="font-size:.64rem;color:#69727d">Dark = spending · Lime = income · '+esc(currency)+'</div>';
  }

  function recentTable(rows,limit=8){
    const list=(rows||[]).slice(0,limit);
    if(!list.length)return '<div class="bank-empty">No transaction activity yet.</div>';
    return '<div class="bank-table-wrap"><table class="bank-table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Amount</th><th>Status</th></tr></thead><tbody>'+list.map(t=>{
      const amt=num(t.credit)>0?num(t.credit):-num(t.debit);
      return '<tr data-tx-id="'+Number(t.id)+'"><td>'+esc(date(t.transaction_date))+'</td><td><b>'+esc(t.merchant_name||t.description||'Transaction')+'</b></td><td>'+esc(t.category||'Unclassified')+'</td><td>'+esc(t.account_name||'')+'</td><td class="amount '+(amt>=0?'bank-positive':'bank-negative')+'">'+esc(money(amt,t.currency||activeCurrency()))+'</td><td><span class="bank-status '+(String(t.reconciliation_status).includes('RECONCILED')?'good':'')+'">'+esc(t.reconciliation_status||'Imported')+'</span></td></tr>';
    }).join('')+'</tbody></table></div>';
  }

  function renderHome(){
    setHeader('Money','Your balances, cash flow and decisions in one banking workspace.');
    const c=activeCurrency(),bal=balanceRow(),flow=flowRow(),intel=intelRow(),cmd=state.command?.summary_by_currency?.[c]||{};
    const accounts=accountRows(4),recent=(state.transactions||[]).filter(t=>t.currency===c);
    const monthly=(state.dashboard?.monthly||[]).filter(x=>x.currency===c).slice(-12);
    const net=num(flow.money_in)-num(flow.money_out);
    const alerts=[...(intel.alerts||[]),...(state.command?.attention||[])].slice(0,5);
    $('bankV3Screen').innerHTML=
      '<div class="bank-v3-grid cols-2">'+
        '<section class="bank-card bank-balance-hero"><div class="bank-card-pad"><span style="font-size:.65rem;color:#b9c2cb">AVAILABLE ACROSS '+esc(c)+'</span><strong>'+esc(money(bal.balance,c))+'</strong><small>'+Number(bal.account_count||0)+' visible account'+(Number(bal.account_count||0)===1?'':'s')+'</small><div class="bank-balance-meta"><div><span>30-day projected liquidity</span><b>'+esc(money(cmd.projected_liquidity_30d??intel.forecast_30d??bal.balance,c))+'</b></div><div><span>Cash runway</span><b>'+esc(cmd.runway_days??intel.cash_runway_months??'—')+(cmd.runway_days?' days':intel.cash_runway_months?' months':'')+'</b></div><div><span>Pending obligations</span><b>'+esc(money(cmd.pending_obligations||0,c))+'</b></div></div></div></section>'+
        '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>QUICK ACTIONS</span><h2>What do you want to do?</h2></div></div><div class="bank-quick-grid">'+
          quick('⇧','Import statement','Add real bank history','import')+
          quick('＋','Add account','Create a bank/cash account','add-account')+
          quick('→','Payment draft','Prepare for approval','new-payment')+
          quick('✦','Analyse','Find patterns and anomalies','analyse')+
        '</div></div></section>'+
      '</div>'+
      '<div class="bank-kpi-strip">'+
        kpi('Income',money(flow.money_in,c),'Selected period','bank-positive')+
        kpi('Spending',money(flow.money_out,c),'Transfers excluded')+
        kpi('Net cash flow',money(net,c),net>=0?'Positive':'Negative',net>=0?'bank-positive':'bank-negative')+
        kpi('Safe to spend (7d)',money(intel.safe_to_spend_7d||0,c),'After recurring load')+
      '</div>'+
      '<div class="bank-v3-grid cols-2">'+
        '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>CASH FLOW</span><h2>12-month movement</h2></div><button data-bank-view-jump="activity">See activity</button></div>'+lineChart(monthly,c)+'</div></section>'+
        '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>ATTENTION</span><h2>What needs action</h2></div><button data-bank-view-jump="insights">View insights</button></div>'+alertHtml(alerts)+'</div></section>'+
      '</div>'+
      '<div class="bank-v3-grid cols-2">'+
        '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>ACCOUNTS</span><h2>Your money</h2></div><button data-bank-view-jump="accounts">View all</button></div>'+accountListHtml(accounts)+'</div></section>'+
        '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>RECENT ACTIVITY</span><h2>Latest transactions</h2></div><button data-bank-view-jump="activity">View all</button></div>'+recentTable(recent,5)+'</div></section>'+
      '</div>';
    bindDynamic();
  }

  function quick(icon,title,sub,action){return '<button class="bank-quick" data-bank-action="'+action+'"><span>'+icon+'</span><b>'+title+'</b><small>'+sub+'</small></button>'}
  function alertHtml(rows){
    if(!rows.length)return '<div class="bank-empty">Nothing urgent is currently flagged.</div>';
    return rows.map(a=>'<div class="bank-alert"><span class="bank-alert-icon">'+(String(a.severity).toUpperCase()==='HIGH'?'!':'✦')+'</span><div><strong>'+esc(a.code?.replaceAll('_',' ')||'Finance insight')+'</strong><p>'+esc(a.message||'Review this finance signal.')+'</p></div><span class="bank-status '+(String(a.severity).toUpperCase()==='HIGH'?'bad':'warn')+'">'+esc(a.severity||'INFO')+'</span></div>').join('');
  }

  function renderAccounts(){
    setHeader('Accounts','Balances, history and controls for every visible account.');
    const rows=state.os?.accounts||[];
    const byCurrency={};
    rows.forEach(a=>{(byCurrency[a.currency]??=[]).push(a)});
    $('bankV3Screen').innerHTML=
      '<div class="bank-section-title"><div><h2>All accounts</h2><p>Personal accounts stay owner-only. Delegated business accounts follow account-level permissions.</p></div></div>'+
      Object.entries(byCurrency).map(([cur,list])=>'<section class="bank-card" style="margin-bottom:14px"><div class="bank-card-pad"><div class="bank-card-head"><div><span>'+esc(cur)+'</span><h2>'+list.length+' account'+(list.length===1?'':'s')+'</h2></div><b>'+esc(money(list.reduce((s,a)=>s+num(a.available_balance==null?a.current_ledger_balance:a.available_balance),0),cur))+'</b></div>'+accountListHtml(list)+'</div></section>').join('');
    bindDynamic();
  }

  function renderActivity(){
    setHeader('Activity','Search, filter and inspect every imported transaction.');
    const accounts=state.os?.accounts||[];
    const cats=[...new Set((state.transactions||[]).map(t=>t.category||'Unclassified'))].sort();
    $('bankV3Screen').innerHTML=
      '<div class="bank-toolbar"><input id="bankActivitySearch" placeholder="Search merchant, description or reference"><select id="bankActivityAccount"><option value="">All accounts</option>'+accounts.map(a=>'<option value="'+a.id+'">'+esc(a.nickname)+'</option>').join('')+'</select><select id="bankActivityCategory"><option value="">All categories</option>'+cats.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('')+'</select><button id="bankActivityApply">Apply</button></div>'+
      '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>TRANSACTIONS</span><h2>Money activity</h2></div><small>'+Number(state.transactions?.length||0)+' loaded</small></div><div id="bankActivityTable">'+recentTable(state.transactions,250)+'</div></div></section>';
    $('bankActivityApply')?.addEventListener('click',loadActivityFiltered);
    bindDynamic();
  }

  async function loadActivityFiltered(){
    const q=$('bankActivitySearch')?.value||'',account=$('bankActivityAccount')?.value||'',category=$('bankActivityCategory')?.value||'';
    const params=new URLSearchParams({scope:state.scope,limit:'250'});if(q)params.set('q',q);if(account)params.set('account_id',account);if(category)params.set('category',category);
    const p=await api(FIN+'/transactions?'+params.toString());state.transactions=p.transactions||[];$('bankActivityTable').innerHTML=recentTable(state.transactions,250);bindDynamic();
  }

  function paymentStatusTone(s){return ['APPROVED','COMPLETED','READY_FOR_EXECUTION'].includes(s)?'good':['REJECTED','CANCELLED'].includes(s)?'bad':['PENDING_APPROVAL','SCHEDULED'].includes(s)?'warn':''}
  function renderPayments(){
    setHeader('Payments','Prepare, approve and track payment workflows.');
    const os=state.os||{},caps=os.capabilities?.payment_rails||state.capabilities?.payment_rails||{},payments=os.payments||[];
    const drafts=payments.filter(p=>p.status==='DRAFT').length,pending=payments.filter(p=>p.status==='PENDING_APPROVAL').length,ready=payments.filter(p=>p.status==='READY_FOR_EXECUTION').length;
    $('bankV3Screen').innerHTML=
      '<div class="bank-payment-note"><b>Payment safety:</b> Voxel Veda currently manages drafts, approvals and schedules. External bank transfer execution remains disabled until a verified payment-initiation provider is connected.</div>'+
      '<div class="bank-kpi-strip">'+kpi('Drafts',String(drafts),'Prepared, not submitted')+kpi('Pending approval',String(pending),'Separation of duties')+kpi('Ready for execution',String(ready),caps.external_transfer?'Provider available':'No live payment rail')+kpi('External transfer',caps.external_transfer?'Available':'Not connected',caps.reason||'Capability gated',caps.external_transfer?'bank-positive':'')+'</div>'+
      '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>PAYMENT WORKFLOWS</span><h2>Payments and requests</h2></div><button data-bank-action="new-payment">New draft</button></div>'+
      (payments.length?'<div class="bank-table-wrap"><table class="bank-table"><thead><tr><th>Payee</th><th>Account</th><th>Due</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead><tbody>'+payments.map(p=>'<tr><td><b>'+esc(p.payee_name)+'</b><br><small>'+esc(p.reference_text||'')+'</small></td><td>'+esc(p.account_name||'—')+'</td><td>'+esc(date(p.due_date))+'</td><td>'+esc(p.payment_type||'')+'</td><td class="amount">'+esc(money(p.amount,p.currency||'AUD'))+'</td><td><span class="bank-status '+paymentStatusTone(p.status)+'">'+esc(p.status)+'</span></td></tr>').join('')+'</tbody></table></div>':'<div class="bank-empty">No payment workflows yet.</div>')+
      '</div></section>';
    bindDynamic();
  }

  function renderPlan(){
    setHeader('Plan','Budgets, reserves and Money Spaces for upcoming goals.');
    const spaces=state.os?.spaces||[],budgets=state.budgets||[],c=activeCurrency(),intel=intelRow();
    $('bankV3Screen').innerHTML=
      '<div class="bank-v3-grid cols-2">'+
      '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>MONEY SPACES</span><h2>Reserved money</h2></div><button data-bank-action="new-space">New Space</button></div>'+
      (spaces.length?spaces.map(s=>{const target=num(s.target_amount),allocated=num(s.allocated_amount),pct=target>0?Math.min(100,allocated/target*100):0;return '<div class="bank-plan-row"><div class="bank-plan-row-top"><h3>'+esc(s.name)+'</h3><b>'+esc(money(allocated,s.currency))+(target?' / '+esc(money(target,s.currency)):'')+'</b></div><p>'+esc(s.purpose||s.ownership_scope)+'</p><div class="bank-progress"><span style="width:'+pct+'%"></span></div></div>';}).join(''):'<div class="bank-empty">No Money Spaces yet.</div>')+
      '</div></section>'+
      '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>BUDGETS</span><h2>Spending limits</h2></div></div>'+
      (budgets.length?budgets.map(b=>'<div class="bank-plan-row"><div class="bank-plan-row-top"><h3>'+esc(b.category)+'</h3><b>'+esc(money(b.spent_amount,b.currency))+' / '+esc(money(b.limit_amount,b.currency))+'</b></div><p>'+esc(b.cycle)+' · '+esc(b.ownership_scope)+' · '+Number(b.used_percent||0).toFixed(0)+'% used</p><div class="bank-progress"><span style="width:'+Math.min(100,Number(b.used_percent||0))+'%"></span></div></div>').join(''):'<div class="bank-empty">No budgets configured.</div>')+
      '</div></section></div>'+
      '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>FORECAST</span><h2>'+esc(c)+' outlook</h2></div></div><div class="bank-kpi-strip">'+kpi('30 days',money(intel.forecast_30d||0,c),'Projected balance')+kpi('60 days',money(intel.forecast_60d||0,c),'Projected balance')+kpi('90 days',money(intel.forecast_90d||0,c),'Projected balance')+kpi('Recurring load',money(intel.recurring_monthly_estimate||0,c),'Estimated monthly')+'</div></div></section>';
    bindDynamic();
  }

  function renderInsights(){
    setHeader('Insights','Explainable finance signals based on your real transaction history.');
    const alerts=[...(intelRow().alerts||[]),...(state.command?.attention||[])];
    const explicit=Array.isArray(state.insights)?state.insights:(state.insights?.insights||[]);
    $('bankV3Screen').innerHTML='<div class="bank-v3-grid cols-2"><section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>ATTENTION</span><h2>Cash and risk signals</h2></div><button data-bank-action="analyse">Run analysis</button></div>'+alertHtml(alerts)+'</div></section><section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>TRANSACTION INTELLIGENCE</span><h2>Detected patterns</h2></div></div>'+(explicit.length?explicit.slice(0,20).map(x=>'<div class="bank-alert"><span class="bank-alert-icon">✦</span><div><strong>'+esc(x.title||x.insight_type||x.type||'Insight')+'</strong><p>'+esc(x.explanation||x.message||x.description||'Review this pattern.')+'</p></div><span class="bank-status">'+esc(x.status||'Review')+'</span></div>').join(''):'<div class="bank-empty">Run analysis after importing statements to generate explainable insights.</div>')+'</div></section></div>';
    bindDynamic();
  }

  function renderStatements(){
    setHeader('Statements','Your imported bank documents and transaction coverage.');
    const rows=state.statements||[];
    $('bankV3Screen').innerHTML='<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>STATEMENT LIBRARY</span><h2>Imported statements</h2></div><button data-bank-action="import">Import</button></div>'+
      (rows.length?'<div class="bank-table-wrap"><table class="bank-table"><thead><tr><th>Statement</th><th>Account</th><th>Period</th><th>Rows</th><th>Money in</th><th>Money out</th><th>Status</th></tr></thead><tbody>'+rows.map(s=>'<tr data-statement-uid="'+esc(s.import_uid)+'"><td><b>'+esc(s.original_name||s.import_uid)+'</b><br><small>'+esc(s.source_format||'')+'</small></td><td>'+esc(s.account_name||'')+'</td><td>'+esc(date(s.statement_start_date))+' → '+esc(date(s.statement_end_date))+'</td><td>'+Number(s.linked_transactions||s.imported_rows||0)+'</td><td>'+esc(money(s.money_in||0,s.currency||'AUD'))+'</td><td>'+esc(money(s.money_out||0,s.currency||'AUD'))+'</td><td><span class="bank-status '+(s.parse_status==='IMPORTED'?'good':'warn')+'">'+esc(s.parse_status||'')+'</span></td></tr>').join('')+'</tbody></table></div>':'<div class="bank-empty">No imported statements yet.</div>')+
      '</div></section>';
    bindDynamic();
  }

  function renderReports(){
    setHeader('Reports','Banking history, spending and audit-ready exports.');
    const c=activeCurrency(),flow=flowRow();
    $('bankV3Screen').innerHTML=
      '<div class="bank-v3-grid cols-3">'+
      reportCard('▦','Portfolio history','All accounts and statement history','full-report')+
      reportCard('⇄','Spending report','Categories, merchants and cash movement','spending-report')+
      reportCard('▤','Statement reports','Open individual statement evidence','statements')+
      reportCard('≈','Cash-flow view','Income, expenses and forecasts','home')+
      reportCard('◎','Budget vs actual','Current plan performance','plan')+
      reportCard('✦','Intelligence review','Explainable finance findings','insights')+
      '</div>'+
      '<section class="bank-card" style="margin-top:14px"><div class="bank-card-pad"><div class="bank-card-head"><div><span>CURRENT '+esc(c)+'</span><h2>Reporting snapshot</h2></div></div><div class="bank-kpi-strip">'+kpi('Money in',money(flow.money_in,c),'Selected dashboard period','bank-positive')+kpi('Money out',money(flow.money_out,c),'Transfers excluded')+kpi('Net flow',money(num(flow.money_in)-num(flow.money_out),c),'Income minus spend')+kpi('Transactions',String(flow.transaction_count||0),'Visible history')+'</div><p style="font-size:.66rem;color:#69727d;margin:14px 0 0">Reports assist bookkeeping and financial review. They do not replace professional accounting or tax advice.</p></div></section>';
    bindDynamic();
  }
  function reportCard(icon,title,sub,action){return '<button class="bank-card bank-card-pad bank-quick" data-bank-action="'+action+'"><span>'+icon+'</span><b>'+title+'</b><small>'+sub+'</small></button>'}

  function renderTeam(){
    setHeader('Team','Delegated business-account access and separation of duties.');
    const t=state.team||{users:[],grants:[],can_manage:false},accounts=(state.os?.accounts||[]).filter(a=>a.ownership_scope==='BUSINESS');
    $('bankV3Screen').innerHTML=
      '<div class="bank-payment-note"><b>Access model:</b> personal accounts are never delegated. Business access is granted per account as View, Prepare, Approve or Manage.</div>'+
      '<div class="bank-v3-grid cols-2"><section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>USERS</span><h2>Banking access</h2></div></div>'+
      (t.users?.length?t.users.map(u=>{const grants=t.grants.filter(g=>Number(g.user_id)===Number(u.id));return '<div class="bank-plan-row"><div class="bank-plan-row-top"><h3>'+esc(u.name||u.email)+'</h3><span class="bank-status">'+esc(u.role||'user')+'</span></div><p>'+esc(u.email||'')+'</p>'+grants.map(g=>'<div style="font-size:.65rem;margin-top:5px">'+esc(g.account_name)+' · <b>'+esc(g.access_level)+'</b></div>').join('')+'</div>';}).join(''):'<div class="bank-empty">Team access management is available to banking administrators.</div>')+
      '</div></section><section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>ACCESS MATRIX</span><h2>Business accounts</h2></div></div>'+accountListHtml(accounts)+'</div></section></div>';
    bindDynamic();
  }

  function renderSettings(){
    setHeader('Settings','Banking safety, provider capability and alert preferences.');
    const caps=state.capabilities||state.os?.capabilities||{},open=caps.open_banking||{},rails=caps.payment_rails||{},alerts=state.os?.alerts||{};
    $('bankV3Screen').innerHTML=
      '<div class="bank-v3-grid cols-2"><section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>CAPABILITIES</span><h2>What is actually connected</h2></div></div><div class="bank-cap-grid">'+
      cap('Open Banking provider',open.provider||'Not selected',open.configured?'Configured':'Not verified')+
      cap('Live account sync',open.live_sync_enabled?'Enabled':'Disabled',open.live_sync_enabled?'Provider switch enabled':'No live feed claimed')+
      cap('External payments',rails.external_transfer?'Connected':'Not connected',rails.reason||'Capability gated')+
      cap('Cards / PayID / BPAY',rails.card_issuing||rails.payid||rails.bpay?'Partial capability':'Not connected','Unavailable controls remain hidden or disabled')+
      '</div></div></section>'+
      '<section class="bank-card"><div class="bank-card-pad"><div class="bank-card-head"><div><span>ALERTS</span><h2>Your thresholds</h2></div></div><form id="bankAlertForm" class="bank-form"><div class="bank-form-grid"><label>Low balance threshold<input name="low_balance_threshold" inputmode="decimal" value="'+esc(alerts.low_balance_threshold??'')+'"></label><label>Large transaction threshold<input name="large_transaction_threshold" inputmode="decimal" value="'+esc(alerts.large_transaction_threshold??'')+'"></label></div><label><input type="checkbox" name="notify_budget" '+(alerts.notify_budget!==0?'checked':'')+'> Budget alerts</label><label><input type="checkbox" name="notify_payments" '+(alerts.notify_payments!==0?'checked':'')+'> Payment workflow alerts</label><label><input type="checkbox" name="notify_bank_sync" '+(alerts.notify_bank_sync!==0?'checked':'')+'> Bank sync alerts</label><label><input type="checkbox" name="notify_unusual_activity" '+(alerts.notify_unusual_activity!==0?'checked':'')+'> Unusual activity alerts</label><div class="bank-form-actions"><button class="primary" type="submit">Save preferences</button></div></form></div></section></div>'+
      '<section class="bank-card" style="margin-top:14px"><div class="bank-card-pad"><div class="bank-card-head"><div><span>CONNECTIONS</span><h2>Bank data sources</h2></div><button data-bank-action="connect-bank">Connect bank</button></div>'+connectionHtml()+'</div></section>';
    $('bankAlertForm')?.addEventListener('submit',saveAlerts);
    bindDynamic();
  }
  function cap(title,value,sub){return '<div class="bank-cap"><strong>'+esc(title)+'</strong><p><b>'+esc(value)+'</b><br>'+esc(sub||'')+'</p></div>'}
  function connectionHtml(){const rows=state.connections?.connections||state.connections?.bank_connections||[];return rows.length?rows.map(x=>'<div class="bank-plan-row"><div class="bank-plan-row-top"><h3>'+esc(x.provider||x.institution||'Bank connection')+'</h3><span class="bank-status '+(String(x.status).toUpperCase().includes('ACTIVE')?'good':'warn')+'">'+esc(x.status||'Unknown')+'</span></div><p>Last update: '+esc(x.last_synced_at||x.updated_at||'Not available')+'</p></div>').join(''):'<div class="bank-empty">No verified live bank connection is currently shown.</div>'}

  function renderView(){
    renderTopActions();
    if(state.view==='home')renderHome();
    else if(state.view==='accounts')renderAccounts();
    else if(state.view==='activity')renderActivity();
    else if(state.view==='payments')renderPayments();
    else if(state.view==='plan')renderPlan();
    else if(state.view==='insights')renderInsights();
    else if(state.view==='statements')renderStatements();
    else if(state.view==='reports')renderReports();
    else if(state.view==='team')renderTeam();
    else if(state.view==='settings')renderSettings();
  }

  async function loadCore(){
    if(state.loading)return;state.loading=true;
    const scope=encodeURIComponent(state.scope);
    const results=await Promise.allSettled([
      api(OS),
      api(OS+'/command-center'),
      api(FIN+'/banking-dashboard?scope='+scope),
      api(FIN+'/transactions?scope='+scope+'&limit=250'),
      api(FIN+'/statements?scope='+scope),
      api(FIN+'/budgets'),
      api(FIN+'/insights?scope='+scope),
      api(OS+'/cashflow-calendar?days=90'),
      api(OS+'/team'),
      api(OS+'/capabilities'),
      api(FIN+'/bank-connections')
    ]);
    const val=(i,f)=>results[i].status==='fulfilled'?results[i].value:f;
    state.os=val(0,{accounts:[],spaces:[],payments:[],alerts:{}});
    state.command=val(1,{attention:[],summary_by_currency:{},approval_inbox:[]});
    state.dashboard=val(2,{balances_by_currency:[],flow_by_currency:[],monthly:[],intelligence_by_currency:[]});
    state.transactions=val(3,{transactions:[]}).transactions||[];
    state.statements=val(4,{statements:[]}).statements||[];
    state.budgets=val(5,{budgets:[]}).budgets||[];
    state.insights=val(6,{insights:[]});
    state.calendar=val(7,{events:[]}).events||[];
    state.team=val(8,{can_manage:false,users:[],grants:[]});
    state.capabilities=val(9,state.os?.capabilities||{});
    state.connections=val(10,{connections:[]});
    activeCurrency();state.loading=false;renderView();
  }

  async function openAccount(id){
    openDrawer('ACCOUNT','Loading…','<div class="bank-v3-loading"><span></span></div>');
    try{
      const d=await api(OS+'/accounts/'+id),a=d.account,m=d.metrics||{};
      $('bankV3DrawerTitle').textContent=a.nickname||'Account';
      $('bankV3DrawerBody').innerHTML='<div class="bank-drawer-metric-grid">'+metric('Balance',money(m.balance,a.currency))+metric('90d income',money(m.income_90d,a.currency),'bank-positive')+metric('90d spend',money(m.spend_90d,a.currency))+metric('Runway',m.runway_days==null?'—':m.runway_days+' days')+'</div><div class="bank-card-head"><div><span>ACCOUNT</span><h3>'+esc(a.institution||'Bank account')+'</h3></div><span class="bank-status">'+esc(a.ownership_scope)+'</span></div><p style="font-size:.7rem;color:#69727d">'+esc(a.account_number_masked||'Masked number unavailable')+' · '+esc(a.account_type||'Account')+' · '+esc(a.currency)+'</p><div class="bank-card-head" style="margin-top:18px"><div><span>RECENT ACTIVITY</span><h3>Transactions</h3></div></div>'+recentTable((d.transactions||[]).map(t=>({...t,account_name:a.nickname})),12);
      bindDynamic();
    }catch(e){$('bankV3DrawerBody').innerHTML='<div class="bank-empty">'+esc(e.message)+'</div>'}
  }
  function metric(label,value,tone=''){return '<div class="bank-drawer-metric"><span>'+label+'</span><b class="'+tone+'">'+esc(value)+'</b></div>'}

  async function openTransaction(id){
    openDrawer('TRANSACTION','Loading…','<div class="bank-v3-loading"><span></span></div>');
    try{
      const d=await api(FIN+'/transactions/'+id),t=d.transaction,amt=num(t.credit)>0?num(t.credit):-num(t.debit);
      $('bankV3DrawerTitle').textContent=t.merchant_name||t.description||'Transaction';
      $('bankV3DrawerBody').innerHTML='<div style="text-align:center;padding:10px 0 18px"><div style="font-size:.7rem;color:#69727d">'+esc(date(t.transaction_date))+'</div><div class="'+(amt>=0?'bank-positive':'bank-negative')+'" style="font-size:2rem;font-weight:900;margin-top:7px">'+esc(money(amt,t.currency))+'</div></div><div class="bank-drawer-metric-grid">'+metric('Account',t.account_name||'—')+metric('Category',t.category||'Unclassified')+metric('Status',t.reconciliation_status||'—')+metric('Source',t.source_type||'—')+'</div><div class="bank-plan-row"><h3>Reference</h3><p>'+esc(t.reference||'No reference')+'</p></div><div class="bank-plan-row"><h3>Description</h3><p>'+esc(t.description||'—')+'</p></div><div class="bank-plan-row"><h3>Classification</h3><p>'+esc(t.ownership_scope||'—')+(Number(t.is_internal_transfer)?' · Internal transfer':'')+'</p></div>';
    }catch(e){$('bankV3DrawerBody').innerHTML='<div class="bank-empty">'+esc(e.message)+'</div>'}
  }

  async function openStatement(uid){
    openDrawer('STATEMENT','Loading…','<div class="bank-v3-loading"><span></span></div>');
    try{
      const d=await api(FIN+'/statements/'+encodeURIComponent(uid)+'/report'),s=d.statement||{};
      $('bankV3DrawerTitle').textContent=s.original_name||uid;
      const summary=d.summary||{};
      $('bankV3DrawerBody').innerHTML='<div class="bank-drawer-metric-grid">'+metric('Money in',money(summary.money_in||s.money_in||0,s.currency||'AUD'),'bank-positive')+metric('Money out',money(summary.money_out||s.money_out||0,s.currency||'AUD'))+metric('Transactions',String(summary.transaction_count||s.linked_transactions||0))+metric('Unclassified',String(summary.unclassified_transactions||0))+'</div><div class="bank-plan-row"><h3>Account</h3><p>'+esc(s.account_name||'—')+'</p></div><div class="bank-plan-row"><h3>Statement period</h3><p>'+esc(date(s.statement_start_date))+' → '+esc(date(s.statement_end_date))+'</p></div><div class="bank-plan-row"><h3>Source</h3><p>'+esc(s.source_format||'—')+' · '+esc(s.parse_status||'—')+'</p></div>';
    }catch(e){$('bankV3DrawerBody').innerHTML='<div class="bank-empty">'+esc(e.message)+'</div>'}
  }

  function openDrawer(eyebrow,title,body){
    $('bankV3DrawerEyebrow').textContent=eyebrow;$('bankV3DrawerTitle').textContent=title;$('bankV3DrawerBody').innerHTML=body;$('bankV3Drawer').classList.add('open');$('bankV3Drawer').setAttribute('aria-hidden','false');$('bankV3DrawerBackdrop').hidden=false;
  }
  function closeDrawer(){$('bankV3Drawer').classList.remove('open');$('bankV3Drawer').setAttribute('aria-hidden','true');$('bankV3DrawerBackdrop').hidden=true}
  function openModal(eyebrow,title,body){$('bankV3ModalEyebrow').textContent=eyebrow;$('bankV3ModalTitle').textContent=title;$('bankV3ModalBody').innerHTML=body;$('bankV3Modal').showModal()}
  function closeModal(){$('bankV3Modal').close()}

  function newPayment(){
    const accounts=(state.os?.accounts||[]).filter(a=>a.ownership_scope==='BUSINESS'||a.ownership_scope==='PERSONAL');
    openModal('PAYMENT WORKFLOW','Create payment draft','<div class="bank-payment-note"><b>No money moves here.</b> This creates a controlled payment workflow for review/approval. External execution remains disabled until a verified payment provider is connected.</div><form id="bankPaymentForm" class="bank-form"><div class="bank-form-grid"><label>From account<select name="bank_account_id"><option value="">No account selected</option>'+accounts.map(a=>'<option value="'+a.id+'">'+esc(a.nickname)+' · '+esc(a.currency)+'</option>').join('')+'</select></label><label>Scope<select name="ownership_scope"><option value="BUSINESS">Business</option><option value="PERSONAL">Personal</option></select></label></div><label>Payee<input name="payee_name" required maxlength="180"></label><div class="bank-form-grid"><label>Amount<input name="amount" required inputmode="decimal"></label><label>Currency<input name="currency" value="'+esc(activeCurrency())+'" maxlength="3"></label></div><div class="bank-form-grid"><label>Payment type<select name="payment_type"><option value="EXTERNAL">External</option><option value="BILL">Bill</option><option value="PAYROLL">Payroll</option><option value="REIMBURSEMENT">Reimbursement</option><option value="REQUEST_MONEY">Request money</option><option value="INTERNAL">Internal</option></select></label><label>Due date<input type="date" name="due_date"></label></div><label>Reference<input name="reference_text" maxlength="180"></label><div class="bank-form-actions"><button type="button" data-modal-cancel>Cancel</button><button class="primary" type="submit">Create draft</button></div></form>');
    $('[data-modal-cancel]')?.addEventListener('click',closeModal);
    $('bankPaymentForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries(fd.entries());try{const p=await api(OS+'/payments',{method:'POST',body:JSON.stringify(body)});toast(p.message||'Payment draft created.');closeModal();await loadCore();nav('payments')}catch(err){toast(err.message,'error')}});
  }

  function newSpace(){
    openModal('PLAN','Create Money Space','<form id="bankSpaceForm" class="bank-form"><label>Name<input name="name" required maxlength="120" placeholder="Tax reserve, Emergency buffer, Equipment"></label><label>Purpose<input name="purpose" maxlength="255"></label><div class="bank-form-grid"><label>Scope<select name="ownership_scope"><option value="BUSINESS">Business</option><option value="PERSONAL">Personal</option></select></label><label>Currency<input name="currency" value="'+esc(activeCurrency())+'" maxlength="3"></label></div><div class="bank-form-grid"><label>Target amount<input name="target_amount" inputmode="decimal"></label><label>Allocated now<input name="allocated_amount" inputmode="decimal" value="0"></label></div><label>Minimum reserve<input name="minimum_reserve" inputmode="decimal" value="0"></label><div class="bank-form-actions"><button type="button" data-modal-cancel>Cancel</button><button class="primary" type="submit">Create Space</button></div></form>');
    $('[data-modal-cancel]')?.addEventListener('click',closeModal);
    $('bankSpaceForm')?.addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());try{const p=await api(OS+'/spaces',{method:'POST',body:JSON.stringify(body)});toast(p.message||'Money Space created.');closeModal();await loadCore();nav('plan')}catch(err){toast(err.message,'error')}});
  }

  async function saveAlerts(e){
    e.preventDefault();const fd=new FormData(e.currentTarget),body={low_balance_threshold:fd.get('low_balance_threshold'),large_transaction_threshold:fd.get('large_transaction_threshold'),notify_budget:fd.get('notify_budget')==='on',notify_payments:fd.get('notify_payments')==='on',notify_bank_sync:fd.get('notify_bank_sync')==='on',notify_unusual_activity:fd.get('notify_unusual_activity')==='on'};
    try{const p=await api(OS+'/alerts',{method:'POST',body:JSON.stringify(body)});toast(p.message||'Alert preferences saved.');await loadCore()}catch(err){toast(err.message,'error')}
  }

  async function runAnalysis(){
    try{toast('Running finance analysis…');const p=await api(FIN+'/analyse',{method:'POST',body:'{}'});toast(p.message||'Analysis complete.');await loadCore();nav('insights')}catch(e){toast(e.message,'error')}
  }

  function action(name){
    if(name==='add-account')$('addAccount')?.click();
    else if(name==='import')$('importStatement')?.click();
    else if(name==='review')$('openReviewQueue')?.click();
    else if(name==='analyse')runAnalysis();
    else if(name==='new-payment')newPayment();
    else if(name==='new-space')newSpace();
    else if(name==='activity')nav('activity');
    else if(name==='statements')nav('statements');
    else if(name==='home')nav('home');
    else if(name==='plan')nav('plan');
    else if(name==='insights')nav('insights');
    else if(name==='refresh')loadCore();
    else if(name==='connect-bank')$('connectBank')?.click();
    else if(name==='full-report')$('warehouseOpenReport')?.click();
    else if(name==='spending-report')nav('reports');
    else if(name==='banking-portal')location.href='/banking#team';
  }

  function bindDynamic(){
    document.querySelectorAll('[data-bank-action]').forEach(b=>{if(b.dataset.bankBound)return;b.dataset.bankBound='1';b.addEventListener('click',()=>action(b.dataset.bankAction))});
    document.querySelectorAll('[data-bank-view-jump]').forEach(b=>{if(b.dataset.bankBound)return;b.dataset.bankBound='1';b.addEventListener('click',()=>nav(b.dataset.bankViewJump))});
    document.querySelectorAll('[data-account-id]').forEach(b=>{if(b.dataset.bankBound)return;b.dataset.bankBound='1';b.addEventListener('click',()=>openAccount(b.dataset.accountId))});
    document.querySelectorAll('[data-tx-id]').forEach(b=>{if(b.dataset.bankBound)return;b.dataset.bankBound='1';b.addEventListener('click',()=>openTransaction(b.dataset.txId))});
    document.querySelectorAll('[data-statement-uid]').forEach(b=>{if(b.dataset.bankBound)return;b.dataset.bankBound='1';b.addEventListener('click',()=>openStatement(b.dataset.statementUid))});
  }

  function bind(){
    document.querySelectorAll('[data-bank-view]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.bankView)));
    $('bankV3DrawerClose')?.addEventListener('click',closeDrawer);$('bankV3DrawerBackdrop')?.addEventListener('click',closeDrawer);$('bankV3ModalClose')?.addEventListener('click',closeModal);
    $('refreshDashboard')?.addEventListener('click',loadCore);
    $('fiGlobalSearch')?.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const q=e.currentTarget.value.trim();nav('activity');setTimeout(()=>{$('bankActivitySearch').value=q;loadActivityFiltered()},20)});
    document.addEventListener('click',e=>{const btn=e.target.closest('[data-bank-action]');if(btn)action(btn.dataset.bankAction)});
  }

  document.addEventListener('DOMContentLoaded',async()=>{
    bind();
    const hash=location.hash.replace('#','');
    if(['home','accounts','activity','payments','plan','insights','statements','reports','team','settings'].includes(hash))state.view=hash;
    document.querySelectorAll('[data-bank-view]').forEach(b=>b.classList.toggle('active',b.dataset.bankView===state.view));
    renderTopActions();
    await loadCore();
  });
})();