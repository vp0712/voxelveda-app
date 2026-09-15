(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { scope: 'ALL', workflow: 'ALL', search: '', active: null, candidate: null, ignoreId: null };
  const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    let payload = {}; try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status})`);
      error.status = response.status; error.code = payload.code; error.issues = payload.issues || [];
      throw error;
    }
    return payload;
  }
  function notice(message, tone = 'info') {
    const host = $('rcNotice'); host.hidden = !message; host.className = `notice ${tone}`; host.textContent = message || '';
    if (message) host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function statusLabel(value) { return String(value || '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()); }
  function scopeLabel(value) { return value === 'BUSINESS' ? 'Voxel Veda' : value === 'PERSONAL' ? 'Personal' : statusLabel(value); }
  function setActive(selector, attribute, value) {
    document.querySelectorAll(selector).forEach((button) => button.classList.toggle('active', String(button.dataset[attribute] || '') === value));
  }

  function renderSummary(summary = {}) {
    $('sumNeeds').textContent = Number(summary.needs_action || 0);
    $('sumReady').textContent = Number(summary.ready || 0);
    $('sumPartial').textContent = Number(summary.partial || 0);
    $('sumReconciled').textContent = Number(summary.reconciled || 0);
    $('sumIgnored').textContent = Number(summary.ignored || 0);
    $('sumIn').textContent = money(summary.money_in || 0);
    $('sumOut').textContent = money(summary.money_out || 0);
    $('sumTotal').textContent = Number(summary.total || 0);
  }

  function renderTransactions(rows = []) {
    const host = $('transactionList');
    if (!rows.length) {
      host.innerHTML = '<div class="empty"><strong>No transactions in this view.</strong><br>Try another status or scope, or import a statement first.</div>';
      return;
    }
    host.innerHTML = rows.map((row) => {
      const out = Number(row.amount || 0) < 0;
      const locked = ['RECONCILED','IGNORED'].includes(row.workflow_status);
      const matchable = ['READY','PARTIAL'].includes(row.workflow_status);
      const remaining = Number(row.remaining_amount || 0);
      return `<article class="transaction-card" data-tx-id="${Number(row.id)}">
        <div class="tx-top">
          <div><h3>${escapeHtml(row.merchant_name || row.description || 'Bank transaction')}</h3><div class="tx-meta">${escapeHtml(row.transaction_date || 'No date')} · ${escapeHtml(row.account_name || '')}${row.institution ? ` · ${escapeHtml(row.institution)}` : ''}</div></div>
          <div class="tx-amount ${out ? 'out' : 'in'}">${money(row.amount, row.currency || 'AUD')}</div>
        </div>
        <div class="tx-tags">
          <span class="chip ${String(row.workflow_status || '').toLowerCase()}">${escapeHtml(statusLabel(row.workflow_status))}</span>
          <span class="chip">${escapeHtml(scopeLabel(row.ownership_scope))}</span>
          <span class="chip">${escapeHtml(row.category || 'No category')}</span>
          ${Number(row.is_internal_transfer || 0) ? '<span class="chip ready">Own-account transfer</span>' : ''}
          ${Number(row.matched_amount || 0) > 0 ? `<span class="chip partial">Matched ${money(row.matched_amount, row.currency || 'AUD')} · ${money(remaining, row.currency || 'AUD')} left</span>` : ''}
        </div>
        <div class="tx-reason"><b>What this means:</b> ${escapeHtml(row.action_reason || '')}</div>
        <div class="tx-actions">
          ${!locked ? `<button type="button" data-action="classify" data-id="${Number(row.id)}">${row.workflow_status === 'NEEDS_ACTION' ? 'Review & classify' : 'Edit classification'}</button>` : ''}
          ${matchable ? `<button type="button" class="primary" data-action="match" data-id="${Number(row.id)}">${row.workflow_status === 'PARTIAL' ? 'Continue matching' : 'Match & reconcile'}</button>` : ''}
          ${!locked ? `<button type="button" class="danger" data-action="ignore" data-id="${Number(row.id)}">Ignore with reason</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  async function load() {
    const refresh = $('rcRefresh'); refresh.disabled = true; refresh.textContent = 'Loading…';
    try {
      const qs = new URLSearchParams({ scope: state.scope, workflow: state.workflow });
      if (state.search) qs.set('search', state.search);
      const payload = await api(`/api/finance/intelligence/reconciliation?${qs.toString()}`);
      renderSummary(payload.summary); renderTransactions(payload.transactions || []);
    } catch (error) {
      if (error.status === 401) return location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
      notice(error.message, 'error');
      $('transactionList').innerHTML = '<div class="empty">Could not load reconciliation data.</div>';
    } finally { refresh.disabled = false; refresh.textContent = 'Refresh'; }
  }

  async function openClassify(id) {
    try {
      const payload = await api('/api/finance/intelligence/reconciliation?scope=ALL&workflow=ALL');
      const row = (payload.transactions || []).find((item) => Number(item.id) === Number(id));
      if (!row) throw new Error('Transaction could not be loaded.');
      state.active = row;
      $('classifyTitle').textContent = row.merchant_name || row.description || 'Classify transaction';
      $('classifyMeta').textContent = `${row.transaction_date} · ${row.account_name} · ${money(row.amount, row.currency || 'AUD')}`;
      $('classifyCategory').value = row.category === 'Internal Transfer' ? '' : (row.category || '');
      $('classifyScope').value = row.ownership_scope || 'UNCLASSIFIED';
      $('classifyTransfer').checked = Boolean(Number(row.is_internal_transfer || 0));
      $('classifyDialog').showModal();
    } catch (error) { notice(error.message, 'error'); }
  }
  async function saveClassification(event) {
    event.preventDefault();
    if (!state.active) return;
    const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const result = await api(`/api/finance/intelligence/reconciliation/${state.active.id}/classify`, {
        method: 'POST', body: JSON.stringify({ category: $('classifyCategory').value, ownership_scope: $('classifyScope').value, is_internal_transfer: $('classifyTransfer').checked })
      });
      $('classifyDialog').close(); notice(result.message, 'success'); await load();
    } catch (error) { notice(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Save & mark ready'; }
  }

  async function openMatch(id) {
    try {
      state.active = { id };
      state.candidate = null;
      const payload = await api(`/api/finance/intelligence/reconciliation/${id}/candidates`);
      const bank = payload.bank_transaction;
      $('matchMeta').textContent = `${bank.transaction_date} · ${bank.description || 'Bank transaction'} · ${money(bank.remaining_amount)} remaining to match`;
      $('matchAmount').value = Number(bank.remaining_amount || 0).toFixed(2);
      const rows = payload.candidates || [];
      $('candidateList').innerHTML = rows.length ? rows.map((row, index) => {
        const perfect = Number(row.amount_difference || 0) < 0.01;
        return `<label class="candidate ${perfect ? 'match-perfect' : ''}">
          <input type="radio" name="candidate" value="${Number(row.id)}" ${index === 0 ? 'checked' : ''}>
          <span><strong>${escapeHtml(row.party_name || row.description || row.transaction_uid)}</strong><small>${escapeHtml(row.effective_date)} · ${escapeHtml(row.category || 'No category')} · ${Number(row.date_difference || 0)} day(s) away${perfect ? ' · exact amount' : ` · ${money(row.amount_difference)} amount difference`}</small></span>
          <strong class="amount">${money(row.gross_amount)}</strong>
        </label>`;
      }).join('') : '<div class="empty">No nearby posted finance transactions were found. Create/post the correct finance record first, then return here.</div>';
      state.candidate = Number(document.querySelector('input[name="candidate"]:checked')?.value || 0) || null;
      $('confirmMatch').disabled = !state.candidate;
      $('matchDialog').showModal();
    } catch (error) { notice(error.message, 'error'); }
  }

  async function confirmMatch() {
    const candidate = Number(document.querySelector('input[name="candidate"]:checked')?.value || 0);
    const amount = Number($('matchAmount').value || 0);
    if (!candidate || amount <= 0 || !state.active?.id) return notice('Choose a finance record and enter a positive match amount.', 'warning');
    const button = $('confirmMatch'); button.disabled = true; button.textContent = 'Matching…';
    try {
      const result = await api(`/api/finance/bank-transactions/${state.active.id}/reconcile`, { method: 'POST', body: JSON.stringify({ finance_transaction_id: candidate, matched_amount: amount, match_type: 'MATCH', note: 'Matched in Reconciliation Center' }) });
      $('matchDialog').close(); notice(result.message, 'success'); await load();
    } catch (error) { notice(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Match selected record'; }
  }

  function openIgnore(id) { state.ignoreId = id; $('ignoreReason').value = ''; $('ignoreDialog').showModal(); }
  async function ignore(event) {
    event.preventDefault();
    const reason = $('ignoreReason').value.trim(); if (!reason || !state.ignoreId) return;
    const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const result = await api(`/api/finance/bank-transactions/${state.ignoreId}/ignore`, { method: 'POST', body: JSON.stringify({ reason }) });
      $('ignoreDialog').close(); notice(result.message, 'success'); await load();
    } catch (error) { notice(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Ignore transaction'; }
  }

  document.querySelectorAll('[data-scope]').forEach((button) => button.addEventListener('click', () => { state.scope = button.dataset.scope; setActive('[data-scope]', 'scope', state.scope); load(); }));
  document.querySelectorAll('[data-workflow]').forEach((button) => button.addEventListener('click', () => { state.workflow = button.dataset.workflow; setActive('.workflow [data-workflow]', 'workflow', state.workflow); load(); }));
  $('rcSearch').addEventListener('input', (() => { let timer; return (event) => { clearTimeout(timer); timer = setTimeout(() => { state.search = event.target.value.trim(); load(); }, 350); }; })());
  $('rcRefresh').addEventListener('click', load);
  $('transactionList').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const id = Number(button.dataset.id || 0); if (!id) return;
    if (button.dataset.action === 'classify') openClassify(id);
    else if (button.dataset.action === 'match') openMatch(id);
    else if (button.dataset.action === 'ignore') openIgnore(id);
  });
  $('candidateList').addEventListener('change', (event) => { if (event.target.name === 'candidate') { state.candidate = Number(event.target.value); $('confirmMatch').disabled = false; } });
  $('classifyForm').addEventListener('submit', saveClassification);
  $('confirmMatch').addEventListener('click', confirmMatch);
  $('ignoreForm').addEventListener('submit', ignore);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close)?.close()));

  const categories = ['Groceries','Eating Out','Fuel & Vehicle','Rent & Housing','Utilities','Phone & Internet','Insurance','Travel','Health','Shopping','Software & Subscriptions','Website & Hosting','Materials & Manufacturing','Shipping & Courier','Advertising & Marketing','Professional Fees','Bank Fees & Interest','Payroll','Tax & GST','Income','Other'];
  const list = document.createElement('datalist'); list.id = 'categoryOptions'; list.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">`).join(''); document.body.appendChild(list); $('classifyCategory').setAttribute('list','categoryOptions');
  load();
})();