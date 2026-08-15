const token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentRole = String(currentUser.role || localStorage.getItem('role') || '').trim().toLowerCase();
let redirectingToLogin = false;

if (!token) redirectToLogin('Please login to continue.');

if (currentRole === 'admin') {
  window.location.href = '/admin';
}

let lastTaskIds = new Set();
let firstTaskLoad = true;
let tenHourReminderShown = false;
let staffStockCache = [];
let staffStockOutCache = [];
let staffMaterialCache = {
  raw_material: [],
  packaging: []
};
let staffExpensePage = 1;
let staffExpenseLimit = 25;
let staffMeetingCache = [];
let lastAnnouncementIds = new Set();
let firstAnnouncementLoad = true;
let shiftQrScannerStream = null;
let shiftQrScannerTimer = null;
let shiftQrScannerCanvas = null;
let shiftQrDecoderPromise = null;
let activeShiftQrMode = 'in';
let currentShiftIsOpen = false;
let latestRosterRows = [];
let currentWeekTimesheet = null;

const clockInMessages = [
  'Today is another chance to build something precise, useful, and proudly Voxel Veda.',
  'Your shift has started. Bring focus, care, and steady energy to every task today.',
  'Great work starts with one clean first step. You are clocked in and ready to move.',
  'You are on shift now. Make today count with quality, teamwork, and sharp attention.',
  'Precision begins with presence. You are checked in and ready for a strong day.',
  'Start steady, think clearly, and let every small action lift the whole team.',
  'Your day is live. Build with care, communicate early, and keep standards high.'
];

const clockOutMessages = [
  'Shift complete. Thank you for the work, care, and effort you put in today.',
  'You are clocked out. Rest well knowing today moved the team forward.',
  'Good work today. Every finished task adds strength to the whole operation.',
  "Shift ended. Recharge well, and carry today's wins into tomorrow.",
  'You closed the shift with progress behind you. Thank you for showing up well.',
  'The workday is complete. Reset, recover, and be proud of the effort you gave.',
  'Clock-out confirmed. Today is recorded, and your contribution matters.'
];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

function redirectToLogin(message = 'Your session expired. Please login again.') {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  localStorage.clear();
  const params = new URLSearchParams({ message });
  window.location.replace(`/login?${params.toString()}`);
  throw new Error('Redirecting to login');
}

async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  } finally {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    window.location.href = '/login';
  }
}

function isMobileShellViewport() {
  return window.matchMedia('(max-width: 1023px)').matches;
}

function syncMobileMenuState(shouldOpen) {
  document.body.classList.toggle('mobile-menu-open', shouldOpen);
  document.documentElement.classList.toggle('mobile-menu-open', shouldOpen);
  document.body.classList.toggle('vv-scroll-locked', shouldOpen);
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.querySelector('.mobile-sidebar-backdrop');
  document.querySelectorAll('.mobile-menu-btn, .topbar-menu-btn').forEach((btn) => {
    btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  });
  if (sidebar) sidebar.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  if (backdrop) backdrop.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
}

function toggleMobileMenu(open) {
  const shouldOpen = typeof open === 'boolean'
    ? open
    : !document.body.classList.contains('mobile-menu-open');
  syncMobileMenuState(shouldOpen);
  if (shouldOpen) {
    window.setTimeout(() => document.querySelector('.sidebar .nav-btn:not(.hidden-section), .sidebar .nav-group-toggle')?.focus?.(), 80);
  }
}

function closeMobileMenuOnCompact() {
  if (isMobileShellViewport()) toggleMobileMenu(false);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleMobileMenu(false);
});

function enhanceResponsiveTables() {
  document.querySelectorAll('table').forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    if (!headers.length) return;

    table.classList.add('responsive-table');
    table.querySelectorAll('tbody tr').forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (headers[index]) cell.setAttribute('data-label', headers[index]);
      });
    });
  });
}

function startResponsiveTableObserver() {
  enhanceResponsiveTables();

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(enhanceResponsiveTables);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function safeJson(res) {
  let data = {};

  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    redirectToLogin(data.message || 'Your session expired. Please login again.');
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString('en-AU');
  } catch {
    return String(value);
  }
}

function formatShortDate(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleDateString('en-AU');
  } catch {
    return String(value).slice(0, 10);
  }
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
}

const PERMISSION_INPUT_PARENTS = {
  rfqs_input: ['rfqs'],
  invoices_input: ['invoices'],
  customers_input: ['customers'],
  suppliers_input: ['suppliers'],
  expenses_input: ['expenses'],
  compliance_input: ['compliance'],
  competitors_input: ['competitors'],
  tasks_input: ['tasks'],
  roster_input: ['roster'],
  attendance_input: ['attendance'],
  attendance_qr_bypass: ['attendance'],
  stock_in_input: ['stock', 'stock_in'],
  stock_out_input: ['stock', 'stock_out'],
  raw_material_input: ['stock', 'raw_material'],
  packaging_input: ['stock', 'packaging'],
  meetings_input: ['meetings']
};

function getEffectivePermissions() {
  const user = getStoredUser();
  const rawPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  const permissions = new Set(rawPermissions.filter(Boolean));
  const explicitlyGrantedStock = permissions.has('stock');

  Object.entries(PERMISSION_INPUT_PARENTS).forEach(([inputPermission, parents]) => {
    if (permissions.has(inputPermission)) parents.forEach((parent) => permissions.add(parent));
  });

  if (['stock', 'stock_in', 'stock_out', 'raw_material', 'packaging'].some((id) => permissions.has(id))) {
    permissions.add('stock');
  }

  if (explicitlyGrantedStock) {
    ['stock_in', 'stock_out', 'raw_material', 'packaging'].forEach((id) => permissions.add(id));
  }

  return permissions;
}

function hasPermission(permission) {
  const user = getStoredUser();
  const role = String(user.role || currentRole || '').trim().toLowerCase();
  if (role === 'admin') return true;

  return getEffectivePermissions().has(permission);
}

function canInput(permission) {
  return hasPermission(`${permission}_input`);
}

function canUseQrException() {
  return hasPermission('attendance_qr_bypass');
}

function hasStaffWorkAccess(permission) {
  const user = getStoredUser();
  const role = String(user.role || currentRole || '').trim().toLowerCase();
  if (['admin', 'super admin', 'manager', 'staff'].includes(role)) return true;
  return hasPermission(permission);
}

function applyPermissionUI() {
  const canUseTasks = hasPermission('tasks');
  const canUseAttendance = hasPermission('attendance');
  const canUseRoster = hasPermission('roster');
  const canUseWorkforce = canUseAttendance || canUseRoster;
  const canUseMeetings = hasPermission('meetings');
  const canUseRfqs = hasPermission('rfqs');
  const canUseInvoices = hasPermission('invoices');
  const canUseCustomers = hasPermission('customers');
  const canUseSuppliers = hasPermission('suppliers');
  const canUseStockIn = hasPermission('stock_in');
  const canUseStockOut = hasPermission('stock_out');
  const canUseRawMaterial = hasPermission('raw_material');
  const canUsePackaging = hasPermission('packaging');
  const canUseStock = hasPermission('stock') || canUseStockIn || canUseStockOut || canUseRawMaterial || canUsePackaging;
  const canUseExpenses = hasPermission('expenses');
  const canUseFinance = canUseInvoices || canUseExpenses;
  const canUseCompliance = hasPermission('compliance');
  const canUseCompetitors = hasPermission('competitors');
  const canUseSales = canUseRfqs || canUseInvoices || canUseCustomers || canUseSuppliers;
  const canUseLeave = hasStaffWorkAccess('leave');
  const canUseAvailability = hasStaffWorkAccess('availability');
  const canUseDocuments = hasStaffWorkAccess('documents');
  const canUseForms = hasStaffWorkAccess('forms');
  const canUseMessages = hasStaffWorkAccess('messages');
  const canUseWorkHub = canUseLeave || canUseAvailability || canUseDocuments || canUseForms || canUseMessages;

  setPermissionVisibility('.permission-sales', canUseSales);
  setPermissionVisibility('.permission-rfqs', canUseRfqs);
  setPermissionVisibility('.permission-rfqs-input', canInput('rfqs'));
  setPermissionVisibility('.permission-invoices', canUseInvoices);
  setPermissionVisibility('.permission-invoices-input', canInput('invoices'));
  setPermissionVisibility('.permission-customers', canUseCustomers);
  setPermissionVisibility('.permission-customers-input', canInput('customers'));
  setPermissionVisibility('.permission-suppliers', canUseSuppliers);
  setPermissionVisibility('.permission-suppliers-input', canInput('suppliers'));
  setPermissionVisibility('.permission-tasks', canUseTasks);
  setPermissionVisibility('.permission-attendance', canUseAttendance);
  setPermissionVisibility('.permission-roster', canUseRoster);
  setPermissionVisibility('.permission-workforce', canUseWorkforce);
  setPermissionVisibility('.permission-meetings', canUseMeetings);
  setPermissionVisibility('.permission-stock', canUseStock);
  setPermissionVisibility('.permission-stock-in', canUseStockIn);
  setPermissionVisibility('.permission-stock-in-input', canInput('stock_in'));
  setPermissionVisibility('.permission-stock-out', canUseStockOut);
  setPermissionVisibility('.permission-stock-out-input', canInput('stock_out'));
  setPermissionVisibility('.permission-raw-material', canUseRawMaterial);
  setPermissionVisibility('.permission-raw-material-input', canInput('raw_material'));
  setPermissionVisibility('.permission-packaging', canUsePackaging);
  setPermissionVisibility('.permission-packaging-input', canInput('packaging'));
  setPermissionVisibility('.permission-finance', canUseFinance);
  setPermissionVisibility('.permission-expenses', canUseExpenses);
  setPermissionVisibility('.permission-expenses-input', canInput('expenses'));
  setPermissionVisibility('.permission-compliance', canUseCompliance);
  setPermissionVisibility('.permission-compliance-input', canInput('compliance'));
  setPermissionVisibility('.permission-competitors', canUseCompetitors);
  setPermissionVisibility('.permission-competitors-input', canInput('competitors'));
  setPermissionVisibility('.permission-workhub', canUseWorkHub);
  setPermissionVisibility('.permission-leave', canUseLeave);
  setPermissionVisibility('.permission-availability', canUseAvailability);
  setPermissionVisibility('.permission-documents', canUseDocuments);
  setPermissionVisibility('.permission-forms', canUseForms);
  setPermissionVisibility('.permission-messages', canUseMessages);

  if (document.querySelector('.nav-btn.active.hidden-section')) {
    document.querySelector('[data-section="dashboardSection"]')?.click();
  }
}

async function refreshStaffSession() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(res);
    if (!res.ok || !data.user) return null;

    const role = String(data.user.role || '').trim().toLowerCase();
    currentUser = { ...data.user, role };
    currentRole = role;
    localStorage.setItem('user', JSON.stringify(currentUser));
    localStorage.setItem('role', role);
    applyPermissionUI();
    loadWorkHubModules();
    return currentUser;
  } catch {
    return null;
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function updateStaffMissionBase() {
  const name = currentUser.name || currentUser.username || 'Team member';
  setText('staffMissionGreeting', `Welcome, ${name}`);
  setText('staffMissionDate', new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: '2-digit',
    month: 'short'
  }));
}

