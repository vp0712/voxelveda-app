(() => {
'use strict';

const MOUNT_ID='financeAdvancedControlMount';
const VERSION='20260924-advanced-control-v10';
const state={loading:false,data:{},errors:{},scenario:{currency:'AUD',monthlyIncomeDelta:0,monthlySpendingDelta:0,oneTimeCost:0,monthlySavingTarget:0},compare:{horizon:365,a:{label:'Plan A',monthlyIncomeDelta:0,monthlySpendingDelta:0,oneTimeCost:0,monthlySavingTarget:0},b:{label:'Plan B',monthlyIncomeDelta:0,monthlySpendingDelta:0,oneTimeCost:0,monthlySavingTarget:0}}};
const SOURCES=[
  ['personal','/api/finance/personal-money'],
  ['attention','/api/finance/personal-money/attention'],
  ['smart','/api/finance/personal-money/smart'],
  ['health','/api/finance/personal-money/health'],
  ['roadmaps','/api/finance/personal-money/roadmaps'],
  ['integrity','/api/finance/personal-money/data-quality-integrity'],
  ['netWorth','/api/finance/personal-money/net-worth'],
  ['lifecycle','/api/finance/personal-money/net-worth/lifecycle'],
  ['company','/api/finance/company-summary'],
  ['command','/api/finance/banking-os/command-center'],
  ['quality','/api/finance/intelligence/data-quality'],
  ['issues','/api/finance/issues'],
  ['receipts','/api/finance/receipts'],
  ['reimbursements','/api/finance/reimbursements'],
  ['rules','/api/finance/intelligence/rules'],
  ['notifications','/api/notifications'],
  ['bankingOps','/api/finance/banking-os'],
  ['readiness','/api/finance/intelligence/banking-readiness'],
  ['reviewInbox','/api/finance/personal-money/review-inbox'],
  ['closeAssurance','/api/finance/close-assurance'],
  ['treasury','/api/finance/treasury-control'],
  ['performanceRisk','/api/finance/performance-risk-control'],
  ['anomalyExplain','/api/finance/anomaly-explain-control'],
  ['planning','/api/finance/planning-control'],
  ['jobProfitability','/api/finance/job-profitability'],
  ['counterparty','/api/finance/counterparty-control'],
  ['handover','/api/finance/accountant-handover']
];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v||0);
const todayIso=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
const money=(v,c='AUD')=>{try{return new Intl.NumberFormat('en-AU',{style:'currency',currency:c||'AUD',maximumFractionDigits:2}).format(num(v))}catch{return num(v).toFixed(2)+' '+(c||'AUD')}};
const date=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(String(v).slice(0,10)+'T00:00:00'))}catch{return String(v)}};
const tone=s=>{s=String(s||'').toUpperCase();if(['URGENT','CRITICAL','HIGH','FAILED','OVERDUE'].includes(s))return 'high';if(['MEDIUM','WATCH','WARNING','ACTION_SOON','REVIEW'].includes(s))return 'watch';return 'ok'};
const statusChip=(label)=>'<span class="fac-chip '+tone(label)+'">'+esc(String(label||'INFO').replaceAll('_',' '))+'</span>';

function style(){
 if(document.querySelector('style[data-finance-advanced-control]'))return;
 const s=document.createElement('style');s.dataset.financeAdvancedControl='1';
 s.textContent=`
 .fac{display:grid;gap:14px}.fac-hero{padding:20px;border:1px solid rgba(87,126,255,.26);border-radius:20px;background:linear-gradient(135deg,rgba(30,64,175,.08),rgba(14,116,144,.06));box-shadow:0 16px 40px rgba(0,0,0,.05)}
 .fac-hero h2{margin:4px 0 6px;font-size:clamp(1.35rem,3vw,2rem)}.fac-hero p{margin:0;color:var(--muted,#687386)}.fac-eyebrow{font-size:.72rem;font-weight:900;letter-spacing:.12em;color:#4f6fdf}
 .fac-toolbar,.fac-jumps,.fac-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fac-toolbar{margin-top:14px}.fac-toolbar button,.fac-jumps button{min-height:40px}.fac-jumps{margin-top:10px}
 .fac-section{scroll-margin-top:110px}.fac-section>header{display:flex;justify-content:space-between;gap:14px;align-items:flex-end;margin-bottom:9px}.fac-section>header h3{margin:0;font-size:1.05rem}.fac-section>header p{margin:3px 0 0;color:var(--muted,#687386);font-size:.84rem}
 .fac-grid{display:grid;gap:10px}.fac-grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}.fac-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.fac-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
 .fac-card{padding:14px;border:1px solid rgba(127,127,127,.16);border-radius:15px;background:var(--panel,#fff);min-width:0}.fac-card small{color:var(--muted,#687386)}.fac-card strong{display:block;font-size:1.18rem;margin-top:5px}.fac-card h4{margin:0 0 7px}
 .fac-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.fac-kpi{padding:13px;border:1px solid rgba(127,127,127,.16);border-radius:14px;background:rgba(127,127,127,.025)}.fac-kpi span{font-size:.72rem;color:var(--muted,#687386);text-transform:uppercase;letter-spacing:.04em}.fac-kpi b{display:block;margin-top:5px;font-size:1.12rem}
 .fac-list{display:grid;gap:8px}.fac-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:11px;border:1px solid rgba(127,127,127,.14);border-radius:12px}.fac-row h4{margin:0 0 3px;font-size:.92rem}.fac-row p{margin:0;color:var(--muted,#687386);font-size:.8rem}.fac-right{text-align:right;display:grid;gap:4px;justify-items:end}
 .fac-chip{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:.68rem;font-weight:850;background:rgba(59,130,246,.1)}.fac-chip.high{background:rgba(239,68,68,.12);color:#b42318}.fac-chip.watch{background:rgba(245,158,11,.14);color:#9a6700}.fac-chip.ok{background:rgba(34,197,94,.12);color:#16794a}
 .fac-table-wrap{overflow:auto}.fac-table{width:100%;border-collapse:collapse;min-width:650px}.fac-table th,.fac-table td{padding:8px;border-bottom:1px solid rgba(127,127,127,.14);text-align:left;font-size:.8rem}.fac-table th{font-size:.7rem;text-transform:uppercase;color:var(--muted,#687386);letter-spacing:.04em}
 .fac-bars{display:grid;gap:7px}.fac-bar{display:grid;grid-template-columns:minmax(110px,1fr) 3fr auto;gap:8px;align-items:center;font-size:.78rem}.fac-bar-track{height:8px;border-radius:999px;background:rgba(127,127,127,.12);overflow:hidden}.fac-bar-track i{display:block;height:100%;background:currentColor}
 .fac-scenario{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.fac-scenario label{display:grid;gap:5px;font-size:.78rem}.fac-scenario input,.fac-scenario select{width:100%}.fac-note{padding:12px;border:1px dashed rgba(127,127,127,.25);border-radius:13px;color:var(--muted,#687386);font-size:.8rem}
 .fac-loading{padding:24px;text-align:center;border:1px dashed rgba(127,127,127,.25);border-radius:16px}.fac-source{font-size:.73rem;color:var(--muted,#687386)}.fac-empty{padding:14px;border:1px dashed rgba(127,127,127,.22);border-radius:12px;color:var(--muted,#687386)}
 .fac-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fac-check{display:flex;justify-content:space-between;gap:10px;padding:10px;border:1px solid rgba(127,127,127,.14);border-radius:11px;align-items:center}
 @media(max-width:950px){.fac-grid.four,.fac-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.fac-grid.three{grid-template-columns:1fr 1fr}.fac-scenario{grid-template-columns:1fr 1fr}}
 @media(max-width:650px){.fac-grid.four,.fac-grid.three,.fac-grid.two,.fac-kpis,.fac-control-grid,.fac-scenario{grid-template-columns:1fr}.fac-section>header,.fac-row{flex-direction:column}.fac-right{text-align:left;justify-items:start}.fac-toolbar>*{flex:1;min-width:130px}.fac-jumps{display:grid;grid-template-columns:1fr 1fr}.fac-bar{grid-template-columns:1fr}.fac-bar-track{order:3}}
 `;
 document.head.appendChild(s);
}

