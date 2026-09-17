(() => {
  const $ = (id) => document.getElementById(id);
  let latestSnapshot = null;

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function safeState(value) {
    const state = String(value || 'blocked').toLowerCase();
    return ['ready', 'action_required', 'blocked', 'pending'].includes(state) ? state : 'blocked';
  }

  function makeStep(step, index) {
    const state = safeState(step.status);
    const row = document.createElement('article');
    row.className = `recovery-drill-step recovery-drill-status-${state}`;

    const marker = document.createElement('span');
    marker.className = 'recovery-drill-step-index';
    marker.textContent = String(index + 1).padStart(2, '0');

    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = step.title || 'Recovery step';
    const purpose = document.createElement('p');
    purpose.textContent = step.purpose || '';
    const detail = document.createElement('small');
    const label = state === 'ready' ? 'READY' : state === 'blocked' ? 'BLOCKED' : state === 'action_required' ? 'ACTION REQUIRED' : 'PENDING';
    detail.textContent = `${label} — ${step.detail || 'No detail supplied.'}`;
    body.append(title, purpose, detail);

    if (Array.isArray(step.evidence) && step.evidence.length) {
      const evidence = document.createElement('small');
      evidence.textContent = `Evidence: ${step.evidence.join(' • ')}`;
      body.appendChild(evidence);
    }

    row.append(marker, body);
    return row;
  }

  function downloadJson() {
    if (!latestSnapshot) return;
    const blob = new Blob([JSON.stringify(latestSnapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recovery-drill-readiness-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function render(data) {
    latestSnapshot = data;
    const state = safeState(data.state);
    const stateNode = $('recoveryDrillState');
    if (stateNode) {
      stateNode.className = `recovery-drill-state recovery-drill-status-${state}`;
      stateNode.textContent = state === 'ready' ? 'VERIFIED' : state === 'blocked' ? 'BLOCKED' : 'ACTION REQUIRED';
    }

    setText('recoveryDrillPlainLanguage', data.plain_language || 'Recovery drill status is unavailable.');
    setText('recoveryRpoTarget', `≤ ${Number(data.objectives?.rpo_hours || 24)}h`);
    setText('recoveryRtoTarget', `≤ ${Number(data.objectives?.rto_hours || 4)}h`);
    setText('recoveryDrillProgressLabel', `${Number(data.progress?.completed_steps || 0)} / ${Number(data.progress?.total_steps || 0)} steps ready`);
    setText('recoveryDrillGate', data.gates?.formal_drill_ready ? 'READY' : 'NOT READY');
    setText('recoveryDrillVerified', data.gates?.recovery_assurance_verified ? 'VERIFIED' : 'NOT VERIFIED');

    const progress = $('recoveryDrillProgressBar');
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, Number(data.progress?.percent || 0)))}%`;

    const steps = $('recoveryDrillSteps');
    if (steps) {
      steps.replaceChildren();
      (data.steps || []).forEach((step, index) => steps.appendChild(makeStep(step, index)));
      if (!data.steps?.length) {
        const empty = document.createElement('p');
        empty.className = 'status-note';
        empty.textContent = 'No drill steps are available.';
        steps.appendChild(empty);
      }
    }

    const evidence = $('recoveryDrillEvidence');
    if (evidence) {
      evidence.replaceChildren();
      (data.evidence_pack || []).forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        evidence.appendChild(li);
      });
    }

    setText('recoveryDrillSafety', data.safety?.message || 'Production restore is not available from this center.');
  }

  function renderError(message) {
    latestSnapshot = null;
    const stateNode = $('recoveryDrillState');
    if (stateNode) {
      stateNode.className = 'recovery-drill-state recovery-drill-status-blocked';
      stateNode.textContent = 'CHECK FAILED';
    }
    setText('recoveryDrillPlainLanguage', message || 'Recovery drill readiness could not be checked.');
  }

  async function load() {
    const refresh = $('refreshRecoveryDrill');
    if (refresh) {
      refresh.disabled = true;
      refresh.textContent = 'Checking…';
    }
    try {
      const response = await fetch('/api/security/readiness/recovery/drill', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) {
        window.location.assign('/login?message=Please%20login%20to%20continue.');
        return;
      }
      if (response.status === 403) {
        renderError('Your account does not have permission to view recovery drill readiness.');
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.message || `Recovery drill check returned HTTP ${response.status}.`);
      render(data);
    } catch (error) {
      renderError(error?.message || 'Recovery drill readiness is temporarily unavailable.');
    } finally {
      if (refresh) {
        refresh.disabled = false;
        refresh.textContent = 'Refresh Drill Readiness';
      }
    }
  }

  function init() {
    if (!$('recoveryDrillCenter')) return;
    $('refreshRecoveryDrill')?.addEventListener('click', load);
    $('exportRecoveryDrill')?.addEventListener('click', downloadJson);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();