async function loadStaffFinanceOverview() {
  if (!hasPermission('invoices') && !hasPermission('expenses')) return;

  const res = await fetch('/api/dashboard/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) return;

  setText('staffRevenueValue', formatMoney(data.finance?.revenue));
  setText('staffExpenseValue', formatMoney(data.finance?.expenses));
  setText('staffNetWorthValue', formatMoney(data.finance?.net_worth));
}

function staffMatchesSearch(row, search, fields) {
  const term = String(search || '').trim().toLowerCase();
  if (!term) return true;
  return fields.some((field) => String(row[field] ?? '').toLowerCase().includes(term));
}

function staffStatusBadge(status) {
  const label = String(status || 'open').trim() || 'open';
  return `<span class="status-badge status-${escapeHtml(label.toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(label)}</span>`;
}

async function loadStaffRfqs() {
  if (!hasPermission('rfqs')) return;
  const tbody = document.getElementById('staffRfqTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7">Loading RFQs...</td></tr>';

  try {
    const res = await fetch('/api/rfq', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load RFQs')}</td></tr>`;
      return;
    }

    const search = document.getElementById('staffRfqSearch')?.value || '';
    const rows = (data.rfqs || []).filter((row) => staffMatchesSearch(row, search, ['id', 'customer_name', 'email', 'phone', 'material', 'application', 'status']));
    const pending = rows.filter((row) => String(row.status || '').toLowerCase() === 'pending').length;
    const approved = rows.filter((row) => ['approved', 'quoted'].includes(String(row.status || '').toLowerCase())).length;
    const inputAllowed = canInput('rfqs');

    setText('staffRfqTotal', String(rows.length));
    setText('staffRfqPending', String(pending));
    setText('staffRfqApproved', String(approved));

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7">No RFQs found for this view.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((rfq) => `
      <tr>
        <td>#${escapeHtml(rfq.id)}</td>
        <td><strong>${escapeHtml(rfq.customer_name || '-')}</strong></td>
        <td>${escapeHtml(rfq.email || '-')}<br><span class="muted-text">${escapeHtml(rfq.phone || '-')}</span></td>
        <td><strong>${escapeHtml(rfq.material || '-')}</strong><br><span class="muted-text">${escapeHtml(rfq.application || '-')}</span></td>
        <td>${escapeHtml(rfq.quantity || 0)}</td>
        <td>${staffStatusBadge(rfq.status)}</td>
        <td class="${inputAllowed ? '' : 'hidden-section'}">
          <button class="icon-btn" type="button" onclick="updateStaffRfqStatus(${Number(rfq.id)}, 'approve')">Approve</button>
          <button class="icon-btn danger-icon" type="button" onclick="updateStaffRfqStatus(${Number(rfq.id)}, 'reject')">Reject</button>
        </td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="7">Failed to load RFQs</td></tr>';
  }
}

async function updateStaffRfqStatus(id, action) {
  if (!canInput('rfqs')) {
    showToast("You don't have access to update RFQs. Please contact admin.");
    return;
  }

  const res = await fetch(`/api/rfq/${action}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ rfq_id: id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'RFQ update failed');
    return;
  }

  showToast(data.message || 'RFQ updated');
  await loadStaffRfqs();
}

async function openStaffInvoicePdf(id) {
  try {
    const res = await fetch(`/api/invoice/${id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await safeJson(res);
      showToast(data.message || 'Invoice PDF failed');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    showToast('Invoice PDF failed');
  }
}

async function loadStaffInvoices() {
  if (!hasPermission('invoices')) return;
  const tbody = document.getElementById('staffInvoiceTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8">Loading invoices...</td></tr>';

  try {
    const res = await fetch('/api/invoice', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(data.message || 'Failed to load invoices')}</td></tr>`;
      return;
    }

    const search = document.getElementById('staffInvoiceSearch')?.value || '';
    const rows = (data.invoices || []).filter((row) => staffMatchesSearch(row, search, ['invoice_no', 'customer_name', 'customer_email', 'rfq_id', 'status', 'payment_state']));

    const totals = rows.reduce((acc, invoice) => {
      acc.total += Number(invoice.total || 0);
      acc.paid += Number(invoice.paid_amount || 0);
      acc.debt += Number(invoice.balance_due || 0);
      return acc;
    }, { total: 0, paid: 0, debt: 0 });

    setText('staffInvoiceTotal', formatMoney(totals.total));
    setText('staffInvoicePaid', formatMoney(totals.paid));
    setText('staffInvoiceDebt', formatMoney(totals.debt));

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8">No invoices found for this view.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((invoice) => `
      <tr>
        <td><strong>${escapeHtml(invoice.invoice_no || `INV-${invoice.id}`)}</strong></td>
        <td>${escapeHtml(invoice.customer_name || '-')}<br><span class="muted-text">${escapeHtml(invoice.customer_email || '-')}</span></td>
        <td>${escapeHtml(invoice.rfq_id || 'Manual')}</td>
        <td><strong>${escapeHtml(formatMoney(invoice.total))}</strong></td>
        <td>${escapeHtml(formatMoney(invoice.paid_amount))}</td>
        <td>${escapeHtml(formatMoney(invoice.balance_due))}</td>
        <td>${staffStatusBadge(invoice.payment_state || invoice.status)}</td>
        <td><button class="icon-btn" type="button" onclick="openStaffInvoicePdf(${Number(invoice.id)})">PDF</button></td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="8">Failed to load invoices</td></tr>';
  }
}

async function loadStaffCustomers() {
  if (!hasPermission('customers')) return;
  const tbody = document.getElementById('staffCustomerTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7">Loading customers...</td></tr>';

  try {
    const res = await fetch('/api/customers', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load customers')}</td></tr>`;
      return;
    }

    const search = document.getElementById('staffCustomerSearch')?.value || '';
    const rows = (data.customers || []).filter((row) => staffMatchesSearch(row, search, ['company_name', 'contact_name', 'email', 'phone', 'address', 'notes']));

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7">No customers found for this view.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((customer) => `
      <tr>
        <td><strong>${escapeHtml(customer.company_name || '-')}</strong><br><span class="muted-text">${escapeHtml(customer.address || '')}</span></td>
        <td>${escapeHtml(customer.contact_name || '-')}</td>
        <td>${escapeHtml(customer.email || '-')}</td>
        <td>${escapeHtml(customer.phone || '-')}</td>
        <td>${escapeHtml(customer.order_count || 0)}</td>
        <td><strong>${escapeHtml(formatMoney(customer.total_spend))}</strong></td>
        <td>${escapeHtml(customer.notes || '-')}</td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="7">Failed to load customers</td></tr>';
  }
}

async function loadStaffSuppliers() {
  if (!hasPermission('suppliers')) return;
  const tbody = document.getElementById('staffSupplierTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7">Loading suppliers...</td></tr>';

  try {
    const res = await fetch('/api/suppliers', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load suppliers')}</td></tr>`;
      return;
    }

    const search = document.getElementById('staffSupplierSearch')?.value || '';
    const rows = (data.suppliers || []).filter((row) => staffMatchesSearch(row, search, ['supplier_name', 'contact_name', 'email', 'phone', 'category', 'payment_terms', 'abn_acn', 'notes']));

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7">No suppliers found for this view.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((supplier) => `
      <tr>
        <td><strong>${escapeHtml(supplier.supplier_name || '-')}</strong><br><span class="muted-text">${escapeHtml(supplier.address || '')}</span></td>
        <td>${escapeHtml(supplier.contact_name || '-')}<br><span class="muted-text">${escapeHtml(supplier.email || '-')} | ${escapeHtml(supplier.phone || '-')}</span></td>
        <td>${escapeHtml(supplier.category || '-')}</td>
        <td>${escapeHtml(supplier.payment_terms || '-')}</td>
        <td>${escapeHtml(supplier.abn_acn || '-')}</td>
        <td>${Number(supplier.file_count || 0)} files</td>
        <td>${escapeHtml(supplier.notes || '-')}</td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="7">Failed to load suppliers</td></tr>';
  }
}

function updateStaffMaterialMetrics(type, rows) {
  const prefix = type === 'packaging' ? 'staffPackaging' : 'staffRawMaterial';
  const value = rows.reduce((sum, item) => sum + Number(item.current_value || 0), 0);
  const qty = rows.reduce((sum, item) => sum + Number(item.current_qty || 0), 0);
  const low = rows.filter((item) => Number(item.current_qty || 0) <= Number(item.reorder_level || 0)).length;

  setText(`${prefix}Value`, formatMoney(value));
  setText(`${prefix}Qty`, String(qty));
  setText(`${prefix}Low`, String(low));
}

async function loadStaffMaterials(type) {
  const permission = type === 'packaging' ? 'packaging' : 'raw_material';
  if (!hasPermission(permission)) return;

  const tableId = type === 'packaging' ? 'staffPackagingTableBody' : 'staffRawMaterialTableBody';
  const tbody = document.getElementById(tableId);
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8">Loading ${type === 'packaging' ? 'packaging' : 'raw material'}...</td></tr>`;

  try {
    const res = await fetch(`/api/materials?type=${encodeURIComponent(type)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(res);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(data.message || 'Failed to load inventory')}</td></tr>`;
      return;
    }

    const rows = data.materials || [];
    staffMaterialCache[type] = rows;
    updateStaffMaterialMetrics(type, rows);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8">No ${type === 'packaging' ? 'packaging' : 'raw material'} items yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((item) => {
      const processSheet = item.process_sheet || {};
      const quality = [
        processSheet.visual_condition,
        processSheet.contamination_check,
        processSheet.final_disposition
      ].filter(Boolean).join(' / ') || '-';

      return `
        <tr>
          <td><strong>${escapeHtml(item.item_name || '-')}</strong><br><span class="muted-text">${escapeHtml(item.notes || '')}</span></td>
          <td>${escapeHtml(item.supplier || '-')}</td>
          <td>${escapeHtml(item.reference_code || '-')}</td>
          <td><strong>${escapeHtml(item.current_qty || 0)} ${escapeHtml(item.unit_label || 'units')}</strong><br><span class="muted-text">Input: ${escapeHtml(item.input_qty || 0)}</span></td>
          <td>${escapeHtml(formatMoney(item.unit_price))}</td>
          <td><strong>${escapeHtml(formatMoney(item.current_value))}</strong></td>
          <td>${escapeHtml(quality)}</td>
          <td>Created: ${escapeHtml(item.created_by_name || '-')}<br><span class="muted-text">Updated: ${escapeHtml(item.updated_by_name || '-')}</span></td>
        </tr>
      `;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="8">Failed to load inventory</td></tr>';
  }
}

async function loadStaffCompliance() {
  if (!hasPermission('compliance')) return;
  const list = document.getElementById('staffComplianceList');
  if (!list) return;

  list.innerHTML = '<div class="empty-state">Loading compliance register...</div>';

  try {
    const res = await fetch('/api/compliance', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Failed to load compliance register')}</div>`;
      return;
    }

    const rows = data.entries || [];
    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No compliance records yet.</div>';
      return;
    }

    list.innerHTML = rows.map((entry) => `
      <article class="mobile-card announcement-card">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(entry.title || '-')}</h3>
            <p>${escapeHtml(entry.category || '-')} | ${escapeHtml(entry.authority || '-')}</p>
          </div>
          ${staffStatusBadge(entry.status)}
        </div>
        <p><strong>Requirement:</strong> ${escapeHtml(entry.requirement_type || '-')}</p>
        <p><strong>Due / Renewal:</strong> ${escapeHtml(formatShortDate(entry.due_date))} / ${escapeHtml(formatShortDate(entry.renewal_date))}</p>
        <p><strong>Process sheet:</strong> ${entry.process_sheet_required ? 'Required' : 'Not required'} | <strong>Files:</strong> ${Number(entry.files?.length || 0)}</p>
        <p>${escapeHtml(entry.notes || '-')}</p>
        ${entry.official_link ? `<a class="secondary-btn inline-action" href="${escapeHtml(entry.official_link)}" target="_blank" rel="noopener">Open Form</a>` : ''}
      </article>
    `).join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Failed to load compliance register</div>';
  }
}

async function loadStaffCompetitors() {
  if (!hasPermission('competitors')) return;
  const list = document.getElementById('staffCompetitorList');
  if (!list) return;

  list.innerHTML = '<div class="empty-state">Loading competitors...</div>';

  try {
    const res = await fetch('/api/competitors', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Failed to load competitors')}</div>`;
      return;
    }

    const search = document.getElementById('staffCompetitorSearch')?.value || '';
    const rows = (data.competitors || []).filter((row) => staffMatchesSearch(row, search, ['company_name', 'category', 'country', 'city', 'capabilities', 'materials', 'target_market', 'strength']));

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No competitor records found for this view.</div>';
      return;
    }

    list.innerHTML = rows.map((company) => `
      <article class="mobile-card announcement-card">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(company.company_name || '-')}</h3>
            <p>${escapeHtml(company.category || '-')} | ${escapeHtml(company.city || '-')} ${escapeHtml(company.country || '')}</p>
          </div>
          <span class="badge">${escapeHtml(company.source_type || 'tracked')}</span>
        </div>
        <p><strong>Capabilities:</strong> ${escapeHtml(company.capabilities || '-')}</p>
        <p><strong>Materials:</strong> ${escapeHtml(company.materials || '-')}</p>
        <p><strong>Market:</strong> ${escapeHtml(company.target_market || '-')}</p>
        <p><strong>Strength:</strong> ${escapeHtml(company.strength || '-')}</p>
        ${company.website ? `<a class="secondary-btn inline-action" href="${escapeHtml(company.website)}" target="_blank" rel="noopener">Website</a>` : ''}
      </article>
    `).join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Failed to load competitors</div>';
  }
}

function staffExpenseStatusBadge(status) {
  const label = String(status || 'paid').trim() || 'paid';
  return `<span class="status-badge status-${escapeHtml(label.toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(label)}</span>`;
}

function changeStaffExpensePage(delta) {
  loadStaffExpenses(Math.max(1, staffExpensePage + delta));
}

async function loadStaffExpenses(page = staffExpensePage) {
  if (!hasPermission('expenses')) return;

  const tbody = document.getElementById('staffExpenseTableBody');
  if (!tbody) return;

  staffExpensePage = Math.max(Number(page || 1), 1);
  staffExpenseLimit = Number(document.getElementById('staffExpensePageSize')?.value || staffExpenseLimit || 25);
  const search = document.getElementById('staffExpenseSearch')?.value.trim() || '';
  const params = new URLSearchParams({
    page: staffExpensePage,
    limit: staffExpenseLimit,
    search
  });

  tbody.innerHTML = '<tr><td colspan="9">Loading expenses...</td></tr>';

  try {
    const res = await fetch(`/api/expenses?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(res);

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(data.message || 'Failed to load expenses')}</td></tr>`;
      return;
    }

    const rows = data.expenses || [];
    const summary = data.summary || {};
    const totalRows = Number(data.total || rows.length || 0);
    const currentPage = Number(data.page || staffExpensePage);
    const currentLimit = Number(data.limit || staffExpenseLimit);

    setText('staffExpenseListTotal', formatMoney(summary.total_expense));
    setText('staffExpenseListGst', formatMoney(summary.gst_paid));
    setText('staffExpenseListCount', String(summary.expense_count || totalRows || 0));

    const info = document.getElementById('staffExpensePageInfo');
    if (info) {
      const start = totalRows ? ((currentPage - 1) * currentLimit) + 1 : 0;
      const end = Math.min(currentPage * currentLimit, totalRows);
      info.textContent = `Showing ${start}-${end} of ${totalRows} entries`;
    }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9">No expenses found for this view.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((expense) => `
      <tr>
        <td>${escapeHtml(formatShortDate(expense.expense_date))}</td>
        <td>
          <strong>${escapeHtml(expense.supplier_name || '-')}</strong><br>
          <span class="muted-text">${escapeHtml(expense.description || '-')}</span>
        </td>
        <td>${escapeHtml(expense.category || '-')}</td>
        <td>${escapeHtml(expense.invoice_no || '-')}</td>
        <td>${escapeHtml(formatMoney(expense.amount_ex_gst))}</td>
        <td>${escapeHtml(formatMoney(expense.gst_amount))}</td>
        <td><strong>${escapeHtml(formatMoney(expense.total_amount))}</strong></td>
        <td>${staffExpenseStatusBadge(expense.status)}</td>
        <td>${Number(expense.file_count || 0) ? `${escapeHtml(expense.file_count)} attached` : '<span class="muted-text">No file</span>'}</td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="9">Failed to load expenses</td></tr>';
  }
}

function setPermissionVisibility(selector, allowed) {
  document.querySelectorAll(selector).forEach((el) => {
    if (el.classList.contains('page-section')) {
      if (!allowed) el.classList.add('hidden-section');
      return;
    }

    el.classList.toggle('hidden-section', !allowed);
  });
}

function toDateOnly(value) {
  return value ? String(value).slice(0, 10) : '';
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function weekRangeFor(value) {
  const d = new Date(`${toDateOnly(value)}T00:00:00`);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  const end = addDays(start, 6);

  return {
    key: start.toISOString().slice(0, 10),
    label: `${formatShortDate(start)} to ${formatShortDate(end)}`
  };
}

function monthRangeFor(value) {
  const d = new Date(`${toDateOnly(value)}T00:00:00`);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);

  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
    range: `${formatShortDate(start)} to ${formatShortDate(end)}`
  };
}

function groupRows(rows, rangeFactory) {
  const groups = new Map();

  rows.forEach((row) => {
    const range = rangeFactory(row.work_date || row.clock_in);

    if (!groups.has(range.key)) {
      groups.set(range.key, { ...range, rows: [], totalHours: 0 });
    }

    const group = groups.get(range.key);
    group.rows.push(row);
    group.totalHours += Number(row.total_hours || 0);
  });

  return Array.from(groups.values())
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((group) => ({ ...group, totalHours: Number(group.totalHours.toFixed(2)) }));
}

function renderGroupedTimesheets(container, groups, type) {
  if (!container) return;

  if (!groups.length) {
    container.innerHTML = `<div class="empty-state">Your ${type} timesheet history will appear here after your first shift.</div>`;
    return;
  }

  container.innerHTML = groups.map((group) => `
    <section class="timesheet-group">
      <div class="timesheet-group-head">
        <div>
          <h3>${escapeHtml(type === 'monthly' ? group.label : `Week: ${group.label}`)}</h3>
          <p>${escapeHtml(type === 'monthly' ? `Month timesheet from ${group.range}` : `This timesheet is from ${group.label}`)}</p>
        </div>
        <div class="timesheet-total">${escapeHtml(group.totalHours.toFixed(2))} hrs</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Clock In</th>
              <th>Clock Out</th>
              <th>Total Hours</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${group.rows.map((row) => `
              <tr>
                <td>${escapeHtml(formatShortDate(row.work_date || row.clock_in))}</td>
                <td>${escapeHtml(formatDateTime(row.clock_in))}</td>
                <td>${escapeHtml(formatDateTime(row.clock_out))}</td>
                <td>${escapeHtml(Number(row.total_hours || 0).toFixed(2))}</td>
                <td>${escapeHtml(row.notes || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `).join('');
}

function isSuccessfulActionMessage(message) {
  const text = String(message || '');
  const hasSuccessSignal = /\b(successfully|saved|updated|created|submitted|sent|deleted|approved|published|recorded|completed|processed|ready)\b/i.test(text);
  const hasFailureSignal = /\b(failed|failure|error|unable|unavailable|offline|missing|required|denied|not sent|could not|did not)\b/i.test(text);
  return hasSuccessSignal && !hasFailureSignal;
}

function showSuccessConfirmation(message) {
  let popup = document.getElementById('actionSuccessPopup');
  if (!popup) {
    popup = document.createElement('section');
    popup.id = 'actionSuccessPopup';
    popup.className = 'action-success-popup';
    popup.setAttribute('role', 'status');
    popup.setAttribute('aria-live', 'polite');
    popup.innerHTML = `
      <div class="action-success-icon" aria-hidden="true">&#10003;</div>
      <div class="action-success-copy"><strong>Completed</strong><span></span></div>
      <button type="button" class="action-success-close" aria-label="Close confirmation">&#215;</button>
    `;
    popup.querySelector('.action-success-close').onclick = () => popup.classList.remove('show');
    document.body.appendChild(popup);
  }

  popup.querySelector('.action-success-copy span').textContent = String(message || 'Action completed successfully');
  popup.classList.remove('show');
  requestAnimationFrame(() => popup.classList.add('show'));
  clearTimeout(window.__actionSuccessTimer);
  window.__actionSuccessTimer = setTimeout(() => popup.classList.remove('show'), 4600);
}

function showToast(message) {
  if (isSuccessfulActionMessage(message)) {
    showSuccessConfirmation(message);
    return;
  }

  const toast = document.getElementById('toast');

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

function showAppNotificationBanner(title, body, variant = 'info') {
  let banner = document.getElementById('appNotificationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'appNotificationBanner';
    banner.className = 'app-notification-banner';
    banner.innerHTML = `
      <div class="app-notification-icon">VV</div>
      <div class="app-notification-copy">
        <strong></strong>
        <span></span>
      </div>
    `;
    document.body.appendChild(banner);
  }

  banner.className = `app-notification-banner ${variant}`;
  banner.querySelector('strong').textContent = title || 'Voxel Veda';
  banner.querySelector('span').textContent = body || '';
  banner.classList.add('show');
  clearTimeout(window.__voxelBannerTimer);
  window.__voxelBannerTimer = setTimeout(() => banner.classList.remove('show'), 5200);
}

function sendNativeMobileNotification(title, body) {
  if (!window.VoxelVedaNative || typeof window.VoxelVedaNative.notify !== 'function') return false;
  window.VoxelVedaNative.notify(String(title || 'Voxel Veda'), String(body || 'New operation alert'));
  return true;
}

function showStaffDialog(title, bodyHtml, onPrimary, primaryText = 'Save') {
  const backdrop = document.getElementById('staffDialogBackdrop');
  const titleEl = document.getElementById('staffDialogTitle');
  const bodyEl = document.getElementById('staffDialogBody');
  const primaryBtn = document.getElementById('staffDialogPrimaryBtn');

  if (!backdrop || !titleEl || !bodyEl || !primaryBtn) return;

  titleEl.innerText = title;
  bodyEl.innerHTML = bodyHtml;
  primaryBtn.innerText = primaryText;
  primaryBtn.onclick = onPrimary || null;
  primaryBtn.style.display = typeof onPrimary === 'function' ? 'inline-block' : 'none';
  document.body.classList.add('staff-dialog-open');
  backdrop.classList.add('active');
}

function hideStaffDialog() {
  stopShiftQrScanner();
  document.body.classList.remove('staff-dialog-open', 'shift-qr-dialog-open');
  document.getElementById('staffDialogBackdrop')?.classList.remove('shift-qr-dialog-backdrop');
  document.querySelector('#staffDialogBackdrop .dialog-panel')?.classList.remove('shift-qr-dialog-panel');
  document.getElementById('staffDialogBackdrop')?.classList.remove('active');
}

function closeStaffDialog(event) {
  if (event?.target?.id === 'staffDialogBackdrop') hideStaffDialog();
}

function pickMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

function dailyMessage(messages, purpose = 'shift') {
  const today = new Date();
  const key = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}-${purpose}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash * 31) + key.charCodeAt(i)) % 100000;
  }
  return messages[hash % messages.length];
}

function initialsFromName(name, fallback = 'V') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

async function sendShiftNotification(title, body) {
  if (sendNativeMobileNotification(title, body)) return;
  showAppNotificationBanner(title, body, 'success');
  const allowed = await requestNotificationPermission();

  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png?v=20260703-brand'
  });
}

async function sendStaffNotification(title, body) {
  if (sendNativeMobileNotification(title, body)) return;
  showAppNotificationBanner(title, body, 'info');
  const allowed = await requestNotificationPermission();
  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png?v=20260703-brand'
  });
}

function installAccessDeniedHandler() {
  if (window.__voxelAccessDeniedInstalled) return;
  window.__voxelAccessDeniedInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    if (res.status === 403) {
      res.clone().json().then((data) => {
        if (data?.accessDenied) {
          const message = data.message || "You don't have access to input or change data in this section. Please contact admin.";
          showToast(message);
          sendStaffNotification('Access not enabled', message);
        }
      }).catch(() => {});
    }
    return res;
  };
}

function announcementBadgeClass(priority) {
  const clean = String(priority || 'normal').toLowerCase();
  if (clean === 'urgent') return 'badge danger-badge';
  if (clean === 'high') return 'badge active-badge';
  return 'badge';
}

function renderAnnouncements(rows) {
  const list = document.getElementById('announcementList');
  const panel = document.getElementById('announcementPanel');
  if (!list) return;

  if (!rows.length) {
    panel?.classList.add('hidden-section');
    list.innerHTML = '';
    return;
  }

  panel?.classList.remove('hidden-section');
  list.innerHTML = rows.map((item) => `
    <div class="mobile-card announcement-card">
      <div class="section-head">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.message)}</p>
        </div>
        <span class="${announcementBadgeClass(item.priority)}">${escapeHtml(item.priority || 'normal')}</span>
      </div>
      <p class="muted-text">Visible until ${escapeHtml(formatShortDate(item.expires_at))}</p>
    </div>
  `).join('');
}

async function notifyNewAnnouncements(rows) {
  const currentIds = new Set(rows.map((item) => Number(item.id)));

  if (!firstAnnouncementLoad) {
    const newItems = rows.filter((item) => !lastAnnouncementIds.has(Number(item.id)));
    for (const item of newItems) {
      showToast(`New announcement: ${item.title}`);
      await sendStaffNotification(item.title, item.message);
    }
  }

  lastAnnouncementIds = currentIds;
  firstAnnouncementLoad = false;
}

async function loadAnnouncements() {
  const list = document.getElementById('announcementList');
  if (!list) return;

  try {
    const res = await fetch('/api/tasks/announcements/my', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      document.getElementById('announcementPanel')?.classList.add('hidden-section');
      list.innerHTML = '';
      return;
    }

    const rows = data.announcements || [];
    renderAnnouncements(rows);
    await notifyNewAnnouncements(rows);
  } catch {
    document.getElementById('announcementPanel')?.classList.add('hidden-section');
    list.innerHTML = '';
  }
}


function staffAutoClockNote(note) {
  return /(^|\s)A(\s|$)|auto clock-out after 12 hours/i.test(String(note || ''));
}

async function checkAutoClockOutNotification(attendance) {
  if (!attendance?.clock_in || !attendance.clock_out || !staffAutoClockNote(attendance.notes)) return;
  const reminderKey = String(attendance.id || attendance.clock_out || attendance.clock_in);
  if (localStorage.getItem('twelveHourAutoClockOutAttendanceId') === reminderKey) return;

  localStorage.setItem('twelveHourAutoClockOutAttendanceId', reminderKey);
  const message = 'Your shift reached 12 hours and was closed automatically.';
  showToast(message);
  showShiftDialog(
    'Shift Auto Closed',
    message,
    'Please review your timesheet and contact admin if anything needs correction.'
  );
  await sendShiftNotification('Shift auto clocked-out', message);
}

async function checkTenHourReminder(attendance) {
  if (!attendance?.clock_in || attendance.clock_out) {
    tenHourReminderShown = false;
    localStorage.removeItem('tenHourReminderAttendanceId');
    return;
  }

  const clockInTime = new Date(attendance.clock_in).getTime();
  const elapsedMinutes = Math.floor((Date.now() - clockInTime) / 60000);
  const reminderKey = String(attendance.id || attendance.clock_in);

  if (
    elapsedMinutes >= 600 &&
    elapsedMinutes < 720 &&
    localStorage.getItem('tenHourReminderAttendanceId') !== reminderKey
  ) {
    tenHourReminderShown = true;
    localStorage.setItem('tenHourReminderAttendanceId', reminderKey);
    showToast('You have completed 10 hours. Please remember to clock out when your shift is finished.');
    showShiftDialog(
      '10 Hour Shift Reminder',
      'You have completed 10 hours. Please wrap up safely and remember to clock out when your shift is finished.',
      'Your shift will auto clock-out at 12 hours if it is still open.'
    );
    await sendShiftNotification(
      '10 hour shift reminder',
      'You are still clocked in. Please clock out when your shift is finished.'
    );
    return;
  }

  if (tenHourReminderShown && elapsedMinutes >= 720) {
    tenHourReminderShown = false;
  }
}

function showShiftDialog(title, message, subtext) {
  const dialog = document.getElementById('shiftDialog');
  const titleEl = document.getElementById('shiftTitle');
  const messageEl = document.getElementById('shiftMessage');
  const subtextEl = document.getElementById('shiftSubtext');

  if (!dialog || !titleEl || !messageEl || !subtextEl) {
    showToast(message);
    return;
  }

  titleEl.innerText = title;
  messageEl.innerText = message;
  subtextEl.innerText = subtext;
  dialog.classList.add('active');
}

function updateShiftButtons(attendance) {
  const clockInBtn = document.getElementById('clockInBtn');
  const clockOutBtn = document.getElementById('clockOutBtn');
  const isClockedIn = Boolean(attendance?.clock_in && !attendance?.clock_out);
  currentShiftIsOpen = isClockedIn;

  if (clockInBtn) {
    clockInBtn.style.display = isClockedIn ? 'none' : 'inline-block';
  }

  if (clockOutBtn) {
    clockOutBtn.style.display = isClockedIn ? 'inline-block' : 'none';
  }
}

function openMissionShiftScanner() {
  openShiftQrScanner(currentShiftIsOpen ? 'out' : 'in');
}

function stopShiftQrScanner() {
  document.getElementById('shiftQrVideo')?.classList.remove('camera-active');
  if (shiftQrScannerTimer) {
    clearInterval(shiftQrScannerTimer);
    shiftQrScannerTimer = null;
  }

  if (shiftQrScannerStream) {
    shiftQrScannerStream.getTracks().forEach((track) => track.stop());
    shiftQrScannerStream = null;
  }
}

function normalizeShiftQrToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    return parsed.searchParams.get('shift_qr_token')
      || parsed.searchParams.get('qr_token')
      || parsed.searchParams.get('token')
      || raw;
  } catch (_) {
    return raw;
  }
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function getShiftQrDecoder() {
  if ('BarcodeDetector' in window) {
    return {
      type: 'native',
      detector: new BarcodeDetector({ formats: ['qr_code'] })
    };
  }

  if (!shiftQrDecoderPromise) {
    shiftQrDecoderPromise = loadExternalScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js');
  }

  await shiftQrDecoderPromise;

  if (typeof window.jsQR !== 'function') {
    throw new Error('QR decoder unavailable');
  }

  return { type: 'canvas' };
}

async function detectShiftQr(video, decoder) {
  if (decoder.type === 'native') {
    const codes = await decoder.detector.detect(video);
    return codes?.[0]?.rawValue || '';
  }

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (!width || !height) return '';

  shiftQrScannerCanvas ||= document.createElement('canvas');
  shiftQrScannerCanvas.width = width;
  shiftQrScannerCanvas.height = height;
  const ctx = shiftQrScannerCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
  return code?.data || '';
}

async function openShiftQrCameraStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
  } catch (err) {
    video.classList.remove('camera-active');
    const message = String(err?.name || err?.message || '').toLowerCase();
    if (message.includes('notfound') || message.includes('overconstrained') || message.includes('constraint')) {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw err;
  }
}

function setShiftQrPermissionActions(visible) {
  const actions = document.getElementById('shiftQrPermissionActions');
  if (actions) actions.classList.toggle('hidden-section', !visible);
}

async function startShiftQrCamera(mode) {
  const statusEl = document.getElementById('shiftQrScanStatus');
  const video = document.getElementById('shiftQrVideo');

  if (!video) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    if (statusEl) statusEl.innerText = 'Camera unavailable.';
    setShiftQrPermissionActions(true);
    return;
  }

  try {
    stopShiftQrScanner();
    setShiftQrPermissionActions(false);
    if (statusEl) statusEl.innerText = 'Requesting camera access...';
    shiftQrScannerStream = await openShiftQrCameraStream();
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.classList.remove('camera-active');
    video.srcObject = shiftQrScannerStream;
    await video.play();
    video.classList.add('camera-active');

    if (statusEl) statusEl.innerText = 'Calibrating scanner...';
    const decoder = await getShiftQrDecoder();
    setShiftQrPermissionActions(false);
    if (statusEl) statusEl.innerText = 'Scanning live QR...';

    shiftQrScannerTimer = setInterval(async () => {
      try {
        const value = await detectShiftQr(video, decoder);
        if (!value) return;
        stopShiftQrScanner();
        if (statusEl) statusEl.innerText = 'Verifying secure token...';
        await submitShiftQr(mode, normalizeShiftQrToken(value));
      } catch (_) {
        if (statusEl) statusEl.innerText = 'Scanning live QR...';
      }
    }, 650);
  } catch (err) {
    video.classList.remove('camera-active');
    const message = String(err?.name || err?.message || '').toLowerCase();
    if (statusEl) {
      if (message.includes('notallowed') || message.includes('permission')) {
        statusEl.innerText = 'Camera permission is required for QR verification.';
        setShiftQrPermissionActions(true);
      } else if (message.includes('decoder') || message.includes('script')) {
        statusEl.innerText = 'QR decoder unavailable.';
        setShiftQrPermissionActions(true);
      } else {
        statusEl.innerText = 'Scanner offline.';
        setShiftQrPermissionActions(true);
      }
    }
  }
}

function openShiftQrScanner(mode) {
  activeShiftQrMode = mode === 'out' ? 'out' : 'in';

  showStaffDialog(``, `
    <div class="shift-scan-panel simple-shift-scanner vv-plain-qr-scanner">
      <div class="shift-scan-camera" aria-label="Live QR camera preview">
        <video id="shiftQrVideo" autoplay playsinline webkit-playsinline muted></video>
        <div class="shift-scan-reticle"></div>
      </div>
      <strong id="shiftQrScanStatus" class="shift-scan-status-text">Opening camera...</strong>
      <div id="shiftQrPermissionActions" class="shift-camera-actions hidden-section">
        <button class="primary-btn" type="button" onclick="startShiftQrCamera(activeShiftQrMode)">Allow Camera</button>
      </div>
    </div>
  `);

  document.body.classList.add('shift-qr-dialog-open');
  document.getElementById('staffDialogBackdrop')?.classList.add('shift-qr-dialog-backdrop');
  document.querySelector('#staffDialogBackdrop .dialog-panel')?.classList.add('shift-qr-dialog-panel');
  startShiftQrCamera(activeShiftQrMode);
}

async function submitAuthorizedShiftException() {
  if (!canUseQrException()) {
    showToast('Authorized exception is not enabled for your account.');
    return;
  }
  await submitShiftQr(activeShiftQrMode, '');
}

async function submitShiftQr(mode, qrToken) {
  const ok = mode === 'out'
    ? await clockOut(qrToken)
    : await clockIn(qrToken);

  if (ok) hideStaffDialog();
}

function hideShiftDialog() {
  document.getElementById('shiftDialog')?.classList.remove('active');
}

function closeShiftDialog(event) {
  if (event?.target?.id === 'shiftDialog') hideShiftDialog();
}

/* ================= NAVIGATION ================= */

function setupStaffNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;

      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.page-section').forEach((section) => {
        section.classList.add('hidden-section');
      });

      document.getElementById(target)?.classList.remove('hidden-section');

      if (target === 'staffRfqSection') loadStaffRfqs();
      if (target === 'staffInvoiceSection') loadStaffInvoices();
      if (target === 'staffCustomerSection') loadStaffCustomers();
      if (target === 'staffSupplierSection') loadStaffSuppliers();
      if (target === 'stockInSection') loadStaffStock();
      if (target === 'stockOutSection') loadStaffStockOut();
      if (target === 'rawMaterialSection') loadStaffMaterials('raw_material');
      if (target === 'packagingSection') loadStaffMaterials('packaging');
      if (target === 'staffExpenseSection') loadStaffExpenses(1);
      if (target === 'staffComplianceSection') loadStaffCompliance();
      if (target === 'staffCompetitorSection') loadStaffCompetitors();
      if (target === 'meetingsSection') loadMyMeetings();
      if (target === 'rosterSection') loadMyRoster();
      toggleMobileMenu(false);
    });
  });
}

function goStaffSection(sectionId) {
  document.querySelector(`[data-section="${sectionId}"]`)?.click();
}

async function refreshGrantedStaffData() {
  const jobs = [];
  if (hasPermission('rfqs')) jobs.push(loadStaffRfqs());
  if (hasPermission('invoices')) jobs.push(loadStaffInvoices());
  if (hasPermission('customers')) jobs.push(loadStaffCustomers());
  if (hasPermission('suppliers')) jobs.push(loadStaffSuppliers());
  if (hasPermission('stock_in')) jobs.push(loadStaffStock());
  if (hasPermission('stock_out')) jobs.push(loadStaffStockOut());
  if (hasPermission('raw_material')) jobs.push(loadStaffMaterials('raw_material'));
  if (hasPermission('packaging')) jobs.push(loadStaffMaterials('packaging'));
  if (hasPermission('expenses')) jobs.push(loadStaffExpenses(staffExpensePage));
  if (hasPermission('compliance')) jobs.push(loadStaffCompliance());
  if (hasPermission('competitors')) jobs.push(loadStaffCompetitors());
  if (hasPermission('meetings')) jobs.push(loadMyMeetings());
  if (hasPermission('roster')) jobs.push(loadMyRoster());
  await Promise.allSettled(jobs);
}

async function refreshVisibleStaffSection() {
  const visible = Array.from(document.querySelectorAll('.page-section'))
    .find((section) => !section.classList.contains('hidden-section'));
  const id = visible?.id;

  if (id === 'staffRfqSection') return loadStaffRfqs();
  if (id === 'staffInvoiceSection') return loadStaffInvoices();
  if (id === 'staffCustomerSection') return loadStaffCustomers();
  if (id === 'staffSupplierSection') return loadStaffSuppliers();
  if (id === 'rawMaterialSection') return loadStaffMaterials('raw_material');
  if (id === 'packagingSection') return loadStaffMaterials('packaging');
  if (id === 'staffComplianceSection') return loadStaffCompliance();
  if (id === 'staffCompetitorSection') return loadStaffCompetitors();
  if (id === 'stockInSection') return loadStaffStock();
  if (id === 'stockOutSection') return loadStaffStockOut();
  if (id === 'staffExpenseSection') return loadStaffExpenses(staffExpensePage);
  return Promise.resolve();
}

function openStaffViewFromUrl() {
  const view = new URLSearchParams(window.location.search).get('view');
  if (!view) return;
  const sections = {
    rfqs: 'staffRfqSection', invoices: 'staffInvoiceSection', customers: 'staffCustomerSection',
    suppliers: 'staffSupplierSection', stock: 'stockInSection', 'stock-in': 'stockInSection',
    'stock-out': 'stockOutSection', 'raw-material': 'rawMaterialSection', packaging: 'packagingSection',
    expenses: 'staffExpenseSection', workforce: 'timesheetSection', timesheets: 'timesheetSection',
    roster: 'rosterSection', meetings: 'meetingsSection', tasks: 'tasksSection',
    compliance: 'staffComplianceSection', competitors: 'staffCompetitorSection',
    forms: 'formsSection', settings: 'profileSection'
  };
  if (sections[view]) window.setTimeout(() => goStaffSection(sections[view]), 0);
}

/* ================= STAFF INFO ================= */

async function loadStaffInfo() {
  const staffInfo = document.getElementById('staffInfo');
  const sidebarStaffName = document.getElementById('sidebarStaffName');

  if (!staffInfo) return;

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      staffInfo.innerText = data.message || 'Failed to load user';
      if (sidebarStaffName) sidebarStaffName.innerText = 'Staff';
      return null;
    }

    const role = String(data.user.role || '').trim().toLowerCase();
    const user = { ...data.user, role };

    currentUser = user;
    currentRole = role;
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('role', role);
    applyPermissionUI();
    loadWorkHubModules();

    if (role === 'admin') {
      window.location.href = '/admin';
      return null;
    }

    staffInfo.innerText = `${user.name} | ${user.email} | ${role}`;

    if (sidebarStaffName) {
      sidebarStaffName.innerText = user.name || 'Staff User';
    }

    renderStaffProfile(user);

    if (hasPermission('stock')) {
      await loadStaffStock();
      await loadStaffStockOut();
    }

    return user;
  } catch {
    if (!redirectingToLogin) {
      staffInfo.innerText = 'Server error loading staff info';
      if (sidebarStaffName) sidebarStaffName.innerText = 'Staff';
    }
    return null;
  }
}

function renderStaffProfile(user) {
  const displayName = user.name || 'Staff User';
  const username = user.username || user.email || 'staff';
  const roleLabel = titleCase(user.role || 'staff');
  const initials = initialsFromName(displayName);

  const mappings = {
    profileName: displayName,
    profileFullName: displayName,
    profileUsername: `@${username}`,
    profileEmail: user.email || '-',
    profileRole: roleLabel,
    profileRoleBadge: roleLabel,
    sidebarProfileName: displayName,
    sidebarProfileUsername: `@${username}`,
    sidebarProfileRole: roleLabel
  };

  Object.entries(mappings).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });

  document.querySelectorAll('#profileAvatar, #sidebarAvatar').forEach((el) => {
    el.textContent = initials;
  });
}

/* ================= TASKS ================= */

function taskDisplayStatus(task) {
  const due = task.due_date ? String(task.due_date).slice(0, 10) : '';
  const status = String(task.status || 'pending').toLowerCase();

  if (status !== 'done' && due && due < todayISO()) {
    return 'overdue';
  }

  return status;
}

function taskBadgeClass(status) {
  if (status === 'done') return 'badge';
  if (status === 'overdue') return 'badge danger-badge';
  if (status === 'in_progress') return 'badge active-badge';
  return 'badge';
}

function buildTaskCard(task) {
  const status = taskDisplayStatus(task);
  const due = task.due_date ? String(task.due_date).slice(0, 10) : '-';

  let actions = '';

  if (status !== 'done') {
    actions += `
      <button class="secondary-btn" onclick="updateMyTaskStatus(${task.id}, 'in_progress')">
        Start / In Progress
      </button>

      <button class="primary-btn" onclick="updateMyTaskStatus(${task.id}, 'done')">
        Mark Done
      </button>

      <button class="secondary-btn" onclick="updateMyTaskStatus(${task.id}, 'pending')">
        Not Complete
      </button>
    `;
  } else {
    actions += `<span class="badge">Completed</span>`;
  }

  return `
    <div class="mobile-card">
      <h3>${escapeHtml(task.title)}</h3>
      <p><strong>Description:</strong> ${escapeHtml(task.description || '-')}</p>
      <p><strong>Priority:</strong> ${escapeHtml(task.priority || 'medium')}</p>
      <p><strong>Due Date:</strong> ${escapeHtml(due)}</p>
      <span class="${taskBadgeClass(status)}">${escapeHtml(status)}</span>

      <div class="card-actions">
        ${actions}
      </div>
    </div>
  `;
}

function updateTaskCounters(tasks) {
  const todayCountEl = document.getElementById('todayTaskCount');
  const overdueCountEl = document.getElementById('overdueTaskCount');
  const alertDueEl = document.getElementById('taskAlertDueCount');
  const alertOverdueEl = document.getElementById('taskAlertOverdueCount');

  const today = todayISO();

  const todayCount = tasks.filter((task) => {
    const due = task.due_date ? String(task.due_date).slice(0, 10) : '';
    return due === today && String(task.status || '').toLowerCase() !== 'done';
  }).length;

  const overdueCount = tasks.filter((task) => taskDisplayStatus(task) === 'overdue').length;

  if (todayCountEl) todayCountEl.innerText = todayCount;
  if (overdueCountEl) overdueCountEl.innerText = overdueCount;
  if (alertDueEl) alertDueEl.innerText = todayCount;
  if (alertOverdueEl) alertOverdueEl.innerText = overdueCount;
  setText('staffMissionStatus', overdueCount > 0
    ? `${overdueCount} overdue task${overdueCount === 1 ? '' : 's'} need priority attention.`
    : todayCount > 0
      ? `${todayCount} task${todayCount === 1 ? '' : 's'} due today. Keep the flow moving.`
      : 'No urgent task pressure. Stay ready for new work updates.');

  const alertBtn = document.querySelector('.staff-task-alert');
  if (alertBtn) {
    alertBtn.classList.toggle('has-overdue', overdueCount > 0);
    alertBtn.classList.toggle('has-due', todayCount > 0);
  }
}

function notifyNewTasks(tasks) {
  const currentIds = new Set(tasks.map((task) => Number(task.id)));

  if (!firstTaskLoad) {
    const newTasks = tasks.filter((task) => !lastTaskIds.has(Number(task.id)));

    if (newTasks.length > 0) {
      showToast(`${newTasks.length} new task assigned`);
      const firstTask = newTasks[0];
      sendStaffNotification('New task assigned', firstTask.title || 'A new task has been assigned to you.');
    }
  }

  lastTaskIds = currentIds;
  firstTaskLoad = false;
}

async function loadMyTasks() {
  const list = document.getElementById('taskList');

  if (!list) return;

  try {
    const res = await fetch('/api/tasks/my', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Failed to load tasks')}</div>`;
      return;
    }

    const tasks = data.tasks || [];

    updateTaskCounters(tasks);
    notifyNewTasks(tasks);

    if (!tasks.length) {
      list.innerHTML = `<div class="empty-state">You do not have any assigned tasks yet.</div>`;
      return;
    }

    list.innerHTML = tasks.map(buildTaskCard).join('');
  } catch {
    list.innerHTML = `<div class="empty-state">Server error loading tasks.</div>`;
  }
}

async function updateMyTaskStatus(taskId, status) {
  try {
    const res = await fetch('/api/tasks/status', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        task_id: taskId,
        status
      })
    });

    const data = await safeJson(res);

    if (!res.ok) {
      showToast(data.message || 'Task update failed');
      return;
    }

    showToast(data.message || 'Task updated');

    await loadMyTasks();
  } catch {
    showToast('Task update failed');
  }
}

