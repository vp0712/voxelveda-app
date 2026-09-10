(function procurementUiFactory() {
  'use strict';

  const root = document.querySelector('[data-procurement-root]');
  if (!root) return;
  const portal = root.dataset.procurementPortal || 'staff';
  const state = {
    user: null,
    tab: 'requisitions',
    loading: false,
    data: { summary: {}, suppliers: [], requisitions: [], supplier_rfqs: [], purchase_orders: [], receipts: [], bill_matches: [], returns: [] }
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const today = () => new Date().toISOString().slice(0, 10);
  const statusText = (value) => String(value || 'DRAFT').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const displayDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { dateStyle: 'medium' }) : '-';
  const formatMoney = (value, code = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency: code || 'AUD' }).format(Number(value || 0));
  const permissions = () => new Set([
    ...(Array.isArray(state.user?.permissions) ? state.user.permissions : []),
    ...(Array.isArray(state.user?.effective_permissions) ? state.user.effective_permissions : [])
  ]);
  const has = (permission) => String(state.user?.role || '').toLowerCase() === 'super_admin' || permissions().has(permission);
  const toast = (message) => window.showToast?.(message);

  function effectiveStatus(row) {
    const controlled = ['SUBMITTING', 'PENDING_APPROVAL', 'PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES'];
    return controlled.includes(String(row.status || '').toUpperCase()) && row.workflow_status ? row.workflow_status : row.status;
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/procurement${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'Procurement request failed');
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function showDialog(title, html, onPrimary, primaryText = 'Save') {
    if (portal === 'admin') {
      window.showDialog?.(title, html, onPrimary, primaryText);
      document.querySelector('#dialogBackdrop .dialog-panel')?.classList.add('procurement-dialog');
    } else {
      window.showStaffDialog?.(title, html, onPrimary, primaryText);
      document.querySelector('#staffDialogBackdrop .dialog-panel')?.classList.add('procurement-dialog');
    }
  }

  function hideDialog() {
    if (portal === 'admin') window.hideDialog?.();
    else window.hideStaffDialog?.();
  }

  function form() {
    return document.getElementById('procurementActionForm');
  }

  function requireForm() {
    const current = form();
    if (!current?.reportValidity()) return null;
    return current;
  }

  function summary() {
    const values = state.data.summary || {};
    root.querySelectorAll('[data-procurement-count]').forEach((element) => {
      element.textContent = String(values[element.dataset.procurementCount] || 0);
    });
  }

  function statusChip(value) {
    const status = String(value || 'DRAFT').toUpperCase();
    const tone = ['APPROVED', 'MATCHED', 'ACCEPTED', 'AWARDED', 'CREDIT_RECEIVED', 'RECEIVED'].includes(status)
      ? 'good' : ['REJECTED', 'FAIL', 'EXCEPTION', 'CANCELLED'].includes(status) ? 'danger' : 'pending';
    return `<span class="procurement-status ${tone}">${escapeHtml(statusText(status))}</span>`;
  }

  function empty(title, copy) {
    return `<div class="empty-state procurement-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
  }

  function itemSummary(items, priceKey = 'estimated_unit_price') {
    return (items || []).slice(0, 3).map((item) => `<li><span>${escapeHtml(item.description)}</span><b>${escapeHtml(item.quantity ?? item.quantity_received ?? 0)} ${escapeHtml(item.unit || 'each')}</b><small>${formatMoney(item[priceKey] || 0)}</small></li>`).join('');
  }

  function actionButton(action, id, label, permission, tone = '') {
    if (permission && !has(permission)) return '';
    return `<button type="button" class="${tone || 'secondary-btn'}" data-procurement-action="${action}" data-id="${id}">${escapeHtml(label)}</button>`;
  }

  function renderRequisitions() {
    if (!state.data.requisitions.length) return empty('No purchase requisitions', 'Create the first controlled request for materials, services or equipment.');
    return state.data.requisitions.map((row) => {
      const status = effectiveStatus(row);
      const canSubmit = ['DRAFT', 'NEEDS_CHANGES'].includes(String(status).toUpperCase());
      const canCancel = ['DRAFT', 'PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES'].includes(String(status).toUpperCase());
      return `<article class="procurement-record">
        <div class="procurement-record-head"><div><span>${escapeHtml(row.requisition_no)}</span><h3>${escapeHtml(row.title)}</h3></div>${statusChip(status)}</div>
        <dl><div><dt>Requester</dt><dd>${escapeHtml(row.requester_name || 'Team member')}</dd></div><div><dt>Required</dt><dd>${displayDate(row.required_date)}</dd></div><div><dt>Estimate</dt><dd>${formatMoney(row.estimated_total, row.currency)}</dd></div></dl>
        <ul class="procurement-lines">${itemSummary(row.items)}</ul>
        <div class="procurement-actions">${canSubmit ? actionButton('submit-requisition', row.id, 'Submit for Approval', 'CREATE_PURCHASE_REQUISITION', 'primary-btn') : ''}${canCancel ? actionButton('cancel-requisition', row.id, 'Cancel', 'CREATE_PURCHASE_REQUISITION', 'danger-btn') : ''}</div>
      </article>`;
    }).join('');
  }

  function renderSourcing() {
    if (!state.data.supplier_rfqs.length) return empty('No supplier RFQs', 'Issue a supplier request after a purchase requisition is approved.');
    return state.data.supplier_rfqs.map((row) => `<article class="procurement-record">
      <div class="procurement-record-head"><div><span>${escapeHtml(row.supplier_rfq_no)} · ${escapeHtml(row.requisition_no)}</span><h3>${escapeHtml(row.title)}</h3></div>${statusChip(row.status)}</div>
      <dl><div><dt>Due</dt><dd>${displayDate(row.response_due_date)}</dd></div><div><dt>Invited</dt><dd>${row.supplier_count || 0}</dd></div><div><dt>Responses</dt><dd>${row.response_count || 0}</dd></div></dl>
      <div class="procurement-quote-grid">${(row.invites || []).map((invite) => `<div><strong>${escapeHtml(invite.supplier_name)}</strong><span>${statusText(invite.status)}</span><b>${invite.quoted_total == null ? '-' : formatMoney(invite.quoted_total)}</b></div>`).join('')}</div>
      <div class="procurement-actions">${row.status === 'OPEN' ? actionButton('record-response', row.id, 'Record Quote', 'MANAGE_SUPPLIER_RFQ') + actionButton('award-rfq', row.id, 'Select Supplier', 'MANAGE_SUPPLIER_RFQ', 'primary-btn') : ''}</div>
    </article>`).join('');
  }

  function renderOrders() {
    if (!state.data.purchase_orders.length) return empty('No purchase orders', 'Create a PO from an approved requisition and selected supplier.');
    return state.data.purchase_orders.map((row) => {
      const status = effectiveStatus(row);
      const canSubmit = ['DRAFT', 'NEEDS_CHANGES'].includes(String(status).toUpperCase());
      const canCancel = ['DRAFT', 'PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES'].includes(String(status).toUpperCase());
      return `<article class="procurement-record">
        <div class="procurement-record-head"><div><span>${escapeHtml(row.po_number)} · ${escapeHtml(row.requisition_no)}</span><h3>${escapeHtml(row.supplier_name)}</h3></div>${statusChip(status)}</div>
        <dl><div><dt>Issued</dt><dd>${displayDate(row.issue_date)}</dd></div><div><dt>Expected</dt><dd>${displayDate(row.expected_date)}</dd></div><div><dt>Total</dt><dd>${formatMoney(row.total_amount, row.currency)}</dd></div></dl>
        <ul class="procurement-lines">${itemSummary(row.items, 'unit_price')}</ul>
        <div class="procurement-actions">${canSubmit ? actionButton('submit-po', row.id, 'Submit for Approval', 'CREATE_PURCHASE_ORDER', 'primary-btn') : ''}${canCancel ? actionButton('cancel-po', row.id, 'Cancel', 'CREATE_PURCHASE_ORDER', 'danger-btn') : ''}</div>
      </article>`;
    }).join('');
  }

  function renderReceiving() {
    if (!state.data.receipts.length) return empty('No goods receipts', 'Approved purchase orders can be received and inspected here.');
    return state.data.receipts.map((row) => `<article class="procurement-record">
      <div class="procurement-record-head"><div><span>${escapeHtml(row.receipt_no)} · ${escapeHtml(row.po_number)}</span><h3>${escapeHtml(row.supplier_name)}</h3></div>${statusChip(row.inspection_result || row.status)}</div>
      <dl><div><dt>Received</dt><dd>${displayDate(row.received_date)}</dd></div><div><dt>Delivery ref</dt><dd>${escapeHtml(row.delivery_reference || '-')}</dd></div><div><dt>Inspection</dt><dd>${escapeHtml(statusText(row.inspection_result || 'Waiting'))}</dd></div></dl>
      <ul class="procurement-lines">${itemSummary(row.items, 'unit_price')}</ul>
      <div class="procurement-actions">${!row.inspection_result ? actionButton('inspect', row.id, 'Inspect Receipt', 'INSPECT_GOODS_RECEIPT', 'primary-btn') : ''}${row.inspection_result && row.inspection_result !== 'FAIL' ? actionButton('match-bill', row.id, 'Match Supplier Bill', 'MANAGE_SUPPLIER_BILL_MATCH') : ''}${row.inspection_result ? actionButton('create-return', row.id, 'Record Return', 'MANAGE_PURCHASE_RETURNS') : ''}</div>
    </article>`).join('');
  }

  function renderMatches() {
    if (!state.data.bill_matches.length) return empty('No bill matches', 'Three-way comparisons will show PO, receipt and supplier bill values together.');
    return state.data.bill_matches.map((row) => `<article class="procurement-record">
      <div class="procurement-record-head"><div><span>${escapeHtml(row.match_no)} · ${escapeHtml(row.po_number)}</span><h3>${escapeHtml(row.supplier_name)} / ${escapeHtml(row.supplier_invoice_no)}</h3></div>${statusChip(row.status)}</div>
      <dl><div><dt>PO</dt><dd>${formatMoney(row.purchase_total)}</dd></div><div><dt>Received</dt><dd>${formatMoney(row.receipt_total)}</dd></div><div><dt>Bill</dt><dd>${formatMoney(row.bill_total)}</dd></div><div><dt>Variance</dt><dd>${formatMoney(row.amount_variance)}</dd></div></dl>
      ${row.exception_reason ? `<p class="procurement-exception">${escapeHtml(row.exception_reason)}</p>` : ''}
    </article>`).join('');
  }

  function renderReturns() {
    if (!state.data.returns.length) return empty('No purchase returns', 'Rejected or unsuitable received goods can be returned with credit tracking.');
    return state.data.returns.map((row) => `<article class="procurement-record">
      <div class="procurement-record-head"><div><span>${escapeHtml(row.return_no)} · ${escapeHtml(row.po_number)}</span><h3>${escapeHtml(row.supplier_name)}</h3></div>${statusChip(row.status)}</div>
      <dl><div><dt>Return date</dt><dd>${displayDate(row.return_date)}</dd></div><div><dt>Value</dt><dd>${formatMoney(row.total_amount)}</dd></div><div><dt>Credit</dt><dd>${row.credit_amount == null ? 'Pending' : formatMoney(row.credit_amount)}</dd></div></dl>
      <p>${escapeHtml(row.reason)}</p><ul class="procurement-lines">${itemSummary(row.items, 'unit_price')}</ul>
      <div class="procurement-actions">${row.status === 'CREDIT_PENDING' ? actionButton('credit-note', row.id, 'Record Credit Note', 'MANAGE_PURCHASE_RETURNS', 'primary-btn') : ''}</div>
    </article>`).join('');
  }

  function render() {
    summary();
    root.querySelectorAll('[data-procurement-tab]').forEach((button) => button.classList.toggle('active', button.dataset.procurementTab === state.tab));
    const actions = root.querySelector('[data-procurement-primary-actions]');
    const tabActions = {
      requisitions: has('CREATE_PURCHASE_REQUISITION') ? '<button type="button" class="primary-btn" data-procurement-action="new-requisition">New Requisition</button>' : '',
      sourcing: has('MANAGE_SUPPLIER_RFQ') ? '<button type="button" class="primary-btn" data-procurement-action="new-rfq">Issue Supplier RFQ</button>' : '',
      orders: has('CREATE_PURCHASE_ORDER') ? '<button type="button" class="primary-btn" data-procurement-action="new-po">New Purchase Order</button>' : '',
      receiving: has('RECEIVE_PURCHASE_ORDER') ? '<button type="button" class="primary-btn" data-procurement-action="receive">Receive Goods</button>' : '',
      matches: '', returns: ''
    };
    actions.innerHTML = tabActions[state.tab] || '';
    const list = root.querySelector('[data-procurement-list]');
    if (state.loading) list.innerHTML = empty('Loading procurement', 'Checking approvals, supplier quotes and receiving records.');
    else list.innerHTML = ({ requisitions: renderRequisitions, sourcing: renderSourcing, orders: renderOrders, receiving: renderReceiving, matches: renderMatches, returns: renderReturns })[state.tab]();
  }

  async function load() {
    state.loading = true;
    render();
    try {
      const [me, workspace] = await Promise.all([
        state.user ? Promise.resolve({ user: state.user }) : fetch('/api/auth/me', { credentials: 'same-origin' }).then((response) => response.json()),
        api('/workspace')
      ]);
      state.user = me.user || state.user;
      state.data = workspace;
    } catch (error) { toast(error.message); }
    finally { state.loading = false; render(); }
  }

  function lineRow(kind = 'requisition', values = {}) {
    const price = kind === 'po' ? 'unit_price' : 'estimated_unit_price';
    return `<div class="procurement-line-input ${kind === 'po' ? 'is-po' : ''}" data-procurement-line>
      ${kind === 'po' ? `<input name="requisition_item_id" type="hidden" value="${escapeHtml(values.id || values.requisition_item_id || '')}">` : ''}
      <input name="item_code" placeholder="Item code" value="${escapeHtml(values.item_code || '')}" ${kind === 'po' ? 'readonly' : ''}>
      <input name="description" placeholder="Description" value="${escapeHtml(values.description || '')}" required ${kind === 'po' ? 'readonly' : ''}>
      <input name="quantity" type="number" min="0.001" ${values.quantity ? `max="${escapeHtml(values.quantity)}"` : ''} step="0.001" placeholder="Qty" value="${escapeHtml(values.quantity || 1)}" required>
      <input name="unit" placeholder="Unit" value="${escapeHtml(values.unit || 'each')}" required ${kind === 'po' ? 'readonly' : ''}>
      <input name="${price}" type="number" min="0" step="0.01" placeholder="Unit price" value="${escapeHtml(values[price] || 0)}" required>
      ${kind === 'po' ? `<input name="tax_rate" type="number" min="0" max="100" step="0.01" placeholder="Tax %" value="${escapeHtml(values.tax_rate || 10)}">` : ''}
      <button type="button" class="icon-btn procurement-line-remove" aria-label="Remove item">&times;</button>
    </div>`;
  }

  function collectLines(kind) {
    return [...form().querySelectorAll('[data-procurement-line]')].map((row) => ({
      item_code: row.querySelector('[name="item_code"]')?.value,
      description: row.querySelector('[name="description"]')?.value,
      quantity: row.querySelector('[name="quantity"]')?.value,
      unit: row.querySelector('[name="unit"]')?.value,
      requisition_item_id: Number(row.querySelector('[name="requisition_item_id"]')?.value || 0) || undefined,
      [kind === 'po' ? 'unit_price' : 'estimated_unit_price']: row.querySelector(`[name="${kind === 'po' ? 'unit_price' : 'estimated_unit_price'}"]`)?.value,
      ...(kind === 'po' ? { tax_rate: row.querySelector('[name="tax_rate"]')?.value } : {})
    }));
  }

  function openNewRequisition() {
    showDialog('New Purchase Requisition', `<form id="procurementActionForm" class="procurement-form">
      <div class="procurement-form-grid"><label><span>Request title</span><input name="title" required maxlength="200"></label><label><span>Department</span><input name="department" maxlength="120"></label><label><span>Required date</span><input name="required_date" type="date"></label><label><span>Currency</span><select name="currency"><option>AUD</option><option>INR</option><option>USD</option></select></label></div>
      <label><span>Business reason</span><textarea name="business_reason" rows="3"></textarea></label>
      <div class="procurement-line-heading"><strong>Requested items</strong><button type="button" class="secondary-btn" data-procurement-add-line="requisition">Add Item</button></div>
      <div data-procurement-lines>${lineRow()}</div></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api('/requisitions', { method: 'POST', body: JSON.stringify({
        title: current.title.value, department: current.department.value, required_date: current.required_date.value,
        currency: current.currency.value, business_reason: current.business_reason.value, items: collectLines('requisition')
      }) });
      hideDialog(); toast(result.message); await load();
    }, 'Save Requisition');
  }

  function approvedRequisitions() {
    return state.data.requisitions.filter((row) => String(row.workflow_status || '').toUpperCase() === 'APPROVED' && row.status !== 'CANCELLED');
  }

  function openSupplierRfq() {
    const requisitions = approvedRequisitions();
    if (!requisitions.length) return toast('Approve a purchase requisition before issuing a supplier RFQ');
    if (!state.data.suppliers.length) return toast('Add an active supplier first');
    showDialog('Issue Supplier RFQ', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Approved requisition</span><select name="purchase_requisition_id" required>${requisitions.map((row) => `<option value="${row.id}">${escapeHtml(row.requisition_no)} · ${escapeHtml(row.title)}</option>`).join('')}</select></label>
      <div class="procurement-form-grid"><label><span>Issue date</span><input name="issue_date" type="date" value="${today()}" required></label><label><span>Response due</span><input name="response_due_date" type="date"></label></div>
      <fieldset class="procurement-supplier-picker"><legend>Suppliers</legend>${state.data.suppliers.map((supplier) => `<label><input type="checkbox" name="supplier_ids" value="${supplier.id}"><span>${escapeHtml(supplier.supplier_name)}</span></label>`).join('')}</fieldset>
      <label><span>Notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const supplierIds = [...current.querySelectorAll('[name="supplier_ids"]:checked')].map((input) => Number(input.value));
      if (!supplierIds.length) return toast('Select at least one supplier');
      const result = await api('/supplier-rfqs', { method: 'POST', body: JSON.stringify({
        purchase_requisition_id: Number(current.purchase_requisition_id.value), supplier_ids: supplierIds,
        issue_date: current.issue_date.value, response_due_date: current.response_due_date.value, notes: current.notes.value
      }) });
      hideDialog(); toast(result.message); await load();
    }, 'Issue RFQ');
  }

  function openRecordResponse(rfq) {
    const pending = (rfq.invites || []).filter((invite) => ['INVITED', 'RESPONDED'].includes(invite.status));
    showDialog('Record Supplier Quote', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Supplier</span><select name="supplier_id" required>${pending.map((row) => `<option value="${row.supplier_id}">${escapeHtml(row.supplier_name)}</option>`).join('')}</select></label>
      <div class="procurement-form-grid"><label><span>Quote reference</span><input name="quote_reference" maxlength="120"></label><label><span>Quoted total</span><input name="quoted_total" type="number" min="0.01" step="0.01" required></label><label><span>Lead time days</span><input name="lead_time_days" type="number" min="0" max="3650"></label></div>
      <label><span>Response notes</span><textarea name="response_notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api(`/supplier-rfqs/${rfq.id}/respond`, { method: 'POST', body: JSON.stringify({
        supplier_id: Number(current.supplier_id.value), quote_reference: current.quote_reference.value,
        quoted_total: current.quoted_total.value, lead_time_days: current.lead_time_days.value, response_notes: current.response_notes.value
      }) });
      hideDialog(); toast(result.message); await load();
    }, 'Record Quote');
  }

  function openAwardRfq(rfq) {
    const responses = (rfq.invites || []).filter((invite) => invite.status === 'RESPONDED');
    if (!responses.length) return toast('Record at least one supplier quote before selecting a supplier');
    showDialog('Select Supplier', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Winning response</span><select name="selected_supplier_id" required>${responses.map((row) => `<option value="${row.supplier_id}">${escapeHtml(row.supplier_name)} · ${formatMoney(row.quoted_total)} · ${row.lead_time_days ?? '-'} days</option>`).join('')}</select></label>
      <label><span>Selection reason</span><textarea name="close_reason" rows="3" required></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api(`/supplier-rfqs/${rfq.id}/close`, { method: 'POST', body: JSON.stringify({ selected_supplier_id: Number(current.selected_supplier_id.value), close_reason: current.close_reason.value }) });
      hideDialog(); toast(result.message); await load();
    }, 'Award RFQ');
  }

  function openNewPo() {
    const requisitions = approvedRequisitions();
    if (!requisitions.length || !state.data.suppliers.length) return toast('An approved requisition and active supplier are required');
    const orderLines = (requisition) => (requisition?.items || []).map((item) => lineRow('po', item)).join('');
    showDialog('New Purchase Order', `<form id="procurementActionForm" class="procurement-form">
      <div class="procurement-form-grid"><label><span>Approved requisition</span><select name="purchase_requisition_id" required>${requisitions.map((row) => `<option value="${row.id}">${escapeHtml(row.requisition_no)} · ${escapeHtml(row.title)}</option>`).join('')}</select></label><label><span>Supplier</span><select name="supplier_id" required>${state.data.suppliers.map((row) => `<option value="${row.id}">${escapeHtml(row.supplier_name)}</option>`).join('')}</select></label><label><span>Issue date</span><input name="issue_date" type="date" value="${today()}" required></label><label><span>Expected date</span><input name="expected_date" type="date"></label><label><span>Currency</span><select name="currency"><option>AUD</option><option>INR</option><option>USD</option></select></label><label><span>Payment terms</span><input name="payment_terms"></label></div>
      <label><span>Delivery address</span><textarea name="delivery_address" rows="2"></textarea></label>
      <div class="procurement-line-heading"><strong>Approved requisition items</strong></div><div data-procurement-lines>${orderLines(requisitions[0])}</div></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api('/purchase-orders', { method: 'POST', body: JSON.stringify({
        purchase_requisition_id: Number(current.purchase_requisition_id.value), supplier_id: Number(current.supplier_id.value),
        issue_date: current.issue_date.value, expected_date: current.expected_date.value, currency: current.currency.value,
        payment_terms: current.payment_terms.value, delivery_address: current.delivery_address.value, items: collectLines('po')
      }) });
      hideDialog(); toast(result.message); await load();
    }, 'Save Purchase Order');
    form()?.querySelector('[name="purchase_requisition_id"]')?.addEventListener('change', (event) => {
      const requisition = requisitions.find((row) => Number(row.id) === Number(event.target.value));
      form().querySelector('[data-procurement-lines]').innerHTML = orderLines(requisition);
    });
  }

  function receivableOrders() {
    return state.data.purchase_orders.filter((row) => String(row.workflow_status || '').toUpperCase() === 'APPROVED' && (row.items || []).some((item) => Number(item.quantity) > Number(item.received_quantity)));
  }

  function receiptLineInputs(po) {
    return (po?.items || []).filter((item) => Number(item.quantity) > Number(item.received_quantity)).map((item) => `<label class="procurement-receipt-line"><span>${escapeHtml(item.description)}<small>${Number(item.quantity) - Number(item.received_quantity)} ${escapeHtml(item.unit)} outstanding</small></span><input type="number" min="0" max="${Number(item.quantity) - Number(item.received_quantity)}" step="0.001" name="receipt_qty_${item.id}" value="0" data-po-item-id="${item.id}"><input name="receipt_lot_${item.id}" placeholder="Lot / batch"></label>`).join('');
  }

  function openReceive() {
    const orders = receivableOrders();
    if (!orders.length) return toast('No approved purchase order has outstanding goods');
    showDialog('Receive Goods', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Purchase order</span><select name="purchase_order_id" data-receipt-po required>${orders.map((row) => `<option value="${row.id}">${escapeHtml(row.po_number)} · ${escapeHtml(row.supplier_name)}</option>`).join('')}</select></label>
      <div class="procurement-form-grid"><label><span>Received date</span><input name="received_date" type="date" value="${today()}" required></label><label><span>Delivery reference</span><input name="delivery_reference"></label></div>
      <div data-receipt-lines>${receiptLineInputs(orders[0])}</div><label><span>Receipt notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const items = [...current.querySelectorAll('[data-po-item-id]')].filter((input) => Number(input.value) > 0).map((input) => ({ purchase_order_item_id: Number(input.dataset.poItemId), quantity_received: input.value, lot_batch_no: current.querySelector(`[name="receipt_lot_${input.dataset.poItemId}"]`)?.value }));
      if (!items.length) return toast('Enter a received quantity for at least one line');
      const result = await api('/goods-receipts', { method: 'POST', body: JSON.stringify({ purchase_order_id: Number(current.purchase_order_id.value), received_date: current.received_date.value, delivery_reference: current.delivery_reference.value, notes: current.notes.value, items }) });
      hideDialog(); toast(result.message); await load();
    }, 'Record Receipt');
    form()?.querySelector('[data-receipt-po]')?.addEventListener('change', (event) => {
      const po = orders.find((row) => Number(row.id) === Number(event.target.value));
      form().querySelector('[data-receipt-lines]').innerHTML = receiptLineInputs(po);
    });
  }

  function openInspect(receipt) {
    const total = (receipt.items || []).reduce((sum, item) => sum + Number(item.quantity_received || 0), 0);
    showDialog('Inspect Goods Receipt', `<form id="procurementActionForm" class="procurement-form">
      <p class="procurement-form-note">${escapeHtml(receipt.receipt_no)} · ${total.toFixed(3)} units received</p>
      <label><span>Result</span><select name="result"><option value="PASS">Pass</option><option value="PARTIAL">Partial</option><option value="FAIL">Fail</option></select></label>
      <div class="procurement-form-grid"><label><span>Accepted quantity</span><input name="accepted_quantity" type="number" min="0" step="0.001" value="${total}" required></label><label><span>Rejected quantity</span><input name="rejected_quantity" type="number" min="0" step="0.001" value="0" required></label><label><span>Nonconformance reference</span><input name="nonconformance_reference"></label></div>
      <label><span>Inspection notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api(`/goods-receipts/${receipt.id}/inspect`, { method: 'POST', body: JSON.stringify({ result: current.result.value, accepted_quantity: current.accepted_quantity.value, rejected_quantity: current.rejected_quantity.value, nonconformance_reference: current.nonconformance_reference.value, notes: current.notes.value }) });
      hideDialog(); toast(result.message); await load();
    }, 'Complete Inspection');
  }

  function openMatchBill(receipt) {
    const po = state.data.purchase_orders.find((row) => Number(row.id) === Number(receipt.purchase_order_id));
    showDialog('Three-Way Bill Match', `<form id="procurementActionForm" class="procurement-form">
      <p class="procurement-form-note">${escapeHtml(po?.po_number)} · ${escapeHtml(receipt.receipt_no)} · ${escapeHtml(receipt.supplier_name)}</p>
      <div class="procurement-form-grid"><label><span>Supplier invoice no</span><input name="supplier_invoice_no" required></label><label><span>Issue date</span><input name="issue_date" type="date" value="${today()}" required></label><label><span>Due date</span><input name="due_date" type="date"></label><label><span>Bill total</span><input name="bill_total" type="number" min="0.01" step="0.01" value="${escapeHtml(po?.total_amount || '')}" required></label><label><span>Allowed variance</span><input name="tolerance_amount" type="number" min="0" step="0.01" value="0"></label></div>
      <label><span>Exception note</span><textarea name="exception_reason" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api('/bill-matches', { method: 'POST', body: JSON.stringify({ purchase_order_id: receipt.purchase_order_id, goods_receipt_id: receipt.id, supplier_invoice_no: current.supplier_invoice_no.value, issue_date: current.issue_date.value, due_date: current.due_date.value, bill_total: current.bill_total.value, tolerance_amount: current.tolerance_amount.value, exception_reason: current.exception_reason.value }) });
      hideDialog(); toast(result.message); await load();
    }, 'Run Match');
  }

  function openReturn(receipt) {
    const eligible = (receipt.items || []).filter((item) => Number(item.quantity_received) > 0);
    showDialog('Record Purchase Return', `<form id="procurementActionForm" class="procurement-form">
      <div class="procurement-form-grid"><label><span>Return date</span><input name="return_date" type="date" value="${today()}" required></label><label><span>Reason</span><input name="reason" required></label></div>
      <div>${eligible.map((item) => `<label class="procurement-receipt-line"><span>${escapeHtml(item.description)}<small>${escapeHtml(item.quantity_received)} received</small></span><input type="number" min="0" max="${item.quantity_received}" step="0.001" value="0" data-return-item-id="${item.purchase_order_item_id}"></label>`).join('')}</div></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const items = [...current.querySelectorAll('[data-return-item-id]')].filter((input) => Number(input.value) > 0).map((input) => ({ purchase_order_item_id: Number(input.dataset.returnItemId), quantity: input.value }));
      if (!items.length) return toast('Enter a return quantity for at least one line');
      const result = await api('/returns', { method: 'POST', body: JSON.stringify({ purchase_order_id: receipt.purchase_order_id, goods_receipt_id: receipt.id, return_date: current.return_date.value, reason: current.reason.value, items }) });
      hideDialog(); toast(result.message); await load();
    }, 'Record Return');
  }

  function openCredit(purchaseReturn) {
    showDialog('Record Supplier Credit Note', `<form id="procurementActionForm" class="procurement-form">
      <p class="procurement-form-note">${escapeHtml(purchaseReturn.return_no)} · maximum ${formatMoney(purchaseReturn.total_amount)}</p>
      <div class="procurement-form-grid"><label><span>Supplier credit reference</span><input name="supplier_credit_reference" required></label><label><span>Issue date</span><input name="issue_date" type="date" value="${today()}" required></label><label><span>Credit amount</span><input name="amount" type="number" min="0.01" max="${purchaseReturn.total_amount}" step="0.01" value="${purchaseReturn.total_amount}" required></label></div>
      <label><span>Notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api(`/returns/${purchaseReturn.id}/credit-note`, { method: 'POST', body: JSON.stringify({ supplier_credit_reference: current.supplier_credit_reference.value, issue_date: current.issue_date.value, amount: current.amount.value, notes: current.notes.value }) });
      hideDialog(); toast(result.message); await load();
    }, 'Record Credit');
  }

  async function simpleAction(path, message, body = {}) {
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
      toast(result.message || message); await load();
    } catch (error) { toast(error.message); }
  }

  async function handleAction(action, id) {
    const requisition = state.data.requisitions.find((row) => Number(row.id) === id);
    const rfq = state.data.supplier_rfqs.find((row) => Number(row.id) === id);
    const po = state.data.purchase_orders.find((row) => Number(row.id) === id);
    const receipt = state.data.receipts.find((row) => Number(row.id) === id);
    const purchaseReturn = state.data.returns.find((row) => Number(row.id) === id);
    try {
      if (action === 'new-requisition') return openNewRequisition();
      if (action === 'new-rfq') return openSupplierRfq();
      if (action === 'new-po') return openNewPo();
      if (action === 'receive') return openReceive();
      if (action === 'record-response') return openRecordResponse(rfq);
      if (action === 'award-rfq') return openAwardRfq(rfq);
      if (action === 'inspect') return openInspect(receipt);
      if (action === 'match-bill') return openMatchBill(receipt);
      if (action === 'create-return') return openReturn(receipt);
      if (action === 'credit-note') return openCredit(purchaseReturn);
      if (action === 'submit-requisition') return simpleAction(`/requisitions/${id}/submit`, 'Requisition submitted');
      if (action === 'submit-po') return simpleAction(`/purchase-orders/${id}/submit`, 'Purchase order submitted');
      if (action === 'cancel-requisition' || action === 'cancel-po') {
        const label = action === 'cancel-requisition' ? requisition?.requisition_no : po?.po_number;
        return showDialog(`Cancel ${label}`, `<form id="procurementActionForm" class="procurement-form"><label><span>Cancellation reason</span><textarea name="reason" rows="4" required></textarea></label></form>`, async () => {
          const current = requireForm(); if (!current) return;
          const path = action === 'cancel-requisition' ? `/requisitions/${id}/cancel` : `/purchase-orders/${id}/cancel`;
          const result = await api(path, { method: 'POST', body: JSON.stringify({ reason: current.reason.value }) });
          hideDialog(); toast(result.message); await load();
        }, 'Confirm Cancellation');
      }
    } catch (error) { toast(error.message); }
  }

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-procurement-tab]');
    if (tab) { state.tab = tab.dataset.procurementTab; render(); return; }
    const action = event.target.closest('[data-procurement-action]');
    if (action) handleAction(action.dataset.procurementAction, Number(action.dataset.id || 0));
  });

  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-procurement-add-line]');
    if (add && form()) form().querySelector('[data-procurement-lines]')?.insertAdjacentHTML('beforeend', lineRow(add.dataset.procurementAddLine));
    const remove = event.target.closest('.procurement-line-remove');
    if (remove && form()) {
      const rows = form().querySelectorAll('[data-procurement-line]');
      if (rows.length > 1) remove.closest('[data-procurement-line]')?.remove();
    }
  });

  root.querySelector('[data-procurement-refresh]')?.addEventListener('click', load);
  window.VoxelProcurementUI = { load };
})();
