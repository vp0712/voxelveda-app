(() => {
  const $ = (id) => document.getElementById(id);
  let records = [];
  let activeId = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function isoLocal(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function jsonHeaders() {
    return { Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    if (response.status === 401) {
      window.location.assign('/login?message=Please%20login%20to%20continue.');
      throw new Error('Authentication required.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Request failed with HTTP ${response.status}.`);
    return data;
  }

  function decisionLabel(value) {
    if (value === 'PASS_OBJECTIVES_MET') return 'PASS — objectives met';
    if (value === 'PASS_OBJECTIVES_MISSED') return 'PASS — objectives missed';
    if (value === 'FAILED') return 'FAILED';
    return value || 'Not finalized';
  }

  function makeMetric(label, value) {
    const card = el('article', 'recovery-ledger-metric');
    card.append(el('span', '', label), el('strong', '', value));
    return card;
  }

  function latestSummary(item) {
    const host = $('recoveryLedgerLatest');
    if (!host) return;
    host.replaceChildren();
    if (!item) {
      host.append(el('p', 'status-note', 'No finalized recovery drill is recorded yet. Create a drill, add evidence, then finalize it after validation.'));
      return;
    }
    const head = el('div', 'recovery-ledger-latest-head');
    head.append(el('strong', '', item.title), el('span', `recovery-ledger-badge decision-${String(item.final_decision || '').toLowerCase()}`, decisionLabel(item.final_decision)));
    const metrics = el('div', 'recovery-ledger-metrics');
    metrics.append(
      makeMetric('Actual RPO', item.actual_rpo_hours === null ? '—' : `${item.actual_rpo_hours.toFixed(2)}h`),
      makeMetric('RPO target', `≤ ${Number(item.rpo_target_hours).toFixed(2)}h`),
      makeMetric('Actual RTO', item.actual_rto_hours === null ? '—' : `${item.actual_rto_hours.toFixed(2)}h`),
      makeMetric('RTO target', `≤ ${Number(item.rto_target_hours).toFixed(2)}h`)
    );
    const note = el('p', 'recovery-ledger-note', item.decision_note || 'No decision note recorded.');
    const boundary = el('small', 'recovery-ledger-boundary', 'This proves an internally recorded drill result only. It does not prove Railway/provider backup scheduling or live provider telemetry.');
    host.append(head, metrics, note, boundary);
  }

  function renderRecords() {
    const host = $('recoveryLedgerHistory');
    if (!host) return;
    host.replaceChildren();
    if (!records.length) {
      host.append(el('p', 'status-note', 'No recovery drill records yet.'));
      return;
    }
    records.forEach((item) => {
      const row = el('button', 'recovery-ledger-row');
      row.type = 'button';
      const left = el('span', 'recovery-ledger-row-main');
      left.append(el('strong', '', item.title), el('small', '', `${item.operator_label} • ${item.status} • ${new Date(item.created_at).toLocaleString()}`));
      const right = el('span', 'recovery-ledger-row-result', decisionLabel(item.final_decision));
      row.append(left, right);
      row.addEventListener('click', () => selectRecord(item.id));
      host.appendChild(row);
    });
  }

  function value(id) { return $(id)?.value?.trim() || ''; }
  function checked(id) { return Boolean($(id)?.checked); }

  function fillForm(item) {
    activeId = item?.id || null;
    const title = $('recoveryLedgerFormTitle');
    if (title) title.textContent = item ? `Edit drill: ${item.title}` : 'Create recovery drill';
    const set = (id, val) => { if ($(id)) $(id).value = val ?? ''; };
    set('ledgerTitle', item?.title || '');
    set('ledgerOperator', item?.operator_label || '');
    set('ledgerBackupId', item?.backup_identifier || '');
    set('ledgerBackupAt', isoLocal(item?.backup_created_at));
    set('ledgerEnvironment', item?.recovery_environment || '');
    set('ledgerStartedAt', isoLocal(item?.started_at));
    set('ledgerRestoreAt', isoLocal(item?.restore_completed_at));
    set('ledgerValidatedAt', isoLocal(item?.validation_completed_at));
    set('ledgerRestoreResult', item?.restore_result || '');
    set('ledgerRpoTarget', item?.rpo_target_hours ?? 24);
    set('ledgerRtoTarget', item?.rto_target_hours ?? 4);
    set('ledgerNextDrill', isoLocal(item?.next_drill_at));
    set('ledgerEvidenceRefs', (item?.evidence_refs || []).join('\n'));
    set('ledgerFindings', (item?.findings || []).join('\n'));
    set('ledgerDecisionNote', item?.decision_note || '');
    const checkMap = new Map((item?.integrity_checks || []).map((entry) => [entry.name, entry]));
    [['ledgerCheckAuth','Authentication/login'],['ledgerCheckFinance','Finance read-only records'],['ledgerCheckAudit','Audit history continuity'],['ledgerCheckDocs','Secure document metadata']].forEach(([id, name]) => {
      if ($(id)) $(id).checked = Boolean(checkMap.get(name)?.passed);
    });
    const immutable = Boolean(item?.finalized_at);
    document.querySelectorAll('#recoveryLedgerForm input,#recoveryLedgerForm select,#recoveryLedgerForm textarea,#saveRecoveryLedger,#finalizeRecoveryLedger').forEach((node) => { node.disabled = immutable; });
    if ($('finalizeRecoveryLedger')) $('finalizeRecoveryLedger').hidden = !item || immutable;
    if ($('saveRecoveryLedger')) $('saveRecoveryLedger').textContent = item ? 'Save Evidence' : 'Create Drill';
  }

  function injectUi() {
    const parent = $('recoveryDrillCenter');
    if (!parent || $('recoveryDrillLedger')) return;
    const section = el('section', 'recovery-drill-ledger');
    section.id = 'recoveryDrillLedger';
    section.innerHTML = `
      <div class="recovery-ledger-head">
        <div><span class="eyebrow">Recorded Evidence</span><h4>Recovery Drill Evidence Ledger</h4><p>Record what actually happened during an isolated restore drill. The app calculates observed RPO/RTO and keeps finalized records immutable.</p></div>
        <div class="recovery-ledger-actions"><button type="button" class="secondary-btn" id="newRecoveryLedger">New Drill</button><button type="button" class="secondary-btn" id="refreshRecoveryLedger">Refresh History</button></div>
      </div>
      <div id="recoveryLedgerLatest" class="recovery-ledger-latest"></div>
      <div class="recovery-ledger-layout">
        <div><h4>Drill history</h4><div id="recoveryLedgerHistory" class="recovery-ledger-history"></div></div>
        <form id="recoveryLedgerForm" class="recovery-ledger-form">
          <h4 id="recoveryLedgerFormTitle">Create recovery drill</h4>
          <p class="recovery-ledger-help">Times are entered in your local time. RPO is calculated from backup time to drill start; RTO is calculated from drill start through completed validation.</p>
          <div class="recovery-ledger-fields">
            <label>Drill title<input id="ledgerTitle" maxlength="160" placeholder="Quarterly isolated restore drill"></label>
            <label>Operator / role<input id="ledgerOperator" maxlength="120" placeholder="Security Admin"></label>
            <label>RPO target (hours)<input id="ledgerRpoTarget" type="number" min="0.01" step="0.01" value="24"></label>
            <label>RTO target (hours)<input id="ledgerRtoTarget" type="number" min="0.01" step="0.01" value="4"></label>
            <label>Backup identifier<input id="ledgerBackupId" maxlength="255" placeholder="Provider backup/snapshot ID"></label>
            <label>Backup created at<input id="ledgerBackupAt" type="datetime-local"></label>
            <label>Isolated recovery environment<input id="ledgerEnvironment" maxlength="255" placeholder="recovery-test-2026-09"></label>
            <label>Drill started at<input id="ledgerStartedAt" type="datetime-local"></label>
            <label>Restore completed at<input id="ledgerRestoreAt" type="datetime-local"></label>
            <label>Validation completed at<input id="ledgerValidatedAt" type="datetime-local"></label>
            <label>Restore result<select id="ledgerRestoreResult"><option value="">Not recorded</option><option value="SUCCESS">Success</option><option value="PARTIAL">Partial</option><option value="FAILED">Failed</option></select></label>
            <label>Next drill date<input id="ledgerNextDrill" type="datetime-local"></label>
          </div>
          <fieldset class="recovery-ledger-checks"><legend>Critical integrity checks</legend>
            <label><input type="checkbox" id="ledgerCheckAuth"> Authentication/login works</label>
            <label><input type="checkbox" id="ledgerCheckFinance"> Finance records can be read safely</label>
            <label><input type="checkbox" id="ledgerCheckAudit"> Audit history is continuous</label>
            <label><input type="checkbox" id="ledgerCheckDocs"> Secure document metadata is intact</label>
          </fieldset>
          <label>Evidence references<textarea id="ledgerEvidenceRefs" rows="3" placeholder="One reference per line: ticket, screenshot, provider job ID, report path..."></textarea></label>
          <label>Findings / observations<textarea id="ledgerFindings" rows="3" placeholder="One finding per line"></textarea></label>
          <label>Final decision note<textarea id="ledgerDecisionNote" rows="3" placeholder="Required only when finalizing. Explain the outcome and any follow-up."></textarea></label>
          <div class="recovery-ledger-form-actions"><button type="submit" class="primary-btn" id="saveRecoveryLedger">Create Drill</button><button type="button" class="secondary-btn" id="finalizeRecoveryLedger" hidden>Finalize & Lock Evidence</button></div>
          <p id="recoveryLedgerMessage" class="recovery-ledger-message" aria-live="polite"></p>
        </form>
      </div>`;
    parent.appendChild(section);
    $('newRecoveryLedger')?.addEventListener('click', () => fillForm(null));
    $('refreshRecoveryLedger')?.addEventListener('click', loadRecords);
    $('recoveryLedgerForm')?.addEventListener('submit', saveRecord);
    $('finalizeRecoveryLedger')?.addEventListener('click', finalizeRecord);
  }

  function lines(id) { return value(id).split(/\r?\n/).map((x) => x.trim()).filter(Boolean); }
  function timestamp(id) { const v = value(id); return v ? new Date(v).toISOString() : null; }

  function evidencePayload() {
    return {
      backup_identifier: value('ledgerBackupId'),
      backup_created_at: timestamp('ledgerBackupAt'),
      recovery_environment: value('ledgerEnvironment'),
      started_at: timestamp('ledgerStartedAt'),
      restore_completed_at: timestamp('ledgerRestoreAt'),
      validation_completed_at: timestamp('ledgerValidatedAt'),
      restore_result: value('ledgerRestoreResult'),
      next_drill_at: timestamp('ledgerNextDrill'),
      integrity_checks: [
        { name: 'Authentication/login', passed: checked('ledgerCheckAuth') },
        { name: 'Finance read-only records', passed: checked('ledgerCheckFinance') },
        { name: 'Audit history continuity', passed: checked('ledgerCheckAudit') },
        { name: 'Secure document metadata', passed: checked('ledgerCheckDocs') }
      ],
      evidence_refs: lines('ledgerEvidenceRefs'),
      findings: lines('ledgerFindings')
    };
  }

  function message(text, error = false) {
    const node = $('recoveryLedgerMessage');
    if (!node) return;
    node.textContent = text || '';
    node.className = `recovery-ledger-message${error ? ' is-error' : ''}`;
  }

  async function saveRecord(event) {
    event?.preventDefault();
    message('Saving…');
    try {
      if (!activeId) {
        const created = await api('/api/security/readiness/recovery/drills', {
          method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            title: value('ledgerTitle'), operator_label: value('ledgerOperator'),
            rpo_target_hours: Number(value('ledgerRpoTarget') || 24), rto_target_hours: Number(value('ledgerRtoTarget') || 4)
          })
        });
        activeId = created.drill.id;
      }
      await api(`/api/security/readiness/recovery/drills/${encodeURIComponent(activeId)}`, {
        method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(evidencePayload())
      });
      message('Evidence saved. Finalize only after the isolated restore and validation are complete.');
      await loadRecords(activeId);
    } catch (error) { message(error.message, true); }
  }

  async function finalizeRecord() {
    if (!activeId) return;
    message('Finalizing and calculating RPO/RTO…');
    try {
      await api(`/api/security/readiness/recovery/drills/${encodeURIComponent(activeId)}`, {
        method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(evidencePayload())
      });
      const result = await api(`/api/security/readiness/recovery/drills/${encodeURIComponent(activeId)}/finalize`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ decision_note: value('ledgerDecisionNote') })
      });
      message(result.explanation || 'Drill finalized.');
      await loadRecords(activeId);
    } catch (error) { message(error.message, true); }
  }

  function selectRecord(id) {
    const item = records.find((record) => record.id === id);
    if (item) fillForm(item);
  }

  async function loadRecords(selectId) {
    try {
      const data = await api('/api/security/readiness/recovery/drills?limit=50', { headers: { Accept: 'application/json' } });
      records = data.items || [];
      latestSummary(data.latest_finalized || null);
      renderRecords();
      if (selectId) selectRecord(selectId);
      else if (activeId) selectRecord(activeId);
    } catch (error) {
      const host = $('recoveryLedgerHistory');
      if (host) { host.replaceChildren(el('p', 'status-note', error.message)); }
    }
  }

  function init() {
    injectUi();
    if (!$('recoveryDrillLedger')) return;
    fillForm(null);
    loadRecords();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