/* ================= STOCK ================= */

function updateStaffStockMetrics(rows) {
  const valueEl = document.getElementById('staffStockValue');
  const unitsEl = document.getElementById('staffStockUnits');
  const lowEl = document.getElementById('staffLowStockCount');

  const totalValue = rows.reduce((sum, item) => sum + Number(item.current_value || 0), 0);
  const totalUnits = rows.reduce((sum, item) => sum + Number(item.current_unit_qty || 0), 0);
  const lowCount = rows.filter((item) => Number(item.current_unit_qty || 0) <= 5).length;

  if (valueEl) valueEl.innerText = formatMoney(totalValue);
  if (unitsEl) unitsEl.innerText = String(totalUnits);
  if (lowEl) lowEl.innerText = String(lowCount);
}

async function loadStaffStock() {
  if (!hasPermission('stock_in')) return;

  const tbody = document.getElementById('staffStockTableBody');
  if (!tbody) return;
  const canEditStockIn = canInput('stock_in');
  const canIssueStock = canInput('stock_out');

  const search = document.getElementById('staffStockSearch')?.value.trim() || '';
  const res = await fetch(`/api/stock?search=${encodeURIComponent(search)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(data.message || 'Failed to load stock')}</td></tr>`;
    return;
  }

  const rows = data.stock || [];
  staffStockCache = rows;
  updateStaffStockMetrics(rows);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9">No stock items yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(formatShortDate(item.created_at))}</td>
      <td>
        <strong>${escapeHtml(item.product_name)}</strong><br>
        <span class="muted-text">${escapeHtml(item.category || '-')}</span>
      </td>
      <td>
        <strong>${escapeHtml(item.batch_code || '-')}</strong><br>
        <span>Received: ${escapeHtml(formatShortDate(item.manufacture_date))}</span>
      </td>
      <td>${escapeHtml(item.unit_qty || 0)} pcs</td>
      <td>
        <strong>${escapeHtml(item.current_unit_qty || 0)} pcs</strong><br>
        <span class="muted-text">Issued: ${escapeHtml(item.issued_unit_qty || 0)}</span>
      </td>
      <td>${escapeHtml(formatMoney(item.unit_price))}</td>
      <td><strong>${escapeHtml(formatMoney(item.current_value))}</strong></td>
      <td>
        <strong>Created: ${escapeHtml(item.created_by_name || '-')}</strong><br>
        <span>Updated: ${escapeHtml(item.updated_by_name || '-')}</span>
      </td>
      <td>
        ${canEditStockIn ? `<button class="icon-btn" onclick="openStaffStockDialog(${item.id})">Edit</button>` : ''}
        ${canIssueStock ? `<button class="icon-btn" onclick="openStaffStockOutDialog(${item.id})">Out</button>` : ''}
        ${!canEditStockIn && !canIssueStock ? '<span class="muted-text">View only</span>' : ''}
      </td>
    </tr>
  `).join('');
}

function openStaffStockDialog(stockId = null) {
  if (!canInput('stock_in')) {
    showToast("You don't have access to add or edit stock in. Please contact admin.");
    return;
  }

  const item = staffStockCache.find((row) => Number(row.id) === Number(stockId)) || {};

  showStaffDialog(
    stockId ? 'Edit Stock In' : 'Add Stock In',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Part Identity</h4>
          <input id="staffStockProductName" placeholder="Part / Product Name" value="${escapeHtml(item.product_name || '')}" />
          <input id="staffStockCategory" placeholder="Category / Material" value="${escapeHtml(item.category || '')}" />
          <div class="split-grid">
            <input id="staffStockDate" type="date" value="${escapeHtml(formatShortDate(item.manufacture_date) === '-' ? todayISO() : String(item.manufacture_date || '').slice(0, 10))}" />
            <input id="staffStockBatch" placeholder="Reference / Batch Number" value="${escapeHtml(item.batch_code || '')}" />
          </div>
        </div>
        <div class="dialog-card">
          <h4>Quantity & Value</h4>
          <div class="split-grid">
            <input id="staffStockQty" type="number" min="0" placeholder="Unit Quantity" value="${escapeHtml(item.unit_qty || 0)}" oninput="updateStaffStockTotalPreview()" />
            <input id="staffStockPrice" type="number" min="0" step="0.01" placeholder="Unit Price" value="${escapeHtml(item.unit_price || 0)}" oninput="updateStaffStockTotalPreview()" />
          </div>
          <p class="muted-text">Calculated stock value: <strong id="staffStockTotalPreview">${escapeHtml(formatMoney(Number(item.unit_qty || 0) * Number(item.unit_price || 0)))}</strong></p>
          ${stockId ? `<p class="muted-text">Available now: <strong>${escapeHtml(item.current_unit_qty || 0)} pcs</strong></p>` : ''}
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: item.id,
        product_name: document.getElementById('staffStockProductName')?.value.trim(),
        category: document.getElementById('staffStockCategory')?.value.trim(),
        manufacture_date: document.getElementById('staffStockDate')?.value,
        batch_code: document.getElementById('staffStockBatch')?.value.trim(),
        unit_qty: Number(document.getElementById('staffStockQty')?.value || 0),
        unit_price: Number(document.getElementById('staffStockPrice')?.value || 0)
      };

      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Stock save failed');
        return;
      }

      hideStaffDialog();
      showToast(data.message || 'Stock saved');
      await loadStaffStock();
      await loadStaffStockOut();
    },
    stockId ? 'Update Stock' : 'Save Stock'
  );
}

function updateStaffStockTotalPreview() {
  const qty = Number(document.getElementById('staffStockQty')?.value || 0);
  const price = Number(document.getElementById('staffStockPrice')?.value || 0);
  const preview = document.getElementById('staffStockTotalPreview');
  if (preview) preview.textContent = formatMoney(qty * price);
}

async function loadStaffStockOut() {
  if (!hasPermission('stock_out')) return;

  const tbody = document.getElementById('staffStockOutTableBody');
  if (!tbody) return;
  const canEditStockOut = canInput('stock_out');

  const res = await fetch('/api/stock/movements', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(data.message || 'Failed to load stock out')}</td></tr>`;
    return;
  }

  const rows = data.movements || [];
  staffStockOutCache = rows;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9">No stock out entries yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(formatShortDate(item.created_at))}</td>
      <td>
        <strong>${escapeHtml(item.product_name || '-')}</strong><br>
        <span class="muted-text">${escapeHtml(item.batch_code || '-')}</span>
      </td>
      <td><strong>${escapeHtml(item.quantity || 0)} pcs</strong></td>
      <td>${escapeHtml(formatMoney(item.unit_price))}</td>
      <td><strong>${escapeHtml(formatMoney(item.total_price))}</strong></td>
      <td>${escapeHtml(item.issued_to || '-')}</td>
      <td>${escapeHtml(item.notes || '-')}</td>
      <td>${escapeHtml(item.created_by_name || '-')}</td>
      <td>
        ${canEditStockOut ? `<button class="icon-btn" onclick="openStaffStockOutById(${item.id})">Edit</button>` : ''}
        ${canEditStockOut ? `<button class="icon-btn danger-icon" onclick="deleteStaffStockOut(${item.id})">Delete</button>` : ''}
        ${!canEditStockOut ? '<span class="muted-text">View only</span>' : ''}
      </td>
    </tr>
  `).join('');
}

function openStaffStockOutDialog(stockId = null, movement = null) {
  if (!canInput('stock_out')) {
    showToast("You don't have access to issue or edit stock out. Please contact admin.");
    return;
  }

  if (!staffStockCache.length) {
    showToast('Add stock before issuing it');
    return;
  }

  const selectedId = movement ? movement.stock_id : stockId;
  const selected = staffStockCache.find((row) => Number(row.id) === Number(selectedId)) || staffStockCache[0];
  const options = staffStockCache.map((item) => `
    <option value="${item.id}" ${Number(item.id) === Number(selected.id) ? 'selected' : ''}>
      ${escapeHtml(item.product_name)} - ${escapeHtml(item.batch_code || 'No ref')} (${escapeHtml(item.current_unit_qty || 0)} pcs left)
    </option>
  `).join('');

  showStaffDialog(
    movement ? 'Edit Stock Out' : 'Stock Out',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Outgoing Stock</h4>
          <select id="staffOutStockId" onchange="updateStaffOutPreview()">${options}</select>
          <div class="split-grid">
            <input id="staffOutQty" type="number" min="1" placeholder="Quantity out" value="${escapeHtml(movement?.quantity || '')}" oninput="updateStaffOutPreview()" />
            <input id="staffOutTo" placeholder="Sold / Issued To" value="${escapeHtml(movement?.issued_to || '')}" />
          </div>
          <textarea id="staffOutNotes" rows="3" placeholder="Job number, customer, machine, or internal notes">${escapeHtml(movement?.notes || '')}</textarea>
        </div>
        <div class="dialog-card">
          <h4>Batch Deduction</h4>
          <p class="muted-text">Available after selecting: <strong id="staffOutAvailable">-</strong></p>
          <p class="muted-text">Unit price: <strong id="staffOutUnitPrice">-</strong></p>
          <p class="muted-text">Outgoing value: <strong id="staffOutTotal">-</strong></p>
        </div>
      </div>
    `,
    async () => {
      const body = {
        stock_id: Number(document.getElementById('staffOutStockId')?.value || 0),
        quantity: Number(document.getElementById('staffOutQty')?.value || 0),
        issued_to: document.getElementById('staffOutTo')?.value.trim(),
        notes: document.getElementById('staffOutNotes')?.value.trim()
      };

      const res = await fetch(movement ? '/api/stock/movement/update' : '/api/stock/issue', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(movement ? { ...body, id: movement.id } : body)
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Stock out failed');
        return;
      }

      hideStaffDialog();
      showToast(data.message || 'Stock out saved');
      await loadStaffStock();
      await loadStaffStockOut();
    },
    movement ? 'Update Stock Out' : 'Save Stock Out'
  );

  setTimeout(updateStaffOutPreview, 0);
}

