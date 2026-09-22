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
 $('fmNav').innerHTML=NAV_GROUPS.map(([group,items])=>`<div class="fm-nav-group"><small>${esc(group)}</small>${items.map(([v,i,l])=>`<button type="button" data-view="${v}" class="${state.view===v?'active':''}"><span>${i}</span>${l}</button>`).join('')}</div>`).join('');
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
 return `<div class="fm-state fm-state-error"><strong>${esc(label)}</strong><p>${esc(message)}</p><button type="button" data-retry="1">Retry</button></div>`;
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
function statusBadge(status){const v=String(status||'UNKNOWN').toUpperCase();const tone=['READY','ACTIVE','RECONCILED','BALANCED','SUCCESS','COMPLETED'].includes(v)?'good':['BLOCKED','ERROR','FAILED','MISMATCH','OVERDUE'].includes(v)?'bad':'warn';return `<span class="fm-badge ${tone}">${esc(v)}</span>`}
function emptyState(title,message,action=''){return `<div class="fm-empty"><strong>${esc(title)}</strong><span>${esc(message)}</span>${action}</div>`}
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
 const sel=$('fmAccount');const keep=state.account;sel.innerHTML='<option value="">All permitted accounts</option>'+state.accounts.map(a=>`<option value="${a.id}">${esc(a.nickname||a.account_name||'Account')} · ${esc(a.currency||'AUD')}</option>`).join('');sel.value=keep;
}
function hero(){
 const err=resourceError('dash','Financial overview');if(err)return err;
 const rows=currencyRows();const mixed=mixedCurrencyMessage(rows);const one=rows[0]||{currency:'AUD',balance:0,money_in:0,money_out:0,net_flow:0};
 const position=rows.length===1?nativeMoney(one.balance,one.currency):'Mixed currencies';
 const kpis=rows.length?rows.map(r=>`<div class="fm-kpi"><span>${esc(r.currency)} · Available balance</span><strong>${nativeMoney(r.balance,r.currency)}</strong><small>Current balance — not period filtered</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Money in</span><strong class="good">${nativeMoney(r.money_in,r.currency)}</strong><small>Selected period</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Money out</span><strong class="bad">${nativeMoney(r.money_out,r.currency)}</strong><small>Selected period · transfers excluded</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Net cash flow</span><strong>${nativeMoney(r.net_flow,r.currency)}</strong><small>Income minus expense</small></div>`).join(''):'<div class="fm-empty">No visible financial activity.</div>';
 return `<div class="fm-grid two"><article class="fm-card fm-hero"><div class="fm-pad"><small>TOTAL FINANCIAL POSITION</small><strong>${position}</strong><p>${mixed||'Current account position. Period activity is shown separately.'}</p><div class="fm-hero-actions"><button class="accent" data-quick="expense">Add movement</button><button data-quick="statement">Upload statement</button><button data-viewjump="reports">Reports</button></div></div></article><div class="fm-grid two">${kpis}</div></div>`;
}
function recentRows(){
 const rows=state.dash?.recent_transactions||state.tx.slice(0,8);
 return rows.length?rows.slice(0,8).map(r=>{const amount=num(r.credit||0)-num(r.debit||0);return `<div class="fm-row" data-tx="${r.id}"><div><h3>${esc(r.merchant_name||r.description||'Transaction')}</h3><p>${date(r.transaction_date)} · ${esc(r.account_name||'Account')} · ${esc(r.category||'Uncategorised')}</p></div><div class="fm-row-right"><b class="${amount<0?'bad':'good'}">${nativeMoney(Math.abs(amount),r.currency||'AUD')}</b><small>${Number(r.is_internal_transfer)?'Internal transfer':esc(r.reconciliation_status||'')}</small></div></div>`}).join(''):emptyState('No transactions','Import a statement or add a manual financial movement.');
}
function overview(){
 const err=resourceError('dash','Finance dashboard');if(err)return err;
 const accountRows=state.accounts.slice(0,6).map(a=>`<div class="fm-row" data-account="${a.id}"><div><h3>${esc(a.nickname||a.account_name||'Account')}</h3><p>${esc(a.institution||'Financial account')} · ${esc(a.ownership_scope||'')}</p></div><div class="fm-row-right"><b>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</b><small>${esc(a.currency||'AUD')}</small></div></div>`).join('');
 const monthly=Array.isArray(state.dash?.monthly)?state.dash.monthly:[];const max=Math.max(1,...monthly.flatMap(x=>[num(x.money_in),num(x.money_out)]));
 const chart=monthly.length?monthly.slice(-12).map(x=>`<div class="fm-chart-row"><span>${esc(x.month)} · ${esc(x.currency)}</span><div class="fm-bars"><i class="in" style="width:${Math.max(2,num(x.money_in)/max*100)}%" title="Money in ${nativeMoney(x.money_in,x.currency)}"></i><i class="out" style="width:${Math.max(2,num(x.money_out)/max*100)}%" title="Money out ${nativeMoney(x.money_out,x.currency)}"></i></div><b>${nativeMoney(num(x.money_in)-num(x.money_out),x.currency)}</b></div>`).join(''):emptyState('No cash-flow trend','No transactions exist in the selected period.');
 const cats=Array.isArray(state.dash?.categories)?state.dash.categories:[];const catList=cats.slice(0,8).map(x=>`<button class="fm-distribution" data-category="${esc(x.category)}"><span>${esc(x.category)} · ${esc(x.currency)}</span><b>${nativeMoney(x.spent,x.currency)}</b></button>`).join('')||emptyState('No expense distribution','No expenses exist in the selected period.');
 const q=state.quality||{};const ins=state.insights?.summary||{};const attention=[['Uncategorised',q.unclassified_transactions??q.unclassified,'transactions'],['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],['Ownership missing',q.ownership_missing,'review'],['History coverage unknown',q.unknown_history_coverage,'accounts'],['Transfer candidates',ins.transfer_candidates,'insights'],['Anomalies',ins.anomalies,'insights']].filter(x=>num(x[1])>0);
 const attentionHtml=attention.length?attention.map(([l,n,v])=>`<button class="fm-attention" data-viewjump="${v}"><b>${num(n)}</b><span>${esc(l)}</span></button>`).join(''):emptyState('No current attention items','No review counts were returned for the selected scope.');
 return hero()+`<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Cash Flow Trend</h2><p>Real money in/out grouped by month and native currency.</p></div></div><div class="fm-chart" role="img" aria-label="Cash flow trend">${chart}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Expense Distribution</h2><p>Click a category to drill into matching transactions.</p></div></div><div class="fm-distributions">${catList}</div></div></article></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Needs your attention</h2><p>Direct queues, not decorative alerts.</p></div></div><div class="fm-attention-grid">${attentionHtml}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Accounts</h2><p>Balances are current positions and never period-filtered.</p></div><button data-viewjump="accounts">Manage</button></div><div class="fm-list">${accountRows||emptyState('No accounts','Add an account or import a statement.')}</div></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Recent transactions</h2><p>Drill into current classification and immutable source evidence.</p></div><button data-viewjump="transactions">View all</button></div><div class="fm-list">${recentRows()}</div></div></article>`;
}
function accounts(){
 const err=resourceError('dash','Accounts');if(err&&!state.accounts.length)return err;
 const coverage=Array.isArray(state.history?.accounts)?state.history.accounts:[];
 return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Financial accounts</h2><p>Open an account for overview, transactions, analytics, reconciliation and lifecycle controls.</p></div><button data-quick="account">+ Add account</button></div><div class="fm-account-grid">${state.accounts.map(a=>{const c=coverage.find(x=>String(x.id||x.bank_account_id)===String(a.id))||{};return `<button class="fm-account-card" data-account="${a.id}"><span class="fm-account-type">${esc(a.account_type||'Account')}</span><h3>${esc(a.nickname||'Account')}</h3><p>${esc(a.institution||'Manual')} · ${esc(a.account_number_masked||'number masked')}</p><strong>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</strong><small>${esc(a.ownership_scope||'')} · ${esc(a.connection_status||'MANUAL')}</small><div class="fm-coverage"><span>Coverage</span><b>${date(c.transaction_start||a.history_start_date)} → ${date(c.transaction_end||a.history_end_date)}</b></div></button>`}).join('')||emptyState('No accounts','Create a financial account to begin.')}</div></div></article>`;
}
function transactions(){
 const meta=state.txMeta||{};const f=state.txFilters;
 return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Transaction Explorer</h2><p>${num(meta.total)} matching records · server-side filters and pagination.</p></div><button data-quick="expense">+ Financial movement</button></div><div class="fm-filter-grid"><input id="txSearch" value="${esc(f.q)}" placeholder="Search description, merchant, reference, account"><select id="txType"><option value="">All types</option><option value="EXPENSE" ${f.type==='EXPENSE'?'selected':''}>Expense</option><option value="INCOME" ${f.type==='INCOME'?'selected':''}>Income</option><option value="TRANSFER" ${f.type==='TRANSFER'?'selected':''}>Transfer</option></select><input id="txCategory" value="${esc(f.category)}" placeholder="Category"><input id="txMerchant" value="${esc(f.merchant)}" placeholder="Merchant"><select id="txSource"><option value="">All sources</option><option value="STATEMENT_IMPORT" ${f.source==='STATEMENT_IMPORT'?'selected':''}>Statement import</option><option value="MANUAL" ${f.source==='MANUAL'?'selected':''}>Manual</option><option value="OPEN_BANKING" ${f.source==='OPEN_BANKING'?'selected':''}>Open Banking</option></select><select id="txRecon"><option value="">All reconciliation</option><option value="UNRECONCILED" ${f.reconciliation_status==='UNRECONCILED'?'selected':''}>Unreconciled</option><option value="RECONCILED" ${f.reconciliation_status==='RECONCILED'?'selected':''}>Reconciled</option></select><input id="txMin" value="${esc(f.amount_min)}" inputmode="decimal" placeholder="Min amount"><input id="txMax" value="${esc(f.amount_max)}" inputmode="decimal" placeholder="Max amount"><button id="txApply" class="fm-primary" type="button">Apply filters</button></div>${resourceError('txPayload','Transaction ledger')}<div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Bank</th><th>Merchant / Description</th><th>Category</th><th>Type</th><th>Scope</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Source</th><th>Reconciliation</th></tr></thead><tbody>${state.tx.map(r=>`<tr data-tx="${r.id}"><td>${date(r.transaction_date)}</td><td>${esc(r.account_name||'')}</td><td>${esc(r.institution||'')}</td><td><b>${esc(r.merchant_name||'')}</b><small>${esc(r.description||'')}</small></td><td>${esc(r.category||'Uncategorised')}</td><td>${Number(r.is_internal_transfer)?'Transfer':num(r.debit)>0?'Expense':'Income'}</td><td>${esc(r.ownership_scope||'')}</td><td>${esc(r.currency||'')}</td><td>${num(r.debit)?nativeMoney(r.debit,r.currency):''}</td><td>${num(r.credit)?nativeMoney(r.credit,r.currency):''}</td><td>${esc(r.source_type||'')}</td><td>${statusBadge(r.reconciliation_status)}</td></tr>`).join('')||`<tr><td colspan="12">${emptyState('No matching transactions','Change filters or import financial history.')}</td></tr>`}</tbody></table></div><div class="fm-pagination"><button id="txPrev" ${meta.page<=1?'disabled':''}>Previous</button><span>Page ${num(meta.page)||1} of ${num(meta.total_pages)||1}</span><button id="txNext" ${meta.page>=meta.total_pages?'disabled':''}>Next</button></div></div></article>`;
}
function statements(){
 const pending=state.reviews.filter(x=>x.status==='PENDING_REVIEW');
 return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement Import Wizard</h2><p>Choose account → upload → extract → review → duplicate validation → commit.</p></div><button data-quick="statement">Start import</button></div><div class="fm-list">${pending.slice(0,8).map(x=>`<div class="fm-row" data-review="${esc(x.import_uid)}"><div><h3>${esc(x.original_name||'Statement review')}</h3><p>${esc(x.account_name||'')} · ${esc(x.source_format||'')} · ${num(x.total_rows)} rows</p></div><div class="fm-row-right">${statusBadge(x.status)}<small>${num(x.duplicate_rows)} duplicates · ${num(x.rejected_rows)} rejected</small></div></div>`).join('')||emptyState('No pending reviews','New statement uploads will appear here before they affect the ledger.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Supported formats</h2><p>Only formats handled by the current parser are shown.</p></div></div><div class="fm-format-grid"><span>CSV</span><span>PDF</span><span>OFX</span><span>QFX</span><span>QIF</span><span>XLSX</span></div><p class="fm-helper">Every extracted row is staged through the protected server review engine before commit.</p></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement Vault</h2><p>Committed history with coverage and import quality.</p></div></div>${resourceError('statementPayload','Statement Vault')}<div class="fm-list">${state.statements.map(x=>`<div class="fm-row"><div><h3>${esc(x.original_name||'Statement')}</h3><p>${esc(x.account_name||'')} · ${date(x.statement_start_date)} – ${date(x.statement_end_date)} · ${esc(x.source_format||'')}</p></div><div class="fm-row-right"><b>${num(x.imported_rows)} imported</b><small>${num(x.duplicate_rows)} duplicates · ${num(x.rejected_rows)} rejected</small></div></div>`).join('')||emptyState('No committed statements','Use the import wizard to build verified account history.')}</div></div></article>`;
}
function personalCard(kind){
 const p=state.personal||{};const a=state.personalAttention||{};
 const data=kind==='budgets'?(p.budgets||[]):kind==='savings'?(a.goals||[]):kind==='debt'?(p.debts||[]):(a.recurring||[]);
 const label=kind==='budgets'?'Budgets':kind==='savings'?'Savings Goals':kind==='debt'?'Borrow & Lend':'Recurring Money';
 return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>${label}</h2><p>Owner-only Personal Money records. They are not silently added to company/bank totals.</p></div><button data-personal-new="${kind}">+ Add</button></div><div class="fm-list">${data.map(x=>{const amount=kind==='budgets'?x.limit_amount:kind==='savings'?x.target_amount:kind==='debt'?x.outstanding_amount:x.amount;return `<div class="fm-row"><div><h3>${esc(x.name||x.category||x.counterparty||'Item')}</h3><p>${esc(x.status||x.frequency||'')} ${x.due_date?'· '+date(x.due_date):''}</p></div><div class="fm-row-right"><b>${nativeMoney(amount||0,x.currency||'AUD')}</b><small>${kind==='budgets'?(num(x.used_percent)+'% used'):kind==='savings'?(nativeMoney(x.current_amount||0,x.currency)+' saved'):kind==='debt'?'remaining':''}</small></div></div>`}).join('')||emptyState('No records yet','Use Add to create the first record.')}</div></div></article>`;
}

function personalView(){
 const p=state.personal||{}, totals=p.wallet_totals||{}, debts=p.debt_totals_by_currency||{};
 const cards=Object.entries(totals).map(([c,v])=>`<div class="fm-kpi"><span>${esc(c)} wallets</span><strong>${nativeMoney(v,c)}</strong><small>Owner-only Personal Money</small></div>`).join('');
 const debtCards=Object.entries(debts).map(([c,v])=>`<div class="fm-kpi"><span>${esc(c)} owed to me</span><strong>${nativeMoney(v.lent_open,c)}</strong><small>Open lending</small></div><div class="fm-kpi"><span>${esc(c)} I owe</span><strong>${nativeMoney(v.borrowed_open,c)}</strong><small>Open borrowing</small></div>`).join('');
 return `${resourceError('personal','My Money')}<div class="fm-grid four">${cards+debtCards||'<div class="fm-kpi"><span>Personal Money</span><strong>—</strong><small>No owner-only wallets yet</small></div>'}</div><div class="fm-grid two">${personalCard('budgets')}${personalCard('debt')}</div>`;
}
function companyView(){
 if(state.scope!=='BUSINESS')return `<article class="fm-card"><div class="fm-pad">${emptyState('Company workspace','Switch the Workspace filter to Company for business-only finance.','<button class="fm-primary" data-scope-jump="BUSINESS">Switch to Company</button>')}</div></article>`;
 const bills=state.os?.approval_inbox||[];
 return overview()+`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Company controls</h2><p>Company-only finance remains separated from owner-only Personal Money.</p></div></div><div class="fm-grid four"><div class="fm-kpi"><span>Approval inbox</span><strong>${bills.length}</strong><small>Banking payment instructions awaiting approval</small></div><div class="fm-kpi"><span>Overdue obligations</span><strong>${num(state.os?.obligations?.overdue)}</strong><small>Internal payment workflow obligations</small></div></div></div></article>`;
}
function consolidatedView(){
 if(state.scope!=='ALL')return `<article class="fm-card"><div class="fm-pad">${emptyState('Consolidated workspace','Switch to Consolidated to see all permitted accounts while ownership remains visible.','<button class="fm-primary" data-scope-jump="ALL">Switch to Consolidated</button>')}</div></article>`;
 return overview();
}
function cashView(){
 const p=state.personal||{}, wallets=p.wallets||[];
 const cashAccounts=state.accounts.filter(a=>/CASH|PETTY|TILL/i.test(String(a.account_type||'')+' '+String(a.nickname||'')));
 return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Canonical cash accounts</h2><p>Company/banking cash accounts stay in the same bank transaction ledger.</p></div><button data-quick="account">+ Cash account</button></div><div class="fm-list">${cashAccounts.map(a=>`<div class="fm-row" data-account="${a.id}"><div><h3>${esc(a.nickname)}</h3><p>${esc(a.account_type||'Cash')} · ${esc(a.ownership_scope||'')}</p></div><b>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency)}</b></div>`).join('')||emptyState('No canonical cash accounts','Create a Cash or Petty Cash account for company cash tracking.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Personal cash wallets</h2><p>Owner-only Personal Money wallets are intentionally not merged into company totals.</p></div><button data-personal-new="cash">+ Cash movement</button></div><div class="fm-list">${wallets.map(w=>`<div class="fm-row"><div><h3>${esc(w.name)}</h3><p>Personal wallet · ${esc(w.currency)}</p></div><b>${nativeMoney(w.balance,w.currency)}</b></div>`).join('')||emptyState('No personal wallets','Create a Personal Money wallet before recording personal cash movements.')}</div></div></article></div>`;
}
function insightsView(){
 const rows=state.insights?.insights||[];
 return `${resourceError('insights','Finance Insights')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Finance Insights</h2><p>Evidence-backed findings linked to underlying transactions.</p></div><button id="runAnalysis" type="button">Analyse transactions</button></div><div class="fm-list">${rows.map(x=>`<div class="fm-row" data-tx="${x.bank_transaction_id}"><div><h3>${esc(x.merchant_name||x.description||'Transaction insight')}</h3><p>${x.suggested_category?'Category suggestion: '+esc(x.suggested_category)+' · ':''}${x.recurring_frequency?'Recurring '+esc(x.recurring_frequency)+' · ':''}${x.transfer_candidate_uid?'Transfer candidate · ':''}anomaly ${num(x.anomaly_score)}</p></div><div class="fm-row-right">${statusBadge(x.status)}<small>${date(x.transaction_date)}</small></div></div>`).join('')||emptyState('No insights','Run analysis or import more verified history.')}</div></div></article>`;
}
function rulesView(){
 const rows=state.rules?.rules||[];
 return `${resourceError('rules','Finance Rules')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Merchant & Category Rules</h2><p>Rules produce suggestions; they never silently post, reconcile or alter source evidence.</p></div></div><div class="fm-list">${rows.map(x=>`<div class="fm-row"><div><h3>${esc(x.merchant_pattern)}</h3><p>${esc(x.category||'No category')} · ${esc(x.ownership_scope||'')} · priority ${num(x.priority)}</p></div>${statusBadge(x.enabled?'ACTIVE':'DISABLED')}</div>`).join('')||emptyState('No saved rules','Approved intelligence suggestions can create remembered merchant rules.')}</div></div></article>`;
}
function reconciliationView(){
 const r=state.reconciliation||{}, rows=r.transactions||[];
 return `${resourceError('reconciliation','Reconciliation')}<div class="fm-grid four"><div class="fm-kpi"><span>Needs action</span><strong>${num(r.summary?.needs_action)}</strong></div><div class="fm-kpi"><span>Ready</span><strong>${num(r.summary?.ready)}</strong></div><div class="fm-kpi"><span>Partial</span><strong>${num(r.summary?.partial)}</strong></div><div class="fm-kpi"><span>Reconciled</span><strong>${num(r.summary?.reconciled)}</strong></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Amount</th><th>Matched</th><th>Remaining</th><th>Workflow</th></tr></thead><tbody>${rows.slice(0,200).map(x=>`<tr data-tx="${x.id}"><td>${date(x.transaction_date)}</td><td>${esc(x.account_name)}</td><td>${esc(x.merchant_name||x.description)}</td><td>${nativeMoney(Math.abs(num(x.amount)),x.currency)}</td><td>${nativeMoney(x.matched_amount,x.currency)}</td><td>${nativeMoney(x.remaining_amount,x.currency)}</td><td>${statusBadge(x.workflow_status)}</td></tr>`).join('')}</tbody></table></div></div></article>`;
}
function teamView(){
 const users=state.team?.users||state.team?.team||[];
 return `${resourceError('team','Team Finance Access')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Team Finance Access</h2><p>Access is enforced on the server, not by hiding frontend controls.</p></div></div><div class="fm-list">${users.map(u=>`<div class="fm-row"><div><h3>${esc(u.name||u.email||'User')}</h3><p>${esc(u.role||'')} · ${esc(u.access_level||u.banking_access||'')}</p></div>${statusBadge(u.status||'ACTIVE')}</div>`).join('')||emptyState('No team data','No finance team access records were returned.')}</div></div></article>`;
}
function connectionsView(){
 const r=state.readiness||{};
 return `${resourceError('readiness','Banking Connections')}<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Open Banking readiness</h2><p>${esc(r.headline||'Readiness unavailable')}</p></div>${statusBadge(r.overall)}</div><div class="fm-list">${(r.controls||[]).map(c=>`<div class="fm-row"><div><h3>${esc(c.plain_name||c.label)}</h3><p>${esc(c.detail||c.description||'')}</p></div>${statusBadge(c.status)}</div>`).join('')}</div></div></article><article class="fm-card"><div class="fm-pad"><h2>Connection status</h2><p class="fm-helper">${esc(r.open_banking?.explanation||'Open Banking remains fail-closed until provider and production controls are verified.')}</p><div class="fm-list">${(r.connections||[]).map(c=>`<div class="fm-row"><div><h3>${esc(c.institution||c.provider)}</h3><p>Consent: ${esc(c.consent_status||'')} · last sync ${date(c.last_sync_completed_at)}</p></div>${statusBadge(c.last_sync_status||c.consent_status)}</div>`).join('')||emptyState('No live connections','Manual statement import remains the supported fallback.')}</div></div></article></div>`;
}
function settingsView(){
 const caps=state.capabilities?.capabilities||{};
 return connectionsView()+`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Capability Registry</h2><p>Unsupported workflows are explicitly identified rather than presented as dead buttons.</p></div></div><div class="fm-capability-grid">${Object.entries(caps).map(([k,v])=>`<div class="fm-capability"><div><b>${esc(k.replaceAll('_',' '))}</b><p>${esc(v.note||'')}</p></div>${statusBadge(v.status)}</div>`).join('')}</div></div></article>`;
}
function simpleView(v){
 if(['budgets','savings','debt','recurring'].includes(v))return personalCard(v);
 if(v==='reports')return reportView();
 if(v==='review')return reviewView();
 if(v==='personal')return personalView();
 if(v==='company')return companyView();
 if(v==='consolidated')return consolidatedView();
 if(v==='cash')return cashView();
 if(v==='insights')return insightsView();
 if(v==='rules')return rulesView();
 if(v==='reconciliation')return reconciliationView();
 if(v==='team')return teamView();
 if(v==='connections')return connectionsView();
 return settingsView();
}
function reportView(){
 const r=dateRange();
 return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Report Centre</h2><p>Exports remain permission and step-up protected.</p></div></div><div class="fm-quick-grid"><button class="fm-quick" data-export="/api/finance/exports/accountant-review.pdf"><span>PDF</span><b>Accountant Review</b><small>Existing protected company PDF</small></button><button class="fm-quick" data-export="/api/finance/exports/trial-balance.csv"><span>CSV</span><b>Trial Balance</b><small>Existing protected CSV</small></button><button class="fm-quick" data-viewjump="transactions"><span>↕</span><b>Transaction Register</b><small>Use active server-side filters</small></button><button class="fm-quick" data-viewjump="statements"><span>▤</span><b>Statement History</b><small>Source/import evidence</small></button></div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Active report context</h2><p>Scope and period are explicit.</p></div></div><div class="fm-list"><div class="fm-row"><span>Workspace</span><b>${esc(state.scope)}</b></div><div class="fm-row"><span>Accounts</span><b>${state.account?esc(state.accounts.find(a=>String(a.id)===String(state.account))?.nickname||state.account):'All permitted'}</b></div><div class="fm-row"><span>Period</span><b>${esc(r.from||'All')} → ${esc(r.to||'Now')}</b></div><div class="fm-row"><span>Currency treatment</span><b>Native currencies only</b></div></div><p class="fm-helper">Full XLSX/report-builder coverage remains a genuine gap until exports consume the exact same filter contract.</p></div></article></div>`;
}
function reviewView(){
 const q=state.quality||{};const ins=state.insights?.summary||{};const cards=[['Uncategorised',q.unclassified_transactions??q.unclassified,'transactions'],['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],['Ownership missing',q.ownership_missing,'transactions'],['Unknown history coverage',q.unknown_history_coverage,'accounts'],['Transfer candidates',ins.transfer_candidates,'insights'],['Category suggestions',ins.category_suggestions,'insights'],['Anomalies',ins.anomalies,'insights']];
 return `${resourceError('quality','Data Quality')}<div class="fm-grid four">${cards.map(([l,n,v])=>`<button class="fm-kpi fm-kpi-button" data-viewjump="${v}"><span>${esc(l)}</span><strong>${num(n)}</strong><small>Open underlying queue</small></button>`).join('')}</div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Review Centre</h2><p>Quality metrics open the underlying data rather than hiding issues behind a score.</p></div></div><div class="fm-list">${(state.personalAttention?.alerts||[]).slice(0,12).map(x=>`<div class="fm-row"><div><h3>${esc(x.title)}</h3><p>${esc(x.explanation||'')}</p></div>${statusBadge(x.severity)}</div>`).join('')||emptyState('No personal attention alerts','No current owner-only alerts were returned.')}</div></div></article>`;
}
function csvSplit(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += ch;
  }
  values.push(value.trim());
  return values;
}

function parseNumber(input) {
  const cleaned = String(input || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const parsed = Number(cleaned || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV must contain a header row and at least one transaction.');
  const headers = csvSplit(lines.shift()).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const aliases = {
    transaction_date: ['transaction_date', 'date', 'transactiondate', 'value_date', 'processed_date'],
    posting_date: ['posting_date', 'posted_date', 'process_date'],
    description: ['description', 'details', 'transaction_details', 'narrative', 'memo'],
    reference: ['reference', 'ref', 'transaction_reference'],
    debit: ['debit', 'withdrawal', 'withdrawals', 'money_out', 'debits'],
    credit: ['credit', 'deposit', 'deposits', 'money_in', 'credits'],
    amount: ['amount', 'transaction_amount'],
    running_balance: ['running_balance', 'balance', 'account_balance'],
    merchant_name: ['merchant', 'merchant_name', 'payee'],
    category: ['category'],
    currency: ['currency']
  };
  const indexOf = (key) => {
    for (const alias of aliases[key] || []) {
      const index = headers.indexOf(alias);
      if (index >= 0) return index;
    }
    return -1;
  };
  const idx = Object.fromEntries(Object.keys(aliases).map((key) => [key, indexOf(key)]));
  if (idx.transaction_date < 0) throw new Error('Statement needs a transaction date column.');
  if (idx.amount < 0 && idx.debit < 0 && idx.credit < 0) throw new Error('Statement needs Amount or Debit/Credit columns.');
  return lines.map((line) => {
    const cells = csvSplit(line);
    let debit = idx.debit >= 0 ? Math.abs(parseNumber(cells[idx.debit])) : 0;
    let credit = idx.credit >= 0 ? Math.abs(parseNumber(cells[idx.credit])) : 0;
    if (idx.amount >= 0 && !debit && !credit) {
      const raw = parseNumber(cells[idx.amount]);
      if (raw < 0) debit = Math.abs(raw); else if (raw > 0) credit = raw;
    }
    return {
      transaction_date: cells[idx.transaction_date],
      posting_date: idx.posting_date >= 0 ? cells[idx.posting_date] : null,
      description: idx.description >= 0 ? cells[idx.description] : '',
      reference: idx.reference >= 0 ? cells[idx.reference] : '',
      debit, credit,
      running_balance: idx.running_balance >= 0 ? cells[idx.running_balance] : null,
      merchant_name: idx.merchant_name >= 0 ? cells[idx.merchant_name] : null,
      category: idx.category >= 0 ? cells[idx.category] : null,
      currency: idx.currency >= 0 ? cells[idx.currency] : null
    };
  });
}

function ofxTag(block, name) {
  const match = block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseOfx(text) {
  const blocks = String(text || '').match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
  if (!blocks.length) throw new Error('No OFX/QFX transactions were found.');
  return blocks.map((block) => {
    const amount = parseNumber(ofxTag(block, 'TRNAMT'));
    const posted = ofxTag(block, 'DTPOSTED').slice(0, 8);
    const date = /^\d{8}$/.test(posted) ? `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}` : posted;
    const name = ofxTag(block, 'NAME');
    const memo = ofxTag(block, 'MEMO');
    return {
      transaction_date: date,
      description: [name, memo].filter(Boolean).join(' · '),
      merchant_name: name || null,
      reference: ofxTag(block, 'FITID') || ofxTag(block, 'REFNUM') || null,
      debit: amount < 0 ? Math.abs(amount) : 0,
      credit: amount > 0 ? amount : 0,
      running_balance: null,
      currency: null
    };
  });
}

function normalizeQifDate(value) {
  const input = String(value || '').trim().replace(/'/g, '/');
  const parts = input.split(/[\/.-]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) return input;
  let [a, b, c] = parts;
  let year = Number(c);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const first = Number(a); const second = Number(b);
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseQif(text) {
  const records = String(text || '').split(/^\^\s*$/m).map((record) => record.trim()).filter(Boolean);
  const rows = [];
  for (const record of records) {
    const fields = {};
    for (const line of record.split(/\r?\n/)) {
      const code = line[0];
      if (!code || code === '!') continue;
      fields[code] = String(line.slice(1)).trim();
    }
    if (!fields.D || fields.T === undefined) continue;
    const amount = parseNumber(fields.T);
    rows.push({
      transaction_date: normalizeQifDate(fields.D),
      description: [fields.P, fields.M].filter(Boolean).join(' · '),
      merchant_name: fields.P || null,
      reference: fields.N || null,
      debit: amount < 0 ? Math.abs(amount) : 0,
      credit: amount > 0 ? amount : 0,
      running_balance: null,
      category: fields.L || null,
      currency: null
    });
  }
  if (!rows.length) throw new Error('No QIF transactions were found.');
  return rows;
}

async function parseXlsx(file) {
  if (!window.XLSX) throw new Error('XLSX parser failed to load. Use CSV or try again after refreshing.');
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('The spreadsheet has no readable sheet.');
  return parseCsv(window.XLSX.utils.sheet_to_csv(firstSheet));
}

async function pdfLines(file) {
  if (!window.pdfjsLib) throw new Error('PDF parser failed to load. Use a CSV/OFX export or refresh and try again.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const groups = new Map();
    for (const item of content.items || []) {
      const y = Math.round(Number(item.transform?.[5] || 0) / 3) * 3;
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push({ x: Number(item.transform?.[4] || 0), text: String(item.str || '').trim() });
    }
    [...groups.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
      const line = items.sort((a, b) => a.x - b.x).map((item) => item.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    });
  }
  return lines;
}

function parsePdfLines(lines) {
  const datePattern = /(\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}\b)/;
  const amountPattern = /(?:CR|DR)?\s*[-+]?\(?\$?\d[\d,]*\.\d{2}\)?(?:\s*(?:CR|DR))?/gi;
  const rows = [];
  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;
    const amounts = [...line.matchAll(amountPattern)].map((match) => ({ raw: match[0], index: match.index || 0 }));
    if (!amounts.length) continue;
    const transactionAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const balanceAmount = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
    const rawAmount = transactionAmount.raw;
    const numeric = Math.abs(parseNumber(rawAmount.replace(/\b(?:CR|DR)\b/gi, '')));
    const debitHint = /\bDR\b/i.test(rawAmount) || /^\s*-/.test(rawAmount) || /^\s*\(/.test(rawAmount);
    const creditHint = /\bCR\b/i.test(rawAmount) || /^\s*\+/.test(rawAmount);
    if (!debitHint && !creditHint) continue;
    const description = line.slice(dateMatch.index + dateMatch[0].length, transactionAmount.index).trim();
    rows.push({
      transaction_date: dateMatch[0],
      description: description || 'PDF statement transaction — verify description',
      debit: debitHint ? numeric : 0,
      credit: creditHint ? numeric : 0,
      running_balance: balanceAmount ? Math.abs(parseNumber(balanceAmount.raw.replace(/\b(?:CR|DR)\b/gi, ''))) : null,
      reference: null,
      merchant_name: null,
      category: null,
      currency: null
    });
  }
  if (!rows.length) throw new Error('This PDF does not expose transaction direction safely enough for automatic import. Export CSV/OFX from the bank, or use a PDF with explicit CR/DR or signed amounts. Nothing was imported.');
  return rows;
}

async function parseStatement(file) {
  const extension = (file.name.split('.').pop() || '').toUpperCase();
  if (extension === 'CSV') return { format: extension, rows: parseCsv(await file.text()) };
  if (extension === 'OFX' || extension === 'QFX') return { format: extension, rows: parseOfx(await file.text()) };
  if (extension === 'QIF') return { format: extension, rows: parseQif(await file.text()) };
  if (extension === 'XLSX') return { format: extension, rows: await parseXlsx(file) };
  if (extension === 'PDF') return { format: extension, rows: parsePdfLines(await pdfLines(file)) };
  throw new Error('Unsupported statement file. Use CSV, PDF, OFX, QFX, QIF or XLSX.');
}

async function sha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}



async function loadTransactions(){
 await loadResource('txPayload',I+'/transactions'+filterQuery({page:state.txMeta.page,limit:state.txMeta.limit,...state.txFilters}));
 const tx=state.resources.txPayload?.data;
 if(tx){state.tx=tx.transactions||[];state.txMeta={page:num(tx.page)||1,limit:num(tx.limit)||50,total:num(tx.total),total_pages:num(tx.total_pages)||1,summary:tx.summary||{}}}
 else state.tx=[];
 if(state.view==='transactions')render();
}
async function saveManualMovement(form){
 const fd=new FormData(form);
 const body={bank_account_id:Number(fd.get('bank_account_id')),type:fd.get('type'),transaction_date:fd.get('transaction_date'),posting_date:fd.get('posting_date')||null,amount:fd.get('amount'),description:fd.get('description'),merchant_name:fd.get('merchant_name')||null,reference:fd.get('reference')||null,category:fd.get('category')||null,ownership_scope:fd.get('ownership_scope')||null};
 return api(I+'/transactions',{method:'POST',body:JSON.stringify(body)});
}
async function openStatementWizard(){
 $('fmModalEyebrow').textContent='STATEMENT IMPORT';$('fmModalTitle').textContent='Import statement';
 $('fmModalBody').innerHTML=`<form id="statementWizard" class="fm-form"><label>1. Account<select name="account_id" required><option value="">Choose account</option>${state.accounts.map(a=>`<option value="${a.id}">${esc(a.nickname||'Account')} · ${esc(a.currency||'AUD')}</option>`).join('')}</select></label><label>2. Statement file<input name="file" type="file" accept=".csv,.pdf,.ofx,.qfx,.qif,.xlsx" required></label><p class="fm-helper">The file is parsed locally, SHA-256 hashed, staged on the server, duplicate-checked and reviewed before any transaction is committed.</p><div id="statementProgress" class="fm-state" hidden></div><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit">Extract & review</button></div></form>`;
 $('fmModal').showModal();
 document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=> $('fmModal').close());
 $('statementWizard').onsubmit=async e=>{
   e.preventDefault();const form=e.currentTarget,fd=new FormData(form),file=fd.get('file'),accountId=fd.get('account_id'),account=state.accounts.find(a=>String(a.id)===String(accountId)),progress=$('statementProgress');
   progress.hidden=false;progress.className='fm-state';progress.textContent='Reading statement…';
   try{
     const parsed=await parseStatement(file);
     parsed.rows=(parsed.rows||[]).map(row=>({...row,currency:String(row.currency||account?.currency||'AUD').toUpperCase()}));
     progress.textContent=`Extracted ${parsed.rows.length} row(s). Running validation and duplicate checks…`;
     const result=await api(I+`/accounts/${accountId}/statements/preview`,{method:'POST',body:JSON.stringify({source_format:parsed.format,original_name:file.name,content_hash:await sha256(file),rows:parsed.rows})});
     $('fmModal').close();await openStatementReview(result.import_uid);
   }catch(error){progress.className='fm-state fm-state-error';progress.textContent=error.message}
 };
}
async function openStatementReview(uid){
 try{
  const result=await api(I+'/statement-reviews/'+encodeURIComponent(uid)),session=result.session;
  openDrawer('Review '+(session.original_name||'statement'),`<div class="fm-grid four"><div class="fm-kpi"><span>Total</span><strong>${num(session.total_rows)}</strong></div><div class="fm-kpi"><span>Valid</span><strong class="good">${num(session.valid_rows)}</strong></div><div class="fm-kpi"><span>Duplicates</span><strong class="warn">${num(session.duplicate_rows)}</strong></div><div class="fm-kpi"><span>Rejected</span><strong class="bad">${num(session.rejected_rows)}</strong></div></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Use</th><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Status</th></tr></thead><tbody>${(result.rows||[]).map(row=>`<tr><td><input type="checkbox" data-review-select="${row.id}" ${Number(row.selected)?'checked':''} ${['DUPLICATE','REJECTED'].includes(row.validation_status)?'disabled':''}></td><td>${date(row.transaction_date)}</td><td>${esc(row.description)}</td><td>${num(row.debit)?nativeMoney(row.debit,row.currency||session.account_currency):''}</td><td>${num(row.credit)?nativeMoney(row.credit,row.currency||session.account_currency):''}</td><td>${statusBadge(row.validation_status)}</td></tr>`).join('')}</tbody></table></div><div class="fm-form-actions"><button type="button" data-review-reject="${esc(uid)}">Reject review</button><button class="primary" type="button" data-review-commit="${esc(uid)}">Commit selected rows</button></div>`,'STATEMENT REVIEW');
  setTimeout(()=>{
   document.querySelectorAll('[data-review-select]').forEach(c=>c.onchange=async()=>{try{await api(I+`/statement-reviews/${encodeURIComponent(uid)}/rows/${c.dataset.reviewSelect}/select`,{method:'POST',body:JSON.stringify({selected:c.checked})})}catch(error){c.checked=!c.checked;notice(error.message,true)}});
   document.querySelector('[data-review-commit]')?.addEventListener('click',async()=>{try{const x=await api(I+`/statement-reviews/${encodeURIComponent(uid)}/commit`,{method:'POST',body:'{}'});closeDrawer();notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
   document.querySelector('[data-review-reject]')?.addEventListener('click',async()=>{const reason=prompt('Reason for rejecting this statement review:');if(!reason)return;try{await api(I+`/statement-reviews/${encodeURIComponent(uid)}/reject`,{method:'POST',body:JSON.stringify({reason})});closeDrawer();await refresh()}catch(error){notice(error.message,true)}});
  },0);
 }catch(error){notice(error.message,true)}
}
function openPersonalForm(kind){
 const p=state.personal||{},wallets=p.wallets||[];
 $('fmModalEyebrow').textContent='PERSONAL MONEY';
 $('fmModalTitle').textContent=kind==='budgets'?'New budget':kind==='savings'?'New savings goal':kind==='debt'?'Borrow / lend':kind==='recurring'?'Recurring item':'Cash movement';
 if(kind==='budgets')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Month<input name="month_start" type="month" required></label><label>Category<input name="category" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label><label>Budget limit<input name="limit_amount" inputmode="decimal" required></label><div class="fm-form-actions"><button class="primary">Save budget</button></div></form>`;
 else if(kind==='savings')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Name<input name="name" required></label><label>Target amount<input name="target_amount" required></label><label>Current amount<input name="current_amount" value="0"></label><label>Currency<input name="currency" value="AUD"></label><label>Target date<input name="target_date" type="date"></label><label>Priority<select name="priority"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option></select></label><div class="fm-form-actions"><button class="primary">Create goal</button></div></form>`;
 else if(kind==='debt')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Direction<select name="direction"><option value="BORROWED">I borrowed</option><option value="LENT">I lent</option></select></label><label>Person / entity<input name="counterparty" required></label><label>Amount<input name="principal_amount" required></label><label>Currency<input name="currency" value="AUD"></label><label>Due date<input name="due_date" type="date"></label><label>Note<textarea name="note"></textarea></label><div class="fm-form-actions"><button class="primary">Save</button></div></form>`;
 else if(kind==='recurring')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Name<input name="name" required></label><label>Type<select name="item_type"><option>BILL</option><option>SUBSCRIPTION</option><option>INCOME</option></select></label><label>Amount<input name="amount" required></label><label>Currency<input name="currency" value="AUD"></label><label>Frequency<select name="frequency"><option>WEEKLY</option><option>FORTNIGHTLY</option><option selected>MONTHLY</option><option>QUARTERLY</option><option>YEARLY</option></select></label><label>Next due<input name="next_due_date" type="date" required></label><div class="fm-form-actions"><button class="primary">Save recurring item</button></div></form>`;
 else $('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Wallet<select name="wallet_id" required><option value="">Choose wallet</option>${wallets.map(w=>`<option value="${w.id}">${esc(w.name)} · ${esc(w.currency)}</option>`).join('')}</select></label><label>Type<select name="entry_type"><option>EXPENSE</option><option>INCOME</option><option>CASH_OUT</option><option>CASH_IN</option></select></label><label>Amount<input name="amount" required></label><label>Currency<input name="currency" value="${esc(wallets[0]?.currency||'AUD')}"></label><label>Category<input name="category"></label><label>Counterparty<input name="counterparty"></label><label>Date/time<input name="occurred_at" type="datetime-local"></label><div class="fm-form-actions"><button class="primary">Record movement</button></div></form>`;
 $('fmModal').showModal();
 $('personalForm').onsubmit=async e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget);let path=API+'/personal-money/entries',body=Object.fromEntries(fd.entries());
  if(kind==='budgets'){path=API+'/personal-money/budgets';body.month_start=(body.month_start||'')+'-01'}else if(kind==='savings')path=API+'/personal-money/goals';else if(kind==='debt')path=API+'/personal-money/debts';else if(kind==='recurring')path=API+'/personal-money/recurring';
  try{await api(path,{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice('Saved.');await refresh()}catch(error){notice(error.message,true)}
 };
}
function render(){
 const [t,sub]=title(state.view);$('fmTitle').textContent=t;$('fmSubtitle').textContent=sub;navButtons();
 $('fmContent').innerHTML=state.view==='overview'?overview():state.view==='accounts'?accounts():state.view==='transactions'?transactions():state.view==='statements'?statements():simpleView(state.view);
 bindDynamic();
}
async function go(v){state.view=v;history.replaceState(null,'','#'+v);render()}
function bindDynamic(){
 document.querySelectorAll('[data-viewjump]').forEach(b=>b.onclick=()=>go(b.dataset.viewjump));
 document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>openNew(b.dataset.quick));
 document.querySelectorAll('[data-personal-new]').forEach(b=>b.onclick=()=>openPersonalForm(b.dataset.personalNew));
 document.querySelectorAll('[data-tx]').forEach(r=>r.onclick=()=>transactionDetail(r.dataset.tx));
 document.querySelectorAll('[data-account]').forEach(r=>r.onclick=()=>accountDetail(r.dataset.account));
 document.querySelectorAll('[data-review]').forEach(r=>r.onclick=()=>openStatementReview(r.dataset.review));
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.txFilters.category=b.dataset.category;state.txMeta.page=1;state.view='transactions';history.replaceState(null,'','#transactions');loadTransactions()});
 document.querySelectorAll('[data-scope-jump]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scopeJump;$('fmScope').value=state.scope;refresh()});
 document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>{location.href=b.dataset.export});
 document.querySelectorAll('[data-retry]').forEach(b=>b.onclick=refresh);
 if($('txApply'))$('txApply').onclick=()=>{state.txFilters={...state.txFilters,q:$('txSearch').value.trim(),type:$('txType').value,category:$('txCategory').value.trim(),merchant:$('txMerchant').value.trim(),source:$('txSource').value,reconciliation_status:$('txRecon').value,amount_min:$('txMin').value.trim(),amount_max:$('txMax').value.trim()};state.txMeta.page=1;loadTransactions()};
 if($('txPrev'))$('txPrev').onclick=()=>{if(state.txMeta.page>1){state.txMeta.page-=1;loadTransactions()}};
 if($('txNext'))$('txNext').onclick=()=>{if(state.txMeta.page<state.txMeta.total_pages){state.txMeta.page+=1;loadTransactions()}};
 if($('runAnalysis'))$('runAnalysis').onclick=async()=>{try{await api(I+'/analyse',{method:'POST',body:JSON.stringify({scope:state.scope})});notice('Finance analysis refreshed.');await refresh()}catch(error){notice(error.message,true)}};
}
function openDrawer(title,body,eyebrow='DETAIL'){$('fmDrawerEyebrow').textContent=eyebrow;$('fmDrawerTitle').textContent=title;$('fmDrawerBody').innerHTML=body;$('fmDrawer').classList.add('open');$('fmDrawer').setAttribute('aria-hidden','false');$('fmBackdrop').hidden=false}
function closeDrawer(){$('fmDrawer').classList.remove('open');$('fmDrawer').setAttribute('aria-hidden','true');$('fmBackdrop').hidden=true}
async function transactionDetail(id){
 try{
  const d=await api(I+'/transactions/'+id),r=d.transaction||d;
  let provenance=null,provenanceError=null;
  try{provenance=await api(API+'/bank-transactions/'+id+'/original')}catch(error){provenanceError=error}
  const original=provenance?.original;
  let receiptPayload=null,receiptError=null;
  try{receiptPayload=await api(API+'/bank-transactions/'+id+'/receipts')}catch(error){receiptError=error}
  const receipts=receiptPayload?.receipts||[];
  let sourceBlock='';
  if(r.source_type==='MANUAL') sourceBlock=`<div class="fm-card"><div class="fm-pad"><h3>Source provenance</h3><p class="fm-helper">Manual Voxel Veda entry. No external bank source record exists.</p></div></div>`;
  else if(provenanceError) sourceBlock=`<div class="fm-state fm-state-error"><strong>Original bank data unavailable</strong><p>${esc(provenanceError.message)}</p></div>`;
  else if(original) sourceBlock=`<div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>ORIGINAL BANK DATA</h3><p>Immutable source evidence. Current classification is shown separately.</p></div></div><div class="fm-detail-grid"><span>Original date<b>${date(original.transaction_date)}</b></span><span>Posting date<b>${date(original.posting_date)}</b></span><span>Description<b>${esc(original.description||'—')}</b></span><span>Merchant<b>${esc(original.merchant_string||'—')}</b></span><span>Reference<b>${esc(original.reference||'—')}</b></span><span>Bank category<b>${esc(original.bank_category||'—')}</b></span><span>Debit<b>${original.debit?nativeMoney(original.debit,original.currency||r.currency):'—'}</b></span><span>Credit<b>${original.credit?nativeMoney(original.credit,original.currency||r.currency):'—'}</b></span><span>Running balance<b>${original.running_balance!==null&&original.running_balance!==undefined?nativeMoney(original.running_balance,original.currency||r.currency):'—'}</b></span><span>Currency<b>${esc(original.currency||'—')}</b></span></div></div></div>`;
  else sourceBlock=`<div class="fm-card"><div class="fm-pad"><h3>Original bank data</h3><p class="fm-helper">No immutable external-source record is attached to this transaction.</p></div></div>`;
  const receiptBlock=receiptError
    ? `<div class="fm-state fm-state-error"><strong>Receipts unavailable</strong><p>${esc(receiptError.message)}</p></div>`
    : `<div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Receipts & attachments</h3><p>Private documents are scanned and served only through authenticated download routes.</p></div></div><div class="fm-list">${receipts.map(doc=>`<div class="fm-row"><div><h3>${esc(doc.original_name)}</h3><p>${esc(doc.mime_type||'')} · ${esc(doc.scan_status||'')}</p></div><div class="fm-row-right"><a href="${esc(doc.download_url)}" target="_blank" rel="noopener">View</a><button type="button" data-receipt-unlink="${esc(doc.id)}">Unlink</button></div></div>`).join('')||emptyState('No receipt attached','Upload a JPG, PNG, HEIC or PDF receipt.')}</div><form id="receiptUploadForm" class="fm-form"><label>Attach receipt<input name="file" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" capture="environment" required></label><div class="fm-form-actions"><button class="primary" type="submit">Upload securely</button></div></form></div></div>`;
  openDrawer(r.merchant_name||r.description||'Transaction',`<div class="fm-grid two"><div class="fm-kpi"><span>Amount</span><strong>${nativeMoney(Math.abs(num(r.credit||0)-num(r.debit||0)),r.currency||'AUD')}</strong><small>${Number(r.is_internal_transfer)?'Internal transfer':num(r.debit)>0?'Expense':'Income'} · ${esc(r.currency||'')}</small></div><div class="fm-kpi"><span>Reconciliation</span><strong>${esc(r.reconciliation_status||'')}</strong><small>${esc(r.source_type||'')}</small></div></div><div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>CURRENT CLASSIFICATION</h3><p>Editable classification never overwrites original bank evidence.</p></div></div><form id="txEditForm" class="fm-form"><div class="fm-form-grid"><label>Category<input name="category" value="${esc(r.category||'')}"></label><label>Ownership<select name="ownership_scope"><option ${r.ownership_scope==='PERSONAL'?'selected':''}>PERSONAL</option><option ${r.ownership_scope==='BUSINESS'?'selected':''}>BUSINESS</option><option ${r.ownership_scope==='MIXED'?'selected':''}>MIXED</option><option ${r.ownership_scope==='UNCLASSIFIED'?'selected':''}>UNCLASSIFIED</option></select></label></div><div class="fm-detail-grid"><span>Date<b>${date(r.transaction_date)}</b></span><span>Posting date<b>${date(r.posting_date)}</b></span><span>Account<b>${esc(r.account_name||'')}</b></span><span>Bank<b>${esc(r.institution||'')}</b></span><span>Description<b>${esc(r.description||'')}</b></span><span>Reference<b>${esc(r.reference||'—')}</b></span><span>Source<b>${esc(r.source_type||'')}</b></span><span>Statement<b>${esc(r.statement_import_uid||'—')}</b></span></div><label class="fm-check"><input name="is_internal_transfer" type="checkbox" ${Number(r.is_internal_transfer)?'checked':''}> Mark as internal transfer</label><label class="fm-check"><input name="remember_rule" type="checkbox"> Remember as suggestion rule</label><div class="fm-form-actions"><button class="primary" type="submit">Save classification</button></div></form></div></div>${sourceBlock}${receiptBlock}`,'TRANSACTION');
  setTimeout(()=>{
   $('txEditForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(I+'/transactions/'+id,{method:'POST',body:JSON.stringify({category:fd.get('category'),ownership_scope:fd.get('ownership_scope'),is_internal_transfer:fd.get('is_internal_transfer')==='on',remember_rule:fd.get('remember_rule')==='on'})});notice(x.message);closeDrawer();await refresh()}catch(error){notice(error.message,true)}};
   if($('receiptUploadForm'))$('receiptUploadForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const response=await fetch(API+'/bank-transactions/'+id+'/receipts',{method:'POST',credentials:'same-origin',body:fd});let payload={};try{payload=await response.json()}catch{}if(!response.ok)throw new Error(payload.message||'Receipt upload failed');notice(payload.message||'Receipt attached.');await transactionDetail(id)}catch(error){notice(error.message,true)}};
   document.querySelectorAll('[data-receipt-unlink]').forEach(b=>b.onclick=async()=>{if(!confirm('Unlink this receipt from the transaction?'))return;try{const x=await api(API+'/bank-transactions/'+id+'/receipts/'+encodeURIComponent(b.dataset.receiptUnlink),{method:'DELETE'});notice(x.message);await transactionDetail(id)}catch(error){notice(error.message,true)}});
  },0);
 }catch(error){notice(error.message,true)}
}
async function accountDetail(id){
 try{
  const [detailResult,lifecycleResult]=await Promise.allSettled([api(OS+'/accounts/'+id),api(I+'/accounts/'+id+'/lifecycle')]);
  if(detailResult.status==='rejected')throw detailResult.reason;
  const d=detailResult.value,a=d.account||state.accounts.find(x=>String(x.id)===String(id))||{},life=lifecycleResult.status==='fulfilled'?lifecycleResult.value?.lifecycle:null;
  const monthly=d.monthly||[],max=Math.max(1,...monthly.flatMap(x=>[num(x.money_in),num(x.money_out)]));
  const chart=monthly.length?monthly.map(x=>`<div class="fm-chart-row"><span>${esc(x.month)}</span><div class="fm-bars"><i class="in" style="width:${Math.max(2,num(x.money_in)/max*100)}%"></i><i class="out" style="width:${Math.max(2,num(x.money_out)/max*100)}%"></i></div><b>${nativeMoney(num(x.money_in)-num(x.money_out),a.currency||'AUD')}</b></div>`).join(''):emptyState('No account trend','No recent monthly activity.');
  const categories=(d.categories||[]).map(x=>`<div class="fm-row"><span>${esc(x.category)}</span><b>${nativeMoney(x.spent,a.currency||'AUD')}</b></div>`).join('')||emptyState('No categories','No recent account expense categories.');
  const tx=(d.transactions||[]).slice(0,20).map(x=>`<div class="fm-row" data-tx="${x.id}"><div><h3>${esc(x.merchant_name||x.description)}</h3><p>${date(x.transaction_date)} · ${esc(x.category||'Uncategorised')}</p></div><b>${nativeMoney(Math.abs(num(x.credit)-num(x.debit)),x.currency||a.currency||'AUD')}</b></div>`).join('');
  const deleteButton=life?.deletion_check?.eligible?`<button class="bad" data-account-action="delete" data-id="${a.id}">Permanently delete eligible empty account</button>`:'';
  openDrawer(a.nickname||'Account',`<div class="fm-account-tabs"><button class="active">Overview</button><button data-account-tx="${a.id}">Transactions</button><button data-viewjump="statements">Statements</button><button data-viewjump="reconciliation">Reconciliation</button></div><div class="fm-grid four"><div class="fm-kpi"><span>Current / available balance</span><strong>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</strong><small>Current position</small></div><div class="fm-kpi"><span>90-day money in</span><strong class="good">${nativeMoney(d.metrics?.income_90d||0,a.currency||'AUD')}</strong></div><div class="fm-kpi"><span>90-day money out</span><strong class="bad">${nativeMoney(d.metrics?.spend_90d||0,a.currency||'AUD')}</strong></div><div class="fm-kpi"><span>90-day net</span><strong>${nativeMoney(d.metrics?.net_90d||0,a.currency||'AUD')}</strong></div></div><div class="fm-card"><div class="fm-pad"><div class="fm-detail-grid"><span>Institution<b>${esc(a.institution||'—')}</b></span><span>Type<b>${esc(a.account_type||'—')}</b></span><span>Masked number<b>${esc(a.account_number_masked||'—')}</b></span><span>Ownership<b>${esc(a.ownership_scope||'—')}</b></span><span>Currency<b>${esc(a.currency||'—')}</b></span><span>Connection<b>${esc(a.connection_status||a.connection_type||'MANUAL')}</b></span><span>Last sync<b>${date(a.last_synced_at)}</b></span><span>History<b>${date(a.history_start_date)} → ${date(a.history_end_date)}</b></span></div></div></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><h3>Balance / cash-flow trend</h3><div class="fm-chart">${chart}</div></div></article><article class="fm-card"><div class="fm-pad"><h3>Category distribution</h3><div class="fm-list">${categories}</div></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><h3>Recent transactions</h3><button data-quick-account="${a.id}">+ Transaction</button></div><div class="fm-list">${tx||emptyState('No transactions','No visible activity for this account.')}</div></div></article><details class="fm-danger"><summary>Danger Zone</summary><p>Archive or inactive is preferred. Permanent deletion is shown only when the server dependency scan says the account is eligible and still requires privileged step-up.</p><div class="fm-hero-actions"><button data-account-action="inactive" data-id="${a.id}">Set inactive</button><button data-account-action="archive" data-id="${a.id}">Archive</button><button data-account-action="restore" data-id="${a.id}">Restore</button>${deleteButton}</div></details>`,'ACCOUNT WORKSPACE');
  setTimeout(()=>{
   document.querySelectorAll('[data-account-action]').forEach(b=>b.onclick=()=>accountLifecycle(b.dataset.id,b.dataset.accountAction));
   document.querySelectorAll('[data-tx]').forEach(x=>x.onclick=()=>transactionDetail(x.dataset.tx));
   document.querySelector('[data-account-tx]')?.addEventListener('click',()=>{state.account=String(a.id);$('fmAccount').value=state.account;closeDrawer();go('transactions');loadTransactions()});
   document.querySelector('[data-quick-account]')?.addEventListener('click',()=>openNew('expense',a.id));
   document.querySelectorAll('[data-viewjump]').forEach(x=>x.onclick=()=>{closeDrawer();go(x.dataset.viewjump)});
  },0);
 }catch(error){notice(error.message,true)}
}
async function accountLifecycle(id,action){const map={inactive:['POST',I+'/accounts/'+id+'/inactive'],archive:['POST',I+'/accounts/'+id+'/archive'],restore:['POST',I+'/accounts/'+id+'/restore'],delete:['DELETE',I+'/accounts/'+id]};const cfg=map[action];if(!cfg)return;if(action==='delete'&&!confirm('Permanently delete this empty account? This action is blocked if dependencies exist.'))return;try{await api(cfg[1],{method:cfg[0],body:cfg[0]==='POST'?'{}':undefined});notice('Account updated.');closeDrawer();await refresh()}catch(e){notice(e.message,true)}}
function openNew(kind='expense',presetAccount=''){
 if(kind==='statement'){openStatementWizard();return}
 $('fmModalEyebrow').textContent='NEW FINANCIAL MOVEMENT';$('fmModalTitle').textContent='Add financial movement';
 const defaultType=kind==='income'?'INCOME':'EXPENSE';
 $('fmModalBody').innerHTML=`<form id="fmEntryForm" class="fm-form"><div class="fm-form-grid"><label>Type<select name="type"><option value="EXPENSE" ${defaultType==='EXPENSE'?'selected':''}>Expense</option><option value="INCOME" ${defaultType==='INCOME'?'selected':''}>Income</option><option value="ADJUSTMENT_IN">Adjustment In</option><option value="ADJUSTMENT_OUT">Adjustment Out</option></select></label><label>Date<input name="transaction_date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label></div><label>Account<select name="bank_account_id" required><option value="">Select account</option>${state.accounts.map(a=>`<option value="${a.id}" ${String(a.id)===String(presetAccount)?'selected':''}>${esc(a.nickname||a.account_name||'Account')} · ${esc(a.currency||'AUD')}</option>`).join('')}</select></label><label>Amount<input name="amount" inputmode="decimal" required></label><label>Description<input name="description" required></label><div class="fm-form-grid"><label>Merchant / Payee<input name="merchant_name"></label><label>Reference<input name="reference"></label></div><div class="fm-form-grid"><label>Category<input name="category"></label><label>Ownership<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option><option>MIXED</option><option>UNCLASSIFIED</option></select></label></div><p class="fm-helper">The selected account's native currency is authoritative. No FX rate is invented or inferred.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit">Save movement</button></div></form>`;
 $('fmModal').showModal();
 document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=> $('fmModal').close());
 $('fmEntryForm').onsubmit=async e=>{e.preventDefault();try{const x=await saveManualMovement(e.currentTarget);$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
async function refresh(){notice('');$('fmContent').innerHTML='<div class="fm-loading"><span></span><b>Refreshing finance workspace…</b></div>';await loadBase();render()}
function bind(){
 $('fmScope').onchange=e=>{state.scope=e.target.value;state.txMeta.page=1;refresh()};
 $('fmAccount').onchange=e=>{state.account=e.target.value;state.txMeta.page=1;refresh()};
 $('fmPeriod').onchange=e=>{state.period=e.target.value;const custom=state.period==='custom';$('fmFromWrap').hidden=!custom;$('fmToWrap').hidden=!custom;if(!custom)refresh()};
 $('fmFrom').onchange=e=>{state.customFrom=e.target.value;if(state.period==='custom'&&state.customTo)refresh()};
 $('fmTo').onchange=e=>{state.customTo=e.target.value;if(state.period==='custom'&&state.customFrom)refresh()};
 $('fmCurrencyMode').onchange=()=>notice('Reporting-currency conversion is unavailable because no verified FX-rate service is configured. Native currency mode remains active.');
 $('fmRefresh').onclick=refresh;$('fmNew').onclick=()=>openNew('expense');$('fmDrawerClose').onclick=closeDrawer;$('fmBackdrop').onclick=closeDrawer;$('fmModalClose').onclick=()=> $('fmModal').close();
 $('fmSearch').onkeydown=e=>{if(e.key==='Enter'){state.txFilters.q=e.currentTarget.value.trim();state.txMeta.page=1;state.view='transactions';history.replaceState(null,'','#transactions');loadTransactions()}};
}
document.addEventListener('DOMContentLoaded',async()=>{bind();const h=location.hash.slice(1);if(NAV.some(x=>x[0]===h))state.view=h;navButtons();try{await loadBase();render()}catch(e){notice(e.message||'Finance workspace failed to load',true)}})
})();