async function get(name,url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch(url,{credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}});
  let body={};try{body=await r.json()}catch{}
  if(!r.ok){const e=new Error(body.message||('Request failed ('+r.status+')'));e.status=r.status;throw e}
  state.data[name]=body;delete state.errors[name];return body;
 }catch(e){
  state.errors[name]=e?.name==='AbortError'?'Timed out':e.message||'Unavailable';return null;
 }finally{clearTimeout(timer)}
}
async function load(){
 if(state.loading)return;state.loading=true;
 const root=document.getElementById(MOUNT_ID);if(!root){state.loading=false;return}
 root.innerHTML='<div class="fac-loading"><b>Building Advanced Finance Control…</b><p>Loading protected finance evidence in bounded batches.</p></div>';
 state.data={};state.errors={};
 for(let i=0;i<SOURCES.length;i+=4)await Promise.allSettled(SOURCES.slice(i,i+4).map(([n,u])=>get(n,u)));
 state.loading=false;render();
}

function currencies(){
 const set=new Set();
 const h=state.data.health?.by_currency||{};Object.keys(h).forEach(x=>set.add(x));
 const s=state.data.smart?.safe_to_spend_by_currency||{};Object.keys(s).forEach(x=>set.add(x));
 const n=state.data.netWorth?.totals_by_currency||{};Object.keys(n).forEach(x=>set.add(x));
 const p=state.data.personal?.wallet_totals||{};Object.keys(p).forEach(x=>set.add(x));
 const c=state.data.command?.summary_by_currency||{};Object.keys(c).forEach(x=>set.add(x));
 if(!set.size)set.add('AUD');return [...set].sort();
}
function visibleFunds(cur){
 const row=state.data.smart?.safe_to_spend_by_currency?.[cur]||{};
 if(row.visible_funds!==undefined&&row.visible_funds!==null)return num(row.visible_funds);
 const h=state.data.health?.by_currency?.[cur]||{};
 return num(h.bank_balance)+num(h.manual_wallet_balance);
}
function safeSpend(cur){return num(state.data.smart?.safe_to_spend_by_currency?.[cur]?.safe_to_spend)}
function netWorth(cur){
 const x=state.data.netWorth?.totals_by_currency?.[cur];
 if(x)return num(x.net_worth);
 const values=Object.values(state.data.netWorth?.totals_by_currency||{});const row=values.find(r=>String(r.currency||'').toUpperCase()===cur);return num(row?.net_worth);
}
function monthlyFlow(cur){
 const h=state.data.health?.by_currency?.[cur]||{};
 return {income:num(h.current_month_income),spend:num(h.current_month_spending),avgSpend:num(h.average_monthly_spending_90d),runway:h.runway_months};
}
function addMonthsClamped(dateObj,months){
 const d=new Date(dateObj.getTime()),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+months);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return d;
}
function nextRecurring(dateObj,freq){
 const d=new Date(dateObj.getTime());freq=String(freq||'MONTHLY').toUpperCase();
 if(freq==='WEEKLY'){d.setDate(d.getDate()+7);return d}
 if(freq==='FORTNIGHTLY'){d.setDate(d.getDate()+14);return d}
 if(freq==='QUARTERLY')return addMonthsClamped(d,3);
 if(freq==='YEARLY')return addMonthsClamped(d,12);
 return addMonthsClamped(d,1);
}
function knownProjection(cur,days){
 const start=new Date(todayIso()+'T00:00:00'),end=new Date(start.getTime()+days*86400000);
 let inflow=0,outflow=0,count=0;
 for(const r of state.data.attention?.recurring||[]){
  if(String(r.currency||'AUD').toUpperCase()!==cur||!r.next_due_date)continue;
  let d=new Date(String(r.next_due_date).slice(0,10)+'T00:00:00');
  if(Number.isNaN(d.getTime()))continue;
  let guard=0;
  while(d<=end&&guard<400){
   if(d>=start){const a=num(r.amount);if(String(r.item_type||'').toUpperCase()==='INCOME')inflow+=a;else outflow+=a;count++}
   d=nextRecurring(d,r.frequency);guard++;
  }
 }
 return {days,inflow,outflow,net:inflow-outflow,events:count,projected:visibleFunds(cur)+inflow-outflow};
}
function scenarioProjection(cur,days){
 const base=knownProjection(cur,days),months=days/30.4375,s=state.scenario;
 const delta=(num(s.monthlyIncomeDelta)-num(s.monthlySpendingDelta)-num(s.monthlySavingTarget))*months-num(s.oneTimeCost);
 return {...base,scenario_delta:delta,scenario_projected:base.projected+delta};
}

function actionQueue(){
 const out=[];
 for(const a of state.data.attention?.alerts||[])out.push({severity:a.severity||'MEDIUM',title:a.title||'Personal finance alert',detail:a.explanation||a.action||'',source:'Personal Attention'});
 for(const f of state.data.integrity?.findings||[])out.push({severity:f.severity||'WATCH',title:f.title||f.type||'Integrity review',detail:(f.count?f.count+' item(s) · ':'')+(f.next_step||f.why||''),source:'Integrity'});
 for(const a of state.data.lifecycle?.alerts||[])out.push({severity:a.priority||'MEDIUM',title:a.title||a.kind||'Asset/lifecycle reminder',detail:a.detail||'',source:'Protection'});
 for(const a of state.data.command?.attention||[])out.push({severity:a.severity||'MEDIUM',title:String(a.code||'Banking attention').replaceAll('_',' '),detail:a.message||'',source:'Banking'});
 const rc=state.data.receipts?.counts||{};if(num(rc.missing)+num(rc.requested)>0)out.push({severity:'WATCH',title:'Receipt evidence needs attention',detail:(num(rc.missing)+num(rc.requested))+' receipt item(s) missing or requested.',source:'Receipts'});
 for(const i of state.data.issues?.issues||[]){if(['OPEN','IN_PROGRESS'].includes(String(i.status||'').toUpperCase()))out.push({severity:i.overdue?'HIGH':i.severity||'REVIEW',title:i.title||'Finance control action',detail:(i.assignee_name?'Owner '+i.assignee_name:'Unassigned')+(i.due_date?' · due '+date(i.due_date):'')+(i.message?' · '+i.message:''),source:'Control Actions'});}
 return out.sort((a,b)=>({URGENT:0,CRITICAL:0,HIGH:1,MEDIUM:2,WATCH:2,LOW:3}[String(a.severity).toUpperCase()]??4)-({URGENT:0,CRITICAL:0,HIGH:1,MEDIUM:2,WATCH:2,LOW:3}[String(b.severity).toUpperCase()]??4));
}

function executive(){
 const cs=currencies();
 const rows=cs.map(cur=>{
  const f=monthlyFlow(cur),cmd=state.data.command?.summary_by_currency?.[cur]||{};
  return '<div class="fac-card"><small>'+esc(cur)+' CONTROL POSITION</small><strong>'+money(visibleFunds(cur),cur)+'</strong><div class="fac-source">Visible personal funds</div><div class="fac-kpis" style="grid-template-columns:1fr 1fr;margin-top:10px"><div><span>Safe to spend</span><b>'+money(safeSpend(cur),cur)+'</b></div><div><span>Net worth</span><b>'+money(netWorth(cur),cur)+'</b></div><div><span>90d avg spend/mo</span><b>'+money(f.avgSpend,cur)+'</b></div><div><span>Banking 30d liquidity</span><b>'+money(cmd.projected_liquidity_30d,cur)+'</b></div></div></div>';
 }).join('');
 const queue=actionQueue();
 const critical=queue.filter(x=>['URGENT','CRITICAL','HIGH'].includes(String(x.severity).toUpperCase())).length;
 const integrity=state.data.integrity?.summary||{};
 const rc=state.data.receipts?.counts||{};
 return '<section id="facExecutive" class="fac-section"><header><div><h3>Executive Cockpit</h3><p>Personal, banking, company and evidence controls without collapsing currencies.</p></div>'+statusChip(critical?'HIGH ATTENTION':'CONTROLLED')+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>High-priority actions</span><b>'+critical+'</b><small>From current protected sources</small></div><div class="fac-kpi"><span>Unclassified transactions</span><b>'+num(integrity.unclassified_bank_transactions)+'</b><small>Personal integrity</small></div><div class="fac-kpi"><span>Unreconciled transactions</span><b>'+num(integrity.unreconciled_bank_transactions)+'</b><small>Personal integrity</small></div><div class="fac-kpi"><span>Receipt exceptions</span><b>'+(num(rc.missing)+num(rc.requested))+'</b><small>Missing + requested</small></div></div>'+
 '<div class="fac-grid '+(cs.length>1?'two':'')+'" style="margin-top:10px">'+rows+'</div></section>';
}