function updateStaffOutPreview() {
  const stockId = Number(document.getElementById('staffOutStockId')?.value || 0);
  const qty = Number(document.getElementById('staffOutQty')?.value || 0);
  const item = staffStockCache.find((row) => Number(row.id) === stockId) || {};
  const unitPrice = Number(item.unit_price || 0);

  const availableEl = document.getElementById('staffOutAvailable');
  const unitPriceEl = document.getElementById('staffOutUnitPrice');
  const totalEl = document.getElementById('staffOutTotal');

  if (availableEl) availableEl.textContent = `${item.current_unit_qty || 0} pcs`;
  if (unitPriceEl) unitPriceEl.textContent = formatMoney(unitPrice);
  if (totalEl) totalEl.textContent = formatMoney(qty * unitPrice);
}

function openStaffStockOutById(id) {
  if (!canInput('stock_out')) {
    showToast("You don't have access to edit stock out. Please contact admin.");
    return;
  }

  const movement = staffStockOutCache.find((row) => Number(row.id) === Number(id));
  if (!movement) {
    showToast('Stock out entry not found');
    return;
  }
  openStaffStockOutDialog(movement.stock_id, movement);
}

async function deleteStaffStockOut(id) {
  if (!canInput('stock_out')) {
    showToast("You don't have access to delete stock out entries. Please contact admin.");
    return;
  }

  if (!confirm('Delete this stock out entry and restore quantity?')) return;

  const res = await fetch('/api/stock/movement/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Stock out delete failed');
    return;
  }

  showToast(data.message || 'Stock out deleted');
  await loadStaffStock();
  await loadStaffStockOut();
}

