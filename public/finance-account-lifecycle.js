(() => {
  const $ = (id) => document.getElementById(id);
  const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  let busy = false;

  function notice(message, tone = 'info') {
    const node = $('notice');
    if (!node) return;
    node.hidden = !message;
    node.className = `notice ${tone}`;
    node.textContent = message || '';
    if (message) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status})`);
      error.code = payload.code;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function text(node, value) {
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function button(label, action, accountId, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `account-life-button ${className}`.trim();
    node.dataset.accountAction = action;
    node.dataset.accountId = String(accountId);
    node.textContent = label;
    return node;
  }

  function statusLabel(status) {
    const value = String(status || 'ACTIVE').toUpperCase();
    return value === 'ARCHIVED' ? 'Archived' : value === 'INACTIVE' ? 'Inactive / excluded' : 'Active';
  }

  function createAccountRow(account) {
    const status = String(account.status || 'ACTIVE').toUpperCase();
    const row = document.createElement('article');
    row.className = `account-life-row account-status-${status.toLowerCase()}`;
    row.dataset.accountId = String(account.id);

    const main = document.createElement('div');
    main.className = 'account-life-main';
    const top = document.createElement('div');
    top.className = 'account-life-top';
    const title = document.createElement('strong');
    title.textContent = account.nickname || 'Account';
    const badge = document.createElement('span');
    badge.className = `account-life-status account-life-status-${status.toLowerCase()}`;
    badge.textContent = statusLabel(status);
    top.append(title, badge);

    const detail = document.createElement('small');
    detail.textContent = `${account.institution || 'Manual account'} • ${account.ownership_scope || 'UNCLASSIFIED'} • ${account.account_number_masked || 'number not stored'}`;
    const meta = document.createElement('small');
    meta.textContent = `${Number(account.transaction_count || 0)} transaction(s) • ${Number(account.unreconciled_count || 0)} unreconciled • ${money(account.available_balance ?? account.current_ledger_balance, account.currency || 'AUD')}`;
    main.append(top, detail, meta);

    const actions = document.createElement('div');
    actions.className = 'account-life-actions';
    actions.append(button('Details', 'details', account.id));
    if (status === 'ACTIVE') {
      actions.append(button('Set inactive', 'inactive', account.id));
      actions.append(button('Archive', 'archive', account.id, 'warning'));
    } else if (status === 'INACTIVE') {
      actions.append(button('Restore', 'restore', account.id, 'primary'));
      actions.append(button('Archive', 'archive', account.id, 'warning'));
      actions.append(button('Delete', 'delete', account.id, 'danger'));
    } else {
      actions.append(button('Restore', 'restore', account.id, 'primary'));
      actions.append(button('Delete', 'delete', account.id, 'danger'));
    }

    row.append(main, actions);
    return row;
  }

  function ensurePanel() {
    if ($('bankAccountLifecyclePanel')) return $('bankAccountLifecyclePanel');
    const accounts = $('accounts');
    const accountsSection = accounts?.closest('.panel');
    if (!accountsSection) return null;

    const panel = document.createElement('section');
    panel.id = 'bankAccountLifecyclePanel';
    panel.className = 'panel account-life-panel';
    panel.innerHTML = `
      <div class="panel-heading account-life-heading">
        <div>
          <p class="eyebrow">ACCOUNT MANAGEMENT</p>
          <h2>Manage, archive or remove bank accounts</h2>
          <p class="muted">Archive keeps all history. Inactive keeps history but excludes the account from active analysis. Permanent delete is only available for an empty account with no financial references.</p>
        </div>
        <button id="refreshAccountLifecycle" type="button">Refresh accounts</button>
      </div>
      <div class="account-life-legend">
        <span><b>Active</b> included in analysis/imports</span>
        <span><b>Inactive</b> preserved but excluded</span>
        <span><b>Archived</b> historical only</span>
      </div>
      <div id="bankAccountLifecycleList" class="account-life-list"><p class="muted">Loading account controls…</p></div>`;
    accountsSection.insertAdjacentElement('afterend', panel);
    $('refreshAccountLifecycle')?.addEventListener('click', refresh);
    panel.addEventListener('click', onAction);
    return panel;
  }

  function ensureDialog() {
    if ($('bankAccountLifecycleDialog')) return $('bankAccountLifecycleDialog');
    const dialog = document.createElement('dialog');
    dialog.id = 'bankAccountLifecycleDialog';
    dialog.innerHTML = `
      <div class="dialog-form account-life-dialog">
        <div class="dialog-head"><div><h2 id="accountLifecycleDialogTitle">Account details</h2><p id="accountLifecycleDialogStatus" class="helper"></p></div><button type="button" class="icon-button" id="closeAccountLifecycleDialog">×</button></div>
        <div id="accountLifecycleDialogBody"></div>
        <div class="dialog-actions"><button type="button" id="closeAccountLifecycleDialogFooter">Close</button></div>
      </div>`;
    document.body.appendChild(dialog);
    $('closeAccountLifecycleDialog')?.addEventListener('click', () => dialog.close());
    $('closeAccountLifecycleDialogFooter')?.addEventListener('click', () => dialog.close());
    return dialog;
  }

  async function showDetails(accountId, { forDelete = false } = {}) {
    const result = await api(`/api/finance/intelligence/accounts/${encodeURIComponent(accountId)}/lifecycle`);
    const dialog = ensureDialog();
    const account = result.account || {};
    const scan = result.lifecycle?.deletion_check || {};
    text($('accountLifecycleDialogTitle'), account.nickname || 'Account details');
    text($('accountLifecycleDialogStatus'), `${statusLabel(account.status)} • ${account.ownership_scope || 'UNCLASSIFIED'} • ${account.institution || 'Manual account'}`);
    const body = $('accountLifecycleDialogBody');
    body.replaceChildren();

    const safety = document.createElement('div');
    safety.className = `account-life-delete-check ${scan.safe_to_delete ? 'safe' : 'blocked'}`;
    const heading = document.createElement('strong');
    heading.textContent = scan.safe_to_delete ? 'Permanent deletion is available' : 'Permanent deletion is blocked';
    const explanation = document.createElement('p');
    explanation.textContent = scan.safe_to_delete
      ? 'The dependency scan found no financial records linked to this account. Archive is still safer if you may need the account later.'
      : (scan.reason || 'This account has linked financial history. Archive it instead so reports and audit history remain intact.');
    safety.append(heading, explanation);

    if (Array.isArray(scan.dependencies) && scan.dependencies.length) {
      const list = document.createElement('ul');
      scan.dependencies.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = `${Number(item.count || 0)} record(s) in ${String(item.table || 'financial data')}`;
        list.appendChild(li);
      });
      safety.appendChild(list);
    }
    body.appendChild(safety);

    if (forDelete && scan.safe_to_delete && String(account.status || '').toUpperCase() !== 'ACTIVE') {
      const confirmDelete = button('Permanently delete this empty account', 'confirm-delete', account.id, 'danger');
      confirmDelete.classList.add('account-life-confirm-delete');
      body.appendChild(confirmDelete);
      confirmDelete.addEventListener('click', async () => {
        if (!window.confirm(`Permanently delete “${account.nickname || 'this account'}”? This cannot be undone.`)) return;
        await mutate(account.id, 'delete');
        dialog.close();
      });
    }
    if (forDelete && String(account.status || '').toUpperCase() === 'ACTIVE') {
      const tip = document.createElement('p');
      tip.className = 'helper';
      tip.textContent = 'Set the account inactive or archive it first. This prevents accidental one-click deletion of an active financial account.';
      body.appendChild(tip);
    }
    dialog.showModal();
    return result;
  }

  async function mutate(accountId, action) {
    if (busy) return;
    busy = true;
    try {
      const map = {
        archive: { method: 'POST', path: 'archive' },
        inactive: { method: 'POST', path: 'inactive' },
        restore: { method: 'POST', path: 'restore' },
        delete: { method: 'DELETE', path: '' }
      };
      const target = map[action];
      if (!target) return;
      const suffix = target.path ? `/${target.path}` : '';
      const result = await api(`/api/finance/intelligence/accounts/${encodeURIComponent(accountId)}${suffix}`, {
        method: target.method,
        body: target.method === 'DELETE' ? undefined : '{}'
      });
      notice(result.message || 'Account updated.', 'success');
      await refresh();
    } catch (error) {
      if (error.code === 'STEP_UP_REQUIRED') {
        notice('Security verification is required before changing bank account details. Complete verification, then try the action again.', 'warning');
      } else {
        notice(error.message, error.status === 409 ? 'warning' : 'error');
      }
    } finally {
      busy = false;
    }
  }

  async function onAction(event) {
    const target = event.target.closest('[data-account-action]');
    if (!target) return;
    const accountId = Number(target.dataset.accountId || 0);
    const action = target.dataset.accountAction;
    if (!accountId) return;
    if (action === 'details') {
      try { await showDetails(accountId); } catch (error) { notice(error.message, 'error'); }
      return;
    }
    if (action === 'delete') {
      try { await showDetails(accountId, { forDelete: true }); } catch (error) { notice(error.message, 'error'); }
      return;
    }
    const warning = action === 'archive'
      ? 'Archive this account? All history will be kept, but it will disappear from active analysis and statement imports.'
      : action === 'inactive'
        ? 'Set this account inactive? History will be kept but excluded from active analysis and imports.'
        : null;
    if (warning && !window.confirm(warning)) return;
    await mutate(accountId, action);
  }

  function activeScope() {
    return document.querySelector('.scope.active')?.dataset.scope || 'ALL';
  }

  function renderActiveOverview(data) {
    const summary = data.summary || {};
    text($('metricInflow'), money(summary.total_inflow));
    text($('metricOutflow'), money(summary.total_outflow));
    text($('metricNet'), money(summary.net_cash_flow));
    text($('metricAccounts'), Number(summary.account_count || 0));
    text($('metricUnclassified'), Number(summary.unclassified_count || 0));
    text($('metricUnreconciled'), Number(summary.unreconciled_count || 0));
    const categories = $('categories');
    if (categories) {
      categories.replaceChildren();
      const rows = data.spending_by_category || [];
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'Import transactions to see spending categories.';
        categories.appendChild(empty);
      } else {
        rows.forEach((row) => {
          const line = document.createElement('div');
          line.className = 'data-row';
          const left = document.createElement('div');
          const strong = document.createElement('strong');
          strong.textContent = row.category || 'Unclassified';
          const small = document.createElement('small');
          small.textContent = `${Number(row.transaction_count || 0)} transaction(s)`;
          left.append(strong, small);
          const amount = document.createElement('b');
          amount.textContent = money(row.amount);
          line.append(left, amount);
          categories.appendChild(line);
        });
      }
    }
  }

  async function refresh() {
    ensurePanel();
    const host = $('bankAccountLifecycleList');
    if (!host) return;
    try {
      const scope = activeScope();
      const [accountsResult, activeOverview] = await Promise.all([
        api('/api/finance/intelligence/accounts'),
        api(`/api/finance/intelligence/active-overview?scope=${encodeURIComponent(scope)}`)
      ]);
      const accounts = accountsResult.bank_accounts || [];
      host.replaceChildren();
      if (!accounts.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No bank accounts yet.';
        host.appendChild(empty);
      } else {
        accounts.forEach((account) => host.appendChild(createAccountRow(account)));
      }
      renderActiveOverview(activeOverview);
    } catch (error) {
      if (error.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      host.innerHTML = '<p class="muted">Account management could not be loaded.</p>';
      notice(error.message, 'error');
    }
  }

  function init() {
    ensurePanel();
    ensureDialog();
    document.querySelectorAll('.scope').forEach((node) => node.addEventListener('click', () => setTimeout(refresh, 250)));
    $('refreshDashboard')?.addEventListener('click', () => setTimeout(refresh, 250));
    $('accountForm')?.addEventListener('submit', () => setTimeout(refresh, 500));
    setTimeout(refresh, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
