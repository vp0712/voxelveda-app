(() => {
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  async function api(url) {
    const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) {
      window.location.assign('/login?message=Please%20login%20to%20continue.');
      throw new Error('Authentication required.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Request failed with HTTP ${response.status}.`);
    return data;
  }

  function stateLabel(state) {
    if (state === 'CRITICAL') return 'CRITICAL';
    if (state === 'ACTION_REQUIRED') return 'ACTION REQUIRED';
    if (state === 'WATCH') return 'WATCH';
    return 'HEALTHY';
  }

  function severityWeight(value) {
    return { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, OK: 1 }[value] || 0;
  }

  function makeMetric(label, value) {
    const card = el('article', 'recovery-governance-metric');
    card.append(el('span', '', label), el('strong', '', String(value ?? 0)));
    return card;
  }

  function makeAttention(item) {
    const row = el('article', `recovery-governance-item severity-${String(item.severity || 'OK').toLowerCase()}`);
    const head = el('div', 'recovery-governance-item-head');
    head.append(
      el('strong', '', item.title || 'Recovery drill'),
      el('span', 'recovery-governance-badge', item.severity || 'OK')
    );
    const reasons = el('ul', 'recovery-governance-reasons');
    (item.reasons || []).forEach((reason) => reasons.appendChild(el('li', '', reason)));
    const meta = el('small', 'recovery-governance-meta');
    const parts = [];
    if (item.final_decision) parts.push(`Decision: ${item.final_decision}`);
    if (item.days_until_next_drill !== null && item.days_until_next_drill !== undefined) {
      parts.push(item.days_until_next_drill < 0
        ? `Overdue ${Math.abs(item.days_until_next_drill)}d`
        : `Next drill in ${item.days_until_next_drill}d`);
    }
    if (item.evidence_ref_count !== undefined) parts.push(`Evidence refs: ${item.evidence_ref_count}`);
    if (item.finding_count !== undefined) parts.push(`Findings: ${item.finding_count}`);
    meta.textContent = parts.join(' • ');
    row.append(head, reasons, meta);
    return row;
  }

  function injectUi() {
    const parent = $('recoveryDrillCenter');
    if (!parent || $('recoveryGovernancePanel')) return;
    const section = el('section', 'recovery-governance-panel');
    section.id = 'recoveryGovernancePanel';
    section.innerHTML = `
      <div class="recovery-governance-head">
        <div>
          <span class="eyebrow">Governance & Escalation</span>
          <h4>Recovery Drill Governance Command Panel</h4>
          <p>Turns failed drills, missed recovery objectives, overdue schedules, stale drafts and evidence gaps into a prioritized operator queue.</p>
        </div>
        <div class="recovery-governance-actions">
          <span id="recoveryGovernanceState" class="recovery-governance-state">CHECKING</span>
          <button type="button" class="secondary-btn" id="refreshRecoveryGovernance">Refresh Governance</button>
        </div>
      </div>
      <div id="recoveryGovernanceMetrics" class="recovery-governance-metrics"></div>
      <div class="recovery-governance-grid">
        <div>
          <h4>Priority queue</h4>
          <div id="recoveryGovernanceQueue" class="recovery-governance-queue"><p class="status-note">Checking recovery governance…</p></div>
        </div>
        <div>
          <h4>Operator guidance</h4>
          <ol id="recoveryGovernanceGuidance" class="recovery-governance-guidance"></ol>
          <p class="recovery-governance-boundary">This panel does not trigger restores and does not claim provider backup telemetry is verified.</p>
        </div>
      </div>`;
    parent.appendChild(section);
    $('refreshRecoveryGovernance')?.addEventListener('click', load);
  }

  function render(data) {
    const state = $('recoveryGovernanceState');
    if (state) {
      state.textContent = stateLabel(data.state);
      state.className = `recovery-governance-state state-${String(data.state || 'HEALTHY').toLowerCase()}`;
    }

    const metrics = $('recoveryGovernanceMetrics');
    if (metrics) {
      metrics.replaceChildren(
        makeMetric('Critical', data.summary?.critical),
        makeMetric('High', data.summary?.high),
        makeMetric('Overdue', data.summary?.overdue),
        makeMetric('Objective misses', data.summary?.objective_misses),
        makeMetric('Failed drills', data.summary?.failed_drills)
      );
    }

    const queue = $('recoveryGovernanceQueue');
    if (queue) {
      queue.replaceChildren();
      const items = [...(data.attention || [])].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
      if (!items.length) {
        queue.appendChild(el('p', 'status-note', 'No recovery drill issues currently require attention.'));
      } else {
        items.forEach((item) => queue.appendChild(makeAttention(item)));
      }
    }

    const guidance = $('recoveryGovernanceGuidance');
    if (guidance) {
      guidance.replaceChildren();
      (data.guidance || []).forEach((item) => guidance.appendChild(el('li', '', item)));
    }
  }

  function renderError(message) {
    const state = $('recoveryGovernanceState');
    if (state) {
      state.textContent = 'CHECK FAILED';
      state.className = 'recovery-governance-state state-critical';
    }
    const queue = $('recoveryGovernanceQueue');
    if (queue) {
      queue.replaceChildren(el('p', 'status-note', message || 'Recovery governance status could not be loaded.'));
    }
  }

  async function load() {
    const button = $('refreshRecoveryGovernance');
    if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      render(await api('/api/security/readiness/recovery/drills/governance'));
    } catch (error) {
      renderError(error?.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Refresh Governance'; }
    }
  }

  function init() {
    injectUi();
    if ($('recoveryGovernancePanel')) load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();