(() => {
  const API = '/api/finance/personal-money';
  const $ = (id) => document.getElementById(id);
  let data = null;
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = (v, code='AUD') => { try { return new Intl.NumberFormat('en-AU',{style:'currency',currency:code}).format(Number(v||0)); } catch { return `${Number(v||0).toFixed(2)} ${code}`; } };
  const date = (v) => v ? new Intl.DateTimeFormat('en-AU',{dateStyle:'medium'}).format(new Date(`${String(v).slice(0,10)}T00:00:00`)) : 'No date';

  async function api(path='', options={}) {
    const r = await fetch(`${API}${path}`, { credentials:'same-origin', headers:{'Content-Type':'application/json',...(options.headers||{})}, ...options });
    let p={}; try { p=await r.json(); } catch {}
    if(!r.ok) throw new Error(p.message || `Request failed (${r.status})`);
    return p;
  }

  function style() {
    if (document.querySelector('style[data-pm-attention]')) return;
    const s=document.createElement('style'); s.dataset.pmAttention='1'; s.textContent=`
      .pma-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px;border:1px solid rgba(250,204,21,.22);border-radius:18px;background:linear-gradient(135deg,rgba(250,204,21,.08),rgba(56,189,248,.04))}.pma-hero h2{margin:4px 0 7px}.pma-badge{padding:6px 10px;border-radius:999px;background:rgba(250,204,21,.12);color:#fde68a;font-weight:700;font-size:.78rem}.pma-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.pma-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.pma-summary article,.pma-card{padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:15px;background:rgba(255,255,255,.025)}.pma-summary span,.pma-card small{color:var(--muted,#9ca7b4)}.pma-summary strong{display:block;margin-top:5px}.pma-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pma-list{display:grid;gap:9px}.pma-alert{padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:13px}.pma-alert.urgent{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.06)}.pma-alert.high{border-color:rgba(251,146,60,.35);background:rgba(251,146,60,.05)}.pma-alert.medium{border-color:rgba(250,204,21,.25)}.pma-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06)}.pma-row:first-child{border-top:0}.pma-right{text-align:right}.pma-progress{height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:8px 0}.pma-progress span{display:block;height:100%;background:#38bdf8}.pma-dialog{width:min(92vw,560px);max-width:560px}.pma-dialog form{display:grid;gap:11px}.pma-dialog label{display:grid;gap:5px}.pma-dialog input,.pma-dialog select,.pma-dialog textarea{width:100%}.pma-dialog textarea{min-height:72px}.pma-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.pma-note{padding:11px 12px;border-left:3px solid #facc15;background:rgba(250,204,21,.05);border-radius:9px;color:var(--muted,#aeb8c4)}.pma-empty{padding:16px;text-align:center;border:1px dashed rgba(255,255,255,.12);border-radius:13px;color:var(--muted,#9ca7b4)}
      @media(max-width:850px){.pma-summary{grid-template-columns:1fr 1fr}.pma-grid{grid-template-columns:1fr}}
      @media(max-width:560px){.pma-hero{flex-direction:column}.pma-summary{grid-template-columns:1fr}.pma-actions button{flex:1 1 45%;min-height:44px}.pma-row{align-items:flex-start}.pma-dialog-actions button{flex:1;min-height:44px}}
    `; document.head.appendChild(s);
  }

  function dialog(id,title,body,submit) {
    const d=document.createElement('dialog'); d.id=id; d.className='pma-dialog';
    d.innerHTML=`<form method="dialog"><div class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-pma-close="${id}">×</button></div>${body}<div class="pma-dialog-actions"><button type="button" data-pma-close="${id}">Cancel</button><button type="submit" class="primary">${esc(submit)}</button></div></form>`;
    document.body.appendChild(d); return d;
  }

  function install() {
    if($('pmAttentionPanel')) return; style();
    const btn=document.createElement('button'); btn.id='openMoneyAttention'; btn.type='button'; btn.textContent='Money Attention';
    const personal=$('openPersonalMoney'); if(personal?.parentElement) personal.insertAdjacentElement('afterend',btn); else document.querySelector('.primary-actions')?.prepend(btn);
    const panel=document.createElement('section'); panel.id='pmAttentionPanel'; panel.className='panel';
    panel.innerHTML=`<div class="pma-hero"><div><p class="eyebrow">SMART MONEY ATTENTION</p><h2>What needs your attention?</h2><p class="muted">Simple reminders for bills, subscriptions, debt dates, budgets and savings goals. Nothing is paid or moved automatically.</p></div><span class="pma-badge">Review only</span></div><div class="pma-actions"><button type="button" data-pma="recurring">+ Bill / Subscription</button><button type="button" data-pma="goal">+ Savings Goal</button><button type="button" data-pma="refresh">Refresh</button></div><div id="pmaMessage" class="notice" hidden></div><div id="pmaContent"><p class="muted">Open this section to load your reminders.</p></div>`;
    const pm=$('personalMoneyPanel'); if(pm?.parentElement) pm.insertAdjacentElement('afterend',panel); else document.querySelector('.fi-shell')?.appendChild(panel);
    createDialogs(); bind();
  }

  function createDialogs() {
    dialog('pmaRecurringDialog','Add bill, subscription or recurring income',`
      <p class="helper"><b>Reminder only.</b> The app will not pay this automatically.</p>
      <label>Name<input name="name" required maxlength="160" placeholder="Rent, Netflix, Phone, Salary"></label>
      <label>Type<select name="item_type"><option value="BILL">Bill</option><option value="SUBSCRIPTION">Subscription</option><option value="INCOME">Recurring income</option></select></label>
      <div class="form-grid"><label>Amount<input name="amount" inputmode="decimal" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label></div>
      <div class="form-grid"><label>Frequency<select name="frequency"><option>WEEKLY</option><option>FORTNIGHTLY</option><option selected>MONTHLY</option><option>QUARTERLY</option><option>YEARLY</option></select></label><label>Next due date<input name="next_due_date" type="date" required></label></div>
      <div class="form-grid"><label>Category<input name="category" maxlength="100"></label><label>Merchant / payer<input name="counterparty" maxlength="160"></label></div>
      <label>Remind me this many days before<input name="reminder_days" type="number" min="0" max="60" value="3"></label>
      <label>Note<textarea name="note" maxlength="500"></textarea></label>`, 'Save reminder');
    dialog('pmaGoalDialog','Create savings goal',`
      <p class="helper">Goal progress is planning data only. Adding progress will not reduce a wallet balance automatically.</p>
      <label>Goal name<input name="name" required maxlength="160" placeholder="Emergency fund, Car, Holiday"></label>
      <div class="form-grid"><label>Target amount<input name="target_amount" inputmode="decimal" required></label><label>Currency<input name="currency" value="AUD" maxlength="3" required></label></div>
      <label>Already saved<input name="current_amount" inputmode="decimal" value="0"></label>
      <div class="form-grid"><label>Target date<input name="target_date" type="date"></label><label>Priority<select name="priority"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option></select></label></div>
      <label>Note<textarea name="note" maxlength="500"></textarea></label>`, 'Create goal');
    dialog('pmaContributionDialog','Add goal progress',`
      <p id="pmaGoalLabel" class="helper"></p><input type="hidden" name="goal_id"><label>Amount added<input name="amount" inputmode="decimal" required></label><label>Date/time<input name="contributed_at" type="datetime-local"></label><label>Note<textarea name="note" maxlength="500"></textarea></label><p class="pma-note">This updates goal progress only. It does not move money from any wallet.</p>`, 'Add progress');
  }

  function msg(text,tone='info'){const el=$('pmaMessage'); if(!el)return; el.hidden=!text; el.className=`notice ${tone}`; el.textContent=text||'';}
  function serial(form){return Object.fromEntries(new FormData(form).entries());}

  async function submit(dialogId,path) {
    const form=$(dialogId)?.querySelector('form'); if(!form)return;
    form.addEventListener('submit',async(e)=>{e.preventDefault(); const b=form.querySelector('[type=submit]'); b.disabled=true; try{const body=serial(form); const target=typeof path==='function'?path(body):path; const r=await api(target,{method:'POST',body:JSON.stringify(body)}); $(dialogId).close(); form.reset(); msg(r.message||'Saved.','success'); await load();}catch(err){msg(err.message,'error');}finally{b.disabled=false;}});
  }

  function bind(){
    $('openMoneyAttention')?.addEventListener('click',async()=>{$('pmAttentionPanel')?.scrollIntoView({behavior:'smooth',block:'start'}); if(!data) await load();});
    document.addEventListener('click',async(e)=>{
      const close=e.target.closest('[data-pma-close]'); if(close){$(close.dataset.pmaClose)?.close();return;}
      const action=e.target.closest('[data-pma]'); if(action){ if(action.dataset.pma==='refresh') return load(); $(action.dataset.pma==='recurring'?'pmaRecurringDialog':'pmaGoalDialog')?.showModal(); return; }
      const complete=e.target.closest('[data-pma-complete]'); if(complete){try{const r=await api(`/recurring/${encodeURIComponent(complete.dataset.pmaComplete)}/complete`,{method:'POST',body:'{}'});msg(r.message,'success');await load();}catch(err){msg(err.message,'error');}return;}
      const progress=e.target.closest('[data-pma-goal]'); if(progress){const g=data?.goals?.find(x=>String(x.id)===String(progress.dataset.pmaGoal)); if(!g)return; const f=$('pmaContributionDialog').querySelector('form'); f.elements.goal_id.value=g.id; $('pmaGoalLabel').textContent=`${g.name}: ${money(g.current_amount,g.currency)} of ${money(g.target_amount,g.currency)} saved.`; $('pmaContributionDialog').showModal();}
    });
    submit('pmaRecurringDialog','/recurring'); submit('pmaGoalDialog','/goals'); submit('pmaContributionDialog',(b)=>`/goals/${encodeURIComponent(b.goal_id)}/contributions`);
  }

  function currencyLines(obj,empty='Nothing scheduled'){const rows=Object.entries(obj||{}); return rows.length?rows.map(([c,v])=>`<div><strong>${money(v,c)}</strong><small>${esc(c)}</small></div>`).join(''):`<small>${esc(empty)}</small>`;}

  function render(){
    const alerts=data.alerts||[], recurring=data.recurring||[], goals=data.goals||[];
    const content=$('pmaContent');
    content.innerHTML=`
      <div class="pma-summary">
        <article><span>Needs attention</span><strong>${alerts.length}</strong><small>Due dates and limits</small></article>
        <article><span>Known recurring cost / year</span><div class="pma-right">${currencyLines(data.annual_recurring_cost_by_currency,'No recurring costs')}</div></article>
        <article><span>Known obligations next 30 days</span><div class="pma-right">${currencyLines(data.estimated_30_day_obligations_by_currency,'None due')}</div></article>
        <article><span>Wallet headroom after known 30-day obligations</span><div class="pma-right">${currencyLines(data.wallet_headroom_after_known_30_day_obligations,'Add a wallet')}</div></article>
      </div>
      <p class="pma-note">${esc(data.explanation||'Planning reminders only.')}</p>
      <div class="pma-grid">
        <article class="pma-card"><h3>Attention now</h3><div class="pma-list">${alerts.length?alerts.map(a=>`<div class="pma-alert ${String(a.severity).toLowerCase()}"><div class="pma-row"><div><strong>${esc(a.title)}</strong><small>${esc(a.explanation)}</small></div><div class="pma-right"><strong>${a.amount!=null?money(a.amount,a.currency):''}</strong><small>${a.due_date?date(a.due_date):esc(a.type)}</small></div></div><small>${esc(a.action)}</small></div>`).join(''):'<div class="pma-empty">Nothing urgent right now.</div>'}</div></article>
        <article class="pma-card"><h3>Bills & subscriptions</h3>${recurring.length?recurring.map(r=>`<div class="pma-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.item_type)} · ${esc(r.frequency)} · next ${date(r.next_due_date)}</small></div><div class="pma-right"><strong>${money(r.amount,r.currency)}</strong>${r.item_type!=='INCOME'?`<small>${money(r.annualized_cost,r.currency)}/year</small>`:''}<button type="button" data-pma-complete="${esc(r.id)}">Mark completed</button></div></div>`).join(''):'<div class="pma-empty">Add bills or subscriptions to see upcoming commitments.</div>'}</article>
        <article class="pma-card"><h3>Savings goals</h3>${goals.length?goals.map(g=>`<div class="pma-row"><div><strong>${esc(g.name)}</strong><small>${esc(g.priority)} priority · ${g.target_date?`target ${date(g.target_date)}`:'no target date'} · ${esc(g.status)}</small><div class="pma-progress"><span style="width:${Math.max(0,Math.min(100,Number(g.progress_percent||0)))}%"></span></div><small>${Number(g.progress_percent||0)}% complete${g.suggested_monthly_contribution?` · about ${money(g.suggested_monthly_contribution,g.currency)}/month needed`:''}</small></div><div class="pma-right"><strong>${money(g.current_amount,g.currency)} / ${money(g.target_amount,g.currency)}</strong>${g.status==='ACTIVE'?`<button type="button" data-pma-goal="${esc(g.id)}">Add progress</button>`:''}</div></div>`).join(''):'<div class="pma-empty">Create a goal to track progress without moving money automatically.</div>'}</article>
        <article class="pma-card"><h3>How to use this</h3><div class="pma-list"><div><strong>1. Add regular commitments</strong><small>Bills, subscriptions and recurring income.</small></div><div><strong>2. Review alerts</strong><small>Overdue, due soon and budget warnings rise to the top.</small></div><div><strong>3. Record the real transaction separately</strong><small>Marking a reminder complete does not create a payment.</small></div><div><strong>4. Keep currencies separate</strong><small>AUD, USD, INR and other currencies are never silently combined.</small></div></div></article>
      </div>`;
  }

  async function load(){msg(''); try{data=await api('/attention'); render();}catch(err){msg(err.message,'error');}}

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();