function meetingDaysUntil(dateValue) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${toDateOnly(dateValue)}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function meetingTypeLabel(value) {
  const labels = {
    internal: 'Internal',
    client: 'Client / Customer',
    council: 'Council',
    government: 'Government Body',
    inspection: 'Inspection',
    supplier: 'Supplier',
    conference: 'Conference'
  };
  return labels[value] || value || '-';
}

function renderMyMeetings(rows) {
  const list = document.getElementById('staffMeetingList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">No upcoming meetings or inspections assigned to you.</div>`;
    return;
  }

  list.innerHTML = rows.map((meeting) => {
    const days = meetingDaysUntil(meeting.meeting_date);
    const reminder = days >= 0 && days <= 3
      ? `<span class="badge active-badge">${days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} left`}</span>`
      : `<span class="badge">${escapeHtml(meeting.status || 'scheduled')}</span>`;

    return `
      <div class="mobile-card announcement-card">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(meeting.title)}</h3>
            <p>${escapeHtml(meetingTypeLabel(meeting.meeting_type))}${meeting.organisation ? ` - ${escapeHtml(meeting.organisation)}` : ''}</p>
          </div>
          ${reminder}
        </div>
        <p><strong>When:</strong> ${escapeHtml(formatShortDate(meeting.meeting_date))} at ${escapeHtml(String(meeting.meeting_time || '').slice(0, 5))}</p>
        <p><strong>Where:</strong> ${escapeHtml(meeting.location_details || meeting.location_type || '-')}</p>
        <p><strong>Who to meet:</strong> ${escapeHtml(meeting.contact_person || '-')} ${meeting.contact_details ? `(${escapeHtml(meeting.contact_details)})` : ''}</p>
        <p><strong>Agenda:</strong> ${escapeHtml(meeting.agenda || '-')}</p>
        <p><strong>Prepare:</strong> ${escapeHtml(meeting.required_preparation || '-')}</p>
      </div>
    `;
  }).join('');
}

async function notifyMeetingReminders(rows) {
  for (const meeting of rows) {
    const days = meetingDaysUntil(meeting.meeting_date);
    if (days < 0 || days > 3) continue;

    const todayKey = new Date().toISOString().slice(0, 10);
    const reminderKey = `meetingReminder:${meeting.id}:${todayKey}`;
    if (localStorage.getItem(reminderKey)) continue;

    localStorage.setItem(reminderKey, '1');
    const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
    const message = `${meeting.title} is ${when}. Please prepare required documents and details.`;
    showToast(message);
    await sendStaffNotification('Meeting / inspection reminder', message);
  }
}

async function loadMyMeetings() {
  if (!hasPermission('meetings')) return;

  const list = document.getElementById('staffMeetingList');
  if (!list) return;

  try {
    const res = await fetch('/api/meetings/my', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(res);

    if (!res.ok) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Failed to load meetings')}</div>`;
      return;
    }

    const rows = data.meetings || [];
    staffMeetingCache = rows;
    renderMyMeetings(rows);
    await notifyMeetingReminders(rows);
  } catch {
    list.innerHTML = `<div class="empty-state">Server error loading meetings.</div>`;
  }
}

