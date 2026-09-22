(() => {
'use strict';
const $=id=>document.getElementById(id);
const API='/api/finance';
const I=API+'/intelligence';
const OS=API+'/banking-os';
const state={
  view:'overview',scope:'ALL',account:'',period:'month',customFrom:'',customTo:'',
  dash:null,tx:[],txMeta:{page:1,limit:50,total:0,total_pages:1,summary:{}},statements:[],reviews:[],
  os:null,personal:null,personalAttention:null,readiness:null,accounts:[],capabilities:null,
  insights:null,rules:null,quality:null,reconciliation:null,history:null,setup:null,team:null,
  resources:{},txFilters:{q:'',type:'',category:'',merchant:'',source:'',reconciliation_status:'',amount_min:'',amount_max:''}
};
const NAV_GROUPS=[
 ['HOME',[['overview','⌂','Overview'],['personal','◉','My Money'],['company','◆','Company Finance'],['consolidated','◎','Consolidated']]],
 ['MONEY',[['accounts','▣','Accounts'],['transactions','↕','Transactions'],['cash','¤','Cash'],['debt','⇄','Borrow & Lend'],['recurring','⟳','Recurring']]],
 ['DOCUMENTS',[['statements','▤','Statements']]],
 ['PLANNING',[['budgets','◫','Budgets'],['savings','◎','Savings Goals']]],
 ['INTELLIGENCE',[['insights','✦','Insights'],['rules','⌁','Rules'],['review','!','Review Centre'],['reconciliation','✓','Reconciliation']]],
 ['REPORTING',[['reports','▧','Reports']]],
 ['CONTROL',[['team','♙','Team Access'],['connections','◌','Banking Connections'],['settings','⚙','Finance Settings']]]
];
const NAV=NAV_GROUPS.flatMap(([,items])=>items);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0);
const money=(v,c='AUD')=>{try{return new Intl.NumberFormat('en-AU',{style:'currency',currency:c||'AUD'}).format(num(v))}catch{return Number(v||0).toFixed(2)}};
const nativeMoney=(v,c)=>money(v,c||'AUD');
const date=v=>v?new Intl.DateTimeFormat('en-AU',{dateStyle:'medium'}).format(new Date(String(v).slice(0,10)+'T00:00:00')):'—';
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let body={};try{body=await r.json()}catch{}if(!r.ok){const e=new Error(body.message||'Request failed');e.status=r.status;e.code=body.code;throw e}return body}
function notice(m,bad=false){const n=$('fmNotice');n.hidden=!m;n.textContent=m||'';n.style.background=bad?'#fde9eb':'#fff8dc';n.style.color=bad?'#8f2732':'#725600'}
function navButtons(){
 $('fmNav').innerHTML=NAV_GROUPS.map(([group,items])=>\`<div class="fm-nav-group"><small>\${esc(group)}</small>\${items.map(([v,i,l])=>\`<button type="button" data-view="\${v}" class="\${state.view===v?'active':''}"><span>\${i}</span>\${l}</button>\`).join('')}</div>\`).join('');
 $('fmNav').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
}
function title(v){return ({
 overview:['Finance Overview','Balances and selected-period cash flow are deliberately separated.'],
 personal:['My Money','Owner-only personal money, debt, goals and recurring obligations.'],
 company:['Company Finance','Voxel Veda business cash position, payables and operational finance.'],
 consolidated:['Consolidated','Permitted Personal and Company accounts shown side-by-side without blurring ownership.'],
 accounts:['Accounts','Bank, savings, credit, cash and loan accounts with coverage and lifecycle controls.'],
 transactions:['Transaction Explorer','Server-filtered financial movements with preserved source evidence.'],
 statements:['Statement Vault','Upload, review, duplicate-check and commit statements without overwriting source evidence.'],
 cash:['Cash','Cash wallets and cash-type financial accounts.'],
 debt:['Borrow & Lend','Owner-only debt lifecycle with repayments and remaining balances.'],
 recurring:['Recurring Money','Known and detected recurring commitments; nothing is paid automatically.'],
 budgets:['Budgets','Personal and banking budget controls backed by current finance records.'],
 savings:['Savings Goals','Track goals and contributions without pretending that progress automatically moves cash.'],
 insights:['Finance Insights','Evidence-backed finance intelligence linked to underlying transactions.'],
 rules:['Categories & Rules','Merchant categorisation rules create suggestions; they do not silently post changes.'],
 review:['Data Quality Review','Uncategorised, unreconciled, coverage and other review queues.'],
 reconciliation:['Reconciliation','Bank transaction reconciliation inside the master Finance OS.'],
 reports:['Reports','Trusted exports and report-ready filtered transaction data.'],
 team:['Team Finance Access','Server-enforced banking and finance access controls.'],
 connections:['Banking Connections','Open Banking readiness and sync status; fail-closed when not configured.'],
 settings:['Finance Settings','Capability status, safety controls and company finance configuration.']
 })[v]||['Finance','Finance workspace']}

function isoDay(d){return d.toISOString().slice(0,10)}
function dateRange(){
 const now=new Date(); const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const clone=()=>new Date(today.getTime()); let from=null,to=isoDay(today);
 const startOfWeek=()=>{const d=clone();const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return d};
 const qStart=(d)=>new Date(d.getFullYear(),Math.floor(d.getMonth()/3)*3,1);
 const fyStart=(d,offset=0)=>{const month=Math.max(1,Math.min(12,Number(state.setup?.financial_year_start_month||7)))-1;const day=Math.max(1,Math.min(28,Number(state.setup?.financial_year_start_day||1)));let year=d.getFullYear();const candidate=new Date(year,month,day);if(d<candidate)year-=1;return new Date(year+offset,month,day)};
 switch(state.period){
  case 'today': from=clone(); break;
  case 'yesterday': {const d=clone();d.setDate(d.getDate()-1);from=d;to=isoDay(d);break}
  case 'week': from=startOfWeek(); break;
  case 'last7': {const d=clone();d.setDate(d.getDate()-6);from=d;break}
  case 'last_month': {from=new Date(today.getFullYear(),today.getMonth()-1,1);const d=new Date(today.getFullYear(),today.getMonth(),0);to=isoDay(d);break}
  case 'last30': {const d=clone();d.setDate(d.getDate()-29);from=d;break}
  case 'quarter': from=qStart(today); break;
  case 'previous_quarter': {const cur=qStart(today);from=new Date(cur.getFullYear(),cur.getMonth()-3,1);const d=new Date(cur.getFullYear(),cur.getMonth(),0);to=isoDay(d);break}
  case 'fy': from=fyStart(today); break;
  case 'previous_fy': {from=fyStart(today,-1);const d=fyStart(today,0);d.setDate(d.getDate()-1);to=isoDay(d);break}
  case 'year': from=new Date(today.getFullYear(),0,1); break;
  case 'custom': return {from:state.customFrom||null,to:state.customTo||null};
  case 'month': default: from=new Date(today.getFullYear(),today.getMonth(),1);
 }
 return {from:from?isoDay(from):null,to:to||null};
}
function filterQuery(extra={}){
 const range=dateRange();const p=new URLSearchParams();
 p.set('scope',state.scope); if(state.account)p.set('account_id',state.account);
 if(range.from)p.set('from',range.from);if(range.to)p.set('to',range.to);
 Object.entries(extra).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')p.set(k,v)});
 return '?'+p.toString();
}
function setResource(name,status,data=null,error=null){state.resources[name]={status,data,error};if(data!==null)state[name]=data}
async function loadResource(name,path){
 setResource(name,'loading');
 try{const data=await api(path);setResource(name,'loaded',data);return data}
 catch(error){setResource(name,error.status===403?'permission':'error',null,error);return null}
}
function resourceError(name,label){
 const r=state.resources[name];if(!r||r.status==='loaded')return '';
 const message=r.status==='permission'?'You do not have permission to view this finance component.':(r.error?.message||'This finance component is unavailable.');
 return \`<div class="fm-state fm-state-error"><strong>\${esc(label)}</strong><p>\${esc(message)}</p><button type="button" data-retry="1">Retry</button></div>\`;
}
function currencyRows(){
 const balances=Array.isArray(state.dash?.balances_by_currency)?state.dash.balances_by_currency:[];
 const flows=Array.isArray(state.dash?.flow_by_currency)?state.dash.flow_by_currency:[];
 return [...new Set([...balances.map(x=>x.currency),...flows.map(x=>x.currency)].filter(Boolean))].map(currency=>({
  currency,
  balance:num(balances.find(x=>x.currency===currency)?.balance),
  money_in:num(flows.find(x=>x.currency===currency)?.money_in),
  money_out:num(flows.find(x=>x.currency===currency)?.money_out),
  net_flow:num(flows.find(x=>x.currency===currency)?.net_flow),
  unclassified:num(flows.find(x=>x.currency===currency)?.unclassified)
 }));
}
function mixedCurrencyMessage(rows){return rows.length>1?'Mixed currencies — consolidated total unavailable until verified FX rates are available.':''}
function statusBadge(status){const v=String(status||'UNKNOWN').toUpperCase();const tone=['READY','ACTIVE','RECONCILED','BALANCED','SUCCESS','COMPLETED'].includes(v)?'good':['BLOCKED','ERROR','FAILED','MISMATCH','OVERDUE'].includes(v)?'bad':'warn';return \`<span class="fm-badge \${tone}">\${esc(v)}</span>\`}
function emptyState(title,message,action=''){return \`<div class="fm-empty"><strong>\${esc(title)}</strong><span>\${esc(message)}</span>\${action}</div>\`}
async async function loadBase(){
 const base=filterQuery();
 const [setup,capabilities,dash,tx,st,reviews,personal,attention,readiness,insights,rules,quality,reconciliation,history,team]=await Promise.all([
  loadResource('setup',API+'/setup'),
  loadResource('capabilities',API+'/capabilities'),
  loadResource('dash',I+'/banking-dashboard'+base),
  loadResource('txPayload',I+'/transactions'+filterQuery({page:state.txMeta.page,limit:state.txMeta.limit,...state.txFilters})),
  loadResource('statementPayload',I+'/statements'+base),
  loadResource('reviewPayload',I+'/statement-reviews'),
  loadResource('personal',API+'/personal-money'),
  loadResource('personalAttention',API+'/personal-money/attention'),
  loadResource('readiness',I+'/banking-readiness'),
  loadResource('insights',I+'/insights'+filterQuery()),
  loadResource('rules',I+'/rules'),
  loadResource('quality',I+'/data-quality'+base),
  loadResource('reconciliation',I+'/reconciliation'+filterQuery()),
  loadResource('history',I+'/history-coverage'+base),
  loadResource('team',OS+'/team')
 ]);
 state.setup=setup||state.setup;state.capabilities=capabilities||null;state.dash=dash||null;
 if(tx){state.tx=tx.transactions||[];state.txMeta={page:num(tx.page)||1,limit:num(tx.limit)||50,total:num(tx.total),total_pages:num(tx.total_pages)||1,summary:tx.summary||{}}}
 else{state.tx=[]}
 state.statements=st?.statements||[];state.reviews=reviews?.sessions||[];
 state.personal=personal||null;state.personalAttention=attention||null;state.readiness=readiness||null;
 state.insights=insights||null;state.rules=rules||null;state.quality=quality||null;state.reconciliation=reconciliation||null;state.history=history||null;state.team=team||null;
 state.accounts=dash?.accounts||[];
 if(!state.accounts.length){
  const accounts=await loadResource('accountPayload',I+'/accounts?scope='+encodeURIComponent(state.scope));
  state.accounts=accounts?.accounts||[];
 }
 const sel=$('fmAccount');const keep=state.account;sel.innerHTML='<option value="">All permitted accounts</option>'+state.accounts.map(a=>\`<option value="\${a.id}">\${esc(a.nickname||a.account_name||'Account')} · \${esc(a.currency||'AUD')}</option>\`).join('');sel.value=keep;
}
function hero(){
 const d=state.dash||{};const summary=d.summary||d.totals||{};const bal=summary.total_balance??summary.balance??d.total_balance??0;const inc=summary.income??summary.money_in??0;const exp=summary.expenses??summary.money_out??0;const net=summary.net_cash_flow??(num(inc)-num(exp));
 return `<div class="fm-grid two"><article class="fm-card fm-hero"><div class="fm-pad"><small>TOTAL NET BALANCE</small><strong>${money(bal)}</strong><p>Current position across the selected workspace and accounts.</p><div class="fm-hero-actions"><button class="accent" data-quick="expense">Add expense</button><button data-quick="income">Add income</button><button data-quick="statement">Upload statement</button><button data-viewjump="reports">Report</button></div></div></article>
 <div class="fm-grid two"><div class="fm-kpi"><span>Income</span><strong class="good">${money(inc)}</strong><small>Selected period</small></div><div class="fm-kpi"><span>Expenses</span><strong class="bad">${money(exp)}</strong><small>Transfers excluded where classified</small></div><div class="fm-kpi"><span>Net cash flow</span><strong>${money(net)}</strong><small>Income minus expenses</small></div><div class="fm-kpi"><span>Needs review</span><strong class="warn">${num((state.os||{}).attention_count||(d.data_quality||{}).needs_review||0)}</strong><small>Data quality and approvals</small></div></div></div>`;
}
function recentRows(){
 const rows=state.tx.slice(0,8);return rows.length?rows.map(r=>{const out=num(r.debit||0)>0;const amount=out?-num(r.debit):num(r.credit||r.amount);return `<div class="fm-row" data-tx="${r.id}"><div><h3>${esc(r.merchant_name||r.description||'Transaction')}</h3><p>${date(r.transaction_date||r.effective_date)} · ${esc(r.account_name||r.bank_name||'Account')} · ${esc(r.category||'Uncategorised')}</p></div><div class="fm-row-right"><b class="${amount<0?'bad':'good'}">${money(amount,r.currency||state.currency)}</b><small>${esc(r.reconciliation_status||r.status||'')}</small></div></div>`}).join(''):'<div class="fm-empty"><strong>No transactions yet</strong>Import a statement or add a transaction.</div>';
}
function overview(){
 const accounts=state.accounts.slice(0,5).map(a=>`<div class="fm-row" data-account="${a.id}"><div><h3>${esc(a.nickname||a.account_name||'Account')}</h3><p>${esc(a.institution||'Financial account')} · ${esc(a.ownership_scope||'')}</p></div><div class="fm-row-right"><b>${money(a.available_balance??a.current_ledger_balance,a.currency||state.currency)}</b><small>${esc(a.currency||'AUD')}</small></div></div>`).join('');
 return hero()+`<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Recent transactions</h2><p>Every number is drillable to source transactions.</p></div><button data-viewjump="transactions">View all</button></div><div class="fm-list">${recentRows()}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Accounts</h2><p>Current account positions.</p></div><button data-viewjump="accounts">Manage</button></div><div class="fm-list">${accounts||'<div class="fm-empty">No accounts yet.</div>'}</div></div></article></div>`;
}
function accounts(){return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Financial accounts</h2><p>Personal, company, savings, credit, cash and loans stay separately identifiable.</p></div><button data-quick="account">+ Add account</button></div><div class="fm-list">${state.accounts.map(a=>`<div class="fm-row" data-account="${a.id}"><div><h3>${esc(a.nickname||a.account_name||'Account')}</h3><p>${esc(a.institution||'')} · ${esc(a.account_type||'Account')} · ${esc(a.ownership_scope||'')}</p></div><div class="fm-row-right"><b>${money(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</b><small>${esc(a.status||'ACTIVE')}</small></div></div>`).join('')||'<div class="fm-empty"><strong>No accounts yet</strong>Add an account or import a statement.</div>'}</div></div></article>`}
function transactions(){return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Master transaction ledger</h2><p>Bank, statement, manual and cash movements in one explorer.</p></div><button data-quick="expense">+ Transaction</button></div><div class="fm-toolbar"><input id="txSearch" placeholder="Search merchant, description, amount, account"><select id="txType"><option value="">All types</option><option>Expense</option><option>Income</option><option>Transfer</option><option>Refund</option></select></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Category</th><th>Scope</th><th>Debit</th><th>Credit</th><th>Status</th></tr></thead><tbody>${state.tx.map(r=>`<tr data-tx="${r.id}"><td>${date(r.transaction_date||r.effective_date)}</td><td>${esc(r.account_name||'')}</td><td>${esc(r.merchant_name||r.description||'')}</td><td>${esc(r.category||'Uncategorised')}</td><td>${esc(r.ownership_scope||'')}</td><td>${num(r.debit)?money(r.debit,r.currency):''}</td><td>${num(r.credit)?money(r.credit,r.currency):''}</td><td><span class="fm-badge">${esc(r.reconciliation_status||r.status||'')}</span></td></tr>`).join('')}</tbody></table></div></div></article>`}
function statements(){return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement vault</h2><p>Historical files are reviewed before commit and linked to the correct account.</p></div><button data-quick="statement">Upload statement</button></div><div class="fm-list">${state.statements.map(s=>`<div class="fm-row"><div><h3>${esc(s.original_name||s.filename||'Statement')}</h3><p>${esc(s.account_name||'')} · ${date(s.statement_start_date)} – ${date(s.statement_end_date)} · ${esc(s.source_format||'')}</p></div><div class="fm-row-right"><b>${num(s.imported_rows||0)} imported</b><small>${num(s.duplicate_rows||0)} duplicates · ${num(s.rejected_rows||0)} rejected</small></div></div>`).join('')||'<div class="fm-empty"><strong>No statements imported</strong>Upload PDF, CSV, XLSX, OFX or QFX.</div>'}</div></div></article>`}
function personalCard(kind){const p=state.personal||{};const data=kind==='budgets'?(p.budgets||[]):kind==='savings'?(p.goals||p.savings_goals||[]):(p.debts||[]);return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>${kind==='budgets'?'Budgets':kind==='savings'?'Savings goals':'Borrow & lend'}</h2><p>Powered by your current personal finance records.</p></div></div><div class="fm-list">${Array.isArray(data)&&data.length?data.map(x=>`<div class="fm-row"><div><h3>${esc(x.name||x.category||x.person_name||x.title||'Item')}</h3><p>${esc(x.status||x.frequency||'')}</p></div><div class="fm-row-right"><b>${money(x.amount||x.goal_amount||x.remaining_balance||x.budget_amount||0,x.currency||state.currency)}</b></div></div>`).join(''):'<div class="fm-empty"><strong>No records yet</strong>Add records from the New menu.</div>'}</div></div></article>`}
function simpleView(v){if(v==='cash')return `<div class="fm-grid two">${hero()}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Cash tracking</h2><p>Cash is treated as a real financial account, not an afterthought.</p></div></div><div class="fm-empty"><strong>Cash data is included in the finance ledger.</strong>Use New → Cash transaction to record cash movements.</div></div></article></div>`;if(['budgets','savings','debt'].includes(v))return personalCard(v);if(v==='reports')return reportView();if(v==='review')return reviewView();if(v==='reconciliation')return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Reconciliation centre</h2><p>Use the existing audited reconciliation engine without rebuilding duplicate logic.</p></div><button onclick="location.href='/finance-reconciliation'">Open reconciliation</button></div></div></article>`;if(v==='audit')return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Audit trail</h2><p>Finance changes are recorded server-side with user and timestamp evidence.</p></div><button onclick="location.href='/admin?view=audit'">Open audit log</button></div></div></article>`;const r=state.readiness||{};const controls=Array.isArray(r.controls)?r.controls:[];return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Banking Setup & Safety</h2><p>${esc(r.headline||'Checking banking readiness…')}</p></div><span class="fm-badge ${r.overall==='PRODUCTION_READY'?'good':'warn'}">${esc(r.overall||'CHECKING')}</span></div><div class="fm-list">${controls.map(c=>`<div class="fm-row"><div><h3>${esc(c.plain_name||c.label||c.key)}</h3><p>${esc(c.detail||c.description||'')}</p></div><span class="fm-badge ${c.status==='READY'?'good':c.status==='BLOCKED'?'bad':'warn'}">${esc(c.status||'UNKNOWN')}</span></div>`).join('')||'<div class="fm-empty">No readiness data available.</div>'}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Finance settings</h2><p>Company information, default currency, financial year and report controls.</p></div><button onclick="location.href='/admin?view=finance'">Open finance settings</button></div><div class="fm-list"><div class="fm-row"><div><h3>Manual statement import</h3><p>Upload → review → approve. No bank password, PIN or OTP is collected.</p></div><span class="fm-badge good">Available</span></div><div class="fm-row"><div><h3>Open Banking</h3><p>${esc(r.open_banking?.explanation||'Fail-closed until provider and production controls are verified.')}</p></div><span class="fm-badge ${r.open_banking?.enabled?'good':'warn'}">${r.open_banking?.enabled?'Enabled':'Locked'}</span></div></div></div></article></div>`}
function reportView(){return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Report centre</h2><p>Generate reports from the same trusted finance data used by dashboards.</p></div></div><div class="fm-quick-grid"><button class="fm-quick" onclick="location.href='/api/finance/exports/accountant-review.pdf'"><span>PDF</span><b>Accountant review</b><small>Protected PDF export</small></button><button class="fm-quick" onclick="location.href='/api/finance/exports/trial-balance.csv'"><span>CSV</span><b>Trial balance</b><small>CSV export</small></button><button class="fm-quick" data-viewjump="statements"><span>▤</span><b>Statement history</b><small>Multi-bank history</small></button><button class="fm-quick" data-viewjump="transactions"><span>↕</span><b>Transaction report</b><small>Filter the ledger</small></button></div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Reporting integrity</h2><p>Balances and cash-flow are kept conceptually separate.</p></div></div><div class="fm-list"><div class="fm-row"><div><h3>Original bank data</h3><p>Preserved for imported statement transactions.</p></div><span class="fm-badge good">Enabled</span></div><div class="fm-row"><div><h3>Cross-currency totals</h3><p>Not combined without explicit FX source.</p></div><span class="fm-badge good">Protected</span></div></div></div></article></div>`}
function reviewView(){const d=state.dash?.data_quality||state.os?.data_quality||{};return `<div class="fm-grid four"><div class="fm-kpi"><span>Uncategorised</span><strong>${num(d.unclassified_transactions||d.uncategorised||0)}</strong></div><div class="fm-kpi"><span>Unreconciled</span><strong>${num(d.unreconciled_transactions||d.unreconciled||0)}</strong></div><div class="fm-kpi"><span>Ownership missing</span><strong>${num(d.ownership_missing||0)}</strong></div><div class="fm-kpi"><span>Coverage unknown</span><strong>${num(d.unknown_history_coverage||0)}</strong></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Review queues</h2><p>Clean imported data without losing source evidence.</p></div></div><div class="fm-quick-grid"><button class="fm-quick" data-viewjump="transactions"><span>?</span><b>Uncategorised</b><small>Review categories</small></button><button class="fm-quick" data-viewjump="statements"><span>▤</span><b>Statement issues</b><small>Duplicates and rejected rows</small></button><button class="fm-quick" data-viewjump="reconciliation"><span>✓</span><b>Reconciliation</b><small>Match bank and ledger</small></button><button class="fm-quick" data-viewjump="accounts"><span>▣</span><b>Account review</b><small>Ownership and coverage</small></button></div></div></article>`}
function render(){const [t,s]=title(state.view);$('fmTitle').textContent=t;$('fmSubtitle').textContent=s;navButtons();$('fmContent').innerHTML=state.view==='overview'?overview():state.view==='accounts'?accounts():state.view==='transactions'?transactions():state.view==='statements'?statements():simpleView(state.view);bindDynamic()}
async function go(v){state.view=v;history.replaceState(null,'','#'+v);render()}
function bindDynamic(){
 document.querySelectorAll('[data-viewjump]').forEach(b=>b.onclick=()=>go(b.dataset.viewjump));
 document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>openNew(b.dataset.quick));
 document.querySelectorAll('[data-tx]').forEach(r=>r.onclick=()=>transactionDetail(r.dataset.tx));
 document.querySelectorAll('[data-account]').forEach(r=>r.onclick=()=>accountDetail(r.dataset.account));
}
function openDrawer(title,body,eyebrow='DETAIL'){$('fmDrawerEyebrow').textContent=eyebrow;$('fmDrawerTitle').textContent=title;$('fmDrawerBody').innerHTML=body;$('fmDrawer').classList.add('open');$('fmDrawer').setAttribute('aria-hidden','false');$('fmBackdrop').hidden=false}
function closeDrawer(){$('fmDrawer').classList.remove('open');$('fmDrawer').setAttribute('aria-hidden','true');$('fmBackdrop').hidden=true}
async function transactionDetail(id){try{const d=await api(I+'/transactions/'+id);const r=d.transaction||d;let original='';try{const o=await api(API+'/bank-transactions/'+id+'/original');if(o.original)original=`<div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Original bank record</h3><p>Immutable source evidence</p></div></div><p><b>${esc(o.original.description||'')}</b></p><p>${esc(o.original.reference||'')} · ${esc(o.original.currency||'')}</p></div></div>`}catch{}openDrawer(r.merchant_name||r.description||'Transaction',`<div class="fm-kpi"><span>Amount</span><strong>${money(num(r.credit||0)-num(r.debit||0),r.currency)}</strong></div><div class="fm-list"><div class="fm-row"><div><h3>Date</h3><p>${date(r.transaction_date||r.effective_date)}</p></div></div><div class="fm-row"><div><h3>Category</h3><p>${esc(r.category||'Uncategorised')}</p></div></div><div class="fm-row"><div><h3>Account</h3><p>${esc(r.account_name||'')}</p></div></div></div>${original}`,'TRANSACTION')}catch(e){notice(e.message,true)}}
function accountDetail(id){const a=state.accounts.find(x=>String(x.id)===String(id));if(!a)return;openDrawer(a.nickname||a.account_name||'Account',`<div class="fm-kpi"><span>Current balance</span><strong>${money(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</strong></div><div class="fm-list"><div class="fm-row"><div><h3>Institution</h3><p>${esc(a.institution||'')}</p></div></div><div class="fm-row"><div><h3>Ownership</h3><p>${esc(a.ownership_scope||'')}</p></div></div><div class="fm-row"><div><h3>History coverage</h3><p>${date(a.history_start_date)} – ${date(a.history_end_date)}</p></div></div></div><div class="fm-hero-actions"><button data-account-action="inactive" data-id="${a.id}">Set inactive</button><button data-account-action="archive" data-id="${a.id}">Archive</button><button data-account-action="restore" data-id="${a.id}">Restore</button><button data-account-action="delete" data-id="${a.id}">Permanently delete</button></div>`,'ACCOUNT');setTimeout(()=>document.querySelectorAll('[data-account-action]').forEach(b=>b.onclick=()=>accountLifecycle(b.dataset.id,b.dataset.accountAction)),0)}
async function accountLifecycle(id,action){const map={inactive:['POST',I+'/accounts/'+id+'/inactive'],archive:['POST',I+'/accounts/'+id+'/archive'],restore:['POST',I+'/accounts/'+id+'/restore'],delete:['DELETE',I+'/accounts/'+id]};const cfg=map[action];if(!cfg)return;if(action==='delete'&&!confirm('Permanently delete this empty account? This action is blocked if dependencies exist.'))return;try{await api(cfg[1],{method:cfg[0],body:cfg[0]==='POST'?'{}':undefined});notice('Account updated.');closeDrawer();await refresh()}catch(e){notice(e.message,true)}}
function openNew(kind='expense'){const forms={
 expense:['Expense','Expense'],income:['Income','Income'],cash:['Cash transaction','Cash Expense'],account:['Add financial account','Account'],statement:['Upload statement','Statement'],transfer:['Transfer','Transfer']
};const f=forms[kind]||forms.expense;$('fmModalEyebrow').textContent='NEW';$('fmModalTitle').textContent=f[0];if(kind==='statement'){$('fmModalBody').innerHTML=`<div class="fm-empty"><strong>Statement import uses the protected review workflow.</strong><button class="fm-primary" onclick="location.href='/finance-intelligence#statements'">Open Statements</button></div>`}else{$('fmModalBody').innerHTML=`<form id="fmEntryForm" class="fm-form"><div class="fm-form-grid"><label>Date<input name="effective_date" type="date" required></label><label>Amount<input name="amount" inputmode="decimal" required></label></div><label>Description<input name="description" required></label><label>Account<select name="bank_account_id"><option value="">Select account</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.nickname||a.account_name||'Account')}</option>`).join('')}</select></label><label>Category<input name="category"></label><label>Notes<textarea name="notes"></textarea></label><div class="fm-form-actions"><button type="button" onclick="document.getElementById('fmModal').close()">Cancel</button><button class="primary" type="submit">Save</button></div></form>`;setTimeout(()=>{$('fmEntryForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const amount=fd.get('amount');const type=f[1].toUpperCase().replace(/ /g,'_');const body={effective_date:fd.get('effective_date'),description:fd.get('description'),transaction_type:type,category:fd.get('category')||null,notes:fd.get('notes')||null,bank_account_id:Number(fd.get('bank_account_id')||0)||null,gross_amount:amount,net_amount:amount,gst_amount:'0.00',status:'DRAFT'};try{await api(API+'/transactions',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice('Transaction saved.');await refresh()}catch(err){notice(err.message,true)}}},0)}$('fmModal').showModal()}
async function refresh(){notice('');$('fmContent').innerHTML='<div class="fm-loading"><span></span><b>Refreshing finance workspace…</b></div>';await loadBase();render()}
function bind(){
 $('fmScope').onchange=e=>{state.scope=e.target.value;refresh()};$('fmAccount').onchange=e=>{state.account=e.target.value;refresh()};$('fmPeriod').onchange=e=>{state.period=e.target.value;render()};$('fmCurrency').onchange=e=>{state.currency=e.target.value;render()};$('fmRefresh').onclick=refresh;$('fmNew').onclick=()=>openNew('expense');$('fmDrawerClose').onclick=closeDrawer;$('fmBackdrop').onclick=closeDrawer;$('fmModalClose').onclick=()=>$('fmModal').close();$('fmSearch').onkeydown=e=>{if(e.key==='Enter'){state.view='transactions';render();setTimeout(()=>{const q=e.currentTarget.value.toLowerCase();document.querySelectorAll('.fm-table tbody tr').forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(q))},10)}}}
document.addEventListener('DOMContentLoaded',async()=>{bind();const h=location.hash.slice(1);if(NAV.some(x=>x[0]===h))state.view=h;navButtons();try{await loadBase();render()}catch(e){notice(e.message||'Finance workspace failed to load',true)}})
})();