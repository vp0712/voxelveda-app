(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STANDALONE = location.pathname === '/banking';
  const FIN = STANDALONE ? '/api/banking/intelligence' : '/api/finance/intelligence';
  const OS = STANDALONE ? '/api/banking/os' : '/api/finance/banking-os';
  const state = { scope:'ALL', currency:'AUD', range:'365', dashboard:null, warehouse:null, budgets:[], insights:[], command:null };

  const money = (value, currency = state.currency) => {
    try { return new Intl.NumberFormat('en-AU',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value||0)); }
    catch { return currency + ' ' + Number(value||0).toFixed(2); }
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v) => Number(v || 0);

  async function api(path) {
    const r = await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json'}});
    let p={}; try{p=await r.json();}catch{}
    if(!r.ok) throw new Error(p.message || ('Request failed ('+r.status+')'));
    return p;
  }

  function dateRange() {
    if(state.range==='ALL') return {};
    const days=Number(state.range||365),to=new Date(),from=new Date();
    from.setDate(from.getDate()-days);
    return {from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10)};
  }
  function dashboardUrl() {
    const q=new URLSearchParams({scope:state.scope}),r=dateRange();
    if(r.from)q.set('from',r.from); if(r.to)q.set('to',r.to);
    return FIN+'/banking-dashboard?'+q.toString();
  }
  function currentFlow(){return (state.dashboard?.flow_by_currency||[]).find(r=>r.currency===state.currency)||{}}
  function currentBalance(){return (state.dashboard?.balances_by_currency||[]).find(r=>r.currency===state.currency)||{}}
  function currentIntel(){return (state.dashboard?.intelligence_by_currency||[]).find(r=>r.currency===state.currency)||{}}
  function currentWarehouse(){return (state.warehouse?.summary_by_currency||[]).find(r=>r.currency===state.currency)||{}}

  function kpi(label,value,detail,icon,tone='') {
    return '<article class="fi-kpi '+tone+'"><span>'+esc(label)+'</span><div class="fi-kpi-icon">'+icon+'</div><strong>'+esc(value)+'</strong><small class="'+esc(detail?.tone||'')+'">'+esc(detail?.text||'')+'</small></article>';
  }

  function renderKpis() {
    const flow=currentFlow(),bal=currentBalance(),intel=currentIntel(),warehouse=currentWarehouse();
    const net=num(flow.money_in)-num(flow.money_out),rate=intel.savings_rate_percent,count=Number(bal.account_count||0);
    $('fiKpiGrid').innerHTML=[
      kpi('Total balance',money(bal.balance),{text:count+' active account'+(count===1?'':'s')},'▣','primary'),
      kpi('Income',money(flow.money_in),{text:Number(flow.transaction_count||0)+' transactions',tone:'good'},'↗'),
      kpi('Expenses',money(flow.money_out),{text:'Transfers excluded',tone:num(flow.money_out)>num(flow.money_in)?'bad':''},'↘'),
      kpi('Cash out',money(flow.cash_out),{text:'Cash category only'},'⇣'),
      kpi('Net cash flow',money(net),{text:net>=0?'Positive cash flow':'Negative cash flow',tone:net>=0?'good':'bad'},'≈'),
      kpi('Bank net position',money(warehouse.bank_net_position??bal.balance),{text:'Selected currency only'},'◆'),
      kpi('Savings rate',rate==null?'—':Number(rate).toFixed(1)+'%',{text:intel.evidence_months?intel.evidence_months+' month evidence':'Not enough history',tone:num(rate)>=0?'good':'bad'},'●')
    ].join('');
  }

  function renderLineChart(){
    const rows=(state.dashboard?.monthly||[]).filter(r=>r.currency===state.currency).slice(-12),host=$('fiIncomeExpenseChart');
    if(!rows.length){host.innerHTML='<div class="fi-empty-mini">Import statement history to see income and expense trends.</div>';return;}
    const w=720,h=210,padX=26,padY=24,max=Math.max(1,...rows.flatMap(r=>[num(r.money_in),num(r.money_out)]));
    const point=(v,i)=>[padX+(rows.length===1?0:i*(w-padX*2)/(rows.length-1)),h-padY-(num(v)/max)*(h-padY*2)];
    const path=(key)=>rows.map((r,i)=>point(r[key],i).join(',')).join(' ');
    const grid=[.25,.5,.75,1].map(p=>'<line class="fi-svg-grid" x1="'+padX+'" y1="'+(h-padY-p*(h-padY*2))+'" x2="'+(w-padX)+'" y2="'+(h-padY-p*(h-padY*2))+'"/>').join('');
    const labels=rows.map((r,i)=>{const x=point(0,i)[0];return '<text x="'+x+'" y="'+(h-5)+'" text-anchor="middle" fill="#75859b" font-size="10">'+esc(String(r.month||'').slice(5))+'</text>';}).join('');
    const dots=rows.map((r,i)=>{const a=point(r.money_in,i),b=point(r.money_out,i);return '<circle class="fi-svg-dot-income" cx="'+a[0]+'" cy="'+a[1]+'" r="3"/><circle class="fi-svg-dot-expense" cx="'+b[0]+'" cy="'+b[1]+'" r="3"/>';}).join('');
    host.innerHTML='<svg class="fi-svg-chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+grid+'<polyline class="fi-svg-income" points="'+path('money_in')+'"/><polyline class="fi-svg-expense" points="'+path('money_out')+'"/>'+dots+labels+'</svg><div class="fi-chart-legend"><span><i style="background:#f2c500"></i>Income</span><span><i style="background:#c9d2df"></i>Expenses</span></div>';
  }

  function renderDonut(){
    const rows=(state.dashboard?.categories||[]).filter(r=>r.currency===state.currency&&num(r.spent)>0).slice(0,7),host=$('fiCategoryDonut'),total=rows.reduce((s,r)=>s+num(r.spent),0);
    if(!total){host.innerHTML='<div class="fi-empty-mini">No categorised spending in this period.</div>';return;}
    const colors=['#f2c500','#d6b80e','#a99420','#d7dbe1','#aab3bf','#748296','#56667b'];let angle=0;
    const stops=rows.map((r,i)=>{const start=angle;angle+=num(r.spent)/total*360;return colors[i]+' '+start.toFixed(1)+'deg '+angle.toFixed(1)+'deg';}).join(',');
    host.innerHTML='<div class="fi-donut-wrap"><div class="fi-donut" style="background:conic-gradient('+stops+')"><div class="fi-donut-center"><strong>'+esc(money(total))+'</strong><small>Total spent</small></div></div><div class="fi-donut-legend">'+rows.map((r,i)=>'<div class="fi-donut-row"><i style="background:'+colors[i]+'"></i><span>'+esc(r.category)+'</span><b>'+Math.round(num(r.spent)/total*100)+'%</b></div>').join('')+'</div></div>';
  }

  function renderBars(){
    const rows=(state.dashboard?.monthly||[]).filter(r=>r.currency===state.currency).slice(-6),host=$('fiCashflowBars');
    if(!rows.length){host.innerHTML='<div class="fi-empty-mini">No monthly cash-flow history yet.</div>';return;}
    const max=Math.max(1,...rows.flatMap(r=>[num(r.money_in),num(r.money_out),Math.max(0,num(r.money_in)-num(r.money_out))]));
    const h=v=>Math.max(3,Math.round(num(v)/max*145));
    host.innerHTML='<div class="fi-bar-chart">'+rows.map(r=>{const save=Math.max(0,num(r.money_in)-num(r.money_out));return '<div class="fi-bar-group"><span class="fi-bar-income" style="height:'+h(r.money_in)+'px"></span><span class="fi-bar-expense" style="height:'+h(r.money_out)+'px"></span><span class="fi-bar-save" style="height:'+h(save)+'px"></span><small>'+esc(String(r.month||'').slice(5))+'</small></div>';}).join('')+'</div><div class="fi-chart-legend"><span><i style="background:#f2c500"></i>Income</span><span><i style="background:#c9d2df"></i>Expenses</span><span><i style="background:#776825"></i>Savings</span></div>';
  }

  function renderAccounts(){
    const rows=(state.dashboard?.accounts||[]).filter(a=>a.currency===state.currency).slice(0,5),host=$('fiAccountSummary');
    host.innerHTML=rows.length?'<div class="fi-list">'+rows.map(a=>{const bal=num(a.available_balance??a.current_ledger_balance);return '<div class="fi-list-row"><div class="fi-account-left"><span class="fi-account-logo">'+esc((a.institution||a.nickname||'B').slice(0,1).toUpperCase())+'</span><div><strong>'+esc(a.nickname||'Account')+'</strong><small>'+esc(a.institution||'Manual')+' · '+esc(a.account_number_masked||state.currency)+'</small></div></div><div class="fi-list-value"><b>'+esc(money(bal,a.currency||state.currency))+'</b><small>'+Number(a.transaction_count||0)+' txns</small></div></div>';}).join('')+'</div>':'<div class="fi-empty-mini">No accounts in this currency.</div>';
  }

  function flag(currency){return ({AUD:'🇦🇺',USD:'🇺🇸',GBP:'🇬🇧',EUR:'🇪🇺',INR:'🇮🇳',NZD:'🇳🇿',CAD:'🇨🇦',JPY:'🇯🇵',SGD:'🇸🇬'})[currency]||'¤'}
  function renderCurrencies(){
    const rows=state.dashboard?.balances_by_currency||[];
    $('fiCurrencySummary').innerHTML=rows.length?'<div class="fi-list">'+rows.map(r=>'<div class="fi-list-row"><div><strong><span class="fi-currency-flag">'+flag(r.currency)+'</span>'+esc(r.currency)+'</strong><small>'+Number(r.account_count||0)+' account'+(Number(r.account_count||0)===1?'':'s')+'</small></div><div class="fi-list-value"><b>'+esc(money(r.balance,r.currency))+'</b></div></div>').join('')+'</div>':'<div class="fi-empty-mini">No currency balances yet.</div>';
  }

  function renderObligations(){
    const raw=state.command?.obligations?.items||state.command?.obligations||state.command?.calendar||[],approvals=state.command?.approval_inbox||[],rows=Array.isArray(raw)?raw.slice(0,3):[];
    let html=approvals.length?'<div class="fi-list-row"><div><strong>Approvals waiting</strong><small>Banking workflow</small></div><div class="fi-list-value"><b>'+approvals.length+'</b></div></div>':'';
    html+=rows.map(o=>'<div class="fi-list-row"><div><strong>'+esc(o.title||o.description||o.payee_name||'Scheduled obligation')+'</strong><small>'+esc(String(o.due_date||o.scheduled_for||'').slice(0,10)||'Upcoming')+'</small></div><div class="fi-list-value"><b>'+(o.amount!=null?esc(money(o.amount,o.currency||state.currency)):'—')+'</b></div></div>').join('');
    $('fiObligations').innerHTML=html||'<div class="fi-empty-mini">No upcoming obligations or approvals.</div>';
  }

  function renderInsights(){
    const intel=currentIntel(),explicit=Array.isArray(state.insights)?state.insights:(state.insights?.insights||[]),alerts=Array.isArray(intel.alerts)?intel.alerts:[];
    const rows=[...alerts.map(a=>({message:a.message,severity:a.severity})),...explicit.slice(0,4).map(i=>({message:i.explanation||i.message||i.title||'Finance insight',severity:i.severity||'INFO'}))].slice(0,5);
    $('fiAiInsights').innerHTML=rows.length?rows.map(r=>'<div class="fi-insight-item"><span class="fi-insight-icon">'+(String(r.severity).toUpperCase()==='HIGH'?'!':'✦')+'</span><p>'+esc(r.message)+'</p><span>›</span></div>').join(''):'<div class="fi-empty-mini">No active finance insights. Run analysis after importing statements.</div>';
  }

  function renderRecent(){
    const rows=(state.dashboard?.recent_transactions||[]).filter(r=>r.currency===state.currency).slice(0,8);
    $('fiRecentTransactions').innerHTML=rows.length?'<table class="fi-mini-table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Amount</th><th>Status</th></tr></thead><tbody>'+rows.map(r=>{const outgoing=num(r.debit)>0,amount=outgoing?-num(r.debit):num(r.credit);return '<tr><td>'+esc(String(r.transaction_date||'').slice(0,10))+'</td><td>'+esc(r.merchant_name||r.description||'Transaction')+'</td><td>'+esc(r.category||'Unclassified')+'</td><td>'+esc(r.account_name||'')+'</td><td class="'+(amount>=0?'fi-positive':'fi-negative')+'">'+esc(money(amount,r.currency||state.currency))+'</td><td><span class="fi-status-pill">'+esc(r.reconciliation_status||'Imported')+'</span></td></tr>';}).join('')+'</tbody></table>':'<div class="fi-empty-mini">No transactions in this currency and period.</div>';
  }

  function renderMonthlyTable(){
    const rows=(state.dashboard?.monthly||[]).filter(r=>r.currency===state.currency).slice(-6).reverse();
    $('fiMonthlyComparison').innerHTML=rows.length?'<div class="fi-month-row head"><span>Month</span><span>Income</span><span>Expenses</span><span>Savings</span></div>'+rows.map((r,i)=>'<div class="fi-month-row '+(i===0?'current':'')+'"><span>'+esc(r.month)+'</span><span>'+esc(money(r.money_in))+'</span><span>'+esc(money(r.money_out))+'</span><span>'+esc(money(num(r.money_in)-num(r.money_out)))+'</span></div>').join(''):'<div class="fi-empty-mini">No monthly history.</div>';
  }

  function renderReports(){
    $('fiReportShortcuts').innerHTML=[
      ['▤','Full history report','All visible accounts','overall'],
      ['▦','Statement library','Imported statement history','statements'],
      ['⇩','Transaction history','CSV through full report','overall'],
      ['≈','Cash-flow analysis','Income, expenses & trends','cashflow']
    ].map(x=>'<div class="fi-report-link" data-fi-report="'+x[3]+'"><div><span class="fi-report-icon">'+x[0]+'</span><div><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div></div><span>↓</span></div>').join('');
    document.querySelectorAll('[data-fi-report]').forEach(el=>el.addEventListener('click',()=>{const a=el.dataset.fiReport;if(a==='overall')document.getElementById('vvOverallReport')?.click();else navigate(a);}));
  }

  function renderCurrencyOptions(){
    const currencies=[...new Set((state.dashboard?.balances_by_currency||[]).map(r=>r.currency).filter(Boolean))];
    if(!currencies.length)currencies.push('AUD');
    if(!currencies.includes(state.currency))state.currency=currencies.includes('AUD')?'AUD':currencies[0];
    $('fiDashboardCurrency').innerHTML=currencies.map(c=>'<option value="'+esc(c)+'" '+(c===state.currency?'selected':'')+'>'+esc(c)+'</option>').join('');
  }

  function renderAll(){renderCurrencyOptions();renderKpis();renderLineChart();renderDonut();renderBars();renderAccounts();renderCurrencies();renderObligations();renderInsights();renderRecent();renderMonthlyTable();renderReports();}

  async function load(){
    const results=await Promise.allSettled([
      api(dashboardUrl()),
      api(FIN+'/statement-warehouse?scope='+encodeURIComponent(state.scope)),
      api(FIN+'/budgets'),
      api(FIN+'/insights?scope='+encodeURIComponent(state.scope)),
      api(OS+'/command-center')
    ]);
    if(results[0].status==='fulfilled')state.dashboard=results[0].value;
    if(results[1].status==='fulfilled')state.warehouse=results[1].value;
    if(results[2].status==='fulfilled')state.budgets=results[2].value?.budgets||[];
    if(results[3].status==='fulfilled')state.insights=results[3].value;
    if(results[4].status==='fulfilled')state.command=results[4].value;
    renderAll();
  }

  function navigate(view){
    const direct=['accounts','statements','categories','reports','insights','settings'].includes(view);
    document.body.dataset.fiView=direct?view:'dashboard';
    document.querySelectorAll('[data-fi-nav]').forEach(b=>b.classList.toggle('active',b.dataset.fiNav===view));
    if(view==='transactions')$('fiRecentTransactions')?.scrollIntoView({behavior:'smooth',block:'center'});
    else if(view==='cashflow')$('fiCashflowBars')?.scrollIntoView({behavior:'smooth',block:'center'});
    else if(view==='team'){
      const team=document.querySelector('[data-pb-tab="team"]');
      if(team)team.click(); else document.querySelector('[data-fi-section="settings"]')?.scrollIntoView({behavior:'smooth'});
    } else if(direct) document.querySelector('[data-fi-section="'+view+'"]')?.scrollIntoView({behavior:'smooth',block:'start'});
    else window.scrollTo({top:0,behavior:'smooth'});
  }

  function bind(){
    document.body.dataset.fiView='dashboard';
    document.querySelectorAll('[data-fi-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.fiNav)));
    document.querySelectorAll('[data-fi-jump]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.fiJump)));
    document.querySelectorAll('[data-v2-scope]').forEach(b=>b.addEventListener('click',async()=>{
      state.scope=b.dataset.v2Scope;
      document.querySelectorAll('[data-v2-scope]').forEach(x=>x.classList.toggle('active',x===b));
      document.querySelectorAll('.scope[data-scope]').forEach(x=>x.classList.toggle('active',x.dataset.scope===state.scope));
      await load();
    }));
    $('fiDashboardCurrency')?.addEventListener('change',()=>{state.currency=$('fiDashboardCurrency').value;renderAll();});
    $('fiDashboardRange')?.addEventListener('change',async()=>{state.range=$('fiDashboardRange').value;await load();});
    $('refreshDashboardSecondary')?.addEventListener('click',()=>load());
    $('fiGlobalSearch')?.addEventListener('keydown',(e)=>{
      if(e.key!=='Enter')return;
      const q=e.currentTarget.value.trim().toLowerCase(); if(!q)return;
      navigate('transactions');
      [...document.querySelectorAll('#fiRecentTransactions tbody tr')].forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(q));
    });
  }

  document.addEventListener('DOMContentLoaded',async()=>{
    bind();
    try{await load();}catch(error){
      $('fiDashboardV2')?.insertAdjacentHTML('afterbegin','<div class="notice error">Finance dashboard could not load: '+esc(error.message)+'</div>');
    }
  });
})();