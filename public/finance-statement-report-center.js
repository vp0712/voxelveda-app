(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = (v, currency='AUD') => new Intl.NumberFormat('en-AU',{style:'currency',currency}).format(Number(v||0));
  const state = { scope:'ALL', statementUid:'', report:null };

  async function api(path) {
    const r = await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json'}});
    let p={}; try{p=await r.json();}catch{}
    if(!r.ok) throw new Error(p.message || `Request failed (${r.status})`);
    return p;
  }

  function installStyles(){
    if($('vvReportStyle')) return;
    const s=document.createElement('style');
    s.id='vvReportStyle';
    s.textContent=`
      .vv-report-actions{display:flex;gap:8px;flex-wrap:wrap}
      .vv-report-presets{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
      .vv-report-preset{border:1px solid #dfe5ee;background:#fff;border-radius:999px;padding:8px 11px;font-weight:800;cursor:pointer}
      .vv-report-preset.active{background:#111827;color:#fff;border-color:#111827}
      .vv-statement-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .vv-statement-card{border:1px solid #e1e6ed;border-radius:15px;padding:15px;background:#fff;cursor:pointer;text-align:left;color:inherit}
      .vv-statement-card:hover{border-color:#aab7c8;box-shadow:0 8px 22px rgba(16,24,40,.06)}
      .vv-statement-card strong,.vv-statement-card small{display:block}.vv-statement-card small{color:#667085;margin-top:5px}
      .vv-statement-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
      .vv-statement-stats span{background:#f7f9fc;border-radius:10px;padding:8px;font-size:.72rem;color:#667085}
      .vv-statement-stats b{display:block;color:#111827;font-size:.92rem;margin-top:2px}
      .vv-legacy-note{margin-top:9px;padding:8px 10px;border-radius:10px;background:#fff7df;color:#7a5600;font-size:.72rem}
      #vvReportDialog{max-width:1050px;width:calc(100% - 20px)}
      .vv-report-filter{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:14px}
      .vv-report-filter label{margin:0}
      .vv-report-kpis{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-bottom:14px}
      .vv-report-kpis div{background:#f7f9fc;border:1px solid #e5eaf1;border-radius:12px;padding:10px}
      .vv-report-kpis span{display:block;color:#667085;font-size:.68rem}.vv-report-kpis strong{display:block;margin-top:5px}
      .vv-report-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .vv-report-box{border:1px solid #e5eaf1;border-radius:14px;padding:13px}
      .vv-report-box h3{font-size:1rem;margin-bottom:10px}
      .vv-report-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #edf0f4;font-size:.8rem}
      .vv-report-row:last-child{border-bottom:0}.vv-report-row small{color:#7b8496}
      .vv-report-transactions{max-height:340px;overflow:auto;border:1px solid #e5eaf1;border-radius:12px;margin-top:14px}
      .vv-report-tx{display:grid;grid-template-columns:110px minmax(180px,1fr) 150px 130px;gap:10px;padding:10px;border-bottom:1px solid #edf0f4;font-size:.78rem}
      .vv-report-tx:last-child{border-bottom:0}
      @media(max-width:760px){
        .vv-statement-grid,.vv-report-columns{grid-template-columns:1fr}
        .vv-report-kpis{grid-template-columns:repeat(2,1fr)}
        .vv-report-filter{grid-template-columns:1fr}
        .vv-report-tx{grid-template-columns:1fr 1fr}.vv-report-tx>div:nth-child(2){grid-column:1/-1}
      }
    `;
    document.head.appendChild(s);
  }

  function ensurePanel(){
    if($('vvStatementReportCenter')) return;
    const anchor=$('vvTransactionExplorer') || $('bankingSafetyPanel');
    if(!anchor) return;
    const section=document.createElement('section');
    section.id='vvStatementReportCenter';
    section.className='panel';
    section.innerHTML=`
      <div class="panel-heading">
        <div><p class="eyebrow">STATEMENTS & REPORTS</p><h2>Imported statement library</h2><p class="muted">Every imported statement stays saved by its original filename. Open one to see exactly which transactions came from it and how the money was spent.</p></div>
        <div class="vv-report-actions"><button id="vvRefreshStatements" type="button">Refresh</button><button id="vvOverallReport" type="button" class="primary">Spending report</button></div>
      </div>
      <div id="vvStatementLibrary" class="vv-statement-grid"><div class="empty"><strong>Loading statements…</strong></div></div>`;
    anchor.insertAdjacentElement('afterend',section);
    $('vvRefreshStatements').addEventListener('click',loadStatements);
    $('vvOverallReport').addEventListener('click',()=>openOverallReport());
  }

  function ensureDialog(){
    if($('vvReportDialog')) return;
    const d=document.createElement('dialog');
    d.id='vvReportDialog';
    d.innerHTML=`
      <div class="dialog-form">
        <div class="dialog-head"><div><h2 id="vvReportTitle">Spending report</h2><p id="vvReportSubtitle" class="helper"></p></div><button id="vvReportClose" type="button" class="icon-button">×</button></div>
        <div class="vv-report-presets">
          <button class="vv-report-preset" type="button" data-range="THIS_MONTH">This month</button>
          <button class="vv-report-preset" type="button" data-range="LAST_MONTH">Last month</button>
          <button class="vv-report-preset" type="button" data-range="THREE_MONTHS">3 months</button>
          <button class="vv-report-preset" type="button" data-range="FYTD">Financial year</button>
          <button class="vv-report-preset" type="button" data-range="TWELVE_MONTHS">12 months</button>
          <button class="vv-report-preset" type="button" data-range="ALL">All time</button>
        </div>
        <div class="vv-report-filter">
          <label>From<input id="vvReportFrom" type="date"></label>
          <label>To<input id="vvReportTo" type="date"></label>
          <button id="vvApplyReportDates" type="button">Apply dates</button>
        </div>
        <div class="vv-report-actions" style="margin-bottom:14px"><button id="vvExportCsv" type="button">Export CSV</button><button id="vvPrintReport" type="button">Print / Save PDF</button></div>
        <div id="vvReportBody"><div class="empty"><strong>Loading report…</strong></div></div>
      </div>`;
    document.body.appendChild(d);
    $('vvReportClose').addEventListener('click',()=>d.close());
    d.querySelectorAll('[data-range]').forEach((button)=>button.addEventListener('click',()=>applyPreset(button.dataset.range,button)));
    $('vvApplyReportDates').addEventListener('click',()=>{clearPresetActive();reloadCurrentReport();});
    $('vvExportCsv').addEventListener('click',exportCsv);
    $('vvPrintReport').addEventListener('click',printReport);
  }


  function isoDate(date) {
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function clearPresetActive() {
    $('vvReportDialog')?.querySelectorAll('[data-range]').forEach((b)=>b.classList.remove('active'));
  }

  function applyPreset(range, button) {
    const today=new Date();
    let from=''; let to=isoDate(today);
    if(range==='THIS_MONTH') {
      from=isoDate(new Date(today.getFullYear(),today.getMonth(),1));
    } else if(range==='LAST_MONTH') {
      const start=new Date(today.getFullYear(),today.getMonth()-1,1);
      const end=new Date(today.getFullYear(),today.getMonth(),0);
      from=isoDate(start); to=isoDate(end);
    } else if(range==='THREE_MONTHS') {
      from=isoDate(new Date(today.getFullYear(),today.getMonth()-2,1));
    } else if(range==='FYTD') {
      const fyYear=today.getMonth()>=6?today.getFullYear():today.getFullYear()-1;
      from=isoDate(new Date(fyYear,6,1));
    } else if(range==='TWELVE_MONTHS') {
      from=isoDate(new Date(today.getFullYear()-1,today.getMonth(),today.getDate()));
    } else if(range==='ALL') {
      from=''; to='';
    }
    $('vvReportFrom').value=from;
    $('vvReportTo').value=to;
    clearPresetActive();
    button?.classList.add('active');
    reloadCurrentReport();
  }

  async function loadStatements(){
    const host=$('vvStatementLibrary'); if(!host) return;
    host.innerHTML='<div class="empty"><strong>Loading statements…</strong></div>';
    try{
      const p=await api('/api/finance/intelligence/statements?scope=ALL');
      const rows=p.statements||[];
      host.innerHTML=rows.length?rows.map(s=>`
        <button class="vv-statement-card" type="button" data-statement-uid="${esc(s.import_uid)}">
          <strong>${esc(s.original_name||'Imported statement')}</strong>
          <small>${esc(s.account_name||'Account')} · ${esc(s.ownership_scope||'')} · ${esc(s.source_format||'')}</small>
          <small>${esc(String(s.statement_start_date||'').slice(0,10)||'Unknown start')} → ${esc(String(s.statement_end_date||'').slice(0,10)||'Unknown end')}</small>
          <div class="vv-statement-stats">
            <span>Transactions<b>${Number(s.linked_transactions||0)}</b></span>
            <span>Money out<b>${money(s.money_out,s.currency||'AUD')}</b></span>
            <span>Money in<b>${money(s.money_in,s.currency||'AUD')}</b></span>
          </div>
          ${s.legacy_linkage?'<div class="vv-legacy-note">Legacy import: this statement was imported before exact transaction-source linkage was added, so the app will not guess which old rows belong to it.</div>':''}
        </button>`).join(''):'<div class="empty"><strong>No imported statements yet</strong><span>Import and approve a bank statement and it will be saved here.</span></div>';
      host.querySelectorAll('[data-statement-uid]').forEach(b=>b.addEventListener('click',()=>openStatementReport(b.dataset.statementUid)));
    }catch(e){host.innerHTML=`<div class="empty"><strong>Could not load statement library</strong><span>${esc(e.message)}</span></div>`;}
  }

  function reportQuery(base){
    const qs=new URLSearchParams();
    const from=$('vvReportFrom')?.value; const to=$('vvReportTo')?.value;
    if(from) qs.set('from',from); if(to) qs.set('to',to);
    return base+(qs.toString()?`?${qs}`:'');
  }

  async function openStatementReport(uid){
    state.statementUid=uid; state.scope='STATEMENT'; ensureDialog();
    $('vvReportFrom').value=''; $('vvReportTo').value=''; clearPresetActive();
    $('vvReportTitle').textContent='Statement report';
    $('vvReportSubtitle').textContent='Loading statement…';
    $('vvReportBody').innerHTML='<div class="empty"><strong>Building report…</strong></div>';
    $('vvReportDialog').showModal();
    await reloadCurrentReport();
  }

  async function openOverallReport(){
    state.statementUid=''; state.scope='ALL'; ensureDialog();
    $('vvReportFrom').value=''; $('vvReportTo').value=''; clearPresetActive();
    $('vvReportTitle').textContent='Company & personal spending report';
    $('vvReportSubtitle').textContent='All visible banking transactions, separated by account ownership.';
    $('vvReportBody').innerHTML='<div class="empty"><strong>Building report…</strong></div>';
    $('vvReportDialog').showModal();
    await reloadCurrentReport();
  }

  async function reloadCurrentReport(){
    try{
      const base=state.statementUid
        ? `/api/finance/intelligence/statements/${encodeURIComponent(state.statementUid)}/report`
        : '/api/finance/intelligence/reports/spending';
      const p=await api(reportQuery(base));
      state.report=p;
      if(p.statement){
        $('vvReportTitle').textContent=p.statement.original_name||'Statement report';
        $('vvReportSubtitle').textContent=`${p.statement.account_name||''} · ${p.statement.ownership_scope||''} · ${p.statement.source_format||''}`;
      }
      renderReport(p);
    }catch(e){$('vvReportBody').innerHTML=`<div class="empty"><strong>Could not build report</strong><span>${esc(e.message)}</span></div>`;}
  }

  function rowsHtml(rows,nameKey){
    return (rows||[]).slice(0,15).map(r=>`<div class="vv-report-row"><div><strong>${esc(r[nameKey]||'Unknown')}</strong><small>${Number(r.transaction_count||0)} transaction(s)</small></div><div><strong>${money(r.spent||0)}</strong>${r.percentage_of_spend!==undefined?`<small>${Number(r.percentage_of_spend||0).toFixed(1)}%</small>`:''}</div></div>`).join('')||'<p class="muted">No data in this period.</p>';
  }

  function renderReport(p){
    const s=p.summary||{};
    const currency=p.statement?.currency||'AUD';
    const tx=p.transactions||[];
    $('vvReportBody').innerHTML=`
      ${p.legacy_linkage?'<div class="notice warning">This is a legacy statement imported before exact source linkage was recorded. The app is intentionally not guessing old transaction links.</div>':''}
      <div class="vv-report-kpis">
        <div><span>Transactions</span><strong>${Number(s.transaction_count||0)}</strong></div>
        <div><span>Money out</span><strong>${money(s.money_out,currency)}</strong></div>
        <div><span>Money in</span><strong>${money(s.money_in,currency)}</strong></div>
        <div><span>Net flow</span><strong>${money(s.net_flow,currency)}</strong></div>
        <div><span>Cash</span><strong>${money(s.cash_spent,currency)}</strong></div>
        <div><span>Unclassified</span><strong>${Number(s.unclassified||0)}</strong></div>
        <div><span>Manual overrides</span><strong>${Number(s.manual_overrides||0)}</strong></div>
      </div>
      <div class="vv-report-columns">
        <section class="vv-report-box"><h3>Spending by category</h3>${rowsHtml(p.categories,'category')}</section>
        <section class="vv-report-box"><h3>Where you spent</h3>${rowsHtml(p.merchants,'merchant')}</section>
        <section class="vv-report-box"><h3>Monthly activity</h3>${rowsHtml((p.monthly||[]).map(x=>({...x,merchant:x.month})),'merchant')}</section>
        <section class="vv-report-box"><h3>By account</h3>${rowsHtml((p.accounts||[]).map(x=>({...x,merchant:`${x.account_name} · ${x.ownership_scope}`})),'merchant')}</section>
      </div>
      <div class="vv-report-transactions">
        ${tx.length?tx.map(r=>`<div class="vv-report-tx"><div>${esc(String(r.transaction_date||'').slice(0,10))}</div><div><strong>${esc(r.description||r.merchant_name||'Transaction')}</strong><small>${esc(r.category||'Unclassified')} · ${esc(r.account_name||'')}</small></div><div>${esc(r.statement_name||p.statement?.original_name||r.source_type||'Bank')}</div><div>${Number(r.debit||0)>0?'- '+money(r.debit,r.currency||currency):'+ '+money(r.credit,r.currency||currency)}</div></div>`).join(''):'<div class="empty"><strong>No transactions for this period</strong></div>'}
      </div>`;
  }

  function exportCsv(){
    const p=state.report; if(!p) return;
    const tx=p.transactions||[];
    const cells=[['Date','Description','Merchant','Category','Account','Statement','Money Out','Money In','Currency','Scope','Status','Manual Override']];
    tx.forEach(r=>cells.push([
      String(r.transaction_date||'').slice(0,10),r.description||'',r.merchant_name||'',r.category||'Unclassified',r.account_name||'',
      r.statement_name||p.statement?.original_name||'',r.debit||0,r.credit||0,r.currency||p.statement?.currency||'AUD',
      r.ownership_scope||p.statement?.ownership_scope||'',r.reconciliation_status||'',Number(r.manual_override||0)?'Yes':'No'
    ]));
    const csv=cells.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=(p.statement?.original_name?String(p.statement.original_name).replace(/\.[^.]+$/,''):'voxel-veda-spending-report')+'.csv';
    document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
  }

  function printReport(){
    const p=state.report; if(!p) return;
    const title=p.statement?.original_name||'Voxel Veda Spending Report';
    const body=$('vvReportBody')?.innerHTML||'';
    const w=window.open('','_blank','noopener,noreferrer'); if(!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{margin-bottom:4px}.muted,small{color:#666}.vv-report-kpis,.vv-report-columns{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.vv-report-kpis div,.vv-report-box{border:1px solid #ddd;border-radius:8px;padding:10px}.vv-report-row,.vv-report-tx{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:7px;border-bottom:1px solid #eee}.vv-report-transactions{margin-top:18px}.notice{padding:10px;background:#fff7df}.vv-report-actions{display:none}@media print{body{padding:0}}</style></head><body><h1>${esc(title)}</h1><p>Voxel Veda finance report</p>${body}</body></html>`);
    w.document.close(); setTimeout(()=>w.print(),250);
  }

  function init(){installStyles();ensurePanel();ensureDialog();loadStatements();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();