function executiveReadinessBoard(){
 const q=state.data.integrity?.summary||{},h=state.data.handover||{},p=state.data.performanceRisk?.summary||{},i=state.data.issues?.summary||{},a=state.data.anomalyExplain?.summary||{},rc=state.data.receipts?.counts||{};
 const approvals=state.data.command?.approval_inbox||[],dataIssues=num(q.unclassified_bank_transactions)+num(q.unreconciled_bank_transactions)+num(q.possible_duplicate_groups)+num(q.possible_missing_periods);
 const receiptIssues=num(rc.missing)+num(rc.requested),approvalCount=Array.isArray(approvals)?approvals.length:0;
 const dims=[
  ['Data integrity',dataIssues===0?'CLEAR':dataIssues<=5?'WATCH':'HIGH',num(q.unclassified_bank_transactions)+' unclassified · '+num(q.unreconciled_bank_transactions)+' unreconciled','review'],
  ['Liquidity & stress',num(p.high_signal_count)>0?'HIGH':num(p.watch_signal_count)>0?'WATCH':'CLEAR',num(p.high_signal_count)+' high · '+num(p.watch_signal_count)+' watch','performance'],
  ['Close & evidence',num(h.blocker_count)>0?'HIGH':num(h.warning_count)>0?'WATCH':'CLEAR',num(h.blocker_count)+' blocker(s) · '+num(h.warning_count)+' warning(s)','handover'],
  ['Control actions',num(i.overdue_active)>0?'HIGH':num(i.open_count)+num(i.in_progress_count)>0?'WATCH':'CLEAR',num(i.open_count)+' open · '+num(i.in_progress_count)+' in progress · '+num(i.overdue_active)+' overdue','controlactions'],
  ['Approvals & receipts',approvalCount+receiptIssues>0?'WATCH':'CLEAR',approvalCount+' approval(s) · '+receiptIssues+' receipt exception(s)','bankops'],
  ['Job allocation evidence',num(state.data.jobProfitability?.allocation?.unallocated_transaction_count)>0?'WATCH':'CLEAR',num(state.data.jobProfitability?.allocation?.unallocated_transaction_count)+' unallocated economic record(s) · '+num(state.data.jobProfitability?.allocation?.allocation_coverage_percent).toFixed(1)+'% coverage','profitability'],
  ['Explainability confidence',num(a.low_readiness_positions)>0?'WATCH':'CLEAR',num(a.low_readiness_positions)+' low-readiness · '+num(a.outlier_count)+' outlier(s)','anomaly']
 ];
 const high=dims.filter(x=>x[1]==='HIGH').length,watch=dims.filter(x=>x[1]==='WATCH').length,clear=dims.length-high-watch;
 const rows=dims.map(x=>'<div class="fac-check"><div><b>'+esc(x[0])+'</b><div class="fac-source">'+esc(x[2])+'</div></div><div class="fac-right">'+statusChip(x[1])+'<button data-fac-open="'+x[3]+'">Open</button></div></div>').join('');
 const brief=actionQueue().slice(0,6).map(x=>'<div class="fac-row"><div><h4>'+esc(x.title)+'</h4><p>'+esc((x.source?x.source+' · ':'')+(x.detail||'Review current control signal.'))+'</p></div><div class="fac-right">'+statusChip(x.severity||'REVIEW')+'</div></div>').join('');
 return '<section id="facReadiness" class="fac-section"><header><div><h3>Executive Control Readiness Board</h3><p>Independent CFO control dimensions. No fake composite finance score and no cross-currency aggregation.</p></div>'+statusChip(high?'HIGH':watch?'WATCH':'CLEAR')+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>High attention</span><b>'+high+'</b><small>Immediate control review</small></div><div class="fac-kpi"><span>Watch</span><b>'+watch+'</b><small>Needs review or evidence</small></div><div class="fac-kpi"><span>Clear</span><b>'+clear+'</b><small>Current checks clear</small></div><div class="fac-kpi"><span>Dimensions</span><b>'+dims.length+'</b><small>Kept independent</small></div></div>'+
 '<div class="fac-control-grid" style="margin-top:10px">'+rows+'</div>'+
 '<article class="fac-card" style="margin-top:10px"><h4>CFO Daily Brief</h4><div class="fac-list">'+(brief||'<div class="fac-empty">No high-priority current control signal.</div>')+'</div><div class="fac-toolbar"><button data-fac-open="controlactions">Control Actions</button><button data-fac-open="anomaly">Explainability</button><button data-fac-open="performance">Performance</button><button data-fac-open="handover">Handover</button></div></article>'+
 '<div class="fac-note">Readiness dimensions are not averaged into one score. Each uses its own evidence and keeps currencies separate.</div></section>';
}
function actions(){
 const rows=actionQueue().slice(0,40).map(a=>'<div class="fac-row"><div><h4>'+esc(a.title)+'</h4><p>'+esc(a.detail||'Review the underlying source before making a change.')+'</p><small class="fac-source">'+esc(a.source)+'</small></div><div class="fac-right">'+statusChip(a.severity)+'</div></div>').join('');
 return '<section id="facActions" class="fac-section"><header><div><h3>Action Queue</h3><p>One prioritised queue; no automatic posting, payment, deletion, reconciliation or classification.</p></div><span class="fac-source">'+actionQueue().length+' current signal(s)</span></header><div class="fac-list">'+(rows||'<div class="fac-empty">No current action signal was returned.</div>')+'</div></section>';
}

function forecast(){
 const cs=currencies(),horizons=[7,30,90,365];
 const tables=cs.map(cur=>'<article class="fac-card"><h4>'+esc(cur)+' known-schedule forecast</h4><div class="fac-table-wrap"><table class="fac-table"><thead><tr><th>Horizon</th><th>Starting funds</th><th>Known income</th><th>Known outflows</th><th>Known projection</th></tr></thead><tbody>'+
 horizons.map(d=>{const p=knownProjection(cur,d);return '<tr><td>'+d+' days</td><td>'+money(visibleFunds(cur),cur)+'</td><td>'+money(p.inflow,cur)+'</td><td>'+money(p.outflow,cur)+'</td><td><b>'+money(p.projected,cur)+'</b></td></tr>'}).join('')+
 '</tbody></table></div><p class="fac-source">Uses recorded recurring items only. Unknown discretionary spending, fees, interest, investment return and unrecorded income are excluded.</p></article>').join('');
 return '<section id="facForecast" class="fac-section"><header><div><h3>7 / 30 / 90 / 365-day Forecast</h3><p>Evidence-backed recurring schedule projection by native currency.</p></div></header><div class="fac-grid '+(cs.length>1?'two':'')+'">'+tables+'</div></section>';
}

