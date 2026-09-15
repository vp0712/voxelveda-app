(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (input) => String(input ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  let readiness = null;

  async function api(path) {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function statusText(status) {
    return ({ READY: 'Ready', PARTIAL: 'Partly ready', NEEDS_SETUP: 'Needs setup', BLOCKED: 'Blocked' })[status] || 'Unknown';
  }

  function statusClass(status) {
    return ({ READY: 'ready', PARTIAL: 'partial', NEEDS_SETUP: 'needs', BLOCKED: 'blocked' })[status] || 'needs';
  }

  function explainOverall(payload) {
    if (payload.overall === 'PROVIDER_CREDENTIALS_READY') return 'Infrastructure checks are strong enough to move to provider-adapter verification. Live bank consent is still intentionally disabled until the provider flow is tested end to end.';
    if (payload.overall === 'PROVIDER_PARTIAL') return 'Provider credentials appear to exist, but one or more production controls still need work before automatic bank syncing should be enabled.';
    return 'You can safely use statement imports now. Live bank syncing is intentionally off until a CDR provider and the required production controls are verified.';
  }

  function renderControls(items) {
    const host = $('bankingSafetyControls');
    if (!host) return;
    host.innerHTML = items.map((item) => `
      <article class="safety-card ${statusClass(item.status)}">
        <div class="safety-card-head">
          <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description || '')}</small></div>
          <span class="safety-status ${statusClass(item.status)}">${statusText(item.status)}</span>
        </div>
        <p>${escapeHtml(item.detail || '')}</p>
        ${item.required_for_bank_feed ? '<em>Required before automatic bank feeds</em>' : '<em>Available for manual statement workflow</em>'}
      </article>`).join('');
  }

  function renderActions(items) {
    const host = $('bankingNextActions');
    if (!host) return;
    host.innerHTML = items.length
      ? items.map((item, index) => `<div class="next-action"><span>${index + 1}</span><p>${escapeHtml(item)}</p></div>`).join('')
      : '<div class="next-action done"><span>✓</span><p>No unresolved setup items were reported.</p></div>';
  }

  function renderSafetyRules(items) {
    const host = $('bankingSafetyRules');
    if (!host) return;
    host.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  function renderConnections(connections) {
    const host = $('bankConnectionHistory');
    if (!host) return;
    if (!connections.length) {
      host.innerHTML = '<div class="empty"><strong>No live-bank consents yet</strong><span>This is expected until an Australian CDR provider is configured.</span></div>';
      return;
    }
    host.innerHTML = connections.map((row) => `
      <div class="connection-row">
        <div><strong>${escapeHtml(row.institution || row.provider || 'Bank connection')}</strong><small>${escapeHtml(row.connection_uid || '')}</small></div>
        <div><b>${escapeHtml(row.consent_status || 'UNKNOWN')}</b><small>Last sync: ${escapeHtml(row.last_sync_completed_at || 'Never')}</small></div>
      </div>`).join('');
  }

  function updateConnectButton(payload) {
    const button = $('connectBank');
    if (!button) return;
    if (payload.open_banking?.enabled) {
      button.textContent = 'Connect Bank';
      button.title = 'Start a secure CDR consent flow.';
      button.dataset.readinessBlocked = 'false';
      return;
    }
    button.textContent = 'Connect Bank · Setup Required';
    button.title = 'Open Banking is intentionally disabled until production CDR setup is verified.';
    button.dataset.readinessBlocked = 'true';
  }

  async function loadReadiness() {
    const button = $('refreshBankingSafety');
    if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      const payload = await api('/api/finance/intelligence/banking-readiness');
      readiness = payload;
      $('bankingReadinessHeadline').textContent = payload.headline || 'Banking status loaded.';
      $('bankingReadinessExplanation').textContent = explainOverall(payload);
      const badge = $('bankingReadinessBadge');
      badge.textContent = payload.open_banking?.credentials_present ? 'Open Banking setup started' : 'Manual banking ready';
      badge.className = `badge ${payload.open_banking?.credentials_present ? 'warn' : 'ok'}`;

      $('manualImportState').textContent = payload.manual_import_ready ? 'Ready now' : 'Needs attention';
      $('openBankingState').textContent = payload.open_banking?.enabled ? 'Live' : 'Not enabled yet';
      $('openBankingProvider').textContent = payload.open_banking?.provider_name || 'No provider selected';
      $('openBankingReason').textContent = payload.open_banking?.explanation || '';
      updateConnectButton(payload);

      renderControls(payload.controls || []);
      renderActions(payload.next_actions || []);
      renderSafetyRules(payload.safety_rules || []);
      renderConnections(payload.connections || []);
    } catch (error) {
      if (error.status === 401) return window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
      $('bankingReadinessHeadline').textContent = 'Could not load banking safety status.';
      $('bankingReadinessExplanation').textContent = error.message;
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Check again'; }
    }
  }

  $('refreshBankingSafety')?.addEventListener('click', loadReadiness);
  $('openBankingSafety')?.addEventListener('click', () => $('bankingSafetyPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('connectBank')?.addEventListener('click', (event) => {
    if (!readiness || readiness.open_banking?.enabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    $('bankingSafetyPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const headline = $('bankingReadinessHeadline');
    if (headline) headline.textContent = 'Connect Bank is locked until the items below are ready.';
  }, true);

  loadReadiness();
})();
