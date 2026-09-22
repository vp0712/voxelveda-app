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
 const err=resourceError('dash','Financial overview');if(err)return err;
 const rows=currencyRows();const mixed=mixedCurrencyMessage(rows);const one=rows[0]||{currency:'AUD',balance:0,money_in:0,money_out:0,net_flow:0};
 const position=rows.length===1?nativeMoney(one.balance,one.currency):'Mixed currencies';
 const kpis=rows.length?rows.map(r=>\`<div class="fm-kpi"><span>\${esc(r.currency)} · Available balance</span><strong>\${nativeMoney(r.balance,r.currency)}</strong><small>Current balance — not period filtered</small></div><div class="fm-kpi"><span>\${esc(r.currency)} · Money in</span><strong class="good">\${nativeMoney(r.money_in,r.currency)}</strong><small>Selected period</small></div><div class="fm-kpi"><span>\${esc(r.currency)} · Money out</span><strong class="bad">\${nativeMoney(r.money_out,r.currency)}</strong><small>Selected period · transfers excluded</small></div><div class="fm-kpi"><span>\${esc(r.currency)} · Net cash flow</span><strong>\${nativeMoney(r.net_flow,r.currency)}</strong><small>Income minus expense</small></div>\`).join(''):'<div class="fm-empty">No visible financial activity.</div>';
 return \`<div class="fm-grid two"><article class="fm-card fm-hero"><div class="fm-pad"><small>TOTAL FINANCIAL POSITION</small><strong>\${position}</strong><p>\${mixed||'Current account position. Period activity is shown separately.'}</p><div class="fm-hero-actions"><button class="accent" data-quick="expense">Add movement</button><button data-quick="statement">Upload statement</button><button data-viewjump="reports">Reports</button></div></div></article><div class="fm-grid two">\${kpis}</div></div>\`;
}
function recentRows(){
 const rows=state.dash?.recent_transactions||state.tx.slice(0,8);
 return rows.length?rows.slice(0,8).map(r=>{const amount=num(r.credit||0)-num(r.debit||0);return \`<div class="fm-row" data-tx="\${r.id}"><div><h3>\${esc(r.merchant_name||r.description||'Transaction')}</h3><p>\${date(r.transaction_date)} · \${esc(r.account_name||'Account')} · \${esc(r.category||'Uncategorised')}</p></div><div class="fm-row-right"><b class="\${amount<0?'bad':'good'}">\${nativeMoney(Math.abs(amount),r.currency||'AUD')}</b><small>\${Number(r.is_internal_transfer)?'Internal transfer':esc(r.reconciliation_status||'')}</small></div></div>\`}).join(''):emptyState('No transactions','Import a statement or add a manual financial movement.');
}
function overview(){
 const err=resourceError('dash','Finance dashboard');if(err)return err;
 const accountRows=state.accounts.slice(0,6).map(a=>\`<div class="fm-row" data-account="\${a.id}"><div><h3>\${esc(a.nickname||a.account_name||'Account')}</h3><p>\${esc(a.institution||'Financial account')} · \${esc(a.ownership_scope||'')}</p></div><div class="fm-row-right"><b>\${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</b><small>\${esc(a.currency||'AUD')}</small></div></div>\`).join('');
 const monthly=Array.isArray(state.dash?.monthly)?state.dash.monthly:[];const max=Math.max(1,...monthly.flatMap(x=>[num(x.money_in),num(x.money_out)]));
 const chart=monthly.length?monthly.slice(-12).map(x=>\`<div class="fm-chart-row"><span>\${esc(x.month)} · \${esc(x.currency)}</span><div class="fm-bars"><i class="in" style="width:\${Math.max(2,num(x.money_in)/max*100)}%" title="Money in \${nativeMoney(x.money_in,x.currency)}"></i><i class="out" style="width:\${Math.max(2,num(x.money_out)/max*100)}%" title="Money out \${nativeMoney(x.money_out,x.currency)}"></i></div><b>\${nativeMoney(num(x.money_in)-num(x.money_out),x.currency)}</b></div>\`).join(''):emptyState('No cash-flow trend','No transactions exist in the selected period.');
 const cats=Array.isArray(state.dash?.categories)?state.dash.categories:[];const catList=cats.slice(0,8).map(x=>\`<button class="fm-distribution" data-category="\${esc(x.category)}"><span>\${esc(x.category)} · \${esc(x.currency)}</span><b>\${nativeMoney(x.spent,x.currency)}</b></button>\`).join('')||emptyState('No expense distribution','No expenses exist in the selected period.');
 const q=state.quality||{};const ins=state.insights?.summary||{};const attention=[['Uncategorised',q.unclassified_transactions??q.unclassified,'transactions'],['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],['Ownership missing',q.ownership_missing,'review'],['History coverage unknown',q.unknown_history_coverage,'accounts'],['Transfer candidates',ins.transfer_candidates,'insights'],['Anomalies',ins.anomalies,'insights']].filter(x=>num(x[1])>0);
 const attentionHtml=attention.length?attention.map(([l,n,v])=>\`<button class="fm-attention" data-viewjump="\${v}"><b>\${num(n)}</b><span>\${esc(l)}</span></button>\`).join(''):emptyState('No current attention items','No review counts were returned for the selected scope.');
 return hero()+\`<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Cash Flow Trend</h2><p>Real money in/out grouped by month and native currency.</p></div></div><div class="fm-chart" role="img" aria-label="Cash flow trend">\${chart}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Expense Distribution</h2><p>Click a category to drill into matching transactions.</p></div></div><div class="fm-distributions">\${catList}</div></div></article></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Needs your attention</h2><p>Direct queues, not decorative alerts.</p></div></div><div class="fm-attention-grid">\${attentionHtml}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Accounts</h2><p>Balances are current positions and never period-filtered.</p></div><button data-viewjump="accounts">Manage</button></div><div class="fm-list">\${accountRows||emptyState('No accounts','Add an account or import a statement.')}</div></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Recent transactions</h2><p>Drill into current classification and immutable source evidence.</p></div><button data-viewjump="transactions">View all</button></div><div class="fm-list">\${recentRows()}</div></div></article>\`;
}
function accounts(){
 const err=resourceError('dash','Accounts');if(err&&!state.accounts.length)return err;
 const coverage=Array.isArray(state.history?.accounts)?state.history.accounts:[];
 return \`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Financial accounts</h2><p>Open an account for overview, transactions, analytics, reconciliation and lifecycle controls.</p></div><button data-quick="account">+ Add account</button></div><div class="fm-account-grid">\${state.accounts.map(a=>{const c=coverage.find(x=>String(x.id||x.bank_account_id)===String(a.id))||{};return \`<button class="fm-account-card" data-account="\${a.id}"><span class="fm-account-type">\${esc(a.account_type||'Account')}</span><h3>\${esc(a.nickname||'Account')}</h3><p>\${esc(a.institution||'Manual')} · \${esc(a.account_number_masked||'number masked')}</p><strong>\${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</strong><small>\${esc(a.ownership_scope||'')} · \${esc(a.connection_status||'MANUAL')}</small><div class="fm-coverage"><span>Coverage</span><b>\${date(c.transaction_start||a.history_start_date)} → \${date(c.transaction_end||a.history_end_date)}</b></div></button>\`}).join('')||emptyState('No accounts','Create a financial account to begin.')}</div></div></article>\`;
}
function transactions(){
 const meta=state.txMeta||{};const f=state.txFilters;
 return \`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Transaction Explorer</h2><p>\${num(meta.total)} matching records · server-side filters and pagination.</p></div><button data-quick="expense">+ Financial movement</button></div><div class="fm-filter-grid"><input id="txSearch" value="\${esc(f.q)}" placeholder="Search description, merchant, reference, account"><select id="txType"><option value="">All types</option><option value="EXPENSE" \${f.type==='EXPENSE'?'selected':''}>Expense</option><option value="INCOME" \${f.type==='INCOME'?'selected':''}>Income</option><option value="TRANSFER" \${f.type==='TRANSFER'?'selected':''}>Transfer</option></select><input id="txCategory" value="\${esc(f.category)}" placeholder="Category"><input id="txMerchant" value="\${esc(f.merchant)}" placeholder="Merchant"><select id="txSource"><option value="">All sources</option><option value="STATEMENT_IMPORT" \${f.source==='STATEMENT_IMPORT'?'selected':''}>Statement import</option><option value="MANUAL" \${f.source==='MANUAL'?'selected':''}>Manual</option><option value="OPEN_BANKING" \${f.source==='OPEN_BANKING'?'selected':''}>Open Banking</option></select><select id="txRecon"><option value="">All reconciliation</option><option value="UNRECONCILED" \${f.reconciliation_status==='UNRECONCILED'?'selected':''}>Unreconciled</option><option value="RECONCILED" \${f.reconciliation_status==='RECONCILED'?'selected':''}>Reconciled</option></select><input id="txMin" value="\${esc(f.amount_min)}" inputmode="decimal" placeholder="Min amount"><input id="txMax" value="\${esc(f.amount_max)}" inputmode="decimal" placeholder="Max amount"><button id="txApply" class="fm-primary" type="button">Apply filters</button></div>\${resourceError('txPayload','Transaction ledger')}<div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Bank</th><th>Merchant / Description</th><th>Category</th><th>Type</th><th>Scope</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Source</th><th>Reconciliation</th></tr></thead><tbody>\${state.tx.map(r=>\`<tr data-tx="\${r.id}"><td>\${date(r.transaction_date)}</td><td>\${esc(r.account_name||'')}</td><td>\${esc(r.institution||'')}</td><td><b>\${esc(r.merchant_name||'')}</b><small>\${esc(r.description||'')}</small></td><td>\${esc(r.category||'Uncategorised')}</td><td>\${Number(r.is_internal_transfer)?'Transfer':num(r.debit)>0?'Expense':'Income'}</td><td>\${esc(r.ownership_scope||'')}</td><td>\${esc(r.currency||'')}</td><td>\${num(r.debit)?nativeMoney(r.debit,r.currency):''}</td><td>\${num(r.credit)?nativeMoney(r.credit,r.currency):''}</td><td>\${esc(r.source_type||'')}</td><td>\${statusBadge(r.reconciliation_status)}</td></tr>\`).join('')||\`<tr><td colspan="12">\${emptyState('No matching transactions','Change filters or import financial history.')}</td></tr>\`}</tbody></table></div><div class="fm-pagination"><button id="txPrev" \${meta.page<=1?'disabled':''}>Previous</button><span>Page \${num(meta.page)||1} of \${num(meta.total_pages)||1}</span><button id="txNext" \${meta.page>=meta.total_pages?'disabled':''}>Next</button></div></div></article>\`;
}
function statements(){
 const pending=state.reviews.filter(x=>x.status==='PENDING_REVIEW');
 return \`<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement Import Wizard</h2><p>Choose account → upload → extract → review → duplicate validation → commit.</p></div><button data-quick="statement">Start import</button></div><div class="fm-list">\${pending.slice(0,8).map(x=>\`<div class="fm-row" data-review="\${esc(x.import_uid)}"><div><h3>\${esc(x.original_name||'Statement review')}</h3><p>\${esc(x.account_name||'')} · \${esc(x.source_format||'')} · \${num(x.total_rows)} rows</p></div><div class="fm-row-right">\${statusBadge(x.status)}<small>\${num(x.duplicate_rows)} duplicates · \${num(x.rejected_rows)} rejected</small></div></div>\`).join('')||emptyState('No pending reviews','New statement uploads will appear here before they affect the ledger.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Supported formats</h2><p>Only formats handled by the current parser are shown.</p></div></div><div class="fm-format-grid"><span>CSV</span><span>PDF</span><span>OFX</span><span>QFX</span><span>QIF</span><span>XLSX</span></div><p class="fm-helper">Every extracted row is staged through the protected server review engine before commit.</p></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement Vault</h2><p>Committed history with coverage and import quality.</p></div></div>\${resourceError('statementPayload','Statement Vault')}<div class="fm-list">\${state.statements.map(x=>\`<div class="fm-row"><div><h3>\${esc(x.original_name||'Statement')}</h3><p>\${esc(x.account_name||'')} · \${date(x.statement_start_date)} – \${date(x.statement_end_date)} · \${esc(x.source_format||'')}</p></div><div class="fm-row-right"><b>\${num(x.imported_rows)} imported</b><small>\${num(x.duplicate_rows)} duplicates · \${num(x.rejected_rows)} rejected</small></div></div>\`).join('')||emptyState('No committed statements','Use the import wizard to build verified account history.')}</div></div></article>\`;
}
function personalCard(kind){
 const p=state.personal||{};const a=state.personalAttention||{};
 const data=kind==='budgets'?(p.budgets||[]):kind==='savings'?(a.goals||[]):kind==='debt'?(p.debts||[]):(a.recurring||[]);
 const label=kind==='budgets'?'Budgets':kind==='savings'?'Savings Goals':kind==='debt'?'Borrow & Lend':'Recurring Money';
 return \`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>\${label}</h2><p>Owner-only Personal Money records. They are not silently added to company/bank totals.</p></div><button data-personal-new="\${kind}">+ Add</button></div><div class="fm-list">\${data.map(x=>{const amount=kind==='budgets'?x.limit_amount:kind==='savings'?x.target_amount:kind==='debt'?x.outstanding_amount:x.amount;return \`<div class="fm-row"><div><h3>\${esc(x.name||x.category||x.counterparty||'Item')}</h3><p>\${esc(x.status||x.frequency||'')} \${x.due_date?'· '+date(x.due_date):''}</p></div><div class="fm-row-right"><b>\${nativeMoney(amount||0,x.currency||'AUD')}</b><small>\${kind==='budgets'?(num(x.used_percent)+'% used'):kind==='savings'?(nativeMoney(x.current_amount||0,x.currency)+' saved'):kind==='debt'?'remaining':''}</small></div></div>\`}).join('')||emptyState('No records yet','Use Add to create the first record.')}</div></div></article>\`;
}

function personalView(){
 const p=state.personal||{}, totals=p.wallet_totals||{}, debts=p.debt_totals_by_currency||{};
 const cards=Object.entries(totals).map(([c,v])=>\`<div class="fm-kpi"><span>\${esc(c)} wallets</span><strong>\${nativeMoney(v,c)}</strong><small>Owner-only Personal Money</small></div>\`).join('');
 const debtCards=Object.entries(debts).map(([c,v])=>\`<div class="fm-kpi"><span>\${esc(c)} owed to me</span><strong>\${nativeMoney(v.lent_open,c)}</strong><small>Open lending</small></div><div class="fm-kpi"><span>\${esc(c)} I owe</span><strong>\${nativeMoney(v.borrowed_open,c)}</strong><small>Open borrowing</small></div>\`).join('');
 return \`\${resourceError('personal','My Money')}<div class="fm-grid four">\${cards+debtCards||'<div class="fm-kpi"><span>Personal Money</span><strong>—</strong><small>No owner-only wallets yet</small></div>'}</div><div class="fm-grid two">\${personalCard('budgets')}\${personalCard('debt')}</div>\`;
}
function companyView(){
 if(state.scope!=='BUSINESS')return \`<article class="fm-card"><div class="fm-pad">\${emptyState('Company workspace','Switch the Workspace filter to Company for business-only finance.','<button class="fm-primary" data-scope-jump="BUSINESS">Switch to Company</button>')}</div></article>\`;
 const bills=state.os?.approval_inbox||[];
 return overview()+\`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Company controls</h2><p>Company-only finance remains separated from owner-only Personal Money.</p></div></div><div class="fm-grid four"><div class="fm-kpi"><span>Approval inbox</span><strong>\${bills.length}</strong><small>Banking payment instructions awaiting approval</small></div><div class="fm-kpi"><span>Overdue obligations</span><strong>\${num(state.os?.obligations?.overdue)}</strong><small>Internal payment workflow obligations</small></div></div></div></article>\`;
}
function consolidatedView(){
 if(state.scope!=='ALL')return \`<article class="fm-card"><div class="fm-pad">\${emptyState('Consolidated workspace','Switch to Consolidated to see all permitted accounts while ownership remains visible.','<button class="fm-primary" data-scope-jump="ALL">Switch to Consolidated</button>')}</div></article>\`;
 return overview();
}
function cashView(){
 const p=state.personal||{}, wallets=p.wallets||[];
 const cashAccounts=state.accounts.filter(a=>/CASH|PETTY|TILL/i.test(String(a.account_type||'')+' '+String(a.nickname||'')));
 return \`<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Canonical cash accounts</h2><p>Company/banking cash accounts stay in the same bank transaction ledger.</p></div><button data-quick="account">+ Cash account</button></div><div class="fm-list">\${cashAccounts.map(a=>\`<div class="fm-row" data-account="\${a.id}"><div><h3>\${esc(a.nickname)}</h3><p>\${esc(a.account_type||'Cash')} · \${esc(a.ownership_scope||'')}</p></div><b>\${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency)}</b></div>\`).join('')||emptyState('No canonical cash accounts','Create a Cash or Petty Cash account for company cash tracking.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Personal cash wallets</h2><p>Owner-only Personal Money wallets are intentionally not merged into company totals.</p></div><button data-personal-new="cash">+ Cash movement</button></div><div class="fm-list">\${wallets.map(w=>\`<div class="fm-row"><div><h3>\${esc(w.name)}</h3><p>Personal wallet · \${esc(w.currency)}</p></div><b>\${nativeMoney(w.balance,w.currency)}</b></div>\`).join('')||emptyState('No personal wallets','Create a Personal Money wallet before recording personal cash movements.')}</div></div></article></div>\`;
}
function insightsView(){
 const rows=state.insights?.insights||[];
 return \`\${resourceError('insights','Finance Insights')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Finance Insights</h2><p>Evidence-backed findings linked to underlying transactions.</p></div><button id="runAnalysis" type="button">Analyse transactions</button></div><div class="fm-list">\${rows.map(x=>\`<div class="fm-row" data-tx="\${x.bank_transaction_id}"><div><h3>\${esc(x.merchant_name||x.description||'Transaction insight')}</h3><p>\${x.suggested_category?'Category suggestion: '+esc(x.suggested_category)+' · ':''}\${x.recurring_frequency?'Recurring '+esc(x.recurring_frequency)+' · ':''}\${x.transfer_candidate_uid?'Transfer candidate · ':''}anomaly \${num(x.anomaly_score)}</p></div><div class="fm-row-right">\${statusBadge(x.status)}<small>\${date(x.transaction_date)}</small></div></div>\`).join('')||emptyState('No insights','Run analysis or import more verified history.')}</div></div></article>\`;
}
function rulesView(){
 const rows=state.rules?.rules||[];
 return \`\${resourceError('rules','Finance Rules')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Merchant & Category Rules</h2><p>Rules produce suggestions; they never silently post, reconcile or alter source evidence.</p></div></div><div class="fm-list">\${rows.map(x=>\`<div class="fm-row"><div><h3>\${esc(x.merchant_pattern)}</h3><p>\${esc(x.category||'No category')} · \${esc(x.ownership_scope||'')} · priority \${num(x.priority)}</p></div>\${statusBadge(x.enabled?'ACTIVE':'DISABLED')}</div>\`).join('')||emptyState('No saved rules','Approved intelligence suggestions can create remembered merchant rules.')}</div></div></article>\`;
}
function reconciliationView(){
 const r=state.reconciliation||{}, rows=r.transactions||[];
 return \`\${resourceError('reconciliation','Reconciliation')}<div class="fm-grid four"><div class="fm-kpi"><span>Needs action</span><strong>\${num(r.summary?.needs_action)}</strong></div><div class="fm-kpi"><span>Ready</span><strong>\${num(r.summary?.ready)}</strong></div><div class="fm-kpi"><span>Partial</span><strong>\${num(r.summary?.partial)}</strong></div><div class="fm-kpi"><span>Reconciled</span><strong>\${num(r.summary?.reconciled)}</strong></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Amount</th><th>Matched</th><th>Remaining</th><th>Workflow</th></tr></thead><tbody>\${rows.slice(0,200).map(x=>\`<tr data-tx="\${x.id}"><td>\${date(x.transaction_date)}</td><td>\${esc(x.account_name)}</td><td>\${esc(x.merchant_name||x.description)}</td><td>\${nativeMoney(Math.abs(num(x.amount)),x.currency)}</td><td>\${nativeMoney(x.matched_amount,x.currency)}</td><td>\${nativeMoney(x.remaining_amount,x.currency)}</td><td>\${statusBadge(x.workflow_status)}</td></tr>\`).join('')}</tbody></table></div></div></article>\`;
}
function teamView(){
 const users=state.team?.users||state.team?.team||[];
 return \`\${resourceError('team','Team Finance Access')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Team Finance Access</h2><p>Access is enforced on the server, not by hiding frontend controls.</p></div></div><div class="fm-list">\${users.map(u=>\`<div class="fm-row"><div><h3>\${esc(u.name||u.email||'User')}</h3><p>\${esc(u.role||'')} · \${esc(u.access_level||u.banking_access||'')}</p></div>\${statusBadge(u.status||'ACTIVE')}</div>\`).join('')||emptyState('No team data','No finance team access records were returned.')}</div></div></article>\`;
}
function connectionsView(){
 const r=state.readiness||{};
 return \`\${resourceError('readiness','Banking Connections')}<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Open Banking readiness</h2><p>\${esc(r.headline||'Readiness unavailable')}</p></div>\${statusBadge(r.overall)}</div><div class="fm-list">\${(r.controls||[]).map(c=>\`<div class="fm-row"><div><h3>\${esc(c.plain_name||c.label)}</h3><p>\${esc(c.detail||c.description||'')}</p></div>\${statusBadge(c.status)}</div>\`).join('')}</div></div></article><article class="fm-card"><div class="fm-pad"><h2>Connection status</h2><p class="fm-helper">\${esc(r.open_banking?.explanation||'Open Banking remains fail-closed until provider and production controls are verified.')}</p><div class="fm-list">\${(r.connections||[]).map(c=>\`<div class="fm-row"><div><h3>\${esc(c.institution||c.provider)}</h3><p>Consent: \${esc(c.consent_status||'')} · last sync \${date(c.last_sync_completed_at)}</p></div>\${statusBadge(c.last_sync_status||c.consent_status)}</div>\`).join('')||emptyState('No live connections','Manual statement import remains the supported fallback.')}</div></div></article></div>\`;
}
function settingsView(){
 const caps=state.capabilities?.capabilities||{};
 return connectionsView()+\`<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Capability Registry</h2><p>Unsupported workflows are explicitly identified rather than presented as dead buttons.</p></div></div><div class="fm-capability-grid">\${Object.entries(caps).map(([k,v])=>\`<div class="fm-capability"><div><b>\${esc(k.replaceAll('_',' '))}</b><p>\${esc(v.note||'')}</p></div>\${statusBadge(v.status)}</div>\`).join('')}</div></div></article>\`;
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
 return \`<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Report Centre</h2><p>Exports remain permission and step-up protected.</p></div></div><div class="fm-quick-grid"><button class="fm-quick" data-export="/api/finance/exports/accountant-review.pdf"><span>PDF</span><b>Accountant Review</b><small>Existing protected company PDF</small></button><button class="fm-quick" data-export="/api/finance/exports/trial-balance.csv"><span>CSV</span><b>Trial Balance</b><small>Existing protected CSV</small></button><button class="fm-quick" data-viewjump="transactions"><span>↕</span><b>Transaction Register</b><small>Use active server-side filters</small></button><button class="fm-quick" data-viewjump="statements"><span>▤</span><b>Statement History</b><small>Source/import evidence</small></button></div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Active report context</h2><p>Scope and period are explicit.</p></div></div><div class="fm-list"><div class="fm-row"><span>Workspace</span><b>\${esc(state.scope)}</b></div><div class="fm-row"><span>Accounts</span><b>\${state.account?esc(state.accounts.find(a=>String(a.id)===String(state.account))?.nickname||state.account):'All permitted'}</b></div><div class="fm-row"><span>Period</span><b>\${esc(r.from||'All')} → \${esc(r.to||'Now')}</b></div><div class="fm-row"><span>Currency treatment</span><b>Native currencies only</b></div></div><p class="fm-helper">Full XLSX/report-builder coverage remains a genuine gap until exports consume the exact same filter contract.</p></div></article></div>\`;
}
function reviewView(){
 const q=state.quality||{};const ins=state.insights?.summary||{};const cards=[['Uncategorised',q.unclassified_transactions??q.unclassified,'transactions'],['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],['Ownership missing',q.ownership_missing,'transactions'],['Unknown history coverage',q.unknown_history_coverage,'accounts'],['Transfer candidates',ins.transfer_candidates,'insights'],['Category suggestions',ins.category_suggestions,'insights'],['Anomalies',ins.anomalies,'insights']];
 return \`\${resourceError('quality','Data Quality')}<div class="fm-grid four">\${cards.map(([l,n,v])=>\`<button class="fm-kpi fm-kpi-button" data-viewjump="\${v}"><span>\${esc(l)}</span><strong>\${num(n)}</strong><small>Open underlying queue</small></button>\`).join('')}</div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Review Centre</h2><p>Quality metrics open the underlying data rather than hiding issues behind a score.</p></div></div><div class="fm-list">\${(state.personalAttention?.alerts||[]).slice(0,12).map(x=>\`<div class="fm-row"><div><h3>\${esc(x.title)}</h3><p>\${esc(x.explanation||'')}</p></div>\${statusBadge(x.severity)}</div>\`).join('')||emptyState('No personal attention alerts','No current owner-only alerts were returned.')}</div></div></article>\`;
}
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