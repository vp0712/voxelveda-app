(() => {
  const reliabilityScript = document.createElement('script');
  reliabilityScript.src = '/finance-action-reliability.js?v=20260916-reliability';
  reliabilityScript.async = false;
  document.head.appendChild(reliabilityScript);

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (input) => String(input ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  let readiness = null;

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
      error.status = response.status;
      error.code = payload.code;
      error.missing = payload.missing || [];
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
    return 'You can safely use statement imports now. Open Banking is being prepared in sandbox mode and remains separate from live finance data.';
  }

  function ensureProviderPanel() {
    if ($('providerSetupPanel')) return $('providerSetupPanel');
    const panel = document.createElement('section');
    panel.id = 'providerSetupPanel';
    panel.className = 'provider-setup-box';
    panel.innerHTML = `
      <div class="provider-head"><div><p class="eyebrow">OPEN BANKING PROVIDER</p><h3>Connect safely in sandbox first</h3><p>Choose a provider, add its secret credentials in Railway, test consent, then unlock production only after verification.</p></div><span id="providerEnvironmentBadge" class="badge">Loading…</span></div>
      <div id="providerRecommendation" class="provider-recommendation"></div>
      <div id="providerCards" class="provider-grid"></div>
      <div class="provider-flow"><strong>How this works</strong><span>1 · Provider setup</span><span>2 · Sandbox consent</span><span>3 · Verify webhook/sync</span><span>4 · Approve production</span></div>
      <div id="providerSessionList" class="provider-sessions"></div>
      <p id="providerMessage" class="muted"></p>`;
    const target = $('bankingSafetyControls');
    target?.parentElement?.insertBefore(panel, target);
    const style = document.createElement('style');
    style.textContent = `.provider-setup-box{margin:20px 0;padding:20px;border:1px solid rgba(127,127,127,.22);border-radius:16px}.provider-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.provider-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:16px 0}.provider-card{border:1px solid rgba(127,127,127,.22);border-radius:14px;padding:15px}.provider-card.selected{outline:2px solid currentColor}.provider-card h4{margin:0 0 6px}.provider-card ul{padding-left:18px;margin:10px 0}.provider-card button{width:100%;margin-top:10px}.provider-flow{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.provider-flow span{padding:7px 10px;border-radius:999px;background:rgba(127,127,127,.1);font-size:.85rem}.provider-recommendation{padding:12px;border-radius:12px;background:rgba(127,127,127,.08);margin-top:12px}.provider-session{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)}@media(max-width:650px){.provider-head,.provider-session{flex-direction:column}}`;
    document.head.appendChild(style);
    return panel;
  }

  function renderProviders(payload) {
    ensureProviderPanel();
    $('providerEnvironmentBadge').textContent = `${payload.environment} · live sync ${payload.live_sync_enabled ? 'enabled' : 'locked'}`;
    $('providerRecommendation').innerHTML = `<strong>Recommended first test: ${escapeHtml(payload.recommendation?.provider || 'BASIQ')}</strong><br><span>${escapeHtml(payload.recommendation?.reason || '')}</span>`;
    $('providerCards').innerHTML = (payload.providers || []).map((provider) => `
      <article class="provider-card ${provider.selected ? 'selected' : ''}">
        <h4>${escapeHtml(provider.name)} ${provider.selected ? '· Selected' : ''}</h4>
        <small>${escapeHtml(String(provider.adapter_status || '').replaceAll('_',' '))}</small>
        <ul>${(provider.strengths || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <p><b>${provider.configured ? 'Credentials ready' : 'Setup required'}</b>${provider.missing?.length ? `<br><small>Missing: ${escapeHtml(provider.missing.join(', '))}</small>` : ''}</p>
        ${provider.key === 'BASIQ' ? `<button type="button" data-provider-consent="BASIQ" ${provider.configured ? '' : 'disabled'}>${provider.configured ? 'Start sandbox consent' : 'Add Basiq API key first'}</button>` : '<button type="button" disabled>Adapter planned after sandbox verification</button>'}
      </article>`).join('');
  }

  async function loadProviderSessions() {
    try {
      const payload = await api('/api/finance/intelligence/open-banking/sessions');
      const rows = payload.sessions || [];
      $('providerSessionList').innerHTML = rows.length ? `<h4>Recent consent sessions</h4>${rows.map((row) => `<div class="provider-session"><div><b>${escapeHtml(row.provider)} · ${escapeHtml(row.environment)}</b><br><small>${escapeHtml(row.session_uid)} · ${escapeHtml(row.status)}</small></div><small>Expires: ${escapeHtml(row.expires_at || '—')}</small></div>`).join('')}` : '<p class="muted">No sandbox consent sessions yet.</p>';
    } catch (error) {
      $('providerSessionList').innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadProviders() {
    try {
      const payload = await api('/api/finance/intelligence/open-banking/providers');
      renderProviders(payload);
      await loadProviderSessions();
    } catch (error) {
      ensureProviderPanel();
      $('providerMessage').textContent = error.message;
    }
  }

  async function startConsent(provider) {
    const message = $('providerMessage');
    message.textContent = 'Creating a secure sandbox consent session…';
    try {
      const payload = await api('/api/finance/intelligence/open-banking/consent', { method: 'POST', body: JSON.stringify({ provider }) });
      message.textContent = payload.safety || payload.message;
      await loadProviderSessions();
      if (payload.consent_url) window.location.assign(payload.consent_url);
    } catch (error) {
      message.textContent = error.code === 'STEP_UP_REQUIRED' ? 'Security verification is required. Complete the verification window and the action will continue automatically.' : error.message;
    }
  }

  function renderControls(items) {
    const host = $('bankingSafetyControls'); if (!host) return;
    host.innerHTML = items.map((item) => `<article class="safety-card ${statusClass(item.status)}"><div class="safety-card-head"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description || '')}</small></div><span class="safety-status ${statusClass(item.status)}">${statusText(item.status)}</span></div><p>${escapeHtml(item.detail || '')}</p>${item.required_for_bank_feed ? '<em>Required before automatic bank feeds</em>' : '<em>Available for manual statement workflow</em>'}</article>`).join('');
  }
  function renderActions(items) { const host=$('bankingNextActions'); if(host) host.innerHTML=items.length?items.map((item,index)=>`<div class="next-action"><span>${index+1}</span><p>${escapeHtml(item)}</p></div>`).join(''):'<div class="next-action done"><span>✓</span><p>No unresolved setup items were reported.</p></div>'; }
  function renderSafetyRules(items) { const host=$('bankingSafetyRules'); if(host) host.innerHTML=items.map((item)=>`<li>${escapeHtml(item)}</li>`).join(''); }
  function renderConnections(connections) { const host=$('bankConnectionHistory'); if(!host)return; host.innerHTML=connections.length?connections.map((row)=>`<div class="connection-row"><div><strong>${escapeHtml(row.institution||row.provider||'Bank connection')}</strong><small>${escapeHtml(row.connection_uid||'')}</small></div><div><b>${escapeHtml(row.consent_status||'UNKNOWN')}</b><small>Last sync: ${escapeHtml(row.last_sync_completed_at||'Never')}</small></div></div>`).join(''):'<div class="empty"><strong>No live-bank consents yet</strong><span>This is expected while Open Banking remains in sandbox/setup mode.</span></div>'; }
  function updateConnectButton(payload) { const button=$('connectBank'); if(!button)return; button.textContent=payload.open_banking?.enabled?'Connect Bank':'Open Banking Setup'; button.dataset.readinessBlocked=payload.open_banking?.enabled?'false':'true'; }

  async function loadReadiness() {
    const button=$('refreshBankingSafety'); if(button){button.disabled=true;button.textContent='Checking…';}
    try {
      const payload=await api('/api/finance/intelligence/banking-readiness'); readiness=payload;
      $('bankingReadinessHeadline').textContent=payload.headline||'Banking status loaded.';
      $('bankingReadinessExplanation').textContent=explainOverall(payload);
      const badge=$('bankingReadinessBadge'); badge.textContent=payload.open_banking?.credentials_present?'Open Banking setup started':'Manual banking ready'; badge.className=`badge ${payload.open_banking?.credentials_present?'warn':'ok'}`;
      $('manualImportState').textContent=payload.manual_import_ready?'Ready now':'Needs attention';
      $('openBankingState').textContent=payload.open_banking?.enabled?'Live':'Sandbox / setup';
      $('openBankingProvider').textContent=payload.open_banking?.provider_name||'No provider selected';
      $('openBankingReason').textContent=payload.open_banking?.explanation||'';
      updateConnectButton(payload); renderControls(payload.controls||[]); renderActions(payload.next_actions||[]); renderSafetyRules(payload.safety_rules||[]); renderConnections(payload.connections||[]);
      await loadProviders();
    } catch(error){ if(error.status===401)return window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`); $('bankingReadinessHeadline').textContent='Could not load banking safety status.'; $('bankingReadinessExplanation').textContent=error.message; }
    finally { if(button){button.disabled=false;button.textContent='Check again';} }
  }

  $('refreshBankingSafety')?.addEventListener('click',loadReadiness);
  $('openBankingSafety')?.addEventListener('click',()=>$('bankingSafetyPanel')?.scrollIntoView({behavior:'smooth',block:'start'}));
  $('connectBank')?.addEventListener('click',(event)=>{ if(readiness?.open_banking?.enabled)return; event.preventDefault();event.stopImmediatePropagation();$('bankingSafetyPanel')?.scrollIntoView({behavior:'smooth',block:'start'});ensureProviderPanel()?.scrollIntoView({behavior:'smooth',block:'center'}); },true);
  document.addEventListener('click',(event)=>{ const button=event.target.closest('[data-provider-consent]'); if(button&&!button.disabled) startConsent(button.dataset.providerConsent); });
  loadReadiness();
})();
