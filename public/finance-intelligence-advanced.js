(() => {
  const $ = (id) => document.getElementById(id);
  const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  const escapeHtml = (input) => String(input ?? '').replace(/[&<>'\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[ch]));
  let scope = 'ALL';

  function installReconciliationButton() {
    if ($('openReconciliationCenter')) return;
    const host = document.querySelector('.actions.primary-actions');
    if (!host) return;
    const button = document.createElement('button');
    button.id = 'openReconciliationCenter';
    button.type = 'button';
    button.textContent = 'Reconciliation Center';
    button.addEventListener('click', () => { window.location.href = '/finance-reconciliation.html'; });
    const review = $('openReviewQueue');
    if (review?.nextSibling) host.insertBefore(button, review.nextSibling); else host.appendChild(button);
  }

  // iOS Safari clears Event.currentTarget after an async listener yields.
  // Preserve the submitting form so the existing Add Account / Import handlers
  // can safely call currentTarget.reset() and query their submit buttons after await.
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    try {
      Object.defineProperty(event, 'currentTarget', {
        configurable: true,
        enumerable: true,
        value: form
      });
    } catch (error) {
      console.warn('Finance form compatibility guard could not preserve currentTarget.', error);
    }
  }, true);

  function advancedNotice(message, tone = 'info') {
    const el = $('advancedNotice');
    if (!el) return;
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

  function tag(text, kind = '') {
    return `<span class="insight-tag ${kind}">${escapeHtml(text)}</span>`;
  }

  function renderInsights(payload) {
    const summary = payload.summary || {};
    $('insightPending').textContent = Number(summary.pending || 0);
    $('insightCategories').textContent = Number(summary.category_suggestions || 0);
    $('insightTransfers').textContent = Number(summary.transfer_candidates || 0);
    $('insightRecurring').textContent = Number(summary.recurring || 0);
    $('insightAnomalies').textContent = Number(summary.anomalies || 0);

    const rows = payload.insights || [];
    const host = $('insightList');
    if (!rows.length) {
      host.innerHTML = '<div class="empty"><strong>No suggestions yet</strong><span>Import transactions, then press “Analyse Transactions”.</span></div>';
      return;
    }
    host.innerHTML = rows.map((row) => {
      const amount = Number(row.debit || 0) > 0 ? -Number(row.debit || 0) : Number(row.credit || 0);
      const tags = [];
      if (row.suggested_category) tags.push(tag(`${row.suggested_category} · ${Math.round(Number(row.category_confidence || 0))}%`));
      if (row.suggested_scope && row.suggested_scope !== row.current_scope) tags.push(tag(`Suggest ${row.suggested_scope} · ${Math.round(Number(row.scope_confidence || 0))}%`));
      if (row.transfer_candidate_uid) tags.push(tag('Possible own-account transfer', 'transfer'));
      if (row.recurring_frequency) tags.push(tag(`Recurring ${String(row.recurring_frequency).toLowerCase()}`, 'recurring'));
      if (Number(row.anomaly_score || 0) >= 70) tags.push(tag('Unusual amount', 'anomaly'));
      const flagged = Number(row.anomaly_score || 0) >= 70 ? ' flagged' : '';
      return `<article class="insight-card${flagged}" data-insight-id="${Number(row.id)}">
        <div class="insight-head">
          <div><h3>${escapeHtml(row.merchant_normalized || row.merchant_name || row.description || 'Transaction')}</h3><p>${escapeHtml(row.account_name || '')} · ${escapeHtml(String(row.transaction_date || '').slice(0, 10))} · currently ${escapeHtml(row.current_scope || 'UNCLASSIFIED')}</p></div>
          <div class="insight-amount">${money(amount, row.currency || 'AUD')}</div>
        </div>
        <div class="insight-tags">${tags.join('') || tag('Manual review')}</div>
        <div class="insight-reason">${escapeHtml(row.explanation || 'Review this transaction manually.')}</div>
        <div class="insight-actions">
          <button class="apply" type="button" data-action="apply" data-id="${Number(row.id)}">Apply suggestion</button>
          ${row.transfer_candidate_uid ? `<label><input type="checkbox" data-transfer="${Number(row.id)}"> Confirm as transfer</label>` : ''}
          ${row.suggested_scope && row.suggested_scope !== row.current_scope ? `<label><input type="checkbox" data-scope="${Number(row.id)}"> Apply ${escapeHtml(row.suggested_scope)}</label>` : ''}
          <label><input type="checkbox" data-remember="${Number(row.id)}"> Remember merchant rule</label>
          <button type="button" data-action="dismiss" data-id="${Number(row.id)}">Dismiss</button>
        </div>
      </article>`;
    }).join('');
  }

  async function loadInsights() {
    try {
      const payload = await api(`/api/finance/intelligence/insights?scope=${encodeURIComponent(scope)}`);
      renderInsights(payload);
    } catch (error) {
      if (error.status === 401) return window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
      advancedNotice(error.message, 'error');
    }
  }

  async function runAnalysis() {
    const buttons = [$('analyseTransactions'), $('analyseTransactionsTop')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; button.textContent = 'Analysing…'; });
    advancedNotice('Checking merchants, categories, recurring payments, transfers and unusual spending. Nothing will be changed automatically.', 'info');
    try {
      const result = await api('/api/finance/intelligence/analyse', { method: 'POST', body: JSON.stringify({ scope }) });
      advancedNotice(result.message || 'Analysis complete.', 'success');
      await loadInsights();
    } catch (error) {
      advancedNotice(error.message, 'error');
    } finally {
      if ($('analyseTransactions')) { $('analyseTransactions').disabled = false; $('analyseTransactions').textContent = 'Analyse Transactions'; }
      if ($('analyseTransactionsTop')) { $('analyseTransactionsTop').disabled = false; $('analyseTransactionsTop').textContent = 'Run Analysis'; }
    }
  }

  async function applyInsight(id) {
    const card = document.querySelector(`[data-insight-id="${id}"]`);
    const applyTransfer = Boolean(card?.querySelector(`[data-transfer="${id}"]`)?.checked);
    const applyScope = Boolean(card?.querySelector(`[data-scope="${id}"]`)?.checked);
    const rememberRule = Boolean(card?.querySelector(`[data-remember="${id}"]`)?.checked);
    try {
      const result = await api(`/api/finance/intelligence/insights/${id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ apply_category: true, apply_scope: applyScope, apply_transfer: applyTransfer, remember_rule: rememberRule })
      });
      advancedNotice(result.message, 'success');
      await loadInsights();
      document.getElementById('refreshDashboard')?.click();
    } catch (error) {
      advancedNotice(error.message, 'error');
    }
  }

  async function dismissInsight(id) {
    try {
      const result = await api(`/api/finance/intelligence/insights/${id}/dismiss`, { method: 'POST', body: '{}' });
      advancedNotice(result.message, 'success');
      await loadInsights();
    } catch (error) {
      advancedNotice(error.message, 'error');
    }
  }

  function openAction(action) {
    if (action === 'accounts') return $('addAccount')?.click();
    if (action === 'import') return $('importStatement')?.click();
    if (action === 'review') return $('openReviewQueue')?.click();
    if (action === 'analyse') return runAnalysis();
    if (action === 'insights') return $('intelligencePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  installReconciliationButton();
  document.querySelectorAll('.scope').forEach((button) => button.addEventListener('click', () => {
    scope = String(button.dataset.scope || 'ALL').toUpperCase();
    loadInsights();
  }));
  $('analyseTransactions')?.addEventListener('click', runAnalysis);
  $('analyseTransactionsTop')?.addEventListener('click', runAnalysis);
  document.querySelectorAll('[data-guide]').forEach((button) => button.addEventListener('click', () => openAction(button.dataset.guide)));
  $('insightList')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id || 0);
    if (!id) return;
    if (button.dataset.action === 'apply') applyInsight(id);
    else if (button.dataset.action === 'dismiss') dismissInsight(id);
  });

  const requestedAction = new URLSearchParams(location.search).get('action');
  loadInsights().finally(() => {
    if (requestedAction) window.setTimeout(() => openAction(requestedAction), 250);
  });
})();
