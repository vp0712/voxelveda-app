(() => {
'use strict';
const $=id=>document.getElementById(id);
const API='/api/finance';
const I=API+'/intelligence';
const OS=API+'/banking-os';
const state={
  view:'overview',scope:'ALL',account:'',period:'month',customFrom:'',customTo:'',
  dash:null,tx:[],txMeta:{page:1,limit:50,total:0,total_pages:1,summary:{}},statements:[],removedStatements:[],reviews:[],
  os:null,personal:null,personalAttention:null,readiness:null,accounts:[],capabilities:null,
  insights:null,rules:null,quality:null,reconciliation:null,history:null,setup:null,team:null,
  transferCandidates:null,refundCandidates:null,reimbursements:null,briefing:null,savedViews:null,bankingBudgets:null,notifications:null,notificationPrefs:null,companySettings:null,receiptCenter:null,savedReports:null,reportResult:null,archivedTransactions:null,cashflowCalendar:null,accountingPeriods:null,categories:null,smart:null,health:null,roadmaps:null,userPreferences:null,preferencesApplied:false,companySummary:null,openBankProviders:null,openBankSessions:null,bankConnectionData:null,bankSyncJobs:null,personalBankDash:null,businessBankDash:null,bankingOps:null,fxRates:null,
  resources:{},txFilters:{q:'',type:'',category:'',merchant:'',source:'',reconciliation_status:'',amount_min:'',amount_max:''},
  receiptFilters:{q:'',account_id:'',merchant:'',category:'',from:'',to:'',amount_min:'',receipt_status:'ALL',tax_relevant:false},
  selectedTransactions:new Set()
};
let loadCycle=0;
const FINANCE_REQUEST_TIMEOUT_MS=12000;
const FINANCE_HYDRATION_BATCH_SIZE=5;
const NAV_GROUPS=[
 ['HOME',[['overview','⌂','Overview'],['personal','◉','My Money'],['company','◆','Company Finance'],['consolidated','◎','Consolidated']]],
 ['MONEY',[['accounts','▣','Accounts'],['transactions','↕','Transactions'],['bankops','⌁','Banking Operations'],['cash','¤','Cash'],['currency','FX','Currency Centre'],['transfers','⇆','Transfers'],['refunds','↩','Refunds'],['reimbursements','⌁','Reimbursements'],['debt','⇄','Borrow & Lend'],['recurring','⟳','Recurring']]],
 ['DOCUMENTS',[['history','⇩','History Import'],['statements','▤','Statements'],['receipts','▧','Receipts']]],
 ['PLANNING',[['budgets','◫','Budgets'],['savings','◎','Savings Goals'],['forecast','◷','Forecast'],['calendar','▦','Cash Flow Calendar']]],
 ['INTELLIGENCE',[['insights','✦','Insights'],['rules','⌁','Rules'],['review','!','Review Centre'],['reconciliation','✓','Reconciliation']]],
 ['REPORTING',[['reports','▧','Reports']]],
 ['CONTROL',[['setupcentre','✓','Setup Centre'],['notifications','●','Notifications'],['team','♙','Team Access'],['connections','◌','Banking Connections'],['settings','⚙','Finance Settings']]]
];
const NAV=NAV_GROUPS.flatMap(([,items])=>items);
const MOBILE_NAV=[['overview','⌂','Home'],['accounts','▣','Accounts'],['transactions','↕','Transactions'],['statements','▤','Statements'],['more','☰','More']];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0);
const money=(v,c='AUD')=>{try{return new Intl.NumberFormat(state.userPreferences?.number_format||'en-AU',{style:'currency',currency:c||'AUD'}).format(num(v))}catch{return Number(v||0).toFixed(2)}};
const nativeMoney=(v,c)=>money(v,c||'AUD');
const date=v=>{if(!v)return '—';const d=new Date(String(v).slice(0,10)+'T00:00:00');const fmt=state.userPreferences?.date_format||'DD/MM/YYYY';if(fmt==='YYYY-MM-DD')return String(v).slice(0,10);if(fmt==='MM/DD/YYYY')return new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d);return new Intl.DateTimeFormat('en-AU',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
let financeStepUpPromise=null;
function requestFinanceStepUp(){
 if(financeStepUpPromise)return financeStepUpPromise;
 financeStepUpPromise=new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error)=>{if(settled)return;settled=true;financeStepUpPromise=null;error?reject(error):resolve()};
  $('fmModalEyebrow').textContent='SECURITY VERIFICATION';$('fmModalTitle').textContent='Confirm sensitive Finance action';
  $('fmModalBody').innerHTML=`<form id="financeStepUpForm" class="fm-form"><p class="fm-helper">Enter your Voxel Veda account password and current 6-digit authenticator code. Never enter a bank password, bank PIN or bank OTP here.</p><label>Voxel Veda password<input name="password" type="password" autocomplete="current-password" required></label><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><div id="financeStepUpStatus" class="fm-state" hidden></div><div class="fm-form-actions"><button type="button" data-stepup-cancel="1">Cancel</button><button class="primary" type="submit">Verify & continue</button></div></form>`;
  const modal=$('fmModal'),form=$('financeStepUpForm'),status=$('financeStepUpStatus');modal.showModal();
  document.querySelector('[data-stepup-cancel]')?.addEventListener('click',()=>{modal.close();finish(new Error('Security verification cancelled.'))},{once:true});
  modal.addEventListener('close',()=>{if(!settled)finish(new Error('Security verification cancelled.'))},{once:true});
  form.onsubmit=async e=>{
   e.preventDefault();if(!form.reportValidity())return;
   const fd=new FormData(form),button=form.querySelector('button[type="submit"]');button.disabled=true;
   status.hidden=false;status.className='fm-state';status.textContent='Verifying…';
   try{
    const response=await fetch('/api/auth/step-up',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:fd.get('password'),code:String(fd.get('code')||'').replace(/\s/g,'')})});
    let payload={};try{payload=await response.json()}catch{}
    if(!response.ok)throw new Error(payload.message||'Security verification failed.');
    settled=true;financeStepUpPromise=null;modal.close();resolve(payload);
   }catch(error){status.className='fm-state fm-state-error';status.textContent=error.message;button.disabled=false}
  };
 });
 return financeStepUpPromise;
}
async function api(path,options={}){
 const {timeoutMs=FINANCE_REQUEST_TIMEOUT_MS,headers={},_stepUpRetry=false,...requestOptions}=options;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||FINANCE_REQUEST_TIMEOUT_MS));
 try{
  const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...headers},...requestOptions,signal:controller.signal});
  let body={};try{body=await r.json()}catch{}
  if(!r.ok&&body.code==='STEP_UP_REQUIRED'&&!_stepUpRetry&&path!=='/api/auth/step-up'){
   clearTimeout(timer);
   await requestFinanceStepUp();
   return api(path,{...options,_stepUpRetry:true});
  }
  if(!r.ok){const e=new Error(body.message||'Request failed');e.status=r.status;e.code=body.code;throw e}
  return body;
 }catch(error){
  if(error?.name==='AbortError'){
   const timeoutError=new Error('This Finance service took too long to respond. The rest of the workspace remains available; retry this section.');
   timeoutError.status=408;timeoutError.code='FINANCE_REQUEST_TIMEOUT';throw timeoutError;
  }
  throw error;
 }finally{clearTimeout(timer)}
}
function notice(m,bad=false){const n=$('fmNotice');n.hidden=!m;n.textContent=m||'';n.style.background=bad?'#fde9eb':'#fff8dc';n.style.color=bad?'#8f2732':'#725600'}
function signalFinanceReady(){
 try{window.dispatchEvent(new CustomEvent('finance:ready',{detail:{view:state.view,cycle:loadCycle}}))}catch{}
}
function renderFinanceFatal(error,title='Finance could not start'){
 const message=error?.message||'Finance workspace failed to load';
 notice(message,true);
 const content=$('fmContent');
 if(content)content.innerHTML=`<div class="fm-state fm-state-error"><strong>${esc(title)}</strong><p>The loading request ended safely instead of leaving this screen stuck. Retry the Finance workspace.</p><button type="button" data-retry="1">Retry</button><button type="button" data-hard-reload="1">Reload page</button></div>`;
 bindDynamic();
 document.querySelector('[data-hard-reload]')?.addEventListener('click',()=>location.reload());
 try{window.dispatchEvent(new CustomEvent('finance:fatal',{detail:{message}}))}catch{}
}
function navButtons(){
 $('fmNav').innerHTML=NAV_GROUPS.map(([group,items])=>`<div class="fm-nav-group"><small>${esc(group)}</small>${items.map(([v,i,l])=>`<button type="button" data-view="${v}" class="${state.view===v?'active':''}"><span>${i}</span>${l}</button>`).join('')}</div>`).join('');
 $('fmNav').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
 const mobile=$('fmMobileNav');
 if(mobile){
  mobile.innerHTML=MOBILE_NAV.map(([v,i,l])=>`<button type="button" data-mobile-view="${v}" class="${state.view===v?'active':''}"><span>${i}</span><b>${l}</b></button>`).join('');
  mobile.querySelectorAll('[data-mobile-view]').forEach(b=>b.onclick=()=>go(b.dataset.mobileView));
 }
}
function title(v){return ({
 overview:['Finance Overview','Balances and selected-period cash flow are deliberately separated.'],
 personal:['My Money','Owner-only personal money, debt, goals and recurring obligations.'],
 company:['Company Finance','Voxel Veda business cash position, payables and operational finance.'],
 consolidated:['Consolidated','Permitted Personal and Company accounts shown side-by-side without blurring ownership.'],
 accounts:['Accounts','Bank, savings, credit, cash and loan accounts with coverage and lifecycle controls.'],
 transactions:['Transaction Explorer','Server-filtered financial movements with preserved source evidence.'],
 bankops:['Banking Operations','Money spaces, beneficiaries and controlled payment instructions inside the same Finance OS.'],
 history:['History Import Centre','Load complete historical statements account-by-account without mixing banks or ownership.'],
 statements:['Statement Vault','Upload, review, duplicate-check and commit statements without overwriting source evidence.'],
 receipts:['Receipts','Private receipt vault and missing-receipt review queue over visible Finance transactions.'],
 cash:['Cash','Cash wallets and cash-type financial accounts.'],
 currency:['Currency Centre','Track explicit FX evidence and calculate management conversions without rewriting native transactions.'],
 debt:['Borrow & Lend','Owner-only debt lifecycle with repayments and remaining balances.'],
 recurring:['Recurring Money','Known and detected recurring commitments; nothing is paid automatically.'],
 transfers:['Transfers','Confirm own-account debit/credit pairs without counting them as income or expense.'],
 refunds:['Refunds','Link merchant credits to original expenses so they are not treated as ordinary revenue.'],
 reimbursements:['Reimbursements','Track employee-paid expenses through submission, approval and linked repayment.'],
 budgets:['Budgets','Personal and banking budget controls backed by current finance records.'],
 savings:['Savings Goals','Track goals and contributions without pretending that progress automatically moves cash.'],
 forecast:['Forecast','Evidence-based planning from Personal Money Smart, Financial Health and Roadmap Intelligence.'],
 calendar:['Cash Flow Calendar','Known company/banking and personal planning events shown separately by scope and currency.'],
 insights:['Finance Insights','Evidence-backed finance intelligence linked to underlying transactions.'],
 rules:['Categories & Rules','Merchant categorisation rules create suggestions; they do not silently post changes.'],
 review:['Data Quality Review','Uncategorised, unreconciled, coverage and other review queues.'],
 reconciliation:['Reconciliation','Bank transaction reconciliation inside the master Finance OS.'],
 reports:['Reports','Trusted exports and report-ready filtered transaction data.'],
 team:['Team Finance Access','Server-enforced banking and finance access controls.'],
 setupcentre:['Finance Setup Centre','Complete the real data migration and control checks required for a reliable Finance OS.'],
 notifications:['Finance Notifications','User-specific finance alerts and notification preferences.'],
 connections:['Banking Connections','Open Banking readiness and sync status; fail-closed when not configured.'],
 settings:['Finance Settings','Capability status, safety controls and company finance configuration.'],
 more:['Finance Control Centre','Every Finance module and workflow in one place.']
 })[v]||['Finance','Finance workspace']}