function scenario(){
 const cs=currencies();if(!cs.includes(state.scenario.currency))state.scenario.currency=cs[0];
 const cur=state.scenario.currency,horizons=[7,30,90,365];
 const cards=horizons.map(d=>{const p=scenarioProjection(cur,d);return '<div class="fac-kpi"><span>'+d+' DAY SCENARIO</span><b>'+money(p.scenario_projected,cur)+'</b><small>Base '+money(p.projected,cur)+' · scenario impact '+money(p.scenario_delta,cur)+'</small></div>'}).join('');
 return '<section id="facScenario" class="fac-section"><header><div><h3>Scenario Lab</h3><p>Change assumptions locally without writing to the ledger.</p></div><span class="fac-chip ok">NO DATA MUTATION</span></header>'+
 '<div class="fac-card"><div class="fac-scenario"><label>Currency<select id="facScenarioCurrency">'+cs.map(c=>'<option '+(c===cur?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select></label><label>Monthly income change<input id="facIncomeDelta" type="number" step="0.01" value="'+esc(state.scenario.monthlyIncomeDelta)+'"></label><label>Monthly spending change<input id="facSpendDelta" type="number" step="0.01" value="'+esc(state.scenario.monthlySpendingDelta)+'"></label><label>One-time cost<input id="facOneTime" type="number" step="0.01" min="0" value="'+esc(state.scenario.oneTimeCost)+'"></label><label>Monthly savings target<input id="facSavingTarget" type="number" step="0.01" min="0" value="'+esc(state.scenario.monthlySavingTarget)+'"></label></div><div class="fac-kpis" style="margin-top:12px">'+cards+'</div><div class="fac-note" style="margin-top:10px">Scenario values are temporary planning assumptions only. They do not change balances, budgets, goals, repayments, bank transactions or accounting records.</div></div></section>';
}

function recurringDebt(){
 const recurring=(state.data.attention?.recurring||[]).filter(r=>String(r.item_type||'').toUpperCase()!=='INCOME');
 const debts=state.data.personal?.debts||[];
 const byCur={};
 recurring.forEach(r=>{const c=r.currency||'AUD';(byCur[c]??={monthly:0,annual:0,count:0});const f={WEEKLY:52,FORTNIGHTLY:26,MONTHLY:12,QUARTERLY:4,YEARLY:1}[String(r.frequency||'').toUpperCase()]||0;byCur[c].annual+=num(r.amount)*f;byCur[c].monthly+=num(r.amount)*f/12;byCur[c].count++});
 const summary=Object.entries(byCur).map(([c,x])=>'<div class="fac-kpi"><span>'+esc(c)+' recurring</span><b>'+money(x.monthly,c)+'/mo</b><small>'+money(x.annual,c)+'/yr · '+x.count+' item(s)</small></div>').join('');
 const rRows=recurring.slice(0,20).map(r=>'<div class="fac-row"><div><h4>'+esc(r.name||'Recurring item')+'</h4><p>'+esc(r.item_type||'BILL')+' · '+esc(r.frequency||'')+' · next '+date(r.next_due_date)+'</p></div><div class="fac-right"><b>'+money(r.amount,r.currency||'AUD')+'</b></div></div>').join('');
 const dRows=debts.filter(d=>String(d.status||'').toUpperCase()!=='SETTLED').slice(0,20).map(d=>'<div class="fac-row"><div><h4>'+esc(d.counterparty||'Debt')+'</h4><p>'+esc(d.direction||'')+' · due '+date(d.due_date)+'</p></div><div class="fac-right"><b>'+money(d.outstanding_amount,d.currency||'AUD')+'</b>'+statusChip(d.due_date&&String(d.due_date).slice(0,10)<todayIso()?'OVERDUE':d.status||'OPEN')+'</div></div>').join('');
 return '<section id="facPersonal" class="fac-section"><header><div><h3>Subscription, Debt & Savings Intelligence</h3><p>Recurring cost pressure, borrowed/lent exposure and goal context.</p></div></header><div class="fac-kpis">'+(summary||'<div class="fac-kpi"><span>Recurring</span><b>—</b><small>No recorded recurring outflow.</small></div>')+'</div><div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Recurring / subscriptions</h4><div class="fac-list">'+(rRows||'<div class="fac-empty">No recurring outgoing item.</div>')+'</div></article><article class="fac-card"><h4>Borrowed / lent money</h4><div class="fac-list">'+(dRows||'<div class="fac-empty">No open debt record.</div>')+'</div></article></div></section>';
}

function riskIntegrity(){
 const findings=state.data.integrity?.findings||[],life=state.data.lifecycle?.alerts||[],cmd=state.data.command?.attention||[];
 const all=[
  ...findings.map(x=>({severity:x.severity,title:x.title,detail:(x.count?x.count+' item(s) · ':'')+(x.why||x.next_step||'')})),
  ...life.map(x=>({severity:x.priority,title:x.title,detail:x.detail})),
  ...cmd.map(x=>({severity:x.severity,title:String(x.code||'Banking').replaceAll('_',' '),detail:x.message}))
 ];
 const rows=all.slice(0,30).map(x=>'<div class="fac-row"><div><h4>'+esc(x.title||'Risk signal')+'</h4><p>'+esc(x.detail||'')+'</p></div><div class="fac-right">'+statusChip(x.severity)+'</div></div>').join('');
 const s=state.data.integrity?.summary||{};
 const checks=[
  ['Duplicate review',num(s.possible_duplicate_groups)===0,num(s.possible_duplicate_groups)+' group(s)'],
  ['History coverage gaps',num(s.possible_missing_periods)===0,num(s.possible_missing_periods)+' possible gap(s)'],
  ['Classification',num(s.unclassified_bank_transactions)===0,num(s.unclassified_bank_transactions)+' unclassified'],
  ['Reconciliation',num(s.unreconciled_bank_transactions)===0,num(s.unreconciled_bank_transactions)+' unreconciled'],
  ['Cash detail',num(s.unclassified_cash_movements)===0,num(s.unclassified_cash_movements)+' incomplete cash record(s)'],
  ['Wallet double-count risk',num(s.wallet_bank_double_count_risks)===0,num(s.wallet_bank_double_count_risks)+' signal(s)']
 ];
 return '<section id="facRisk" class="fac-section"><header><div><h3>Risk, Integrity & Control Readiness</h3><p>Concrete data-quality and operational risk signals—not invented financial advice.</p></div></header><div class="fac-control-grid">'+checks.map(([n,ok,d])=>'<div class="fac-check"><div><b>'+esc(n)+'</b><div class="fac-source">'+esc(d)+'</div></div>'+statusChip(ok?'CLEAR':'REVIEW')+'</div>').join('')+'</div><div class="fac-list" style="margin-top:10px">'+(rows||'<div class="fac-empty">No active risk/control signal returned.</div>')+'</div></section>';
}

function taxEvidence(){
 const tax=state.data.health?.tax_readiness||{},docs=state.data.lifecycle?.documents||[],issues=state.data.integrity?.summary||{};
 const fy=tax.financial_year?.label||'Current FY',review=(tax.review_items||[]).length;
 const expiring=docs.filter(d=>d.days_until_expiry!==null&&d.days_until_expiry!==undefined&&num(d.days_until_expiry)<=30).length;
 const checklist=[
  ['Transactions classified',num(issues.unclassified_bank_transactions)===0,num(issues.unclassified_bank_transactions)+' remaining'],
  ['Transactions reconciled',num(issues.unreconciled_bank_transactions)===0,num(issues.unreconciled_bank_transactions)+' remaining'],
  ['Duplicate groups reviewed',num(issues.possible_duplicate_groups)===0,num(issues.possible_duplicate_groups)+' possible group(s)'],
  ['History gaps reviewed',num(issues.possible_missing_periods)===0,num(issues.possible_missing_periods)+' possible period(s)'],
  ['Evidence expiry',expiring===0,expiring+' due/expired within 30d']
 ];
 const cat=(tax.categories||[]).slice(0,12);
 const max=Math.max(1,...cat.map(x=>num(x.amount)));
 return '<section id="facYearEnd" class="fac-section"><header><div><h3>Tax, Evidence & Year-End Readiness</h3><p>Preparation controls only; this does not calculate tax liability or legal deductibility.</p></div><span class="fac-chip watch">'+esc(fy)+'</span></header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Tax review items</span><b>'+review+'</b><small>Preparation queue</small></div><div class="fac-kpi"><span>Private document refs</span><b>'+docs.length+'</b><small>Owner-only evidence references</small></div><div class="fac-kpi"><span>Evidence due/expired</span><b>'+expiring+'</b><small>Within 30 days</small></div><div class="fac-kpi"><span>Accountant questions</span><b>'+num(state.data.company?.open_accountant_queries)+'</b><small>Company finance</small></div></div>'+
 '<div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Year-end control checklist</h4><div class="fac-list">'+checklist.map(([n,ok,d])=>'<div class="fac-check"><div><b>'+esc(n)+'</b><div class="fac-source">'+esc(d)+'</div></div>'+statusChip(ok?'CLEAR':'REVIEW')+'</div>').join('')+'</div></article><article class="fac-card"><h4>Review categories</h4><div class="fac-bars">'+(cat.map(x=>'<div class="fac-bar"><span>'+esc(x.category||'Uncategorised')+'</span><div class="fac-bar-track"><i style="width:'+Math.min(100,num(x.amount)/max*100)+'%"></i></div><b>'+money(x.amount,x.currency||'AUD')+'</b></div>').join('')||'<div class="fac-empty">No tax-preparation category data.</div>')+'</div></article></div><div class="fac-note" style="margin-top:10px">Recorded income is not automatically taxable income. Review candidates are not deduction claims. Currencies remain separate unless verified FX evidence exists.</div></section>';
}

function companyCfo(){
 const c=state.data.company||{},cmd=state.data.command||{},close=state.data.closeAssurance||{},cur=c.currency||'AUD';
 const by=cmd.summary_by_currency||{};
 const rows=Object.entries(by).map(([cc,x])=>'<div class="fac-row"><div><h4>'+esc(cc)+' liquidity</h4><p>Runway '+(x.runway_days===null||x.runway_days===undefined?'—':esc(x.runway_days)+' days')+' · merchant concentration '+num(x.merchant_concentration_percent).toFixed(1)+'%</p></div><div class="fac-right"><b>'+money(x.projected_liquidity_30d,cc)+'</b><small>projected 30d liquidity</small></div></div>').join('');
 return '<section id="facCompany" class="fac-section"><header><div><h3>Company CFO Control</h3><p>Receivables, payables, approvals, liquidity and accounting attention.</p></div></header><div class="fac-kpis"><div class="fac-kpi"><span>Customer receivables</span><b>'+money(c.customer_receivables,cur)+'</b><small>'+num(c.open_customer_invoice_count)+' open invoice(s)</small></div><div class="fac-kpi"><span>Supplier payables</span><b>'+money(c.supplier_payables,cur)+'</b><small>'+num(c.supplier_bill_count)+' outstanding bill(s)</small></div><div class="fac-kpi"><span>Pending supplier approvals</span><b>'+num(c.pending_supplier_approvals)+'</b><small>Company workflow</small></div><div class="fac-kpi"><span>Open accountant queries</span><b>'+num(c.open_accountant_queries)+'</b><small>Company accounting</small></div><div class="fac-kpi"><span>Month-end close readiness</span><b>'+esc(close.readiness_status||'—')+'</b><small>'+num(close.blocker_count)+' blocker(s) · '+num(close.warning_count)+' warning(s)</small></div></div><div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Banking command metrics</h4><div class="fac-list">'+(rows||'<div class="fac-empty">No banking command metrics available.</div>')+'</div></article><article class="fac-card"><h4>Control notes</h4><div class="fac-list"><div class="fac-row"><div><h4>GST registration</h4><p>'+esc(c.gst_registration||'UNKNOWN')+'</p></div>'+statusChip(c.gst_registration&&c.gst_registration!=='UNKNOWN'?'CONFIGURED':'REVIEW')+'</div><div class="fac-row"><div><h4>Payment approvals waiting</h4><p>'+num(cmd.approval_inbox?.length)+' approval item(s) returned for your role.</p></div>'+statusChip(cmd.approval_inbox?.length?'REVIEW':'CLEAR')+'</div><div class="fac-row"><div><h4>Close & Assurance</h4><p>'+esc(close.period?.period_key||'Current period')+' · '+esc(close.run?.status||'not certified')+'</p></div><div class="fac-right">'+statusChip(close.blocker_count?'HIGH':close.run?.status==='CERTIFIED'?'CLEAR':'REVIEW')+'<button data-fac-open="closeassurance">Open close</button></div></div><div class="fac-row"><div><h4>Overdue obligations</h4><p>'+num(cmd.obligations?.overdue)+' overdue payment instruction(s).</p></div>'+statusChip(cmd.obligations?.overdue?'HIGH':'CLEAR')+'</div></div></article></div></section>';
}

function accountantHandoverStatus(){
 const h=state.data.handover||{},g=h.gaps||{},c=h.close||{};
 return '<section id="facHandover" class="fac-section"><header><div><h3>Accountant Handover Readiness</h3><p>Company-only year-end evidence status with versioned handover snapshots.</p></div>'+statusChip(h.handover_status||'REVIEW')+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Blockers</span><b>'+num(h.blocker_count)+'</b><small>Must be resolved before clean handover</small></div><div class="fac-kpi"><span>Warnings</span><b>'+num(h.warning_count)+'</b><small>Review before external delivery</small></div><div class="fac-kpi"><span>Certified periods</span><b>'+num(c.certified)+' / '+num(c.period_count)+'</b><small>'+num(c.snapshots)+' close snapshot(s)</small></div><div class="fac-kpi"><span>Evidence snapshots</span><b>'+((h.exports||[]).length)+'</b><small>Versioned SHA-256 manifests</small></div></div>'+
 '<div class="fac-list" style="margin-top:10px"><div class="fac-row"><div><h4>Bank evidence gaps</h4><p>'+num(g.bank_unreconciled)+' unreconciled · '+num(g.bank_unclassified)+' unclassified · '+num(g.missing_receipts)+' missing receipt(s)</p></div>'+statusChip(num(g.bank_unreconciled)+num(g.bank_unclassified)+num(g.missing_receipts)?'REVIEW':'CLEAR')+'</div><div class="fac-row"><div><h4>Year-end workflow</h4><p>'+num(g.open_accountant_queries)+' open accountant question(s) · '+num(g.periods_not_certified)+' period(s) not certified</p></div><div class="fac-right"><button data-fac-open="handover">Open handover</button></div></div></div></section>';
}
function automationApprovalControl(){
 const approvals=state.data.command?.approval_inbox||state.data.bankingOps?.approval_inbox||[];
 const rules=state.data.rules?.rules||state.data.rules||[];
 const notices=state.data.notifications?.notifications||[];
 const reviews=state.data.reviewInbox?.items||state.data.reviewInbox?.matches||state.data.reviewInbox?.reviews||[];
 const readiness=state.data.readiness||{};
 const capability=readiness.overall_status||readiness.status||readiness.readiness_status||'REVIEW';
 const approvalRows=(Array.isArray(approvals)?approvals:[]).slice(0,12).map(x=>'<div class="fac-row"><div><h4>'+esc(x.title||x.payee_name||x.reference||'Payment approval')+'</h4><p>'+esc(x.message||x.description||x.status||'Approval workflow item')+'</p></div><div class="fac-right">'+statusChip(x.status||x.severity||'REVIEW')+'</div></div>').join('');
 const reviewRows=(Array.isArray(reviews)?reviews:[]).slice(0,10).map(x=>'<div class="fac-row"><div><h4>'+esc(x.title||x.merchant_name||x.description||'Recurring review')+'</h4><p>'+esc(x.message||x.reason||x.status||'Review suggested recurring match')+'</p></div><div class="fac-right">'+statusChip(x.status||'REVIEW')+'</div></div>').join('');
 return '<section id="facAutomation" class="fac-section"><header><div><h3>Automation & Approval Control</h3><p>Rules may suggest or queue work; protected actions still require the canonical review/step-up workflow.</p></div>'+statusChip(capability)+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Payment approvals</span><b>'+((Array.isArray(approvals)?approvals:[]).length)+'</b><small>Role/step-up controlled</small></div><div class="fac-kpi"><span>Categorisation rules</span><b>'+((Array.isArray(rules)?rules:[]).length)+'</b><small>Suggestion automation</small></div><div class="fac-kpi"><span>Recurring reviews</span><b>'+((Array.isArray(reviews)?reviews:[]).length)+'</b><small>Confirm before applying</small></div><div class="fac-kpi"><span>Notifications</span><b>'+((Array.isArray(notices)?notices:[]).length)+'</b><small>Current attention feed</small></div></div>'+
 '<div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Approval inbox</h4><div class="fac-list">'+(approvalRows||'<div class="fac-empty">No payment approval item is currently returned.</div>')+'</div><div class="fac-toolbar"><button data-fac-open="bankops">Open Banking Operations</button><button data-fac-open="team">Team Access</button></div></article><article class="fac-card"><h4>Automation review</h4><div class="fac-list">'+(reviewRows||'<div class="fac-empty">No recurring-match review item is currently returned.</div>')+'</div><div class="fac-toolbar"><button data-fac-open="rules">Rules</button><button data-fac-open="review">Review Centre</button><button data-fac-open="notifications">Alerts</button></div></article></div>'+
 '<div class="fac-note" style="margin-top:10px">Automation boundary: this control centre never auto-approves payments, auto-reconciles transactions, auto-deletes evidence, or silently changes ownership/category. Sensitive execution remains behind the existing protected workflow.</div></section>';
}
function planProjection(cur,plan,days){
 const base=knownProjection(cur,days),months=days/30.4375;
 const delta=(num(plan.monthlyIncomeDelta)-num(plan.monthlySpendingDelta)-num(plan.monthlySavingTarget))*months-num(plan.oneTimeCost);
 return {base:base.projected,delta,projected:base.projected+delta};
}
function decisionIntelligence(){
 const cs=currencies();if(!cs.includes(state.scenario.currency))state.scenario.currency=cs[0];
 const cur=state.scenario.currency,days=Number(state.compare.horizon||365),a=planProjection(cur,state.compare.a,days),b=planProjection(cur,state.compare.b,days);
 const difference=b.projected-a.projected;
 const form=(key,p)=>'<article class="fac-card"><h4>'+esc(p.label)+'</h4><div class="fac-scenario"><label>Label<input data-compare="'+key+'" data-field="label" value="'+esc(p.label)+'"></label><label>Monthly income change<input data-compare="'+key+'" data-field="monthlyIncomeDelta" type="number" step="0.01" value="'+esc(p.monthlyIncomeDelta)+'"></label><label>Monthly spending change<input data-compare="'+key+'" data-field="monthlySpendingDelta" type="number" step="0.01" value="'+esc(p.monthlySpendingDelta)+'"></label><label>One-time cost<input data-compare="'+key+'" data-field="oneTimeCost" type="number" step="0.01" min="0" value="'+esc(p.oneTimeCost)+'"></label><label>Monthly savings target<input data-compare="'+key+'" data-field="monthlySavingTarget" type="number" step="0.01" min="0" value="'+esc(p.monthlySavingTarget)+'"></label></div></article>';
 return '<section id="facDecision" class="fac-section"><header><div><h3>Decision Intelligence — Plan A vs Plan B</h3><p>Compare two planning assumptions against the same known-schedule baseline without writing anything to the ledger.</p></div><span class="fac-chip ok">READ-ONLY MODEL</span></header>'+
 '<div class="fac-card"><div class="fac-inline"><label>Currency <select id="facCompareCurrency">'+cs.map(c=>'<option '+(c===cur?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select></label><label>Horizon <select id="facCompareHorizon">'+[30,90,180,365,730].map(d=>'<option value="'+d+'" '+(days===d?'selected':'')+'>'+d+' days</option>').join('')+'</select></label></div></div>'+
 '<div class="fac-grid two">'+form('a',state.compare.a)+form('b',state.compare.b)+'</div>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>'+esc(state.compare.a.label)+' projected</span><b>'+money(a.projected,cur)+'</b><small>Scenario impact '+money(a.delta,cur)+'</small></div><div class="fac-kpi"><span>'+esc(state.compare.b.label)+' projected</span><b>'+money(b.projected,cur)+'</b><small>Scenario impact '+money(b.delta,cur)+'</small></div><div class="fac-kpi"><span>Difference B − A</span><b>'+money(difference,cur)+'</b><small>Arithmetic comparison, not a recommendation</small></div><div class="fac-kpi"><span>Known baseline</span><b>'+money(a.base,cur)+'</b><small>Recorded recurring schedule only</small></div></div>'+
 '<div class="fac-note">Decision boundary: the model excludes unknown discretionary spending, fees, interest accrual, investment return, tax effects and unrecorded income. It compares assumptions; it does not tell you which choice to make.</div></section>';
}
function treasuryControl(){
 const t=state.data.treasury||{},wc=t.working_capital||{},cash=t.bank_cash_by_currency||{},flow=t.operating_flow_by_currency||{};
 const cashRows=Object.entries(cash).map(([c,v])=>'<div class="fac-row"><div><h4>'+esc(c)+' business cash</h4><p>90-day average monthly outflow '+money(flow[c]?.average_monthly_outflow_90d||0,c)+' · runway '+(flow[c]?.runway_days===null||flow[c]?.runway_days===undefined?'—':flow[c].runway_days+' days')+'</p></div><b>'+money(v,c)+'</b></div>').join('');
 return '<section id="facTreasury" class="fac-section"><header><div><h3>Treasury & Working Capital</h3><p>Business cash, supplier obligations and customer receivables without assuming collections or silent FX.</p></div>'+statusChip(num(wc.overdue_payables)>0?'HIGH':'CONTROLLED')+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Receivables</span><b>'+money(wc.receivables||0,wc.currency||'AUD')+'</b><small>Open invoice balances</small></div><div class="fac-kpi"><span>Payables</span><b>'+money(wc.payables||0,wc.currency||'AUD')+'</b><small>Open supplier balances</small></div><div class="fac-kpi"><span>Due ≤30d</span><b>'+money(wc.supplier_obligations_due_30d||0,wc.currency||'AUD')+'</b><small>Coverage '+(wc.due_30_cash_coverage_ratio===null||wc.due_30_cash_coverage_ratio===undefined?'—':num(wc.due_30_cash_coverage_ratio).toFixed(2)+'×')+'</small></div><div class="fac-kpi"><span>Overdue payables</span><b>'+money(wc.overdue_payables||0,wc.currency||'AUD')+'</b><small>Requires review if non-zero</small></div></div>'+
 '<div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Business cash & runway</h4><div class="fac-list">'+(cashRows||'<div class="fac-empty">No business bank cash returned.</div>')+'</div></article><article class="fac-card"><h4>Control boundary</h4><div class="fac-note">'+esc(t.rules?.receivables||'Receivables are not assumed as forecast inflows.')+'</div><div class="fac-note" style="margin-top:8px">'+esc(t.rules?.payments||'No payment is executed from this view.')+'</div><div class="fac-toolbar"><button data-fac-open="treasury">Open Treasury</button><button data-fac-open="company">Company Finance</button><button data-fac-open="closeassurance">Close Assurance</button></div></article></div></section>';
}
function counterpartyWorkingCapitalControl(){
 const d=state.data.counterparty||{},ar=d.receivables||{},ap=d.payables||{},c=d.currency||'AUD';
 const people=(d.counterparties||[]).slice(0,8).map(p=>'<div class="fac-row"><div><h4>'+esc(p.name||'Counterparty')+'</h4><p>'+esc(p.party_type||'')+' · '+num(p.record_count)+' document(s)</p></div><div class="fac-right"><b>'+money(p.open_amount,c)+'</b><small>open balance</small></div></div>').join('');
 const overdue=num(ap.aging?.OVERDUE?.amount),due30=num(ap.aging?.DUE_30?.amount)+num(ap.aging?.DUE_7?.amount);
 return '<section id="facCounterparty" class="fac-section"><header><div><h3>AR / AP Counterparty Control</h3><p>Customer collections, supplier obligations and concentration evidence from Company Finance documents.</p></div>'+statusChip(overdue>0?'HIGH':(num(ar.open_balance)+num(ap.open_balance)>0?'WATCH':'CLEAR'))+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Open receivables</span><b>'+money(ar.open_balance||0,c)+'</b><small>'+num(ar.open_count)+' invoice(s)</small></div><div class="fac-kpi"><span>Open payables</span><b>'+money(ap.open_balance||0,c)+'</b><small>'+num(ap.open_count)+' bill(s)</small></div><div class="fac-kpi"><span>Supplier overdue</span><b>'+money(overdue,c)+'</b><small>Recorded due dates only</small></div><div class="fac-kpi"><span>Supplier due ≤30d</span><b>'+money(due30,c)+'</b><small>Excludes overdue</small></div></div>'+
 '<div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Largest open counterparties</h4><div class="fac-list">'+(people||'<div class="fac-empty">No open counterparty exposure.</div>')+'</div></article><article class="fac-card"><h4>Concentration visibility</h4><div class="fac-list"><div class="fac-row"><div><h4>Top customer</h4><p>'+esc(ar.concentration?.top_name||'No open customer balance')+'</p></div><b>'+num(ar.concentration?.percent).toFixed(1)+'%</b></div><div class="fac-row"><div><h4>Top supplier</h4><p>'+esc(ap.concentration?.top_name||'No open supplier balance')+'</p></div><b>'+num(ap.concentration?.percent).toFixed(1)+'%</b></div></div><div class="fac-toolbar"><button data-fac-open="counterparties">Open Customers & Suppliers</button><button data-fac-open="treasury">Treasury</button></div></article></div>'+
 '<div class="fac-note">'+esc(d.currency_note||'Company document balances use the configured base currency; foreign-currency bank positions remain separate.')+'</div></section>';
}
function fpaPlanningControl(){
 const p=state.data.planning||{},plan=p.selected_plan||{},a=p.analysis||{},s=a.summary||{},signals=a.signals||[];
 const rows=signals.slice(0,6).map(x=>'<div class="fac-row"><div><h4>'+esc(String(x.code||'Planning variance').replaceAll('_',' '))+'</h4><p>'+esc(x.message||'')+'</p></div>'+statusChip(x.severity||'REVIEW')+'</div>').join('');
 return '<section id="facPlanning" class="fac-section"><header><div><h3>FP&A · Plan vs Actual</h3><p>Versioned operating plan, actual variance and rolling forecast over canonical bank evidence.</p></div><button data-fac-open="planning">Open FP&A</button></header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Plan</span><b>'+esc(plan.plan_name||'Not created')+'</b><small>'+(plan.plan_uid?'v'+num(plan.version_no)+' · '+esc(plan.status):'Create an operating plan')+'</small></div><div class="fac-kpi"><span>Planned net</span><b>'+money(s.planned_net_total||0,plan.currency||'AUD')+'</b><small>Full plan horizon</small></div><div class="fac-kpi"><span>Rolling forecast net</span><b>'+money(s.forecast_net_total||0,plan.currency||'AUD')+'</b><small>Actual + remaining plan</small></div><div class="fac-kpi"><span>Completed accuracy</span><b>'+(s.completed_plan_accuracy_percent==null?'—':num(s.completed_plan_accuracy_percent).toFixed(1)+'%')+'</b><small>Completed plan months</small></div></div>'+
 '<div class="fac-list" style="margin-top:10px">'+(rows||'<div class="fac-empty">No current FP&A variance signal.</div>')+'</div>'+
 '<div class="fac-note" style="margin-top:10px">FP&A never changes actual bank evidence. Active plans are immutable; planning changes happen through a new draft version.</div></section>';
}
function jobProfitabilityControl(){
 const p=state.data.jobProfitability||{},t=p.totals||{},a=p.allocation||{},jobs=p.jobs||[],c=p.currency||'AUD';
 const ranked=[...jobs].sort((x,y)=>Math.abs(num(y.contribution_margin))-Math.abs(num(x.contribution_margin))).slice(0,8);
 const rows=ranked.map(j=>'<div class="fac-row"><div><h4>'+esc(j.job_reference||'Job')+'</h4><p>'+num(j.economic_transaction_count)+' economic record(s) · revenue '+money(j.recognized_revenue,c)+' · direct cost '+money(j.direct_cost,c)+'</p></div><div class="fac-right"><b>'+money(j.contribution_margin,c)+'</b><small>'+(j.contribution_margin_percent===null||j.contribution_margin_percent===undefined?'No revenue baseline':num(j.contribution_margin_percent).toFixed(1)+'% contribution margin')+'</small></div></div>').join('');
 const unallocated=num(a.unallocated_transaction_count);
 return '<section id="facProfitability" class="fac-section"><header><div><h3>Job Profitability & Cost Allocation</h3><p>Posted Company Finance contribution evidence by job reference, with unallocated overhead kept visible.</p></div>'+statusChip(unallocated?'WATCH':'CLEAR')+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Job-coded revenue</span><b>'+money(t.recognized_revenue,c)+'</b><small>SALE net amount</small></div><div class="fac-kpi"><span>Job-coded direct cost</span><b>'+money(t.direct_cost,c)+'</b><small>Expense · supplier bill · payroll</small></div><div class="fac-kpi"><span>Contribution margin</span><b>'+money(t.contribution_margin,c)+'</b><small>Before unallocated overhead</small></div><div class="fac-kpi"><span>Allocation coverage</span><b>'+num(a.allocation_coverage_percent).toFixed(1)+'%</b><small>'+unallocated+' unallocated economic record(s)</small></div></div>'+
 '<div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>Largest job positions</h4><div class="fac-list">'+(rows||'<div class="fac-empty">No job-coded posted economic activity.</div>')+'</div></article><article class="fac-card"><h4>Allocation evidence</h4><div class="fac-list"><div class="fac-row"><div><h4>Unallocated revenue</h4><p>Posted SALE evidence without a job reference.</p></div><b>'+money(a.unallocated_revenue,c)+'</b></div><div class="fac-row"><div><h4>Unallocated direct cost</h4><p>Posted direct-cost evidence without a job reference.</p></div><b>'+money(a.unallocated_direct_cost,c)+'</b></div></div><div class="fac-toolbar"><button data-fac-open="profitability">Open Job Profitability</button><button data-fac-open="planning">FP&A Planning</button><button data-fac-open="controlactions">Control Actions</button></div></article></div>'+
 '<div class="fac-note">'+esc(p.overhead_rule||'Unallocated overhead is not silently assigned to jobs.')+' '+esc(p.margin_rule||'Contribution margin uses posted economic evidence.')+'</div></section>';
}
function performanceRiskControl(){
 const p=state.data.performanceRisk||{},sum=p.summary||{},positions=p.positions||[];
 const rows=positions.slice(0,8).map(x=>'<div class="fac-row"><div><h4>'+esc(x.ownership_scope)+' · '+esc(x.currency)+'</h4><p>Cash '+money(x.cash_balance,x.currency)+' · base 90d '+money(x.projections?.base_90d,x.currency)+' · combined downside '+money(x.projections?.combined_downside_90d,x.currency)+'</p></div><div class="fac-right">'+statusChip(x.risk_level||'STABLE')+'</div></div>').join('');
 return '<section id="facPerformance" class="fac-section"><header><div><h3>Performance & Stress Control</h3><p>Budget pace, operating trend and downside liquidity from the canonical bank ledger.</p></div><button data-fac-open="performance">Open full control</button></header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>High signals</span><b>'+num(sum.high_signal_count)+'</b><small>Calculated exceptions</small></div><div class="fac-kpi"><span>Watch signals</span><b>'+num(sum.watch_signal_count)+'</b><small>Stress / pace</small></div><div class="fac-kpi"><span>Budgets over</span><b>'+num(sum.budgets_over_limit)+'</b><small>Current periods</small></div><div class="fac-kpi"><span>Pace risk</span><b>'+num(sum.budgets_at_pace_risk)+'</b><small>Projected over limit</small></div></div>'+
 '<div class="fac-list" style="margin-top:10px">'+(rows||'<div class="fac-empty">No performance position returned.</div>')+'</div>'+
 '<div class="fac-note" style="margin-top:10px">Stress figures use recent actual cash-flow patterns and remain separated by scope/currency. They do not predict markets, revenues or outcomes and do not execute any financial action.</div></section>';
}
function controlActionsSummary(){
 const p=state.data.issues||{},s=p.summary||{},rows=(p.issues||[]).filter(x=>['OPEN','IN_PROGRESS'].includes(String(x.status||'').toUpperCase())).slice(0,10).map(x=>'<div class="fac-row"><div><h4>'+esc(x.title||'Finance control action')+'</h4><p>'+(x.assignee_name?'Owner '+esc(x.assignee_name):'Unassigned')+(x.due_date?' · due '+date(x.due_date):'')+'</p></div><div class="fac-right">'+statusChip(x.overdue?'OVERDUE':x.severity||x.status)+'</div></div>').join('');
 return '<section id="facControlActions" class="fac-section"><header><div><h3>Control Actions</h3><p>Ownership and due-date control over the existing Finance issue register.</p></div><button data-fac-open="controlactions">Open queue</button></header><div class="fac-kpis"><div class="fac-kpi"><span>Open</span><b>'+num(s.open_count)+'</b></div><div class="fac-kpi"><span>In progress</span><b>'+num(s.in_progress_count)+'</b></div><div class="fac-kpi"><span>Overdue</span><b>'+num(s.overdue_active)+'</b></div><div class="fac-kpi"><span>Unassigned</span><b>'+num(s.unassigned_active)+'</b></div></div><div class="fac-list" style="margin-top:10px">'+(rows||'<div class="fac-empty">No active Finance control action.</div>')+'</div></section>';
}
function anomalyExplainability(){
 const data=state.data.anomalyExplain||{},positions=data.positions||[],cats=data.category_shifts||[],merchants=data.merchant_shifts||[],outliers=data.outliers||[],sum=data.summary||{};
 const pos=positions.slice(0,8).map(p=>'<div class="fac-row"><div><h4>'+esc(p.ownership_scope)+' · '+esc(p.currency)+'</h4><p>Readiness '+esc(p.analysis_readiness?.level||'LOW')+' · '+num(p.analysis_readiness?.observed_days)+' observed day(s)</p></div><div class="fac-right"><b>'+(num(p.change?.money_out)>=0?'+':'')+money(p.change?.money_out,p.currency)+' out</b><small>'+(num(p.change?.money_in)>=0?'+':'')+money(p.change?.money_in,p.currency)+' in · net '+money(p.change?.net_cash_flow,p.currency)+'</small></div></div>').join('');
 const changes=[...cats.map(x=>({kind:'Category',name:x.category,signal:x.signal,amount:x.change_amount,currency:x.currency,scope:x.ownership_scope,ids:x.current_transaction_ids||[]})),...merchants.map(x=>({kind:'Merchant',name:x.merchant,signal:x.signal,amount:x.change_amount,currency:x.currency,scope:x.ownership_scope,ids:x.current_transaction_ids||[]}))].sort((a,b)=>Math.abs(num(b.amount))-Math.abs(num(a.amount))).slice(0,12);
 const changeRows=changes.map(x=>'<div class="fac-row"><div><h4>'+esc(x.name)+'</h4><p>'+esc(x.kind)+' · '+esc(String(x.signal||'REVIEW').replaceAll('_',' '))+' · '+esc(x.scope||'')+'</p></div><div class="fac-right"><b>'+(num(x.amount)>=0?'+':'')+money(x.amount,x.currency)+'</b><div class="fac-inline">'+x.ids.slice(0,2).map(id=>'<button data-fac-tx="'+id+'">#'+id+'</button>').join('')+'</div></div></div>').join('');
 const outlierRows=outliers.slice(0,8).map(x=>'<div class="fac-row"><div><h4>'+esc(x.merchant)+'</h4><p>'+date(x.transaction_date)+' · '+num(x.multiple_of_median).toFixed(1)+'× median</p></div><div class="fac-right"><b>'+money(x.amount,x.currency)+'</b><button data-fac-tx="'+x.transaction_id+'">Open</button></div></div>').join('');
 return '<section id="facAnomaly" class="fac-section"><header><div><h3>CFO Anomaly & Explainability</h3><p>What changed, why it changed and which preserved transactions support the signal.</p></div>'+statusChip(num(sum.low_readiness_positions)>0?'REVIEW':'READY')+'</header>'+
 '<div class="fac-kpis"><div class="fac-kpi"><span>Category shifts</span><b>'+num(sum.category_shift_count)+'</b><small>Material period changes</small></div><div class="fac-kpi"><span>Merchant shifts</span><b>'+num(sum.merchant_shift_count)+'</b><small>New / spike / concentration</small></div><div class="fac-kpi"><span>Large outliers</span><b>'+num(sum.outlier_count)+'</b><small>Distribution-based review</small></div><div class="fac-kpi"><span>Low readiness</span><b>'+num(sum.low_readiness_positions)+'</b><small>Coverage or data-quality limitation</small></div></div>'+
 '<div class="fac-grid two" style="margin-top:10px"><article class="fac-card"><h4>30-day movement</h4><div class="fac-list">'+(pos||'<div class="fac-empty">No comparison position available.</div>')+'</div></article><article class="fac-card"><h4>Strongest drivers</h4><div class="fac-list">'+(changeRows||'<div class="fac-empty">No material category/merchant shift.</div>')+'</div></article></div>'+
 '<article class="fac-card"><h4>Large source transactions</h4><div class="fac-list">'+(outlierRows||'<div class="fac-empty">No current large transaction outlier.</div>')+'</div><div class="fac-toolbar"><button data-fac-open="anomaly">Open full Explainability</button><button data-fac-open="transactions">Transaction Explorer</button></div></article>'+
 '<div class="fac-note">'+esc(data.rules?.anomaly||'Signals are deterministic review prompts.')+' '+esc(data.rules?.currency||'Currencies remain separate.')+'</div></section>';
}
function sourceHealth(){
 const rows=SOURCES.map(([n,u])=>{const err=state.errors[n];return '<div class="fac-check"><div><b>'+esc(n.replaceAll('_',' '))+'</b><div class="fac-source">'+esc(u)+'</div></div>'+statusChip(err?(err==='Timed out'?'TIMEOUT':'UNAVAILABLE'):'READY')+'</div>'}).join('');
 return '<section id="facSources" class="fac-section"><header><div><h3>Evidence Source Health</h3><p>Advanced Control degrades per source; one failed optional endpoint never blocks the whole Finance OS.</p></div></header><div class="fac-control-grid">'+rows+'</div></section>';
}

function render(){
 const root=document.getElementById(MOUNT_ID);if(!root)return;
 root.innerHTML='<div class="fac"><section class="fac-hero"><div class="fac-eyebrow">ADVANCED FINANCE CONTROL</div><h2>One operating picture. Real evidence. No duplicate finance system.</h2><p>Executive control across Personal Money, Company Finance, banking, forecasting, risk, evidence and year-end readiness. Every figure stays tied to the canonical Finance APIs.</p><div class="fac-toolbar"><button id="facRefresh" class="primary">Refresh advanced control</button><span class="fac-source">Release '+VERSION+'</span></div><div class="fac-jumps"><button data-fac-jump="facExecutive">Executive</button><button data-fac-jump="facReadiness">Readiness</button><button data-fac-jump="facActions">Actions</button><button data-fac-jump="facControlActions">Control Actions</button><button data-fac-jump="facForecast">Forecast</button><button data-fac-jump="facScenario">Scenario Lab</button><button data-fac-jump="facPersonal">Personal Intelligence</button><button data-fac-jump="facRisk">Risk & Integrity</button><button data-fac-jump="facYearEnd">Tax & Year-end</button><button data-fac-jump="facCompany">Company CFO</button><button data-fac-jump="facTreasury">Treasury</button><button data-fac-jump="facCounterparty">Counterparties</button><button data-fac-jump="facPlanning">FP&A</button><button data-fac-jump="facProfitability">Job Profitability</button><button data-fac-jump="facPerformance">Performance</button><button data-fac-jump="facAnomaly">Explainability</button><button data-fac-jump="facHandover">Handover</button><button data-fac-jump="facAutomation">Automation</button><button data-fac-jump="facDecision">Decision Lab</button></div></section>'+
 executive()+executiveReadinessBoard()+actions()+controlActionsSummary()+forecast()+scenario()+decisionIntelligence()+recurringDebt()+riskIntegrity()+taxEvidence()+companyCfo()+treasuryControl()+counterpartyWorkingCapitalControl()+fpaPlanningControl()+jobProfitabilityControl()+performanceRiskControl()+anomalyExplainability()+accountantHandoverStatus()+automationApprovalControl()+sourceHealth()+
 '<div class="fac-note"><b>Control boundary:</b> Advanced Control is a decision-support layer over the same Finance OS. It does not create a second ledger, invent FX rates, combine currencies silently, execute bank transfers, auto-reconcile, auto-delete, lodge tax, or make accounting changes without the existing protected workflows.</div></div>';
 bind();
}
function bind(){
 document.getElementById('facRefresh')?.addEventListener('click',load);
 document.querySelectorAll('[data-fac-jump]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.facJump)?.scrollIntoView({behavior:'smooth',block:'start'})));
 document.querySelectorAll('[data-fac-open]').forEach(b=>b.addEventListener('click',()=>document.querySelector('[data-view="'+b.dataset.facOpen+'"]')?.click()));
 document.querySelectorAll('[data-fac-tx]').forEach(b=>b.addEventListener('click',()=>{const id=Number(b.dataset.facTx);if(window.__financeOpenTransaction)window.__financeOpenTransaction(id);else document.querySelector('[data-view="transactions"]')?.click()}));
 const ids=[['facScenarioCurrency','currency'],['facIncomeDelta','monthlyIncomeDelta'],['facSpendDelta','monthlySpendingDelta'],['facOneTime','oneTimeCost'],['facSavingTarget','monthlySavingTarget']];
 for(const [id,key] of ids)document.getElementById(id)?.addEventListener(id==='facScenarioCurrency'?'change':'input',e=>{state.scenario[key]=id==='facScenarioCurrency'?e.target.value:num(e.target.value);render()});
 document.getElementById('facCompareCurrency')?.addEventListener('change',e=>{state.scenario.currency=e.target.value;render()});
 document.getElementById('facCompareHorizon')?.addEventListener('change',e=>{state.compare.horizon=num(e.target.value)||365;render()});
 document.querySelectorAll('[data-compare]').forEach(input=>input.addEventListener('input',e=>{const plan=state.compare[e.target.dataset.compare],field=e.target.dataset.field;if(!plan||!field)return;plan[field]=field==='label'?e.target.value:num(e.target.value);render()}));
}
function mount(){
 style();
 const root=document.getElementById(MOUNT_ID);if(!root)return;
 if(Object.keys(state.data).length&&!state.loading)render();else load();
}
window.__financeAdvancedControlMount=mount;
window.addEventListener('finance:advanced-mount',mount);
if(document.readyState!=='loading')setTimeout(mount,0);else document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0));
})();