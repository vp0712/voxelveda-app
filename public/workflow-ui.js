(function workflowUiFactory() {
  'use strict';

  const root = document.querySelector('[data-workflow-root]');
  if (!root) return;

  const portal = root.dataset.workflowPortal || 'staff';
  const state = { definitions: [], approvals: [], requests: [], tab: 'approvals', module: '', loading: false, user: null };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function displayDate(value, includeTime = true) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-AU', includeTime
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { dateStyle: 'medium' });
  }

  function statusLabel(status) {
    return String(status || 'PENDING').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function isActive(status) {
    return ['PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES'].includes(String(status || '').toUpperCase());
  }

  function userPermissions() {
    return new Set([
      ...(Array.isArray(state.user?.permissions) ? state.user.permissions : []),
      ...(Array.isArray(state.user?.effective_permissions) ? state.user.effective_permissions : [])
    ]);
  }

  function hasPermission(permission) {
    return String(state.user?.role || '').toLowerCase() === 'super_admin' || userPermissions().has(permission);
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/workflows${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'Workflow request failed');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showPortalDialog(title, html, onPrimary, primaryText) {
    if (portal === 'admin' && typeof window.showDialog === 'function') {
      window.showDialog(title, html, onPrimary, primaryText);
      document.querySelector('.dialog-panel')?.classList.add('workflow-dialog');
      return;
    }
    if (typeof window.showStaffDialog === 'function') {
      window.showStaffDialog(title, html, onPrimary, primaryText);
      document.querySelector('#staffDialogBackdrop .dialog-panel')?.classList.add('workflow-dialog');
    }
  }

  function hidePortalDialog() {
    if (portal === 'admin') window.hideDialog?.();
    else window.hideStaffDialog?.();
  }

  function updateSummary() {
    const now = Date.now();
    const pending = state.approvals.filter((item) => item.assignment_status === 'PENDING');
    const activeRequests = state.requests.filter((item) => isActive(item.status));
    const overdue = pending.filter((item) => item.due_at && new Date(item.due_at).getTime() < now);
    root.querySelector('[data-workflow-count="pending"]').textContent = String(pending.length);
    root.querySelector('[data-workflow-count="requests"]').textContent = String(activeRequests.length);
    root.querySelector('[data-workflow-count="overdue"]').textContent = String(overdue.length);
  }

  function populateModules() {
    const select = root.querySelector('[data-workflow-module]');
    const modules = [...new Set(state.definitions.map((definition) => definition.module).filter(Boolean))].sort();
    const current = select.value;
    select.innerHTML = '<option value="">All areas</option>' + modules.map((module) => `<option value="${escapeHtml(module)}">${escapeHtml(statusLabel(module))}</option>`).join('');
    select.value = modules.includes(current) ? current : '';
  }

  function render() {
    updateSummary();
    const list = root.querySelector('[data-workflow-list]');
    const source = state.tab === 'approvals' ? state.approvals : state.requests;
    const items = source.filter((item) => !state.module || item.module === state.module);
    if (state.loading) {
      list.innerHTML = '<div class="empty-state">Loading approval work...</div>';
      return;
    }
    if (!items.length) {
      list.innerHTML = `<div class="empty-state"><strong>${state.tab === 'approvals' ? 'No approvals waiting' : 'No requests submitted'}</strong><span>${state.tab === 'approvals' ? 'New assignments will appear here.' : 'Create a request when a controlled decision is needed.'}</span></div>`;
      return;
    }
    list.innerHTML = items.map((item) => {
      const overdue = item.due_at && new Date(item.due_at).getTime() < Date.now() && item.assignment_status === 'PENDING';
      const actionable = state.tab === 'approvals' && item.assignment_status === 'PENDING' && item.status === 'PENDING';
      const cancellable = state.tab === 'requests' && isActive(item.status);
      return `<article class="workflow-item ${overdue ? 'is-overdue' : ''}">
        <button type="button" class="workflow-item-main" data-workflow-open="${escapeHtml(item.id)}">
          <span class="workflow-item-heading"><strong>${escapeHtml(item.title)}</strong><span class="workflow-status status-${escapeHtml(String(item.status || '').toLowerCase())}">${escapeHtml(statusLabel(item.status))}</span></span>
          <span class="workflow-item-meta"><span>${escapeHtml(statusLabel(item.module))}</span><span>${escapeHtml(item.entity_type)} ${escapeHtml(item.entity_id)}</span><span>${state.tab === 'approvals' ? `From ${escapeHtml(item.requester_name || item.requester_email || 'requester')}` : `Submitted ${escapeHtml(displayDate(item.requested_at, false))}`}</span></span>
          ${item.summary ? `<span class="workflow-item-summary">${escapeHtml(item.summary)}</span>` : ''}
          ${state.tab === 'approvals' ? `<span class="workflow-due ${overdue ? 'overdue' : ''}">${overdue ? 'Overdue' : 'Due'} ${escapeHtml(displayDate(item.due_at))}</span>` : ''}
        </button>
        <div class="workflow-item-actions">
          ${actionable && hasPermission('ACTION_APPROVALS') ? `<button type="button" class="primary-btn" data-workflow-action="APPROVE" data-workflow-id="${escapeHtml(item.id)}">Approve</button><button type="button" class="secondary-btn" data-workflow-action="REQUEST_CHANGES" data-workflow-id="${escapeHtml(item.id)}">Changes</button><button type="button" class="danger-btn" data-workflow-action="REJECT" data-workflow-id="${escapeHtml(item.id)}">Reject</button>` : ''}
          ${cancellable ? `<button type="button" class="secondary-btn" data-workflow-cancel="${escapeHtml(item.id)}">Cancel</button>` : ''}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-workflow-open]').forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.workflowOpen)));
    list.querySelectorAll('[data-workflow-action]').forEach((button) => button.addEventListener('click', () => openAction(button.dataset.workflowId, button.dataset.workflowAction)));
    list.querySelectorAll('[data-workflow-cancel]').forEach((button) => button.addEventListener('click', () => openCancel(button.dataset.workflowCancel)));
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    render();
    try {
      const [me, definitions, approvals, requests] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'same-origin' }).then((response) => response.json()),
        api('/definitions'), api('/my-approvals'), api('/my-requests')
      ]);
      state.user = me.user || {};
      root.querySelector('[data-workflow-create]').hidden = !hasPermission('CREATE_APPROVAL_REQUEST');
      const manageButton = root.querySelector('[data-workflow-manage]');
      if (manageButton) manageButton.hidden = !hasPermission('MANAGE_WORKFLOWS');
      state.definitions = definitions.definitions || [];
      state.approvals = approvals.items || [];
      state.requests = requests.items || [];
      populateModules();
    } catch (error) {
      toast(error.message || 'Approvals could not be loaded');
      state.approvals = [];
      state.requests = [];
    } finally {
      state.loading = false;
      render();
    }
  }

  async function openComposer() {
    if (!state.definitions.length) await load();
    const options = state.definitions.map((definition) => `<option value="${escapeHtml(definition.workflow_key)}">${escapeHtml(definition.name)} - ${escapeHtml(statusLabel(definition.module))}</option>`).join('');
    showPortalDialog('Create Approval Request', `
      <form id="workflowRequestForm" class="workflow-request-form" onsubmit="return false">
        <label><span>Workflow</span><select id="workflowDefinitionKey" required><option value="">Select approval type</option>${options}</select></label>
        <div class="workflow-form-grid">
          <label><span>Record type</span><input id="workflowEntityType" maxlength="80" placeholder="Example: expense, supplier, document" required></label>
          <label><span>Record ID or reference</span><input id="workflowEntityId" maxlength="100" placeholder="Example: EXP-1042" required></label>
        </div>
        <label><span>Request title</span><input id="workflowTitle" maxlength="200" placeholder="What decision is required?" required></label>
        <label><span>Summary</span><textarea id="workflowSummary" rows="4" maxlength="4000" placeholder="Give the reviewer the relevant business context"></textarea></label>
        <label><span>Submission note</span><textarea id="workflowComment" rows="3" maxlength="4000" placeholder="Optional note for the approval history"></textarea></label>
        <p class="workflow-form-note">The request is assigned using the active workflow definition. You cannot approve your own request.</p>
      </form>`, submitComposer, 'Submit Request');
  }

  async function submitComposer() {
    const form = document.getElementById('workflowRequestForm');
    if (!form?.reportValidity()) return;
    const payload = {
      workflow_key: document.getElementById('workflowDefinitionKey').value,
      entity_type: document.getElementById('workflowEntityType').value.trim(),
      entity_id: document.getElementById('workflowEntityId').value.trim(),
      title: document.getElementById('workflowTitle').value.trim(),
      summary: document.getElementById('workflowSummary').value.trim(),
      comment: document.getElementById('workflowComment').value.trim(),
      payload: { submitted_from: portal }
    };
    try {
      const data = await api('/instances', { method: 'POST', body: JSON.stringify(payload) });
      hidePortalDialog();
      toast(data.message || 'Approval request submitted');
      await load();
    } catch (error) { toast(error.message); }
  }

  async function openDetail(instanceId) {
    try {
      const data = await api(`/instances/${encodeURIComponent(instanceId)}`);
      const instance = data.instance;
      const assignments = (instance.assignments || []).map((assignment) => `<li><span>${escapeHtml(assignment.step_name)}: ${escapeHtml(assignment.assignee_name || assignment.assignee_email || 'Unassigned')}</span><span class="workflow-status status-${escapeHtml(String(assignment.status).toLowerCase())}">${escapeHtml(statusLabel(assignment.status))}</span></li>`).join('');
      const actions = (instance.actions || []).map((action) => `<li><strong>${escapeHtml(statusLabel(action.action_type))}</strong><span>${escapeHtml(action.actor_name || 'System')} | ${escapeHtml(displayDate(action.created_at))}</span>${action.comment ? `<p>${escapeHtml(action.comment)}</p>` : ''}</li>`).join('');
      showPortalDialog('Approval Details', `
        <div class="workflow-detail">
          <div class="workflow-detail-head"><div><span>${escapeHtml(statusLabel(instance.module))}</span><h4>${escapeHtml(instance.title)}</h4></div><span class="workflow-status status-${escapeHtml(String(instance.status).toLowerCase())}">${escapeHtml(statusLabel(instance.status))}</span></div>
          <dl><div><dt>Reference</dt><dd>${escapeHtml(instance.entity_type)} ${escapeHtml(instance.entity_id)}</dd></div><div><dt>Requester</dt><dd>${escapeHtml(instance.requester_name || instance.requester_email || '-')}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(displayDate(instance.requested_at))}</dd></div><div><dt>Current step</dt><dd>${escapeHtml(instance.current_step_order)}</dd></div></dl>
          ${instance.summary ? `<p class="workflow-detail-summary">${escapeHtml(instance.summary)}</p>` : ''}
          <h5>Review assignments</h5><ul class="workflow-assignment-list">${assignments || '<li>No reviewer is currently assigned.</li>'}</ul>
          <h5>Action history</h5><ol class="workflow-timeline">${actions || '<li>No actions recorded.</li>'}</ol>
          ${hasPermission('MANAGE_WORKFLOWS') && isActive(instance.status) ? `<button type="button" class="secondary-btn" data-workflow-reassign="${escapeHtml(instance.id)}">Assign Reviewer</button>` : ''}
        </div>`, hidePortalDialog, 'Close');
      document.querySelector('[data-workflow-reassign]')?.addEventListener('click', () => openReassign(instance.id));
    } catch (error) { toast(error.message); }
  }

  function openAction(instanceId, action) {
    const needsReason = action !== 'APPROVE';
    showPortalDialog(statusLabel(action), `
      <div class="workflow-action-form">
        <p>${action === 'APPROVE' ? 'Confirm that you reviewed the request and approve this step.' : `Explain why you are recording "${escapeHtml(statusLabel(action))}".`}</p>
        <label><span>${needsReason ? 'Reason' : 'Approval note (optional)'}</span><textarea id="workflowActionComment" rows="4" maxlength="4000" ${needsReason ? 'required' : ''}></textarea></label>
      </div>`, () => submitAction(instanceId, action), statusLabel(action));
  }

  async function submitAction(instanceId, action) {
    const comment = document.getElementById('workflowActionComment')?.value.trim() || '';
    if (action !== 'APPROVE' && !comment) return toast('Please enter a reason');
    try {
      const data = await api(`/instances/${encodeURIComponent(instanceId)}/action`, {
        method: 'POST', body: JSON.stringify({ action, comment })
      });
      hidePortalDialog();
      toast(data.message || 'Approval action recorded');
      await load();
    } catch (error) { toast(error.message); }
  }

  function openCancel(instanceId) {
    showPortalDialog('Cancel Approval Request', `
      <div class="workflow-action-form"><p>Cancel this request and close every outstanding assignment?</p><label><span>Reason (optional)</span><textarea id="workflowCancelComment" rows="3" maxlength="4000"></textarea></label></div>`,
    () => submitCancel(instanceId), 'Cancel Request');
  }

  async function submitCancel(instanceId) {
    try {
      const data = await api(`/instances/${encodeURIComponent(instanceId)}/cancel`, {
        method: 'POST', body: JSON.stringify({ comment: document.getElementById('workflowCancelComment')?.value.trim() || '' })
      });
      hidePortalDialog();
      toast(data.message || 'Approval request cancelled');
      await load();
    } catch (error) { toast(error.message); }
  }

  async function openReassign(instanceId) {
    try {
      const response = await fetch('/api/users', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Reviewers could not be loaded');
      const reviewers = (data.users || []).filter((user) => user.active && Number(user.id) !== Number(state.user?.id));
      showPortalDialog('Assign Reviewer', `
        <div class="workflow-action-form">
          <label><span>Reviewer</span><select id="workflowReviewerId" required><option value="">Select active user</option>${reviewers.map((user) => `<option value="${Number(user.id)}">${escapeHtml(user.name || user.email)} - ${escapeHtml(statusLabel(user.role))}</option>`).join('')}</select></label>
          <label><span>Reason</span><textarea id="workflowReassignComment" rows="3" maxlength="4000" placeholder="Why is this assignment changing?"></textarea></label>
        </div>`, () => submitReassign(instanceId), 'Assign');
    } catch (error) { toast(error.message); }
  }

  async function submitReassign(instanceId) {
    const assigneeUserId = Number(document.getElementById('workflowReviewerId')?.value);
    if (!assigneeUserId) return toast('Select a reviewer');
    try {
      const data = await api(`/instances/${encodeURIComponent(instanceId)}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ assignee_user_id: assigneeUserId, comment: document.getElementById('workflowReassignComment')?.value.trim() || '' })
      });
      hidePortalDialog();
      toast(data.message || 'Approval reviewer assigned');
      await load();
    } catch (error) { toast(error.message); }
  }

  function workflowStepRow(step = {}) {
    return `<div class="workflow-step-row" data-workflow-step>
      <label><span>Step name</span><input data-step-field="name" maxlength="160" value="${escapeHtml(step.name || '')}" placeholder="Review and approve" required></label>
      <label><span>Reviewer rule</span><select data-step-field="approver_type"><option value="PERMISSION" ${step.approver_type === 'PERMISSION' ? 'selected' : ''}>Permission</option><option value="ROLE" ${step.approver_type === 'ROLE' ? 'selected' : ''}>Role</option><option value="USER" ${step.approver_type === 'USER' ? 'selected' : ''}>User ID</option><option value="MANAGER" ${step.approver_type === 'MANAGER' ? 'selected' : ''}>Requester's manager</option></select></label>
      <label><span>Rule value</span><input data-step-field="approver_value" maxlength="120" value="${escapeHtml(step.approver_value || '')}" placeholder="ACTION_APPROVALS or manager"></label>
      <label><span>Approval mode</span><select data-step-field="approval_mode"><option value="ANY" ${step.approval_mode !== 'ALL' ? 'selected' : ''}>Any / quorum</option><option value="ALL" ${step.approval_mode === 'ALL' ? 'selected' : ''}>All reviewers</option></select></label>
      <label><span>Minimum</span><input data-step-field="minimum_approvals" type="number" min="1" max="20" value="${Number(step.minimum_approvals || 1)}" required></label>
      <label><span>SLA hours</span><input data-step-field="sla_hours" type="number" min="1" max="2160" value="${Number(step.sla_hours || 24)}" required></label>
      <label><span>Escalation role</span><input data-step-field="escalation_role" maxlength="80" value="${escapeHtml(step.escalation_role || 'admin')}"></label>
      <button type="button" class="icon-btn workflow-remove-step" aria-label="Remove approval step" title="Remove approval step">&times;</button>
    </div>`;
  }

  function bindDefinitionStepControls() {
    document.querySelectorAll('.workflow-remove-step').forEach((button) => button.addEventListener('click', () => {
      const rows = document.querySelectorAll('[data-workflow-step]');
      if (rows.length <= 1) return toast('A workflow needs at least one step');
      button.closest('[data-workflow-step]')?.remove();
    }));
  }

  function openDefinitionManager() {
    const rows = state.definitions.map((definition) => `<button type="button" class="workflow-definition-item" data-workflow-definition="${escapeHtml(definition.workflow_key)}"><span><strong>${escapeHtml(definition.name)}</strong><small>${escapeHtml(statusLabel(definition.module))} | Version ${Number(definition.version)} | ${Number(definition.step_count)} step${Number(definition.step_count) === 1 ? '' : 's'}</small></span><span>Edit</span></button>`).join('');
    showPortalDialog('Workflow Definitions', `<div class="workflow-definition-list">${rows || '<div class="empty-state">No active definitions.</div>'}<button type="button" class="primary-btn" id="workflowNewDefinition">New Workflow</button></div>`, hidePortalDialog, 'Close');
    document.querySelectorAll('[data-workflow-definition]').forEach((button) => button.addEventListener('click', () => {
      openDefinitionEditor(state.definitions.find((definition) => definition.workflow_key === button.dataset.workflowDefinition));
    }));
    document.getElementById('workflowNewDefinition')?.addEventListener('click', () => openDefinitionEditor());
  }

  function openDefinitionEditor(definition = null) {
    const steps = definition?.steps?.length ? definition.steps : [{ name: 'Review and approve', approver_type: 'PERMISSION', approver_value: 'ACTION_APPROVALS', approval_mode: 'ANY', minimum_approvals: 1, sla_hours: 24, escalation_role: 'admin' }];
    showPortalDialog(definition ? 'Publish Workflow Version' : 'Create Workflow', `
      <form id="workflowDefinitionForm" class="workflow-request-form" onsubmit="return false">
        <div class="workflow-form-grid"><label><span>Workflow key</span><input id="workflowDefinitionEditKey" maxlength="80" value="${escapeHtml(definition?.workflow_key || '')}" ${definition ? 'readonly' : ''} required></label><label><span>Area</span><input id="workflowDefinitionModule" maxlength="60" value="${escapeHtml(definition?.module || '')}" required></label></div>
        <label><span>Name</span><input id="workflowDefinitionName" maxlength="160" value="${escapeHtml(definition?.name || '')}" required></label>
        <label><span>Description</span><textarea id="workflowDefinitionDescription" rows="3" maxlength="4000">${escapeHtml(definition?.description || '')}</textarea></label>
        <label class="workflow-self-approval"><input id="workflowAllowSelf" type="checkbox" ${Number(definition?.allow_self_approval) ? 'checked' : ''}><span>Allow requester self-approval for this definition</span></label>
        <div class="workflow-step-head"><strong>Approval steps</strong><button type="button" class="secondary-btn" id="workflowAddStep">Add Step</button></div>
        <div id="workflowDefinitionSteps" class="workflow-definition-steps">${steps.map(workflowStepRow).join('')}</div>
      </form>`, submitDefinition, definition ? 'Publish Version' : 'Create Workflow');
    bindDefinitionStepControls();
    document.getElementById('workflowAddStep')?.addEventListener('click', () => {
      const container = document.getElementById('workflowDefinitionSteps');
      if (container.children.length >= 10) return toast('A workflow can contain up to 10 steps');
      container.insertAdjacentHTML('beforeend', workflowStepRow());
      bindDefinitionStepControls();
    });
  }

  async function submitDefinition() {
    const form = document.getElementById('workflowDefinitionForm');
    if (!form?.reportValidity()) return;
    const steps = [...document.querySelectorAll('[data-workflow-step]')].map((row) => {
      const value = (name) => row.querySelector(`[data-step-field="${name}"]`)?.value;
      return {
        name: value('name'), approver_type: value('approver_type'), approver_value: value('approver_value'),
        approval_mode: value('approval_mode'), minimum_approvals: Number(value('minimum_approvals')),
        sla_hours: Number(value('sla_hours')), escalation_role: value('escalation_role')
      };
    });
    try {
      const data = await api('/definitions', {
        method: 'POST',
        body: JSON.stringify({
          workflow_key: document.getElementById('workflowDefinitionEditKey').value.trim(),
          module: document.getElementById('workflowDefinitionModule').value.trim(),
          name: document.getElementById('workflowDefinitionName').value.trim(),
          description: document.getElementById('workflowDefinitionDescription').value.trim(),
          allow_self_approval: document.getElementById('workflowAllowSelf').checked,
          steps
        })
      });
      hidePortalDialog();
      toast(data.message || 'Workflow definition published');
      await load();
    } catch (error) { toast(error.message); }
  }

  root.querySelectorAll('[data-workflow-tab]').forEach((button) => button.addEventListener('click', () => {
    state.tab = button.dataset.workflowTab;
    root.querySelectorAll('[data-workflow-tab]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));
  root.querySelector('[data-workflow-module]').addEventListener('change', (event) => { state.module = event.target.value; render(); });
  root.querySelector('[data-workflow-refresh]').addEventListener('click', load);
  root.querySelector('[data-workflow-create]').addEventListener('click', openComposer);
  root.querySelector('[data-workflow-create]').hidden = true;
  if (portal === 'admin') {
    document.getElementById('workflowCreateButton');
    document.getElementById('workflowManageButton');
    document.getElementById('workflowApprovalsTab');
    document.getElementById('workflowRequestsTab');
    document.getElementById('workflowRefreshButton');
  }
  const manageButton = root.querySelector('[data-workflow-manage]');
  if (manageButton) {
    manageButton.hidden = true;
    manageButton.addEventListener('click', openDefinitionManager);
  }

  window.VoxelWorkflowUI = { load, openComposer };
  document.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(window.location.search).get('view') === 'approvals') load();
  });
}());
