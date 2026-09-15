(() => {
  const state = { scope: 'ALL', accounts: [] };
  const $ = (id) => document.getElementById(id);
  const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  const dateText = (value) => value ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : 'Unknown';

  function notice(message, tone = 'info') {
    const el = $('notice');
    el.hidden = !message;
    el.className = `notice ${tone}`;
    el.textContent = message || '';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status})`);
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function renderAccounts(accounts) {
    const host = $('accounts');
    if (!accounts.length) {
      host.innerHTML = '<div class="empty"><strong>No accounts yet</strong><span>Add your personal or business account, then import its statement.</span></div>';
      return;
    }
    host.innerHTML = accounts.map((account) => `
      <article class="account-card">
        <div class="account-top"><span class="scope-tag ${String(account.ownership_scope || '').toLowerCase()}">${account.ownership_scope || 'UNCLASSIFIED'}</span><span class="status-dot">${account.connection_status || 'MANUAL'}</span></div>
        <h3>${escapeHtml(account.nickname || 'Account')}</h3>
        <p>${escapeHtml(account.institution || 'Manual account')} · ${escapeHtml(account.account_number_masked || 'number not stored')}</p>
        <strong>${money(account.available_balance ?? account.current_ledger_balance, account.currency || 'AUD')}</strong>
        <div class="account-meta"><span>${Number(account.transaction_count || 0)} transactions</span><span>${Number(account.unreconciled_count || 0)} unreconciled</span></div>
        <small>History: ${dateText(account.history_start_date || account.imported_history_start)} → ${dateText(account.history_end_date || account.imported_history_end)}</small>
      </article>`).join('');
  }

  function renderCategories(rows) {
    $('categories').innerHTML = rows.length ? rows.map((row) => `
      <div class="data-row"><div><strong>${escapeHtml(row.category)}</strong><small>${Number(row.transaction_count || 0)} transactions</small></div><b>${money(row.amount)}</b></div>`).join('') : '<p class="muted">Import transactions to see spending categories.</p>';
  }

  function renderQuality(issues) {
    const entries = [
      ['Unclassified transactions', issues.unclassified_transactions],
      ['Unreconciled transactions', issues.unreconciled_transactions],
      ['Missing ownership', issues.ownership_missing],
      ['Disconnected bank feeds', issues.disconnected_accounts],
      ['Unknown history coverage', issues.unknown_history_coverage]
    ];
    $('quality').innerHTML = entries.map(([name, value]) => `<div class="data-row"><span>${name}</span><b>${Number(value || 0)}</b></div>`).join('');
  }

  function renderCoverage(accounts) {
    $('coverage').innerHTML = accounts.length ? accounts.map((account) => `
      <div class="data-row coverage-row">
        <div><strong>${escapeHtml(account.nickname)}</strong><small>${escapeHtml(account.ownership_scope || '')} · ${escapeHtml(account.connection_type || 'MANUAL')}</small></div>
        <div class="right"><b>${dateText(account.transaction_start || account.history_start_date)} → ${dateText(account.transaction_end || account.history_end_date)}</b><small>${Number(account.statement_rows || 0)} statement · ${Number(account.open_banking_rows || 0)} bank-feed rows</small></div>
      </div>`).join('') : '<p class="muted">No account history available yet.</p>';
  }

  function populateAccountSelect() {
    $('importAccount').innerHTML = state.accounts.filter((account) => account.status === 'ACTIVE').map((account) => `<option value="${account.id}">${escapeHtml(account.nickname)} · ${escapeHtml(account.ownership_scope)}</option>`).join('');
  }

  async function load() {
    notice('');
    try {
      const [overview, quality, coverage, connection, accounts] = await Promise.all([
        api(`/api/finance/intelligence/overview?scope=${encodeURIComponent(state.scope)}`),
        api('/api/finance/intelligence/data-quality'),
        api('/api/finance/intelligence/history-coverage'),
        api('/api/finance/intelligence/bank-connections'),
        api('/api/finance/intelligence/accounts')
      ]);
      $('metricInflow').textContent = money(overview.summary.total_inflow);
      $('metricOutflow').textContent = money(overview.summary.total_outflow);
      $('metricNet').textContent = money(overview.summary.net_cash_flow);
      $('metricAccounts').textContent = overview.summary.account_count;
      $('metricUnclassified').textContent = overview.summary.unclassified_count;
      $('metricUnreconciled').textContent = overview.summary.unreconciled_count;
      renderAccounts(overview.accounts);
      renderCategories(overview.spending_by_category || []);
      renderQuality(quality.issues || {});
      renderCoverage(coverage.accounts || []);
      state.accounts = accounts.bank_accounts || [];
      populateAccountSelect();
      $('providerBadge').textContent = connection.configured ? `${connection.provider} configured` : 'Bank feed not configured';
      $('providerBadge').classList.toggle('ok', Boolean(connection.configured));
    } catch (error) {
      if (error.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      notice(error.message, 'error');
    }
  }

  function parseCsv(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw new Error('CSV must contain a header row and at least one transaction.');
    const split = (line) => {
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
    };
    const headers = split(lines.shift()).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const aliases = {
      transaction_date: ['transaction_date', 'date', 'transactiondate', 'value_date'],
      posting_date: ['posting_date', 'posted_date', 'process_date'],
      description: ['description', 'details', 'transaction_details', 'narrative', 'memo'],
      reference: ['reference', 'ref', 'transaction_reference'],
      debit: ['debit', 'withdrawal', 'withdrawals', 'money_out'],
      credit: ['credit', 'deposit', 'deposits', 'money_in'],
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
    if (idx.transaction_date < 0) throw new Error('CSV needs a transaction date column.');
    if (idx.amount < 0 && idx.debit < 0 && idx.credit < 0) throw new Error('CSV needs Amount or Debit/Credit columns.');
    const number = (input) => {
      const cleaned = String(input || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
      const parsed = Number(cleaned || 0);
      return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    };
    return lines.map((line) => {
      const cells = split(line);
      let debit = idx.debit >= 0 ? number(cells[idx.debit]) : 0;
      let credit = idx.credit >= 0 ? number(cells[idx.credit]) : 0;
      if (idx.amount >= 0 && !debit && !credit) {
        const raw = Number(String(cells[idx.amount] || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
        if (Number.isFinite(raw)) { if (raw < 0) debit = Math.abs(raw); else credit = raw; }
      }
      return {
        transaction_date: cells[idx.transaction_date],
        posting_date: idx.posting_date >= 0 ? cells[idx.posting_date] : null,
        description: idx.description >= 0 ? cells[idx.description] : '',
        reference: idx.reference >= 0 ? cells[idx.reference] : '',
        debit,
        credit,
        running_balance: idx.running_balance >= 0 ? cells[idx.running_balance] : null,
        merchant_name: idx.merchant_name >= 0 ? cells[idx.merchant_name] : null,
        category: idx.category >= 0 ? cells[idx.category] : null,
        currency: idx.currency >= 0 ? cells[idx.currency] : null
      };
    });
  }

  async function sha256(file) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function connectBank() {
    try {
      const result = await api('/api/finance/intelligence/bank-connections/connect', { method: 'POST', body: '{}' });
      notice(result.message || 'Bank connection started.', 'success');
    } catch (error) {
      notice(error.message, error.code === 'BANK_PROVIDER_NOT_CONFIGURED' ? 'warning' : 'error');
    }
  }

  $('accountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.currency = String(payload.currency || 'AUD').toUpperCase();
    try {
      const result = await api('/api/finance/intelligence/accounts', { method: 'POST', body: JSON.stringify(payload) });
      $('accountDialog').close();
      event.currentTarget.reset();
      notice(result.message, 'success');
      await load();
    } catch (error) { notice(error.message, 'error'); }
  });

  $('importForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const accountId = Number($('importAccount').value);
    const file = $('importFile').files[0];
    if (!accountId || !file) return;
    const extension = (file.name.split('.').pop() || '').toUpperCase();
    try {
      if (extension !== 'CSV') {
        await api(`/api/finance/intelligence/accounts/${accountId}/statements/import`, {
          method: 'POST',
          body: JSON.stringify({ source_format: extension, original_name: file.name, content_hash: await sha256(file), rows: [] })
        });
        return;
      }
      const rows = parseCsv(await file.text());
      const result = await api(`/api/finance/intelligence/accounts/${accountId}/statements/import`, {
        method: 'POST',
        body: JSON.stringify({ source_format: 'CSV', original_name: file.name, content_hash: await sha256(file), rows })
      });
      $('importDialog').close();
      event.currentTarget.reset();
      notice(`${result.message} Coverage ${result.coverage?.start || 'unknown'} to ${result.coverage?.end || 'unknown'}.`, 'success');
      await load();
    } catch (error) { notice(error.message, error.code === 'STATEMENT_PARSER_NOT_CONFIGURED' ? 'warning' : 'error'); }
  });

  document.querySelectorAll('.scope').forEach((button) => button.addEventListener('click', async () => {
    document.querySelectorAll('.scope').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.scope = button.dataset.scope;
    await load();
  }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('connectBank').addEventListener('click', connectBank);
  $('addAccount').addEventListener('click', () => $('accountDialog').showModal());
  $('importStatement').addEventListener('click', () => $('importDialog').showModal());
  $('refreshDashboard').addEventListener('click', load);

  function escapeHtml(input) {
    return String(input ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  load();
})();