function isoDay(d){return d.toISOString().slice(0,10)}
function localIsoDay(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
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
function scopeDashboardQuery(scope){
 const range=dateRange(),p=new URLSearchParams({scope});
 if(range.from)p.set('from',range.from);if(range.to)p.set('to',range.to);
 return '?'+p.toString();
}
function receiptQuery(){
 const p=new URLSearchParams({scope:state.scope});
 Object.entries(state.receiptFilters).forEach(([key,value])=>{if(value!==''&&value!==false&&value!==null&&value!==undefined)p.set(key,value===true?'true':String(value))});
 return '?'+p.toString();
}
function setResource(name,status,data=null,error=null){state.resources[name]={status,data,error};if(data!==null)state[name]=data}
async function loadResource(name,path,cycle=null){
 if(cycle===null||cycle===loadCycle)setResource(name,'loading');
 try{const data=await api(path);if(cycle===null||cycle===loadCycle)setResource(name,'loaded',data);return data}
 catch(error){if(cycle===null||cycle===loadCycle)setResource(name,error.status===403?'permission':'error',null,error);return null}
}
function resourceData(name){return state.resources[name]?.status==='loaded'?state.resources[name].data:null}
function syncSupplementaryState(){
 const removed=resourceData('removedStatementPayload');if(removed)state.removedStatements=removed.removed_statements||[];
 const reviews=resourceData('reviewPayload');if(reviews)state.reviews=reviews.sessions||[];
}
function canProgressivelyRender(cycle){
 return cycle===loadCycle&&!$('fmModal')?.open&&!$('fmDrawer')?.classList.contains('open');
}
function resourceError(name,label){
 const r=state.resources[name];if(!r||r.status==='loaded')return '';
 const message=r.status==='permission'?'You do not have permission to view this finance component.':(r.error?.message||'This finance component is unavailable.');
 return `<div class="fm-state fm-state-error"><strong>${esc(label)}</strong><p>${esc(message)}</p><button type="button" data-retry="1">Retry</button></div>`;
}
function currencyRows(){
 const balances=Array.isArray(state.dash?.balances_by_currency)?state.dash.balances_by_currency:[];
 const flows=Array.isArray(state.dash?.flow_by_currency)?state.dash.flow_by_currency:[];
 return [...new Set([...balances.map(x=>x.currency),...flows.map(x=>x.currency)].filter(Boolean))].map(currency=>{
  const flow=flows.find(x=>x.currency===currency)||{};
  return {
   currency,
   balance:num(balances.find(x=>x.currency===currency)?.balance),
   money_in:num(flow.money_in),
   ordinary_money_in:num(flow.ordinary_money_in),
   refund_inflow:num(flow.linked_refund_inflow),
   money_out:num(flow.money_out),
   net_flow:num(flow.net_flow),
   net_economic_expense:num(flow.net_economic_expense),
   transfer_movement:num(flow.transfer_movement),
   unclassified:num(flow.unclassified)
  };
 });
}
function mixedCurrencyMessage(rows){return rows.length>1?'Mixed currencies — consolidated total unavailable until verified FX rates are available.':''}
function statusBadge(status){const v=String(status||'UNKNOWN').toUpperCase();const tone=['READY','ACTIVE','RECONCILED','BALANCED','SUCCESS','COMPLETED'].includes(v)?'good':['BLOCKED','ERROR','FAILED','MISMATCH','OVERDUE'].includes(v)?'bad':'warn';return `<span class="fm-badge ${tone}">${esc(v)}</span>`}
function emptyState(title,message,action=''){return `<div class="fm-empty"><strong>${esc(title)}</strong><span>${esc(message)}</span>${action}</div>`}
function dashboardCardVisible(key){
 const configured=state.userPreferences?.dashboard_cards;
 if(!Array.isArray(configured)||!configured.length)return true;
 return key==='attention'||configured.includes(key);
}
async function loadBase(){
  const cycle=++loadCycle;
  const [setup,prefPayload]=await Promise.all([
   loadResource('setup',API+'/setup',cycle),
   loadResource('userPreferences',API+'/preferences',cycle)
  ]);
  state.setup=setup||state.setup;
  state.userPreferences=prefPayload?.preferences||state.userPreferences;
 if(!state.preferencesApplied&&state.userPreferences){
  const pref=state.userPreferences;
  if(['ALL','PERSONAL','BUSINESS'].includes(pref.default_workspace))state.scope=pref.default_workspace;
  if(pref.default_period)state.period=pref.default_period;
  if(pref.default_account_id)state.account=String(pref.default_account_id);
  state.preferencesApplied=true;
  if($('fmScope'))$('fmScope').value=state.scope;
  if($('fmPeriod'))$('fmPeriod').value=state.period;
 }
  if(cycle!==loadCycle)return cycle;
  const base=filterQuery();
  const [capabilities,dash,tx,st]=await Promise.all([
   loadResource('capabilities',API+'/capabilities',cycle),
   loadResource('dash',I+'/banking-dashboard'+base,cycle),
   loadResource('txPayload',I+'/transactions'+filterQuery({page:state.txMeta.page,limit:state.txMeta.limit,...state.txFilters}),cycle),
   loadResource('statementPayload',I+'/statements'+base,cycle)
  ]);
  if(cycle!==loadCycle)return cycle;
  state.capabilities=capabilities||null;state.dash=dash||null;
 if(tx){state.tx=tx.transactions||[];state.txMeta={page:num(tx.page)||1,limit:num(tx.limit)||50,total:num(tx.total),total_pages:num(tx.total_pages)||1,summary:tx.summary||{}}}
 else{state.tx=[]}
  state.statements=st?.statements||[];
  state.accounts=dash?.accounts||[];
  if(dash&&!state.accounts.length){
   const accounts=await loadResource('accountPayload',I+'/accounts?scope='+encodeURIComponent(state.scope),cycle);
  state.accounts=accounts?.accounts||[];
 }
 if(state.account&&!state.accounts.some(a=>String(a.id)===String(state.account)))state.account='';
 const sel=$('fmAccount'),keep=state.account;
  sel.innerHTML='<option value="">All permitted accounts</option>'+state.accounts.map(a=>`<option value="${a.id}">${esc(a.nickname||a.account_name||'Account')} · ${esc(a.currency||'AUD')}</option>`).join('');
  sel.value=keep;
  return cycle;
}
async function hydrateSupplementary(cycle){
 const base=filterQuery();
 const resources=[
  ['personal',API+'/personal-money'],['personalAttention',API+'/personal-money/attention'],['companySummary',API+'/company-summary'],['insights',I+'/insights'+filterQuery()],['quality',I+'/data-quality'+base],
  ['removedStatementPayload',I+'/statements-removed'],['reviewPayload',I+'/statement-reviews'],['briefing',API+'/personal-money/daily-briefing?date='+encodeURIComponent(localIsoDay())],['savedViews',API+'/personal-money/saved-views'],['bankingBudgets',I+'/budgets'],
  ['readiness',I+'/banking-readiness'],['rules',I+'/rules'],['reconciliation',I+'/reconciliation'+filterQuery()],['history',I+'/history-coverage'+base],['team',OS+'/team'],
  ['os',OS+'/command-center'],['bankingOps',API+'/banking-os'],['transferCandidates',API+'/relationship-candidates/transfers'],['refundCandidates',API+'/relationship-candidates/refunds'],['reimbursements',API+'/reimbursements'],['notifications','/api/notifications?limit=50'],
  ['notificationPrefs','/api/notifications/preferences'],['companySettings','/api/settings'],['receiptCenter',API+'/receipts'+receiptQuery()],['savedReports',API+'/reports/saved'],['archivedTransactions',API+'/bank-transactions-archived?scope='+encodeURIComponent(state.scope)],
  ['cashflowCalendar',OS+'/cashflow-calendar?days=90'],['accountingPeriods',API+'/accounting-periods'],['categories',API+'/categories?include_archived=true'],['smart',API+'/personal-money/smart'],['health',API+'/personal-money/health'],
  ['roadmaps',API+'/personal-money/roadmaps'],['fxRates',API+'/fx-rates'],['personalBankDash',I+'/banking-dashboard'+scopeDashboardQuery('PERSONAL')],['businessBankDash',I+'/banking-dashboard'+scopeDashboardQuery('BUSINESS')],['openBankProviders',I+'/open-banking/providers'],['openBankSessions',I+'/open-banking/sessions'],['bankConnectionData','/api/integrations/webhooks/banking/connections'],['bankSyncJobs','/api/integrations/webhooks/banking/sync-jobs']
 ];
 for(let index=0;index<resources.length;index+=FINANCE_HYDRATION_BATCH_SIZE){
  if(cycle!==loadCycle)return;
  await Promise.all(resources.slice(index,index+FINANCE_HYDRATION_BATCH_SIZE).map(([name,path])=>loadResource(name,path,cycle)));
  syncSupplementaryState();
  if(canProgressivelyRender(cycle))render();
 }
}
function hero(){
 const err=resourceError('dash','Financial overview');if(err)return err;
 const rows=currencyRows();const mixed=mixedCurrencyMessage(rows);const one=rows[0]||{currency:'AUD',balance:0,money_in:0,money_out:0,net_flow:0};
 const position=rows.length===1?nativeMoney(one.balance,one.currency):'Mixed currencies';
 const kpis=rows.length?rows.map(r=>`<div class="fm-kpi"><span>${esc(r.currency)} · Available balance</span><strong>${nativeMoney(r.balance,r.currency)}</strong><small>Current balance — not period filtered</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Money in</span><strong class="good">${nativeMoney(r.money_in,r.currency)}</strong><small>Cash inflow · includes ${nativeMoney(r.refund_inflow,r.currency)} linked refunds</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Money out</span><strong class="bad">${nativeMoney(r.money_out,r.currency)}</strong><small>Cash outflow · confirmed transfers excluded</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Net cash flow</span><strong>${nativeMoney(r.net_flow,r.currency)}</strong><small>Cash in minus cash out</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Linked refunds</span><strong class="good">${nativeMoney(r.refund_inflow,r.currency)}</strong><small>Not treated as ordinary revenue</small></div><div class="fm-kpi"><span>${esc(r.currency)} · Net economic expense</span><strong>${nativeMoney(r.net_economic_expense,r.currency)}</strong><small>Money out less linked refunds</small></div>`).join(''):'<div class="fm-empty">No visible financial activity.</div>';
 return `<div class="fm-grid two"><article class="fm-card fm-hero"><div class="fm-pad"><small>TOTAL FINANCIAL POSITION</small><strong>${position}</strong><p>${mixed||'Current account position. Period activity is shown separately from balances.'}</p><div class="fm-hero-actions"><button class="accent" data-quick="expense">Add movement</button><button data-quick="statement">Upload statement</button><button data-viewjump="reports">Reports</button></div></div></article><div class="fm-grid two">${kpis}</div></div>`;
}
function recentRows(){
 const rows=state.dash?.recent_transactions||state.tx.slice(0,8);
 return rows.length?rows.slice(0,8).map(r=>{const amount=num(r.credit||0)-num(r.debit||0);return `<div class="fm-row" data-tx="${r.id}"><div><h3>${esc(r.merchant_name||r.description||'Transaction')}</h3><p>${date(r.transaction_date)} · ${esc(r.account_name||'Account')} · ${esc(r.category||'Uncategorised')}</p></div><div class="fm-row-right"><b class="${amount<0?'bad':'good'}">${nativeMoney(Math.abs(amount),r.currency||'AUD')}</b><small>${Number(r.is_internal_transfer)?'Internal transfer':esc(r.reconciliation_status||'')}</small></div></div>`}).join(''):emptyState('No transactions','Import a statement or add a manual financial movement.');
}
function financeCommandCentre(){
 const q=state.quality||{},ins=state.insights?.summary||{};
 const quick=[
  ['expense','＋','Add expense','Manual movement'],
  ['income','↗','Add income','Manual movement'],
  ['statement','⇩','Import statement','CSV · PDF · OFX · QFX · QIF · XLSX'],
  ['account','▣','Add account','Bank · cash · card · loan']
 ];
 const workflowButtons=quick.map(([kind,icon,label,note])=>`<button class="fm-command-action" data-quick="${kind}"><span>${icon}</span><b>${label}</b><small>${note}</small></button>`).join('');
 const health=[
  ['Uncategorised',q.unclassified_transactions??q.unclassified,'review'],
  ['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],
  ['Transfer candidates',ins.transfer_candidates,'transfers'],
  ['Missing receipts',state.receiptCenter?.counts?.missing,'receipts']
 ];
 const healthButtons=health.map(([label,value,view])=>`<button class="fm-health-chip" data-viewjump="${view}"><span>${esc(label)}</span><b>${num(value)}</b></button>`).join('');
 return `<section class="fm-command-centre"><div class="fm-command-head"><div><p>FINANCE COMMAND CENTRE</p><h2>Run the whole money system from one workspace</h2><span>Company, Personal and Consolidated views share one canonical transaction ledger while ownership stays separate.</span></div><div class="fm-inline-actions"><button data-viewjump="setupcentre">Setup</button><button data-viewjump="more">All modules</button></div></div><div class="fm-command-actions">${workflowButtons}</div><div class="fm-health-strip">${healthButtons}</div></section>`;
}
function overview(){
 const err=resourceError('dash','Finance dashboard');if(err)return err;
 const accountRows=state.accounts.slice(0,6).map(a=>`<div class="fm-row" data-account="${a.id}"><div><h3>${esc(a.nickname||a.account_name||'Account')}</h3><p>${esc(a.institution||'Financial account')} · ${esc(a.ownership_scope||'')}</p></div><div class="fm-row-right"><b>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</b><small>${esc(a.currency||'AUD')}</small></div></div>`).join('');
 const monthly=Array.isArray(state.dash?.monthly)?state.dash.monthly:[];const max=Math.max(1,...monthly.flatMap(x=>[num(x.money_in),num(x.money_out)]));
 const chart=monthly.length?monthly.slice(-12).map(x=>`<div class="fm-chart-row"><span>${esc(x.month)} · ${esc(x.currency)}</span><div class="fm-bars"><i class="in" style="width:${Math.max(2,num(x.money_in)/max*100)}%" title="Money in ${nativeMoney(x.money_in,x.currency)}"></i><i class="out" style="width:${Math.max(2,num(x.money_out)/max*100)}%" title="Money out ${nativeMoney(x.money_out,x.currency)}"></i></div><b>${nativeMoney(num(x.money_in)-num(x.money_out),x.currency)}</b></div>`).join(''):emptyState('No cash-flow trend','No transactions exist in the selected period.');
 const cats=Array.isArray(state.dash?.categories)?state.dash.categories:[];const catList=cats.slice(0,8).map(x=>`<button class="fm-distribution" data-category="${esc(x.category)}"><span>${esc(x.category)} · ${esc(x.currency)}</span><b>${nativeMoney(x.spent,x.currency)}</b></button>`).join('')||emptyState('No expense distribution','No expenses exist in the selected period.');
 const q=state.quality||{};const ins=state.insights?.summary||{};const attention=[['Uncategorised',q.unclassified_transactions??q.unclassified,'transactions'],['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],['Ownership missing',q.ownership_missing,'review'],['History coverage unknown',q.unknown_history_coverage,'accounts'],['Transfer candidates',ins.transfer_candidates,'insights'],['Anomalies',ins.anomalies,'insights']].filter(x=>num(x[1])>0);
 const attentionHtml=attention.length?attention.map(([l,n,v])=>`<button class="fm-attention" data-viewjump="${v}"><b>${num(n)}</b><span>${esc(l)}</span></button>`).join(''):emptyState('No current attention items','No review counts were returned for the selected scope.');
 const cashflowCard=dashboardCardVisible('cashflow')?'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Cash Flow Trend</h2><p>Real money in/out grouped by month and native currency.</p></div></div><div class="fm-chart" role="img" aria-label="Cash flow trend">'+chart+'</div></div></article>':'';
 const expenseCard=dashboardCardVisible('expenses')?'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Expense Distribution</h2><p>Click a category to drill into matching transactions.</p></div></div><div class="fm-distributions">'+catList+'</div></div></article>':'';
 const accountCard=dashboardCardVisible('accounts')?'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Accounts</h2><p>Balances are current positions and never period-filtered.</p></div><button data-viewjump="accounts">Manage</button></div><div class="fm-list">'+(accountRows||emptyState('No accounts','Add an account or import a statement.'))+'</div></div></article>':'';
 const recentCard=dashboardCardVisible('recent')?'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Recent transactions</h2><p>Drill into current classification and immutable source evidence.</p></div><button data-viewjump="transactions">View all</button></div><div class="fm-list">'+recentRows()+'</div></div></article>':'';
 const attentionCard='<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Needs your attention</h2><p>Direct queues, not decorative alerts.</p></div></div><div class="fm-attention-grid">'+attentionHtml+'</div></div></article>';
 return financeCommandCentre()+hero()+managementConversionCard()+((cashflowCard||expenseCard)?'<div class="fm-grid two">'+cashflowCard+expenseCard+'</div>':'')+'<div class="fm-grid two">'+attentionCard+accountCard+'</div>'+recentCard;
}
function accounts(){
 const err=resourceError('dash','Accounts');if(err&&!state.accounts.length)return err;
 const coverage=Array.isArray(state.history?.accounts)?state.history.accounts:[];
 return `<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Financial accounts</h2><p>Open an account for overview, transactions, analytics, reconciliation and lifecycle controls.</p></div><button data-quick="account">+ Add account</button></div><div class="fm-account-grid">${state.accounts.map(a=>{const c=coverage.find(x=>String(x.id||x.bank_account_id)===String(a.id))||{};return `<button class="fm-account-card" data-account="${a.id}"><span class="fm-account-type">${esc(a.account_type||'Account')}</span><h3>${esc(a.nickname||'Account')}</h3><p>${esc(a.institution||'Manual')} · ${esc(a.account_number_masked||'number masked')}</p><strong>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</strong><small>${esc(a.ownership_scope||'')} · ${esc(a.connection_status||'MANUAL')}</small><div class="fm-coverage"><span>Coverage</span><b>${date(c.transaction_start||a.history_start_date)} → ${date(c.transaction_end||a.history_end_date)}</b></div></button>`}).join('')||emptyState('No accounts','Create a financial account to begin.')}</div></div></article>`;
}
function transactions(){
 const meta=state.txMeta||{},f=state.txFilters,saved=state.savedViews?.saved_views||[];
 const savedBar=saved.length?'<div class="fm-saved-views"><span>Saved views</span>'+saved.map(v=>'<button data-saved-query="'+esc(v.query_text)+'">'+esc(v.name)+'</button>').join('')+'</div>':'';
 const selectedCount=state.selectedTransactions.size;
 const bulkBar='<div class="fm-bulk-bar"><label class="fm-check"><input id="txSelectAll" type="checkbox" '+(state.tx.length&&selectedCount===state.tx.length?'checked':'')+'> Select this page</label><span id="txSelectedCount">'+selectedCount+' selected</span><button id="txBulkReview" class="fm-primary" type="button" '+(selectedCount?'':'disabled')+'>Bulk review</button><small>Maximum 200 per confirmed batch</small></div>';
 const rows=(state.tx||[]).map(r=>'<tr data-tx="'+r.id+'"><td class="fm-select-cell"><input type="checkbox" data-tx-select="'+r.id+'" aria-label="Select transaction '+r.id+'" '+(state.selectedTransactions.has(Number(r.id))?'checked':'')+'></td><td>'+date(r.transaction_date)+'</td><td>'+esc(r.account_name||'')+'</td><td>'+esc(r.institution||'')+'</td><td><b>'+esc(r.merchant_normalized||r.merchant_name||'')+'</b><small>'+esc(r.description||'')+'</small></td><td>'+esc(r.category||'Uncategorised')+'</td><td>'+(Number(r.is_internal_transfer)?'Transfer':num(r.debit)>0?'Expense':'Income')+'</td><td>'+esc(r.ownership_scope||'')+'</td><td>'+esc(r.currency||'')+'</td><td>'+(num(r.debit)?nativeMoney(r.debit,r.currency):'')+'</td><td>'+(num(r.credit)?nativeMoney(r.credit,r.currency):'')+'</td><td>'+esc(r.project_ref||r.source_type||'')+'</td><td>'+statusBadge(r.reviewed_at?'REVIEWED':r.reconciliation_status)+'</td></tr>').join('');
 return ('<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Transaction Explorer</h2><p>'+num(meta.total)+' matching records · server-side filters and pagination.</p></div><div class="fm-hero-actions"><button id="saveCurrentView">Save view</button><button data-quick="expense">+ Financial movement</button></div></div>'+savedBar+'<div class="fm-filter-grid"><input id="txSearch" value="'+esc(f.q)+'" placeholder="Search description, merchant, reference, account"><select id="txType"><option value="">All types</option><option value="EXPENSE" '+(f.type==='EXPENSE'?'selected':'')+'>Expense</option><option value="INCOME" '+(f.type==='INCOME'?'selected':'')+'>Income</option><option value="TRANSFER" '+(f.type==='TRANSFER'?'selected':'')+'>Transfer</option></select><input id="txCategory" value="'+esc(f.category)+'" placeholder="Category"><input id="txMerchant" value="'+esc(f.merchant)+'" placeholder="Merchant"><select id="txSource"><option value="">All sources</option><option value="STATEMENT_IMPORT" '+(f.source==='STATEMENT_IMPORT'?'selected':'')+'>Statement import</option><option value="MANUAL" '+(f.source==='MANUAL'?'selected':'')+'>Manual</option><option value="OPEN_BANKING" '+(f.source==='OPEN_BANKING'?'selected':'')+'>Open Banking</option></select><select id="txRecon"><option value="">All reconciliation</option><option value="UNRECONCILED" '+(f.reconciliation_status==='UNRECONCILED'?'selected':'')+'>Unreconciled</option><option value="RECONCILED" '+(f.reconciliation_status==='RECONCILED'?'selected':'')+'>Reconciled</option></select><input id="txMin" value="'+esc(f.amount_min)+'" inputmode="decimal" placeholder="Min amount"><input id="txMax" value="'+esc(f.amount_max)+'" inputmode="decimal" placeholder="Max amount"><button id="txApply" class="fm-primary" type="button">Apply filters</button></div>'+resourceError('txPayload','Transaction ledger')+bulkBar+'<div class="fm-table-wrap"><table class="fm-table"><thead><tr><th><span class="sr-only">Select</span></th><th>Date</th><th>Account</th><th>Bank</th><th>Merchant / Description</th><th>Category</th><th>Type</th><th>Scope</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Source / Project</th><th>Status</th></tr></thead><tbody>'+(rows||'<tr><td colspan="13">'+emptyState('No matching transactions','Change filters or import financial history.')+'</td></tr>')+'</tbody></table></div><div class="fm-pagination"><button id="txPrev" '+(meta.page<=1?'disabled':'')+'>Previous</button><span>Page '+(num(meta.page)||1)+' of '+(num(meta.total_pages)||1)+'</span><button id="txNext" '+(meta.page>=meta.total_pages?'disabled':'')+'>Next</button></div></div></article>')+savedViewsCard();
}
function historyImportView(){
 const coverage=Array.isArray(state.history?.accounts)?state.history.accounts:[];
 const pending=state.reviews.filter(x=>x.status==='PENDING_REVIEW');
 const accountCards=state.accounts.map(a=>{
  const c=coverage.find(x=>String(x.id||x.bank_account_id)===String(a.id))||{};
  const start=c.transaction_start||a.history_start_date,end=c.transaction_end||a.history_end_date;
  const count=num(c.transaction_count||a.transaction_count);
  return `<article class="fm-history-account"><div><span class="fm-account-type">${esc(a.ownership_scope||'ACCOUNT')}</span><h3>${esc(a.nickname||'Account')}</h3><p>${esc(a.institution||'Manual account')} · ${esc(a.currency||'AUD')}</p></div><div class="fm-history-meta"><span>History coverage<b>${start?date(start):'Not loaded'} → ${end?date(end):'—'}</b></span><span>Transactions<b>${count}</b></span></div><div class="fm-history-actions"><button data-account="${a.id}">Open account</button><button class="primary" data-history-import="${a.id}">Import files</button></div></article>`;
 }).join('');
 const pendingRows=pending.map(x=>`<button class="fm-row fm-row-button" data-import-review="${esc(x.import_uid)}"><div><h3>${esc(x.original_name||'Statement review')}</h3><p>${esc(x.account_name||'')} · ${num(x.total_rows)} rows · ${num(x.duplicate_rows)} duplicate(s)</p></div><div class="fm-row-right">${statusBadge(x.status)}<small>${num(x.valid_rows)} valid · ${num(x.rejected_rows)} rejected</small></div></button>`).join('');
 return `<div class="fm-control-intro"><p>HISTORICAL FINANCE SETUP</p><h2>Bring every bank account into one controlled ledger</h2><span>Create each account once, upload all of that account's statements, review duplicates/rejections, then commit. Personal and Company ownership remain separate while Consolidated reporting can show permitted accounts together.</span><div class="fm-control-quick"><button data-quick="account">+ Add account</button><button data-viewjump="statements">Statement vault</button><button data-viewjump="review">Review centre</button><button data-viewjump="reports">Reports</button></div></div><section class="fm-history-grid">${accountCards||emptyState('No financial accounts','Create the first bank, card, cash or loan account before importing history.')}</section><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Pending statement reviews</h2><p>No imported row enters the canonical ledger until you review and commit it.</p></div><span class="fm-badge">${pending.length}</span></div><div class="fm-list">${pendingRows||emptyState('No pending reviews','Imported statement previews waiting for review will appear here.')}</div></div></article>`;
}
async function openHistoricalImport(accountId=''){
 const selected=state.accounts.find(a=>String(a.id)===String(accountId));
 $('fmModalEyebrow').textContent='HISTORICAL IMPORT';$('fmModalTitle').textContent='Import statement history';
 $('fmModalBody').innerHTML=`<form id="historicalImportForm" class="fm-form"><label>Account<select name="account_id" required><option value="">Choose account</option>${state.accounts.map(a=>`<option value="${a.id}" ${String(a.id)===String(accountId)?'selected':''}>${esc(a.nickname||'Account')} · ${esc(a.institution||'')} · ${esc(a.currency||'AUD')}</option>`).join('')}</select></label><label>Statement files<input name="files" type="file" accept=".csv,.pdf,.ofx,.qfx,.qif,.xlsx" multiple required></label><p class="fm-helper">Select multiple statement files for the same account. Each file is parsed, SHA-256 hashed, duplicate-checked and staged independently. Nothing is committed automatically.</p><div id="historyImportQueue" class="fm-import-queue"></div><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit">Stage all files for review</button></div></form>`;
 $('fmModal').showModal();
 document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=> $('fmModal').close());
 $('historicalImportForm').onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget,fd=new FormData(form),selectedId=String(fd.get('account_id')||''),account=state.accounts.find(a=>String(a.id)===selectedId);
  const files=[...form.elements.files.files],queue=$('historyImportQueue');
  if(!account||!files.length){notice('Choose one account and at least one statement file.',true);return}
  const rows=[];queue.innerHTML='';
  form.querySelector('button[type="submit"]').disabled=true;
  for(const file of files){
   const item=document.createElement('div');item.className='fm-import-item';item.innerHTML=`<div><b>${esc(file.name)}</b><small>Waiting</small></div><span class="fm-badge">QUEUED</span>`;queue.appendChild(item);
   try{
    item.querySelector('small').textContent='Reading and validating…';item.querySelector('.fm-badge').textContent='PARSING';
    const parsed=await parseStatement(file);
    parsed.rows=(parsed.rows||[]).map(row=>({...row,currency:String(row.currency||account.currency||'AUD').toUpperCase()}));
    item.querySelector('small').textContent=`${parsed.rows.length} rows · checking duplicates…`;
    const result=await api(I+`/accounts/${selectedId}/statements/preview`,{method:'POST',body:JSON.stringify({source_format:parsed.format,original_name:file.name,content_hash:await sha256(file),rows:parsed.rows})});
    rows.push({file:file.name,uid:result.import_uid});
    item.classList.add('good');item.querySelector('.fm-badge').className='fm-badge good';item.querySelector('.fm-badge').textContent='STAGED';
    item.querySelector('small').innerHTML=`${parsed.rows.length} rows · <button type="button" data-import-review="${esc(result.import_uid)}">Open review</button>`;
    item.querySelector('[data-import-review]').onclick=()=>{$('fmModal').close();openStatementReview(result.import_uid)};
   }catch(error){
    item.classList.add('bad');item.querySelector('.fm-badge').className='fm-badge bad';item.querySelector('.fm-badge').textContent='FAILED';
    item.querySelector('small').textContent=error.message;
   }
  }
  form.querySelector('button[type="submit"]').disabled=false;
  if(rows.length){
   notice(rows.length+' statement file(s) staged for review. Nothing has been committed yet.');
   await refresh();
   state.view='history';history.replaceState(null,'','#history');render();
  }
 };
}
function statements(){
 const pending=state.reviews.filter(x=>x.status==='PENDING_REVIEW');
 return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement Import Wizard</h2><p>Choose account → upload → extract → review → duplicate validation → commit.</p></div><button data-quick="statement">Start import</button></div><div class="fm-list">${pending.slice(0,8).map(x=>`<div class="fm-row" data-review="${esc(x.import_uid)}"><div><h3>${esc(x.original_name||'Statement review')}</h3><p>${esc(x.account_name||'')} · ${esc(x.source_format||'')} · ${num(x.total_rows)} rows</p></div><div class="fm-row-right">${statusBadge(x.status)}<small>${num(x.duplicate_rows)} duplicates · ${num(x.rejected_rows)} rejected</small></div></div>`).join('')||emptyState('No pending reviews','New statement uploads will appear here before they affect the ledger.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Supported formats</h2><p>Only formats handled by the current parser are shown.</p></div></div><div class="fm-format-grid"><span>CSV</span><span>PDF</span><span>OFX</span><span>QFX</span><span>QIF</span><span>XLSX</span></div><p class="fm-helper">Every extracted row is staged through the protected server review engine before commit.</p></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Statement Vault</h2><p>Committed history with coverage and import quality.</p></div></div>${resourceError('statementPayload','Statement Vault')}<div class="fm-list">${state.statements.map(x=>`<div class="fm-row"><div><h3>${esc(x.original_name||'Statement')}</h3><p>${esc(x.account_name||'')} · ${date(x.statement_start_date)} – ${date(x.statement_end_date)} · ${esc(x.source_format||'')}</p></div><div class="fm-row-right"><b>${num(x.imported_rows)} imported</b><small>${num(x.duplicate_rows)} duplicates · ${num(x.rejected_rows)} rejected</small><button type="button" data-statement-remove="${esc(x.import_uid)}">Remove</button></div></div>`).join('')||emptyState('No committed statements','Use the import wizard to build verified account history.')}</div></div></article>${removedStatementsSection()}`;
}
function removedStatementsSection(){
 const rows=(state.removedStatements||[]).map(x=>'<div class="fm-row"><div><h3>'+esc(x.original_name||'Removed statement')+'</h3><p>'+esc(x.account_name||'')+' · '+date(x.statement_start_date)+' – '+date(x.statement_end_date)+' · '+esc(x.source_format||'')+'</p></div><div class="fm-row-right">'+statusBadge('REMOVED')+'<small>Excluded from active reports and analysis</small><div class="fm-inline-actions"><button type="button" data-statement-restore="'+esc(x.import_uid)+'">Restore</button><button type="button" class="bad" data-statement-purge="'+esc(x.import_uid)+'">Danger Zone purge</button></div></div></div>').join('')||emptyState('No removed statements','Soft-removed statements will appear here for controlled recovery.');
 return '<details class="fm-card fm-removed-statements"><summary class="fm-pad"><strong>Removed Statements</strong><span>'+(state.removedStatements||[]).length+' recoverable</span></summary><div class="fm-pad"><p class="fm-helper">Restore returns the statement to active history. Permanent deletion is hidden in this controlled recovery area, requires step-up authentication, and cannot be undone.</p><div class="fm-list">'+rows+'</div></div></details>';
}
function personalCard(kind){
 const p=state.personal||{};const a=state.personalAttention||{};
 const data=kind==='budgets'?(p.budgets||[]):kind==='savings'?(a.goals||[]):kind==='debt'?(p.debts||[]):[...(a.recurring||[]),...(a.archived_recurring||[])];
 const label=kind==='budgets'?'Personal Budgets':kind==='savings'?'Savings Goals':kind==='debt'?'Borrow & Lend':'Recurring Money';
 const rows=data.map(x=>{
  const amount=kind==='budgets'?x.limit_amount:kind==='savings'?x.target_amount:kind==='debt'?x.outstanding_amount:x.amount;
  let actions='';
  if(kind==='budgets')actions='<button type="button" data-personal-budget-delete="'+esc(x.id)+'">Remove</button>';
  else if(kind==='savings'){
   if(x.status==='ACTIVE')actions='<button type="button" data-goal-contribute="'+esc(x.id)+'">Add progress</button><button type="button" data-goal-status="PAUSED" data-goal-id="'+esc(x.id)+'">Pause</button>';
   else if(x.status==='PAUSED')actions='<button type="button" data-goal-status="ACTIVE" data-goal-id="'+esc(x.id)+'">Resume</button>';
  }else if(kind==='debt')actions='<button type="button" data-debt-view="'+esc(x.id)+'">View</button>'+(x.status!=='SETTLED'?'<button type="button" data-debt-pay="'+esc(x.id)+'">Record payment</button>':'');
  else if(kind==='recurring')actions=Number(x.active)?'<button type="button" data-recurring-complete="'+esc(x.id)+'">Mark completed</button><button type="button" data-recurring-active="0" data-recurring-id="'+esc(x.id)+'">Archive</button>':'<button type="button" data-recurring-active="1" data-recurring-id="'+esc(x.id)+'">Restore</button>';
  const status=kind==='recurring'?(Number(x.active)?x.frequency:'ARCHIVED'):(x.status||x.frequency||'');
  return '<div class="fm-row"><div><h3>'+esc(x.name||x.category||x.counterparty||'Item')+'</h3><p>'+esc(status)+' '+(x.due_date?'· '+date(x.due_date):x.next_due_date?'· next '+date(x.next_due_date):'')+'</p></div><div class="fm-row-right"><b>'+nativeMoney(amount||0,x.currency||'AUD')+'</b><small>'+(kind==='budgets'?(num(x.used_percent)+'% used'):kind==='savings'?(nativeMoney(x.current_amount||0,x.currency)+' saved'):kind==='debt'?'remaining':'')+'</small><div class="fm-inline-actions">'+actions+'</div></div></div>';
 }).join('');
 return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>'+label+'</h2><p>Owner-only Personal Money records. They are not silently added to company/bank totals.</p></div><button data-personal-new="'+kind+'">+ Add</button></div><div class="fm-list">'+(rows||emptyState('No records yet','Use Add to create the first record.'))+'</div></div></article>';
}
function dashboardCurrencyRows(dash){
 const balances=Array.isArray(dash?.balances_by_currency)?dash.balances_by_currency:[];
 const flows=Array.isArray(dash?.flow_by_currency)?dash.flow_by_currency:[];
 return [...new Set([...balances.map(x=>x.currency),...flows.map(x=>x.currency)].filter(Boolean))].map(currency=>{
  const flow=flows.find(x=>x.currency===currency)||{};
  return {currency,balance:num(balances.find(x=>x.currency===currency)?.balance),money_in:num(flow.money_in),money_out:num(flow.money_out),net_flow:num(flow.net_flow),refund_inflow:num(flow.linked_refund_inflow),net_economic_expense:num(flow.net_economic_expense)};
 });
}
function scopedBankWorkspace(label,scope,dash,resourceName){
 const err=resourceError(resourceName,label+' bank accounts');
 const rows=dashboardCurrencyRows(dash),accounts=dash?.accounts||[],recent=dash?.recent_transactions||[];
 const totals=rows.map(r=>`<div class="fm-kpi"><span>${esc(r.currency)} · balance</span><strong>${nativeMoney(r.balance,r.currency)}</strong><small>Current account position</small></div><div class="fm-kpi"><span>${esc(r.currency)} · period in</span><strong class="good">${nativeMoney(r.money_in,r.currency)}</strong><small>Refunds ${nativeMoney(r.refund_inflow,r.currency)}</small></div><div class="fm-kpi"><span>${esc(r.currency)} · period out</span><strong class="bad">${nativeMoney(r.money_out,r.currency)}</strong><small>Net economic expense ${nativeMoney(r.net_economic_expense,r.currency)}</small></div><div class="fm-kpi"><span>${esc(r.currency)} · net cash flow</span><strong class="${r.net_flow<0?'bad':'good'}">${nativeMoney(r.net_flow,r.currency)}</strong><small>Selected period</small></div>`).join('');
 const accountRows=accounts.map(a=>`<button class="fm-row fm-row-button" data-account="${a.id}"><div><h3>${esc(a.nickname||'Account')}</h3><p>${esc(a.institution||'Financial account')} · ${esc(a.account_type||'')} · ${esc(a.currency||'AUD')}</p></div><div class="fm-row-right"><b>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</b><small>${esc(a.connection_status||a.connection_type||'MANUAL')}</small></div></button>`).join('');
 const recentRows=recent.slice(0,8).map(t=>`<button class="fm-row fm-row-button" data-tx="${t.id}"><div><h3>${esc(t.merchant_name||t.description||'Transaction')}</h3><p>${date(t.transaction_date)} · ${esc(t.account_name||'Account')} · ${esc(t.category||'Uncategorised')}</p></div><div class="fm-row-right"><b class="${num(t.debit)>0?'bad':'good'}">${nativeMoney(Math.max(num(t.debit),num(t.credit)),t.currency||'AUD')}</b><small>${num(t.debit)>0?'Expense':'Income'}</small></div></button>`).join('');
 return `${err}<section class="fm-scope-workspace"><div class="fm-card-head"><div><small>${esc(scope)} BANK LEDGER</small><h2>${esc(label)}</h2><p>Real bank/card/cash accounts and imported transaction history. This is separate from planning wallets and does not mix ownership.</p></div><div class="fm-inline-actions"><button data-scope-view="${scope}" data-scope-target="transactions">Transactions</button><button data-scope-view="${scope}" data-scope-target="history">Import history</button><button data-scope-view="${scope}" data-scope-target="reports">Reports</button></div></div><div class="fm-grid four">${totals||'<div class="fm-kpi"><span>Bank ledger</span><strong>—</strong><small>No visible account activity</small></div>'}</div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Accounts</h3><p>${accounts.length} permitted ${scope.toLowerCase()} account(s)</p></div></div><div class="fm-list">${accountRows||emptyState('No '+label.toLowerCase()+' accounts','Create an account, then import its complete statement history.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Recent bank activity</h3><p>Current classification over preserved bank source evidence.</p></div></div><div class="fm-list">${recentRows||emptyState('No bank activity','Import statements or add a manual financial movement.')}</div></div></article></div></section>`;
}
function personalView(){
 const p=state.personal||{},totals=p.wallet_totals||{},debts=p.debt_totals_by_currency||{};
 const cards=Object.entries(totals).map(([c,v])=>'<div class="fm-kpi"><span>'+esc(c)+' wallets</span><strong>'+nativeMoney(v,c)+'</strong><small>Owner-only Personal Money planning/cash</small></div>').join('');
 const debtCards=Object.entries(debts).map(([c,v])=>'<div class="fm-kpi"><span>'+esc(c)+' owed to me</span><strong>'+nativeMoney(v.lent_open,c)+'</strong><small>Open lending</small></div><div class="fm-kpi"><span>'+esc(c)+' I owe</span><strong>'+nativeMoney(v.borrowed_open,c)+'</strong><small>Open borrowing</small></div>').join('');
 const bank=scopedBankWorkspace('Personal Banking','PERSONAL',state.personalBankDash,'personalBankDash');
 return bank+resourceError('personal','My Money')+'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Personal planning & cash</h2><p>Wallets, cash, budgets, debts and goals are owner-only planning records. They remain distinct from imported bank history.</p></div><div class="fm-inline-actions"><button data-personal-new="wallet">+ Wallet</button><button data-personal-new="cash">+ Cash movement</button><button data-personal-new="debt">Borrow / lend</button><button data-personal-new="savings">Savings goal</button></div></div><div class="fm-grid four">'+(cards+debtCards||'<div class="fm-kpi"><span>Personal Money</span><strong>—</strong><small>No owner-only planning wallets yet</small></div>')+'</div></div></article>'+dailyBriefingCard()+'<div class="fm-grid two">'+personalCard('budgets')+personalCard('debt')+'</div>';
}
function dailyBriefingCard(){
 const b=state.briefing||{},rows=Object.values(b.by_currency||{});
 return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Daily Finance Briefing</h2><p>'+esc(b.comparison_date_note||'Owner-only daily Personal Money snapshot.')+'</p></div></div><div class="fm-grid four">'+(rows.map(r=>'<div class="fm-kpi"><span>'+esc(r.currency)+' today out</span><strong>'+nativeMoney(r.today_spending,r.currency)+'</strong><small>Yesterday '+nativeMoney(r.yesterday_spending,r.currency)+'</small></div><div class="fm-kpi"><span>'+esc(r.currency)+' today in</span><strong>'+nativeMoney(r.today_income,r.currency)+'</strong><small>Yesterday '+nativeMoney(r.yesterday_income,r.currency)+'</small></div>').join('')||'<div class="fm-kpi"><span>Daily briefing</span><strong>—</strong><small>No personal bank activity for today/yesterday.</small></div>')+'</div></div></article>';
}
function budgetsView(){
 const banking=state.bankingBudgets?.budgets||[];
 const bankingRows=banking.map(x=>'<div class="fm-row"><div><h3>'+esc(x.category)+'</h3><p>'+esc(x.ownership_scope)+' · '+esc(x.cycle)+' · '+esc(x.currency)+'</p></div><div class="fm-row-right"><b>'+nativeMoney(x.limit_amount,x.currency)+'</b><small>'+num(x.used_percent)+'% used · '+nativeMoney(x.remaining_amount,x.currency)+' remaining</small><button data-bank-budget-archive="'+esc(x.budget_uid)+'">Archive</button></div></div>').join('');
 return '<div class="fm-grid two">'+personalCard('budgets')+'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Banking Budgets</h2><p>Category budgets calculated from the canonical bank ledger; internal transfers are excluded.</p></div><button id="addBankBudget">+ Add</button></div><div class="fm-list">'+(bankingRows||emptyState('No banking budgets','Create a Company/Personal banking budget against real ledger activity.'))+'</div></div></article></div>';
}
function notificationsView(){
 const items=state.notifications?.notifications||[],prefs=state.notificationPrefs?.preferences||[];
 const bankPrefs=state.bankingOps?.alerts||{},attention=state.os?.attention||[];
 const attentionRows=attention.map(a=>'<div class="fm-row"><div><h3>'+esc(String(a.code||'Finance alert').replaceAll('_',' '))+'</h3><p>'+esc(a.message||'')+(a.currency?' · '+esc(a.currency):'')+'</p></div>'+statusBadge(a.severity||'MEDIUM')+'</div>').join('');
 const preferenceRows=prefs.map(p=>'<div class="fm-row"><div><h3>'+esc(p.category)+'</h3><p>'+esc(p.digest_frequency||'IMMEDIATE')+(p.quiet_hours_start?' · quiet '+esc(p.quiet_hours_start)+'–'+esc(p.quiet_hours_end||''):'')+'</p></div><label class="fm-check"><input type="checkbox" data-notification-pref="'+esc(p.category)+'" '+(Number(p.in_app_enabled)?'checked':'')+'> In app</label></div>').join('');
 return resourceError('notifications','Finance Notifications')+
 '<div class="fm-control-intro"><p>FINANCE ALERTS</p><h2>One place for banking risk, sync, budget and workflow alerts</h2><span>Alert thresholds are personal preferences. They do not block transactions, change balances or execute payments.</span></div>'+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Notifications</h2><p>'+num(state.notifications?.total)+' active notification(s).</p></div><button id="markAllNotifications">Mark all read</button></div><div class="fm-list">'+(items.map(n=>'<div class="fm-row"><div><h3>'+esc(n.title)+'</h3><p>'+esc(n.message||'')+' · '+esc(n.category||'')+'</p></div><div class="fm-row-right">'+statusBadge(n.priority||'NORMAL')+'<small>'+date(n.created_at)+'</small>'+(n.is_read?'':'<button data-notification-read="'+n.id+'">Mark read</button>')+'</div></div>').join('')||emptyState('No notifications','No active Finance/user notifications are available.'))+'</div></div></article>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Banking alert rules</h2><p>Choose the conditions that should surface banking attention.</p></div></div><form id="bankingAlertForm" class="fm-form"><div class="fm-form-grid"><label>Low balance threshold<input name="low_balance_threshold" inputmode="decimal" value="'+esc(bankPrefs.low_balance_threshold??'')+'" placeholder="e.g. 5000"></label><label>Large transaction threshold<input name="large_transaction_threshold" inputmode="decimal" value="'+esc(bankPrefs.large_transaction_threshold??'')+'" placeholder="e.g. 2500"></label></div><fieldset><legend>Alert types</legend><label class="fm-check"><input type="checkbox" name="notify_budget" '+(bankPrefs.notify_budget===undefined||Number(bankPrefs.notify_budget)?'checked':'')+'> Budget usage</label><label class="fm-check"><input type="checkbox" name="notify_payments" '+(bankPrefs.notify_payments===undefined||Number(bankPrefs.notify_payments)?'checked':'')+'> Payment workflow</label><label class="fm-check"><input type="checkbox" name="notify_bank_sync" '+(bankPrefs.notify_bank_sync===undefined||Number(bankPrefs.notify_bank_sync)?'checked':'')+'> Bank sync / consent</label><label class="fm-check"><input type="checkbox" name="notify_unusual_activity" '+(bankPrefs.notify_unusual_activity===undefined||Number(bankPrefs.notify_unusual_activity)?'checked':'')+'> Unusual activity</label></fieldset><p class="fm-helper">Blank thresholds disable that numeric threshold. Amounts are interpreted in each account’s native currency; currencies are not silently converted.</p><div class="fm-form-actions"><button class="primary" type="submit">Save banking alerts</button></div></form></div></article></div>'+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Current banking attention</h2><p>Evidence-backed conditions from the Banking command centre.</p></div></div><div class="fm-list">'+(attentionRows||emptyState('No current banking alerts','No current liquidity, approval, overdue or concentration alert was returned.'))+'</div></div></article>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Delivery preferences</h2><p>Per-user in-app, email and digest settings.</p></div></div><div class="fm-list">'+(preferenceRows||'<p class="fm-helper">Preferences are created when a notification category is configured.</p>')+'</div></div></article></div>';
}
function forecastView(){
 const smartErr=resourceError('smart','Smart Money forecast'),healthErr=resourceError('health','Financial Health'),roadErr=resourceError('roadmaps','Roadmap Intelligence');
 const safe=Object.entries(state.smart?.safe_to_spend_by_currency||{});
 const health=Object.entries(state.health?.by_currency||{});
 const roadmaps=state.roadmaps?.roadmaps||[];
 const safeCards=safe.map(([currency,row])=>'<div class="fm-kpi"><span>'+esc(currency)+' safe to spend</span><strong>'+nativeMoney(row.safe_to_spend,currency)+'</strong><small>Visible funds '+nativeMoney(row.visible_funds,currency)+' · known 30-day outflows '+nativeMoney(row.known_outflows_30d,currency)+' · safety buffer '+nativeMoney(row.safety_buffer,currency)+'</small></div>').join('');
 const healthRows=health.map(([currency,row])=>'<div class="fm-row"><div><h3>'+esc(currency)+' financial health</h3><p>Projected month-end spending '+nativeMoney(row.projected_month_end_spending,currency)+' · recurring outflows 30d '+nativeMoney(row.known_recurring_outflows_30d,currency)+'</p></div><div class="fm-row-right"><b>'+nativeMoney(row.safe_after_buffer_and_known_bills,currency)+'</b><small>safe after known bills · runway '+(row.runway_months===null||row.runway_months===undefined?'—':esc(row.runway_months)+' months')+'</small></div></div>').join('');
 const roadmapRows=roadmaps.map(r=>'<div class="fm-row"><div><h3>'+esc(r.name)+'</h3><p>'+esc(r.plan_type)+' · '+esc(r.intelligence?.forecast_basis||'Not enough data')+'</p></div><div class="fm-row-right"><b>'+esc(r.intelligence?.trajectory||'NOT_ENOUGH_DATA')+'</b><small>Target '+nativeMoney(r.target_value,r.currency)+' · forecast '+date(r.intelligence?.forecast_completion_date)+'</small></div></div>').join('');
 return smartErr+healthErr+roadErr+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Forecast & Safe-to-Spend</h2><p>Planning estimates use existing Personal Money evidence. Expected income is not counted as available cash, no forecast mutates financial records, and this view does not create or execute an internal payment instruction or bank transfer.</p></div></div><div class="fm-grid four">'+(safeCards||'<div class="fm-kpi"><span>Safe to spend</span><strong>—</strong><small>No personal planning balance is available.</small></div>')+'</div></div></article>'+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Financial Health Projection</h2><p>Pace indicators, not guaranteed future outcomes.</p></div></div><div class="fm-list">'+(healthRows||emptyState('No projection','Personal Financial Health has no current projection data.'))+'</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Roadmap Intelligence</h2><p>Forecast dates are based on recorded progress or your explicit monthly target.</p></div></div><div class="fm-list">'+(roadmapRows||emptyState('No roadmaps','Create a Personal Money roadmap to track a goal or debt plan.'))+'</div></div></article></div>';
}
function calendarView(){
 const business=state.cashflowCalendar?.events||[],personal=state.smart?.cashflow_calendar||[];
 const businessRows=business.map(e=>'<div class="fm-row"><div><h3>'+esc(e.title||'Payment instruction')+'</h3><p>'+date(e.date)+' · '+esc(e.status||'')+' · '+esc(e.account_name||'No account')+'</p></div><div class="fm-row-right"><b>'+nativeMoney(e.amount,e.currency||'AUD')+'</b><small>'+esc(e.schedule_type||e.type||'PAYMENT')+'</small></div></div>').join('');
 const personalRows=personal.map(e=>'<div class="fm-row"><div><h3>'+esc(e.name||e.counterparty||e.title||'Personal item')+'</h3><p>'+date(e.date||e.due_date)+' · '+esc(e.frequency||e.type||'')+'</p></div><div class="fm-row-right"><b>'+nativeMoney(e.amount,e.currency||'AUD')+'</b><small>'+esc(e.direction||'')+'</small></div></div>').join('');
 return resourceError('cashflowCalendar','Banking Cash Flow Calendar')+resourceError('smart','Personal Money Calendar')+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Company / Banking Calendar</h2><p>Known approval/payment-instruction events for the next 90 days. This does not claim direct bank execution.</p></div></div><div class="fm-list">'+(businessRows||emptyState('No upcoming banking events','No visible pending payment events were returned.'))+'</div></div></article>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Personal Money Calendar</h2><p>Approved recurring reminders and Personal Money planning events remain separate from Company Finance.</p></div></div><div class="fm-list">'+(personalRows||emptyState('No personal events','No known Personal Money events are due in the planning window.'))+'</div></div></article></div>';
}
function userPreferencesCard(){
 const p=state.userPreferences||{},cards=Array.isArray(p.dashboard_cards)?p.dashboard_cards:[];
 const checked=key=>!cards.length||cards.includes(key);
 return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>User Preferences</h2><p>Personal defaults only. They never change another user\'s Finance workspace or financial records.</p></div></div><form id="financePreferencesForm" class="fm-form"><div class="fm-form-grid"><label>Default workspace<select name="default_workspace"><option value="ALL" '+(p.default_workspace==='ALL'?'selected':'')+'>Consolidated</option><option value="PERSONAL" '+(p.default_workspace==='PERSONAL'?'selected':'')+'>Personal</option><option value="BUSINESS" '+(p.default_workspace==='BUSINESS'?'selected':'')+'>Company</option></select></label><label>Default account<select name="default_account_id"><option value="">All permitted accounts</option>'+state.accounts.map(a=>'<option value="'+a.id+'" '+(String(p.default_account_id||'')===String(a.id)?'selected':'')+'>'+esc(a.nickname||'Account')+' · '+esc(a.currency||'AUD')+'</option>').join('')+'</select></label><label>Default period<select name="default_period">'+[['month','This Month'],['last_month','Last Month'],['last30','Last 30 Days'],['quarter','This Quarter'],['fy','Current Financial Year'],['year','Calendar Year']].map(([v,l])=>'<option value="'+v+'" '+(p.default_period===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label><label>Preferred reporting currency<input name="reporting_currency" maxlength="3" value="'+esc(p.reporting_currency||'')+'" placeholder="AUD"></label><label>Date format<select name="date_format"><option '+(p.date_format==='DD/MM/YYYY'?'selected':'')+'>DD/MM/YYYY</option><option '+(p.date_format==='MM/DD/YYYY'?'selected':'')+'>MM/DD/YYYY</option><option '+(p.date_format==='YYYY-MM-DD'?'selected':'')+'>YYYY-MM-DD</option></select></label><label>Number format<select name="number_format"><option value="en-AU" '+(p.number_format==='en-AU'?'selected':'')+'>Australia</option><option value="en-US" '+(p.number_format==='en-US'?'selected':'')+'>United States</option><option value="en-GB" '+(p.number_format==='en-GB'?'selected':'')+'>United Kingdom</option></select></label></div><fieldset><legend>Overview cards</legend><label class="fm-check"><input type="checkbox" name="dashboard_cards" value="cashflow" '+(checked('cashflow')?'checked':'')+'> Cash Flow Trend</label><label class="fm-check"><input type="checkbox" name="dashboard_cards" value="expenses" '+(checked('expenses')?'checked':'')+'> Expense Distribution</label><label class="fm-check"><input type="checkbox" name="dashboard_cards" value="accounts" '+(checked('accounts')?'checked':'')+'> Accounts</label><label class="fm-check"><input type="checkbox" name="dashboard_cards" value="recent" '+(checked('recent')?'checked':'')+'> Recent Transactions</label><p class="fm-helper">Needs Your Attention always remains visible for safety and data quality.</p></fieldset><p class="fm-helper">A reporting-currency preference never relabels native amounts. Conversion remains disabled unless verified FX evidence exists.</p><div class="fm-form-actions"><button class="primary" type="submit">Save preferences</button></div></form></div></article>';
}
function accountingPeriodsCard(){
 const periods=state.accountingPeriods?.accounting_periods||[];
 const rows=periods.map(p=>'<div class="fm-row"><div><h3>'+esc(p.period_key||p.label||'Accounting period')+'</h3><p>'+date(p.start_date)+' → '+date(p.end_date)+(p.lock_reason?' · '+esc(p.lock_reason):'')+'</p></div><div class="fm-row-right">'+statusBadge(p.status)+'<select data-period-target="'+p.id+'" data-period-key="'+esc(p.period_key||'')+'" data-period-current="'+esc(p.status||'OPEN')+'"><option '+(p.status==='OPEN'?'selected':'')+'>OPEN</option><option '+(p.status==='REVIEWING'?'selected':'')+'>REVIEWING</option><option '+(p.status==='READY'?'selected':'')+'>READY</option><option '+(p.status==='LOCKED'?'selected':'')+'>LOCKED</option></select><button data-period-apply="'+p.id+'">Apply</button></div></div>').join('');
 return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Accounting Period Control</h2><p>Open → Reviewing → Ready → Locked. Server validation blocks unsafe locks and every change is audited.</p></div></div>'+resourceError('accountingPeriods','Accounting periods')+'<div class="fm-list">'+(rows||emptyState('No accounting periods','Configure a financial year and periods before using period locks.'))+'</div></div></article>';
}

function companyView(){
 const bank=scopedBankWorkspace('Voxel Veda Company Banking','BUSINESS',state.businessBankDash,'businessBankDash');
 const summary=state.companySummary,approvals=state.os?.approval_inbox||[];
 const permission=resourceError('companySummary','Company Finance');
 if(!summary)return bank+permission+accountingPeriodsCard();
 const currency=summary.currency||'AUD';
 const billRows=(summary.bills||[]).slice(0,12).map(b=>'<button class="fm-row fm-row-button" data-company-bill="'+b.id+'"><div><h3>'+esc(b.supplier_name||b.bill_uid)+'</h3><p>'+esc(b.supplier_invoice_no||b.bill_uid)+' · due '+date(b.due_date)+' · '+esc(b.status)+'</p></div><div class="fm-row-right"><b>'+nativeMoney(b.balance,currency)+'</b><small>remaining</small></div></button>').join('');
 const receivableRows=(summary.customer_invoices||[]).filter(i=>num(i.balance_due)>0.009).slice(0,12).map(i=>'<button class="fm-row fm-row-button" data-customer-invoice="'+i.id+'"><div><h3>'+esc(i.customer_name||'Customer')+'</h3><p>'+esc(i.invoice_no||'#'+i.id)+' · '+date(i.created_at)+' · '+esc(i.payment_state||i.status||'')+'</p></div><div class="fm-row-right"><b>'+nativeMoney(i.balance_due,currency)+'</b><small>of '+nativeMoney(i.total,currency)+' due</small></div></button>').join('');
 const queryRows=(summary.accountant_queries||[]).slice(0,8).map(q=>'<div class="fm-row"><div><h3>'+esc(q.question||q.query_uid)+'</h3><p>Raised '+date(q.raised_at)+'</p></div>'+statusBadge(q.status)+'</div>').join('');
 return bank+permission+'<section class="fm-company-ops"><div class="fm-section-title"><small>COMPANY OPERATIONS</small><h2>Receivables, payables, approvals and accounting controls</h2></div>'+
 '<div class="fm-grid four"><div class="fm-kpi"><span>Supplier payables</span><strong>'+nativeMoney(summary.supplier_payables,currency)+'</strong><small>'+num(summary.supplier_bill_count)+' outstanding bill(s)</small></div>'+
 '<div class="fm-kpi"><span>Customer receivables</span><strong class="good">'+nativeMoney(summary.customer_receivables,currency)+'</strong><small>'+num(summary.open_customer_invoice_count)+' open customer invoice(s)</small></div>'+
 '<div class="fm-kpi"><span>Customer payments</span><strong>'+nativeMoney(summary.customer_payments_received,currency)+'</strong><small>Recorded against invoices</small></div>'+
 '<div class="fm-kpi"><span>Supplier approvals</span><strong>'+num(summary.pending_supplier_approvals)+'</strong><small>Awaiting supplier-bill approval</small></div>'+
 '<div class="fm-kpi"><span>Banking approvals</span><strong>'+approvals.length+'</strong><small>Internal payment instructions awaiting approval</small></div>'+
 '<div class="fm-kpi"><span>Recorded assets</span><strong>'+nativeMoney(summary.recorded_asset_cost,currency)+'</strong><small>'+num(summary.active_asset_count)+' active asset record(s)</small></div></div>'+
 '<div class="fm-grid three"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Customer Receivables</h2><p>Existing invoice balances after recorded customer payments. No bank-credit inference.</p></div></div><div class="fm-list">'+(receivableRows||emptyState('No open receivables','No customer invoice currently has a remaining balance.'))+'</div></div></article>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Supplier Payables</h2><p>Supplier-bill ledger. Click a bill for items and payment history.</p></div></div><div class="fm-list">'+(billRows||emptyState('No supplier payables','No active supplier bills were returned.'))+'</div></div></article>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Accountant Queries</h2><p>Open collaboration questions for Company Finance.</p></div></div><div class="fm-list">'+(queryRows||emptyState('No open accountant queries','No unresolved accountant queries.'))+'</div></div></article></div>'+
 accountingPeriodsCard()+'</section>';
}
function consolidatedView(){
 const personalRows=dashboardCurrencyRows(state.personalBankDash),businessRows=dashboardCurrencyRows(state.businessBankDash);
 const summaryCards=(label,scope,rows)=>'<article class="fm-owner-summary '+scope.toLowerCase()+'"><div class="fm-card-head"><div><small>'+scope+'</small><h2>'+label+'</h2></div><button data-scope-view="'+scope+'" data-scope-target="transactions">Open</button></div><div class="fm-owner-currencies">'+(rows.map(r=>'<div><span>'+esc(r.currency)+'</span><b>'+nativeMoney(r.balance,r.currency)+'</b><small>In '+nativeMoney(r.money_in,r.currency)+' · Out '+nativeMoney(r.money_out,r.currency)+' · Net '+nativeMoney(r.net_flow,r.currency)+'</small></div>').join('')||'<div><span>No activity</span><b>—</b><small>No visible bank account data for this ownership scope.</small></div>')+'</div></article>';
 return '<div class="fm-control-intro"><p>CONSOLIDATED — OWNERSHIP PRESERVED</p><h2>One finance system, two clearly separated ownership views</h2><span>Personal and Voxel Veda bank records are displayed together for analysis but are never silently merged or reclassified. Native currencies remain separate.</span><div class="fm-control-quick"><button data-scope-view="PERSONAL" data-scope-target="transactions">Personal transactions</button><button data-scope-view="BUSINESS" data-scope-target="transactions">Company transactions</button><button data-viewjump="reports">Build consolidated report</button></div></div><div class="fm-owner-grid">'+summaryCards('Personal Banking','PERSONAL',personalRows)+summaryCards('Voxel Veda Company Banking','BUSINESS',businessRows)+'</div>'+scopedBankWorkspace('Personal Banking','PERSONAL',state.personalBankDash,'personalBankDash')+scopedBankWorkspace('Voxel Veda Company Banking','BUSINESS',state.businessBankDash,'businessBankDash');
}
function latestFxRate(from,to,asOf=localIsoDay()){
 const source=String(from||'').toUpperCase(),target=String(to||'').toUpperCase();
 if(!source||!target)return null;if(source===target)return {rate:1,effective_date:asOf,source_note:'Same currency'};
 const rows=(state.fxRates?.rates||[]).filter(r=>String(r.effective_date||'').slice(0,10)<=asOf);
 const direct=rows.filter(r=>r.from_currency===source&&r.to_currency===target).sort((a,b)=>String(b.effective_date).localeCompare(String(a.effective_date)))[0];
 if(direct)return {rate:num(direct.rate),effective_date:direct.effective_date,source_note:direct.source_note||'Manual FX evidence',rate_uid:direct.rate_uid,direction:'DIRECT'};
 const reverse=rows.filter(r=>r.from_currency===target&&r.to_currency===source).sort((a,b)=>String(b.effective_date).localeCompare(String(a.effective_date)))[0];
 if(reverse&&num(reverse.rate)>0)return {rate:1/num(reverse.rate),effective_date:reverse.effective_date,source_note:reverse.source_note||'Manual FX evidence',rate_uid:reverse.rate_uid,direction:'INVERSE'};
 return null;
}
function managementConversionCard(){
 const rows=currencyRows(),target=String(state.userPreferences?.reporting_currency||state.companySettings?.settings?.base_currency||'AUD').toUpperCase();
 if(!rows.length)return '';
 let balance=0,moneyIn=0,moneyOut=0,net=0;const missing=[],used=[];
 for(const row of rows){
  const fx=latestFxRate(row.currency,target);
  if(!fx){missing.push(row.currency);continue}
  balance+=num(row.balance)*fx.rate;moneyIn+=num(row.money_in)*fx.rate;moneyOut+=num(row.money_out)*fx.rate;net+=num(row.net_flow)*fx.rate;
  if(row.currency!==target)used.push(row.currency+'→'+target+' '+fx.rate.toFixed(6)+' @ '+String(fx.effective_date).slice(0,10));
 }
 const complete=missing.length===0;
 return `<article class="fm-card fm-fx-summary"><div class="fm-pad"><div class="fm-card-head"><div><h2>Management conversion · ${esc(target)}</h2><p>Native bank values remain authoritative. This optional view uses only your saved FX evidence.</p></div><button data-viewjump="currency">${complete?'Manage rates':'Add rates'}</button></div>${complete?`<div class="fm-grid four"><div class="fm-kpi"><span>Converted position</span><strong>${nativeMoney(balance,target)}</strong><small>Management view only</small></div><div class="fm-kpi"><span>Converted money in</span><strong class="good">${nativeMoney(moneyIn,target)}</strong></div><div class="fm-kpi"><span>Converted money out</span><strong class="bad">${nativeMoney(moneyOut,target)}</strong></div><div class="fm-kpi"><span>Converted net flow</span><strong>${nativeMoney(net,target)}</strong></div></div><p class="fm-helper">${esc(used.join(' · ')||'No conversion was required for this selection.')}</p>`:`<div class="fm-state"><strong>Conversion intentionally incomplete</strong><p>Missing ${esc(missing.join(', '))} → ${esc(target)} FX evidence. Finance will not invent an exchange rate.</p></div>`}</div></article>`;
}
function currencyView(){
 const rates=state.fxRates?.rates||[],target=String(state.userPreferences?.reporting_currency||state.companySettings?.settings?.base_currency||'AUD').toUpperCase();
 const rateRows=rates.map(r=>`<div class="fm-row"><div><h3>${esc(r.from_currency)} → ${esc(r.to_currency)}</h3><p>1 ${esc(r.from_currency)} = ${num(r.rate).toLocaleString('en-AU',{maximumFractionDigits:10})} ${esc(r.to_currency)} · effective ${date(r.effective_date)}</p><small>${esc(r.source_note||'No source note')}</small></div><div class="fm-row-right">${statusBadge('ACTIVE')}<button data-fx-archive="${esc(r.rate_uid)}">Archive</button></div></div>`).join('');
 return resourceError('fxRates','Currency Centre')+`<div class="fm-control-intro"><p>MULTI-CURRENCY CONTROL</p><h2>Track native currencies first; convert only with explicit evidence</h2><span>Your AUD, USD, INR and other transactions remain in their original currency. Saved rates create a separate management-calculation layer and never overwrite bank evidence.</span><div class="fm-control-quick"><button data-fx-new="1">+ Add FX rate</button><button data-viewjump="reports">Reports</button><button data-viewjump="settings">Reporting currency</button></div></div>${managementConversionCard()}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>FX evidence register</h2><p>Current reporting target: ${esc(target)}. Reverse conversion is calculated only from an explicit saved inverse rate.</p></div><button data-fx-new="1">+ Rate</button></div><div class="fm-list">${rateRows||emptyState('No FX evidence saved','Add a rate only when you have a bank/card/provider or other explicit source for that rate.')}</div></div></article>`;
}
function openFxRateForm(){
 const target=String(state.userPreferences?.reporting_currency||state.companySettings?.settings?.base_currency||'AUD').toUpperCase();
 $('fmModalEyebrow').textContent='FX EVIDENCE';$('fmModalTitle').textContent='Add exchange rate';
 $('fmModalBody').innerHTML=`<form id="fxRateForm" class="fm-form"><div class="fm-form-grid"><label>From currency<input name="from_currency" maxlength="3" placeholder="USD" required></label><label>To currency<input name="to_currency" maxlength="3" value="${esc(target)}" required></label></div><div class="fm-form-grid"><label>Rate<input name="rate" inputmode="decimal" placeholder="1 FROM = ? TO" required></label><label>Effective date<input name="effective_date" type="date" value="${localIsoDay()}" required></label></div><label>Evidence / source note<input name="source_note" placeholder="e.g. Wise conversion receipt, bank card settlement rate"></label><p class="fm-helper">This creates management-reporting evidence only. It does not revalue or rewrite any native transaction.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary">Save rate</button></div></form>`;
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=> $('fmModal').close());
 $('fxRateForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());body.from_currency=String(body.from_currency||'').toUpperCase();body.to_currency=String(body.to_currency||'').toUpperCase();try{const x=await api(API+'/fx-rates',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await loadResource('fxRates',API+'/fx-rates');if(state.view==='currency')render()}catch(error){notice(error.message,true)}};
}
function cashView(){
 const p=state.personal||{}, wallets=p.wallets||[],archivedWallets=p.archived_wallets||[];
 const cashAccounts=state.accounts.filter(a=>/CASH|PETTY|TILL/i.test(String(a.account_type||'')+' '+String(a.nickname||'')));
 return `<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Canonical cash accounts</h2><p>Company/banking cash accounts stay in the same bank transaction ledger.</p></div><button data-account-new="CASH">+ Cash account</button></div><div class="fm-list">${cashAccounts.map(a=>`<div class="fm-row" data-account="${a.id}"><div><h3>${esc(a.nickname)}</h3><p>${esc(a.account_type||'Cash')} · ${esc(a.ownership_scope||'')}</p></div><b>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency)}</b></div>`).join('')||emptyState('No canonical cash accounts','Create a Cash or Petty Cash account for company cash tracking.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Personal cash wallets</h2><p>Owner-only Personal Money wallets are intentionally not merged into company totals.</p></div><div class="fm-inline-actions"><button data-personal-new="wallet">+ Wallet</button><button data-personal-new="cash">+ Cash movement</button></div></div><div class="fm-list">${wallets.map(w=>`<div class="fm-row"><div><h3>${esc(w.name)}</h3><p>Personal wallet · ${esc(w.currency)}</p></div><div class="fm-row-right"><b>${nativeMoney(w.balance,w.currency)}</b><button data-wallet-active="0" data-wallet-id="${esc(w.id)}" ${Math.abs(num(w.balance))>0.0001?'disabled title="Move balance to zero before archiving"':''}>Archive</button></div></div>`).join('')||emptyState('No personal wallets','Create a Personal Money wallet before recording personal cash movements.')}</div><details class="fm-recovery"><summary>Archived personal wallets · ${archivedWallets.length}</summary><div class="fm-list">${archivedWallets.map(w=>`<div class="fm-row"><div><h3>${esc(w.name)}</h3><p>${esc(w.currency)} · archived</p></div><div class="fm-row-right"><b>${nativeMoney(w.balance,w.currency)}</b><button data-wallet-active="1" data-wallet-id="${esc(w.id)}">Restore</button></div></div>`).join('')||emptyState('No archived wallets','Zero-balance wallets you archive can be restored here.')}</div></details></div></article></div>`;
}
function insightsView(){
 const rows=state.insights?.insights||[],intel=state.dash?.intelligence_by_currency||[],merchants=state.dash?.merchants||[],recurring=state.dash?.detected_recurring||[];
 const currencyCards=intel.map(x=>`<article class="fm-intelligence-card"><header><div><small>${esc(x.currency)}</small><h3>Spending health</h3></div>${statusBadge(x.confidence||'LOW')}</header><div class="fm-intelligence-metrics"><span>Avg monthly spend<b>${nativeMoney(x.average_monthly_spend,x.currency)}</b></span><span>Free cash flow<b class="${num(x.monthly_free_cash_flow)<0?'bad':'good'}">${nativeMoney(x.monthly_free_cash_flow,x.currency)}</b></span><span>Recurring / month<b>${nativeMoney(x.recurring_monthly_estimate,x.currency)}</b></span><span>Safe to spend · 7d<b>${nativeMoney(x.safe_to_spend_7d,x.currency)}</b></span><span>Savings rate<b>${x.savings_rate_percent===null?'—':num(x.savings_rate_percent).toFixed(1)+'%'}</b></span><span>Cash runway<b>${x.cash_runway_months===null?'—':num(x.cash_runway_months).toFixed(1)+' mo'}</b></span></div><div class="fm-risk-list">${(x.alerts||[]).map(a=>`<div class="fm-risk"><span>${statusBadge(a.severity)}</span><p>${esc(a.message)}</p></div>`).join('')||'<p class="fm-helper">No current evidence-backed spending alert for this currency.</p>'}</div></article>`).join('');
 const topMerchants=merchants.slice(0,12).map(m=>`<button class="fm-row" data-merchant-filter="${esc(m.merchant||'')}"><div><h3>${esc(m.merchant||'Unknown')}</h3><p>${num(m.transaction_count)} transaction(s) · ${esc(m.currency||'AUD')}</p></div><b>${nativeMoney(m.spent,m.currency||'AUD')}</b></button>`).join('');
 const recurringRows=recurring.slice(0,12).map(r=>`<div class="fm-row"><div><h3>${esc(r.merchant||r.merchant_normalized||'Recurring payment')}</h3><p>${esc(r.recurring_frequency||'Recurring')} · ${num(r.matched_transactions)} matched transaction(s)</p></div><div class="fm-row-right"><b>${nativeMoney(r.typical_amount,r.currency||'AUD')}</b><small>typical amount</small></div></div>`).join('');
 const transactionRows=rows.map(x=>`<div class="fm-row" data-tx="${x.bank_transaction_id}"><div><h3>${esc(x.merchant_name||x.description||'Transaction insight')}</h3><p>${x.suggested_category?'Category suggestion: '+esc(x.suggested_category)+' · ':''}${x.recurring_frequency?'Recurring '+esc(x.recurring_frequency)+' · ':''}${x.transfer_candidate_uid?'Transfer candidate · ':''}anomaly ${num(x.anomaly_score)}</p></div><div class="fm-row-right">${statusBadge(x.status)}<small>${date(x.transaction_date)}</small></div></div>`).join('');
 return `${resourceError('insights','Finance Insights')}<div class="fm-control-intro"><p>SPENDING & COST INTELLIGENCE</p><h2>See where money goes before calling it “waste”</h2><span>The system surfaces concentration, recurring commitments, negative cash-flow trends, unusual transactions and runway pressure from your real ledger. It does not label a legitimate expense as waste without evidence.</span><div class="fm-control-quick"><button id="runAnalysis" type="button">Refresh analysis</button><button data-viewjump="budgets">Budgets</button><button data-viewjump="reports">Spending reports</button><button data-viewjump="transactions">Transactions</button></div></div><section class="fm-intelligence-grid">${currencyCards||emptyState('Not enough history yet','Import and classify more complete statement history to build spending intelligence.')}</section><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Top spending merchants</h2><p>Largest visible merchant outflows in the selected period. Tap a merchant to inspect matching transactions.</p></div></div><div class="fm-list">${topMerchants||emptyState('No merchant spending','No merchant expenses are available for this period.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Recurring commitments</h2><p>Detected repeated payments that may deserve review when reducing costs.</p></div></div><div class="fm-list">${recurringRows||emptyState('No recurring pattern detected','Recurring patterns appear after enough repeated history is available.')}</div></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Transaction intelligence queue</h2><p>Evidence-backed category, recurrence, transfer and anomaly findings linked to underlying transactions.</p></div></div><div class="fm-list">${transactionRows||emptyState('No transaction insights','Refresh analysis or import more verified history.')}</div></div></article>`;
}
function bankingOperationsView(){
 const data=state.bankingOps||{},spaces=data.spaces||[],beneficiaries=data.beneficiaries||[],payments=data.payments||[],access=data.access||{},caps=data.capabilities?.features||data.capabilities||{};
 const command=state.os||{},summary=command.summary_by_currency||{},approvalInbox=command.approval_inbox||[],attention=command.attention||[],obligations=command.obligations||{};
 const commandCurrencyRows=Object.entries(summary).map(([currency,m])=>'<div class="fm-kpi"><span>'+esc(currency)+' visible balance</span><strong>'+nativeMoney(m.balance,currency)+'</strong><small>30d projected '+nativeMoney(m.projected_liquidity_30d,currency)+' · runway '+(m.runway_days==null?'—':esc(m.runway_days)+' days')+'</small></div>').join('');
 const approvalRows=approvalInbox.map(p=>'<div class="fm-row"><div><h3>'+esc(p.payee_name||'Payment approval')+'</h3><p>'+esc(p.account_name||'Account')+' · prepared by '+esc(p.created_by_name||p.prepared_by_name||p.creator_name||('user #'+p.created_by))+' · due '+date(p.due_date)+'</p></div><div class="fm-row-right"><b>'+nativeMoney(p.amount,p.currency||'AUD')+'</b>'+statusBadge(p.status||'PENDING_APPROVAL')+'<div class="fm-inline-actions"><button data-payment-decision="APPROVE" data-payment-uid="'+esc(p.payment_uid)+'">Approve</button><button class="bad" data-payment-decision="REJECT" data-payment-uid="'+esc(p.payment_uid)+'">Reject</button></div></div></div>').join('');
 const attentionRows=attention.map(a=>'<div class="fm-row"><div><h3>'+esc(String(a.code||'Banking attention').replaceAll('_',' '))+'</h3><p>'+esc(a.message||'')+(a.currency?' · '+esc(a.currency):'')+'</p></div>'+statusBadge(a.severity||'MEDIUM')+'</div>').join('');
 const commandPanel='<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Banking Command Centre</h2><p>Liquidity, obligations and independent approvals from permitted accounts only.</p></div>'+statusBadge(command.role_view?.mode||'VIEWER')+'</div><div class="fm-grid four">'+(commandCurrencyRows||'<div class="fm-kpi"><span>Visible liquidity</span><strong>—</strong><small>No permitted banking activity returned.</small></div>')+'</div><div class="fm-grid two"><div><div class="fm-card-head"><div><h3>Approval Inbox</h3><p>Maker-checker rule: you cannot approve your own payment draft.</p></div><span class="fm-badge">'+approvalInbox.length+'</span></div><div class="fm-list">'+(approvalRows||emptyState('No approvals waiting','No independently prepared payment requires your approval.'))+'</div></div><div><div class="fm-card-head"><div><h3>Banking attention</h3><p>Overdue '+num(obligations.overdue)+' · due in 7d '+num(obligations.due_7d)+' · due in 30d '+num(obligations.due_30d)+'</p></div></div><div class="fm-list">'+(attentionRows||emptyState('No active banking warnings','No current liquidity, concentration, runway or overdue warning was returned.'))+'</div></div></div></div></article>';
 const spaceRows=spaces.map(s=>'<div class="fm-row"><div><h3>'+esc(s.name)+'</h3><p>'+esc(s.purpose||'Money space')+' · '+esc(s.ownership_scope)+' · '+esc(s.currency)+'</p></div><div class="fm-row-right"><b>'+nativeMoney(s.allocated_amount,s.currency)+' / '+nativeMoney(s.target_amount,s.currency)+'</b><small>Reserve '+nativeMoney(s.minimum_reserve,s.currency)+'</small><button data-space-archive="'+esc(s.space_uid)+'">Archive</button></div></div>').join('');
 const beneficiaryRows=beneficiaries.map(b=>'<div class="fm-row"><div><h3>'+esc(b.name)+'</h3><p>'+esc(b.nickname||b.bank_name||'Beneficiary')+' · '+esc(b.ownership_scope)+' · '+esc(b.currency)+'</p></div><div class="fm-row-right">'+statusBadge(b.trusted?'TRUSTED':'UNVERIFIED')+'<small>'+esc(b.bsb_masked||'')+' '+esc(b.account_masked||b.payid_masked||'')+'</small></div></div>').join('');
 const paymentRows=payments.map(p=>{
  const terminal=['COMPLETED','REJECTED','CANCELLED'].includes(String(p.status||''));
  const canApprove=Boolean(access.can_approve)&&String(p.status)==='PENDING_APPROVAL'&&Number(p.created_by)!==Number(data.current_user_id);
  const actions='<div class="fm-inline-actions">'+(String(p.status)==='DRAFT'?'<button data-payment-submit="'+esc(p.payment_uid)+'">Submit</button>':'')+(canApprove?'<button data-payment-decision="APPROVE" data-payment-uid="'+esc(p.payment_uid)+'">Approve</button><button class="bad" data-payment-decision="REJECT" data-payment-uid="'+esc(p.payment_uid)+'">Reject</button>':'')+(!terminal?'<button data-payment-cancel="'+esc(p.payment_uid)+'">Cancel</button>':'')+'</div>';
  return '<div class="fm-row"><div><h3>'+esc(p.payee_name||'Payment instruction')+'</h3><p>'+esc(p.payment_type||'')+' · '+esc(p.ownership_scope||'')+' · due '+date(p.due_date)+(p.reference_text?' · '+esc(p.reference_text):'')+'</p></div><div class="fm-row-right"><b>'+nativeMoney(p.amount,p.currency)+'</b>'+statusBadge(p.status)+actions+'</div></div>';
 }).join('');
 const capabilityNote=caps.payment_execution===false||caps.external_payment_execution===false
  ?'External bank payment execution is not enabled. Drafts and approvals are internal instructions only; Voxel Veda does not claim money has moved.'
  :'Payment execution remains provider-capability gated; no money movement is assumed from an approval.';
 return resourceError('bankingOps','Banking Operations')+
 commandPanel+
 '<div class="fm-control-intro><p>BANKING OPERATIONS</p><h2>Prepare and control money movement without a second Banking app</h2><span>'+esc(capabilityNote)+'</span><div class="fm-control-quick"><button id="newPaymentDraft">+ Payment draft</button><button id="newMoneySpace">+ Money space</button><button id="newBeneficiary">+ Beneficiary</button><button data-viewjump="connections">Bank connections</button></div></div>'+
 '<div class="fm-grid four"><div class="fm-kpi"><span>Draft payments</span><strong>'+num(data.operating_intelligence?.drafts)+'</strong></div><div class="fm-kpi"><span>Pending approvals</span><strong>'+num(data.operating_intelligence?.pending_approvals)+'</strong></div><div class="fm-kpi"><span>Ready for execution</span><strong>'+num(data.operating_intelligence?.ready_for_execution)+'</strong><small>Still provider-gated</small></div><div class="fm-kpi"><span>Overdue obligations</span><strong>'+num(data.operating_intelligence?.overdue)+'</strong></div></div>'+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Money Spaces</h2><p>Internal planning allocations by ownership and currency. They do not move bank cash.</p></div><button id="newMoneySpaceInline">+ Add</button></div><div class="fm-list">'+(spaceRows||emptyState('No money spaces','Create an internal allocation for tax, payroll, equipment or another purpose.'))+'</div></div></article>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Beneficiaries</h2><p>Saved payee details for controlled payment preparation.</p></div><button id="newBeneficiaryInline">+ Add</button></div><div class="fm-list">'+(beneficiaryRows||emptyState('No beneficiaries','Add a beneficiary before preparing repeat external payment instructions.'))+'</div></div></article></div>'+
 '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Payment workflow</h2><p>Draft → submit → independent approval → ready-for-execution. External execution remains capability-gated.</p></div><button id="newPaymentDraftInline">+ Draft payment</button></div><div class="fm-list">'+(paymentRows||emptyState('No payment instructions','Create a draft only when you want an internal payment workflow record.'))+'</div></div></article>';
}
function openMoneySpaceForm(){
 $('fmModalEyebrow').textContent='BANKING OPERATIONS';$('fmModalTitle').textContent='New money space';
 $('fmModalBody').innerHTML='<form id="moneySpaceForm" class="fm-form"><label>Name<input name="name" required placeholder="Tax reserve, Payroll, Equipment..."></label><div class="fm-form-grid"><label>Ownership<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option></select></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label></div><label>Purpose<input name="purpose"></label><div class="fm-form-grid"><label>Target amount<input name="target_amount" inputmode="decimal" value="0"></label><label>Allocated amount<input name="allocated_amount" inputmode="decimal" value="0"></label></div><label>Minimum reserve<input name="minimum_reserve" inputmode="decimal" value="0"></label><p class="fm-helper">A Money Space is an internal planning allocation. It does not transfer or reserve money at your bank.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary">Create space</button></div></form>';
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());
 $('moneySpaceForm').onsubmit=async e=>{e.preventDefault();try{const x=await api(OS+'/spaces',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries()))});$('fmModal').close();notice(x.message);await refresh();state.view='bankops';render()}catch(error){notice(error.message,true)}};
}
function openBeneficiaryForm(){
 $('fmModalEyebrow').textContent='BANKING OPERATIONS';$('fmModalTitle').textContent='New beneficiary';
 $('fmModalBody').innerHTML='<form id="beneficiaryForm" class="fm-form"><label>Payee name<input name="name" required></label><div class="fm-form-grid"><label>Nickname<input name="nickname"></label><label>Bank name<input name="bank_name"></label></div><div class="fm-form-grid"><label>Ownership<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option></select></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label></div><div class="fm-form-grid"><label>Masked BSB<input name="bsb_masked" placeholder="***-123"></label><label>Masked account<input name="account_masked" placeholder="******789"></label></div><label>PayID (masked)<input name="payid_masked"></label><label class="fm-check"><input name="trusted" type="checkbox"> Trusted beneficiary after independent verification</label><p class="fm-helper">This stores beneficiary metadata only. Bank credentials, PINs and OTPs are never collected here.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary">Save beneficiary</button></div></form>';
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());
 $('beneficiaryForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries(fd.entries());body.trusted=fd.get('trusted')==='on';try{const x=await api(OS+'/beneficiaries',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await refresh();state.view='bankops';render()}catch(error){notice(error.message,true)}};
}
function openPaymentDraftForm(){
 const data=state.bankingOps||{},accounts=data.accounts||[],beneficiaries=data.beneficiaries||[];
 $('fmModalEyebrow').textContent='CONTROLLED PAYMENT';$('fmModalTitle').textContent='New payment draft';
 $('fmModalBody').innerHTML='<form id="paymentDraftForm" class="fm-form"><label>Source account<select name="bank_account_id" required><option value="">Choose permitted account</option>'+accounts.map(a=>'<option value="'+a.id+'">'+esc(a.nickname||'Account')+' · '+esc(a.currency||'AUD')+' · '+esc(a.ownership_scope||'')+'</option>').join('')+'</select></label><label>Saved beneficiary<select name="beneficiary_id"><option value="">None / manual payee</option>'+beneficiaries.map(b=>'<option value="'+b.id+'">'+esc(b.name)+' · '+esc(b.currency)+'</option>').join('')+'</select></label><label>Payee name<input name="payee_name" required></label><div class="fm-form-grid"><label>Payment type<select name="payment_type"><option>EXTERNAL</option><option>INTERNAL</option><option>BILL</option><option>REIMBURSEMENT</option></select></label><label>Ownership<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option></select></label></div><div class="fm-form-grid"><label>Amount<input name="amount" inputmode="decimal" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label></div><div class="fm-form-grid"><label>Due date<input name="due_date" type="date"></label><label>Schedule<select name="schedule_type"><option>ONCE</option><option>SCHEDULED</option></select></label></div><label>Reference<input name="reference_text"></label><p class="fm-helper">Creating this record does not send money. Submission and approval remain separate; actual external execution requires a verified provider capability.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary">Create draft</button></div></form>';
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());
 $('paymentDraftForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries(fd.entries());body.bank_account_id=Number(body.bank_account_id);body.beneficiary_id=body.beneficiary_id?Number(body.beneficiary_id):null;try{const x=await api(OS+'/payments',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await refresh();state.view='bankops';render()}catch(error){notice(error.message,true)}};
}
async function bankingPaymentAction(uid,action,decision=''){
 try{
  const path=action==='decision'?OS+'/payments/'+encodeURIComponent(uid)+'/decision':OS+'/payments/'+encodeURIComponent(uid)+'/'+action;
  const body=action==='decision'?{decision,note:decision==='REJECT'?(prompt('Reason for rejecting this payment:')||''):''}:{};
  if(action==='decision'&&decision==='REJECT'&&!body.note)return;
  const x=await api(path,{method:'POST',body:JSON.stringify(body)});notice(x.message);await refresh();state.view='bankops';render();
 }catch(error){notice(error.message,true)}
}
function rulesView(){
 const rules=state.rules?.rules||[],categories=state.categories?.categories||[];
 const active=categories.filter(c=>Number(c.active)&&!c.archived_at),archived=categories.filter(c=>!Number(c.active)||c.archived_at);
 const categoryRows=active.map(c=>'<div class="fm-row"><div><h3>'+(c.icon?esc(c.icon)+' ':'')+esc(c.name)+'</h3><p>'+(c.parent_name?'Under '+esc(c.parent_name)+' · ':'')+esc(c.scope)+' · GST '+esc(c.gst_default||'REVIEW')+(c.color?' · '+esc(c.color):'')+'</p></div><div class="fm-row-right"><button data-category-edit="'+c.id+'">Edit</button><button data-category-archive="'+c.id+'">Archive</button></div></div>').join('');
 const archivedRows=archived.map(c=>'<div class="fm-row"><div><h3>'+esc(c.name)+'</h3><p>'+esc(c.scope)+' · archived '+date(c.archived_at)+'</p></div><button data-category-restore="'+c.id+'">Restore</button></div>').join('');
 const ruleRows=rules.map(x=>'<div class="fm-row"><div><h3>'+esc(x.merchant_pattern)+'</h3><p>'+esc(x.category||'No category')+' · '+esc(x.ownership_scope||'Any scope')+' · '+esc(x.gst_treatment||'GST review')+(Array.isArray(x.tags)&&x.tags.length?' · '+esc(x.tags.join(', ')):'')+'</p><small>'+esc(x.application_mode==='AUTO_APPLY'?'Exact-match auto classification':'Suggest only')+' · '+num(x.matched_transaction_count)+' matches · '+num(x.applied_transaction_count)+' applied · last used '+(x.last_used_at?new Date(x.last_used_at).toLocaleString('en-AU'):'never')+' · '+esc(x.creator_name||'')+'</small></div><div class="fm-row-right">'+statusBadge(x.enabled?'ACTIVE':'DISABLED')+'<button data-rule-edit="'+x.id+'">Edit</button><button data-rule-delete="'+x.id+'">Disable</button></div></div>').join('');
 return resourceError('categories','Finance Categories')+resourceError('rules','Finance Rules')+
 '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>System Categories</h2><p>Editable Finance classification. Original bank category remains immutable source evidence.</p></div><button id="addFinanceCategory">+ Category</button></div><div class="fm-list">'+(categoryRows||emptyState('No system categories','Create categories for Personal, Company or Both.'))+'</div>'+(archivedRows?'<details class="fm-removed-statements"><summary>Archived categories <span>'+archived.length+'</span></summary><div class="fm-list">'+archivedRows+'</div></details>':'')+'<p class="fm-helper">GST defaults are review defaults only; unknown bank terminology is never promoted into authoritative tax classification automatically.</p></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Merchant & Category Rules</h2><p>Suggest Only is the default. Auto Apply uses exact merchant matches only on future reviewed statement imports and never changes source evidence, amounts, payments, transfers or reconciliation.</p></div><button id="runAnalysis" type="button">Analyse transactions</button></div><div class="fm-list">'+(ruleRows||emptyState('No saved rules','Approve/remember a transaction classification to create a merchant rule.'))+'</div></div></article></div>';
}
function openFinanceCategoryForm(id=''){
 const categories=state.categories?.categories||[],item=categories.find(c=>String(c.id)===String(id))||{};
 const parents=categories.filter(c=>Number(c.active)&&String(c.id)!==String(id)&&!c.archived_at);
 $('fmModalEyebrow').textContent='FINANCE CATEGORY';$('fmModalTitle').textContent=id?'Edit category':'New category';
 $('fmModalBody').innerHTML='<form id="financeCategoryForm" class="fm-form"><input type="hidden" name="id" value="'+esc(id)+'"><label>Name<input name="name" value="'+esc(item.name||'')+'" required></label><div class="fm-form-grid"><label>Parent<select name="parent_id"><option value="">Top level</option>'+parents.map(p=>'<option value="'+p.id+'" '+(String(item.parent_id)===String(p.id)?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>Scope<select name="scope"><option '+(item.scope==='PERSONAL'?'selected':'')+'>PERSONAL</option><option '+(item.scope==='BUSINESS'?'selected':'')+'>BUSINESS</option><option '+(!item.scope||item.scope==='BOTH'?'selected':'')+'>BOTH</option></select></label></div><div class="fm-form-grid"><label>Icon / short symbol<input name="icon" value="'+esc(item.icon||'')+'" maxlength="40"></label><label>Colour<input name="color" type="color" value="'+esc(item.color||'#5b6570')+'"></label></div><label>GST default<select name="gst_default"><option>REVIEW</option><option>GST_ON_EXPENSES</option><option>GST_ON_INCOME</option><option>GST_FREE</option><option>INPUT_TAXED</option><option>NO_GST</option><option>OUT_OF_SCOPE</option></select></label><p class="fm-helper">This default assists review only. It never overwrites original bank data or silently applies tax treatment to historical transactions.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary">Save category</button></div></form>';
 $('fmModal').showModal();$('financeCategoryForm').elements.gst_default.value=item.gst_default||'REVIEW';document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());
 $('financeCategoryForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries(fd.entries());body.id=body.id?Number(body.id):undefined;body.parent_id=body.parent_id?Number(body.parent_id):null;try{const x=await api(API+'/categories',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function openFinanceRuleForm(id){
 const rule=(state.rules?.rules||[]).find(r=>String(r.id)===String(id));if(!rule)return;
 const cats=(state.categories?.categories||[]).filter(c=>Number(c.active)&&!c.archived_at);
 const legacyCategory=rule.category&&!cats.some(c=>c.name===rule.category)?'<option value="'+esc(rule.category)+'" selected>'+esc(rule.category)+' (existing)</option>':'';
 $('fmModalEyebrow').textContent='FINANCE RULE';$('fmModalTitle').textContent='Edit merchant rule';
 $('fmModalBody').innerHTML='<form id="financeRuleForm" class="fm-form"><label>Merchant pattern<input name="merchant_pattern" value="'+esc(rule.merchant_pattern)+'" required></label><label>Category<select name="category"><option value="">No category</option>'+legacyCategory+cats.map(c=>'<option value="'+esc(c.name)+'" '+(c.name===rule.category?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label><div class="fm-form-grid"><label>Ownership<select name="ownership_scope"><option value="">No scope change</option><option '+(rule.ownership_scope==='PERSONAL'?'selected':'')+'>PERSONAL</option><option '+(rule.ownership_scope==='BUSINESS'?'selected':'')+'>BUSINESS</option><option '+(rule.ownership_scope==='MIXED'?'selected':'')+'>MIXED</option><option '+(rule.ownership_scope==='UNCLASSIFIED'?'selected':'')+'>UNCLASSIFIED</option></select></label><label>GST treatment<select name="gst_treatment"><option value="">No GST change</option>'+['REVIEW','GST_ON_EXPENSES','GST_ON_INCOME','GST_FREE','INPUT_TAXED','NO_GST','OUT_OF_SCOPE'].map(v=>'<option '+(rule.gst_treatment===v?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div><div class="fm-form-grid"><label>Tags<input name="tags" value="'+esc((rule.tags||[]).join(', '))+'" placeholder="fuel, vehicle"></label><label>Priority<input name="priority" type="number" min="1" max="999" value="'+num(rule.priority||200)+'"></label></div><label>Mode<select name="application_mode"><option value="SUGGEST_ONLY" '+(rule.application_mode!=='AUTO_APPLY'?'selected':'')+'>Suggest Only</option><option value="AUTO_APPLY" '+(rule.application_mode==='AUTO_APPLY'?'selected':'')+'>Auto Apply exact matches</option></select></label><label class="fm-check"><input name="enabled" type="checkbox" '+(rule.enabled?'checked':'')+'> Enabled</label><p class="fm-helper">Auto Apply only fills empty safe classification fields on future reviewed statement imports in open periods. It cannot change amounts, source data, transfers, payments or reconciliation.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary">Save rule</button></div></form>';
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());$('financeRuleForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(I+'/rules/'+id,{method:'POST',body:JSON.stringify({merchant_pattern:fd.get('merchant_pattern'),category:fd.get('category')||null,ownership_scope:fd.get('ownership_scope')||null,gst_treatment:fd.get('gst_treatment')||null,tags:String(fd.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),application_mode:fd.get('application_mode'),priority:Number(fd.get('priority')||200),enabled:fd.get('enabled')==='on'})});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}

function openBulkReview(){
 const ids=[...state.selectedTransactions];if(!ids.length)return;
 const categories=(state.categories?.categories||[]).filter(c=>Number(c.active)&&!c.archived_at);
 $('fmModalEyebrow').textContent='CONTROLLED BULK REVIEW';$('fmModalTitle').textContent=ids.length+' selected transactions';
 $('fmModalBody').innerHTML='<form id="bulkReviewForm" class="fm-form"><fieldset><legend>Apply selected fields</legend><label class="fm-bulk-field"><input type="checkbox" name="apply_category"><span>Category</span><select name="category"><option value="">Clear category</option>'+categories.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'</option>').join('')+'</select></label><label class="fm-bulk-field"><input type="checkbox" name="apply_scope"><span>Ownership</span><select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option><option>MIXED</option><option>UNCLASSIFIED</option></select></label><label class="fm-bulk-field"><input type="checkbox" name="apply_merchant"><span>Merchant name</span><input name="merchant_normalized" placeholder="Normalised merchant"></label><label class="fm-bulk-field"><input type="checkbox" name="apply_project"><span>Project</span><input name="project_ref" placeholder="Project or cost centre"></label><label class="fm-bulk-field"><input type="checkbox" name="apply_tags"><span>Tags</span><input name="tags" placeholder="fuel, vehicle"></label><label class="fm-bulk-field"><input type="checkbox" name="apply_gst"><span>GST</span><select name="gst_treatment"><option value="">Clear GST treatment</option>'+['REVIEW','GST_ON_EXPENSES','GST_ON_INCOME','GST_FREE','INPUT_TAXED','NO_GST','OUT_OF_SCOPE'].map(v=>'<option>'+v+'</option>').join('')+'</select></label><label class="fm-bulk-field"><input type="checkbox" name="apply_reviewed"><span>Review status</span><select name="reviewed"><option value="true">Reviewed</option><option value="false">Needs review</option></select></label></fieldset><div id="bulkReviewPreview" class="fm-state" hidden></div><p class="fm-helper">The server verifies access to every selected ID, checks accounting-period locks, previews the exact affected count and records old/new values in the audit chain.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit">Preview changes</button><button class="primary" id="bulkReviewApply" type="button" hidden>Confirm & apply</button></div></form>';
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());
 const form=$('bulkReviewForm'),previewBox=$('bulkReviewPreview'),applyButton=$('bulkReviewApply');let preview=null,body=null;
 const collect=()=>{const fd=new FormData(form),changes={};if(fd.get('apply_category'))changes.category=fd.get('category')||null;if(fd.get('apply_scope'))changes.ownership_scope=fd.get('ownership_scope');if(fd.get('apply_merchant'))changes.merchant_normalized=fd.get('merchant_normalized')||null;if(fd.get('apply_project'))changes.project_ref=fd.get('project_ref')||null;if(fd.get('apply_tags'))changes.tags=String(fd.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean);if(fd.get('apply_gst'))changes.gst_treatment=fd.get('gst_treatment')||null;if(fd.get('apply_reviewed'))changes.reviewed=fd.get('reviewed')==='true';return {transaction_ids:ids,changes}};
 form.onsubmit=async e=>{e.preventDefault();body=collect();try{preview=await api(I+'/transactions/bulk/review',{method:'POST',body:JSON.stringify({...body,preview:true})});previewBox.hidden=false;previewBox.className='fm-state';previewBox.innerHTML='<strong>'+num(preview.affected_count)+' will change</strong><p>'+num(preview.unchanged_count)+' already match. Fields: '+esc((preview.fields||[]).join(', '))+'.</p>';applyButton.hidden=false}catch(error){applyButton.hidden=true;previewBox.hidden=false;previewBox.className='fm-state fm-state-error';previewBox.textContent=error.message}};
 applyButton.onclick=async()=>{if(!preview||!body)return;applyButton.disabled=true;try{const result=await api(I+'/transactions/bulk/review',{method:'POST',body:JSON.stringify({...body,preview:false,expected_count:Number(preview.affected_count)})});$('fmModal').close();state.selectedTransactions.clear();notice(result.message);await loadTransactions()}catch(error){applyButton.disabled=false;notice(error.message,true)}};
}

function reconciliationView(){
 const r=state.reconciliation||{}, rows=r.transactions||[];
 return `${resourceError('reconciliation','Reconciliation')}<div class="fm-grid four"><div class="fm-kpi"><span>Needs action</span><strong>${num(r.summary?.needs_action)}</strong></div><div class="fm-kpi"><span>Ready</span><strong>${num(r.summary?.ready)}</strong></div><div class="fm-kpi"><span>Partial</span><strong>${num(r.summary?.partial)}</strong></div><div class="fm-kpi"><span>Reconciled</span><strong>${num(r.summary?.reconciled)}</strong></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Amount</th><th>Matched</th><th>Remaining</th><th>Workflow</th></tr></thead><tbody>${rows.slice(0,200).map(x=>`<tr data-tx="${x.id}"><td>${date(x.transaction_date)}</td><td>${esc(x.account_name)}</td><td>${esc(x.merchant_name||x.description)}</td><td>${nativeMoney(Math.abs(num(x.amount)),x.currency)}</td><td>${nativeMoney(x.matched_amount,x.currency)}</td><td>${nativeMoney(x.remaining_amount,x.currency)}</td><td>${statusBadge(x.workflow_status)}</td></tr>`).join('')}</tbody></table></div></div></article>`;
}
function teamView(){
 const team=state.team||{},users=team.users||team.team||[],grants=team.grants||[],canManage=Boolean(team.can_manage);
 const businessAccounts=(state.accounts||[]).filter(a=>String(a.ownership_scope||'').toUpperCase()!=='PERSONAL');
 const grantCount=(userId)=>grants.filter(g=>String(g.user_id)===String(userId)).length;
 const rows=users.map(u=>{
  const userGrants=grants.filter(g=>String(g.user_id)===String(u.id));
  const summary=userGrants.length?userGrants.slice(0,3).map(g=>esc(g.account_name||'Account')+' · '+esc(g.access_level||'VIEW')).join(' · '):'No account-specific banking grant';
  return `<div class="fm-row"><div><h3>${esc(u.name||u.email||'User')}</h3><p>${esc(u.role||'')} · ${esc(u.department||'')} · ${summary}</p></div><div class="fm-row-right">${statusBadge(u.account_status||u.status||'ACTIVE')}<small>${grantCount(u.id)} delegated account(s)</small>${canManage?'<button data-team-access="'+u.id+'">Manage access</button>':''}</div></div>`;
 }).join('');
 const matrix=grants.map(g=>`<div class="fm-row"><div><h3>${esc(g.user_name||g.email||'User')} → ${esc(g.account_name||'Account')}</h3><p>${esc(g.ownership_scope||'BUSINESS')} account</p></div><div class="fm-row-right">${statusBadge(g.access_level||'VIEW')}<small>${Number(g.can_prepare_payments)?'prepare · ':''}${Number(g.can_approve_payments)?'approve · ':''}${Number(g.can_manage)?'manage':''}</small></div></div>`).join('');
 return `${resourceError('team','Team Finance Access')}<div class="fm-control-intro"><p>FINANCE ACCESS CONTROL</p><h2>Delegate business banking without exposing Personal Money</h2><span>VIEW, PREPARE, APPROVE and MANAGE grants are enforced by the server per business account. Personal accounts cannot be delegated, and administrators cannot change their own banking access from this screen.</span></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Active team</h2><p>${canManage?'Select a user to assign or revoke account-level access.':'Your role can view Finance but cannot manage delegated banking access.'}</p></div></div><div class="fm-list">${rows||emptyState('No team data','No active users were returned.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Current account grants</h2><p>Only Company/Mixed accounts are eligible for delegation.</p></div><span class="fm-badge">${businessAccounts.length} eligible account(s)</span></div><div class="fm-list">${matrix||emptyState('No delegated access','Business accounts currently rely on role-level permissions only.')}</div></div></article></div>`;
}
function openTeamAccessForm(userId){
 const team=state.team||{},user=(team.users||[]).find(u=>String(u.id)===String(userId));if(!user)return;
 if(!team.can_manage){notice('Your role cannot manage delegated banking access.',true);return}
 const accounts=(state.accounts||[]).filter(a=>String(a.ownership_scope||'').toUpperCase()!=='PERSONAL');
 const grants=team.grants||[];
 const current=Number(state.bankingOps?.current_user_id||0);
 if(current&&Number(user.id)===current){notice('Use another authorised administrator to change your own banking access.',true);return}
 const accessRows=accounts.map(a=>{
  const grant=grants.find(g=>String(g.user_id)===String(user.id)&&String(g.bank_account_id)===String(a.id));
  const level=String(grant?.access_level||'NONE').toUpperCase();
  return `<div class="fm-team-account"><div><b>${esc(a.nickname||'Account')}</b><small>${esc(a.institution||'')} · ${esc(a.currency||'AUD')} · ${esc(a.ownership_scope||'BUSINESS')}</small></div><select data-team-account="${a.id}" data-original-level="${esc(level)}"><option value="NONE" ${level==='NONE'?'selected':''}>No access</option><option value="VIEW" ${level==='VIEW'?'selected':''}>View</option><option value="PREPARE" ${level==='PREPARE'?'selected':''}>Prepare payments</option><option value="APPROVE" ${level==='APPROVE'?'selected':''}>Approve payments</option><option value="MANAGE" ${level==='MANAGE'?'selected':''}>Manage</option></select></div>`;
 }).join('');
 $('fmModalEyebrow').textContent='FINANCE ACCESS';$('fmModalTitle').textContent='Banking access · '+(user.name||user.email||'User');
 $('fmModalBody').innerHTML=`<form id="teamAccessForm" class="fm-form"><div class="fm-state"><strong>Account-level delegation</strong><p>VIEW = read only. PREPARE = create payment instructions. APPROVE = approve another preparer's payment. MANAGE = full delegated banking operations for the account. Personal accounts are intentionally excluded.</p></div><div class="fm-team-access-list">${accessRows||emptyState('No eligible business accounts','Create a Company/Mixed financial account before delegating access.')}</div><div id="teamAccessProgress" class="fm-state" hidden></div><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit" ${accounts.length?'':'disabled'}>Save changed access</button></div></form>`;
 $('fmModal').showModal();document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=>$('fmModal').close());
 $('teamAccessForm').onsubmit=async e=>{
  e.preventDefault();
  const selects=[...e.currentTarget.querySelectorAll('[data-team-account]')];
  const changes=selects.filter(s=>s.value!==s.dataset.originalLevel);
  const progress=$('teamAccessProgress');progress.hidden=false;
  if(!changes.length){progress.innerHTML='<strong>No changes</strong><p>Every account already has the selected access level.</p>';return}
  e.currentTarget.querySelector('button[type="submit"]').disabled=true;
  let completed=0;
  try{
   for(const select of changes){
    await api(OS+'/team/'+encodeURIComponent(user.id)+'/access',{method:'POST',body:JSON.stringify({bank_account_id:Number(select.dataset.teamAccount),access_level:select.value})});
    completed+=1;progress.innerHTML='<strong>Saving access</strong><p>'+completed+' of '+changes.length+' account change(s) applied.</p>';
   }
   $('fmModal').close();notice(completed+' banking access change(s) saved with audit evidence.');
   await loadResource('team',OS+'/team');if(state.view==='team')render();
  }catch(error){
   e.currentTarget.querySelector('button[type="submit"]').disabled=false;
   progress.className='fm-state fm-state-error';progress.innerHTML='<strong>Access update stopped</strong><p>'+esc(error.message)+' · '+completed+' change(s) were already applied before this error.</p>';
   await loadResource('team',OS+'/team');
  }
 };
}
function connectionsView(){
 const r=state.readiness||{},providers=state.openBankProviders?.providers||[],sessions=state.openBankSessions?.sessions||[],connections=state.bankConnectionData?.connections||[];
 const providerCards=providers.map(p=>`<article class="fm-connection-card"><div><span class="fm-account-type">${esc(p.key||p.name||'PROVIDER')}</span><h3>${esc(p.name||p.key||'Open Banking provider')}</h3><p>${p.configured?'Provider credentials are configured.':'Missing configuration: '+esc((p.missing||[]).join(', ')||'not ready')}</p></div><div>${statusBadge(p.configured?'READY':'NOT CONFIGURED')}${p.configured?`<button class="fm-primary" data-bank-connect="${esc(p.key)}">Connect bank</button>`:''}</div></article>`).join('');
 const connectionRows=connections.map(c=>`<div class="fm-row"><div><h3>${esc(c.institution||c.provider||'Bank connection')}</h3><p>${esc(c.provider||'')} · consent ${esc(c.consent_status||'')} · last sync ${c.last_sync_completed_at?new Date(c.last_sync_completed_at).toLocaleString('en-AU'):'never'}</p><small>${(c.accounts||[]).map(a=>esc(a.account_name||'Account')+' · '+esc(a.currency||'')).join(' · ')}</small></div><div class="fm-row-right">${statusBadge(c.status||c.last_sync_status||c.consent_status)}<div class="fm-inline-actions"><button data-bank-sync="${esc(c.connection_uid)}">Sync now</button><button data-bank-reauthorize="${esc(c.provider||'BASIQ')}">Renew consent</button><button class="bad" data-bank-disconnect="${esc(c.connection_uid)}">Disconnect</button></div></div></div>`).join('');
 const sessionRows=sessions.slice(0,20).map(s=>`<div class="fm-row"><div><h3>${esc(s.provider)} consent</h3><p>${esc(s.environment||'')} · created ${s.created_at?new Date(s.created_at).toLocaleString('en-AU'):'—'} · expires ${s.expires_at?new Date(s.expires_at).toLocaleString('en-AU'):'—'}</p></div><div class="fm-row-right">${statusBadge(s.status)}${['CREATED','AWAITING_USER'].includes(String(s.status||''))?`<button data-consent-cancel="${esc(s.session_uid)}">Cancel</button>`:''}</div></div>`).join('');
 const syncRows=(state.bankSyncJobs?.runs||state.bankSyncJobs?.sync_runs||[]).slice(0,12).map(s=>`<div class="fm-row"><div><h3>${esc(s.provider||'Bank sync')} · ${esc(s.trigger_type||'')}</h3><p>${s.started_at?new Date(s.started_at).toLocaleString('en-AU'):'—'} · ${num(s.transactions_seen)} seen · ${num(s.transactions_inserted)} inserted · ${num(s.duplicates_skipped)} duplicates skipped</p></div>${statusBadge(s.status)}</div>`).join('');
 return `${resourceError('readiness','Banking Connections')}<div class="fm-control-intro"><p>OPEN BANKING & MANUAL IMPORT</p><h2>Connect where available; statements always remain the fallback</h2><span>Voxel Veda never asks for or stores your bank password, PIN or OTP. Consent happens on the provider/bank-controlled page. Imported and synced transactions land in the same canonical Finance ledger.</span><div class="fm-control-quick"><button data-viewjump="history">Import statements</button><button data-viewjump="accounts">Manage accounts</button><button data-viewjump="review">Review data</button></div></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Banking Setup & Safety</h2><p>${esc(r.headline||state.openBankProviders?.recommendation?.reason||'Open Banking readiness')} · Fail-closed until provider and production controls are verified.</p></div>${statusBadge(r.overall||'RUNTIME STATUS')}</div><div class="fm-connection-grid">${providerCards||emptyState('No provider configured','Use statement import until an Australian Open Banking provider is configured.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Connected banks</h2><p>Sync controls operate on existing provider consents and preserve historical data when disconnected.</p></div></div>${resourceError('bankConnectionData','Connected banks')}<div class="fm-list">${connectionRows||emptyState('No bank connected','Connect a configured provider or use History Import for complete statement history.')}</div></div></article></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Consent sessions</h2><p>Provider-controlled authorization sessions for the signed-in user.</p></div></div>${resourceError('openBankSessions','Consent sessions')}<div class="fm-list">${sessionRows||emptyState('No consent sessions','Starting a bank connection creates a short-lived consent session.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Sync history</h2><p>Evidence of provider syncs, inserted transactions and duplicate suppression.</p></div></div>${resourceError('bankSyncJobs','Bank sync history')}<div class="fm-list">${syncRows||emptyState('No sync history','No provider sync has run for this user.')}</div></div></article></div>`;
}
async function startBankConsent(provider){
 try{
  const result=await api(I+'/open-banking/consent',{method:'POST',body:JSON.stringify({provider})});
  const url=String(result.consent_url||'');
  if(!/^https:\/\//i.test(url))throw new Error('Provider did not return a secure consent URL.');
  notice(result.message||'Bank consent session created.');
  const opened=window.open(url,'_blank','noopener,noreferrer');
  if(!opened)window.location.assign(url);
  await loadResource('openBankSessions',I+'/open-banking/sessions');
  if(state.view==='connections')render();
 }catch(error){notice(error.message,true)}
}
async function syncBankConnection(uid){
 try{
  const x=await api('/api/integrations/webhooks/banking/connections/'+encodeURIComponent(uid)+'/sync',{method:'POST',body:'{}',timeoutMs:30000});
  notice(x.message||'Bank synchronization started/completed.');
  await Promise.all([loadResource('bankConnectionData','/api/integrations/webhooks/banking/connections'),loadResource('bankSyncJobs','/api/integrations/webhooks/banking/sync-jobs')]);
  if(state.view==='connections')render();
 }catch(error){notice(error.message,true)}
}
async function disconnectBankConnection(uid){
 if(!confirm('Disconnect this bank connection? Existing imported/synced financial history will be preserved.'))return;
 try{
  const x=await api('/api/integrations/webhooks/banking/connections/'+encodeURIComponent(uid)+'/disconnect',{method:'POST',body:'{}'});
  notice(x.message);await refresh();state.view='connections';render();
 }catch(error){notice(error.message,true)}
}
async function cancelBankConsent(uid){
 try{const x=await api(I+'/open-banking/sessions/'+encodeURIComponent(uid)+'/cancel',{method:'POST',body:'{}'});notice(x.message);await loadResource('openBankSessions',I+'/open-banking/sessions');if(state.view==='connections')render()}catch(error){notice(error.message,true)}
}
function settingsView(){
 const caps=state.capabilities?.capabilities||{},st=state.companySettings?.settings||{};
 const companyError=resourceError('companySettings','Company settings');
 const company='<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Company & Reporting Settings</h2><p>These values feed branded financial reports where supported.</p></div><button id="openCompanySettings">Edit</button></div>'+companyError+'<div class="fm-detail-grid"><span>Legal name<b>'+esc(st.company_legal_name||'Voxel Veda Pty Ltd')+'</b></span><span>Trading name<b>'+esc(st.trading_name||'Voxel Veda')+'</b></span><span>ABN<b>'+esc(st.abn||'Not configured')+'</b></span><span>Email<b>'+esc(st.company_email||'Not configured')+'</b></span><span>Website<b>'+esc(st.website||'https://voxelveda.com')+'</b></span><span>Base currency<b>'+esc(st.base_currency||state.setup?.settings?.default_currency||'AUD')+'</b></span><span>Financial year start<b>'+esc(st.financial_year_start||'07-01')+'</b></span><span>GST registration<b>'+esc(st.gst_registration||'UNKNOWN')+'</b></span></div></div></article>';
 return company+userPreferencesCard()+accountingPeriodsCard()+connectionsView()+'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Capability Registry</h2><p>Unsupported workflows are explicitly identified rather than presented as dead buttons.</p></div></div><div class="fm-capability-grid">'+Object.entries(caps).map(([k,v])=>'<div class="fm-capability"><div><b>'+esc(k.replaceAll('_',' '))+'</b><p>'+esc(v.note||'')+'</p></div>'+statusBadge(v.status)+'</div>').join('')+'</div></div></article>';
}
function transfersView(){
 const rows=state.transferCandidates?.candidates||[];
 return `${resourceError('transferCandidates','Transfer candidates')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Transfer Matching</h2><p>Confirm equal opposite movements between permitted accounts. Confirmed pairs remain visible as cash movement but are excluded from income/expense totals.</p></div></div><div class="fm-list">${rows.map(x=>`<div class="fm-row"><div><h3>${esc(x.debit_account)} → ${esc(x.credit_account)}</h3><p>${date(x.debit_date)} / ${date(x.credit_date)} · ${esc(x.debit_description||'')} ↔ ${esc(x.credit_description||'')}</p></div><div class="fm-row-right"><b>${nativeMoney(x.amount,x.currency)}</b><small>${esc(x.confidence)} confidence</small><button type="button" data-transfer-debit="${x.debit_transaction_id}" data-transfer-credit="${x.credit_transaction_id}">Confirm pair</button></div></div>`).join('')||emptyState('No transfer candidates','No unlinked equal opposite account movements were found within five days.')}</div></div></article>`;
}
function refundsView(){
 const rows=state.refundCandidates?.candidates||[];
 return `${resourceError('refundCandidates','Refund candidates')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Refund Review</h2><p>Likely merchant refunds stay separate from ordinary revenue until linked to an original expense.</p></div></div><div class="fm-list">${rows.map(x=>`<div class="fm-row" data-tx="${x.id}"><div><h3>${esc(x.merchant_name||x.description||'Credit')}</h3><p>${date(x.transaction_date)} · ${esc(x.account_name||'')} · ${esc(x.confidence)}</p></div><div class="fm-row-right"><b class="good">${nativeMoney(x.credit,x.currency)}</b><small>${Number(x.linked)?'Linked refund':'Unlinked credit'}</small>${Number(x.linked)?'':`<button type="button" data-refund-link="${x.id}" data-refund-currency="${esc(x.currency)}">Link refund</button>`}</div></div>`).join('')||emptyState('No credit candidates','No visible non-transfer credits are awaiting refund review.')}</div></div></article>`;
}
function reimbursementsView(){
 const rows=state.reimbursements?.reimbursements||[];
 return `${resourceError('reimbursements','Reimbursements')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Reimbursement Lifecycle</h2><p>Employee-paid expenses stay linked to the canonical expense and real settlement transactions.</p></div></div><div class="fm-list">${rows.map(x=>`<div class="fm-row"><div><h3>${esc(x.merchant_name||x.description||'Expense')}</h3><p>${date(x.transaction_date)} · ${esc(x.account_name||'')} · ${esc(x.claimant_name||x.claimant_email||'Claimant #'+x.claimant_user_id)}</p></div><div class="fm-row-right"><b>${nativeMoney(x.remaining_amount,x.currency)} remaining</b><small>${esc(x.status)} · paid ${nativeMoney(x.paid_amount,x.currency)} of ${nativeMoney(x.requested_amount,x.currency)}</small><div class="fm-inline-actions"><button data-reimb-open="${x.id}">View</button>${x.status==='DRAFT'?'<button data-reimb-action="submit" data-reimb-id="'+x.id+'">Submit</button>':''}${x.status==='SUBMITTED'?'<button data-reimb-action="approve" data-reimb-id="'+x.id+'">Approve</button><button class="bad" data-reimb-action="reject" data-reimb-id="'+x.id+'">Reject</button>':''}</div></div></div>`).join('')||emptyState('No reimbursements','Create a reimbursement from an eligible expense transaction.')}</div></div></article>`;
}
function openRefundLink(refundId,currency){
 $('fmModalEyebrow').textContent='REFUND LINK';$('fmModalTitle').textContent='Link refund to original expense';
 $('fmModalBody').innerHTML=`<form id="refundLinkForm" class="fm-form"><label>Original expense transaction ID<input name="expense_id" inputmode="numeric" required></label><label>Amount (${esc(currency)})<input name="amount" inputmode="decimal" placeholder="Leave blank to use available amount"></label><label>Note<textarea name="note"></textarea></label><p class="fm-helper">Cross-currency linking is blocked until verified FX evidence exists.</p><div class="fm-form-actions"><button class="primary">Link refund</button></div></form>`;
 $('fmModal').showModal();$('refundLinkForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/bank-transactions/'+refundId+'/refund-links',{method:'POST',body:JSON.stringify({original_expense_transaction_id:Number(fd.get('expense_id')),linked_amount:fd.get('amount')||undefined,note:fd.get('note')||null})});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}

async function debtDetail(id){
 try{
  const data=await api(API+'/personal-money/debts/'+encodeURIComponent(id)),d=data.debt||{},payments=data.payments||[];
  const paymentRows=payments.map(p=>`<div class="fm-row"><div><h3>${date(p.paid_at)}</h3><p>${esc(p.wallet_name||'No wallet movement')} · ${esc(p.note||'')}</p></div><b>${nativeMoney(p.amount,p.currency||d.currency||'AUD')}</b></div>`).join('');
  openDrawer(d.counterparty||'Borrow / lend',`<div class="fm-grid four"><div class="fm-kpi"><span>Direction</span><strong>${esc(d.direction||'')}</strong></div><div class="fm-kpi"><span>Principal</span><strong>${nativeMoney(d.principal_amount,d.currency||'AUD')}</strong></div><div class="fm-kpi"><span>Outstanding</span><strong>${nativeMoney(d.outstanding_amount,d.currency||'AUD')}</strong></div><div class="fm-kpi"><span>Status</span><strong>${esc(d.status||'')}</strong><small>Due ${date(d.due_date)}</small></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Tracking details</h3><p>Editing these details never changes principal, currency or recorded repayments.</p></div></div><form id="debtDetailForm" class="fm-form"><label>Person / organisation<input name="counterparty" value="${esc(d.counterparty||'')}" required></label><label>Due date<input name="due_date" type="date" value="${esc(String(d.due_date||'').slice(0,10))}"></label><label>Note<textarea name="note">${esc(d.note||'')}</textarea></label><div class="fm-form-actions"><button class="primary">Save details</button>${d.status!=='SETTLED'?'<button type="button" data-debt-detail-pay="'+esc(d.id)+'">Record repayment</button>':''}</div></form></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Repayment history</h3><p>Every recorded repayment remains linked to this debt.</p></div></div><div class="fm-list">${paymentRows||emptyState('No repayments yet','Repayments will appear here after they are recorded.')}</div></div></article>`,'BORROW & LEND');
  setTimeout(()=>{
   $('debtDetailForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());try{const x=await api(API+'/personal-money/debts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(body)});notice(x.message);await refresh();await debtDetail(id)}catch(error){notice(error.message,true)}};
   document.querySelector('[data-debt-detail-pay]')?.addEventListener('click',()=>{closeDrawer();openDebtPayment(id)});
  },0);
 }catch(error){notice(error.message,true)}
}
function openDebtPayment(id){
 const debt=(state.personal?.debts||[]).find(x=>String(x.id)===String(id));
 $('fmModalEyebrow').textContent='BORROW & LEND';$('fmModalTitle').textContent='Record repayment';
 $('fmModalBody').innerHTML='<form id="debtPaymentForm" class="fm-form"><p class="fm-helper">'+esc(debt?.counterparty||'')+' · '+nativeMoney(debt?.outstanding_amount||0,debt?.currency||'AUD')+' remaining</p><label>Amount<input name="amount" inputmode="decimal" required></label><label>Wallet (optional)<select name="wallet_id"><option value="">No wallet movement</option>'+((state.personal?.wallets||[]).filter(w=>!debt||w.currency===debt.currency).map(w=>'<option value="'+esc(w.id)+'">'+esc(w.name)+' · '+esc(w.currency)+'</option>').join(''))+'</select></label><label>Date/time<input name="paid_at" type="datetime-local"></label><label>Note<textarea name="note"></textarea></label><div class="fm-form-actions"><button class="primary">Record repayment</button></div></form>';
 $('fmModal').showModal();
 $('debtPaymentForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/personal-money/debts/'+encodeURIComponent(id)+'/payments',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function openGoalContribution(id){
 const goal=(state.personalAttention?.goals||[]).find(x=>String(x.id)===String(id));
 $('fmModalEyebrow').textContent='SAVINGS GOAL';$('fmModalTitle').textContent='Add goal progress';
 $('fmModalBody').innerHTML='<form id="goalContributionForm" class="fm-form"><p class="fm-helper">'+esc(goal?.name||'Goal')+' · '+nativeMoney(goal?.remaining_amount||0,goal?.currency||'AUD')+' remaining. This updates goal progress only; it does not move bank cash automatically.</p><label>Amount<input name="amount" inputmode="decimal" required></label><label>Date/time<input name="contributed_at" type="datetime-local"></label><label>Note<textarea name="note"></textarea></label><div class="fm-form-actions"><button class="primary">Add progress</button></div></form>';
 $('fmModal').showModal();
 $('goalContributionForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/personal-money/goals/'+encodeURIComponent(id)+'/contributions',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function openBankBudget(){
 $('fmModalEyebrow').textContent='BANKING BUDGET';$('fmModalTitle').textContent='Create or update budget';
 $('fmModalBody').innerHTML='<form id="bankBudgetForm" class="fm-form"><div class="fm-form-grid"><label>Scope<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option><option>MIXED</option><option>UNCLASSIFIED</option><option>ALL</option></select></label><label>Cycle<select name="cycle"><option>WEEKLY</option><option>FORTNIGHTLY</option><option selected>MONTHLY</option></select></label></div><div class="fm-form-grid"><label>Category<input name="category" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label></div><div class="fm-form-grid"><label>Limit<input name="limit_amount" inputmode="decimal" required></label><label>Anchor date<input name="cycle_anchor_date" type="date"></label></div><div class="fm-form-actions"><button class="primary">Save budget</button></div></form>';
 $('fmModal').showModal();
 $('bankBudgetForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(I+'/budgets',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function savedViewsCard(){
 const views=state.savedViews?.saved_views||[];
 return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Saved Views</h2><p>Owner-private search definitions; no transaction snapshots are duplicated.</p></div><button id="saveCurrentView">Save current</button></div><div class="fm-list">'+(views.map(v=>'<div class="fm-row"><div><h3>'+esc(v.name)+'</h3><p>'+esc(v.query_text)+'</p></div><div class="fm-row-right"><button data-saved-open="'+esc(v.id)+'" data-query="'+esc(v.query_text)+'">Open</button><button data-saved-delete="'+esc(v.id)+'">Delete</button></div></div>').join('')||emptyState('No saved views','Save a useful transaction search for quick reuse.'))+'</div></div></article>';
}
function openCompanySettings(){
 const st=state.companySettings?.settings||{},fs=state.setup?.settings||{};
 $('fmModalEyebrow').textContent='FINANCE SETTINGS';$('fmModalTitle').textContent='Company & reporting profile';
 $('fmModalBody').innerHTML='<form id="companySettingsForm" class="fm-form"><div class="fm-form-grid"><label>Legal name<input name="company_legal_name" value="'+esc(st.company_legal_name||'Voxel Veda Pty Ltd')+'"></label><label>Trading name<input name="trading_name" value="'+esc(st.trading_name||'Voxel Veda')+'"></label></div><label>Address<textarea name="company_address">'+esc(st.company_address||'')+'</textarea></label><div class="fm-form-grid"><label>ABN<input name="abn" value="'+esc(st.abn||'')+'"></label><label>Email<input name="company_email" value="'+esc(st.company_email||'')+'"></label></div><div class="fm-form-grid"><label>Phone<input name="support_phone" value="'+esc(st.support_phone||'')+'"></label><label>Website<input name="website" value="'+esc(st.website||'https://voxelveda.com')+'"></label></div><div class="fm-form-grid"><label>Base currency<input name="base_currency" maxlength="3" value="'+esc(st.base_currency||fs.default_currency||'AUD')+'"></label><label>Financial year starts<input name="financial_year_start" placeholder="07-01" value="'+esc(st.financial_year_start||'07-01')+'"></label></div><label>GST registration<select name="gst_registration"><option value="UNKNOWN">Unknown</option><option value="REGISTERED" '+(st.gst_registration==='REGISTERED'?'selected':'')+'>Registered</option><option value="NOT_REGISTERED" '+(st.gst_registration==='NOT_REGISTERED'?'selected':'')+'>Not registered</option></select></label><label>Report footer<input name="report_footer" value="'+esc(st.report_footer||'Confidential Financial Information')+'"></label><p class="fm-helper">Saving company profile requires the existing privileged system-settings permission and step-up verification.</p><div class="fm-form-actions"><button class="primary">Save company profile</button></div></form>';
 $('fmModal').showModal();
 $('companySettingsForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const body=Object.fromEntries(fd.entries());body.base_currency=String(body.base_currency||'AUD').toUpperCase();try{const x=await api('/api/settings',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function receiptsView(){
 const center=state.receiptCenter||{},attached=center.receipts||[],missing=center.missing_receipts||[],exceptions=center.not_required||[],recoverable=center.recoverable_receipts||[],f=state.receiptFilters;
 const attachedRows=attached.map(doc=>`<div class="fm-row"><div><h3>${esc(doc.original_name)}</h3><p>${date(doc.transaction_date)} · ${esc(doc.merchant_name||doc.description||'Transaction')} · ${esc(doc.account_name||'')} · ${esc(doc.scan_status||'')}</p></div><div class="fm-row-right"><a href="${esc(doc.download_url)}" target="_blank" rel="noopener">View</a><button type="button" data-receipt-tx="${doc.bank_transaction_id}">Transaction</button></div></div>`).join('');
 const missingRows=missing.map(tx=>`<div class="fm-row"><div><h3>${esc(tx.merchant_name||tx.description||'Expense')}</h3><p>${date(tx.transaction_date)} · ${esc(tx.account_name||'')} · ${esc(tx.category||'Uncategorised')} · ${esc(tx.policy_source||'')}</p></div><div class="fm-row-right"><b>${nativeMoney(tx.debit,tx.currency)}</b><small>${esc(tx.receipt_status||'MISSING')}</small><div class="fm-inline-actions"><button data-receipt-tx="${tx.bank_transaction_id}">Open</button>${tx.receipt_status!=='REQUESTED'?`<button data-receipt-status="REQUESTED" data-receipt-id="${tx.bank_transaction_id}">Request</button>`:''}<button data-receipt-status="NOT_REQUIRED" data-receipt-id="${tx.bank_transaction_id}">Not required</button></div></div></div>`).join('');
 const exceptionRows=exceptions.map(tx=>`<div class="fm-row"><div><h3>${esc(tx.merchant_name||tx.description||'Expense')}</h3><p>${date(tx.transaction_date)} · ${esc(tx.account_name||'')} · ${esc(tx.reason||'No reason recorded')}</p></div><div class="fm-row-right"><small>NOT REQUIRED</small><div class="fm-inline-actions"><button data-receipt-tx="${tx.bank_transaction_id}">Open</button><button data-receipt-status="MISSING" data-receipt-id="${tx.bank_transaction_id}">Return to queue</button></div></div></div>`).join('');
 const recoverableRows=recoverable.map(doc=>`<div class="fm-row"><div><h3>${esc(doc.original_name)}</h3><p>${date(doc.transaction_date)} · ${esc(doc.merchant_name||doc.description||'Transaction')} · removed ${doc.deleted_at?new Date(doc.deleted_at).toLocaleString('en-AU'):'—'}</p></div><div class="fm-row-right"><button data-receipt-restore="${esc(doc.id)}" data-receipt-id="${doc.bank_transaction_id}">Restore</button></div></div>`).join('');
 return `${resourceError('receiptCenter','Receipts Centre')}<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Receipt Review</h2><p>${esc(center.policy?.note||'Receipt requirements are policy-driven and reviewable.')}</p></div><div class="fm-inline-actions"><span class="fm-badge good">${num(center.counts?.attached)} attached</span><span class="fm-badge warn">${num(center.counts?.requested)} requested</span><span class="fm-badge warn">${num(center.counts?.missing)} missing</span></div></div><form id="receiptFilterForm" class="fm-filter-grid"><input name="q" value="${esc(f.q)}" placeholder="Search receipt or transaction"><select name="account_id"><option value="">All accounts</option>${state.accounts.map(a=>`<option value="${a.id}" ${String(f.account_id)===String(a.id)?'selected':''}>${esc(a.nickname||a.account_name||'Account')}</option>`).join('')}</select><input name="merchant" value="${esc(f.merchant)}" placeholder="Merchant"><input name="category" value="${esc(f.category)}" placeholder="Category"><input name="from" type="date" value="${esc(f.from)}" aria-label="Receipt from date"><input name="to" type="date" value="${esc(f.to)}" aria-label="Receipt to date"><input name="amount_min" inputmode="decimal" value="${esc(f.amount_min)}" placeholder="Minimum amount"><select name="receipt_status"><option value="ALL">All statuses</option><option value="ATTACHED" ${f.receipt_status==='ATTACHED'?'selected':''}>Attached</option><option value="MISSING" ${f.receipt_status==='MISSING'?'selected':''}>Missing</option><option value="REQUESTED" ${f.receipt_status==='REQUESTED'?'selected':''}>Requested</option><option value="NOT_REQUIRED" ${f.receipt_status==='NOT_REQUIRED'?'selected':''}>Not required</option></select><label class="fm-check"><input name="tax_relevant" type="checkbox" ${f.tax_relevant?'checked':''}> GST relevant</label><button class="fm-primary">Apply</button></form></div></article><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Receipt Vault</h2><p>Private, malware-scanned attachments served through authenticated download routes.</p></div></div><div class="fm-list">${attachedRows||emptyState('No matching receipts','Open a transaction to capture or upload a receipt.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Missing & Requested</h2><p>Only explicit requests and company expenses meeting the configured amount policy enter this queue.</p></div></div><div class="fm-list">${missingRows||emptyState('No matching receipt actions','No visible transaction currently meets the selected receipt policy.')}</div></div></article></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Not Required</h2><p>Reviewed exceptions remain visible and auditable.</p></div><span class="fm-badge">${num(center.counts?.not_required)}</span></div><div class="fm-list">${exceptionRows||emptyState('No exceptions','No transaction has been marked not required.')}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Controlled Recovery</h2><p>Soft-deleted receipts can be restored with step-up verification.</p></div><span class="fm-badge">${num(center.counts?.recoverable)}</span></div><div class="fm-list">${recoverableRows||emptyState('Nothing to recover','No receipt is awaiting controlled recovery.')}</div></div></article></div>`;
}
async function loadReceiptCenter(){
 setResource('receiptCenter','loading');render();
 const data=await loadResource('receiptCenter',API+'/receipts'+receiptQuery());state.receiptCenter=data||null;render();
}

function setupCentreView(){
 const accounts=state.accounts||[],statements=state.statements||[],pending=state.reviews.filter(x=>x.status==='PENDING_REVIEW');
 const quality=state.quality||{},receiptCounts=state.receiptCenter?.counts||{},saved=state.savedReports?.saved_reports||[];
 const personalAccounts=accounts.filter(a=>a.ownership_scope==='PERSONAL'),businessAccounts=accounts.filter(a=>a.ownership_scope==='BUSINESS');
 const coverage=Array.isArray(state.history?.accounts)?state.history.accounts:[];
 const coveredAccounts=accounts.filter(a=>{const c=coverage.find(x=>String(x.id||x.bank_account_id)===String(a.id));return Boolean(c?.transaction_start||a.history_start_date)});
 const steps=[
  {key:'accounts',label:'Create every real account',done:accounts.length>0,note:accounts.length?accounts.length+' account(s) created':'Add bank, savings, card, cash and loan accounts',action:'accounts'},
  {key:'ownership',label:'Separate Personal and Company',done:accounts.length>0&&accounts.every(a=>['PERSONAL','BUSINESS','MIXED'].includes(String(a.ownership_scope||''))),note:personalAccounts.length+' personal · '+businessAccounts.length+' company',action:'accounts'},
  {key:'history',label:'Load historical statements',done:accounts.length>0&&coveredAccounts.length===accounts.length,note:coveredAccounts.length+' of '+accounts.length+' account(s) have history coverage',action:'history'},
  {key:'review',label:'Commit statement reviews',done:pending.length===0&&statements.length>0,note:pending.length?pending.length+' review(s) still pending':statements.length+' statement(s) committed',action:'statements'},
  {key:'classification',label:'Classify imported transactions',done:num(quality.unclassified_transactions??quality.unclassified)===0,note:num(quality.unclassified_transactions??quality.unclassified)+' uncategorised',action:'review'},
  {key:'reconcile',label:'Review reconciliation',done:num(quality.unreconciled_transactions??quality.unreconciled)===0,note:num(quality.unreconciled_transactions??quality.unreconciled)+' unreconciled',action:'reconciliation'},
  {key:'receipts',label:'Resolve receipt evidence',done:num(receiptCounts.missing)===0&&num(receiptCounts.requested)===0,note:num(receiptCounts.missing)+' missing · '+num(receiptCounts.requested)+' requested',action:'receipts'},
  {key:'report',label:'Create a reusable report',done:saved.length>0,note:saved.length?saved.length+' saved report(s)':'Save at least one reporting definition',action:'reports'}
 ];
 const completed=steps.filter(s=>s.done).length,percent=Math.round((completed/steps.length)*100);
 const stepRows=steps.map((s,i)=>`<button class="fm-setup-step ${s.done?'done':''}" data-viewjump="${s.action}"><span class="fm-setup-index">${s.done?'✓':i+1}</span><div><b>${esc(s.label)}</b><small>${esc(s.note)}</small></div><i>›</i></button>`).join('');
 const accountRows=accounts.map(a=>{const c=coverage.find(x=>String(x.id||x.bank_account_id)===String(a.id))||{};const covered=c.transaction_start||a.history_start_date;return `<div class="fm-row"><div><h3>${esc(a.nickname||'Account')}</h3><p>${esc(a.institution||'Manual')} · ${esc(a.account_type||'Account')} · ${esc(a.currency||'AUD')}</p></div><div class="fm-row-right">${statusBadge(a.ownership_scope||'UNCLASSIFIED')}<small>${covered?'History '+date(c.transaction_start||a.history_start_date)+' → '+date(c.transaction_end||a.history_end_date):'No history loaded'}</small><button data-account-edit="${a.id}">Edit</button><button data-history-import="${a.id}">Import</button></div></div>`}).join('');
 return `<section class="fm-setup-hero"><div><p>FINANCE DATA MIGRATION</p><h2>${percent}% setup complete</h2><span>This is the controlled path from scattered bank statements to one trusted Finance OS. No step silently fabricates balances, classifications or FX rates.</span></div><div class="fm-setup-ring" style="--progress:${percent}"><strong>${percent}%</strong><small>${completed}/${steps.length} controls</small></div></section><div class="fm-setup-grid"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Migration checklist</h2><p>Complete these in order to make reports reliable.</p></div></div><div class="fm-setup-list">${stepRows}</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Account migration map</h2><p>Each bank/card/cash account remains independently traceable even when Consolidated reporting is selected.</p></div><button data-quick="account">+ Add account</button></div><div class="fm-list">${accountRows||emptyState('No accounts yet','Create every real account before importing historical statements.')}</div></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>What happens to your old data</h2><p>Statement rows are staged first. Duplicate or rejected rows do not enter the ledger. Committed source data stays preserved separately from editable category, ownership, receipt and reconciliation decisions.</p></div></div><div class="fm-grid four"><div class="fm-kpi"><span>Accounts</span><strong>${accounts.length}</strong><small>Real financial containers</small></div><div class="fm-kpi"><span>Committed statements</span><strong>${statements.length}</strong><small>Historical source files</small></div><div class="fm-kpi"><span>Pending reviews</span><strong>${pending.length}</strong><small>Not yet committed</small></div><div class="fm-kpi"><span>Ledger transactions</span><strong>${num(state.txMeta?.total)}</strong><small>Current filtered view count</small></div></div><div class="fm-form-actions"><button class="primary" data-viewjump="history">Continue historical import</button><button data-viewjump="review">Open data-quality review</button><button data-viewjump="reports">Open Report Centre</button></div></div></article>`;
}
function moreView(){
 const groups=NAV_GROUPS.map(([group,items])=>{
  const filtered=items.filter(([view])=>!['overview','accounts','transactions','statements'].includes(view));
  if(!filtered.length)return '';
  return `<section class="fm-module-group"><header><small>${esc(group)}</small></header><div class="fm-module-grid">${filtered.map(([view,icon,label])=>{
   const [heading,description]=title(view);
   return `<button class="fm-module-card" data-viewjump="${view}"><span>${icon}</span><div><b>${esc(label)}</b><small>${esc(description)}</small></div><i>›</i></button>`;
  }).join('')}</div></section>`;
 }).join('');
 return `<div class="fm-control-intro"><p>ONE FINANCE OPERATING SYSTEM</p><h2>All finance modules</h2><span>No separate Banking V3/V4/V5 screens. Every workflow below opens inside the same Finance OS and uses the same canonical data.</span><div class="fm-control-quick"><button data-viewjump="history">Import history</button><button data-quick="expense">Add expense</button><button data-quick="income">Add income</button><button data-viewjump="reports">Build report</button></div></div>${groups}`;
}
function simpleView(v){
 if(v==='more')return moreView();
 if(v==='setupcentre')return setupCentreView();
 if(v==='history')return historyImportView();
 if(v==='budgets')return budgetsView();
 if(['savings','debt','recurring'].includes(v))return personalCard(v);
 if(v==='reports')return reportView();
 if(v==='forecast')return forecastView();
 if(v==='calendar')return calendarView();
 if(v==='receipts')return receiptsView();
 if(v==='review')return reviewView();
 if(v==='personal')return personalView();
 if(v==='company')return companyView();
 if(v==='consolidated')return consolidatedView();
 if(v==='bankops')return bankingOperationsView();
 if(v==='cash')return cashView();
 if(v==='currency')return currencyView();
 if(v==='transfers')return transfersView();
 if(v==='refunds')return refundsView();
 if(v==='reimbursements')return reimbursementsView();
 if(v==='insights')return insightsView();
 if(v==='rules')return rulesView();
 if(v==='reconciliation')return reconciliationView();
 if(v==='notifications')return notificationsView();
 if(v==='team')return teamView();
 if(v==='connections')return connectionsView();
 return settingsView();
}
function reportSpecificPreview(result){
 if(!result)return '';
 const type=result.metadata?.report_type||'';
 if(['CASH_FLOW','INCOME_VS_EXPENSE','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY'].includes(type)){
  const rows=(result.monthly||[]).map(r=>'<div class="fm-row"><div><h3>'+esc(r.month)+' · '+esc(r.currency)+'</h3><p>'+num(r.transaction_count)+' transaction(s)</p></div><div class="fm-row-right"><b>'+nativeMoney(r.net_cash_flow,r.currency)+'</b><small>in '+nativeMoney(r.money_in,r.currency)+' · out '+nativeMoney(r.money_out,r.currency)+'</small></div></div>').join('');
  return '<article class="fm-card"><div class="fm-pad"><h2>Monthly cash-flow detail</h2><div class="fm-list">'+(rows||emptyState('No monthly activity','No matching monthly activity.'))+'</div></div></article>';
 }
 if(type==='GST_SUMMARY'){
  const rows=(result.gst_summary||[]).map(r=>'<div class="fm-row"><div><h3>'+esc(r.gst_treatment)+' · '+esc(r.currency)+'</h3><p>'+num(r.transaction_count)+' transaction(s) · gross expense '+nativeMoney(r.gross_expense,r.currency)+'</p></div><b>'+nativeMoney(r.recorded_split_gst,r.currency)+' recorded GST</b></div>').join('');
  return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>GST review summary</h2><p>Only recorded/reviewed split GST is shown. No GST is invented.</p></div></div><div class="fm-list">'+(rows||emptyState('No GST review data','No matching GST treatments were recorded.'))+'</div></div></article>';
 }
 if(type==='REIMBURSEMENT'){
  const rows=(result.reimbursements||[]).map(r=>'<div class="fm-row"><div><h3>'+esc(r.merchant_name||r.description||r.reimbursement_uid)+'</h3><p>'+date(r.transaction_date)+' · '+esc(r.account_name||'')+' · '+esc(r.status)+'</p></div><div class="fm-row-right"><b>'+nativeMoney(r.remaining_amount,r.currency)+' remaining</b><small>requested '+nativeMoney(r.requested_amount,r.currency)+' · paid '+nativeMoney(r.paid_amount,r.currency)+'</small></div></div>').join('');
  return '<article class="fm-card"><div class="fm-pad"><h2>Reimbursement lifecycle</h2><div class="fm-list">'+(rows||emptyState('No reimbursements','No matching reimbursements.'))+'</div></div></article>';
 }
 if(type==='RECONCILIATION'){
  const rows=Object.entries(result.reconciliation_summary||{}).map(([k,v])=>'<div class="fm-kpi"><span>'+esc(k)+'</span><strong>'+num(v)+'</strong><small>transaction(s)</small></div>').join('');
  return '<article class="fm-card"><div class="fm-pad"><h2>Reconciliation summary</h2><div class="fm-grid four">'+(rows||'<div class="fm-kpi"><span>Reconciliation</span><strong>—</strong></div>')+'</div></div></article>';
 }
 if(type==='DATA_QUALITY'){
  const q=result.data_quality||{};
  return '<article class="fm-card"><div class="fm-pad"><h2>Data quality controls</h2><div class="fm-grid four">'+[['Unclassified',q.unclassified],['Ownership missing',q.ownership_unclassified],['Unreconciled',q.unreconciled],['Missing receipts',q.missing_receipts],['Unreviewed',q.unreviewed],['Coverage',q.coverage_status]].map(([l,v])=>'<div class="fm-kpi"><span>'+esc(l)+'</span><strong>'+esc(v??0)+'</strong></div>').join('')+'</div></div></article>';
 }
 if(type==='ACCOUNT_STATEMENT'&&result.account_statement){
  const a=result.account_statement;
  return '<article class="fm-card"><div class="fm-pad"><div class="fm-grid four"><div class="fm-kpi"><span>Account</span><strong>'+esc(a.account_name||'—')+'</strong></div><div class="fm-kpi"><span>Currency</span><strong>'+esc(a.currency||'—')+'</strong></div><div class="fm-kpi"><span>Opening running balance</span><strong>'+(a.opening_running_balance===null?'—':nativeMoney(a.opening_running_balance,a.currency))+'</strong></div><div class="fm-kpi"><span>Closing running balance</span><strong>'+(a.closing_running_balance===null?'—':nativeMoney(a.closing_running_balance,a.currency))+'</strong></div></div></div></article>';
 }
 return '';
}
function reportView(){
 const range=dateRange(),saved=state.savedReports?.saved_reports||[],result=state.reportResult;
 const presets=[
  ['TRANSACTION_REGISTER','Transaction Register','Every permission-scoped transaction'],
  ['INCOME_VS_EXPENSE','Income vs Expense','Compare operating money in and out'],
  ['CASH_FLOW','Cash Flow','Cash movement by native currency'],
  ['ACCOUNT_STATEMENT','Account Statement','Bank-style account activity'],
  ['CATEGORY','Category Analysis','Where money was spent'],
  ['MERCHANT','Merchant Analysis','Who money went to / came from'],
  ['CASH','Cash Report','Cash-only activity'],
  ['TRANSFER','Transfers','Internal account movements'],
  ['REFUND','Refunds','Linked merchant refunds'],
  ['REIMBURSEMENT','Reimbursements','Employee-paid expense lifecycle'],
  ['GST_SUMMARY','GST Summary','GST review-oriented output'],
  ['RECONCILIATION','Reconciliation','Reconciliation status evidence'],
  ['DATA_QUALITY','Data Quality','Classification and evidence quality'],
  ['PERSONAL_MONTHLY_SUMMARY','Personal Monthly','Owner-only personal summary'],
  ['COMPANY_MONTHLY_SUMMARY','Company Monthly','Voxel Veda business summary']
 ];
 const presetCards='<div class="fm-report-catalogue">'+presets.map(([type,label,note])=>'<button class="fm-report-preset" data-report-preset="'+type+'"><b>'+label+'</b><small>'+note+'</small><span>›</span></button>').join('')+'</div>';

 const currencies=[...new Set(state.accounts.map(a=>String(a.currency||'AUD').toUpperCase()))].sort();
 const accountOptions=state.accounts.map(a=>'<option value="'+a.id+'" '+(String(a.id)===String(state.account)?'selected':'')+'>'+esc(a.nickname||'Account')+' · '+esc(a.currency||'AUD')+' · '+esc(a.ownership_scope||'')+'</option>').join('');
 const savedRows=saved.map(r=>'<div class="fm-row"><div><h3>'+esc(r.name)+'</h3><p>'+esc(r.report_type)+' · updated '+date(r.updated_at)+'</p></div><div class="fm-row-right"><button data-report-run="'+esc(r.report_uid)+'">Run</button><button data-report-delete="'+esc(r.report_uid)+'">Delete</button></div></div>').join('');
 const summaryRows=(result?.summary_by_currency||[]).map(x=>'<div class="fm-kpi"><span>'+esc(x.currency)+' · Money in</span><strong>'+nativeMoney(x.money_in,x.currency)+'</strong><small>Ordinary '+nativeMoney(x.ordinary_money_in,x.currency)+' · refunds '+nativeMoney(x.linked_refund_inflow,x.currency)+'</small></div><div class="fm-kpi"><span>'+esc(x.currency)+' · Money out</span><strong>'+nativeMoney(x.money_out,x.currency)+'</strong><small>Net cash flow '+nativeMoney(x.net_cash_flow,x.currency)+'</small></div>').join('');
 const txRows=(result?.transactions||[]).slice(0,100).map(t=>'<tr><td>'+date(t.transaction_date)+'</td><td>'+esc(t.account_name||'')+'</td><td>'+esc(t.merchant_name||t.description||'')+'</td><td>'+esc(t.category||'Uncategorised')+'</td><td>'+esc(t.currency||'')+'</td><td>'+(num(t.debit)?nativeMoney(t.debit,t.currency):'')+'</td><td>'+(num(t.credit)?nativeMoney(t.credit,t.currency):'')+'</td><td>'+esc(t.reconciliation_status||'')+'</td><td>'+(Number(t.has_receipt)?'Attached':'Missing')+'</td></tr>').join('');
 const results=result?'<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Generated Report</h2><p>'+num(result.metadata?.source_transaction_count)+' source transaction(s) · '+esc(result.metadata?.currency_treatment||'Native currencies')+'</p></div></div><div class="fm-grid four">'+(summaryRows||'<div class="fm-kpi"><span>Result</span><strong>—</strong><small>No financial activity for these filters.</small></div>')+'</div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>Date</th><th>Account</th><th>Merchant / Description</th><th>Category</th><th>Currency</th><th>Debit</th><th>Credit</th><th>Reconciliation</th><th>Receipt</th></tr></thead><tbody>'+txRows+'</tbody></table></div><p class="fm-helper">Preview shows up to 100 rows. CSV/XLSX exports use the complete permission-scoped result returned by the report endpoint.</p></div></article>':'';
 return '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Standard Report Catalogue</h2><p>One-click starting points. Every report can still be narrowed by workspace, account, period, category, merchant and evidence status.</p></div></div>'+presetCards+'</div></article><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Advanced Report Centre</h2><p>Uses the same Trusted Totals and permission-scoped bank ledger as the dashboard.</p></div></div><form id="reportBuilderForm" class="fm-form"><div class="fm-form-grid"><label>Workspace<select name="scope"><option value="ALL" '+(state.scope==='ALL'?'selected':'')+'>Consolidated</option><option value="PERSONAL" '+(state.scope==='PERSONAL'?'selected':'')+'>Personal</option><option value="BUSINESS" '+(state.scope==='BUSINESS'?'selected':'')+'>Company</option></select></label><label>Report type<select name="report_type"><option>TRANSACTION_REGISTER</option><option>INCOME</option><option>EXPENSE</option><option>INCOME_VS_EXPENSE</option><option>CASH_FLOW</option><option>ACCOUNT_ACTIVITY</option><option>ACCOUNT_STATEMENT</option><option>CATEGORY</option><option>MERCHANT</option><option>CASH</option><option>TRANSFER</option><option>REFUND</option><option>REIMBURSEMENT</option><option>GST_SUMMARY</option><option>RECONCILIATION</option><option>DATA_QUALITY</option><option>PERSONAL_MONTHLY_SUMMARY</option><option>COMPANY_MONTHLY_SUMMARY</option></select></label></div><label>Accounts<select id="reportAccounts" name="account_ids" multiple size="5">'+accountOptions+'</select><small>Select none for all permitted accounts. Use Ctrl/Cmd to select multiple.</small></label><div class="fm-form-grid"><label>From<input name="from" type="date" value="'+esc(range.from||'')+'"></label><label>To<input name="to" type="date" value="'+esc(range.to||'')+'"></label></div><div class="fm-form-grid"><label>Native currency filter<select name="currency"><option value="">All native currencies</option>'+currencies.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label><label>Transaction type<select name="transaction_type"><option value="">All</option><option>INCOME</option><option>EXPENSE</option><option>TRANSFER</option><option>REFUND</option></select></label></div><div class="fm-form-grid"><label>Category<input name="category" placeholder="e.g. Office Supplies"></label><label>Merchant<input name="merchant" placeholder="e.g. Officeworks"></label></div><div class="fm-form-grid"><label>Source<select name="source"><option value="">All</option><option>STATEMENT_IMPORT</option><option>MANUAL</option><option>OPEN_BANKING</option><option>API_IMPORT</option></select></label><label>Reconciliation<select name="reconciliation_status"><option value="">All active</option><option>UNRECONCILED</option><option>RECONCILED</option><option>IGNORED</option></select></label></div><div class="fm-form-grid"><label>Receipt status<select name="receipt_status"><option value="">All</option><option>ATTACHED</option><option>MISSING</option></select></label><label>Search<input name="q" placeholder="Description, reference, account"></label></div><div class="fm-form-actions"><button class="primary" type="submit">Generate</button><button type="button" id="reportPdf">PDF</button><button type="button" id="reportCsv">CSV</button><button type="button" id="reportXlsx">XLSX</button><button type="button" id="reportSave">Save report</button></div></form><p class="fm-helper">Currencies are never converted or relabelled. Selecting a currency filters to that native currency; mixed currencies remain separate.</p></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Saved Reports</h2><p>Definitions are private to the signed-in user and can be rerun against current data.</p></div></div><div class="fm-list">'+(savedRows||emptyState('No saved reports','Build a report and save its filter definition for later.'))+'</div><hr><div class="fm-card-head"><div><h2>Company Accounting Exports</h2><p>Accounting-period outputs remain separate from filtered bank-ledger reports.</p></div></div><div class="fm-quick-grid"><button class="fm-quick" data-export="/api/finance/exports/accountant-review.pdf"><span>PDF</span><b>Accountant Review</b><small>Branded every page</small></button><button class="fm-quick" data-export="/api/finance/exports/trial-balance.csv"><span>CSV</span><b>Trial Balance</b><small>Canonical accounting ledger</small></button></div></div></article></div>'+reportSpecificPreview(result)+results;
}
function reportDefinitionFromUi(){
 const form=$('reportBuilderForm');if(!form)return null;
 const fd=new FormData(form),accounts=[...$('reportAccounts').selectedOptions].map(o=>Number(o.value)).filter(Boolean);
 const reportType=String(fd.get('report_type')||'TRANSACTION_REGISTER').toUpperCase();
 const impliedType=['INCOME','EXPENSE','TRANSFER','REFUND'].includes(reportType)?reportType:'';
 return {
  report_type:reportType,scope:fd.get('scope')||'ALL',account_ids:accounts,from:fd.get('from')||'',to:fd.get('to')||'',
  currency:fd.get('currency')||'',transaction_type:fd.get('transaction_type')||impliedType,category:String(fd.get('category')||'').trim(),
  merchant:String(fd.get('merchant')||'').trim(),source:fd.get('source')||'',reconciliation_status:fd.get('reconciliation_status')||'',
  receipt_status:fd.get('receipt_status')||'',q:String(fd.get('q')||'').trim()
 };
}
function reportQuery(def){
 const p=new URLSearchParams();Object.entries(def||{}).forEach(([k,v])=>{if(Array.isArray(v)){if(v.length)p.set(k,v.join(','))}else if(v!==undefined&&v!==null&&v!=='')p.set(k,v)});
 return p.toString();
}
async function generateBuiltReport(){
 const def=reportDefinitionFromUi();if(!def)return null;
 const result=await api(API+'/reports/builder?'+reportQuery(def));state.reportResult=result;render();return result;
}
async function saveBuiltReport(){
 const def=reportDefinitionFromUi();if(!def)return;
 const name=prompt('Saved report name:');if(!name)return;
 const type=$('reportBuilderForm')?.elements?.report_type?.value||'TRANSACTION_REGISTER';
 const x=await api(API+'/reports/saved',{method:'POST',body:JSON.stringify({name,report_type:type,definition:def})});notice(x.message);await refresh();state.view='reports';render();
}
async function exportBuiltReportXlsx(){
 const def=reportDefinitionFromUi();if(!def)return;
 location.href=API+'/reports/builder.xlsx?'+reportQuery(def);
}

function reviewView(){
 const q=state.quality||{},ins=state.insights?.summary||{},archived=state.archivedTransactions?.archived_transactions||[];
 const cards=[['Uncategorised',q.unclassified_transactions??q.unclassified,'transactions'],['Unreconciled',q.unreconciled_transactions??q.unreconciled,'reconciliation'],['Ownership missing',q.ownership_missing,'transactions'],['Unknown history coverage',q.unknown_history_coverage,'accounts'],['Transfer candidates',ins.transfer_candidates,'insights'],['Category suggestions',ins.category_suggestions,'insights'],['Anomalies',ins.anomalies,'insights'],['Archived transactions',archived.length,'review']];
 const archivedRows=archived.map(x=>'<div class="fm-row"><div><h3>'+esc(x.merchant_name||x.description||'Archived transaction')+'</h3><p>'+date(x.transaction_date)+' · '+esc(x.account_name||'')+' · '+esc(x.archive_reason||'Archived')+'</p></div><div class="fm-row-right"><b>'+nativeMoney(Math.abs(num(x.credit)-num(x.debit)),x.currency||'AUD')+'</b><small>Archived '+date(x.archived_at)+'</small><button data-archived-open="'+x.id+'">View</button><button data-transaction-restore="'+x.id+'">Restore</button></div></div>').join('');
 return resourceError('quality','Data Quality')+'<div class="fm-grid four">'+cards.map(([l,n,v])=>'<button class="fm-kpi fm-kpi-button" data-viewjump="'+v+'"><span>'+esc(l)+'</span><strong>'+num(n)+'</strong><small>Open underlying queue</small></button>').join('')+'</div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Review Centre</h2><p>Quality metrics open the underlying data rather than hiding issues behind a score.</p></div></div><div class="fm-list">'+((state.personalAttention?.alerts||[]).slice(0,12).map(x=>'<div class="fm-row"><div><h3>'+esc(x.title)+'</h3><p>'+esc(x.explanation||'')+'</p></div>'+statusBadge(x.severity)+'</div>').join('')||emptyState('No personal attention alerts','No current owner-only alerts were returned.'))+'</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h2>Deleted / Archived Transactions</h2><p>Recoverable logical deletion. Wrong manual entries and archived bank records stay here with source evidence preserved.</p></div></div><div class="fm-list">'+(archivedRows||emptyState('No archived transactions','Archived transactions will appear here for controlled restoration.'))+'</div></div></article></div>';
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

let pdfJsLoadPromise=null;
function loadPdfJs(){
  if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(pdfJsLoadPromise)return pdfJsLoadPromise;
  pdfJsLoadPromise=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-finance-pdfjs]');
    const script=existing||document.createElement('script');
    let settled=false;
    const finish=(error)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(error){
        pdfJsLoadPromise=null;
        reject(error);
        return;
      }
      if(!window.pdfjsLib){
        pdfJsLoadPromise=null;
        reject(new Error('PDF parser loaded without exposing PDF.js.'));
        return;
      }
      resolve(window.pdfjsLib);
    };
    const timer=setTimeout(()=>finish(new Error('PDF parser timed out. Use CSV/OFX or try the PDF again.')),10000);
    script.addEventListener('load',()=>finish(),{once:true});
    script.addEventListener('error',()=>finish(new Error('PDF parser could not be downloaded. Use CSV/OFX or try again when the network is stable.')),{once:true});
    if(!existing){
      script.src='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      script.async=true;
      script.dataset.financePdfjs='1';
      document.head.appendChild(script);
    }
  });
  return pdfJsLoadPromise;
}
async function pdfLines(file) {
  const pdfjsLib=await loadPdfJs();
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
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
 state.selectedTransactions.clear();
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
 $('fmModalTitle').textContent=kind==='wallet'?'New personal wallet':kind==='budgets'?'New budget':kind==='savings'?'New savings goal':kind==='debt'?'Borrow / lend':kind==='recurring'?'Recurring item':'Cash movement';
 if(kind==='wallet')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Wallet name<input name="name" placeholder="Cash, Personal AUD, Travel INR..." required></label><div class="fm-form-grid"><label>Currency<input name="currency" value="AUD" maxlength="3" required></label><label>Opening balance<input name="opening_balance" inputmode="decimal" value="0"></label></div><p class="fm-helper">Personal wallets are owner-only and never merged into Voxel Veda company balances.</p><div class="fm-form-actions"><button class="primary">Create wallet</button></div></form>`;
 else if(kind==='budgets')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Month<input name="month_start" type="month" required></label><label>Category<input name="category" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label><label>Budget limit<input name="limit_amount" inputmode="decimal" required></label><div class="fm-form-actions"><button class="primary">Save budget</button></div></form>`;
 else if(kind==='savings')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Name<input name="name" required></label><label>Target amount<input name="target_amount" required></label><label>Current amount<input name="current_amount" value="0"></label><label>Currency<input name="currency" value="AUD"></label><label>Target date<input name="target_date" type="date"></label><label>Priority<select name="priority"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option></select></label><div class="fm-form-actions"><button class="primary">Create goal</button></div></form>`;
 else if(kind==='debt')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Direction<select name="direction"><option value="BORROWED">I borrowed</option><option value="LENT">I lent</option></select></label><label>Person / entity<input name="counterparty" required></label><label>Amount<input name="principal_amount" required></label><label>Currency<input name="currency" value="AUD"></label><label>Due date<input name="due_date" type="date"></label><label>Note<textarea name="note"></textarea></label><div class="fm-form-actions"><button class="primary">Save</button></div></form>`;
 else if(kind==='recurring')$('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Name<input name="name" required></label><label>Type<select name="item_type"><option>BILL</option><option>SUBSCRIPTION</option><option>INCOME</option></select></label><label>Amount<input name="amount" required></label><label>Currency<input name="currency" value="AUD"></label><label>Frequency<select name="frequency"><option>WEEKLY</option><option>FORTNIGHTLY</option><option selected>MONTHLY</option><option>QUARTERLY</option><option>YEARLY</option></select></label><label>Next due<input name="next_due_date" type="date" required></label><div class="fm-form-actions"><button class="primary">Save recurring item</button></div></form>`;
 else $('fmModalBody').innerHTML=`<form id="personalForm" class="fm-form"><label>Wallet<select name="wallet_id" required><option value="">Choose wallet</option>${wallets.map(w=>`<option value="${w.id}">${esc(w.name)} · ${esc(w.currency)}</option>`).join('')}</select></label><div class="fm-form-grid"><label>Type<select name="entry_type"><option>EXPENSE</option><option>INCOME</option><option>CASH_OUT</option><option>CASH_IN</option></select></label><label>Amount<input name="amount" inputmode="decimal" required></label></div><div class="fm-form-grid"><label>Transaction currency<input name="currency" value="${esc(wallets[0]?.currency||'AUD')}" maxlength="3"></label><label>FX to wallet<input name="fx_rate_to_wallet" inputmode="decimal" placeholder="Only if currency differs"></label></div><div class="fm-form-grid"><label>Category<input name="category"></label><label>Counterparty<input name="counterparty"></label></div><label>Note<textarea name="note"></textarea></label><label>Date/time<input name="occurred_at" type="datetime-local"></label><p class="fm-helper">If transaction currency differs from the selected wallet currency, enter the explicit conversion rate. Finance never invents an FX rate.</p><div class="fm-form-actions"><button class="primary">Record movement</button></div></form>`;
 $('fmModal').showModal();
 $('personalForm').onsubmit=async e=>{
  e.preventDefault();const fd=new FormData(e.currentTarget);let path=API+'/personal-money/entries',body=Object.fromEntries(fd.entries());
  if(kind==='wallet')path=API+'/personal-money/wallets';else if(kind==='budgets'){path=API+'/personal-money/budgets';body.month_start=(body.month_start||'')+'-01'}else if(kind==='savings')path=API+'/personal-money/goals';else if(kind==='debt')path=API+'/personal-money/debts';else if(kind==='recurring')path=API+'/personal-money/recurring';
  try{await api(path,{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice('Saved.');await refresh()}catch(error){notice(error.message,true)}
 };
}


function openDebtPaymentForm(id){
 const debt=(state.personal?.debts||[]).find(x=>String(x.id)===String(id));if(!debt)return;
 const wallets=(state.personal?.wallets||[]).filter(w=>w.currency===debt.currency);
 $('fmModalEyebrow').textContent='BORROW & LEND';$('fmModalTitle').textContent='Record debt payment';
 $('fmModalBody').innerHTML='<form id="debtPaymentForm" class="fm-form"><p class="fm-helper">Remaining '+nativeMoney(debt.outstanding_amount,debt.currency)+' with '+esc(debt.counterparty)+'.</p><label>Amount<input name="amount" inputmode="decimal" required></label><label>Wallet (optional)<select name="wallet_id"><option value="">Do not change wallet balance</option>'+wallets.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.name)+' · '+esc(w.currency)+'</option>').join('')+'</select></label><label>Paid date<input name="paid_at" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Note<textarea name="note"></textarea></label><div class="fm-form-actions"><button class="primary">Record payment</button></div></form>';
 $('fmModal').showModal();$('debtPaymentForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/personal-money/debts/'+encodeURIComponent(id)+'/payments',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function openGoalContributionForm(id){
 const goal=(state.personalAttention?.goals||[]).find(x=>String(x.id)===String(id));if(!goal)return;
 $('fmModalEyebrow').textContent='SAVINGS GOAL';$('fmModalTitle').textContent='Add goal progress';
 $('fmModalBody').innerHTML='<form id="goalContributionForm" class="fm-form"><p class="fm-helper">Remaining '+nativeMoney(goal.remaining_amount,goal.currency)+'. This updates goal progress only; no wallet balance is moved automatically.</p><label>Contribution<input name="amount" inputmode="decimal" required></label><label>Date<input name="contributed_at" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Note<textarea name="note"></textarea></label><div class="fm-form-actions"><button class="primary">Add progress</button></div></form>';
 $('fmModal').showModal();$('goalContributionForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/personal-money/goals/'+encodeURIComponent(id)+'/contributions',{method:'POST',body:JSON.stringify(Object.fromEntries(fd.entries()))});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function openBankingBudgetForm(){
 $('fmModalEyebrow').textContent='BANKING BUDGET';$('fmModalTitle').textContent='Create or update banking budget';
 $('fmModalBody').innerHTML='<form id="bankBudgetForm" class="fm-form"><label>Workspace<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option><option>MIXED</option><option>ALL</option></select></label><label>Category<input name="category" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label><label>Cycle<select name="cycle"><option>WEEKLY</option><option>FORTNIGHTLY</option><option selected>MONTHLY</option></select></label><label>Anchor date<input name="cycle_anchor_date" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Limit<input name="limit_amount" inputmode="decimal" required></label><div class="fm-form-actions"><button class="primary">Save budget</button></div></form>';
 $('fmModal').showModal();$('bankBudgetForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());try{const x=await api(I+'/budgets',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
function saveCurrentView(){
 const query=(state.txFilters.q||'').trim();if(query.length<2){notice('Enter at least two characters in transaction search before saving a view.',true);return}
 const name=prompt('Saved view name:');if(!name)return;
 api(API+'/personal-money/saved-views',{method:'POST',body:JSON.stringify({name,query_text:query,pinned:true})}).then(async x=>{notice(x.message);await refresh()}).catch(error=>notice(error.message,true));
}
function openSavedView(query){
 state.txFilters.q=String(query||'');state.txMeta.page=1;state.view='transactions';history.replaceState(null,'','#transactions');loadTransactions();
}
async function openSplitEditor(transactionId,amount,currency){
 try{
  const current=await api(API+'/bank-transactions/'+transactionId+'/splits'),existing=current.splits||[];
  $('fmModalEyebrow').textContent='TRANSACTION SPLIT';$('fmModalTitle').textContent='Split '+nativeMoney(amount,currency);
  $('fmModalBody').innerHTML=`<form id="splitForm" class="fm-form"><div id="splitLines"></div><button type="button" id="addSplitLine">+ Add split line</button><p class="fm-helper">The server requires split lines to equal the parent amount exactly. The source transaction itself is never rewritten or duplicated.</p><div class="fm-form-actions"><button class="primary">Save split</button></div></form>`;
  const holder=$('splitLines');
  const addLine=(line={})=>{const row=document.createElement('div');row.className='fm-split-line';row.innerHTML=`<div class="fm-form-grid"><label>Amount<input name="amount" inputmode="decimal" value="${esc(line.amount||'')}" required></label><label>GST<input name="gst_amount" inputmode="decimal" value="${esc(line.gst_amount||'0.00')}"></label></div><div class="fm-form-grid"><label>Category<input name="category" value="${esc(line.category||'')}"></label><label>Ownership<select name="ownership_scope"><option ${line.ownership_scope==='BUSINESS'?'selected':''}>BUSINESS</option><option ${line.ownership_scope==='PERSONAL'?'selected':''}>PERSONAL</option><option ${line.ownership_scope==='MIXED'?'selected':''}>MIXED</option><option ${!line.ownership_scope||line.ownership_scope==='UNCLASSIFIED'?'selected':''}>UNCLASSIFIED</option></select></label></div><label>Note<input name="note" value="${esc(line.note||'')}"></label><button type="button" class="fm-remove-line">Remove line</button>`;row.querySelector('.fm-remove-line').onclick=()=>row.remove();holder.appendChild(row)};
  (existing.length?existing:[{},{}]).forEach(addLine);$('addSplitLine').onclick=()=>addLine();
  $('fmModal').showModal();$('splitForm').onsubmit=async e=>{e.preventDefault();const splits=[...holder.querySelectorAll('.fm-split-line')].map(row=>({amount:row.querySelector('[name="amount"]').value,gst_amount:row.querySelector('[name="gst_amount"]').value,category:row.querySelector('[name="category"]').value,ownership_scope:row.querySelector('[name="ownership_scope"]').value,note:row.querySelector('[name="note"]').value}));try{const x=await api(API+'/bank-transactions/'+transactionId+'/splits',{method:'PUT',body:JSON.stringify({splits})});$('fmModal').close();notice(x.message);await transactionDetail(transactionId)}catch(error){notice(error.message,true)}};
 }catch(error){notice(error.message,true)}
}
function openReimbursementForm(transactionId,amount,currency){
 $('fmModalEyebrow').textContent='REIMBURSEMENT';$('fmModalTitle').textContent='Create reimbursement';
 $('fmModalBody').innerHTML=`<form id="reimbursementForm" class="fm-form"><label>Requested amount (${esc(currency)})<input name="requested_amount" inputmode="decimal" value="${esc(amount)}" required></label><label>Note<textarea name="note"></textarea></label><p class="fm-helper">This creates an internal reimbursement record linked to the source expense. It does not execute a bank payment.</p><div class="fm-form-actions"><button class="primary">Create draft</button></div></form>`;
 $('fmModal').showModal();$('reimbursementForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/reimbursements',{method:'POST',body:JSON.stringify({expense_bank_transaction_id:Number(transactionId),requested_amount:fd.get('requested_amount'),note:fd.get('note')||null})});$('fmModal').close();notice(x.message);await refresh();go('reimbursements')}catch(error){notice(error.message,true)}};
}
async function reimbursementDetail(id){
 try{
  const data=await api(API+'/reimbursements/'+encodeURIComponent(id)),r=data.reimbursement||{},payments=data.payments||[],candidates=data.candidates||[],timeline=data.timeline||[];
  const settlementForm=['APPROVED','PARTIALLY_REIMBURSED'].includes(r.status)&&num(r.remaining_amount)>0
   ? `<form id="reimbursementPaymentForm" class="fm-form"><label>Existing company payment<select name="payment_bank_transaction_id" required><option value="">Choose a visible debit</option>${candidates.map(x=>`<option value="${x.id}" data-available="${esc(x.available_amount)}">${date(x.transaction_date)} · ${esc(x.account_name||'')} · ${esc(x.merchant_name||x.description||'Payment')} · ${nativeMoney(x.available_amount,x.currency)} available</option>`).join('')}</select></label><label>Amount (${esc(r.currency)})<input name="amount" inputmode="decimal" value="${esc(r.remaining_amount)}" required></label><p class="fm-helper">Links an existing company debit. No bank payment or duplicate transaction is created.</p><div class="fm-form-actions"><button class="primary">Link settlement</button></div></form>`
   : '';
  const actions=`<div class="fm-workflow-actions"><button data-reimb-expense="${r.expense_bank_transaction_id}">View expense & receipt</button>${r.status==='DRAFT'?'<button data-reimb-detail-action="submit">Submit</button>':''}${r.status==='SUBMITTED'?'<button data-reimb-detail-action="approve">Approve</button><button class="bad" data-reimb-detail-action="reject">Reject</button>':''}</div>`;
  openDrawer('Reimbursement '+(r.reimbursement_uid||'#'+r.id),`<div class="fm-grid four"><div class="fm-kpi"><span>Requested</span><strong>${nativeMoney(r.requested_amount,r.currency)}</strong></div><div class="fm-kpi"><span>Reimbursed</span><strong>${nativeMoney(r.paid_amount,r.currency)}</strong></div><div class="fm-kpi"><span>Remaining</span><strong>${nativeMoney(r.remaining_amount,r.currency)}</strong></div><div class="fm-kpi"><span>Status</span><strong>${esc(r.status)}</strong></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Claim and original expense</h3><p>The source expense remains the canonical economic record.</p></div></div><div class="fm-detail-grid"><span>Claimant<b>${esc(r.claimant_name||'User #'+r.claimant_user_id)}</b></span><span>Email<b>${esc(r.claimant_email||'—')}</b></span><span>Expense date<b>${date(r.transaction_date)}</b></span><span>Merchant<b>${esc(r.merchant_name||r.description||'—')}</b></span><span>Account<b>${esc(r.account_name||'—')}</b></span><span>Category<b>${esc(r.category||'Uncategorised')}</b></span><span>Submitted<b>${r.submitted_at?new Date(r.submitted_at).toLocaleString('en-AU'):'—'}</b></span><span>Approved by<b>${esc(r.approved_by_name||'—')}</b></span></div>${r.rejection_reason?`<div class="fm-state fm-state-error"><strong>Rejected</strong><p>${esc(r.rejection_reason)}</p></div>`:''}${actions}</div></article><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Settlement history</h3><p>Each row links to an existing bank transaction.</p></div></div><div class="fm-list">${payments.map(x=>`<button class="fm-row fm-row-button" data-reimb-payment-tx="${x.payment_bank_transaction_id}"><div><h3>${esc(x.merchant_name||x.description||'Settlement')}</h3><p>${date(x.transaction_date)} · ${esc(x.account_name||'')} · linked by ${esc(x.linked_by_name||'User #'+x.created_by)}</p></div><b>${nativeMoney(x.amount,x.currency)}</b></button>`).join('')||emptyState('No settlement linked','Approve the claim, then link a real company payment transaction.')}</div>${settlementForm}</div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Audit history</h3><p>Events come from the existing tamper-evident audit chain.</p></div></div><div class="fm-timeline">${timeline.map(event=>`<div class="fm-timeline-item"><time>${event.created_at?new Date(event.created_at).toLocaleString('en-AU'):'—'}</time><div><b>${esc(String(event.action||'Activity').replaceAll('_',' '))}</b><p>${esc(event.actor_name||'User #'+(event.actor_id||'system'))} · ${esc(event.result||'SUCCESS')}</p></div></div>`).join('')||emptyState('No history','No reimbursement audit event was returned.')}</div></div></article></div>`,'REIMBURSEMENT');
  setTimeout(()=>{
   document.querySelector('[data-reimb-expense]')?.addEventListener('click',()=>transactionDetail(r.expense_bank_transaction_id));
   document.querySelectorAll('[data-reimb-payment-tx]').forEach(b=>b.onclick=()=>transactionDetail(b.dataset.reimbPaymentTx));
   document.querySelectorAll('[data-reimb-detail-action]').forEach(b=>b.onclick=async()=>{const action=b.dataset.reimbDetailAction;let body={};if(action==='reject'){const reason=prompt('Reason for rejecting this reimbursement:');if(!reason)return;body={reason}}try{const x=await api(API+'/reimbursements/'+id+'/'+action,{method:'POST',body:JSON.stringify(body)});notice(x.message);await refresh();await reimbursementDetail(id)}catch(error){notice(error.message,true)}});
   if($('reimbursementPaymentForm'))$('reimbursementPaymentForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(API+'/reimbursements/'+id+'/payments',{method:'POST',body:JSON.stringify({payment_bank_transaction_id:Number(fd.get('payment_bank_transaction_id')),amount:fd.get('amount')})});notice(x.message);await refresh();await reimbursementDetail(id)}catch(error){notice(error.message,true)}};
  },0);
 }catch(error){notice(error.message,true)}
}
function render(){
 const [t,sub]=title(state.view);$('fmTitle').textContent=t;$('fmSubtitle').textContent=sub;navButtons();
 $('fmContent').innerHTML=state.view==='overview'?overview():state.view==='accounts'?accounts():state.view==='transactions'?transactions():state.view==='statements'?statements():simpleView(state.view);
 bindDynamic();
}
async function go(v){state.view=v;history.replaceState(null,'','#'+v);render()}
function bindDynamic(){
 document.querySelectorAll('[data-viewjump]').forEach(b=>b.onclick=()=>go(b.dataset.viewjump));
 document.querySelectorAll('[data-history-import]').forEach(b=>b.onclick=()=>openHistoricalImport(b.dataset.historyImport));
 document.querySelectorAll('[data-account-new]').forEach(b=>b.onclick=()=>openAccountForm(b.dataset.accountNew));
 document.querySelectorAll('[data-account-edit]').forEach(b=>b.onclick=()=>openAccountForm('',b.dataset.accountEdit));
 document.querySelectorAll('[data-fx-new]').forEach(b=>b.onclick=()=>openFxRateForm());
 document.querySelectorAll('[data-fx-archive]').forEach(b=>b.onclick=async()=>{if(!confirm('Archive this FX rate? Historical native transactions are not changed.'))return;try{const x=await api(API+'/fx-rates/'+encodeURIComponent(b.dataset.fxArchive)+'/archive',{method:'POST',body:'{}'});notice(x.message);await loadResource('fxRates',API+'/fx-rates');render()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-import-review]').forEach(b=>b.onclick=()=>openStatementReview(b.dataset.importReview));
 document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>openNew(b.dataset.quick));
 document.querySelectorAll('[data-personal-new]').forEach(b=>b.onclick=()=>openPersonalForm(b.dataset.personalNew));
 document.querySelectorAll('[data-wallet-active]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/personal-money/wallets/'+encodeURIComponent(b.dataset.walletId)+'/active',{method:'POST',body:JSON.stringify({active:b.dataset.walletActive==='1'})});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-personal-budget-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this personal budget definition? Transaction history is not affected.'))return;try{const x=await api(API+'/personal-money/budgets/'+encodeURIComponent(b.dataset.personalBudgetDelete),{method:'DELETE'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-recurring-active]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/personal-money/recurring/'+encodeURIComponent(b.dataset.recurringId)+'/active',{method:'POST',body:JSON.stringify({active:b.dataset.recurringActive==='1'})});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-goal-status]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/personal-money/goals/'+encodeURIComponent(b.dataset.goalId)+'/status',{method:'POST',body:JSON.stringify({status:b.dataset.goalStatus})});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});

 document.querySelectorAll('[data-debt-pay]').forEach(b=>b.onclick=()=>openDebtPaymentForm(b.dataset.debtPay));
 document.querySelectorAll('[data-debt-view]').forEach(b=>b.onclick=()=>debtDetail(b.dataset.debtView));
 document.querySelectorAll('[data-goal-contribute]').forEach(b=>b.onclick=()=>openGoalContributionForm(b.dataset.goalContribute));
 document.querySelectorAll('[data-recurring-complete]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/personal-money/recurring/'+encodeURIComponent(b.dataset.recurringComplete)+'/complete',{method:'POST',body:JSON.stringify({completed_date:new Date().toISOString().slice(0,10)})});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-bank-budget-archive]').forEach(b=>b.onclick=async()=>{if(!confirm('Archive this active banking budget?'))return;try{const x=await api(I+'/budgets/'+encodeURIComponent(b.dataset.bankBudgetArchive),{method:'DELETE'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 if($('addBankBudget'))$('addBankBudget').onclick=openBankingBudgetForm;
 document.querySelectorAll('[data-saved-query]').forEach(b=>b.onclick=()=>openSavedView(b.dataset.savedQuery));
 document.querySelectorAll('[data-saved-open]').forEach(b=>b.onclick=async()=>{state.txFilters.q=b.dataset.query||'';state.txMeta.page=1;await api(API+'/personal-money/saved-views/'+encodeURIComponent(b.dataset.savedOpen)+'/opened',{method:'POST',body:'{}'}).catch(()=>{});state.view='transactions';history.replaceState(null,'','#transactions');loadTransactions()});
 document.querySelectorAll('[data-saved-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this saved view?'))return;try{const x=await api(API+'/personal-money/saved-views/'+encodeURIComponent(b.dataset.savedDelete),{method:'DELETE'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 if($('saveCurrentView'))$('saveCurrentView').onclick=saveCurrentView;
 document.querySelectorAll('[data-notification-read]').forEach(b=>b.onclick=async()=>{try{await api('/api/notifications/'+encodeURIComponent(b.dataset.notificationRead)+'/read',{method:'PATCH',body:'{}'});await refresh()}catch(error){notice(error.message,true)}});
 if($('markAllNotifications'))$('markAllNotifications').onclick=async()=>{try{const x=await api('/api/notifications/mark-all-read',{method:'POST',body:'{}'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
 if($('bankingAlertForm'))$('bankingAlertForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const body={low_balance_threshold:fd.get('low_balance_threshold'),large_transaction_threshold:fd.get('large_transaction_threshold'),notify_budget:fd.get('notify_budget')==='on',notify_payments:fd.get('notify_payments')==='on',notify_bank_sync:fd.get('notify_bank_sync')==='on',notify_unusual_activity:fd.get('notify_unusual_activity')==='on'};try{const x=await api(OS+'/alerts',{method:'POST',body:JSON.stringify(body)});notice(x.message);await loadResource('bankingOps',API+'/banking-os');if(state.view==='notifications')render()}catch(error){notice(error.message,true)}};
 document.querySelectorAll('[data-notification-pref]').forEach(c=>c.onchange=async()=>{const existing=(state.notificationPrefs?.preferences||[]).find(p=>p.category===c.dataset.notificationPref)||{};try{await api('/api/notifications/preferences',{method:'PATCH',body:JSON.stringify({category:c.dataset.notificationPref,in_app_enabled:c.checked,email_enabled:Boolean(existing.email_enabled),push_enabled:Boolean(existing.push_enabled),quiet_hours_start:existing.quiet_hours_start||null,quiet_hours_end:existing.quiet_hours_end||null,digest_frequency:existing.digest_frequency||'IMMEDIATE'})});notice('Notification preference saved.')}catch(error){c.checked=!c.checked;notice(error.message,true)}});
 if($('openCompanySettings'))$('openCompanySettings').onclick=openCompanySettings;
 document.querySelectorAll('[data-archived-open]').forEach(b=>b.onclick=()=>transactionDetail(b.dataset.archivedOpen));
 document.querySelectorAll('[data-transaction-restore]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/bank-transactions/'+b.dataset.transactionRestore+'/restore',{method:'POST',body:'{}'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-tx]').forEach(r=>r.onclick=()=>transactionDetail(r.dataset.tx));
 const syncTxSelection=()=>{if($('txSelectedCount'))$('txSelectedCount').textContent=state.selectedTransactions.size+' selected';if($('txBulkReview'))$('txBulkReview').disabled=!state.selectedTransactions.size;if($('txSelectAll'))$('txSelectAll').checked=Boolean(state.tx.length)&&state.tx.every(x=>state.selectedTransactions.has(Number(x.id)))};
 document.querySelectorAll('[data-tx-select]').forEach(c=>{c.onclick=e=>e.stopPropagation();c.onchange=()=>{const id=Number(c.dataset.txSelect);if(c.checked)state.selectedTransactions.add(id);else state.selectedTransactions.delete(id);syncTxSelection()}});
 if($('txSelectAll'))$('txSelectAll').onchange=e=>{state.tx.forEach(x=>{const id=Number(x.id);if(e.currentTarget.checked)state.selectedTransactions.add(id);else state.selectedTransactions.delete(id)});document.querySelectorAll('[data-tx-select]').forEach(c=>{c.checked=e.currentTarget.checked});syncTxSelection()};
 if($('txBulkReview'))$('txBulkReview').onclick=openBulkReview;
 document.querySelectorAll('[data-account]').forEach(r=>r.onclick=()=>accountDetail(r.dataset.account));
 document.querySelectorAll('[data-company-bill]').forEach(b=>b.onclick=()=>supplierBillDetail(b.dataset.companyBill));
 document.querySelectorAll('[data-customer-invoice]').forEach(b=>b.onclick=()=>customerInvoiceDetail(b.dataset.customerInvoice));
 document.querySelectorAll('[data-review]').forEach(r=>r.onclick=()=>openStatementReview(r.dataset.review));
 document.querySelectorAll('[data-statement-remove]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this statement from active reports and analysis? You can restore it later.'))return;try{const x=await api(I+'/statements/'+encodeURIComponent(b.dataset.statementRemove)+'/remove',{method:'POST',body:'{}'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-statement-restore]').forEach(b=>b.onclick=async()=>{try{const x=await api(I+'/statements/'+encodeURIComponent(b.dataset.statementRestore)+'/restore',{method:'POST',body:'{}'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-statement-purge]').forEach(b=>b.onclick=async()=>{const uid=b.dataset.statementPurge;const typed=prompt('Permanent deletion cannot be undone. Type exactly: PURGE '+uid);if(typed!=='PURGE '+uid)return;try{const x=await api(I+'/statements/'+encodeURIComponent(uid)+'/purge',{method:'POST',body:JSON.stringify({confirmation:typed})});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.txFilters.category=b.dataset.category;state.txMeta.page=1;state.view='transactions';history.replaceState(null,'','#transactions');loadTransactions()});
 document.querySelectorAll('[data-merchant-filter]').forEach(b=>b.onclick=()=>{state.txFilters.merchant=b.dataset.merchantFilter||'';state.txMeta.page=1;state.view='transactions';history.replaceState(null,'','#transactions');loadTransactions()});
 document.querySelectorAll('[data-scope-jump]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scopeJump;$('fmScope').value=state.scope;refresh()});
 document.querySelectorAll('[data-scope-view]').forEach(b=>b.onclick=async()=>{
  state.scope=b.dataset.scopeView;state.account='';if($('fmScope'))$('fmScope').value=state.scope;
  state.view=b.dataset.scopeTarget||'overview';history.replaceState(null,'','#'+state.view);await refresh();
 });
 document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>{location.href=b.dataset.export});
 document.querySelectorAll('[data-retry]').forEach(b=>b.onclick=refresh);
 document.querySelectorAll('[data-transfer-debit]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/bank-transactions/'+b.dataset.transferDebit+'/transfer-links',{method:'POST',body:JSON.stringify({counterpart_transaction_id:Number(b.dataset.transferCredit)})});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-refund-link]').forEach(b=>b.onclick=()=>openRefundLink(b.dataset.refundLink,b.dataset.refundCurrency));
 document.querySelectorAll('[data-reimb-open]').forEach(b=>b.onclick=()=>reimbursementDetail(b.dataset.reimbOpen));
 document.querySelectorAll('[data-reimb-action]').forEach(b=>b.onclick=async()=>{const action=b.dataset.reimbAction,id=b.dataset.reimbId;let body={};if(action==='reject'){const reason=prompt('Reason for rejecting this reimbursement:');if(!reason)return;body={reason}}try{const x=await api(API+'/reimbursements/'+id+'/'+action,{method:'POST',body:JSON.stringify(body)});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-receipt-tx]').forEach(b=>b.onclick=()=>transactionDetail(b.dataset.receiptTx));
 document.querySelectorAll('[data-receipt-status]').forEach(b=>b.onclick=async()=>{let reason='';if(b.dataset.receiptStatus==='NOT_REQUIRED'){reason=prompt('Why is a receipt not required?')||'';if(!reason.trim())return}try{const x=await api(API+'/bank-transactions/'+b.dataset.receiptId+'/receipt-status',{method:'PATCH',body:JSON.stringify({status:b.dataset.receiptStatus,reason})});notice(x.message);await loadReceiptCenter()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-receipt-restore]').forEach(b=>b.onclick=async()=>{if(!confirm('Restore this protected receipt to the transaction?'))return;try{const x=await api(API+'/bank-transactions/'+b.dataset.receiptId+'/receipts/'+encodeURIComponent(b.dataset.receiptRestore)+'/restore',{method:'POST',body:'{}'});notice(x.message);await loadReceiptCenter()}catch(error){notice(error.message,true)}});
 if($('receiptFilterForm'))$('receiptFilterForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);state.receiptFilters={q:String(fd.get('q')||'').trim(),account_id:String(fd.get('account_id')||''),merchant:String(fd.get('merchant')||'').trim(),category:String(fd.get('category')||'').trim(),from:String(fd.get('from')||''),to:String(fd.get('to')||''),amount_min:String(fd.get('amount_min')||'').trim(),receipt_status:String(fd.get('receipt_status')||'ALL'),tax_relevant:fd.get('tax_relevant')==='on'};await loadReceiptCenter()};
 if($('financePreferencesForm'))$('financePreferencesForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const body=Object.fromEntries(fd.entries());body.dashboard_cards=fd.getAll('dashboard_cards');body.default_account_id=body.default_account_id?Number(body.default_account_id):null;body.reporting_currency=String(body.reporting_currency||'').toUpperCase()||null;try{const x=await api(API+'/preferences',{method:'PUT',body:JSON.stringify(body)});state.userPreferences=x.preferences;notice(x.message);render()}catch(error){notice(error.message,true)}};
 if($('txApply'))$('txApply').onclick=()=>{state.txFilters={...state.txFilters,q:$('txSearch').value.trim(),type:$('txType').value,category:$('txCategory').value.trim(),merchant:$('txMerchant').value.trim(),source:$('txSource').value,reconciliation_status:$('txRecon').value,amount_min:$('txMin').value.trim(),amount_max:$('txMax').value.trim()};state.txMeta.page=1;loadTransactions()};
 if($('txPrev'))$('txPrev').onclick=()=>{if(state.txMeta.page>1){state.txMeta.page-=1;loadTransactions()}};
 if($('txNext'))$('txNext').onclick=()=>{if(state.txMeta.page<state.txMeta.total_pages){state.txMeta.page+=1;loadTransactions()}};
 document.querySelectorAll('[data-report-preset]').forEach(b=>b.onclick=async()=>{
  const form=$('reportBuilderForm');if(!form)return;
  form.elements.report_type.value=b.dataset.reportPreset;
  const implied=['INCOME','EXPENSE','TRANSFER','REFUND'].includes(b.dataset.reportPreset)?b.dataset.reportPreset:'';
  form.elements.transaction_type.value=implied;
  if(b.dataset.reportPreset==='ACCOUNT_STATEMENT'&&form.elements.account_ids.selectedOptions.length!==1){notice('Account Statement needs exactly one account. Select one account in Advanced Report Centre, then generate it.',true);form.elements.account_ids.focus();return}
  try{await generateBuiltReport()}catch(error){notice(error.message,true)}
 });
 if($('reportBuilderForm'))$('reportBuilderForm').onsubmit=async e=>{e.preventDefault();try{await generateBuiltReport()}catch(error){notice(error.message,true)}};
 if($('reportPdf'))$('reportPdf').onclick=()=>{const def=reportDefinitionFromUi();if(def)location.href=API+'/reports/builder.pdf?'+reportQuery(def)};
 if($('reportCsv'))$('reportCsv').onclick=()=>{const def=reportDefinitionFromUi();if(def)location.href=API+'/reports/builder.csv?'+reportQuery(def)};
 if($('reportXlsx'))$('reportXlsx').onclick=()=>exportBuiltReportXlsx().catch(error=>notice(error.message,true));
 if($('reportSave'))$('reportSave').onclick=()=>saveBuiltReport().catch(error=>notice(error.message,true));
 document.querySelectorAll('[data-report-run]').forEach(b=>b.onclick=async()=>{try{state.reportResult=await api(API+'/reports/saved/'+encodeURIComponent(b.dataset.reportRun)+'/run');render()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-report-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this saved report definition?'))return;try{const x=await api(API+'/reports/saved/'+encodeURIComponent(b.dataset.reportDelete),{method:'DELETE'});notice(x.message);await refresh();state.view='reports';render()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-period-apply]').forEach(button=>button.onclick=async()=>{
  const id=button.dataset.periodApply;
  const select=document.querySelector('[data-period-target="'+id+'"]');
  if(!select)return;
  const status=String(select.value||'').toUpperCase();
  const current=String(select.dataset.periodCurrent||'OPEN').toUpperCase();
  const key=select.dataset.periodKey||'';
  if(status===current){notice('Accounting period is already '+status+'.');return}
  let reason='',confirmation='';
  if(status==='LOCKED'){
    reason=prompt('Reason for locking '+key+':')||'';
    if(!reason.trim())return;
    confirmation=prompt('Type exactly: LOCK '+key)||'';
    if(confirmation!=='LOCK '+key){notice('Lock confirmation did not match.',true);return}
  }else if(current==='LOCKED'){
    reason=prompt('Reason for unlocking '+key+':')||'';
    if(!reason.trim())return;
  }else{
    reason=prompt('Reason for changing '+key+' to '+status+' (optional):')||'';
  }
  try{
    const x=await api(API+'/accounting-periods/'+encodeURIComponent(id)+'/status',{method:'POST',body:JSON.stringify({status,reason,confirmation})});
    notice(x.message);await refresh();
  }catch(error){notice(error.message,true)}
 });
 if($('newMoneySpace'))$('newMoneySpace').onclick=openMoneySpaceForm;
 if($('newMoneySpaceInline'))$('newMoneySpaceInline').onclick=openMoneySpaceForm;
 if($('newBeneficiary'))$('newBeneficiary').onclick=openBeneficiaryForm;
 if($('newBeneficiaryInline'))$('newBeneficiaryInline').onclick=openBeneficiaryForm;
 if($('newPaymentDraft'))$('newPaymentDraft').onclick=openPaymentDraftForm;
 if($('newPaymentDraftInline'))$('newPaymentDraftInline').onclick=openPaymentDraftForm;
 document.querySelectorAll('[data-space-archive]').forEach(b=>b.onclick=async()=>{if(!confirm('Archive this Money Space?'))return;try{const x=await api(OS+'/spaces/'+encodeURIComponent(b.dataset.spaceArchive)+'/archive',{method:'POST',body:'{}'});notice(x.message);await refresh();state.view='bankops';render()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-payment-submit]').forEach(b=>b.onclick=()=>bankingPaymentAction(b.dataset.paymentSubmit,'submit'));
 document.querySelectorAll('[data-payment-cancel]').forEach(b=>b.onclick=()=>bankingPaymentAction(b.dataset.paymentCancel,'cancel'));
 document.querySelectorAll('[data-payment-decision]').forEach(b=>b.onclick=()=>bankingPaymentAction(b.dataset.paymentUid,'decision',b.dataset.paymentDecision));
 document.querySelectorAll('[data-team-access]').forEach(b=>b.onclick=()=>openTeamAccessForm(b.dataset.teamAccess));
 document.querySelectorAll('[data-bank-connect]').forEach(b=>b.onclick=()=>startBankConsent(b.dataset.bankConnect));
 document.querySelectorAll('[data-bank-sync]').forEach(b=>b.onclick=()=>syncBankConnection(b.dataset.bankSync));
 document.querySelectorAll('[data-bank-reauthorize]').forEach(b=>b.onclick=()=>startBankConsent(b.dataset.bankReauthorize));
 document.querySelectorAll('[data-bank-disconnect]').forEach(b=>b.onclick=()=>disconnectBankConnection(b.dataset.bankDisconnect));
 document.querySelectorAll('[data-consent-cancel]').forEach(b=>b.onclick=()=>cancelBankConsent(b.dataset.consentCancel));
 if($('addFinanceCategory'))$('addFinanceCategory').onclick=()=>openFinanceCategoryForm();
 document.querySelectorAll('[data-category-edit]').forEach(b=>b.onclick=()=>openFinanceCategoryForm(b.dataset.categoryEdit));
 document.querySelectorAll('[data-category-archive]').forEach(b=>b.onclick=async()=>{if(!confirm('Archive this Finance category? Existing transaction classifications will remain unchanged.'))return;try{const x=await api(API+'/categories/'+encodeURIComponent(b.dataset.categoryArchive)+'/archive',{method:'POST',body:'{}'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-category-restore]').forEach(b=>b.onclick=async()=>{try{const x=await api(API+'/categories/'+encodeURIComponent(b.dataset.categoryRestore)+'/restore',{method:'POST',body:'{}'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 document.querySelectorAll('[data-rule-edit]').forEach(b=>b.onclick=()=>openFinanceRuleForm(b.dataset.ruleEdit));
 document.querySelectorAll('[data-rule-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this merchant suggestion rule?'))return;try{const x=await api(I+'/rules/'+encodeURIComponent(b.dataset.ruleDelete),{method:'DELETE'});notice(x.message);await refresh()}catch(error){notice(error.message,true)}});
 if($('runAnalysis'))$('runAnalysis').onclick=async()=>{try{await api(I+'/analyse',{method:'POST',body:JSON.stringify({scope:state.scope})});notice('Finance analysis refreshed.');await refresh()}catch(error){notice(error.message,true)}};
}
function openDrawer(title,body,eyebrow='DETAIL'){$('fmDrawerEyebrow').textContent=eyebrow;$('fmDrawerTitle').textContent=title;$('fmDrawerBody').innerHTML=body;$('fmDrawer').classList.add('open');$('fmDrawer').setAttribute('aria-hidden','false');$('fmBackdrop').hidden=false}
function closeDrawer(){$('fmDrawer').classList.remove('open');$('fmDrawer').setAttribute('aria-hidden','true');$('fmBackdrop').hidden=true}
async function transactionDetail(id){
 try{
  const d=await api(I+'/transactions/'+id),r=d.transaction||d;
  let txTags=[];try{txTags=Array.isArray(r.tags_json)?r.tags_json:JSON.parse(r.tags_json||'[]')}catch{txTags=[]}
  let provenance=null,provenanceError=null;
  try{provenance=await api(API+'/bank-transactions/'+id+'/original')}catch(error){provenanceError=error}
  const original=provenance?.original;
  let receiptPayload=null,receiptError=null;
  try{receiptPayload=await api(API+'/bank-transactions/'+id+'/receipts')}catch(error){receiptError=error}
  const receipts=receiptPayload?.receipts||[];
  const receiptStatus=receiptPayload?.receipt_status||'UNASSESSED';
  const [splitResult,refundResult,transferResult,auditResult]=await Promise.allSettled([
    api(API+'/bank-transactions/'+id+'/splits'),
    api(API+'/bank-transactions/'+id+'/refund-links'),
    api(API+'/bank-transactions/'+id+'/transfer-links'),
    api(API+'/bank-transactions/'+id+'/audit')
  ]);
  const splits=splitResult.status==='fulfilled'?(splitResult.value.splits||[]):[];
  const refundLinks=refundResult.status==='fulfilled'?(refundResult.value.links||[]):[];
  const transferLinks=transferResult.status==='fulfilled'?(transferResult.value.links||[]):[];
  const auditTimeline=auditResult.status==='fulfilled'?(auditResult.value.timeline||[]):[];
  let sourceBlock='';
  if(r.source_type==='MANUAL') sourceBlock=`<div class="fm-card"><div class="fm-pad"><h3>Source provenance</h3><p class="fm-helper">Manual Voxel Veda entry. No external bank source record exists.</p></div></div>`;
  else if(provenanceError) sourceBlock=`<div class="fm-state fm-state-error"><strong>Original bank data unavailable</strong><p>${esc(provenanceError.message)}</p></div>`;
  else if(original) sourceBlock=`<div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>ORIGINAL BANK DATA</h3><p>Immutable source evidence. Current classification is shown separately.</p></div></div><div class="fm-detail-grid"><span>Original date<b>${date(original.transaction_date)}</b></span><span>Posting date<b>${date(original.posting_date)}</b></span><span>Description<b>${esc(original.description||'—')}</b></span><span>Merchant<b>${esc(original.merchant_string||'—')}</b></span><span>Reference<b>${esc(original.reference||'—')}</b></span><span>Bank category<b>${esc(original.bank_category||'—')}</b></span><span>Debit<b>${original.debit?nativeMoney(original.debit,original.currency||r.currency):'—'}</b></span><span>Credit<b>${original.credit?nativeMoney(original.credit,original.currency||r.currency):'—'}</b></span><span>Running balance<b>${original.running_balance!==null&&original.running_balance!==undefined?nativeMoney(original.running_balance,original.currency||r.currency):'—'}</b></span><span>Currency<b>${esc(original.currency||'—')}</b></span></div></div></div>`;
  else sourceBlock=`<div class="fm-card"><div class="fm-pad"><h3>Original bank data</h3><p class="fm-helper">No immutable external-source record is attached to this transaction.</p></div></div>`;
  const receiptBlock=receiptError
    ? `<div class="fm-state fm-state-error"><strong>Receipts unavailable</strong><p>${esc(receiptError.message)}</p></div>`
    : `<div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Receipts & attachments</h3><p>Private documents are scanned and served only through authenticated download routes.</p></div>${statusBadge(receiptStatus)}</div><div class="fm-list">${receipts.map(doc=>`<div class="fm-row"><div><h3>${esc(doc.original_name)}</h3><p>${esc(doc.mime_type||'')} · ${esc(doc.scan_status||'')}</p></div><div class="fm-row-right"><a href="${esc(doc.download_url)}" target="_blank" rel="noopener">View</a><button type="button" data-receipt-unlink="${esc(doc.id)}">Unlink</button></div></div>`).join('')||emptyState('No receipt attached','Upload a JPG, PNG, HEIC or PDF receipt.')}</div>${receipts.length?'':`<div class="fm-workflow-actions"><button data-detail-receipt-status="REQUESTED">Request receipt</button><button data-detail-receipt-status="MISSING">Mark missing</button><button data-detail-receipt-status="NOT_REQUIRED">Not required</button></div>`}<form id="receiptUploadForm" class="fm-form"><label>Attach receipt<input name="file" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" capture="environment" required></label><div class="fm-form-actions"><button class="primary" type="submit">Upload securely</button></div></form></div></div>`;
  const auditBlock=`<div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Audit History</h3><p>Human-readable events from the existing hash-linked audit chain.</p></div></div><div class="fm-timeline">${auditTimeline.map(event=>`<div class="fm-timeline-item"><time>${event.at?new Date(event.at).toLocaleString('en-AU'):'—'}</time><div><b>${esc(String(event.action||'Activity').replaceAll('_',' '))}</b><p>${esc(event.description||'Finance record activity')} · ${esc(event.actor_name||(event.actor_id?'User #'+event.actor_id:'System'))}</p></div></div>`).join('')||emptyState('No audit events yet','No transaction-specific audit event has been recorded for this item.')}</div></div></div>`;
  openDrawer(r.merchant_normalized||r.merchant_name||r.description||'Transaction',`<div class="fm-grid two"><div class="fm-kpi"><span>Amount</span><strong>${nativeMoney(Math.abs(num(r.credit||0)-num(r.debit||0)),r.currency||'AUD')}</strong><small>${Number(r.is_internal_transfer)?'Internal transfer':num(r.debit)>0?'Expense':'Income'} · ${esc(r.currency||'')}</small></div><div class="fm-kpi"><span>Review</span><strong>${r.reviewed_at?'Reviewed':'Needs review'}</strong><small>${esc(r.reconciliation_status||'')} · ${esc(r.source_type||'')}</small></div></div><div class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>CURRENT CLASSIFICATION</h3><p>Editable classification never overwrites original bank evidence.</p></div></div><form id="txEditForm" class="fm-form"><div class="fm-form-grid"><label>Category<input name="category" value="${esc(r.category||'')}"></label><label>Ownership<select name="ownership_scope"><option ${r.ownership_scope==='PERSONAL'?'selected':''}>PERSONAL</option><option ${r.ownership_scope==='BUSINESS'?'selected':''}>BUSINESS</option><option ${r.ownership_scope==='MIXED'?'selected':''}>MIXED</option><option ${r.ownership_scope==='UNCLASSIFIED'?'selected':''}>UNCLASSIFIED</option></select></label></div><div class="fm-form-grid"><label>Normalised merchant<input name="merchant_normalized" value="${esc(r.merchant_normalized||'')}"></label><label>Project / cost centre<input name="project_ref" value="${esc(r.project_ref||'')}"></label></div><div class="fm-form-grid"><label>Tags<input name="tags" value="${esc(txTags.join(', '))}"></label><label>GST treatment<select name="gst_treatment"><option value="">Not set</option>${['REVIEW','GST_ON_EXPENSES','GST_ON_INCOME','GST_FREE','INPUT_TAXED','NO_GST','OUT_OF_SCOPE'].map(v=>`<option ${r.gst_treatment===v?'selected':''}>${v}</option>`).join('')}</select></label></div><div class="fm-detail-grid"><span>Date<b>${date(r.transaction_date)}</b></span><span>Posting date<b>${date(r.posting_date)}</b></span><span>Account<b>${esc(r.account_name||'')}</b></span><span>Bank<b>${esc(r.institution||'')}</b></span><span>Description<b>${esc(r.description||'')}</b></span><span>Reference<b>${esc(r.reference||'—')}</b></span><span>Source<b>${esc(r.source_type||'')}</b></span><span>Statement<b>${esc(r.statement_import_uid||'—')}</b></span></div><label class="fm-check"><input name="reviewed" type="checkbox" ${r.reviewed_at?'checked':''}> Classification reviewed</label><label class="fm-check"><input name="remember_rule" type="checkbox"> Remember as Suggest Only rule</label><div class="fm-form-actions"><button class="primary" type="submit">Save classification</button></div></form><div class="fm-workflow-actions"><button type="button" data-split-open="1">Split transaction</button>${num(r.debit)>0?'<button type="button" data-reimbursement-open="1">Create reimbursement</button>':''}${num(r.credit)>0?'<button type="button" data-refund-link="'+r.id+'" data-refund-currency="'+esc(r.currency)+'">Link as refund</button>':''}<button type="button" data-viewjump="transfers">Transfer matching</button>${r.archived_at?'<button type="button" data-transaction-restore="'+r.id+'">Restore transaction</button>':r.source_type==='MANUAL'?'<button type="button" class="bad" data-transaction-archive="'+r.id+'" data-manual-delete="1">Delete wrong entry</button>':'<button type="button" class="bad" data-transaction-archive="'+r.id+'">Archive from active ledger</button>'}</div><div class="fm-relation-summary"><span>Split lines <b>${splits.length}</b></span><span>Refund links <b>${refundLinks.length}</b></span><span>Transfer pairs <b>${transferLinks.length}</b></span></div></div></div>${sourceBlock}${receiptBlock}${auditBlock}`,'TRANSACTION');
  setTimeout(()=>{
   $('txEditForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const x=await api(I+'/transactions/'+id,{method:'POST',body:JSON.stringify({category:fd.get('category'),ownership_scope:fd.get('ownership_scope'),merchant_normalized:fd.get('merchant_normalized')||null,project_ref:fd.get('project_ref')||null,tags:String(fd.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),gst_treatment:fd.get('gst_treatment')||null,reviewed:fd.get('reviewed')==='on',remember_rule:fd.get('remember_rule')==='on'})});notice(x.message);closeDrawer();await refresh()}catch(error){notice(error.message,true)}};
   if($('receiptUploadForm'))$('receiptUploadForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{const response=await fetch(API+'/bank-transactions/'+id+'/receipts',{method:'POST',credentials:'same-origin',body:fd});let payload={};try{payload=await response.json()}catch{}if(!response.ok)throw new Error(payload.message||'Receipt upload failed');notice(payload.message||'Receipt attached.');await transactionDetail(id)}catch(error){notice(error.message,true)}};
   document.querySelectorAll('[data-detail-receipt-status]').forEach(b=>b.onclick=async()=>{let reason='';if(b.dataset.detailReceiptStatus==='NOT_REQUIRED'){reason=prompt('Why is a receipt not required?')||'';if(!reason.trim())return}try{const x=await api(API+'/bank-transactions/'+id+'/receipt-status',{method:'PATCH',body:JSON.stringify({status:b.dataset.detailReceiptStatus,reason})});notice(x.message);await transactionDetail(id)}catch(error){notice(error.message,true)}});
   document.querySelectorAll('[data-receipt-unlink]').forEach(b=>b.onclick=async()=>{if(!confirm('Unlink this receipt from the transaction?'))return;try{const x=await api(API+'/bank-transactions/'+id+'/receipts/'+encodeURIComponent(b.dataset.receiptUnlink),{method:'DELETE'});notice(x.message);await transactionDetail(id)}catch(error){notice(error.message,true)}});
   document.querySelector('[data-split-open]')?.addEventListener('click',()=>openSplitEditor(id,Math.abs(num(r.credit||0)-num(r.debit||0)),r.currency||'AUD'));
   document.querySelector('[data-reimbursement-open]')?.addEventListener('click',()=>openReimbursementForm(id,r.debit||0,r.currency||'AUD'));
   document.querySelectorAll('[data-refund-link]').forEach(b=>b.onclick=()=>openRefundLink(b.dataset.refundLink,b.dataset.refundCurrency));
   document.querySelector('[data-transaction-archive]')?.addEventListener('click',async e=>{const manual=e.currentTarget.dataset.manualDelete==='1';const reason=prompt(manual?'Why is this manual entry wrong? It will be removed from active reports but kept in recoverable audit history.':'Archive reason:');if(!reason)return;try{const x=await api(API+'/bank-transactions/'+id+'/archive',{method:'POST',body:JSON.stringify({reason:manual?'Wrong manual entry: '+reason:reason})});notice(manual?'Wrong manual entry removed from the active ledger. You can restore it from Review Centre.':x.message);closeDrawer();await refresh()}catch(error){notice(error.message,true)}});
   document.querySelector('[data-transaction-restore]')?.addEventListener('click',async()=>{try{const x=await api(API+'/bank-transactions/'+id+'/restore',{method:'POST',body:'{}'});notice(x.message);closeDrawer();await refresh()}catch(error){notice(error.message,true)}});
   document.querySelectorAll('[data-viewjump]').forEach(b=>b.onclick=()=>{closeDrawer();go(b.dataset.viewjump)});
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
  openDrawer(a.nickname||'Account',`<div class="fm-account-tabs"><button class="active">Overview</button><button data-account-edit="${a.id}">Edit account</button><button data-account-tx="${a.id}">Transactions</button><button data-viewjump="history">Import history</button><button data-viewjump="statements">Statements</button><button data-viewjump="reconciliation">Reconciliation</button></div><div class="fm-grid four"><div class="fm-kpi"><span>Current / available balance</span><strong>${nativeMoney(a.available_balance??a.current_ledger_balance,a.currency||'AUD')}</strong><small>Current position</small></div><div class="fm-kpi"><span>90-day money in</span><strong class="good">${nativeMoney(d.metrics?.income_90d||0,a.currency||'AUD')}</strong></div><div class="fm-kpi"><span>90-day money out</span><strong class="bad">${nativeMoney(d.metrics?.spend_90d||0,a.currency||'AUD')}</strong></div><div class="fm-kpi"><span>90-day net</span><strong>${nativeMoney(d.metrics?.net_90d||0,a.currency||'AUD')}</strong></div></div><div class="fm-card"><div class="fm-pad"><div class="fm-detail-grid"><span>Institution<b>${esc(a.institution||'—')}</b></span><span>Type<b>${esc(a.account_type||'—')}</b></span><span>Masked number<b>${esc(a.account_number_masked||'—')}</b></span><span>Ownership<b>${esc(a.ownership_scope||'—')}</b></span><span>Currency<b>${esc(a.currency||'—')}</b></span><span>Connection<b>${esc(a.connection_status||a.connection_type||'MANUAL')}</b></span><span>Last sync<b>${date(a.last_synced_at)}</b></span><span>History<b>${date(a.history_start_date)} → ${date(a.history_end_date)}</b></span></div></div></div><div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><h3>Balance / cash-flow trend</h3><div class="fm-chart">${chart}</div></div></article><article class="fm-card"><div class="fm-pad"><h3>Category distribution</h3><div class="fm-list">${categories}</div></div></article></div><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><h3>Recent transactions</h3><button data-quick-account="${a.id}">+ Transaction</button></div><div class="fm-list">${tx||emptyState('No transactions','No visible activity for this account.')}</div></div></article><details class="fm-danger"><summary>Danger Zone</summary><p>Archive or inactive is preferred. Permanent deletion is shown only when the server dependency scan says the account is eligible and still requires privileged step-up.</p><div class="fm-hero-actions"><button data-account-action="inactive" data-id="${a.id}">Set inactive</button><button data-account-action="archive" data-id="${a.id}">Archive</button><button data-account-action="restore" data-id="${a.id}">Restore</button>${deleteButton}</div></details>`,'ACCOUNT WORKSPACE');
  setTimeout(()=>{
   document.querySelectorAll('[data-account-action]').forEach(b=>b.onclick=()=>accountLifecycle(b.dataset.id,b.dataset.accountAction));
   document.querySelector('[data-account-edit]')?.addEventListener('click',()=>{closeDrawer();openAccountForm('',a.id)});
   document.querySelectorAll('[data-tx]').forEach(x=>x.onclick=()=>transactionDetail(x.dataset.tx));
   document.querySelector('[data-account-tx]')?.addEventListener('click',()=>{state.account=String(a.id);$('fmAccount').value=state.account;closeDrawer();go('transactions');loadTransactions()});
   document.querySelector('[data-quick-account]')?.addEventListener('click',()=>openNew('expense',a.id));
   document.querySelectorAll('[data-viewjump]').forEach(x=>x.onclick=()=>{closeDrawer();go(x.dataset.viewjump)});
  },0);
 }catch(error){notice(error.message,true)}
}
async function accountLifecycle(id,action){const map={inactive:['POST',I+'/accounts/'+id+'/inactive'],archive:['POST',I+'/accounts/'+id+'/archive'],restore:['POST',I+'/accounts/'+id+'/restore'],delete:['DELETE',I+'/accounts/'+id]};const cfg=map[action];if(!cfg)return;if(action==='delete'&&!confirm('Permanently delete this empty account? This action is blocked if dependencies exist.'))return;try{await api(cfg[1],{method:cfg[0],body:cfg[0]==='POST'?'{}':undefined});notice('Account updated.');closeDrawer();await refresh()}catch(e){notice(e.message,true)}}
function openAccountForm(presetType='',accountId=''){
 const existing=state.accounts.find(a=>String(a.id)===String(accountId))||{};
 $('fmModalEyebrow').textContent='FINANCIAL ACCOUNT';$('fmModalTitle').textContent=accountId?'Edit financial account':'Add financial account';
 const type=String(presetType||existing.account_type||'TRANSACTION').toUpperCase();
 $('fmModalBody').innerHTML=`<form id="financeAccountForm" class="fm-form"><input type="hidden" name="id" value="${esc(accountId)}"><label>Account name<input name="nickname" value="${esc(existing.nickname||'')}" placeholder="e.g. ANZ Business, Personal Savings, Petty Cash" required></label><div class="fm-form-grid"><label>Institution<input name="institution" value="${esc(existing.institution||'')}" placeholder="Bank or provider"></label><label>Currency<input name="currency" value="${esc(existing.currency||'AUD')}" maxlength="3" required></label></div><div class="fm-form-grid"><label>Account type<select name="account_type"><option value="TRANSACTION">Transaction account</option><option value="SAVINGS">Savings</option><option value="CREDIT CARD">Credit card</option><option value="LOAN">Loan</option><option value="CASH">Cash</option><option value="PETTY CASH">Petty cash</option><option value="WALLET">Digital wallet</option><option value="OTHER">Other</option></select></label><label>Ownership<select name="ownership_scope"><option value="BUSINESS">Company</option><option value="PERSONAL">Personal</option><option value="MIXED">Mixed</option><option value="UNCLASSIFIED">Unclassified</option></select></label></div><div class="fm-form-grid"><label>Masked BSB<input name="bsb_masked" value="${esc(existing.bsb_masked||'')}" placeholder="e.g. ***-123"></label><label>Masked account number<input name="account_number_masked" value="${esc(existing.account_number_masked||'')}" placeholder="e.g. ******789"></label></div><div class="fm-form-grid"><label>Entity / owner<input name="entity_name" value="${esc(existing.entity_name||'')}" placeholder="Voxel Veda Pty Ltd or private"></label><label>Purpose<input name="financial_purpose" value="${esc(existing.financial_purpose||'')}" placeholder="Operating, tax, savings, vehicle..."></label></div>${accountId?'':'<label>Opening balance<input name="opening_balance" inputmode="decimal" value="0"></label>'}<p class="fm-helper">Create each real bank/card/cash account once. Statement history is imported into that account and never silently merged with another account.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit">${accountId?'Save account':'Create account'}</button></div></form>`;
 $('fmModal').showModal();
 const form=$('financeAccountForm');form.elements.account_type.value=type;form.elements.ownership_scope.value=existing.ownership_scope||(state.scope==='PERSONAL'?'PERSONAL':'BUSINESS');
 if(existing.ownership_scope)form.elements.ownership_scope.value=existing.ownership_scope;
 document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=> $('fmModal').close());
 form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries(fd.entries());body.id=body.id?Number(body.id):undefined;body.currency=String(body.currency||'AUD').toUpperCase();try{const x=await api(I+'/accounts',{method:'POST',body:JSON.stringify(body)});$('fmModal').close();notice(x.message);await refresh();if(x.bank_account_id){state.view='accounts';history.replaceState(null,'','#accounts');render()}}catch(error){notice(error.message,true)}};
}
function openNew(kind='expense',presetAccount=''){
 if(kind==='statement'){openStatementWizard();return}
 if(kind==='account'){openAccountForm();return}
 $('fmModalEyebrow').textContent='NEW FINANCIAL MOVEMENT';$('fmModalTitle').textContent='Add financial movement';
 const defaultType=kind==='income'?'INCOME':'EXPENSE';
 $('fmModalBody').innerHTML=`<form id="fmEntryForm" class="fm-form"><div class="fm-form-grid"><label>Type<select name="type"><option value="EXPENSE" ${defaultType==='EXPENSE'?'selected':''}>Expense</option><option value="INCOME" ${defaultType==='INCOME'?'selected':''}>Income</option><option value="ADJUSTMENT_IN">Adjustment In</option><option value="ADJUSTMENT_OUT">Adjustment Out</option></select></label><label>Date<input name="transaction_date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label></div><label>Account<select name="bank_account_id" required><option value="">Select account</option>${state.accounts.map(a=>`<option value="${a.id}" ${String(a.id)===String(presetAccount)?'selected':''}>${esc(a.nickname||a.account_name||'Account')} · ${esc(a.currency||'AUD')}</option>`).join('')}</select></label><label>Amount<input name="amount" inputmode="decimal" required></label><label>Description<input name="description" required></label><div class="fm-form-grid"><label>Merchant / Payee<input name="merchant_name"></label><label>Reference<input name="reference"></label></div><div class="fm-form-grid"><label>Category<input name="category"></label><label>Ownership<select name="ownership_scope"><option>BUSINESS</option><option>PERSONAL</option><option>MIXED</option><option>UNCLASSIFIED</option></select></label></div><p class="fm-helper">The selected account's native currency is authoritative. No FX rate is invented or inferred.</p><div class="fm-form-actions"><button type="button" data-modal-cancel="1">Cancel</button><button class="primary" type="submit">Save movement</button></div></form>`;
 $('fmModal').showModal();
 document.querySelector('[data-modal-cancel]')?.addEventListener('click',()=> $('fmModal').close());
 $('fmEntryForm').onsubmit=async e=>{e.preventDefault();try{const x=await saveManualMovement(e.currentTarget);$('fmModal').close();notice(x.message);await refresh()}catch(error){notice(error.message,true)}};
}
async function refresh(){
 notice('');$('fmContent').innerHTML='<div class="fm-loading"><span></span><b>Refreshing finance workspace…</b></div>';
 try{
  const cycle=await loadBase();render();signalFinanceReady();
  void hydrateSupplementary(cycle).catch(error=>notice(error.message||'Some Finance services could not be refreshed.',true));
 }catch(error){renderFinanceFatal(error,'Finance refresh failed')}
}
async function supplierBillDetail(id){
 try{
  const data=await api(API+'/supplier-bills/'+encodeURIComponent(id)),b=data.bill||{},items=data.items||[],payments=data.payments||[];
  const currency=state.companySummary?.currency||state.companySettings?.settings?.base_currency||'AUD';
  openDrawer(b.supplier_name||b.bill_uid||'Supplier Bill','<div class="fm-grid four"><div class="fm-kpi"><span>Total</span><strong>'+nativeMoney(b.total_amount,currency)+'</strong></div><div class="fm-kpi"><span>Paid</span><strong>'+nativeMoney(b.paid_amount,currency)+'</strong></div><div class="fm-kpi"><span>Balance</span><strong>'+nativeMoney(num(b.total_amount)-num(b.paid_amount),currency)+'</strong></div><div class="fm-kpi"><span>Status</span><strong>'+esc(b.status||'')+'</strong></div></div><article class="fm-card"><div class="fm-pad"><div class="fm-detail-grid"><span>Invoice<b>'+esc(b.supplier_invoice_no||'—')+'</b></span><span>Issue date<b>'+date(b.issue_date)+'</b></span><span>Due date<b>'+date(b.due_date)+'</b></span><span>Job reference<b>'+esc(b.job_reference||'—')+'</b></span></div></div></article><article class="fm-card"><div class="fm-pad"><h3>Bill items</h3><div class="fm-list">'+(items.map(x=>'<div class="fm-row"><div><h3>'+esc(x.description)+'</h3><p>'+esc(x.quantity)+' × '+nativeMoney(x.unit_price,currency)+'</p></div><b>'+nativeMoney(x.total_amount,currency)+'</b></div>').join('')||emptyState('No items','No bill line items returned.'))+'</div></div></article><article class="fm-card"><div class="fm-pad"><h3>Payment history</h3><div class="fm-list">'+(payments.map(x=>'<div class="fm-row"><div><h3>'+date(x.payment_date)+'</h3><p>'+esc(x.reference||x.payment_uid||'')+'</p></div><b>'+nativeMoney(x.amount,currency)+'</b></div>').join('')||emptyState('No payments','No payment has been recorded for this bill.'))+'</div></div></article>','SUPPLIER BILL');
 }catch(error){notice(error.message,true)}
}
async function customerInvoiceDetail(id){
 try{
  const data=await api('/api/invoice/'+encodeURIComponent(id)),inv=data.invoice||{},items=data.items||[],payments=data.payments||[];
  const balance=num(inv.balance_due),currency=state.companySummary?.currency||'AUD';
  const statementKey=inv.customer_email?'customer_email='+encodeURIComponent(inv.customer_email):'customer_name='+encodeURIComponent(inv.customer_name||'');
  const itemRows=items.map(x=>'<div class="fm-row"><div><h3>'+esc(x.description||x.product_name||'Invoice item')+'</h3><p>'+num(x.quantity||x.qty||1)+' × '+nativeMoney(x.unit_price,currency)+'</p></div><b>'+nativeMoney(x.amount??x.total,currency)+'</b></div>').join('');
  const paymentRows=payments.map(p=>'<div class="fm-row"><div><h3>'+date(p.payment_date)+'</h3><p>'+esc(p.method||'Payment')+(p.reference?' · '+esc(p.reference):'')+'</p></div><b class="good">'+nativeMoney(p.amount,currency)+'</b></div>').join('');
  const paymentForm=balance>0.009?'<form id="customerInvoicePaymentForm" class="fm-form"><div class="fm-form-grid"><label>Payment amount<input name="amount" inputmode="decimal" value="'+esc(balance.toFixed(2))+'" required></label><label>Payment date<input name="payment_date" type="date" value="'+localIsoDay()+'" required></label></div><div class="fm-form-grid"><label>Method<input name="method" value="Bank transfer"></label><label>Reference<input name="reference" placeholder="Bank/reference number"></label></div><label>Notes<textarea name="notes"></textarea></label><p class="fm-helper">Recording a payment updates the invoice-payment ledger. It does not create a fake bank transaction.</p><div class="fm-form-actions"><button class="primary" type="submit">Record customer payment</button></div></form>':'<div class="fm-state"><strong>Invoice fully paid</strong><p>No receivable balance remains.</p></div>';
  openDrawer(inv.invoice_no||'Customer invoice',
   '<div class="fm-grid four"><div class="fm-kpi"><span>Invoice total</span><strong>'+nativeMoney(inv.total,currency)+'</strong></div><div class="fm-kpi"><span>Paid</span><strong class="good">'+nativeMoney(inv.paid_amount,currency)+'</strong></div><div class="fm-kpi"><span>Balance due</span><strong class="'+(balance>0?'bad':'good')+'">'+nativeMoney(balance,currency)+'</strong></div><div class="fm-kpi"><span>Status</span><strong>'+esc(inv.payment_state||inv.status||'')+'</strong></div></div>'+
   '<article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>'+esc(inv.customer_name||'Customer')+'</h3><p>'+esc(inv.customer_email||'No email')+'</p></div><div class="fm-inline-actions"><a href="/api/invoice/'+encodeURIComponent(id)+'/pdf" target="_blank" rel="noopener">Invoice PDF</a><a href="/api/invoice/statement/pdf?'+statementKey+'" target="_blank" rel="noopener">Customer statement</a></div></div><div class="fm-list">'+(itemRows||emptyState('No invoice items','No line items were returned.'))+'</div></div></article>'+
   '<div class="fm-grid two"><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Payment ledger</h3><p>Recorded customer receipts against this invoice.</p></div></div><div class="fm-list">'+(paymentRows||emptyState('No payments','No payment has been recorded yet.'))+'</div></div></article><article class="fm-card"><div class="fm-pad"><div class="fm-card-head"><div><h3>Receive payment</h3><p>Protected by Finance posting permission and step-up authentication.</p></div></div>'+paymentForm+'</div></article></div>',
   'CUSTOMER RECEIVABLE');
  setTimeout(()=>{
   if($('customerInvoicePaymentForm'))$('customerInvoicePaymentForm').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());body.invoice_id=Number(id);try{const x=await api('/api/invoice/payment',{method:'POST',body:JSON.stringify(body)});notice(x.message);await refresh();await customerInvoiceDetail(id)}catch(error){notice(error.message,true)}};
  },0);
 }catch(error){notice(error.message,true)}
}

async function globalFinanceSearch(input){
 const q=String(input||'').trim();if(q.length<2){notice('Enter at least two characters to search Finance.',true);return}
 try{
  const data=await api(API+'/search?q='+encodeURIComponent(q)),g=data.groups||{};
  const section=(title,rows,render)=>rows?.length?'<section class="fm-search-group"><h3>'+esc(title)+'</h3><div class="fm-list">'+rows.map(render).join('')+'</div></section>':'';
  const html=section('Transactions',g.transactions,r=>'<button class="fm-row fm-row-button" data-search-tx="'+r.id+'"><div><h3>'+esc(r.merchant_name||r.description)+'</h3><p>'+date(r.transaction_date)+' · '+esc(r.account_name||'')+' · '+esc(r.reference||'')+'</p></div><b>'+nativeMoney(Math.abs(num(r.credit)-num(r.debit)),r.currency||'AUD')+'</b></button>')+
   section('Accounts',g.accounts,r=>'<button class="fm-row fm-row-button" data-search-account="'+r.id+'"><div><h3>'+esc(r.nickname)+'</h3><p>'+esc(r.institution||'')+' · '+esc(r.account_type||'')+' · '+esc(r.ownership_scope||'')+'</p></div><b>'+esc(r.currency||'')+'</b></button>')+
   section('Statements',g.statements,r=>'<button class="fm-row fm-row-button" data-search-view="statements"><div><h3>'+esc(r.original_name)+'</h3><p>'+esc(r.account_name||'')+' · '+date(r.statement_start_date)+' – '+date(r.statement_end_date)+'</p></div><b>'+esc(r.source_format||'')+'</b></button>')+
   section('Receipts',g.receipts,r=>'<button class="fm-row fm-row-button" data-search-tx="'+r.bank_transaction_id+'"><div><h3>'+esc(r.original_name)+'</h3><p>'+esc(r.merchant_name||r.description||'')+' · '+esc(r.account_name||'')+'</p></div><small>'+date(r.created_at)+'</small></button>')+
   section('Categories',g.categories,r=>'<button class="fm-row fm-row-button" data-search-view="categories"><div><h3>'+esc(r.name)+'</h3><p>'+esc(r.scope||'')+' · GST '+esc(r.gst_default||'REVIEW')+'</p></div></button>')+
   section('Supplier Bills',g.supplier_bills,r=>'<button class="fm-row fm-row-button" data-search-bill="'+r.id+'"><div><h3>'+esc(r.supplier_name||r.bill_uid)+'</h3><p>'+esc(r.supplier_invoice_no||'')+' · '+esc(r.status||'')+'</p></div><b>'+nativeMoney(r.balance,state.companySummary?.currency||'AUD')+'</b></button>');
  openDrawer('Search: '+q,html||emptyState('No Finance results','No permitted Finance records matched this search.'),'GLOBAL SEARCH');
  setTimeout(()=>{document.querySelectorAll('[data-search-tx]').forEach(b=>b.onclick=()=>transactionDetail(b.dataset.searchTx));document.querySelectorAll('[data-search-account]').forEach(b=>b.onclick=()=>accountDetail(b.dataset.searchAccount));document.querySelectorAll('[data-search-bill]').forEach(b=>b.onclick=()=>supplierBillDetail(b.dataset.searchBill));document.querySelectorAll('[data-search-view]').forEach(b=>b.onclick=()=>{closeDrawer();go(b.dataset.searchView)})},0);
 }catch(error){notice(error.message,true)}
}
function runFinanceCommand(input){
 const q=String(input||'').trim();const command=q.toLowerCase();
 const direct={
  'add expense':()=>openNew('expense'),
  'add income':()=>openNew('income'),
  'upload statement':()=>openStatementWizard(),
  'company accounts':()=>{state.scope='BUSINESS';$('fmScope').value='BUSINESS';go('accounts');refresh()},
  'personal accounts':()=>{state.scope='PERSONAL';$('fmScope').value='PERSONAL';go('accounts');refresh()},
  'open company accounts':()=>{state.scope='BUSINESS';$('fmScope').value='BUSINESS';go('accounts');refresh()},
  'missing receipts':()=>{state.txFilters.q='';state.view='review';go('review')},
  'create report':()=>go('reports'),
  'open reports':()=>go('reports'),
  'open notifications':()=>go('notifications'),
  'banking connections':()=>go('connections'),
  'review centre':()=>go('review')
 };
 if(direct[command]){direct[command]();return true}
 if(command.startsWith('search ')){globalFinanceSearch(q.slice(7).trim());return true}
 return false;
}
function bind(){
 $('fmScope').onchange=e=>{state.scope=e.target.value;state.txMeta.page=1;refresh()};
 $('fmAccount').onchange=e=>{state.account=e.target.value;state.txMeta.page=1;refresh()};
 $('fmPeriod').onchange=e=>{state.period=e.target.value;const custom=state.period==='custom';$('fmFromWrap').hidden=!custom;$('fmToWrap').hidden=!custom;if(!custom)refresh()};
 $('fmFrom').onchange=e=>{state.customFrom=e.target.value;if(state.period==='custom'&&state.customTo)refresh()};
 $('fmTo').onchange=e=>{state.customTo=e.target.value;if(state.period==='custom'&&state.customFrom)refresh()};
 $('fmCurrencyMode').onchange=()=>notice('Reporting-currency conversion is unavailable because no verified FX-rate service is configured. Native currency mode remains active.');
 $('fmRefresh').onclick=refresh;$('fmNew').onclick=()=>openNew('expense');$('fmDrawerClose').onclick=closeDrawer;$('fmBackdrop').onclick=closeDrawer;$('fmModalClose').onclick=()=> $('fmModal').close();
 $('fmSearch').placeholder='Search finance or type a command: add expense, upload statement, create report';
 $('fmSearch').onkeydown=e=>{if(e.key==='Enter'){const value=e.currentTarget.value.trim();if(runFinanceCommand(value))return;globalFinanceSearch(value)}};
}
document.addEventListener('DOMContentLoaded',async()=>{
 bind();const h=location.hash.slice(1);if(NAV.some(x=>x[0]===h)||h==='more')state.view=h;navButtons();
 try{
  const cycle=await loadBase();render();signalFinanceReady();
  void hydrateSupplementary(cycle).catch(error=>notice(error.message||'Some Finance services could not be loaded.',true));
 }catch(error){renderFinanceFatal(error)}
})
})();
