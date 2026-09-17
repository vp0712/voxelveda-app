(() => {
  const $ = (id) => document.getElementById(id);
  const stateLabels = {
    ready: 'READY',
    degraded: 'NEEDS ATTENTION',
    blocked: 'BLOCKED',
    unverified: 'UNVERIFIED'
  };

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function makeCheck(item) {
    const row = document.createElement('div');
    const status = String(item.status || 'unknown').toLowerCase();
    row.className = `recovery-check recovery-check-${status.replace(/[^a-z0-9_-]/g, '-')}`;

    const marker = document.createElement('span');
    marker.className = 'recovery-check-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = status === 'ready' ? '✓' : status === 'blocked' ? '!' : '•';

    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.title || String(item.id || 'Recovery check').replace(/_/g, ' ');
    const detail = document.createElement('p');
    detail.textContent = item.detail || item.message || 'No detail supplied.';
    body.append(title, detail);

    if (item.remediation) {
      const remediation = document.createElement('small');
      remediation.textContent = `Action: ${item.remediation}`;
      body.appendChild(remediation);
    }

    row.append(marker, body);
    return row;
  }

  function renderList(id, items, emptyText) {
    const container = $(id);
    if (!container) return;
    container.replaceChildren();
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'status-note';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    items.forEach((item) => container.appendChild(makeCheck(item)));
  }

  function render(data) {
    const rawState = String(data.state || 'unverified').toLowerCase();
    const state = Object.prototype.hasOwnProperty.call(stateLabels, rawState) ? rawState : 'unverified';
    const stateElement = $('recoveryAssuranceState');
    if (stateElement) {
      stateElement.className = `recovery-state is-${state}`;
      stateElement.textContent = stateLabels[state];
    }

    const headline = state === 'ready'
      ? 'Recovery evidence is current.'
      : state === 'blocked'
        ? 'Recovery readiness has a blocking failure.'
        : state === 'degraded'
          ? 'Recovery works need attention.'
          : 'Recovery is not evidence-backed yet.';

    setText('recoveryAssuranceHeadline', headline);
    setText('recoveryAssuranceSummary', data.summary || 'No recovery summary is available.');
    setText('recoveryBackupTarget', `≤ ${Number(data.thresholds?.backup_max_age_hours || 26)}h`);
    setText('recoveryRestoreTarget', `≤ ${Number(data.thresholds?.restore_test_max_age_days || 90)}d`);
    setText('recoveryMandatoryGate', data.mandatory ? 'ON' : 'OFF');
    setText('recoveryProviderStatus', data.provider_connected ? 'CONNECTED' : 'UNVERIFIED');
    renderList('recoveryAssuranceChecks', data.checks, 'No automated provider checks are available yet.');
    renderList('recoveryAssuranceGuidance', data.guidance, 'No additional recovery actions are currently required.');
  }

  function renderError(message) {
    const stateElement = $('recoveryAssuranceState');
    if (stateElement) {
      stateElement.className = 'recovery-state is-blocked';
      stateElement.textContent = 'CHECK FAILED';
    }
    setText('recoveryAssuranceHeadline', 'Recovery evidence could not be checked.');
    setText('recoveryAssuranceSummary', message || 'The recovery assurance request failed.');
  }

  async function loadRecoveryAssurance() {
    const button = $('refreshRecoveryAssurance');
    if (button) {
      button.disabled = true;
      button.textContent = 'Checking…';
    }
    try {
      const response = await fetch('/api/security/readiness/recovery', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) {
        window.location.assign('/login?message=Please%20login%20to%20continue.');
        return;
      }
      if (response.status === 403) {
        renderError('Your account does not have permission to view recovery assurance.');
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.message || `Recovery check returned HTTP ${response.status}.`);
      render(data);
    } catch (error) {
      renderError(error?.message || 'Recovery assurance is temporarily unavailable.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Refresh Recovery Check';
      }
    }
  }

  function init() {
    const panel = $('recoveryAssurancePanel');
    if (!panel) return;
    $('refreshRecoveryAssurance')?.addEventListener('click', loadRecoveryAssurance);
    loadRecoveryAssurance();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