/* ================= ROSTER ================= */

function rosterShiftHours(shift) {
  const start = shift.start_time || '00:00';
  const end = shift.end_time || '00:00';
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = ((endHour * 60) + endMinute) - ((startHour * 60) + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

function updateStaffRosterMetrics(rows) {
  latestRosterRows = Array.isArray(rows) ? rows : [];
  const next = latestRosterRows[0];
  const rosterHours = latestRosterRows.reduce((sum, row) => sum + rosterShiftHours(row), 0);
  const today = todayISO();
  const todayRows = latestRosterRows.filter((row) => String(row.shift_date || '').slice(0, 10) === today);
  const missingLocation = latestRosterRows.filter((row) => !row.location).length;
  const missingNotes = latestRosterRows.filter((row) => !row.notes).length;
  const scheduleStatus = missingLocation || missingNotes ? 'Review' : 'Ready';

  setText('staffRosterCount', latestRosterRows.length);
  setText('staffRosterHours', rosterHours.toFixed(2));
  setText('staffNextShiftDate', next ? formatShortDate(next.shift_date) : '-');
  setText('staffNextShiftTime', next ? `${next.start_time} - ${next.end_time}` : 'No upcoming shift');
  setText('staffHomeNextShiftDate', next ? formatShortDate(next.shift_date) : '-');
  setText('staffHomeNextShiftTime', next ? `${next.start_time} - ${next.end_time}` : 'No upcoming shift');
  setText('staffRosterTodayCount', `${todayRows.length} shift${todayRows.length === 1 ? '' : 's'}`);
  setText('staffRosterTodaySignal', todayRows.length ? todayRows.map((row) => `${row.start_time} - ${row.end_time}`).join(', ') : 'No shift scheduled today');
  setText('staffRosterComplianceSignal', scheduleStatus);
  setText('staffRosterBudgetSignal', `${rosterHours.toFixed(2)} hrs`);
  updateTimesheetVarianceSignals();
}

function updateTimesheetVarianceSignals(totalHours = null) {
  const recordedEl = document.getElementById('weekHoursCount');
  const recorded = totalHours === null ? Number(recordedEl?.innerText || 0) : Number(totalHours || 0);
  const rostered = latestRosterRows.reduce((sum, row) => sum + rosterShiftHours(row), 0);
  const variance = recorded - rostered;
  setText('timesheetRecordedSignal', `${recorded.toFixed(2)} hrs`);
  setText('staffRosterVarianceSignal', rostered ? `${Math.abs(variance).toFixed(2)} hrs` : 'No roster');
  setText('timesheetVarianceSignal', rostered ? `${variance >= 0 ? '+' : '-'}${Math.abs(variance).toFixed(2)} hrs` : 'No roster');
  setText('timesheetVarianceDetail', rostered ? `${recorded.toFixed(2)} recorded vs ${rostered.toFixed(2)} rostered` : 'Roster sync will appear here');
  if (!currentWeekTimesheet) {
    setText('timesheetPayrollSignal', recorded > 0 ? 'Draft' : 'Open');
  }
}

function timesheetStatusLabel(status) {
  const labels = {
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending Approval',
    CORRECTION_RESUBMITTED: 'Resubmitted',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    CORRECTION_REQUIRED: 'Correction Required',
    ARCHIVED: 'Archived'
  };
  return labels[String(status || 'DRAFT').toUpperCase()] || 'Draft';
}

function renderCurrentTimesheetWorkflow(timesheet, totalHours) {
  currentWeekTimesheet = timesheet || null;
  const status = String(timesheet?.status || 'DRAFT').toUpperCase();
  const statusEl = document.getElementById('currentTimesheetStatus');
  const submitButton = document.getElementById('submitTimesheetBtn');
  const managerNote = document.getElementById('currentTimesheetManagerNote');
  const payrollLabels = {
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Awaiting Approval',
    CORRECTION_RESUBMITTED: 'Awaiting Review',
    APPROVED: String(timesheet?.payroll_status || '').toUpperCase() === 'READY' ? 'Payroll Ready' : 'Approved',
    REJECTED: 'Rejected',
    CORRECTION_REQUIRED: 'Action Required',
    ARCHIVED: 'Archived'
  };

  if (statusEl) {
    statusEl.className = `timesheet-status-chip ${status.toLowerCase()}`;
    statusEl.textContent = timesheetStatusLabel(status);
  }

  if (submitButton) {
    const editable = ['DRAFT', 'CORRECTION_REQUIRED'].includes(status);
    const canSubmit = editable && Number(totalHours || 0) > 0 && Boolean(timesheet?.id);
    submitButton.classList.toggle('hidden-section', !editable);
    submitButton.disabled = !canSubmit;
    submitButton.textContent = status === 'CORRECTION_REQUIRED' ? 'Resubmit Timesheet' : 'Submit Timesheet';
  }

  setText('timesheetPayrollSignal', payrollLabels[status] || 'Open');

  if (managerNote) {
    const note = String(timesheet?.manager_comments || '').trim();
    managerNote.classList.toggle('hidden-section', !note);
    managerNote.innerHTML = note ? `<strong>Manager note:</strong> ${escapeHtml(note)}` : '';
  }
}

async function submitCurrentTimesheet() {
  const timesheet = currentWeekTimesheet;
  if (!timesheet?.id) {
    showToast('Current weekly timesheet is not ready yet.');
    return;
  }
  const status = String(timesheet.status || 'DRAFT').toUpperCase();
  if (!['DRAFT', 'CORRECTION_REQUIRED'].includes(status)) {
    showToast('This timesheet has already been submitted.');
    return;
  }
  if (Number(timesheet.total_hours || 0) <= 0) {
    showToast('Record shift hours before submitting this timesheet.');
    return;
  }
  if (!window.confirm(status === 'CORRECTION_REQUIRED'
    ? 'Resubmit this corrected timesheet for manager approval?'
    : 'Submit this weekly timesheet for manager approval?')) return;

  const button = document.getElementById('submitTimesheetBtn');
  if (button) button.disabled = true;
  try {
    const res = await fetch(`/api/attendance/timesheets/${Number(timesheet.id)}/submit`, {
      method: 'POST',
      headers: authHeaders()
    });
    const data = await safeJson(res);
    showToast(data.message || (res.ok ? 'Timesheet submitted for approval.' : 'Timesheet submission failed.'));
    if (res.ok) await loadTimesheet();
  } catch {
    showToast('Timesheet submission failed. Please try again.');
  } finally {
    if (button && ['DRAFT', 'CORRECTION_REQUIRED'].includes(String(currentWeekTimesheet?.status || '').toUpperCase())) {
      button.disabled = false;
    }
  }
}

function renderMyRoster(rows) {
  const list = document.getElementById('staffRosterList');
  if (!list) return;

  updateStaffRosterMetrics(rows);

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">No rostered shifts are assigned yet.</div>';
    return;
  }

  list.innerHTML = rows.map((shift) => {
    const hours = rosterShiftHours(shift);
    const readiness = shift.location && shift.notes ? 'Ready' : 'Check details';
    return `
      <article class="roster-shift-card roster-shift-pro-card">
        <div class="roster-date-block">
          <strong>${escapeHtml(formatShortDate(shift.shift_date))}</strong>
          <span>${escapeHtml(shift.status || 'scheduled')}</span>
        </div>
        <div class="roster-shift-main">
          <div class="roster-shift-title-row">
            <h3>${escapeHtml(shift.role_label || 'Assigned shift')}</h3>
            <span class="roster-readiness-pill">${escapeHtml(readiness)}</span>
          </div>
          <p>${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)} | ${escapeHtml(hours.toFixed(2))} hrs</p>
          <small>${escapeHtml(shift.location || 'Location not set')}</small>
          <div class="roster-shift-signals">
            <span>Clock QR required</span>
            <span>${hours >= 8 ? 'Break planning advised' : 'Standard shift'}</span>
            <span>Payroll visible after clock-out</span>
          </div>
          ${shift.notes ? `<div class="roster-note">${escapeHtml(shift.notes)}</div>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function loadMyRoster() {
  if (!hasPermission('roster')) return;

  const list = document.getElementById('staffRosterList');
  if (!list) return;

  try {
    const res = await fetch('/api/roster/my', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(res);

    if (!res.ok) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Failed to load roster')}</div>`;
      updateStaffRosterMetrics([]);
      return;
    }

    renderMyRoster(data.roster || []);
  } catch {
    list.innerHTML = '<div class="empty-state">Server error loading roster.</div>';
    updateStaffRosterMetrics([]);
  }
}

/* ================= ATTENDANCE ================= */

async function loadAttendanceStatus() {
  const status = document.getElementById('attendanceStatus');
  if (!status) return;

  try {
    const res = await fetch('/api/attendance/today', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      status.innerText = data.message || 'Attendance unavailable';
      return;
    }

    if (!data.attendance) {
      status.innerText = 'Not clocked in today.';
      setText('staffMissionActionLabel', 'Attendance');
      setText('staffMissionActionText', 'Start Shift');
      setText('staffShiftSubline', 'Ready to start your shift.');
      updateShiftButtons(null);
      await checkTenHourReminder(null);
      return;
    }

    const row = data.attendance;

    status.innerText =
      `Clock In: ${formatDateTime(row.clock_in)} | ` +
      `Clock Out: ${formatDateTime(row.clock_out)} | ` +
      `Hours: ${Number(row.total_hours || 0).toFixed(2)}`;
    const isOpen = Boolean(row.clock_in && !row.clock_out);
    setText('staffMissionActionLabel', 'Attendance');
    setText('staffMissionActionText', isOpen ? 'End Shift' : 'Start Shift');
    setText('staffShiftSubline', isOpen
      ? 'Shift is live.'
      : 'Today is recorded. You can start another approved shift if needed.');

    updateShiftButtons(row);
    await checkTenHourReminder(row);
    await checkAutoClockOutNotification(row);
  } catch {
    status.innerText = 'Server error loading attendance';
    updateShiftButtons(null);
  }
}

async function clockIn(shiftQrToken = '') {
  try {
    const res = await fetch('/api/attendance/clock-in', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ shift_qr_token: shiftQrToken })
    });

    const data = await safeJson(res);

    showToast(data.message || 'Clock in response');

    if (res.ok) {
      const message = dailyMessage(clockInMessages, 'clock-in');
      const subtext = 'Your shift has started. Stay safe, stay sharp, and keep the work moving.';
      showShiftDialog('Shift Started', message, subtext);
      await sendShiftNotification('Your shift has started', message);
    }

    await loadAttendanceStatus();
    await loadTimesheet();
    return res.ok;
  } catch {
    showToast('Clock in failed');
    return false;
  }
}

async function clockOut(shiftQrToken = '') {
  try {
    const res = await fetch('/api/attendance/clock-out', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ shift_qr_token: shiftQrToken })
    });

    const data = await safeJson(res);

    showToast(data.message || 'Clock out response');

    if (res.ok) {
      const message = dailyMessage(clockOutMessages, 'clock-out');
      const subtext = 'Your shift is closed. Thank you for your contribution today.';
      showShiftDialog('Shift Complete', message, subtext);
      await sendShiftNotification('Your shift is complete', message);
    }

    await loadAttendanceStatus();
    await loadTimesheet();
    return res.ok;
  } catch {
    showToast('Clock out failed');
    return false;
  }
}

