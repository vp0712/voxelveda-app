(() => {
  const $ = (id) => document.getElementById(id);
  const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  const escapeHtml = (input) => String(input ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  let scope = 'ALL';

  function installAdvancedStyles() {
    if ($('financeAdvancedRulesStyle')) return;
    const style = document.createElement('style');
    style.id = 'financeAdvancedRulesStyle';
    style.textContent = `
      .privacy-banner{margin:14px 0;padding:14px 16px;border:1px solid #cbd5e1;border-radius:14px;background:#f8fafc;display:flex;gap:12px;align-items:flex-start}.privacy-banner strong{display:block;margin-bottom:3px}.privacy-banner span{font-size:20px}.rules-dialog{width:min(820px,calc(100vw - 24px));max-height:86vh;border:0;border-radius:18px;padding:0}.rules-dialog::backdrop{background:rgba(15,23,42,.66)}.rules-shell{padding:20px}.rules-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.rules-list{display:grid;gap:12px;margin-top:16px}.rule-card{border:1px solid #dbe3ec;border-radius:14px;padding:14px;background:#fff}.rule-card.disabled{opacity:.62}.rule-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 100px;gap:10px}.rule-card label{font-size:12px;font-weight:700;color:#475569}.rule-card input,.rule-card select{box-sizing:border-box;width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:9px;margin-top:5px}.rule-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.rule-actions button{padding:8px 12px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;font-weight:700}.rule-actions .danger{color:#991b1b}.rules-explainer{padding:12px;border-radius:12px;background:#eef6ff;margin:12px 0;color:#334155;font-size:13px;line-height:1.45}.rule-empty{padding:26px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:14px}@media(max-width:700px){.rule-grid{grid-template-columns:1fr}.rules-shell{padding:14px}.rules-head{display:block}.rules-head button{margin-top:10px}}
    `;
    document.head.appendChild(style);
  }

  function installPrivacyBanner() {
    if ($('financePrivacyBanner')) return;
    const scopeRow = document.querySelector('.scope-row');
    if (!scopeRow) return;
    const banner = document.createElement('div');
    banner.id = 'financePrivacyBanner';
    banner.className = 'privacy-banner';
    banner.innerHTML = '<span>🔒</span><div><strong>Personal finance is private to you</strong><div>Voxel Veda Business accounts can be shared with authorised finance users. Personal, Mixed and Not sure accounts are owner-only and are removed from other users\' account lists, totals, statement queues, insights and reconciliation screens.</div></div>';
    scopeRow.insertAdjacentElement('afterend', banner);
  }

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

  function installRulesUi() {
    installAdvancedStyles();
    if (!$('openSmartRules')) {
      const host = document.querySelector('.actions.primary-actions');
      if (host) {
        const button = document.createElement('button');
        button.id = 'openSmartRules'; button.type = 'button'; button.textContent = 'Smart Rules';
        button.addEventListener('click', openRules);
        const reconciliation = $('openReconciliationCenter');
        if (reconciliation?.nextSibling) host.insertBefore(button, reconciliation.nextSibling); else host.appendChild(button);
      }
    }
    if (!$('smartRulesDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'smartRulesDialog'; dialog.className = 'rules-dialog';
      dialog.innerHTML = `<div class="rules-shell"><div class="rules-head"><div><p class="eyebrow">SMART RULES</p><h2>Remembered merchant rules</h2><p class="muted">Your saved rules improve future suggestions. They never post or reconcile a transaction automatically.</p></div><button type="button" id="closeSmartRules">Close</button></div><div class="rules-explainer"><b>How it works:</b> when a merchant matches one of your enabled rules, that saved category/scope becomes a 99% confidence suggestion. You still approve the suggestion before anything changes.</div><div id="smartRulesList" class="rules-list"><div class="rule-empty">Loading rules…</div></div></div>`;
      document.body.appendChild(dialog);
      $('closeSmartRules').addEventListener('click', () => dialog.close());
      $('smartRulesList').addEventListener('click', handleRuleAction);
    }
  }

  // iOS Safari clears Event.currentTarget after an async listener yields.
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    try { Object.defineProperty(event, 'currentTarget', { configurable: true, enumerable: true, value: form }); }
    catch (error) { console.warn('Finance form compatibility guard could not preserve currentTarget.', error); }
  }, true);

  function advancedNotice(message, tone = 'info') {
    const el = $('advancedNotice');
    if (!el) return;
    el.hidden = !message;
    el.className = `notice ${tone}`;
    el.textContent = message || '';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    let payload = {}; try { payload = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(payload.message || `Request failed (${response.status})`); error.code = payload.code; error.status = response.status; throw error; }
    return payload;
  }

  function tag(text, kind = '') { return `<span class="insight-tag ${kind}">${escapeHtml(text)}</span>`; }

  function renderInsights(payload) {
    const summary = payload.summary || {};
    $('insightPending').textContent = Number(summary.pending || 0);
    $('insightCategories').textContent = Number(summary.category_suggestions || 0);
    $('insightTransfers').textContent = Number(summary.transfer_candidates || 0);
    $('insightRecurring').textContent = Number(summary.recurring || 0);
    $('insightAnomalies').textContent = Number(summary.anomalies || 0);
    const rows = payload.insights || [];
    const host = $('insightList');
    if (!rows.length) { host.innerHTML = '<div class="empty"><strong>No suggestions yet</strong><span>Import transactions, then press “Analyse Transactions”.</span></div>'; return; }
    host.innerHTML = rows.map((row) => {
      const amount = Number(row.debit || 0) > 0 ? -Number(row.debit || 0) : Number(row.credit || 0);
      const tags = [];
      if (row.suggested_category) tags.push(tag(`${row.suggested_category} · ${Math.round(Number(row.category_confidence || 0))}%`));
      if (row.suggested_scope && row.suggested_scope !== row.current_scope) tags.push(tag(`Suggest ${row.suggested_scope} · ${Math.round(Number(row.scope_confidence || 0))}%`));
      if (row.transfer_candidate_uid) tags.push(tag('Possible own-account transfer', 'transfer'));
      if (row.recurring_frequency) tags.push(tag(`Recurring ${String(row.recurring_frequency).toLowerCase()}`, 'recurring'));
      if (Number(row.anomaly_score || 0) >= 70) tags.push(tag('Unusual amount', 'anomaly'));
      const flagged = Number(row.anomaly_score || 0) >= 70 ? ' flagged' : '';
      return `<article class="insight-card${flagged}" data-insight-id="${Number(row.id)}"><div class="insight-head"><div><h3>${escapeHtml(row.merchant_normalized || row.merchant_name || row.description || 'Transaction')}</h3><p>${escapeHtml(row.account_name || '')} · ${escapeHtml(String(row.transaction_date || '').slice(0, 10))} · currently ${escapeHtml(row.current_scope || 'UNCLASSIFIED')}</p></div><div class="insight-amount">${money(amount, row.currency || 'AUD')}</div></div><div class="insight-tags">${tags.join('') || tag('Manual review')}</div><div class="insight-reason">${escapeHtml(row.explanation || 'Review this transaction manually.')}</div><div class="insight-actions"><button class="apply" type="button" data-action="apply" data-id="${Number(row.id)}">Apply suggestion</button>${row.transfer_candidate_uid ? `<label><input type="checkbox" data-transfer="${Number(row.id)}"> Confirm as transfer</label>` : ''}${row.suggested_scope && row.suggested_scope !== row.current_scope ? `<label><input type="checkbox" data-scope="${Number(row.id)}"> Apply ${escapeHtml(row.suggested_scope)}</label>` : ''}<label><input type="checkbox" data-remember="${Number(row.id)}"> Remember merchant rule</label><button type="button" data-action="dismiss" data-id="${Number(row.id)}">Dismiss</button></div></article>`;
    }).join('');
  }

  async function loadInsights() {
    try { renderInsights(await api(`/api/finance/intelligence/insights?scope=${encodeURIComponent(scope)}`)); }
    catch (error) { if (error.status === 401) return window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`); advancedNotice(error.message, 'error'); }
  }

  async function runAnalysis() {
    const buttons = [$('analyseTransactions'), $('analyseTransactionsTop')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; button.textContent = 'Analysing…'; });
    advancedNotice('Checking your visible merchants, saved rules, categories, recurring payments, transfers and unusual spending. Nothing will be changed automatically.', 'info');
    try {
      const result = await api('/api/finance/intelligence/analyse', { method: 'POST', body: JSON.stringify({ scope }) });
      const rulePart = Number(result.saved_rule_matches || 0) ? ` ${result.saved_rule_matches} transaction(s) matched your saved rules.` : '';
      advancedNotice(`${result.message || 'Analysis complete.'}${rulePart}`, 'success');
      await loadInsights();
    } catch (error) { advancedNotice(error.message, 'error'); }
    finally {
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
      const result = await api(`/api/finance/intelligence/insights/${id}/apply`, { method: 'POST', body: JSON.stringify({ apply_category: true, apply_scope: applyScope, apply_transfer: applyTransfer, remember_rule: rememberRule }) });
      advancedNotice(result.message, 'success');
      await loadInsights();
      $('refreshDashboard')?.click();
    } catch (error) { advancedNotice(error.message, 'error'); }
  }

  async function dismissInsight(id) {
    try { const result = await api(`/api/finance/intelligence/insights/${id}/dismiss`, { method: 'POST', body: '{}' }); advancedNotice(result.message, 'success'); await loadInsights(); }
    catch (error) { advancedNotice(error.message, 'error'); }
  }

  function ruleScopeLabel(value) { return value === 'BUSINESS' ? 'Voxel Veda' : value === 'PERSONAL' ? 'Personal' : value === 'MIXED' ? 'Mixed' : value === 'UNCLASSIFIED' ? 'Not sure' : 'No scope rule'; }

  function renderRules(rows) {
    const host = $('smartRulesList');
    if (!rows.length) { host.innerHTML = '<div class="rule-empty"><strong>No remembered rules yet.</strong><br>Apply an insight and tick “Remember merchant rule”. It will appear here.</div>'; return; }
    host.innerHTML = rows.map((rule) => `<article class="rule-card ${Number(rule.enabled) ? '' : 'disabled'}" data-rule-id="${Number(rule.id)}"><div class="rule-grid"><label>Merchant<input data-field="merchant" value="${escapeHtml(rule.merchant_pattern)}" disabled></label><label>Category<input data-field="category" value="${escapeHtml(rule.category || '')}" placeholder="No category rule"></label><label>Money scope<select data-field="scope"><option value="" ${!rule.ownership_scope ? 'selected' : ''}>No scope rule</option><option value="PERSONAL" ${rule.ownership_scope === 'PERSONAL' ? 'selected' : ''}>Personal</option><option value="BUSINESS" ${rule.ownership_scope === 'BUSINESS' ? 'selected' : ''}>Voxel Veda</option><option value="MIXED" ${rule.ownership_scope === 'MIXED' ? 'selected' : ''}>Mixed</option><option value="UNCLASSIFIED" ${rule.ownership_scope === 'UNCLASSIFIED' ? 'selected' : ''}>Not sure</option></select></label><label>Priority<input data-field="priority" type="number" min="1" max="999" value="${Number(rule.priority || 200)}"></label></div><div class="tx-reason"><b>What this rule means:</b> when “${escapeHtml(rule.merchant_pattern)}” appears again, suggest ${escapeHtml(rule.category || 'the saved scope')} ${rule.ownership_scope ? `and ${escapeHtml(ruleScopeLabel(rule.ownership_scope))}` : ''}. It remains review-only.</div><div class="rule-actions"><label><input type="checkbox" data-field="enabled" ${Number(rule.enabled) ? 'checked' : ''}> Enabled</label><button type="button" data-rule-action="save">Save rule</button><button type="button" class="danger" data-rule-action="delete">Delete rule</button></div></article>`).join('');
  }

  async function loadRules() {
    try { const payload = await api('/api/finance/intelligence/rules'); renderRules(payload.rules || []); }
    catch (error) { $('smartRulesList').innerHTML = `<div class="rule-empty">${escapeHtml(error.message)}</div>`; }
  }

  async function openRules() {
    installRulesUi();
    $('smartRulesDialog').showModal();
    $('smartRulesList').innerHTML = '<div class="rule-empty">Loading rules…</div>';
    await loadRules();
  }

  async function handleRuleAction(event) {
    const button = event.target.closest('button[data-rule-action]');
    if (!button) return;
    const card = button.closest('[data-rule-id]');
    const id = Number(card?.dataset.ruleId || 0); if (!id) return;
    button.disabled = true;
    try {
      if (button.dataset.ruleAction === 'delete') {
        if (!window.confirm('Delete this remembered merchant rule? Existing transactions will not be changed.')) return;
        const result = await api(`/api/finance/intelligence/rules/${id}`, { method: 'DELETE', body: '{}' });
        advancedNotice(result.message, 'success');
      } else {
        const result = await api(`/api/finance/intelligence/rules/${id}`, { method: 'POST', body: JSON.stringify({ category: card.querySelector('[data-field="category"]').value.trim(), ownership_scope: card.querySelector('[data-field="scope"]').value, priority: Number(card.querySelector('[data-field="priority"]').value || 200), enabled: card.querySelector('[data-field="enabled"]').checked }) });
        advancedNotice(result.message, 'success');
      }
      await loadRules();
    } catch (error) { advancedNotice(error.message, 'error'); }
    finally { button.disabled = false; }
  }

  function openAction(action) {
    if (action === 'accounts') return $('addAccount')?.click();
    if (action === 'import') return $('importStatement')?.click();
    if (action === 'review') return $('openReviewQueue')?.click();
    if (action === 'analyse') return runAnalysis();
    if (action === 'insights') return $('intelligencePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (action === 'rules') return openRules();
  }

  installAdvancedStyles(); installReconciliationButton(); installRulesUi(); installPrivacyBanner();
  document.querySelectorAll('.scope').forEach((button) => button.addEventListener('click', () => { scope = String(button.dataset.scope || 'ALL').toUpperCase(); loadInsights(); }));
  $('analyseTransactions')?.addEventListener('click', runAnalysis);
  $('analyseTransactionsTop')?.addEventListener('click', runAnalysis);
  document.querySelectorAll('[data-guide]').forEach((button) => button.addEventListener('click', () => openAction(button.dataset.guide)));
  $('insightList')?.addEventListener('click', (event) => { const button = event.target.closest('button[data-action]'); if (!button) return; const id = Number(button.dataset.id || 0); if (!id) return; if (button.dataset.action === 'apply') applyInsight(id); else if (button.dataset.action === 'dismiss') dismissInsight(id); });

  const requestedAction = new URLSearchParams(location.search).get('action');
  loadInsights().finally(() => { if (requestedAction) window.setTimeout(() => openAction(requestedAction), 250); });
})();