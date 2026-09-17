(() => {
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const fmtHours = (value) => value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}h`;

  function renderQueue(items) {
    const root = $('recoveryExecQueue');
    if (!root) return;
    root.replaceChildren();
    if (!items?.length) {
      const li = document.createElement('li'); li.className = 'recovery-exec-item'; li.textContent = 'No open recovery remediation items.'; root.appendChild(li); return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.className = `recovery-exec-item recovery-exec-level-${item.escalation || 'NORMAL'}`;
      const title = document.createElement('strong'); title.textContent = item.title || 'Recovery remediation';
      const meta = document.createElement('small');
      meta.textContent = `${item.priority || 'MEDIUM'} • ${item.escalation || 'NORMAL'} • Owner: ${item.owner_label || 'UNASSIGNED'} • SLA ${item.sla_breached ? 'BREACHED' : 'within target'}${item.overdue_hours > 0 ? ` • overdue ${item.overdue_hours}h` : ''}`;
      li.append(title, meta); root.appendChild(li);
    }
  }

  function renderActions(actions) {
    const root = $('recoveryExecActions'); if (!root) return; root.replaceChildren();
    (actions || []).forEach((action) => { const li = document.createElement('li'); li.textContent = action; root.appendChild(li); });
  }

  function render(data) {
    const level = data.risk?.level || 'UNKNOWN';
    const risk = $('recoveryExecRisk');
    if (risk) risk.className = `recovery-exec-risk recovery-exec-level-${level}`;
    text('recoveryExecRiskScore', String(data.risk?.score ?? '—'));
    text('recoveryExecRiskLevel', level);
    text('recoveryExecOpen', data.summary?.open ?? 0);
    text('recoveryExecEscalations', data.summary?.executive_escalations ?? 0);
    text('recoveryExecBreaches', data.summary?.sla_breaches ?? 0);
    text('recoveryExecOverdue', data.summary?.overdue ?? 0);
    text('recoveryExecUnassigned', data.summary?.unassigned ?? 0);
    text('recoveryExecMttr', fmtHours(data.summary?.mttr_hours));
    text('recoveryExecDrills90', data.summary?.drills_90d ?? 0);
    text('recoveryExecFailures90', data.summary?.failed_drills_90d ?? 0);
    text('recoveryExecMisses90', data.summary?.objective_misses_90d ?? 0);
    text('recoveryExecExplanation', data.risk?.explanation || 'Recovery risk overview unavailable.');
    text('recoveryExecSafety', data.safety?.message || 'This view is read-only governance.');
    renderQueue(data.queue || []); renderActions(data.actions || []);
  }

  async function load() {
    const button = $('refreshRecoveryExec');
    if (button) { button.disabled = true; button.textContent = 'Refreshing…'; }
    try {
      const response = await fetch('/api/security/readiness/recovery/executive', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (response.status === 401) return window.location.assign('/login?message=Please%20login%20to%20continue.');
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.message || `Executive oversight returned HTTP ${response.status}.`);
      render(data);
    } catch (error) {
      text('recoveryExecRiskLevel', 'CHECK FAILED');
      text('recoveryExecExplanation', error?.message || 'Executive recovery oversight is unavailable.');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Refresh Oversight'; }
    }
  }

  function init() { if (!$('recoveryExecutivePanel')) return; $('refreshRecoveryExec')?.addEventListener('click', load); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();