(() => {
  const API = '/api/finance/personal-money';
  const $ = (id) => document.getElementById(id);
  const state = { data: null };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const formatMoney = (value, code = 'AUD') => {
    try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: code }).format(Number(value || 0)); }
    catch { return `${Number(value || 0).toFixed(2)} ${code}`; }
  };
  const formatDate = (value) => value ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(String(value).slice(0, 10) + 'T00:00:00')) : 'No due date';

  async function api(path = '', options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
    return payload;
  }

  function showMessage(message, tone = 'info') {
    const el = $('pmMessage');
    if (!el) return;
    el.hidden = !message;
    el.className = `pm-message ${tone}`;
    el.textContent = message || '';
    if (message) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function ensureStyle() {
    if (document.querySelector('style[data-personal-money]')) return;
    const style = document.createElement('style');
    style.dataset.personalMoney = 'true';
    style.textContent = `
      .pm-panel{scroll-margin-top:18px}.pm-hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:18px;border-radius:18px;border:1px solid rgba(56,189,248,.22);background:linear-gradient(135deg,rgba(56,189,248,.08),rgba(34,197,94,.04))}.pm-hero h2{margin:4px 0 7px}.pm-lock{padding:7px 10px;border-radius:999px;background:rgba(34,197,94,.12);color:#86efac;font-weight:700;font-size:.78rem;white-space:nowrap}.pm-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.pm-tab{border-radius:999px}.pm-tab.active{background:rgba(56,189,248,.16);border-color:rgba(56,189,248,.4)}.pm-message{margin:12px 0;padding:11px 13px;border-radius:12px;background:rgba(56,189,248,.09);border:1px solid rgba(56,189,248,.2)}.pm-message.error{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.28);color:#fecaca}.pm-message.success{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.28);color:#bbf7d0}.pm-view[hidden]{display:none}.pm-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.pm-summary article,.pm-card{border:1px solid rgba(255,255,255,.08);border-radius:15px;padding:14px;background:rgba(255,255,255,.025)}.pm-summary span,.pm-card small{color:var(--muted,#9ca7b4)}.pm-summary strong{display:block;font-size:1.05rem;margin-top:5px}.pm-currency-stack{display:flex;flex-direction:column;gap:3px}.pm-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.pm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pm-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.pm-card h3,.pm-card p{margin:5px 0}.pm-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}.pm-row:first-child{border-top:0}.pm-row div:last-child{text-align:right}.pm-status{font-size:.72rem;padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.07)}.pm-status.overdue{background:rgba(239,68,68,.13);color:#fca5a5}.pm-status.settled{background:rgba(34,197,94,.13);color:#86efac}.pm-budget-bar{height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:8px 0}.pm-budget-bar span{display:block;height:100%;background:#38bdf8;max-width:100%}.pm-budget.over .pm-budget-bar span{background:#ef4444}.pm-forecast-note{padding:12px;border-left:3px solid #38bdf8;background:rgba(56,189,248,.05);border-radius:10px;color:var(--muted,#aeb8c4);line-height:1.45}.pm-dialog{max-width:560px;width:min(92vw,560px)}.pm-dialog form{display:grid;gap:11px}.pm-dialog label{display:grid;gap:5px}.pm-dialog input,.pm-dialog select,.pm-dialog textarea{width:100%}.pm-dialog textarea{min-height:75px}.pm-dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:6px}.pm-fx-help{font-size:.78rem;color:var(--muted,#9ca7b4)}.pm-empty{padding:18px;text-align:center;color:var(--muted,#9ca7b4);border:1px dashed rgba(255,255,255,.12);border-radius:14px}.pm-private-note{margin-top:8px;font-size:.82rem;color:var(--muted,#9ca7b4)}
      @media(max-width:850px){.pm-summary{grid-template-columns:1fr 1fr}.pm-grid{grid-template-columns:1fr}}
      @media(max-width:560px){.pm-hero{flex-direction:column}.pm-lock{white-space:normal}.pm-summary{grid-template-columns:1fr}.pm-actions>button{flex:1 1 46%;min-height:44px}.pm-row{align-items:flex-start}.pm-dialog-actions{position:sticky;bottom:0;background:var(--bg,#0b0f14);padding-top:10px}.pm-dialog-actions button{min-height:44px;flex:1}}
    `;
    document.head.appendChild(style);
  }

  function dialog(id, title, body, submitText) {
    let el = $(id);
    if (el) return el;
    el = document.createElement('dialog');
    el.id = id;
    el.className = 'pm-dialog';
    el.innerHTML = `<form method="dialog"><div class="dialog-head"><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button" data-pm-close="${id}">×</button></div>${body}<div class="pm-dialog-actions"><button type="button" data-pm-close="${id}">Cancel</button><button type="submit" class="primary">${escapeHtml(submitText)}</button></div></form>`;
    document.body.appendChild(el);
    return el;
  }

  function install() {
    if ($('personalMoneyPanel')) return;
    ensureStyle();
    const button = document.createElement('button');
    button.id = 'openPersonalMoney';
    button.type = 'button';
    button.className = 'primary';
    button.textContent = 'Personal Money';
    const actionRow = document.querySelector('.primary-actions');
    actionRow?.insertBefore(button, actionRow.firstChild);

    const panel = document.createElement('section');
    panel.id = 'personalMoneyPanel';
    panel.className = 'panel pm-panel';
    panel.innerHTML = `
      <div class="pm-hero">
        <div><p class="eyebrow">PERSONAL MONEY CENTER</p><h2>Cash, debts, budgets and currencies — in one place</h2><p class="muted">Track money that does not appear cleanly in bank statements. This personal ledger does not post company accounting entries automatically.</p><p class="pm-private-note">Currencies stay separate unless you explicitly enter an FX conversion rate.</p></div>
        <span class="pm-lock">🔒 Owner-private</span>
      </div>
      <div class="pm-tabs">
        <button class="pm-tab active" data-pm-tab="overview">Overview</button>
        <button class="pm-tab" data-pm-tab="wallets">Wallets & cash</button>
        <button class="pm-tab" data-pm-tab="debts">Borrowed & lent</button>
        <button class="pm-tab" data-pm-tab="budgets">Budgets & forecast</button>
      </div>
      <div class="pm-actions">
        <button type="button" data-pm-action="wallet">+ Wallet</button>
        <button type="button" data-pm-action="entry">+ Money in/out</button>
        <button type="button" data-pm-action="debt">+ Borrowed / Lent</button>
        <button type="button" data-pm-action="budget">+ Budget</button>
        <button type="button" data-pm-action="refresh">Refresh</button>
      </div>
      <div id="pmMessage" class="pm-message" hidden></div>
      <div id="pmOverview" class="pm-view"></div>
      <div id="pmWallets" class="pm-view" hidden></div>
      <div id="pmDebts" class="pm-view" hidden></div>
      <div id="pmBudgets" class="pm-view" hidden></div>`;
    const metrics = document.getElementById('metricGrid');
    if (metrics?.parentElement) metrics.parentElement.insertBefore(panel, metrics.nextSibling);
    else document.querySelector('.fi-shell')?.appendChild(panel);

    createDialogs();
    bind();
  }

  function createDialogs() {
    dialog('pmWalletDialog', 'Add cash wallet', `
      <p class="helper">Use a wallet for physical cash, travel cash, petty cash, or another personal balance you want to track manually.</p>
      <label>Wallet name<input name="name" maxlength="120" required placeholder="Cash wallet, Travel INR, Emergency cash"></label>
      <label>Currency<input name="currency" maxlength="3" value="AUD" required></label>
      <label>Opening balance<input name="opening_balance" inputmode="decimal" value="0.00"></label>`, 'Create wallet');

    dialog('pmEntryDialog', 'Record money movement', `
      <p class="helper">Choose where the money belongs. If the transaction currency differs from the wallet currency, enter the conversion rate.</p>
      <label>Wallet<select name="wallet_id" id="pmEntryWallet" required></select></label>
      <label>What happened?<select name="entry_type" required><option value="EXPENSE">Spent money</option><option value="INCOME">Received income</option><option value="CASH_IN">Added cash</option><option value="CASH_OUT">Removed cash</option><option value="DEBT_RECEIVED">Borrowed money received</option><option value="DEBT_GIVEN">Money lent to someone</option><option value="REPAYMENT_RECEIVED">Repayment received</option><option value="REPAYMENT_PAID">Repayment paid</option><option value="ADJUSTMENT">Balance adjustment</option></select></label>
      <div class="form-grid"><label>Amount<input name="amount" inputmode="decimal" required></label><label>Transaction currency<input name="currency" id="pmEntryCurrency" maxlength="3" value="AUD" required></label></div>
      <label>FX rate to wallet currency<input name="fx_rate_to_wallet" id="pmFxRate" inputmode="decimal" placeholder="Leave blank if same currency"><span id="pmFxHelp" class="pm-fx-help">Example: if 1 USD = 1.52 AUD, enter 1.52 for an AUD wallet.</span></label>
      <div class="form-grid"><label>Category<input name="category" maxlength="100" placeholder="Food, Fuel, Salary"></label><label>Person / merchant<input name="counterparty" maxlength="160"></label></div>
      <label>Date/time<input name="occurred_at" type="datetime-local"></label>
      <label>Note<textarea name="note" maxlength="500"></textarea></label>`, 'Save movement');

    dialog('pmDebtDialog', 'Track borrowed or lent money', `
      <p class="helper">This records who owes whom. It stays separate from company accounting.</p>
      <label>Type<select name="direction" required><option value="BORROWED">I borrowed money</option><option value="LENT">I lent money</option></select></label>
      <label>Person / organisation<input name="counterparty" maxlength="160" required></label>
      <div class="form-grid"><label>Amount<input name="principal_amount" inputmode="decimal" required></label><label>Currency<input name="currency" maxlength="3" value="AUD" required></label></div>
      <label>Due date (optional)<input name="due_date" type="date"></label>
      <label>Note<textarea name="note" maxlength="500"></textarea></label>`, 'Save borrowed/lent money');

    dialog('pmBudgetDialog', 'Set a monthly budget', `
      <p class="helper">Budgets compare against personal cash spending recorded in the same category and currency.</p>
      <label>Month<input name="month_start" type="month" required></label>
      <label>Category<input name="category" maxlength="100" required placeholder="Food, Fuel, Shopping"></label>
      <div class="form-grid"><label>Currency<input name="currency" maxlength="3" value="AUD" required></label><label>Limit<input name="limit_amount" inputmode="decimal" required></label></div>`, 'Save budget');

    dialog('pmRepaymentDialog', 'Record a repayment', `
      <p id="pmRepaymentLabel" class="helper"></p><input type="hidden" name="debt_id">
      <label>Amount<input name="amount" inputmode="decimal" required></label>
      <label>Update a wallet too? <select name="wallet_id" id="pmRepaymentWallet"><option value="">No wallet update</option></select></label>
      <label>Date/time<input name="paid_at" type="datetime-local"></label>
      <label>Note<textarea name="note" maxlength="500"></textarea></label>`, 'Record repayment');
  }

  function serialize(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function bindForm(id, path, after) {
    const form = $(id)?.querySelector('form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const stableForm = form;
      const submit = stableForm.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const data = serialize(stableForm);
        if (data.month_start && /^\d{4}-\d{2}$/.test(data.month_start)) data.month_start += '-01';
        const target = typeof path === 'function' ? path(data) : path;
        const result = await api(target, { method: 'POST', body: JSON.stringify(data) });
        $(id).close();
        stableForm.reset();
        showMessage(result.message || 'Saved.', 'success');
        await load();
        after?.(result);
      } catch (error) { showMessage(error.message, 'error'); }
      finally { submit.disabled = false; }
    });
  }

  function bind() {
    $('openPersonalMoney')?.addEventListener('click', async () => {
      $('personalMoneyPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!state.data) await load();
    });
    document.addEventListener('click', (event) => {
      const close = event.target.closest('[data-pm-close]');
      if (close) return $(close.dataset.pmClose)?.close();
      const tab = event.target.closest('[data-pm-tab]');
      if (tab) return showTab(tab.dataset.pmTab);
      const action = event.target.closest('[data-pm-action]');
      if (action) {
        if (action.dataset.pmAction === 'refresh') return load();
        const names = { wallet:'pmWalletDialog', entry:'pmEntryDialog', debt:'pmDebtDialog', budget:'pmBudgetDialog' };
        if (names[action.dataset.pmAction]) $(names[action.dataset.pmAction])?.showModal();
      }
      const repay = event.target.closest('[data-pm-repay]');
      if (repay) openRepayment(repay.dataset.pmRepay);
    });
    bindForm('pmWalletDialog', '/wallets');
    bindForm('pmEntryDialog', '/entries');
    bindForm('pmDebtDialog', '/debts');
    bindForm('pmBudgetDialog', '/budgets');
    bindForm('pmRepaymentDialog', (data) => `/debts/${encodeURIComponent(data.debt_id)}/payments`);
    $('pmEntryWallet')?.addEventListener('change', syncFxHint);
    $('pmEntryCurrency')?.addEventListener('input', syncFxHint);
  }

  function showTab(name) {
    document.querySelectorAll('.pm-tab').forEach((b) => b.classList.toggle('active', b.dataset.pmTab === name));
    ['overview','wallets','debts','budgets'].forEach((key) => { const el = $(`pm${key[0].toUpperCase()}${key.slice(1)}`); if (el) el.hidden = key !== name; });
  }

  function syncFxHint() {
    const wallet = state.data?.wallets?.find((row) => row.id === $('pmEntryWallet')?.value);
    const txCurrency = String($('pmEntryCurrency')?.value || '').toUpperCase();
    const help = $('pmFxHelp');
    if (!help || !wallet) return;
    help.textContent = txCurrency && txCurrency !== wallet.currency
      ? `Required: enter how much ${wallet.currency} equals 1 ${txCurrency}.`
      : `Same currency as the wallet (${wallet.currency}); FX rate can stay blank.`;
  }

  function populateWalletSelects() {
    const wallets = state.data?.wallets || [];
    const options = wallets.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)} · ${escapeHtml(w.currency)}</option>`).join('');
    if ($('pmEntryWallet')) $('pmEntryWallet').innerHTML = options || '<option value="">Create a wallet first</option>';
    if ($('pmRepaymentWallet')) $('pmRepaymentWallet').innerHTML = `<option value="">No wallet update</option>${options}`;
    syncFxHint();
  }

  function renderCurrencyValues(map, selector) {
    const host = $(selector);
    const rows = Object.entries(map || {});
    host.innerHTML = rows.length ? rows.map(([code, value]) => `<span>${formatMoney(value, code)}</span>`).join('') : '<span>—</span>';
  }

  function renderOverview() {
    const data = state.data;
    const currencies = new Set([...Object.keys(data.wallet_totals || {}), ...Object.keys(data.cash_flow_by_currency || {}), ...Object.keys(data.debt_totals_by_currency || {})]);
    const flowRows = [...currencies].map((code) => ({ code, ...(data.cash_flow_by_currency?.[code] || {}), ...(data.debt_totals_by_currency?.[code] || {}) }));
    $('pmOverview').innerHTML = `
      <div class="pm-summary">
        <article><span>Wallet balances</span><strong class="pm-currency-stack">${Object.entries(data.wallet_totals || {}).map(([c,v])=>`<span>${formatMoney(v,c)}</span>`).join('') || '—'}</strong></article>
        <article><span>Money in · 30 days</span><strong class="pm-currency-stack">${flowRows.map(r=>`<span>${formatMoney(r.money_in_30d||0,r.code)}</span>`).join('') || '—'}</strong></article>
        <article><span>Money out · 30 days</span><strong class="pm-currency-stack">${flowRows.map(r=>`<span>${formatMoney(r.money_out_30d||0,r.code)}</span>`).join('') || '—'}</strong></article>
        <article><span>Open borrowed / lent</span><strong class="pm-currency-stack">${flowRows.map(r=>`<span>${r.code}: ${formatMoney(r.borrowed_open||0,r.code)} / ${formatMoney(r.lent_open||0,r.code)}</span>`).join('') || '—'}</strong></article>
      </div>
      <div class="pm-grid" style="margin-top:12px">
        <article class="pm-card"><div class="pm-card-head"><div><p class="eyebrow">FORECAST</p><h3>Next 30 days</h3></div></div>${Object.entries(data.forecast?.by_currency || {}).map(([c,r])=>`<div class="pm-row"><div><strong>${c}</strong><small>Recent operating trend</small></div><div><b>${formatMoney(r.projected_30_day_operating_change,c)}</b><small>${formatMoney(r.average_daily_net,c)} / day</small></div></div>`).join('') || '<div class="pm-empty">Record some income/spending to build a forecast.</div>'}<p class="pm-forecast-note">${escapeHtml(data.forecast?.method || '')}</p></article>
        <article class="pm-card"><div class="pm-card-head"><div><p class="eyebrow">DUE SOON</p><h3>Borrowed & lent money</h3></div></div>${(data.forecast?.due_within_30_days || []).map(r=>`<div class="pm-row"><div><strong>${escapeHtml(r.counterparty)}</strong><small>${escapeHtml(r.direction)}</small></div><div><b>${formatMoney(r.outstanding_amount,r.currency)}</b><small>${formatDate(r.due_date)}</small></div></div>`).join('') || '<div class="pm-empty">Nothing due in the next 30 days.</div>'}</article>
      </div>`;
  }

  function renderWallets() {
    const wallets = state.data?.wallets || [];
    const entries = state.data?.entries || [];
    $('pmWallets').innerHTML = `<div class="pm-grid">${wallets.map(w=>`<article class="pm-card"><div class="pm-card-head"><div><h3>${escapeHtml(w.name)}</h3><small>${escapeHtml(w.currency)} wallet</small></div><strong>${formatMoney(w.balance,w.currency)}</strong></div><div style="margin-top:9px">${entries.filter(e=>e.wallet_id===w.id).slice(0,8).map(e=>`<div class="pm-row"><div><b>${escapeHtml(String(e.entry_type).replaceAll('_',' '))}</b><small>${escapeHtml(e.category||e.counterparty||'Uncategorised')}</small></div><div><strong>${formatMoney(e.amount,e.currency)}</strong><small>${formatDate(e.occurred_at)}</small></div></div>`).join('') || '<div class="pm-empty">No movements yet.</div>'}</div></article>`).join('') || '<div class="pm-empty">Create your first cash wallet to start tracking cash or non-bank money.</div>'}</div>`;
  }

  function renderDebts() {
    const rows = state.data?.debts || [];
    $('pmDebts').innerHTML = `<div class="pm-grid">${rows.map(d=>{ const overdue=d.status!=='SETTLED'&&d.due_date&&new Date(String(d.due_date).slice(0,10)+'T00:00:00')<new Date(new Date().toDateString()); return `<article class="pm-card"><div class="pm-card-head"><div><h3>${escapeHtml(d.counterparty)}</h3><small>${d.direction==='BORROWED'?'You owe this money':'This money is owed to you'}</small></div><span class="pm-status ${overdue?'overdue':d.status==='SETTLED'?'settled':''}">${overdue?'OVERDUE':escapeHtml(d.status)}</span></div><p><strong>${formatMoney(d.outstanding_amount,d.currency)}</strong> outstanding from ${formatMoney(d.principal_amount,d.currency)}</p><p class="muted">Due: ${formatDate(d.due_date)}</p>${d.note?`<p>${escapeHtml(d.note)}</p>`:''}${d.status!=='SETTLED'?`<button type="button" data-pm-repay="${escapeHtml(d.id)}">Record repayment</button>`:''}</article>`;}).join('') || '<div class="pm-empty">No borrowed or lent money recorded.</div>'}</div>`;
  }

  function renderBudgets() {
    const data=state.data; const budgets=data?.budgets||[];
    $('pmBudgets').innerHTML = `<div class="pm-grid"><article class="pm-card"><p class="eyebrow">MONTHLY BUDGETS</p><h3>Spending limits</h3>${budgets.map(b=>`<div class="pm-budget ${b.used_percent>100?'over':''}"><div class="pm-row"><div><b>${escapeHtml(b.category)}</b><small>${escapeHtml(String(b.month_start).slice(0,7))} · ${escapeHtml(b.currency)}</small></div><div><strong>${formatMoney(b.spent_amount,b.currency)} / ${formatMoney(b.limit_amount,b.currency)}</strong><small>${Number(b.used_percent||0).toFixed(1)}% used</small></div></div><div class="pm-budget-bar"><span style="width:${Math.min(100,Number(b.used_percent||0))}%"></span></div><small>${formatMoney(b.remaining_amount,b.currency)} remaining</small></div>`).join('') || '<div class="pm-empty">No budgets yet.</div>'}</article><article class="pm-card"><p class="eyebrow">FORECAST BY CURRENCY</p><h3>Recent trend</h3>${Object.entries(data?.forecast?.by_currency||{}).map(([c,r])=>`<div class="pm-row"><div><strong>${c}</strong><small>Projected operating change</small></div><div><b>${formatMoney(r.projected_30_day_operating_change,c)}</b><small>Next 30 days</small></div></div>`).join('') || '<div class="pm-empty">Not enough history yet.</div>'}<p class="pm-forecast-note">Forecasts use your recent entries only. They are planning estimates, not financial advice.</p></article></div>`;
  }

  function openRepayment(id) {
    const debt=state.data?.debts?.find((row)=>row.id===id); if(!debt)return;
    const dialogEl=$('pmRepaymentDialog'); const form=dialogEl.querySelector('form');
    form.elements.debt_id.value=debt.id; form.elements.amount.value=Number(debt.outstanding_amount||0).toFixed(2);
    $('pmRepaymentLabel').textContent=`${debt.direction==='BORROWED'?'You are paying back':'You are receiving back'} ${debt.counterparty}. Outstanding: ${formatMoney(debt.outstanding_amount,debt.currency)}.`;
    const compatible=(state.data?.wallets||[]).filter(w=>w.currency===debt.currency);
    $('pmRepaymentWallet').innerHTML=`<option value="">No wallet update</option>${compatible.map(w=>`<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)} · ${w.currency}</option>`).join('')}`;
    dialogEl.showModal();
  }

  async function load() {
    try {
      showMessage('Loading your private money dashboard…');
      state.data=await api();
      populateWalletSelects(); renderOverview(); renderWallets(); renderDebts(); renderBudgets();
      showMessage('');
    } catch(error){ showMessage(error.message,'error'); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true }); else install();
})();
