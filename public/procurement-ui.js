(function procurementUiFactory() {
  'use strict';

  const root = document.querySelector('[data-procurement-root]');
  if (!root) return;
  const portal = root.dataset.procurementPortal || 'staff';
  const state = {
    user: null,
    tab: 'entries',
    loading: false,
    error: '',
    loadSequence: 0,
    importReadSequence: 0,
    busy: new Set(),
    fields: [],
    entries: { entries: [], page: 1, page_size: 25, total: 0, pages: 1 },
    appliedEntryFilters: null,
    entryFilters: { search: '', classification: '', category: '', priority: '', phase: '', status: 'DRAFT', currency: '', supplier_id: '', from_date: '', to_date: '', sort: 'created_desc', page: 1, page_size: 25 },
    uploads: { imports: [], page: 1, page_size: 25, total: 0, pages: 1 },
    uploadFilters: { search: '', status: '', page: 1, page_size: 25 },
    uploadFiles: [],
    uploadKey: '',
    uploadResult: null,
    importDetail: null,
    importMapping: {},
    importSheet: '',
    importFileId: '',
    importHeaderRow: 1,
    importClassification: 'PLAN',
    importDateOrder: 'ISO',
    mappingDirty: false,
    selectedRows: new Set(),
    reviewConfirmed: false,
    selectedEntries: new Set(),
    report: null,
    catalogQuery: '',
    catalogPriority: '',
    catalogPhase: '',
    data: { summary: {}, catalog: {}, suppliers: [], requisitions: [], supplier_rfqs: [], purchase_orders: [], receipts: [], bill_matches: [], returns: [] }
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const today = () => new Date().toISOString().slice(0, 10);
  const statusText = (value) => String(value || 'DRAFT').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const displayDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { dateStyle: 'medium' }) : '-';
  const formatMoney = (value, code = 'AUD') => value===null || value===undefined || value==='' ? 'Not priced' : code===null || code==='' ? `${new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value))} · currency not recorded` : new Intl.NumberFormat('en-AU', { style: 'currency', currency: code }).format(Number(value));
  const permissions = () => new Set([
    ...(Array.isArray(state.user?.permissions) ? state.user.permissions : []),
    ...(Array.isArray(state.user?.effective_permissions) ? state.user.effective_permissions : [])
  ]);
  const has = (permission) => String(state.user?.role || '').toLowerCase() === 'super_admin' || permissions().has(permission);
  const canWriteEntries = () => has('IMPORT_PROCUREMENT') || has('CREATE_PURCHASE_REQUISITION') || has('MANAGE_PROCUREMENT_RECORDS');
  const toast = (message,outcome={}) => window.showToast?.(message,outcome);

  function effectiveStatus(row) {
    const controlled = ['SUBMITTING', 'PENDING_APPROVAL', 'PENDING', 'BLOCKED_ASSIGNMENT', 'NEEDS_CHANGES'];
    return controlled.includes(String(row.status || '').toUpperCase()) && row.workflow_status ? row.workflow_status : row.status;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
    const response = await fetch(`/api/procurement${path}`, {
      credentials: 'same-origin',
      ...options,
      headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'Procurement request failed');
      error.code = data.code;
      error.status = response.status;
      error.details = data.details || data.fields || data.errors;
      error.data = data;
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
    if (!window.VoxelDialog.validate(current)) return null;
    return current;
  }

  function summary() {
    const values = state.data.summary || {};
    root.querySelectorAll('[data-procurement-count]').forEach((element) => {
      const value=values[element.dataset.procurementCount];
      element.textContent = value===null||value===undefined?'Not available':String(value);
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
        <div class="procurement-actions">${canSubmit ? actionButton('submit-requisition', row.id, 'Submit for Approval', 'CREATE_PURCHASE_REQUISITION', 'primary-btn') : ''}${canCancel ? actionButton('cancel-requisition', row.id, 'Cancel requisition', 'CREATE_PURCHASE_REQUISITION', 'danger-btn') : ''}</div>
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
        <div class="procurement-actions">${canSubmit ? actionButton('submit-po', row.id, 'Submit for Approval', 'CREATE_PURCHASE_ORDER', 'primary-btn') : ''}${canCancel ? actionButton('cancel-po', row.id, 'Cancel purchase order', 'CREATE_PURCHASE_ORDER', 'danger-btn') : ''}<button type="button" class="secondary-btn" data-procurement-action="report-po" data-id="${Number(row.id)}">Purchase order PDF</button></div>
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


  function renderCatalog() {
    const rows = Array.isArray(state.data.catalog?.bom) ? state.data.catalog.bom.slice(1) : [];
    if (!rows.length) return empty('No master BOM data', 'The procurement master plan has not been loaded.');
    const query = String(state.catalogQuery || '').trim().toLowerCase();
    const priority = state.catalogPriority || '';
    const phase = state.catalogPhase || '';
    const filtered = rows.filter((row) => {
      const haystack = row.slice(0, 18).map((value) => String(value ?? '')).join(' ').toLowerCase();
      return (!query || haystack.includes(query))
        && (!priority || String(row[9] || '') === priority)
        && (!phase || String(row[10] || '') === phase);
    });
    const priorities = [...new Set(rows.map((row) => String(row[9] || '')).filter(Boolean))].sort();
    const phases = [...new Set(rows.map((row) => String(row[10] || '')).filter(Boolean))].sort();
    const plan = state.data.catalog || {};
    const planCard = (label, sheet, tone) => {
      const cap = Number(sheet?.[4]?.[1] || 0);
      const total = Number(sheet?.[5]?.[1] || 0);
      const buffer = Number(sheet?.[5]?.[4] || (cap - total));
      return `<article class="procurement-record"><div class="procurement-record-head"><div><span>Purchase plan</span><h3>${escapeHtml(label)}</h3></div><span class="procurement-status ${tone}">${total <= cap ? 'Within Cap' : 'Over Cap'}</span></div><dl><div><dt>Cap</dt><dd>${formatMoney(cap)}</dd></div><div><dt>Estimated</dt><dd>${formatMoney(total)}</dd></div><div><dt>Buffer</dt><dd>${formatMoney(buffer)}</dd></div></dl><p>${escapeHtml(sheet?.[6]?.[1] || '')}</p></article>`;
    };
    const cards = [
      planCard('Order 1 — Launch', plan.order1, 'good'),
      planCard('Order 2 — Scale', plan.order2, 'pending'),
      planCard('Order 3 — Expansion', plan.order3, 'pending')
    ].join('');
    const records = filtered.map((row) => {
      const auUrl = row[14];
      const chinaUrl = row[16];
      const priorityTone = String(row[9]) === 'P1' ? 'danger' : String(row[9]) === 'P2' ? 'pending' : 'good';
      return `<article class="procurement-record">
        <div class="procurement-record-head"><div><span>#${escapeHtml(row[0])} · ${escapeHtml(row[1])} · ${escapeHtml(row[2])}</span><h3>${escapeHtml(row[3])}</h3></div><span class="procurement-status ${priorityTone}">${escapeHtml(row[9] || '-')}</span></div>
        <p><strong>${escapeHtml(row[5] || '')}</strong>${row[4] ? ` · ${escapeHtml(row[4])}` : ''}</p>
        <dl>
          <div><dt>Start qty</dt><dd>${escapeHtml(row[6] ?? 0)}</dd></div>
          <div><dt>AU unit</dt><dd>${formatMoney(row[7] || 0)}</dd></div>
          <div><dt>China landed</dt><dd>${formatMoney(row[8] || 0)}</dd></div>
          <div><dt>AU startup</dt><dd>${formatMoney(row[18] || 0)}</dd></div>
          <div><dt>Potential saving</dt><dd>${formatMoney(row[20] || 0)}</dd></div>
          <div><dt>Phase</dt><dd>${escapeHtml(row[10] || '-')}</dd></div>
          <div><dt>Storage</dt><dd>${escapeHtml(row[11] || '-')}</dd></div>
          <div><dt>Reorder</dt><dd>${escapeHtml(row[12] ?? 0)}</dd></div>
        </dl>
        <p>${escapeHtml(row[17] || '')}</p>
        <div class="procurement-actions">
          ${auUrl ? `<a class="secondary-btn" href="${escapeHtml(auUrl)}" target="_blank" rel="noopener">AU Supplier</a>` : ''}
          ${chinaUrl ? `<a class="secondary-btn" href="${escapeHtml(chinaUrl)}" target="_blank" rel="noopener">China Source</a>` : ''}
        </div>
      </article>`;
    }).join('');
    return `
      <div class="procurement-record" style="margin-bottom:16px">
        <div class="procurement-record-head"><div><span>Imported master procurement plan</span><h3>Voxel Veda A–Z BOM</h3></div><strong>${filtered.length} / ${rows.length} items</strong></div>
        <div class="procurement-form-grid">
          <label><span>Search BOM</span><input type="search" data-procurement-catalog-search value="${escapeHtml(state.catalogQuery)}" placeholder="Item, brand, category, supplier, storage…"></label>
          <label><span>Priority</span><select data-procurement-catalog-priority><option value="">All priorities</option>${priorities.map((value) => `<option value="${escapeHtml(value)}" ${value === state.catalogPriority ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>
          <label><span>Phase</span><select data-procurement-catalog-phase><option value="">All phases</option>${phases.map((value) => `<option value="${escapeHtml(value)}" ${value === state.catalogPhase ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="procurement-summary" style="margin-bottom:16px">${cards}</div>
      ${records || empty('No matching BOM items', 'Change the BOM search or filters.')}
    `;
  }

  const ENTRY_LABELS = { classification:'Classification', title:'Title', category:'Category', priority:'Priority', phase:'Phase', reference:'Reference', supplier_id:'Supplier ID', supplier_name:'Supplier', date:'Date', due_date:'Due date', currency:'Currency', description:'Description', item_code:'Item code', quantity:'Quantity', unit:'Unit', unit_price:'Unit price', tax_rate:'Tax rate (%)', net:'Net amount', tax:'Tax amount', total:'Total amount', notes:'Notes' };
  const CLASSIFICATIONS = ['PLAN','QUOTATION','PURCHASE_ORDER','SUPPLIER_INVOICE'];
  const PRIORITIES = ['P1','P2','P3','P4','LOW','NORMAL','HIGH','CRITICAL'];
  const NUMERIC_FIELDS = new Set(['supplier_id','quantity','unit_price','tax_rate','net','tax','total']);
  const queryString = (values) => new URLSearchParams(Object.entries(values).filter(([,value])=>value!=='' && value!==undefined && value!==null)).toString();
  const safeId = (value) => encodeURIComponent(String(value || ''));
  const requestKey = () => crypto.randomUUID();
  const revision = (record) => Number(record?.revision || 1);
  const mutationButton = (action, id, label, extra='') => canWriteEntries() ? `<button type="button" class="secondary-btn" data-procurement-action="${action}" data-id="${escapeHtml(id)}" ${extra}>${escapeHtml(label)}</button>` : '';

  function issueText(value) {
    if(!value)return '';
    if(Array.isArray(value))return value.map(item=>typeof item==='string'?item:[item.field,item.message || item.code].filter(Boolean).join(': ')).join('; ');
    if(typeof value==='object'){if(value.fields)return issueText(value.fields);return Object.entries(value).map(([key,item])=>`${ENTRY_LABELS[key] || key}: ${typeof item==='string'?item:JSON.stringify(item)}`).join('; ');}
    return String(value);
  }
  function errorText(error) { return [error.message,issueText(error.details)].filter(Boolean).join(' — '); }
  function inlineError(message) { return message ? `<p class="procurement-inline-error" role="alert">${escapeHtml(message)}</p>` : ''; }
  function pageControls(kind,data) {
    const page=Number(data.page || 1),pages=Math.max(1,Number(data.pages || Math.ceil(Number(data.total || 0)/Number(data.page_size || 25))));
    return `<div class="procurement-pagination"><span>${Number(data.total || 0)} ${kind==='entries'?'entries':'uploads'} · Page ${page} of ${pages}</span><div><button type="button" class="secondary-btn" data-procurement-action="${kind}-page" data-id="${page-1}" ${page<=1?'disabled':''}>Previous</button><button type="button" class="secondary-btn" data-procurement-action="${kind}-page" data-id="${page+1}" ${page>=pages?'disabled':''}>Next</button></div></div>`;
  }
  function renderEntries() {
    const data=state.entries,filters=state.entryFilters;
    const rows=data.entries || [];
    const option=(value,label,current)=>`<option value="${escapeHtml(value)}" ${value===current?'selected':''}>${escapeHtml(label)}</option>`;
    return `<div class="procurement-panel">
      <div class="procurement-entry-toolbar"><label>Search entries<input type="search" data-entry-filter="search" value="${escapeHtml(filters.search)}" placeholder="Title, supplier or reference"></label><label>Classification<select data-entry-filter="classification">${option('','All classifications',filters.classification)}${CLASSIFICATIONS.map(value=>option(value,statusText(value),filters.classification)).join('')}</select></label><label>Status<select data-entry-filter="status">${option('DRAFT','Saved drafts',filters.status)}${option('ARCHIVED','Archived',filters.status)}</select></label><label>Currency<input data-entry-filter="currency" maxlength="3" value="${escapeHtml(filters.currency)}" placeholder="All currencies"></label><label>Sort<select data-entry-filter="sort">${[['created_desc','Newest saved'],['created_asc','Oldest saved'],['date_desc','Date: newest'],['date_asc','Date: oldest'],['title_asc','Title'],['supplier_asc','Supplier'],['total_desc','Total: highest'],['total_asc','Total: lowest']].map(([value,label])=>option(value,label,filters.sort)).join('')}</select></label><button type="button" class="secondary-btn" data-procurement-action="filter-entries">Apply filters</button></div>
      <div class="procurement-entry-toolbar"><label>Supplier<select data-entry-filter="supplier_id"><option value="">All suppliers</option>${state.data.suppliers.map(supplier=>`<option value="${Number(supplier.id)}" ${String(supplier.id)===String(filters.supplier_id)?'selected':''}>${escapeHtml(supplier.supplier_name)}</option>`).join('')}</select></label><label>From date<input type="date" data-entry-filter="from_date" value="${escapeHtml(filters.from_date)}"></label><label>To date<input type="date" data-entry-filter="to_date" value="${escapeHtml(filters.to_date)}"></label><label>Category<input data-entry-filter="category" value="${escapeHtml(filters.category)}" maxlength="120" placeholder="All categories"></label><label>Priority<select data-entry-filter="priority">${option('','All priorities',filters.priority)}${PRIORITIES.map(value=>option(value,statusText(value),filters.priority)).join('')}</select></label><label>Phase<input data-entry-filter="phase" value="${escapeHtml(filters.phase)}" maxlength="120" placeholder="All phases"></label></div>
      <div class="procurement-actions"><button type="button" class="secondary-btn" data-procurement-action="report-options">PDF reports</button><button type="button" class="secondary-btn" data-procurement-action="report-selected" ${!state.selectedEntries.size?'disabled':''}>Selected entries PDF (${state.selectedEntries.size})</button></div>
      <div class="procurement-summary">${(data.summary?.currency_totals || []).map(group=>`<article><span>${escapeHtml(statusText(group.classification))} · ${escapeHtml(group.currency || 'Currency not recorded')}</span><strong>${group.total===null || group.total===undefined?'Not priced':escapeHtml(formatMoney(group.total,group.currency || 'AUD'))}</strong><span>${Number(group.priced_count || 0)} priced of ${Number(group.record_count || 0)} entries</span></article>`).join('')}${(data.summary?.quantity_totals || []).map(group=>`<article><span>${escapeHtml(statusText(group.classification))} · Quantity (${escapeHtml(group.unit || 'unit not recorded')})</span><strong>${escapeHtml(group.quantity ?? '—')}</strong></article>`).join('')}</div>
      <div class="procurement-table-wrap"><table class="procurement-entry-table"><thead><tr><th scope="col">Select</th><th scope="col">Entry</th><th scope="col">Classification</th><th scope="col">Supplier</th><th scope="col">Date</th><th scope="col">Total</th><th scope="col">Status / source</th><th scope="col">Actions</th></tr></thead><tbody>${rows.map(row=>`<tr><td><input type="checkbox" data-entry-selection="${escapeHtml(row.id)}" aria-label="Select ${escapeHtml(row.title)}" ${state.selectedEntries.has(String(row.id))?'checked':''}></td><td><strong>${escapeHtml(row.title || row.description || 'Untitled entry')}</strong><span>${escapeHtml(row.reference || row.item_code || '—')}</span><span>${[row.category,row.priority,row.phase].filter(Boolean).map(escapeHtml).join(' · ')}</span></td><td>${escapeHtml(statusText(row.classification))}</td><td>${escapeHtml(row.supplier_name || '—')}</td><td>${escapeHtml(displayDate(row.date))}</td><td>${escapeHtml(formatMoney(row.total,row.currency ?? null))}</td><td>${statusChip(row.status || 'DRAFT')}<span>Revision ${revision(row)}</span>${row.source_file_name?`<span>${escapeHtml(row.source_file_name)} · Row ${Number(row.source_row || 0)}</span>`:''}${row.import_file_id?`<button type="button" class="secondary-btn" data-procurement-action="preview-source" data-id="${escapeHtml(row.import_file_id)}">Linked source PDF</button>`:''}</td><td><div class="procurement-actions">${row.status==='ARCHIVED'?'':mutationButton('edit-entry',row.id,'Edit')}${mutationButton(row.status==='ARCHIVED'?'restore-entry':'archive-entry',row.id,row.status==='ARCHIVED'?'Restore':'Archive')}<button type="button" class="secondary-btn" data-procurement-action="report-entry" data-id="${escapeHtml(row.id)}">PDF</button></div></td></tr>`).join('') || '<tr><td colspan="8">No saved entries match these filters. Upload files or add an entry to start.</td></tr>'}</tbody></table></div>${pageControls('entries',data)}</div>`;
  }

  function fileOutcomes(files) {
    return `<ul class="procurement-batch-outcomes">${(files || []).map(file=>`<li><strong>${escapeHtml(file.name || file.original_name || 'Uploaded file')}</strong>${statusChip(file.status)}<span>${Number(file.counts?.total_rows || 0)} source rows · ${Number(file.counts?.accepted || 0)} saved drafts · ${Number(file.counts?.validated || 0)} ready · ${Number(file.counts?.pending_mapping || 0)} awaiting mapping · ${Number(file.counts?.rejected || 0)} rejected · ${Number(file.counts?.duplicate || 0)} duplicates · ${Number(file.counts?.review_required || 0)} awaiting review</span>${inlineError(file.error_message || file.error_code || '')}</li>`).join('')}</ul>`;
  }
  function fileActions(file) {
    return `${file.preview_url?`<button type="button" class="secondary-btn" data-procurement-action="preview-source" data-id="${escapeHtml(file.id)}">Preview source PDF: ${escapeHtml(file.name || 'file')}</button>`:''}${file.durable?mutationButton('new-source-entry',file.id,`Add entry from ${file.name || 'source'}`):''}`;
  }
  function renderUploads() {
    const data=state.uploads;
    return `<div class="procurement-panel"><div class="procurement-entry-toolbar"><label>Search uploaded files<input type="search" data-upload-filter="search" value="${escapeHtml(state.uploadFilters.search)}" placeholder="Filename or upload reference"></label><label>Processing status<input data-upload-filter="status" value="${escapeHtml(state.uploadFilters.status)}" placeholder="All statuses"></label><button type="button" class="secondary-btn" data-procurement-action="filter-uploads">Apply filters</button></div>
      <p class="procurement-source-status">Uploaded sources remain in this folder. Reviewed and imported drafts appear in Saved entries. Source previews are available only when a genuine PDF can be validated.</p>
      ${state.uploadResult?.counts ? `<p class="procurement-source-status" role="status">Last upload: ${Number(state.uploadResult.counts.stored_files || 0)} stored · ${Number(state.uploadResult.counts.rejected_files || 0)} rejected · ${Number(state.uploadResult.counts.duplicate_files || 0)} duplicate · ${Number(state.uploadResult.counts.failed_files || 0)} failed · ${Number(state.uploadResult.counts.processing_files || 0)} processing. Files and row outcomes remain listed below.</p>`:''}${state.importDetail ? renderImport() : ''}
      <div class="procurement-upload-folder">${(data.imports || []).map(batch=>`<article class="procurement-upload-item"><header><div><strong>${escapeHtml(batch.reference || batch.name || `Upload ${batch.id}`)}</strong><span>${escapeHtml(displayDate(batch.created_at))}${batch.created_by_name?` · ${escapeHtml(batch.created_by_name)}`:''}</span></div>${statusChip(batch.status)}</header>${fileOutcomes(batch.files)}<div class="procurement-actions"><button type="button" class="secondary-btn" data-procurement-action="review-import" data-id="${escapeHtml(batch.id)}">${canWriteEntries()?'Map / review files':'Review files'}</button><button type="button" class="secondary-btn" data-procurement-action="report-import" data-id="${escapeHtml(batch.id)}">Outcomes PDF</button>${(batch.files || []).map(file=>fileActions(file)).join('')}</div></article>`).join('') || empty('No uploaded files','Choose Upload files to retain sources and review them before importing entries.')}</div>${pageControls('uploads',data)}</div>`;
  }

  function fieldDefinitions() {
    const definitions=(Array.isArray(state.fields)?state.fields:Object.entries(state.fields || {}).map(([key,value])=>({key,...value}))).map(field=>typeof field==='string'?{key:field,label:ENTRY_LABELS[field]}:field);
    return Object.keys(ENTRY_LABELS).map(key=>({key,label:ENTRY_LABELS[key],...definitions.find(field=>(field.key || field.name || field.field)===key)}));
  }
  function mappingDefinitions() { return fieldDefinitions().filter(field=>!['classification','title','supplier_id'].includes(field.key)); }
  function renderImport() {
    const detail=state.importDetail,files=detail.files || [],selected=files.find(file=>String(file.id)===String(state.importFileId)) || files[0];
    const sheet=(selected?.sheets || []).find(item=>item.name===state.importSheet) || selected?.sheets?.[0];
    const headers=sheet?.headers?.length?sheet.headers:Array.from({length:Math.max(Number(sheet?.column_count || 0),...(detail.rows || []).filter(row=>String(row.file_id)===String(selected?.id) && row.sheet_name===sheet?.name).map(row=>row.raw?.cells?.length || 0))},(_,index)=>`Column ${index+1} (no heading)`);
    const eligible=(detail.rows || []).filter(row=>row.status==='VALIDATED' || (row.status==='REVIEW_REQUIRED' && row.reviewed && !issueText(row.errors)));
    const selectedCount=[...state.selectedRows].filter(id=>eligible.some(row=>String(row.id)===id)).length;
    const busy=state.busy.has('import'),editable=canWriteEntries() && !busy;
    return `<section class="procurement-import-step procurement-panel" aria-label="Review uploaded files"><h3>Map, review and import</h3><ol class="procurement-import-steps"><li>Files saved</li><li>Map columns</li><li>Review rows</li><li>Confirm draft import</li></ol>${fileOutcomes(files)}
      ${selected?.pages?.length?`<details class="procurement-source-status"><summary>Review extracted source text: ${escapeHtml(selected.name)}</summary>${selected.pages.map(page=>`<section><h4>Page ${Number(page.pageNumber || 1)}</h4><p>${escapeHtml(page.text || 'No usable text was extracted. Preview the source PDF and enter values manually.')}</p></section>`).join('')}<div class="procurement-actions">${fileActions(selected)}</div></details>`:''}
      <div class="procurement-mapping-grid"><label>File<select data-import-setting="file" ${busy?'disabled':''}>${files.map(file=>`<option value="${escapeHtml(file.id)}" ${String(file.id)===String(selected?.id)?'selected':''}>${escapeHtml(file.name)}</option>`).join('')}</select></label><label>Sheet<select data-import-setting="sheet" ${busy?'disabled':''}>${(selected?.sheets || []).map(item=>`<option value="${escapeHtml(item.name)}" ${item.name===sheet?.name?'selected':''}>${escapeHtml(item.name)} (${Number(item.row_count || 0)} rows)</option>`).join('')}</select></label><label>Header row<input type="number" min="0" step="1" data-import-setting="header" ${editable?'':'disabled'} value="${Number(state.importHeaderRow ?? sheet?.header_row ?? 1)}"></label><label>Classification<select data-import-setting="classification" ${editable?'':'disabled'}>${CLASSIFICATIONS.map(value=>`<option ${value===state.importClassification?'selected':''}>${value}</option>`).join('')}</select></label><label>Date order<select data-import-setting="date-order" ${editable?'':'disabled'}>${['ISO','DMY','MDY'].map(value=>`<option ${value===state.importDateOrder?'selected':''}>${value}</option>`).join('')}</select></label></div>
      ${headers.length?`<div class="procurement-mapping-grid">${mappingDefinitions().map(field=>`<label>${escapeHtml(field.label)}<select data-import-field="${escapeHtml(field.key)}" ${editable?'':'disabled'}><option value="">Not mapped</option>${headers.map((header,index)=>`<option value="${index}" ${Number(state.importMapping[field.key])===index && Object.hasOwn(state.importMapping,field.key)?'selected':''}>${index+1}. ${escapeHtml(header || '(blank header)')}</option>`).join('')}</select></label>`).join('')}</div><button type="button" class="secondary-btn" data-procurement-action="preview-import" ${editable?'':'disabled'}>Review mapped rows</button>`:'<p class="procurement-source-status">This file has no spreadsheet columns to map. Review extracted values below, or refresh processing status.</p>'}${state.mappingDirty?'<p class="procurement-source-status">The mapping changed. Choose Review mapped rows before selecting rows to import.</p>':''}
      <div class="procurement-table-wrap"><table class="procurement-review-table"><thead><tr><th>Select</th><th>Source</th><th>Title / reference</th><th>Supplier / classification</th><th>Quantity / price</th><th>Total</th><th>Review result</th><th>Action</th></tr></thead><tbody>${(detail.rows || []).map(row=>{const values=row.values || {},valid=eligible.includes(row);return `<tr><td><input type="checkbox" data-import-row-selection="${escapeHtml(row.id)}" aria-label="Import source row ${Number(row.source_row)}" ${state.selectedRows.has(String(row.id))?'checked':''} ${!valid || !editable?'disabled':''}></td><td>${escapeHtml(row.file_name || '')}<span>${escapeHtml(row.sheet_name || '')} · Row ${Number(row.source_row)}</span></td><td>${escapeHtml(values.title || values.description || '—')}<span>${escapeHtml(values.reference || '')}</span></td><td>${escapeHtml(values.supplier_name || '—')}<span>${escapeHtml(statusText(values.classification || state.importClassification))}</span></td><td>${escapeHtml(values.quantity ?? '—')} ${escapeHtml(values.unit || '')}<span>${escapeHtml(values.unit_price ?? '—')}</span></td><td>${escapeHtml(values.total ?? '—')} ${escapeHtml(values.currency || '')}</td><td>${statusChip(row.status)}${inlineError(issueText(row.errors))}<span>${escapeHtml(issueText(row.warnings))}</span>${row.reviewed?'<span>Reviewed</span>':''}</td><td>${(['ACCEPTED','HEADER','EXCLUDED_BEFORE_HEADER','DUPLICATE'].includes(row.status)?'':mutationButton('edit-import-row',row.id,'Edit / review',busy?'disabled':''))}</td></tr>`;}).join('') || '<tr><td colspan="8">Rows will appear after processing and column mapping. No entries have been imported.</td></tr>'}</tbody></table></div>
      <div class="procurement-pagination"><span>${Number(detail.total ?? detail.rows?.length ?? 0)} source rows · ${selectedCount} valid rows selected on this review page</span><div><button type="button" class="secondary-btn" data-procurement-action="review-page" data-id="${Number(detail.page || 1)-1}" ${Number(detail.page || 1)<=1?'disabled':''}>Previous rows</button><button type="button" class="secondary-btn" data-procurement-action="review-page" data-id="${Number(detail.page || 1)+1}" ${Number(detail.page || 1)>=Number(detail.pages || 1)?'disabled':''}>Next rows</button></div></div>
      <label class="procurement-source-status"><input type="checkbox" data-import-confirmation ${state.reviewConfirmed?'checked':''} ${editable?'':'disabled'}> I reviewed the selected rows and want to save them as drafts. Invalid, duplicate and unreviewed rows stay excluded.</label>
      <div class="procurement-actions"><button type="button" class="primary-btn" data-procurement-action="commit-import" ${!editable || state.mappingDirty || !detail.can_import || !selectedCount || !state.reviewConfirmed?'disabled':''}>Import ${selectedCount} selected drafts</button><button type="button" class="secondary-btn" data-procurement-action="refresh-import" ${busy?'disabled':''}>Refresh processing status</button>${files.some(file=>file.status==='EXTRACTION_FAILED' || file.status==='REVIEW_REQUIRED' && ['IMPORT_OCR_FAILED','IMPORT_OCR_NOT_CONFIGURED'].includes(file.error_code))?mutationButton('retry-extraction',detail.batch.id,'Retry failed extraction'):''}<button type="button" class="secondary-btn" data-procurement-action="close-import" ${busy?'disabled':''}>Close review</button></div></section>`;
  }

  function render() {
    summary();
    root.querySelectorAll('[data-procurement-tab]').forEach((button) => {const active=button.dataset.procurementTab===state.tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    const activeTab=root.querySelector(`[data-procurement-tab="${state.tab}"]`);
    root.querySelector('[data-procurement-list]')?.setAttribute('aria-labelledby',activeTab?.id || '');
    const globalActions=root.querySelector('[data-procurement-global-actions]');
    if(globalActions)globalActions.innerHTML=canWriteEntries()?'<button type="button" class="primary-btn" data-procurement-action="upload-files">Upload files</button>':'';
    const actions = root.querySelector('[data-procurement-primary-actions]');
    const tabActions = {
      entries:canWriteEntries()?'<button type="button" class="secondary-btn" data-procurement-action="new-entry">Add entry</button>':'',
      uploads:'',
      requisitions: has('CREATE_PURCHASE_REQUISITION') ? '<button type="button" class="primary-btn" data-procurement-action="new-requisition">New Requisition</button>' : '',
      sourcing: has('MANAGE_SUPPLIER_RFQ') ? '<button type="button" class="primary-btn" data-procurement-action="new-rfq">Issue Supplier RFQ</button>' : '',
      orders: has('CREATE_PURCHASE_ORDER') ? '<button type="button" class="primary-btn" data-procurement-action="new-po">New Purchase Order</button>' : '',
      receiving: has('RECEIVE_PURCHASE_ORDER') ? '<button type="button" class="primary-btn" data-procurement-action="receive">Receive Goods</button>' : '',
      matches: '', returns: '', catalog: ''
    };
    actions.innerHTML = tabActions[state.tab] || '';
    const list = root.querySelector('[data-procurement-list]');
    if (state.loading) list.innerHTML = empty('Loading procurement', 'Checking approvals, supplier quotes and receiving records.');
    else list.innerHTML = inlineError(state.error)+({ entries:renderEntries, uploads:renderUploads, requisitions: renderRequisitions, sourcing: renderSourcing, orders: renderOrders, receiving: renderReceiving, matches: renderMatches, returns: renderReturns, catalog: renderCatalog })[state.tab]();
  }

  async function load() {
    const sequence=++state.loadSequence;
    const entryFilters={...state.entryFilters};
    state.loading = true;
    state.error='';
    render();
    try {
      const [me, workspace, entries, uploads] = await Promise.all([
        state.user ? Promise.resolve({ user: state.user }) : fetch('/api/auth/me', { credentials: 'same-origin' }).then((response) => response.json()),
        api('/workspace'),
        state.tab==='entries'?api('/entries?'+queryString(entryFilters)):Promise.resolve(null),
        state.tab==='uploads'?api('/imports?'+queryString(state.uploadFilters)):Promise.resolve(null)
      ]);
      if(sequence!==state.loadSequence)return;
      state.user = me.user || state.user;
      state.data = workspace;
      if(entries){state.entries=entries;state.appliedEntryFilters=entryFilters;}
      if(uploads)state.uploads=uploads;
    } catch (error) { if(sequence===state.loadSequence)state.error=errorText(error); }
    finally { if(sequence===state.loadSequence){state.loading=false;render();} }
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
      hideDialog(); toast(result.message, {kind:'success'}); await load();
    }, 'Save Requisition');
  }

  function approvedRequisitions() {
    return state.data.requisitions.filter((row) => String(row.workflow_status || '').toUpperCase() === 'APPROVED' && row.status !== 'CANCELLED');
  }

  function openSupplierRfq() {
    const requisitions = approvedRequisitions();
    if (!requisitions.length) return toast('Approve a purchase requisition before issuing a supplier RFQ', {kind:'error'});
    if (!state.data.suppliers.length) return toast('Add an active supplier first', {kind:'error'});
    showDialog('Issue Supplier RFQ', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Approved requisition</span><select name="purchase_requisition_id" required>${requisitions.map((row) => `<option value="${row.id}">${escapeHtml(row.requisition_no)} · ${escapeHtml(row.title)}</option>`).join('')}</select></label>
      <div class="procurement-form-grid"><label><span>Issue date</span><input name="issue_date" type="date" value="${today()}" required></label><label><span>Response due</span><input name="response_due_date" type="date"></label></div>
      <fieldset class="procurement-supplier-picker"><legend>Suppliers</legend>${state.data.suppliers.map((supplier) => `<label><input type="checkbox" name="supplier_ids" value="${supplier.id}"><span>${escapeHtml(supplier.supplier_name)}</span></label>`).join('')}</fieldset>
      <label><span>Notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const supplierIds = [...current.querySelectorAll('[name="supplier_ids"]:checked')].map((input) => Number(input.value));
      if (!supplierIds.length) return toast('Select at least one supplier', {kind:'error'});
      const result = await api('/supplier-rfqs', { method: 'POST', body: JSON.stringify({
        purchase_requisition_id: Number(current.purchase_requisition_id.value), supplier_ids: supplierIds,
        issue_date: current.issue_date.value, response_due_date: current.response_due_date.value, notes: current.notes.value
      }) });
      hideDialog(); toast(result.message, {kind:'success'}); await load();
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
      hideDialog(); toast(result.message, {kind:'success'}); await load();
    }, 'Record Quote');
  }

  function openAwardRfq(rfq) {
    const responses = (rfq.invites || []).filter((invite) => invite.status === 'RESPONDED');
    if (!responses.length) return toast('Record at least one supplier quote before selecting a supplier', {kind:'error'});
    showDialog('Select Supplier', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Winning response</span><select name="selected_supplier_id" required>${responses.map((row) => `<option value="${row.supplier_id}">${escapeHtml(row.supplier_name)} · ${formatMoney(row.quoted_total)} · ${row.lead_time_days ?? '-'} days</option>`).join('')}</select></label>
      <label><span>Selection reason</span><textarea name="close_reason" rows="3" required></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api(`/supplier-rfqs/${rfq.id}/close`, { method: 'POST', body: JSON.stringify({ selected_supplier_id: Number(current.selected_supplier_id.value), close_reason: current.close_reason.value }) });
      hideDialog(); toast(result.message, {kind:'success'}); await load();
    }, 'Award RFQ');
  }

  function openNewPo() {
    const requisitions = approvedRequisitions();
    if (!requisitions.length || !state.data.suppliers.length) return toast('An approved requisition and active supplier are required', {kind:'error'});
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
      hideDialog(); toast(result.message, {kind:'success'}); await load();
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
    if (!orders.length) return toast('No approved purchase order has outstanding goods', {kind:'error'});
    showDialog('Receive Goods', `<form id="procurementActionForm" class="procurement-form">
      <label><span>Purchase order</span><select name="purchase_order_id" data-receipt-po required>${orders.map((row) => `<option value="${row.id}">${escapeHtml(row.po_number)} · ${escapeHtml(row.supplier_name)}</option>`).join('')}</select></label>
      <div class="procurement-form-grid"><label><span>Received date</span><input name="received_date" type="date" value="${today()}" required></label><label><span>Delivery reference</span><input name="delivery_reference"></label></div>
      <div data-receipt-lines>${receiptLineInputs(orders[0])}</div><label><span>Receipt notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const items = [...current.querySelectorAll('[data-po-item-id]')].filter((input) => Number(input.value) > 0).map((input) => ({ purchase_order_item_id: Number(input.dataset.poItemId), quantity_received: input.value, lot_batch_no: current.querySelector(`[name="receipt_lot_${input.dataset.poItemId}"]`)?.value }));
      if (!items.length) return toast('Enter a received quantity for at least one line', {kind:'error'});
      const result = await api('/goods-receipts', { method: 'POST', body: JSON.stringify({ purchase_order_id: Number(current.purchase_order_id.value), received_date: current.received_date.value, delivery_reference: current.delivery_reference.value, notes: current.notes.value, items }) });
      hideDialog(); toast(result.message, {kind:'success'}); await load();
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
      hideDialog(); toast(result.message, {kind:'success'}); await load();
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
      hideDialog(); toast(result.message, {kind:'success'}); await load();
    }, 'Run Match');
  }

  function openReturn(receipt) {
    const eligible = (receipt.items || []).filter((item) => Number(item.quantity_received) > 0);
    showDialog('Record Purchase Return', `<form id="procurementActionForm" class="procurement-form">
      <div class="procurement-form-grid"><label><span>Return date</span><input name="return_date" type="date" value="${today()}" required></label><label><span>Reason</span><input name="reason" required></label></div>
      <div>${eligible.map((item) => `<label class="procurement-receipt-line"><span>${escapeHtml(item.description)}<small>${escapeHtml(item.quantity_received)} received</small></span><input type="number" min="0" max="${item.quantity_received}" step="0.001" value="0" data-return-item-id="${item.purchase_order_item_id}"></label>`).join('')}</div></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const items = [...current.querySelectorAll('[data-return-item-id]')].filter((input) => Number(input.value) > 0).map((input) => ({ purchase_order_item_id: Number(input.dataset.returnItemId), quantity: input.value }));
      if (!items.length) return toast('Enter a return quantity for at least one line', {kind:'error'});
      const result = await api('/returns', { method: 'POST', body: JSON.stringify({ purchase_order_id: receipt.purchase_order_id, goods_receipt_id: receipt.id, return_date: current.return_date.value, reason: current.reason.value, items }) });
      hideDialog(); toast(result.message, {kind:'success'}); await load();
    }, 'Record Return');
  }

  function openCredit(purchaseReturn) {
    showDialog('Record Supplier Credit Note', `<form id="procurementActionForm" class="procurement-form">
      <p class="procurement-form-note">${escapeHtml(purchaseReturn.return_no)} · maximum ${formatMoney(purchaseReturn.total_amount)}</p>
      <div class="procurement-form-grid"><label><span>Supplier credit reference</span><input name="supplier_credit_reference" required></label><label><span>Issue date</span><input name="issue_date" type="date" value="${today()}" required></label><label><span>Credit amount</span><input name="amount" type="number" min="0.01" max="${purchaseReturn.total_amount}" step="0.01" value="${purchaseReturn.total_amount}" required></label></div>
      <label><span>Notes</span><textarea name="notes" rows="3"></textarea></label></form>`, async () => {
      const current = requireForm(); if (!current) return;
      const result = await api(`/returns/${purchaseReturn.id}/credit-note`, { method: 'POST', body: JSON.stringify({ supplier_credit_reference: current.supplier_credit_reference.value, issue_date: current.issue_date.value, amount: current.amount.value, notes: current.notes.value }) });
      hideDialog(); toast(result.message, {kind:'success'}); await load();
    }, 'Record Credit');
  }

  function entryInputs(values={}) {
    return `<div class="procurement-form-grid">${fieldDefinitions().map(field=>{
      const key=field.key,value=values[key] ?? '';
      if(key==='classification')return `<label>${escapeHtml(field.label)}<select name="classification">${CLASSIFICATIONS.map(item=>`<option value="${item}" ${item===(value || 'PLAN')?'selected':''}>${escapeHtml(statusText(item))}</option>`).join('')}</select></label>`;
      if(key==='priority')return `<label>${escapeHtml(field.label)}<select name="priority"><option value="">Not recorded</option>${PRIORITIES.map(item=>`<option value="${item}" ${item===value?'selected':''}>${escapeHtml(statusText(item))}</option>`).join('')}</select></label>`;
      if(['description','notes'].includes(key))return `<label>${escapeHtml(field.label)}<textarea name="${key}" rows="3" ${key==='description'?'required maxlength="255"':'maxlength="4000"'}>${escapeHtml(value)}</textarea></label>`;
      const type=['date','due_date'].includes(key)?'date':NUMERIC_FIELDS.has(key)?'number':'text';
      return `<label>${escapeHtml(field.label)}<input name="${key}" type="${type}" ${type==='number'?`min="${key==='quantity'?'0.001':'0'}" step="${key==='quantity'?'0.001':key==='supplier_id'?'1':'0.01'}"`:''} ${['title','quantity'].includes(key)?'required':''} ${key==='currency'?'maxlength="3"':''} value="${escapeHtml(type==='date'?String(value).slice(0,10):value)}"></label>`;
    }).join('')}</div>`;
  }
  function entryValues(current) {
    const values={};
    for(const key of Object.keys(ENTRY_LABELS)){
      const input=current.elements.namedItem(key);
      if(input)values[key]=input.value.trim();
    }
    return values;
  }
  function setFormError(error) {
    const element=document.getElementById('procurementEntryError');
    if(element)element.textContent=errorText(error);
    else toast(errorText(error), {kind:'info'});
  }
  function openEntry(entry=null,row=null,sourceFile=null) {
    if(!canWriteEntries())return;
    const values=row?{...row.values,title:row.values?.title || row.values?.description || ''}:entry || {classification:'PLAN',currency:''};
    const importId=state.importDetail?.batch?.id,importRevision=revision(row);
    const key=requestKey();
    showDialog(row?'Edit and review source row':entry?'Edit saved entry':'Add saved entry',`<form id="procurementEntryForm" class="procurement-form">${sourceFile?`<p class="procurement-source-status">This draft retains a link to ${escapeHtml(sourceFile.name)}. Review the source PDF or extracted text and enter the values below.</p>`:''}${row?`<p class="procurement-source-status">${escapeHtml(row.file_name)} · ${escapeHtml(row.sheet_name)} · Source row ${Number(row.source_row)}. Saving confirms that you reviewed these values.</p>`:''}${entryInputs(values)}<p id="procurementEntryError" class="procurement-inline-error" role="alert"></p></form>`,async()=>{
      const current=document.getElementById('procurementEntryForm');
      if(!window.VoxelDialog.validate(current) || state.busy.has('entry'))return;
      state.busy.add('entry');
      try {
        const payload=entryValues(current);
        if(row){
          const detail=await api(`/imports/${safeId(importId)}/rows/${safeId(row.id)}`,{method:'PATCH',body:JSON.stringify({expected_revision:importRevision,values:payload,reviewed:true})});
          adoptImport(detail,false);hideDialog();render();
        }else{
          if(entry)payload.expected_revision=revision(entry);
          if(sourceFile)payload.source_file_id=sourceFile.id;
          await api(entry?`/entries/${safeId(entry.id)}`:'/entries',{method:entry?'PATCH':'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(payload)});
          hideDialog();await load();
        }
      }catch(error){setFormError(error);}finally{state.busy.delete('entry');}
    },row?'Save reviewed values':'Save entry');
  }
  function adoptImport(detail,reset=true) {
    state.importDetail=detail;
    state.fields=detail.field_definitions || state.fields;
    const files=detail.files || [];
    if(!files.some(file=>String(file.id)===state.importFileId))state.importFileId=String(files[0]?.id || '');
    const file=files.find(item=>String(item.id)===state.importFileId);
    if(!(file?.sheets || []).some(sheet=>sheet.name===state.importSheet))state.importSheet=file?.sheets?.[0]?.name || '';
    if(reset){
      const saved=file?.mapping || {};
      state.importMapping=detail.mapping || saved.mapping || file?.sheets?.find(sheet=>sheet.name===state.importSheet)?.suggested_mapping?.mapping || {};
      state.importClassification=saved.classification || 'PLAN';
      state.importDateOrder=saved.date_order || 'ISO';
      state.importHeaderRow=Number(saved.header_row ?? file?.sheets?.[0]?.header_row ?? 1);
      if(saved.sheet_name)state.importSheet=saved.sheet_name;
      state.selectedRows=new Set();
    }
    state.reviewConfirmed=false;
    state.mappingDirty=false;
    state.error='';
  }
  async function readImport(id,page=1,reset=true) {
    const sequence=++state.importReadSequence;
    let detail;
    try{detail=await api(`/imports/${safeId(id)}?page=${Math.max(1,Number(page))}&page_size=100`);}catch(error){if(sequence!==state.importReadSequence)return null;throw error;}
    if(sequence!==state.importReadSequence)return null;
    adoptImport(detail,reset);state.tab='uploads';render();return detail;
  }
  async function pollImportStatus(id) {
    const sequence=state.importReadSequence;
    const pending=()=>state.importDetail?.files?.some(file=>['STORED','EXTRACTING'].includes(file.status));
    for(let attempt=0;attempt<5 && pending();attempt+=1){
      await new Promise(resolve=>setTimeout(resolve,2000));
      if(sequence!==state.importReadSequence || state.tab!=='uploads' || state.importDetail?.batch?.id!==id || Number(state.importDetail.page || 1)!==1 || state.mappingDirty || state.selectedRows.size || state.reviewConfirmed || state.busy.has('import'))return;
      const detail=await api(`/imports/${safeId(id)}?page=1&page_size=100`);
      if(sequence!==state.importReadSequence || state.tab!=='uploads' || state.importDetail?.batch?.id!==id || state.mappingDirty || state.selectedRows.size || state.reviewConfirmed)return;
      adoptImport(detail);state.uploadResult=detail;render();
      if(!pending()){await load();return;}
    }
  }
  function openUpload() {
    if(!canWriteEntries())return;
    state.uploadFiles=[];state.uploadKey='';
    showDialog('Upload procurement files',`<form id="procurementUploadForm" class="procurement-form"><label>Files<input type="file" name="files" accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg" multiple required></label><p class="procurement-source-status">Choose up to 10 files, each no larger than 8 MiB. Sources are saved in Uploaded files. Map columns and review extracted values before creating drafts.</p><div id="procurementUploadSelection"></div><p id="procurementEntryError" class="procurement-inline-error" role="alert"></p></form>`,async()=>{
      if(state.busy.has('upload'))return;
      if(!window.VoxelDialog.validate(document.getElementById('procurementUploadForm')))return;
      if(!state.uploadFiles.length)return setFormError(new Error('Choose at least one file.'));
      if(state.uploadFiles.length>10 || state.uploadFiles.some(file=>file.size>8*1024*1024))return setFormError(new Error('Choose up to 10 files, each no larger than 8 MiB.'));
      if(!state.uploadKey)state.uploadKey=requestKey();
      const body=new FormData();state.uploadFiles.forEach(file=>body.append('files',file));
      state.busy.add('upload');
      try {
        const result=await api('/imports',{method:'POST',headers:{'Idempotency-Key':state.uploadKey},body});
        state.uploadResult=result;state.fields=result.field_definitions || state.fields;
        hideDialog();state.tab='uploads';await load();
        if(result.batch?.id){
          await readImport(result.batch.id);
          void pollImportStatus(result.batch.id).catch(error=>{if(state.importDetail?.batch?.id===result.batch.id){state.error=errorText(error);render();}});
        }
        toast('Files saved. Review their outcomes before importing drafts.', {kind:'info'});
      }catch(error){
        if(error.data?.files)state.uploadResult=error.data;
        setFormError(error);
      }finally{state.busy.delete('upload');}
    },'Save uploaded files');
    const input=document.querySelector('#procurementUploadForm [name="files"]');
    input?.addEventListener('change',()=>{
      state.uploadFiles=[...input.files];state.uploadKey=requestKey();
      document.getElementById('procurementUploadSelection').innerHTML=`<ul>${state.uploadFiles.map(file=>`<li>${escapeHtml(file.name)} · ${(file.size/1024).toFixed(1)} KiB</li>`).join('')}</ul>`;
    });
  }
  function reportFilters() {
    const {page,page_size,...filters}=state.appliedEntryFilters || state.entryFilters;
    return {...filters,archived:filters.status==='ARCHIVED'};
  }
  function openReportOptions() {
    showDialog('Choose procurement PDF report',`<form id="procurementReportOptions" class="procurement-form"><label>Report<select name="type"><option value="register">Saved entry register</option><option value="items">Item details</option><option value="suppliers">Supplier totals</option><option value="summary">Procurement summary</option></select></label><p class="procurement-source-status">Uses the search, date, classification, category, priority, phase, currency, supplier and status filters applied to the table across all matching entries.</p></form>`,async()=>{
      const current=document.getElementById('procurementReportOptions');if(window.VoxelDialog.validate(current))await openReport(current.elements.namedItem('type').value);
    },'Generate PDF');
  }
  async function openReport(type,recordId,batchId,source='entries') {
    if(state.busy.has('report'))return;
    state.busy.add('report');
    try {
      const filters=source!=='entries' || type==='import-outcomes'?{}:type==='individual'?{status:(state.entries.entries || []).find(entry=>String(entry.id)===String(recordId))?.status || state.entryFilters.status}:reportFilters();
      const body={type,source,filters};
      if(type==='selected')body.ids=[...state.selectedEntries];
      if(recordId)body.record_id=recordId;
      if(batchId)body.batch_id=batchId;
      const result=await api('/reports/snapshots',{method:'POST',body:JSON.stringify(body)});
      state.report={...result,recipient:'',sending:false,sendAttempted:false};
      renderReportDialog();
    }catch(error){state.error=errorText(error);render();}finally{state.busy.delete('report');}
  }
  function renderReportDialog(message='') {
    const snapshot=state.report;
    if(!snapshot)return;
    const ready=snapshot.generation_status==='VALIDATED';
    showDialog('Procurement PDF snapshot',`<div class="procurement-panel"><p><strong>${escapeHtml(snapshot.reference || 'Procurement report')}</strong> · ${Number(snapshot.record_count || 0)} records · Version ${Number(snapshot.version || 1)}</p><p class="procurement-source-status">This report retains the saved values captured at generation. Preview, download and email use the same validated PDF.</p><div class="procurement-actions">${snapshot.preview_url?`<button type="button" class="secondary-btn" data-procurement-dialog-action="preview-report" ${ready?'':'disabled'}>Preview PDF</button>`:''}${snapshot.download_url?`<button type="button" class="secondary-btn" data-procurement-dialog-action="download-report" ${ready?'':'disabled'}>Download PDF</button>`:''}<button type="button" class="secondary-btn" data-procurement-dialog-action="report-status">Refresh status</button></div>${has('SEND_COMPANY_EMAIL')?`<form id="procurementReportEmailForm" class="procurement-form"><label>Recipient<input type="email" name="to" autocomplete="email" value="${escapeHtml(snapshot.recipient || '')}" required ${snapshot.sendAttempted?'disabled':''}></label><button type="button" class="primary-btn" data-procurement-dialog-action="send-report" ${!ready || snapshot.sending || snapshot.sendAttempted?'disabled':''}>Email this PDF</button></form>`:''}<p id="procurementReportStatus" role="status">${escapeHtml(message || statusText(snapshot.generation_status || 'Pending'))}</p><p class="procurement-source-status">Provider acceptance and recipient receipt are separate. Recipient receipt remains unverified.</p></div>`,hideDialog,'Close');
  }
  async function reportAction(action) {
    const snapshot=state.report;
    if(!snapshot)return;
    const status=document.getElementById('procurementReportStatus');
    try {
      if(action==='preview-report' || action==='download-report'){
        const url=action==='preview-report'?snapshot.preview_url:snapshot.download_url;
        if(typeof url!=='string' || !url.startsWith('/api/procurement/'))throw new Error('The validated report URL is unavailable.');
        await window.VoxelOperations.openPdf(url,{download:action==='download-report'});return;
      }
      if(action==='report-status'){
        if(snapshot.sending)return;
        const result=await api(`/reports/snapshots/${safeId(snapshot.snapshot_id)}`);
        if(state.report!==snapshot)return;
        Object.assign(snapshot,result);
        if(snapshot.delivery?.delivery_status_url){
          const url=snapshot.delivery.delivery_status_url;
          if(!/^\/api\/email\/documents\/[1-9][0-9]*$/.test(url))throw new Error('The delivery status URL is unavailable.');
          const response=await fetch(url,{credentials:'same-origin'}),delivery=await response.json();
          if(!response.ok)throw new Error(delivery.message || 'Delivery status could not be loaded.');
          const email=delivery.email;
          renderReportDialog(email?`Email: ${statusText(email.status)}${email.provider_accepted?' · Provider accepted':''}. Recipient receipt remains unverified.`:'The delivery request is retained. Email has not been queued.');
        }else renderReportDialog('Report status refreshed.');return;
      }
      if(action==='send-report'){
        const current=document.getElementById('procurementReportEmailForm');
        if(!window.VoxelDialog.validate(current) || snapshot.sending || snapshot.sendAttempted)return;
        const recipient=current.elements.namedItem('to').value.trim();
        snapshot.sending=true;snapshot.sendAttempted=true;
        current.querySelector('button').disabled=true;
        const result=await api(`/reports/snapshots/${safeId(snapshot.snapshot_id)}/send`,{method:'POST',body:JSON.stringify({to:recipient})});
        snapshot.sending=false;snapshot.delivery=result;
        if(status)status.textContent=result.provider_accepted?'Provider accepted this PDF; recipient receipt remains unverified.':`Delivery ${statusText(result.email_status || 'QUEUED')}. Recipient receipt remains unverified.`;
      }
    }catch(error){
      snapshot.sending=false;
      if(Number.isSafeInteger(Number(error.data?.document_request_id)) && Number(error.data.document_request_id)>0)snapshot.delivery={delivery_status_url:`/api/email/documents/${Number(error.data.document_request_id)}`};
      if(status)status.textContent=errorText(error)+(snapshot.sendAttempted?' Review delivery status before sending again.':'');
    }
  }

  async function planAction(action,id) {
    let ownsImport=false;
    try {
      if(action==='upload-files')return openUpload();
      if(action==='new-entry')return openEntry();
      if(action==='new-source-entry'){const files=[...(state.importDetail?.files || []),...(state.uploads.imports || []).flatMap(batch=>batch.files || [])];const file=files.find(item=>String(item.id)===id);if(file?.durable)return openEntry(null,null,file);throw new Error('Refresh the uploaded source before linking a draft.');}
      if(action==='edit-entry')return openEntry((state.entries.entries || []).find(row=>String(row.id)===id));
      if(action==='filter-entries'){state.entryFilters.page=1;state.selectedEntries.clear();return load();}
      if(action==='filter-uploads'){state.uploadFilters.page=1;return load();}
      if(action==='entries-page'){state.entryFilters.page=Math.max(1,Number(id));return load();}
      if(action==='uploads-page'){state.uploadFilters.page=Math.max(1,Number(id));return load();}
      if(action==='review-import' || action==='refresh-import')return await readImport(id || state.importDetail?.batch?.id,1);
      if(action==='review-page')return await readImport(state.importDetail.batch.id,Number(id),true);
      if(action==='close-import'){if(state.mappingDirty&&!(await VoxelFeedback.confirm('Discard unsaved import mapping changes? The original uploaded files are preserved.')))return;state.importReadSequence+=1;state.importDetail=null;state.error='';render();return;}
      if(action==='retry-extraction'){
        const batch=state.importDetail?.batch;
        return showDialog('Retry failed extraction',`<form id="procurementEntryForm" class="procurement-form"><p>The retained originals are reused. Already saved entries remain linked to their source rows.</p><label>Retry reason<textarea name="reason" required maxlength="1000"></textarea></label><p id="procurementEntryError" class="procurement-inline-error" role="alert"></p></form>`,async()=>{
          const current=document.getElementById('procurementEntryForm');if(!window.VoxelDialog.validate(current) || state.busy.has('import'))return;state.busy.add('import');
          try{const detail=await api(`/imports/${safeId(id)}/retry-extraction`,{method:'POST',body:JSON.stringify({expected_revision:revision(batch),reason:current.elements.namedItem('reason').value.trim()})});adoptImport(detail);hideDialog();render();}catch(error){setFormError(error);}finally{state.busy.delete('import');render();}
        },'Retry extraction');
      }
      if(action==='edit-import-row'){if(state.mappingDirty)throw new Error('Review the changed mapping before editing rows.');return openEntry(null,(state.importDetail.rows || []).find(row=>String(row.id)===id));}
      if(action==='preview-source'){
        await window.VoxelOperations.openPdf(`/api/procurement/imports/files/${safeId(id)}/pdf`);return;
      }
      if(action==='preview-import'){
        if(state.busy.has('import'))return;state.busy.add('import');ownsImport=true;render();
        const detail=await api(`/imports/${safeId(state.importDetail.batch.id)}/preview`,{method:'POST',body:JSON.stringify({expected_revision:revision(state.importDetail),file_id:state.importFileId,sheet_name:state.importSheet,header_row:state.importHeaderRow,mapping:state.importMapping,classification:state.importClassification,date_order:state.importDateOrder})});
        adoptImport(detail,false);state.selectedRows=new Set();render();return;
      }
      if(action==='commit-import'){
        if(state.busy.has('import') || state.mappingDirty || !state.reviewConfirmed)return;
        const rows=(state.importDetail.rows || []).filter(row=>state.selectedRows.has(String(row.id)) && (row.status==='VALIDATED' || (row.status==='REVIEW_REQUIRED' && row.reviewed && !issueText(row.errors))));
        if(!rows.length)throw new Error('Select valid reviewed rows on this page.');
        state.busy.add('import');ownsImport=true;render();
        const result=await api(`/imports/${safeId(state.importDetail.batch.id)}/commit`,{method:'POST',body:JSON.stringify({expected_revision:revision(state.importDetail),preview_token:state.importDetail.preview_token,row_ids:rows.map(row=>row.id),reviewed_row_ids:rows.map(row=>row.id)})});
        state.uploadResult=result;const batchId=state.importDetail.batch.id;
        await readImport(batchId);await load();toast('Selected drafts saved. All file and row outcomes remain in Uploaded files.', {kind:'info'});return;
      }
      if(action==='archive-entry' || action==='restore-entry'){
        const entry=(state.entries.entries || []).find(row=>String(row.id)===id);
        if(!entry || !canWriteEntries())return;
        const verb=action==='archive-entry'?'archive':'restore';
        return showDialog(verb==='archive'?'Archive saved entry':'Restore saved entry',`<form id="procurementEntryForm" class="procurement-form"><p>${escapeHtml(entry.title)} · Revision ${revision(entry)}</p><label>Reason<textarea name="reason" required maxlength="1000"></textarea></label><p id="procurementEntryError" class="procurement-inline-error" role="alert"></p></form>`,async()=>{
          const current=document.getElementById('procurementEntryForm');if(!window.VoxelDialog.validate(current) || state.busy.has('entry'))return;state.busy.add('entry');
          try{await api(`/entries/${safeId(id)}/${verb}`,{method:'POST',body:JSON.stringify({expected_revision:revision(entry),reason:current.elements.namedItem('reason').value.trim()})});state.selectedEntries.delete(id);hideDialog();await load();}catch(error){setFormError(error);}finally{state.busy.delete('entry');}
        },verb==='archive'?'Archive entry':'Restore entry');
      }
      if(action==='report-register')return openReport('register');
      if(action==='report-options')return openReportOptions();
      if(action==='report-selected')return openReport('selected');
      if(action==='report-entry')return openReport('individual',id);
      if(action==='report-po')return openReport('individual',Number(id),null,'purchase-orders');
      if(action==='report-import')return openReport('import-outcomes',null,id);
    }catch(error){state.error=errorText(error);render();}finally{if(ownsImport){state.busy.delete('import');render();}}
  }

  async function simpleAction(path, message, body = {}) {
    try {
      const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
      toast(result.message || message, {kind:'success'}); await load();
    } catch (error) { toast(error.message, {kind:'error'}); }
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
          hideDialog(); toast(result.message, {kind:'success'}); await load();
        }, action === 'cancel-requisition' ? 'Cancel requisition' : 'Cancel purchase order');
      }
    } catch (error) { toast(error.message, {kind:'error'}); }
  }

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-procurement-tab]');
    if (tab) { state.importReadSequence+=1;state.tab = tab.dataset.procurementTab; load(); return; }
    const action = event.target.closest('[data-procurement-action]');
    if(action){
      const planActions=new Set(['upload-files','new-entry','new-source-entry','edit-entry','filter-entries','filter-uploads','entries-page','uploads-page','review-import','refresh-import','review-page','close-import','retry-extraction','edit-import-row','preview-source','preview-import','commit-import','archive-entry','restore-entry','report-register','report-options','report-selected','report-entry','report-po','report-import']);
      if(planActions.has(action.dataset.procurementAction))planAction(action.dataset.procurementAction,String(action.dataset.id || ''));
      else handleAction(action.dataset.procurementAction, Number(action.dataset.id || 0));
    }
  });
  root.addEventListener('keydown',event=>{
    if(!event.target.matches('[data-procurement-tab]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const tabs=[...root.querySelectorAll('[data-procurement-tab]')],index=tabs.indexOf(event.target);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].focus();tabs[next].click();
  });

  document.addEventListener('input',event=>{if(event.target.matches('#procurementReportEmailForm [name="to"]') && state.report)state.report.recipient=event.target.value;});
  document.addEventListener('click', (event) => {
    const report=event.target.closest('[data-procurement-dialog-action]');
    if(report){reportAction(report.dataset.procurementDialogAction);return;}
    const add = event.target.closest('[data-procurement-add-line]');
    if (add && form()) form().querySelector('[data-procurement-lines]')?.insertAdjacentHTML('beforeend', lineRow(add.dataset.procurementAddLine));
    const remove = event.target.closest('.procurement-line-remove');
    if (remove && form()) {
      const rows = form().querySelectorAll('[data-procurement-line]');
      if (rows.length > 1) remove.closest('[data-procurement-line]')?.remove();
    }
  });

  root.addEventListener('input', (event) => {
    if(event.target.matches('[data-entry-filter]')){state.entryFilters[event.target.dataset.entryFilter]=event.target.value;return;}
    if(event.target.matches('[data-upload-filter]')){state.uploadFilters[event.target.dataset.uploadFilter]=event.target.value;return;}
    if (event.target.matches('[data-procurement-catalog-search]')) {
      state.catalogQuery = event.target.value;
      render();
      root.querySelector('[data-procurement-catalog-search]')?.focus();
      const input = root.querySelector('[data-procurement-catalog-search]');
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  root.addEventListener('change', (event) => {
    if(event.target.matches('[data-entry-filter]')){state.entryFilters[event.target.dataset.entryFilter]=event.target.value;return;}
    if(event.target.matches('[data-upload-filter]')){state.uploadFilters[event.target.dataset.uploadFilter]=event.target.value;return;}
    if(event.target.matches('[data-entry-selection]')){const id=event.target.dataset.entrySelection;if(event.target.checked)state.selectedEntries.add(id);else state.selectedEntries.delete(id);render();return;}
    if(event.target.matches('[data-import-row-selection]')){const id=event.target.dataset.importRowSelection;if(event.target.checked)state.selectedRows.add(id);else state.selectedRows.delete(id);state.reviewConfirmed=false;render();return;}
    if(event.target.matches('[data-import-confirmation]')){state.reviewConfirmed=event.target.checked;render();return;}
    if(event.target.matches('[data-import-field]')){const key=event.target.dataset.importField;if(event.target.value==='')delete state.importMapping[key];else state.importMapping[key]=Number(event.target.value);state.reviewConfirmed=false;state.mappingDirty=true;render();return;}
    if(event.target.matches('[data-import-setting]')){
      const key=event.target.dataset.importSetting,value=event.target.value;state.importReadSequence+=1;
      if(key==='file'){state.importFileId=value;const file=state.importDetail.files.find(item=>String(item.id)===value),saved=file?.mapping || {};state.importSheet=saved.sheet_name || file?.sheets?.[0]?.name || '';state.importMapping=saved.mapping || file?.sheets?.[0]?.suggested_mapping?.mapping || {};state.importHeaderRow=Number(saved.header_row ?? file?.sheets?.[0]?.header_row ?? 1);state.importClassification=saved.classification || 'PLAN';state.importDateOrder=saved.date_order || 'ISO';state.selectedRows.clear();}
      if(key==='sheet'){state.importSheet=value;const sheet=state.importDetail.files.find(file=>String(file.id)===state.importFileId)?.sheets?.find(item=>item.name===value);state.importHeaderRow=Number(sheet?.header_row ?? 0);state.importMapping=sheet?.suggested_mapping?.mapping || {};state.selectedRows.clear();}
      if(key==='header')state.importHeaderRow=Number(value);
      if(key==='classification')state.importClassification=value;
      if(key==='date-order')state.importDateOrder=value;
      state.reviewConfirmed=false;state.mappingDirty=canWriteEntries() && key!=='file';render();return;
    }
    if (event.target.matches('[data-procurement-catalog-priority]')) {
      state.catalogPriority = event.target.value;
      render();
    }
    if (event.target.matches('[data-procurement-catalog-phase]')) {
      state.catalogPhase = event.target.value;
      render();
    }
  });

  root.querySelector('[data-procurement-refresh]')?.addEventListener('click', load);
  window.VoxelProcurementUI = { load };
})();