/* ================= TIMESHEET ================= */

async function loadTimesheet() {
  const tbody = document.getElementById('timesheetTableBody');
  const weeklyGroupsEl = document.getElementById('weeklyTimesheetGroups');
  const monthlyGroupsEl = document.getElementById('monthlyTimesheetGroups');
  const currentWeekRange = document.getElementById('currentWeekRange');
  const weekHours = document.getElementById('weekHoursCount');

  if (!tbody && !weeklyGroupsEl && !monthlyGroupsEl) return;

  try {
    const [weekRes, historyRes] = await Promise.all([
      fetch('/api/attendance/week', {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch('/api/attendance/my', {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    const weekData = await safeJson(weekRes);
    const historyData = await safeJson(historyRes);

    if (tbody) {
      if (!weekRes.ok) {
        tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(weekData.message || 'Failed to load weekly timesheet')}</td></tr>`;
      } else {
        const rows = weekData.attendance || [];
        const totalHours = Number(weekData.total_hours || 0);
        renderCurrentTimesheetWorkflow(weekData.timesheet, totalHours);

        if (currentWeekRange) {
          currentWeekRange.innerText = `This timesheet is from ${formatShortDate(weekData.week_start)} to ${formatShortDate(weekData.week_end)} of this week`;
        }

        if (weekHours) {
          weekHours.innerText = totalHours.toFixed(2);
          updateTimesheetVarianceSignals(totalHours);
        }

        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="4">No records for the current week yet.</td></tr>`;
        } else {
          tbody.innerHTML = rows.map((row) => {
            const cleanDate = row.work_date ? String(row.work_date).slice(0, 10) : '-';

            return `
              <tr>
                <td>${escapeHtml(cleanDate)}</td>
                <td>${escapeHtml(formatDateTime(row.clock_in))}</td>
                <td>${escapeHtml(formatDateTime(row.clock_out))}</td>
                <td>${escapeHtml(Number(row.total_hours || 0).toFixed(2))}</td>
              </tr>
            `;
          }).join('');
        }
      }
    }

    if (weeklyGroupsEl || monthlyGroupsEl) {
      if (!historyRes.ok) {
        const message = `<div class="empty-state">${escapeHtml(historyData.message || 'Failed to load personal timesheet history')}</div>`;
        if (weeklyGroupsEl) weeklyGroupsEl.innerHTML = message;
        if (monthlyGroupsEl) monthlyGroupsEl.innerHTML = message;
      } else {
        const historyRows = historyData.attendance || [];
        renderGroupedTimesheets(weeklyGroupsEl, groupRows(historyRows, weekRangeFor), 'weekly');
        renderGroupedTimesheets(monthlyGroupsEl, groupRows(historyRows, monthRangeFor), 'monthly');
      }
    }
  } catch {
    currentWeekTimesheet = null;
    renderCurrentTimesheetWorkflow(null, 0);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4">Server error loading weekly timesheet.</td></tr>`;
    }

    if (weeklyGroupsEl) {
      weeklyGroupsEl.innerHTML = `<div class="empty-state">Server error loading weekly timesheet history.</div>`;
    }

    if (monthlyGroupsEl) {
      monthlyGroupsEl.innerHTML = `<div class="empty-state">Server error loading monthly timesheet history.</div>`;
    }
  }
}

/* ================= BACKWARD COMPATIBILITY ================= */

function scrollToTasks() {
  document.querySelector('[data-section="tasksSection"]')?.click();
}

function scrollToTimesheet() {
  document.querySelector('[data-section="timesheetSection"]')?.click();
}

/* ================= AUTO REFRESH ================= */

function startAutoRefresh() {
  setInterval(async () => {
    await refreshStaffSession();
    await loadMyTasks();
    await loadAnnouncements();
    await loadAttendanceStatus();
    await loadTimesheet();
    await loadStaffFinanceOverview();
    await refreshVisibleStaffSection();
  }, 10000);
}

/* ================= STAFF WORK HUB ================= */

const staffDocumentLibrary = [
  { id: 'safety-policy', category: 'Safety', title: 'Workshop Safety Policy', summary: 'Core PPE, hazard reporting and safe workshop conduct.' },
  { id: 'machine-sop', category: 'SOP', title: 'Machine Pre-start SOP', summary: 'Daily checks before printers, tools, compressors or workshop machinery are used.' },
  { id: 'quality-release', category: 'Quality', title: 'Quality Release Standard', summary: 'Inspection, hold, release and corrective-action requirements for production work.' },
  { id: 'privacy', category: 'Policy', title: 'Privacy & Confidentiality', summary: 'Customer, invoice, staff and supplier information handling rules.' }
];

function staffWorkIdentity() {
  const user = getStoredUser();
  return String(user.id || user.email || user.username || 'staff').replace(/[^a-z0-9_-]/gi, '_');
}

function staffWorkKey(name) {
  return `voxel-staff-${staffWorkIdentity()}-${name}`;
}

function readStaffWorkStore(name) {
  try {
    const value = JSON.parse(localStorage.getItem(staffWorkKey(name)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeStaffWorkStore(name, rows) {
  localStorage.setItem(staffWorkKey(name), JSON.stringify(Array.isArray(rows) ? rows : []));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function staffUserLabel() {
  const user = getStoredUser();
  return user.name || user.username || user.email || 'Staff';
}

function renderStaffModuleList(targetId, rows, emptyText, template) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  el.innerHTML = rows.map(template).join('');
}

async function sendStaffWorkRequest(type, title, body, payload = {}) {
  try {
    const res = await fetch('/api/tasks/workhub', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ request_type: type, title, body, payload })
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || 'Request send failed');
    return data;
  } catch (err) {
    console.warn('STAFF WORK REQUEST SYNC FAILED', err);
    showToast('Saved locally, but admin sync failed');
    return null;
  }
}
async function submitLeaveRequest(event) {
  event.preventDefault();
  const type = document.getElementById('leaveType')?.value || '';
  const from = document.getElementById('leaveFrom')?.value || '';
  const to = document.getElementById('leaveTo')?.value || '';
  const reason = document.getElementById('leaveReason')?.value.trim() || '';
  if (!type || !from || !to || !reason) {
    showToast('Please fill required fields');
    return;
  }
  if (new Date(to) < new Date(from)) {
    showToast('Leave end date must be after start date');
    return;
  }
  const sync = await sendStaffWorkRequest('leave', type + ' leave request', reason, { type, from, to, reason });
  const rows = readStaffWorkStore('leave');
  rows.push({ id: sync?.request_id || Date.now(), type, from, to, reason, status: sync ? 'Sent to admin' : 'Local sync failed', created_at: new Date().toISOString(), staff: staffUserLabel() });
  writeStaffWorkStore('leave', rows);
  event.target.reset();
  renderStaffLeaveRequests();
  sendStaffNotification('Leave request submitted', `${type} from ${from} to ${to}`);
  showToast(sync ? 'Sent to admin successfully' : 'Saved locally. Admin did not receive it yet.');
}

function renderStaffLeaveRequests() {
  const rows = readStaffWorkStore('leave');
  renderStaffModuleList('staffLeaveList', rows, 'No leave requests yet.', (row) => `
    <article class="staff-mini-card">
      <div><strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.from)} to ${escapeHtml(row.to)}</span><small>${escapeHtml(row.reason)}</small></div>
      <span class="staff-status-pill pending">${escapeHtml(row.status)}</span>
    </article>
  `);
}

async function saveAvailability(event) {
  event.preventDefault();
  const date = document.getElementById('availabilityDate')?.value || '';
  const status = document.getElementById('availabilityStatus')?.value || '';
  const notes = document.getElementById('availabilityNotes')?.value.trim() || '';
  if (!date || !status) {
    showToast('Please fill required fields');
    return;
  }
  const sync = await sendStaffWorkRequest('availability', status + ' availability', notes || status, { date, status, notes });
  const rows = readStaffWorkStore('availability');
  rows.push({ id: sync?.request_id || Date.now(), date, status, notes, sync_status: sync ? 'Sent to admin' : 'Local sync failed', created_at: new Date().toISOString() });
  writeStaffWorkStore('availability', rows);
  event.target.reset();
  renderStaffAvailability();
  sendStaffNotification('Availability saved', `${status} on ${date}`);
  showToast(sync ? 'Sent to admin successfully' : 'Saved locally. Admin did not receive it yet.');
}

function renderStaffAvailability() {
  const rows = readStaffWorkStore('availability');
  renderStaffModuleList('staffAvailabilityList', rows, 'No availability records yet.', (row) => `
    <article class="staff-mini-card">
      <div><strong>${escapeHtml(row.date)}</strong><span>${escapeHtml(row.status)}</span><small>${escapeHtml(row.notes || 'No notes')}</small></div>
      <button type="button" class="secondary-btn compact-btn" onclick="deleteStaffWorkRecord('availability', ${Number(row.id)}, renderStaffAvailability)">Delete</button>
    </article>
  `);
}

function renderStaffDocuments() {
  const readRows = readStaffWorkStore('documents');
  const readIds = new Set(readRows.map((row) => row.id));
  const el = document.getElementById('staffDocumentList');
  if (!el) return;
  el.innerHTML = staffDocumentLibrary.map((doc) => {
    const read = readIds.has(doc.id);
    return `
      <article class="card staff-document-card">
        <span>${escapeHtml(doc.category)}</span>
        <h3>${escapeHtml(doc.title)}</h3>
        <p>${escapeHtml(doc.summary)}</p>
        <button class="${read ? 'secondary-btn' : 'primary-btn'}" type="button" onclick="markStaffDocumentRead('${escapeHtml(doc.id)}')">${read ? 'Read Confirmed' : 'Mark Read'}</button>
      </article>`;
  }).join('');
}

async function markStaffDocumentRead(id) {
  const doc = staffDocumentLibrary.find((item) => item.id === id);
  if (!doc) return;
  const rows = readStaffWorkStore('documents').filter((row) => row.id !== id);
  const sync = await sendStaffWorkRequest('documents', 'Document read: ' + doc.title, doc.summary || 'Staff confirmed document review', { document_id: id, title: doc.title, read_at: new Date().toISOString() });
  rows.push({ id, title: doc.title, read_at: new Date().toISOString(), sync_status: sync ? 'Sent to admin' : 'Local sync failed' });
  writeStaffWorkStore('documents', rows);
  renderStaffDocuments();
  showToast(sync ? 'Sent to admin successfully' : 'Saved locally. Admin did not receive it yet.');
}

async function submitStaffChecklist(event) {
  event.preventDefault();
  const type = document.getElementById('staffFormType')?.value || '';
  const result = document.getElementById('staffFormResult')?.value || '';
  const notes = document.getElementById('staffFormNotes')?.value.trim() || '';
  if (!type || !result) {
    showToast('Please fill required fields');
    return;
  }
  const sync = await sendStaffWorkRequest('forms', type + ' checklist', notes || result, { type, result, notes });
  const rows = readStaffWorkStore('forms');
  rows.push({ id: sync?.request_id || Date.now(), type, result, notes, sync_status: sync ? 'Sent to admin' : 'Local sync failed', submitted_at: new Date().toISOString(), staff: staffUserLabel() });
  writeStaffWorkStore('forms', rows);
  event.target.reset();
  renderStaffFormSubmissions();
  sendStaffNotification('Form submitted', `${type}: ${result}`);
  showToast(sync ? 'Sent to admin successfully' : 'Saved locally. Admin did not receive it yet.');
}

function renderStaffFormSubmissions() {
  const rows = readStaffWorkStore('forms');
  renderStaffModuleList('staffFormList', rows, 'No form submissions yet.', (row) => `
    <article class="staff-mini-card">
      <div><strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.result)}</span><small>${escapeHtml(new Date(row.submitted_at).toLocaleString())}</small><small>${escapeHtml(row.notes || '')}</small></div>
      <button type="button" class="secondary-btn compact-btn" onclick="deleteStaffWorkRecord('forms', ${Number(row.id)}, renderStaffFormSubmissions)">Delete</button>
    </article>
  `);
}

async function sendStaffMessage(event) {
  event.preventDefault();
  const priority = document.getElementById('staffMessagePriority')?.value || 'Normal';
  const body = document.getElementById('staffMessageBody')?.value.trim() || '';
  if (!body) {
    showToast('Please fill required fields');
    return;
  }

  try {
    const res = await fetch('/api/tasks/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ priority, body })
    });
    const data = await safeJson(res);
    if (!res.ok) {
      showToast(data.message || 'Message send failed');
      return;
    }

    event.target.reset();
    await renderStaffMessages();
    sendStaffNotification('Message sent', `${priority} message delivered to admin`);
    showToast(data.message || 'Message sent to admin');
  } catch (err) {
    showToast('Message send failed');
  }
}

async function renderStaffMessages() {
  const list = document.getElementById('staffMessageList');
  if (list) list.innerHTML = '<div class="empty-state compact">Loading messages...</div>';
  try {
    const res = await fetch('/api/tasks/messages/my', { headers: authHeaders() });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || 'Failed to load messages');
    const rows = Array.isArray(data.messages) ? data.messages : [];
    renderStaffModuleList('staffMessageList', rows, 'No messages yet.', (row) => `
      <article class="staff-mini-card">
        <div><strong>${escapeHtml(row.priority || 'Normal')}</strong><span>${escapeHtml(row.body || '')}</span><small>${escapeHtml(new Date(row.created_at || row.sent_at || Date.now()).toLocaleString())}</small></div>
        <span class="staff-status-pill">${escapeHtml(row.status || 'Open')}</span>
      </article>
    `);
  } catch (err) {
    const rows = readStaffWorkStore('messages');
    renderStaffModuleList('staffMessageList', rows, 'No messages yet.', (row) => `
      <article class="staff-mini-card">
        <div><strong>${escapeHtml(row.priority)}</strong><span>${escapeHtml(row.body)}</span><small>${escapeHtml(new Date(row.sent_at).toLocaleString())}</small></div>
        <span class="staff-status-pill">Local only</span>
      </article>
    `);
  }
}

function deleteStaffWorkRecord(store, id, renderFn) {
  const rows = readStaffWorkStore(store).filter((row) => Number(row.id) !== Number(id));
  writeStaffWorkStore(store, rows);
  if (typeof renderFn === 'function') renderFn();
  showToast('Deleted successfully');
}

function loadWorkHubModules() {
  renderStaffLeaveRequests();
  renderStaffAvailability();
  renderStaffDocuments();
  renderStaffFormSubmissions();
  renderStaffMessages();
}
/* ================= STARTUP ================= */

async function bootStaffDashboard() {
  try {
    installAccessDeniedHandler();
    setupStaffNavigation();
    openStaffViewFromUrl();
    startResponsiveTableObserver();

    const user = await loadStaffInfo();
    if (!user || redirectingToLogin) return;
    updateStaffMissionBase();

    applyPermissionUI();
    loadWorkHubModules();

    await Promise.all([
      loadMyTasks(),
      loadAnnouncements(),
      loadAttendanceStatus(),
      loadTimesheet(),
      loadMyRoster(),
      loadStaffFinanceOverview(),
      hasPermission('expenses') ? loadStaffExpenses(1) : Promise.resolve()
    ]);

    await refreshGrantedStaffData();

    startAutoRefresh();
  } catch (err) {
    video.classList.remove('camera-active');
    if (!redirectingToLogin) {
      console.error('STAFF DASHBOARD STARTUP ERROR:', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', bootStaffDashboard);
