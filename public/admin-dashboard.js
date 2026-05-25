const token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentRole = String(currentUser.role || localStorage.getItem('role') || '').trim().toLowerCase();
let redirectingToLogin = false;

if (!token) redirectToLogin('Please login to continue.');

if (currentRole && currentRole !== 'admin') {
  alert('Access denied. Admin only.');
  window.location.href = '/staff-dashboard.html';
}

let rfqChartInstance = null;
let invoiceChartInstance = null;
let invoiceCache = [];
let stockCache = [];
let stockUsageCache = [];
let customerCache = [];
let materialCache = {
  raw_material: [],
  packaging: []
};
let staffCache = [];
let attendanceCache = [];
let announcementCache = [];
let attendanceSnapshot = new Map();
let attendanceFirstLoad = true;

const ACCESS_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'rfqs', label: 'RFQs' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'staff', label: 'Staff' },
  { id: 'settings', label: 'Settings' },
  { id: 'stock', label: 'Stock Management' }
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
  window.location.replace(`/login.html?${params.toString()}`);
  throw new Error('Redirecting to login');
}

function logout() {
  localStorage.clear();
  window.location.href = '/login.html';
}

function toggleMobileMenu(open) {
  const shouldOpen = typeof open === 'boolean'
    ? open
    : !document.body.classList.contains('mobile-menu-open');
  document.body.classList.toggle('mobile-menu-open', shouldOpen);
}

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

function showToast(message) {
  const toast = document.getElementById('toast');

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3200);
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

async function sendAdminNotification(title, body) {
  const allowed = await requestNotificationPermission();
  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png'
  });
}

function showDialog(title, bodyHtml, onPrimary, primaryText = 'Save') {
  const backdrop = document.getElementById('dialogBackdrop');
  const titleEl = document.getElementById('dialogTitle');
  const bodyEl = document.getElementById('dialogBody');
  const primaryBtn = document.getElementById('dialogPrimaryBtn');

  if (!backdrop || !titleEl || !bodyEl || !primaryBtn) return;

  titleEl.innerText = title;
  bodyEl.innerHTML = bodyHtml;
  primaryBtn.innerText = primaryText;
  primaryBtn.onclick = onPrimary;
  backdrop.classList.add('active');
}

function hideDialog() {
  document.getElementById('dialogBackdrop')?.classList.remove('active');
}

function closeDialog(event) {
  if (event?.target?.id === 'dialogBackdrop') hideDialog();
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.page-section').forEach((s) => s.classList.add('hidden-section'));
      document.getElementById(btn.dataset.section)?.classList.remove('hidden-section');

      if (btn.dataset.section === 'customerSection') loadCustomers();
      if (btn.dataset.section === 'rawMaterialSection') loadMaterials('raw_material');
      if (btn.dataset.section === 'packagingSection') loadMaterials('packaging');
      if (btn.dataset.section === 'invoiceSection') loadInvoices();
      if (btn.dataset.section === 'taskSection') loadAnnouncements();
      toggleMobileMenu(false);
    };
  });
}

function goSection(sectionId) {
  document.querySelector(`[data-section="${sectionId}"]`)?.click();
}

async function loadMe() {
  const el = document.getElementById('adminInfo');
  if (!el) return;

  const res = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok || !data.user) {
    el.innerText = data.message || 'User error';
    return null;
  }

  const role = String(data.user.role || '').trim().toLowerCase();

  if (role !== 'admin') {
    currentUser = { ...data.user, role };
    currentRole = role;
    localStorage.setItem('user', JSON.stringify(currentUser));
    localStorage.setItem('role', role);
    alert('Access denied. Admin only.');
    window.location.replace('/staff-dashboard.html');
    return null;
  }

  currentUser = { ...data.user, role };
  currentRole = role;
  localStorage.setItem('user', JSON.stringify(currentUser));
  localStorage.setItem('role', role);
  el.innerText = `${data.user.name} | ${data.user.email} | ${role}`;
  return data.user;
}

async function loadDashboardStats() {
  const res = await fetch('/api/dashboard/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);
  if (!res.ok) return;

  const rfqStatus = document.getElementById('rfqStatus');
  const invoiceStatus = document.getElementById('invoiceStatus');

  if (rfqStatus) {
    rfqStatus.innerText =
      `${data.rfqs.total_rfqs || 0} total | ${data.rfqs.pending_rfqs || 0} pending`;
  }

  if (invoiceStatus) {
    invoiceStatus.innerText =
      `${data.invoices.total_invoices || 0} total | $${Number(data.invoices.paid_revenue || 0).toFixed(2)} paid`;
  }

  renderCharts(data);
  await loadDashboardWidgets();
}

async function loadDashboardWidgets() {
  try {
    const [invoiceRes, stockRes, rawRes, packagingRes] = await Promise.all([
      fetch('/api/invoice', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/stock', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/materials?type=raw_material', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/materials?type=packaging', { headers: { Authorization: `Bearer ${token}` } })
    ]);

    const invoiceData = await safeJson(invoiceRes);
    const stockData = await safeJson(stockRes);
    const rawData = await safeJson(rawRes);
    const packagingData = await safeJson(packagingRes);

    const invoices = invoiceData.invoices || [];
    const stock = stockData.stock || [];
    const raw = rawData.materials || [];
    const packaging = packagingData.materials || [];

    const invoiceValue = invoices.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const stockWorth = stock.reduce((sum, row) => sum + Number(row.current_value || 0), 0);
    const materialWorth = [...raw, ...packaging].reduce((sum, row) => sum + Number(row.current_value || 0), 0);

    const invoiceValueEl = document.getElementById('dashboardInvoiceValue');
    const stockWorthEl = document.getElementById('dashboardStockWorth');
    const materialWorthEl = document.getElementById('dashboardMaterialWorth');

    if (invoiceValueEl) invoiceValueEl.innerText = formatMoney(invoiceValue);
    if (stockWorthEl) stockWorthEl.innerText = formatMoney(stockWorth);
    if (materialWorthEl) materialWorthEl.innerText = formatMoney(materialWorth);

  } catch {
    // Dashboard widgets are secondary; keep the main page usable if one feed fails.
  }
}

function renderTopInventory(stock) {
  const list = document.getElementById('topInventoryList');
  if (!list) return;

  const top = [...stock]
    .sort((a, b) => Number(b.current_value || 0) - Number(a.current_value || 0))
    .slice(0, 5);

  if (!top.length) {
    list.innerHTML = `<div class="empty-state">No inventory value yet.</div>`;
    return;
  }

  list.innerHTML = top.map((item, index) => `
    <div class="rank-item">
      <div class="rank-no">${index + 1}</div>
      <div>
        <strong>${escapeHtml(item.product_name || '-')}</strong><br>
        <span>${escapeHtml(item.current_unit_qty || 0)} pcs left</span>
      </div>
      <strong>${escapeHtml(formatMoney(item.current_value))}</strong>
    </div>
  `).join('');
}

function renderLastOrders(invoices) {
  const tbody = document.getElementById('lastOrdersTableBody');
  if (!tbody) return;

  const rows = [...invoices].slice(-10).reverse();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">No invoice activity yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((invoice) => `
    <tr>
      <td><span class="badge">Invoice</span></td>
      <td>${escapeHtml(invoice.invoice_no || '-')}</td>
      <td>${escapeHtml(formatDate(invoice.created_at))}</td>
      <td>${escapeHtml(invoice.customer_name || '-')}</td>
      <td>${escapeHtml(formatMoney(invoice.total))}</td>
      <td><button class="icon-btn" onclick="openInvoicePdf(${invoice.id})">View</button></td>
    </tr>
  `).join('');
}

function renderCharts(data) {
  const rfqCanvas = document.getElementById('rfqChart');
  const invoiceCanvas = document.getElementById('invoiceChart');

  if (!rfqCanvas || !invoiceCanvas || typeof Chart === 'undefined') return;

  if (rfqChartInstance) rfqChartInstance.destroy();
  if (invoiceChartInstance) invoiceChartInstance.destroy();

  rfqChartInstance = new Chart(rfqCanvas, {
    type: 'doughnut',
    data: {
      labels: ['Pending', 'Approved', 'Quoted'],
      datasets: [{
        data: [
          Number(data.rfqs.pending_rfqs || 0),
          Number(data.rfqs.approved_rfqs || 0),
          Number(data.rfqs.quoted_rfqs || 0)
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#f8fafc' }
        }
      }
    }
  });

  invoiceChartInstance = new Chart(invoiceCanvas, {
    type: 'bar',
    data: {
      labels: ['Draft', 'Approved', 'Sent', 'Paid'],
      datasets: [{
        label: 'Invoices',
        data: [
          Number(data.invoices.draft_invoices || 0),
          Number(data.invoices.approved_invoices || 0),
          Number(data.invoices.sent_invoices || 0),
          Number(data.invoices.paid_invoices || 0)
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#f8fafc' }
        }
      },
      scales: {
        x: { ticks: { color: '#f8fafc' } },
        y: { beginAtZero: true, ticks: { color: '#f8fafc', precision: 0 } }
      }
    }
  });
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function statusBadge(status) {
  const clean = String(status || '-').toLowerCase();
  const extra = ['rejected', 'deleted', 'disabled'].includes(clean)
    ? ' danger-badge'
    : ['approved', 'paid', 'quoted', 'done', 'active'].includes(clean)
      ? ' success-badge'
      : ['sent', 'in_progress'].includes(clean)
        ? ' active-badge'
        : '';

  return `<span class="badge${extra}">${escapeHtml(clean)}</span>`;
}

function parseAccess(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function accessCheckboxes(selected = [], prefix = 'access') {
  const enabled = new Set(selected);

  return `
    <div class="access-grid">
      ${ACCESS_OPTIONS.map((item) => `
        <label class="access-check">
          <input type="checkbox" data-access="${item.id}" id="${prefix}_${item.id}" ${enabled.has(item.id) ? 'checked' : ''}>
          <span>${item.label}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function collectAccess() {
  return Array.from(document.querySelectorAll('[data-access]:checked'))
    .map((input) => input.dataset.access)
    .filter(Boolean);
}

async function submitRFQ() {
  const body = {
    customer_name: document.getElementById('rfqCustomerName')?.value.trim(),
    email: document.getElementById('rfqEmail')?.value.trim(),
    phone: document.getElementById('rfqPhone')?.value.trim(),
    material: document.getElementById('rfqMaterial')?.value.trim(),
    quantity: Number(document.getElementById('rfqQuantity')?.value || 1),
    application: document.getElementById('rfqApplication')?.value.trim()
  };

  const res = await fetch('/api/rfq', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'RFQ creation failed');
    return;
  }

  showToast(data.message || 'RFQ created');
  ['rfqCustomerName', 'rfqEmail', 'rfqPhone', 'rfqMaterial', 'rfqQuantity', 'rfqApplication']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

  await loadRFQs();
  await loadDashboardStats();
}

async function loadRFQs() {
  const tbody = document.getElementById('rfqTableBody');
  if (!tbody) return;

  const res = await fetch('/api/rfq', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">Failed to load RFQs</td></tr>`;
    return;
  }

  const rfqs = data.rfqs || [];

  if (!rfqs.length) {
    tbody.innerHTML = `<tr><td colspan="7">No RFQs yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rfqs.map((r) => {
    const status = String(r.status || '').toLowerCase();
    const canInvoice = status === 'approved' || status === 'quoted';

    return `
      <tr>
        <td>${escapeHtml(r.id)}</td>
        <td>${escapeHtml(r.customer_name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.material || '-')}</td>
        <td>${escapeHtml(r.quantity || 0)}</td>
        <td>${statusBadge(status)}</td>
        <td>
          <button class="small-btn" onclick="updateRFQ(${r.id}, 'approve')">Approve</button>
          <button class="secondary-btn" onclick="updateRFQ(${r.id}, 'reject')">Reject</button>
          ${canInvoice ? `<button class="small-btn" onclick="createInvoiceFromRFQ(${r.id})">${status === 'quoted' ? 'Open Invoice' : 'Invoice'}</button>` : ''}
          <button class="secondary-btn" onclick="updateRFQ(${r.id}, 'close')">Close</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function updateRFQ(rfqId, action) {
  const res = await fetch(`/api/rfq/${action}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ rfq_id: rfqId })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'RFQ update failed');
    return;
  }

  await loadRFQs();
  await loadDashboardStats();
}

async function createInvoiceFromRFQ(rfqId) {
  const res = await fetch('/api/invoice', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ rfq_id: rfqId })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Invoice creation failed');
    return;
  }

  showToast(data.existing ? `Opening ${data.invoice_no || 'invoice'}` : `Invoice ${data.invoice_no || ''} created`);
  await loadRFQs();
  await loadInvoices();
  await loadDashboardStats();
  if (data.invoice_id) {
    await openEditInvoiceDialog(data.invoice_id);
  }
}

async function manualCreateInvoice() {
  showDialog(
    'Create Invoice From RFQ',
    `
      <p class="status-note">Enter an approved RFQ ID. The invoice will be generated as a draft.</p>
      <input id="dialogRfqId" type="number" min="1" placeholder="Approved RFQ ID" />
    `,
    async () => {
      const rfqId = Number(document.getElementById('dialogRfqId')?.value);
      if (!rfqId) {
        showToast('Enter a valid RFQ ID');
        return;
      }

      hideDialog();
      await createInvoiceFromRFQ(rfqId);
    },
    'Create Invoice'
  );
}

function invoiceItemRows(items = [{ description: '', quantity: 1, unit_price: 0 }]) {
  return items.map((item, index) => `
    <div class="invoice-item-row" data-invoice-item-row>
      <label>
        <span>Item description</span>
        <input class="invoiceItemDescription" placeholder="Item description" value="${escapeHtml(item.description || '')}" />
      </label>
      <label>
        <span>Qty</span>
        <input class="invoiceItemQty" type="number" min="0.001" step="0.001" placeholder="Qty" value="${escapeHtml(item.quantity || 1)}" />
      </label>
      <label>
        <span>Unit price</span>
        <input class="invoiceItemPrice" type="number" min="0" step="0.01" placeholder="Unit price" value="${escapeHtml(item.unit_price || 0)}" />
      </label>
      <button type="button" class="secondary-btn invoice-remove-btn" onclick="removeInvoiceItemRow(this)">Remove</button>
    </div>
  `).join('');
}

function addInvoiceItemRow() {
  const container = document.getElementById('invoiceItemsContainer');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', invoiceItemRows([{ description: '', quantity: 1, unit_price: 0 }]));
}

function removeInvoiceItemRow(button) {
  const rows = document.querySelectorAll('[data-invoice-item-row]');
  if (rows.length <= 1) {
    showToast('Invoice needs at least one item');
    return;
  }
  button.closest('[data-invoice-item-row]')?.remove();
}

function collectInvoiceItems() {
  return Array.from(document.querySelectorAll('[data-invoice-item-row]')).map((row) => ({
    description: row.querySelector('.invoiceItemDescription')?.value.trim(),
    quantity: Number(row.querySelector('.invoiceItemQty')?.value || 0),
    unit_price: Number(row.querySelector('.invoiceItemPrice')?.value || 0)
  }));
}

function openManualInvoiceDialog() {
  showDialog(
    'Manual Invoice',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Customer</h4>
          <input id="manualInvoiceCustomer" placeholder="Customer name" />
          <input id="manualInvoiceEmail" type="email" placeholder="Customer email" />
          <input id="manualInvoiceGst" type="number" min="0" step="0.01" value="10" placeholder="GST rate" />
        </div>
        <div class="dialog-card">
          <h4>Line Items</h4>
          <div id="invoiceItemsContainer">${invoiceItemRows()}</div>
          <button type="button" class="secondary-btn" onclick="addInvoiceItemRow()">Add Item</button>
        </div>
      </div>
    `,
    async () => {
      const body = {
        customer_name: document.getElementById('manualInvoiceCustomer')?.value.trim(),
        customer_email: document.getElementById('manualInvoiceEmail')?.value.trim(),
        gst_rate: Number(document.getElementById('manualInvoiceGst')?.value || 10),
        items: collectInvoiceItems()
      };

      const res = await fetch('/api/invoice/manual', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Manual invoice failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Manual invoice created');
      await loadInvoices();
      await loadDashboardStats();
    },
    'Create Invoice'
  );
}

async function loadInvoices() {
  const tbody = document.getElementById('invoiceTableBody');
  if (!tbody) return;

  const res = await fetch('/api/invoice', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">Failed to load invoices</td></tr>`;
    return;
  }

  const invoices = data.invoices || [];
  invoiceCache = invoices;
  updateInvoiceMetrics(invoices);

  if (!invoices.length) {
    tbody.innerHTML = `<tr><td colspan="7">No invoices yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = invoices.map((invoice, index) => `
    <tr>
      <td>${escapeHtml(index + 1)}</td>
      <td>${escapeHtml(invoice.invoice_no || '-')}</td>
      <td>${escapeHtml(invoice.customer_name || '-')}</td>
      <td>${escapeHtml(invoice.rfq_id || 'Manual')}</td>
      <td>${escapeHtml(formatMoney(invoice.total))}</td>
      <td>${statusBadge(invoice.status)}</td>
      <td>
        <button class="small-btn" onclick="invoiceAction(${invoice.id}, 'approve')">Approve</button>
        <button class="small-btn" onclick="openSendInvoiceDialog(${invoice.id})">Send</button>
        <button class="small-btn" onclick="invoiceAction(${invoice.id}, 'paid')">Paid</button>
        <button class="secondary-btn" onclick="openEditInvoiceDialog(${invoice.id})">Edit</button>
        <button class="secondary-btn" onclick="openInvoicePdf(${invoice.id})">PDF</button>
        <button class="danger-btn" onclick="invoiceAction(${invoice.id}, 'delete')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function updateInvoiceMetrics(invoices) {
  const totalEl = document.getElementById('invoiceTotalValue');
  const unpaidEl = document.getElementById('invoiceUnpaidValue');
  const sentPaidEl = document.getElementById('invoiceSentPaidCount');

  const total = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const unpaid = invoices
    .filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid')
    .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const sent = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() === 'sent').length;
  const paid = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() === 'paid').length;

  if (totalEl) totalEl.innerText = formatMoney(total);
  if (unpaidEl) unpaidEl.innerText = formatMoney(unpaid);
  if (sentPaidEl) sentPaidEl.innerText = `${sent} / ${paid}`;
}

function openInvoicePdf(invoiceId) {
  const url = `/invoice-pdf.html?id=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(token)}`;
  const opened = window.open(url, '_blank', 'noopener');

  if (!opened) {
    window.location.href = url;
  }
}

async function openEditInvoiceDialog(invoiceId) {
  const res = await fetch(`/api/invoice/${invoiceId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Failed to load invoice');
    return;
  }

  const invoice = data.invoice || {};
  const items = (data.items || []).length
    ? data.items
    : [{ description: invoice.description || '', quantity: invoice.quantity || 1, unit_price: invoice.unit_price || 0 }];

  showDialog(
    `Edit ${invoice.invoice_no || 'Invoice'}`,
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Invoice Details</h4>
          <input id="editInvoiceNo" placeholder="Invoice number" value="${escapeHtml(invoice.invoice_no || '')}" />
          <input id="editInvoiceCustomer" placeholder="Customer name" value="${escapeHtml(invoice.customer_name || '')}" />
          <input id="editInvoiceEmail" type="email" placeholder="Customer email" value="${escapeHtml(invoice.customer_email || '')}" />
          <div class="split-grid">
            <input id="editInvoiceGst" type="number" min="0" step="0.01" placeholder="GST rate" value="${escapeHtml(invoice.gst_rate ?? 10)}" />
            <select id="editInvoiceStatus">
              ${['draft', 'approved', 'sent', 'paid', 'rejected'].map((status) => `
                <option value="${status}" ${String(invoice.status || '').toLowerCase() === status ? 'selected' : ''}>${status}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="dialog-card">
          <h4>Line Items</h4>
          <div id="invoiceItemsContainer">${invoiceItemRows(items)}</div>
          <button type="button" class="secondary-btn" onclick="addInvoiceItemRow()">Add Item</button>
        </div>
      </div>
    `,
    async () => {
      const body = {
        invoice_id: invoiceId,
        invoice_no: document.getElementById('editInvoiceNo')?.value.trim(),
        customer_name: document.getElementById('editInvoiceCustomer')?.value.trim(),
        customer_email: document.getElementById('editInvoiceEmail')?.value.trim(),
        gst_rate: Number(document.getElementById('editInvoiceGst')?.value || 0),
        status: document.getElementById('editInvoiceStatus')?.value,
        items: collectInvoiceItems()
      };

      const editRes = await fetch('/api/invoice/edit', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const editData = await safeJson(editRes);

      if (!editRes.ok) {
        showToast(editData.message || 'Invoice edit failed');
        return;
      }

      hideDialog();
      showToast(editData.message || 'Invoice updated');
      await loadInvoices();
      await loadDashboardStats();
    },
    'Update Invoice'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

function openSendInvoiceDialog(invoiceId) {
  showDialog(
    'Send Invoice',
    `
      <p class="status-note">Send the PDF by email. Mobile number is saved on the send record for follow-up/SMS setup.</p>
      <input id="sendInvoiceEmail" type="email" placeholder="Customer email address" />
      <input id="sendInvoiceMobile" placeholder="Customer mobile number" />
    `,
    async () => {
      const email = document.getElementById('sendInvoiceEmail')?.value.trim();
      const mobile = document.getElementById('sendInvoiceMobile')?.value.trim();

      if (!email && !mobile) {
        showToast('Enter email or mobile number');
        return;
      }

      const res = await fetch('/api/invoice/send', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ invoice_id: invoiceId, email, mobile })
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Invoice send failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Invoice sent');
      await loadInvoices();
      await loadDashboardStats();
    },
    'Send Invoice'
  );
}

async function invoiceAction(invoiceId, action) {
  if (action === 'delete' && !confirm('Delete this invoice?')) return;

  const res = await fetch(`/api/invoice/${action}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ invoice_id: invoiceId })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Invoice update failed');
    return;
  }

  showToast(data.message || 'Invoice updated');
  await loadInvoices();
  await loadDashboardStats();
}

async function loadCustomers() {
  const tbody = document.getElementById('customerTableBody');
  if (!tbody) return;

  const res = await fetch('/api/customers', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load customers')}</td></tr>`;
    return;
  }

  customerCache = data.customers || [];

  if (!customerCache.length) {
    tbody.innerHTML = `<tr><td colspan="7">No customers saved yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = customerCache.map((customer) => `
    <tr>
      <td>
        <strong>${escapeHtml(customer.company_name)}</strong><br>
        <span class="muted-text">${escapeHtml(customer.address || '-')}</span>
      </td>
      <td>${escapeHtml(customer.contact_name || '-')}</td>
      <td>
        ${escapeHtml(customer.email || '-')}<br>
        <span class="muted-text">${escapeHtml(customer.phone || '-')}</span>
      </td>
      <td><strong>${escapeHtml(customer.order_count || 0)}</strong></td>
      <td><strong>${escapeHtml(formatMoney(customer.total_spend))}</strong></td>
      <td>
        ${customer.file_link ? `<a href="${escapeHtml(customer.file_link)}" target="_blank" rel="noopener">Open file</a><br>` : ''}
        <span class="muted-text">${escapeHtml(customer.notes || '-')}</span>
      </td>
      <td>
        <button class="icon-btn" onclick="openCustomerDialog(${customer.id})">Edit</button>
        <button class="icon-btn danger-icon" onclick="deleteCustomer(${customer.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openCustomerDialog(id = null) {
  const customer = customerCache.find((row) => Number(row.id) === Number(id)) || {};

  showDialog(
    id ? 'Edit Customer' : 'Add Customer',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Customer Identity</h4>
          <input id="customerCompanyName" placeholder="Company / Customer Name" value="${escapeHtml(customer.company_name || '')}" />
          <input id="customerContactName" placeholder="Contact Person" value="${escapeHtml(customer.contact_name || '')}" />
          <div class="split-grid">
            <input id="customerEmail" type="email" placeholder="Email" value="${escapeHtml(customer.email || '')}" />
            <input id="customerPhone" placeholder="Phone / Mobile" value="${escapeHtml(customer.phone || '')}" />
          </div>
        </div>
        <div class="dialog-card">
          <h4>Files & Notes</h4>
          <input id="customerFileLink" placeholder="File / Drive / Drawing Link" value="${escapeHtml(customer.file_link || '')}" />
          <textarea id="customerAddress" rows="2" placeholder="Address">${escapeHtml(customer.address || '')}</textarea>
          <textarea id="customerNotes" rows="3" placeholder="Notes, order preferences, payment terms">${escapeHtml(customer.notes || '')}</textarea>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: customer.id,
        company_name: document.getElementById('customerCompanyName')?.value.trim(),
        contact_name: document.getElementById('customerContactName')?.value.trim(),
        email: document.getElementById('customerEmail')?.value.trim(),
        phone: document.getElementById('customerPhone')?.value.trim(),
        file_link: document.getElementById('customerFileLink')?.value.trim(),
        address: document.getElementById('customerAddress')?.value.trim(),
        notes: document.getElementById('customerNotes')?.value.trim()
      };

      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Customer save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Customer saved');
      await loadCustomers();
    },
    id ? 'Update Customer' : 'Save Customer'
  );
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer?')) return;

  const res = await fetch('/api/customers/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Customer delete failed');
    return;
  }

  showToast(data.message || 'Customer deleted');
  await loadCustomers();
}

async function submitTask() {
  const body = {
    title: document.getElementById('taskTitle')?.value.trim(),
    description: document.getElementById('taskDescription')?.value.trim(),
    assigned_to: Number(document.getElementById('taskAssignedTo')?.value),
    priority: document.getElementById('taskPriority')?.value,
    due_date: document.getElementById('taskDueDate')?.value
  };

  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Task creation failed');
    return;
  }

  showToast('Task assigned');
  await loadTasks();
  await loadDashboardStats();
}

async function loadTasks() {
  const tbody = document.getElementById('taskTableBody');
  if (!tbody) return;

  const res = await fetch('/api/tasks', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">Failed to load tasks</td></tr>`;
    return;
  }

  const tasks = data.tasks || [];

  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="7">No tasks assigned yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map((t) => `
    <tr>
      <td>${escapeHtml(t.id)}</td>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.staff_name || '-')}</td>
      <td>${escapeHtml(t.priority || '-')}</td>
      <td>${escapeHtml(String(t.due_date || '').slice(0, 10))}</td>
      <td>${escapeHtml(t.status || '-')}</td>
      <td>
        <button class="small-btn" onclick="updateTask(${t.id}, 'in_progress')">Start</button>
        <button class="small-btn" onclick="updateTask(${t.id}, 'done')">Done</button>
      </td>
    </tr>
  `).join('');

  updateAdminTaskCounters(tasks);
}

function updateAdminTaskCounters(tasks) {
  const today = todayISO();
  const tomorrow = todayISO(1);

  const isOpen = (task) => String(task.status || '').toLowerCase() !== 'done';
  const dueDate = (task) => task.due_date ? String(task.due_date).slice(0, 10) : '';

  const todayCount = tasks.filter((task) => isOpen(task) && dueDate(task) === today).length;
  const tomorrowCount = tasks.filter((task) => isOpen(task) && dueDate(task) === tomorrow).length;
  const overdueCount = tasks.filter((task) => isOpen(task) && dueDate(task) && dueDate(task) < today).length;

  const todayEl = document.getElementById('taskTodayCount');
  const tomorrowEl = document.getElementById('taskTomorrowCount');
  const overdueEl = document.getElementById('taskOverdueCount');

  if (todayEl) todayEl.innerText = todayCount;
  if (tomorrowEl) tomorrowEl.innerText = tomorrowCount;
  if (overdueEl) overdueEl.innerText = overdueCount;
}

async function updateTask(id, status) {
  await fetch('/api/tasks/status', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ task_id: id, status })
  });

  await loadTasks();
}

async function loadAnnouncements() {
  const tbody = document.getElementById('announcementTableBody');
  if (!tbody) return;

  const res = await fetch('/api/tasks/announcements', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load announcements')}</td></tr>`;
    return;
  }

  announcementCache = data.announcements || [];

  if (!announcementCache.length) {
    tbody.innerHTML = `<tr><td colspan="7">No announcements yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = announcementCache.map((item) => {
    const targetCount = Array.isArray(item.target_user_ids) ? item.target_user_ids.length : 0;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.title)}</strong><br>
          <span class="muted-text">${escapeHtml(item.message)}</span>
        </td>
        <td>${statusBadge(item.priority || 'normal')}</td>
        <td>${escapeHtml(item.audience_type === 'all' ? 'Everyone' : `${targetCount} selected staff`)}</td>
        <td>${escapeHtml(formatDate(item.starts_at))}</td>
        <td>${escapeHtml(formatDate(item.expires_at))}</td>
        <td>${escapeHtml(item.created_by_name || '-')}</td>
        <td><button class="icon-btn danger-icon" onclick="deleteAnnouncement(${item.id})">Delete</button></td>
      </tr>
    `;
  }).join('');
}

function openAnnouncementDialog() {
  const staffOptions = staffCache
    .filter((u) => String(u.role || '').toLowerCase() !== 'admin')
    .map((u) => `
      <label class="access-check">
        <input type="checkbox" class="announcement-target" value="${u.id}" />
        <span>${escapeHtml(u.name || u.email)} (${escapeHtml(u.email || u.username || '')})</span>
      </label>
    `).join('');

  showDialog(
    'New Announcement',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>News Details</h4>
          <input id="announcementTitle" placeholder="Announcement title" />
          <textarea id="announcementMessage" rows="4" placeholder="Important message or news"></textarea>
          <div class="split-grid">
            <select id="announcementPriority">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <select id="announcementAudience">
              <option value="selected">Selected Staff</option>
              <option value="all">Everyone</option>
            </select>
          </div>
          <div class="split-grid">
            <input id="announcementStartsAt" type="date" value="${todayISO()}" />
            <input id="announcementExpiresAt" type="date" value="${todayISO(7)}" />
          </div>
        </div>
        <div class="dialog-card">
          <h4>Who Can See It</h4>
          <p class="muted-text">Choose everyone or select staff members. It will disappear after the expiry date.</p>
          <div class="access-grid">${staffOptions || '<p class="muted-text">No staff users found.</p>'}</div>
        </div>
      </div>
    `,
    async () => {
      const audience = document.getElementById('announcementAudience')?.value || 'selected';
      const targetUserIds = Array.from(document.querySelectorAll('.announcement-target:checked'))
        .map((input) => Number(input.value))
        .filter(Boolean);

      const body = {
        title: document.getElementById('announcementTitle')?.value.trim(),
        message: document.getElementById('announcementMessage')?.value.trim(),
        priority: document.getElementById('announcementPriority')?.value,
        audience_type: audience,
        target_user_ids: targetUserIds,
        starts_at: document.getElementById('announcementStartsAt')?.value,
        expires_at: document.getElementById('announcementExpiresAt')?.value
      };

      const res = await fetch('/api/tasks/announcements', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Announcement publish failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Announcement published');
      await loadAnnouncements();
    },
    'Publish'
  );
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;

  const res = await fetch('/api/tasks/announcements/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Announcement delete failed');
    return;
  }

  showToast(data.message || 'Announcement removed');
  await loadAnnouncements();
}

async function loadStaff() {
  const select = document.getElementById('taskAssignedTo');
  const tbody = document.getElementById('staffTableBody');

  const res = await fetch('/api/users', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);
  if (!res.ok) return;

  const users = data.users || [];
  staffCache = users;
  populateTimesheetStaffSelect(users);

  if (select) {
    select.innerHTML = '<option value="">Select Staff</option>';
    users.forEach((u) => {
      if (String(u.role).toLowerCase() !== 'admin') {
        select.innerHTML += `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`;
      }
    });
  }

  if (tbody) {
    tbody.innerHTML = users.map((u) => `
      <tr>
        <td>${escapeHtml(u.id)}</td>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.username || '-')}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>${escapeHtml(String(u.role).toLowerCase() === 'admin' ? 'All sections' : parseAccess(u.permissions).join(', ') || 'No extra access')}</td>
        <td>${statusBadge(u.active ? 'active' : 'disabled')}</td>
        <td>
          <button class="small-btn" onclick="openAccessDialog(${u.id})">Access</button>
          <button class="secondary-btn" onclick="openPasswordResetDialog(${u.id})">Reset Password</button>
        </td>
      </tr>
    `).join('');
  }
}

function populateTimesheetStaffSelect(users = staffCache) {
  const select = document.getElementById('timesheetStaffSelect');
  if (!select) return;

  const currentValue = select.value;
  const clockUsers = users.filter((u) => {
    const role = String(u.role || '').toLowerCase();
    const permissions = parseAccess(u.permissions);
    return role !== 'admin' && (permissions.includes('attendance') || role === 'staff' || role === 'production');
  });

  select.innerHTML = '<option value="">Select staff</option>';
  clockUsers.forEach((u) => {
    select.innerHTML += `<option value="${u.id}">${escapeHtml(u.name || u.email)} (${escapeHtml(u.email || '-')})</option>`;
  });

  if (currentValue && clockUsers.some((u) => Number(u.id) === Number(currentValue))) {
    select.value = currentValue;
  }
}

async function openAddStaff() {
  showDialog(
    'Add Staff Member',
    `
      <div class="form-grid" style="grid-template-columns:1fr;">
        <input id="dialogStaffName" placeholder="Full name" />
        <input id="dialogStaffUsername" placeholder="Login username" />
        <input id="dialogStaffEmail" type="email" placeholder="Email address" />
        <input id="dialogStaffPassword" type="password" placeholder="Temporary password" />
        <select id="dialogStaffRole">
          <option value="staff">Staff</option>
          <option value="sales">Sales</option>
          <option value="production">Production</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <h4>Section Access</h4>
      ${accessCheckboxes(['dashboard', 'tasks', 'attendance'])}
    `,
    async () => {
      const name = document.getElementById('dialogStaffName')?.value.trim();
      const username = document.getElementById('dialogStaffUsername')?.value.trim();
      const email = document.getElementById('dialogStaffEmail')?.value.trim();
      const password = document.getElementById('dialogStaffPassword')?.value;
      const role = document.getElementById('dialogStaffRole')?.value;
      const permissions = collectAccess();

      if (!name || !username || !email || !password || !role) {
        showToast('Name, username, email, password and role are required');
        return;
      }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, username, email, password, role, permissions })
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Failed to create staff user');
        return;
      }

      hideDialog();
      showToast(data.message || 'Staff user created');
      await loadStaff();
    },
    'Create Staff'
  );
}

async function openAccessDialog(userId) {
  const res = await fetch('/api/users', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);
  const user = (data.users || []).find((item) => Number(item.id) === Number(userId));

  if (!user) {
    showToast('User not found');
    return;
  }

  showDialog(
    `Access Control: ${user.name}`,
    `
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <select id="dialogAccessRole">
          <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option>
          <option value="sales" ${user.role === 'sales' ? 'selected' : ''}>Sales</option>
          <option value="production" ${user.role === 'production' ? 'selected' : ''}>Production</option>
          <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <select id="dialogAccessActive">
          <option value="1" ${user.active ? 'selected' : ''}>Active</option>
          <option value="0" ${!user.active ? 'selected' : ''}>Disabled</option>
        </select>
      </div>
      <h4>Allowed Sections</h4>
      ${accessCheckboxes(parseAccess(user.permissions))}
      <p class="status-note">Admin role can access every section automatically.</p>
    `,
    async () => {
      const role = document.getElementById('dialogAccessRole')?.value || 'staff';
      const active = document.getElementById('dialogAccessActive')?.value === '1';
      const permissions = collectAccess();

      const updateRes = await fetch(`/api/users/${userId}/access`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ role, active, permissions })
      });

      const updateData = await safeJson(updateRes);

      if (!updateRes.ok) {
        showToast(updateData.message || 'Access update failed');
        return;
      }

      hideDialog();
      showToast(updateData.message || 'Access updated');
      await loadStaff();
    },
    'Update Access'
  );
}

async function openPasswordResetDialog(userId) {
  showDialog(
    'Reset Staff Password',
    `
      <p class="status-note">
        Passwords are stored securely and cannot be viewed later. Set a new temporary password here and give it to the staff member.
      </p>
      <input id="dialogNewPassword" type="text" placeholder="New temporary password" />
    `,
    async () => {
      const password = document.getElementById('dialogNewPassword')?.value.trim();

      if (!password || password.length < 6) {
        showToast('Temporary password must be at least 6 characters');
        return;
      }

      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ password })
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Password reset failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Password reset');
      await loadStaff();
    },
    'Reset Password'
  );
}

async function loadSettings() {
  const res = await fetch('/api/settings', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);
  if (!res.ok) return;

  const settings = data.settings || {};
  const map = {
    company_email: 'settingEmail',
    abn: 'settingAbn',
    payment_terms: 'settingTerms',
    bank_name: 'settingBank',
    website: 'settingWebsite',
    support_phone: 'settingSupportPhone'
  };

  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && settings[key] !== undefined) el.value = settings[key];
  });
}

async function saveSettings() {
  const body = {
    company_email: document.getElementById('settingEmail')?.value.trim(),
    abn: document.getElementById('settingAbn')?.value.trim(),
    payment_terms: document.getElementById('settingTerms')?.value.trim(),
    bank_name: document.getElementById('settingBank')?.value.trim(),
    website: document.getElementById('settingWebsite')?.value.trim(),
    support_phone: document.getElementById('settingSupportPhone')?.value.trim()
  };

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });

  const data = await safeJson(res);
  showToast(data.message || (res.ok ? 'Settings saved' : 'Settings save failed'));
}

function openSystemPage(path) {
  window.open(path, '_blank', 'noopener');
}

async function refreshAllSystemData() {
  await Promise.all([
    loadMe(),
    loadDashboardStats(),
    loadRFQs(),
    loadInvoices(),
    loadTasks(),
    loadAnnouncements(),
    loadStaff(),
    loadCustomers(),
    loadStock(),
    loadStockUsage(),
    loadMaterials('raw_material'),
    loadMaterials('packaging'),
    loadAttendance(),
    loadTimesheets(),
    loadSettings()
  ]);

  showToast('System data refreshed');
}

function rowsToCsv(rows) {
  if (!rows.length) return '';

  const keys = Object.keys(rows[0]);
  const escapeCell = (value) => {
    const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };

  return [
    keys.map(escapeCell).join(','),
    ...rows.map((row) => keys.map((key) => escapeCell(row[key])).join(','))
  ].join('\n');
}

function saveCsv(filename, rows) {
  const csv = rowsToCsv(rows);

  if (!csv) {
    showToast('No data available to export');
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadCsv(type) {
  const endpoints = {
    users: '/api/users',
    stock: '/api/stock',
    invoices: '/api/invoice'
  };

  const res = await fetch(endpoints[type], {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Export failed');
    return;
  }

  const rows = type === 'users'
    ? data.users || []
    : type === 'stock'
      ? data.stock || []
      : data.invoices || [];

  saveCsv(`voxelveda-${type}-${todayISO()}.csv`, rows);
  showToast(`${type} export ready`);
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '-';
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('en-AU');
  } catch {
    return String(value);
  }
}

function materialDomPrefix(type) {
  return type === 'packaging' ? 'packaging' : 'rawMaterial';
}

function materialLabel(type) {
  return type === 'packaging' ? 'Packaging' : 'Raw Material';
}

function getProcessSheet(item = {}) {
  if (item.process_sheet && typeof item.process_sheet === 'object') return item.process_sheet;
  try {
    return JSON.parse(item.process_sheet || '{}');
  } catch {
    return {};
  }
}

async function loadMaterials(type) {
  const prefix = materialDomPrefix(type);
  const tbody = document.getElementById(`${prefix}TableBody`);
  if (!tbody) return;

  const res = await fetch(`/api/materials?type=${encodeURIComponent(type)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(data.message || 'Failed to load inventory')}</td></tr>`;
    return;
  }

  const rows = data.materials || [];
  materialCache[type] = rows;
  updateMaterialMetrics(type, rows);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">No ${escapeHtml(materialLabel(type).toLowerCase())} items yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => {
    const isLow = Number(item.current_qty || 0) <= Number(item.reorder_level || 0);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.item_name)}</strong><br>
          <span class="muted-text">${escapeHtml(item.notes || '-')}</span>
        </td>
        <td>
          ${escapeHtml(item.supplier || '-')}<br>
          <span class="muted-text">${escapeHtml(item.reference_code || '-')}</span>
        </td>
        <td>${escapeHtml(item.input_qty || 0)} ${escapeHtml(item.unit_label || '')}</td>
        <td><strong>${escapeHtml(item.current_qty || 0)} ${escapeHtml(item.unit_label || '')}</strong></td>
        <td>${escapeHtml(formatMoney(item.unit_price))}</td>
        <td><strong>${escapeHtml(formatMoney(item.current_value))}</strong></td>
        <td><span class="${isLow ? 'badge danger-badge' : 'badge active-badge'}">${isLow ? 'Reorder' : 'OK'}</span></td>
        <td>
          <button class="icon-btn" onclick="openMaterialDialog('${type}', ${item.id})">Edit</button>
          <button class="icon-btn" onclick="openProcessSheetPdf(${item.id})">Process PDF</button>
          <button class="icon-btn danger-icon" onclick="deleteMaterial('${type}', ${item.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateMaterialMetrics(type, rows) {
  const prefix = materialDomPrefix(type);
  const valueEl = document.getElementById(`${prefix}Value`);
  const unitsEl = document.getElementById(`${prefix}Units`);
  const alertsEl = document.getElementById(`${prefix}Alerts`);

  const value = rows.reduce((sum, item) => sum + Number(item.current_value || 0), 0);
  const units = rows.reduce((sum, item) => sum + Number(item.current_qty || 0), 0);
  const alerts = rows.filter((item) => Number(item.current_qty || 0) <= Number(item.reorder_level || 0)).length;

  if (valueEl) valueEl.innerText = formatMoney(value);
  if (unitsEl) unitsEl.innerText = String(units.toFixed(2).replace(/\.00$/, ''));
  if (alertsEl) alertsEl.innerText = String(alerts);
}

function openMaterialDialog(type, id = null) {
  const item = (materialCache[type] || []).find((row) => Number(row.id) === Number(id)) || {};
  const sheet = getProcessSheet(item);

  showDialog(
    id ? `Edit ${materialLabel(type)}` : `Add ${materialLabel(type)}`,
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Item Details</h4>
          <input id="materialItemName" placeholder="${materialLabel(type)} name" value="${escapeHtml(item.item_name || '')}" />
          <input id="materialSupplier" placeholder="Supplier" value="${escapeHtml(item.supplier || '')}" />
          <input id="materialReference" placeholder="Reference / Lot / SKU" value="${escapeHtml(item.reference_code || '')}" />
          <textarea id="materialNotes" rows="3" placeholder="Notes">${escapeHtml(item.notes || '')}</textarea>
        </div>
        <div class="dialog-card">
          <h4>Quantity & Worth</h4>
          <div class="split-grid">
            <input id="materialInputQty" type="number" min="0" step="0.001" placeholder="Input quantity" value="${escapeHtml(item.input_qty || 0)}" />
            <input id="materialCurrentQty" type="number" min="0" step="0.001" placeholder="Current quantity" value="${escapeHtml(item.current_qty ?? item.input_qty ?? 0)}" />
          </div>
          <div class="split-grid">
            <input id="materialUnitLabel" placeholder="Unit (kg, roll, pcs)" value="${escapeHtml(item.unit_label || 'pcs')}" />
            <input id="materialUnitPrice" type="number" min="0" step="0.01" placeholder="Unit price" value="${escapeHtml(item.unit_price || 0)}" />
          </div>
          <input id="materialReorderLevel" type="number" min="0" step="0.001" placeholder="Reorder level" value="${escapeHtml(item.reorder_level || 0)}" />
        </div>
        <div class="dialog-card">
          <h4>Mandatory Process Sheet</h4>
          <p class="muted-text">Strict company quality record. Inventory cannot be saved until this sheet is complete.</p>
          <div class="split-grid">
            <input id="processReceivedDate" type="date" value="${escapeHtml(sheet.received_date || todayISO())}" />
            <input id="processPoNumber" placeholder="PO / Job Number" value="${escapeHtml(sheet.po_number || '')}" />
          </div>
          <div class="split-grid">
            <input id="processSupplierBatch" placeholder="Supplier batch / heat / lot" value="${escapeHtml(sheet.supplier_batch || '')}" />
            <input id="processReceivedBy" placeholder="Received by" value="${escapeHtml(sheet.received_by || currentUser.name || '')}" />
          </div>
          <div class="split-grid">
            <input id="processInspectedBy" placeholder="Inspected by" value="${escapeHtml(sheet.inspected_by || currentUser.name || '')}" />
            <input id="processApprovedBy" placeholder="Approved by" value="${escapeHtml(sheet.approved_by || '')}" />
          </div>
          <div class="split-grid">
            <select id="processCoaAvailable">
              <option value="">COA / certificate available?</option>
              <option value="yes" ${sheet.coa_available === 'yes' ? 'selected' : ''}>Yes</option>
              <option value="no" ${sheet.coa_available === 'no' ? 'selected' : ''}>No</option>
              <option value="not_applicable" ${sheet.coa_available === 'not_applicable' ? 'selected' : ''}>Not Applicable</option>
            </select>
            <select id="processSdsAvailable">
              <option value="">SDS / safety data available?</option>
              <option value="yes" ${sheet.sds_available === 'yes' ? 'selected' : ''}>Yes</option>
              <option value="no" ${sheet.sds_available === 'no' ? 'selected' : ''}>No</option>
              <option value="not_applicable" ${sheet.sds_available === 'not_applicable' ? 'selected' : ''}>Not Applicable</option>
            </select>
          </div>
        </div>
        <div class="dialog-card">
          <h4>Quality Release Criteria</h4>
          <div class="split-grid">
            ${processSelect('processVisualCondition', 'Visual condition', sheet.visual_condition)}
            ${processSelect('processDimensionCheck', 'Dimension / weight check', sheet.dimension_check)}
          </div>
          <div class="split-grid">
            ${processSelect('processContaminationCheck', 'Contamination check', sheet.contamination_check)}
            ${processSelect('processStorageCondition', 'Storage condition', sheet.storage_condition)}
          </div>
          <div class="split-grid">
            <select id="processQuarantineStatus">
              <option value="">Quarantine status</option>
              <option value="released" ${sheet.quarantine_status === 'released' ? 'selected' : ''}>Released</option>
              <option value="quarantine" ${sheet.quarantine_status === 'quarantine' ? 'selected' : ''}>Quarantine</option>
              <option value="rejected" ${sheet.quarantine_status === 'rejected' ? 'selected' : ''}>Rejected</option>
            </select>
            <select id="processFinalDisposition">
              <option value="">Final disposition</option>
              <option value="accepted" ${sheet.final_disposition === 'accepted' ? 'selected' : ''}>Accepted</option>
              <option value="conditional" ${sheet.final_disposition === 'conditional' ? 'selected' : ''}>Conditional Use</option>
              <option value="quarantine" ${sheet.final_disposition === 'quarantine' ? 'selected' : ''}>Quarantine</option>
              <option value="rejected" ${sheet.final_disposition === 'rejected' ? 'selected' : ''}>Rejected</option>
            </select>
          </div>
          <textarea id="processRiskNotes" rows="3" placeholder="Risk notes / audit observation">${escapeHtml(sheet.risk_notes || '')}</textarea>
          <textarea id="processCorrectiveAction" rows="3" placeholder="Corrective action if any">${escapeHtml(sheet.corrective_action || '')}</textarea>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: item.id,
        inventory_type: type,
        item_name: document.getElementById('materialItemName')?.value.trim(),
        supplier: document.getElementById('materialSupplier')?.value.trim(),
        reference_code: document.getElementById('materialReference')?.value.trim(),
        input_qty: Number(document.getElementById('materialInputQty')?.value || 0),
        current_qty: Number(document.getElementById('materialCurrentQty')?.value || 0),
        unit_label: document.getElementById('materialUnitLabel')?.value.trim(),
        unit_price: Number(document.getElementById('materialUnitPrice')?.value || 0),
        reorder_level: Number(document.getElementById('materialReorderLevel')?.value || 0),
        notes: document.getElementById('materialNotes')?.value.trim(),
        process_sheet: collectProcessSheet()
      };

      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Inventory save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Inventory saved');
      await loadMaterials(type);
    },
    id ? 'Update Item' : 'Save Item'
  );
}

function processSelect(id, label, value) {
  return `
    <select id="${id}">
      <option value="">${label}</option>
      <option value="pass" ${value === 'pass' ? 'selected' : ''}>Pass</option>
      <option value="conditional" ${value === 'conditional' ? 'selected' : ''}>Conditional</option>
      <option value="fail" ${value === 'fail' ? 'selected' : ''}>Fail</option>
      <option value="not_applicable" ${value === 'not_applicable' ? 'selected' : ''}>Not Applicable</option>
    </select>
  `;
}

function collectProcessSheet() {
  return {
    received_date: document.getElementById('processReceivedDate')?.value,
    po_number: document.getElementById('processPoNumber')?.value.trim(),
    supplier_batch: document.getElementById('processSupplierBatch')?.value.trim(),
    received_by: document.getElementById('processReceivedBy')?.value.trim(),
    inspected_by: document.getElementById('processInspectedBy')?.value.trim(),
    approved_by: document.getElementById('processApprovedBy')?.value.trim(),
    coa_available: document.getElementById('processCoaAvailable')?.value,
    sds_available: document.getElementById('processSdsAvailable')?.value,
    visual_condition: document.getElementById('processVisualCondition')?.value,
    dimension_check: document.getElementById('processDimensionCheck')?.value,
    contamination_check: document.getElementById('processContaminationCheck')?.value,
    storage_condition: document.getElementById('processStorageCondition')?.value,
    quarantine_status: document.getElementById('processQuarantineStatus')?.value,
    final_disposition: document.getElementById('processFinalDisposition')?.value,
    risk_notes: document.getElementById('processRiskNotes')?.value.trim(),
    corrective_action: document.getElementById('processCorrectiveAction')?.value.trim()
  };
}

function openProcessSheetPdf(id) {
  window.open(`/api/materials/${id}/process-sheet.pdf?token=${encodeURIComponent(token)}`, '_blank');
}

async function deleteMaterial(type, id) {
  if (!confirm(`Delete this ${materialLabel(type).toLowerCase()} item?`)) return;

  const res = await fetch('/api/materials/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id, inventory_type: type })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Inventory delete failed');
    return;
  }

  showToast(data.message || 'Inventory deleted');
  await loadMaterials(type);
}

async function loadStock() {
  const tbody = document.getElementById('stockTableBody');
  if (!tbody) return;

  const search = document.getElementById('stockSearch')?.value.trim() || '';
  const res = await fetch(`/api/stock?search=${encodeURIComponent(search)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(data.message || 'Failed to load stock')}</td></tr>`;
    return;
  }

  const rows = data.stock || [];
  stockCache = rows;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9">No stock items yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>
        <strong>${escapeHtml(item.product_name)}</strong><br>
        <span class="muted-text">${escapeHtml(item.category || '-')}</span>
      </td>
      <td>
        <strong>${escapeHtml(item.batch_code || '-')}</strong><br>
        <span>Received: ${escapeHtml(formatDate(item.manufacture_date))}</span>
      </td>
      <td>
        <strong>${escapeHtml(item.unit_qty || 0)} pcs</strong><br>
        <span class="muted-text">Original input</span>
      </td>
      <td>
        <strong>${escapeHtml(item.current_unit_qty || 0)} pcs</strong><br>
        <span class="success-text">Issued: ${escapeHtml(item.issued_unit_qty || 0)}</span>
      </td>
      <td>
        <strong>${escapeHtml(formatMoney(item.unit_price))}</strong><br>
        <span class="muted-text">Per unit</span>
      </td>
      <td>
        <strong>${escapeHtml(formatMoney(item.current_value))}</strong><br>
        <span class="muted-text">Input: ${escapeHtml(formatMoney(item.total_input_value))}</span>
      </td>
      <td>
        <strong>Created: ${escapeHtml(item.created_by_name || '-')}</strong><br>
        <span>Updated: ${escapeHtml(item.updated_by_name || '-')}</span>
      </td>
      <td>
        <button class="icon-btn" title="Edit stock" onclick="openStockDialogById(${item.id})">Edit</button>
        <button class="icon-btn" title="Minus stock" onclick="openIssueStockDialog(${item.id})">Issue</button>
        <button class="icon-btn danger-icon" title="Delete stock" onclick="deleteStock(${item.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openStockDialogById(id) {
  const item = stockCache.find((row) => Number(row.id) === Number(id));
  openStockDialog(item || null);
}

function openStockDialog(stock = null) {
  const item = stock || {};

  showDialog(
    stock ? 'Edit Stock Item' : 'Add Stock Item',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Item Details</h4>
          <input id="stockProductName" placeholder="Part / Product Name" value="${escapeHtml(item.product_name || '')}" />
          <input id="stockCategory" placeholder="Category / Material" value="${escapeHtml(item.category || '')}" />
          <div class="split-grid">
            <input id="stockManufactureDate" type="date" value="${escapeHtml(formatDate(item.manufacture_date) === '-' ? todayISO() : formatDate(item.manufacture_date))}" />
            <input id="stockBatchCode" placeholder="Reference / Batch Code" value="${escapeHtml(item.batch_code || '')}" />
          </div>
        </div>

        <div class="dialog-card">
          <h4>Quantity & Value</h4>
          <div class="split-grid">
            <input id="stockUnitQty" type="number" min="0" placeholder="Unit Quantity" value="${escapeHtml(item.unit_qty || 0)}" oninput="updateStockTotalPreview()" />
            <input id="stockUnitPrice" type="number" min="0" step="0.01" placeholder="Unit Price" value="${escapeHtml(item.unit_price || 0)}" oninput="updateStockTotalPreview()" />
          </div>
          <p class="muted-text">Total inventory value: <strong id="stockTotalPreview">${escapeHtml(formatMoney((Number(item.unit_qty || 0) * Number(item.unit_price || 0))))}</strong></p>
          ${stock ? `<p class="muted-text">Available now: <strong>${escapeHtml(item.current_unit_qty || 0)} pcs</strong>. Editing input keeps already issued stock counted separately.</p>` : ''}
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: item.id,
        product_name: document.getElementById('stockProductName')?.value.trim(),
        category: document.getElementById('stockCategory')?.value.trim(),
        manufacture_date: document.getElementById('stockManufactureDate')?.value,
        batch_code: document.getElementById('stockBatchCode')?.value.trim(),
        unit_qty: Number(document.getElementById('stockUnitQty')?.value || 0),
        unit_price: Number(document.getElementById('stockUnitPrice')?.value || 0)
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

      hideDialog();
      showToast(data.message || 'Stock saved');
      await loadStock();
      await loadStockUsage();
    },
    stock ? 'Update' : 'Save'
  );
}

function updateStockTotalPreview() {
  const qty = Number(document.getElementById('stockUnitQty')?.value || 0);
  const price = Number(document.getElementById('stockUnitPrice')?.value || 0);
  const preview = document.getElementById('stockTotalPreview');
  if (preview) preview.textContent = formatMoney(qty * price);
}

function openIssueStockDialog(stockId = null, movement = null) {
  if (!stockCache.length) {
    showToast('Add stock before issuing it');
    return;
  }

  const selectedId = movement ? movement.stock_id : stockId;
  const selected = stockCache.find((row) => Number(row.id) === Number(selectedId)) || stockCache[0];
  const options = stockCache.map((item) => `
    <option value="${item.id}" ${Number(item.id) === Number(selected.id) ? 'selected' : ''}>
      ${escapeHtml(item.product_name)} (${escapeHtml(item.current_unit_qty || 0)} pcs)
    </option>
  `).join('');

  showDialog(
    movement ? 'Edit Stock Out' : 'Minus Stock',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Issue Details</h4>
          <select id="issueStockId" onchange="updateIssueStockPreview()">${options}</select>
          <div class="split-grid">
            <input id="issueQty" type="number" min="1" placeholder="Quantity out" value="${escapeHtml(movement?.quantity || '')}" oninput="updateIssueStockPreview()" />
            <input id="issueTo" placeholder="Sold / Issued To" value="${escapeHtml(movement?.issued_to || '')}" />
          </div>
          <textarea id="issueNotes" rows="3" placeholder="Job number, customer name, or internal notes">${escapeHtml(movement?.notes || '')}</textarea>
        </div>

        <div class="dialog-card">
          <h4>Live Stock Check</h4>
          <p class="muted-text">Available: <strong id="issueAvailable">-</strong></p>
          <p class="muted-text">Unit price: <strong id="issueUnitPrice">-</strong></p>
          <p class="muted-text">Total outgoing value: <strong id="issueTotalValue">-</strong></p>
        </div>
      </div>
    `,
    async () => {
      const body = {
        stock_id: Number(document.getElementById('issueStockId')?.value || 0),
        quantity: Number(document.getElementById('issueQty')?.value || 0),
        issued_to: document.getElementById('issueTo')?.value.trim(),
        notes: document.getElementById('issueNotes')?.value.trim()
      };

      const res = await fetch(movement ? '/api/stock/movement/update' : '/api/stock/issue', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(movement ? { ...body, id: movement.id } : body)
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Stock issue failed');
        return;
      }

      hideDialog();
      showToast(data.message || (movement ? 'Stock out updated' : 'Stock issued'));
      await loadStock();
      await loadStockUsage();
    },
    movement ? 'Update Usage' : 'Save Usage'
  );

  setTimeout(updateIssueStockPreview, 0);
}

function openStockUsageDialogById(id) {
  const movement = stockUsageCache.find((row) => Number(row.id) === Number(id));
  if (!movement) {
    showToast('Stock out entry not found');
    return;
  }
  openIssueStockDialog(movement.stock_id, movement);
}

function updateIssueStockPreview() {
  const stockId = Number(document.getElementById('issueStockId')?.value || 0);
  const qty = Number(document.getElementById('issueQty')?.value || 0);
  const item = stockCache.find((row) => Number(row.id) === stockId) || {};
  const unitPrice = Number(item.unit_price || 0);

  const availableEl = document.getElementById('issueAvailable');
  const unitPriceEl = document.getElementById('issueUnitPrice');
  const totalValueEl = document.getElementById('issueTotalValue');

  if (availableEl) availableEl.textContent = `${item.current_unit_qty || 0} pcs`;
  if (unitPriceEl) unitPriceEl.textContent = formatMoney(unitPrice);
  if (totalValueEl) totalValueEl.textContent = formatMoney(qty * unitPrice);
}

async function loadStockUsage() {
  const tbody = document.getElementById('stockUsageTableBody');
  if (!tbody) return;

  const res = await fetch('/api/stock/movements', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(data.message || 'Failed to load stock usage')}</td></tr>`;
    return;
  }

  const rows = data.movements || [];
  stockUsageCache = rows;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9">No stock usage recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
      <td>
        <strong>${escapeHtml(item.product_name || '-')}</strong><br>
        <span class="muted-text">${escapeHtml(item.category || '-')}</span>
      </td>
      <td><strong>${escapeHtml(item.quantity || 0)} pcs</strong></td>
      <td>${escapeHtml(formatMoney(item.unit_price))}</td>
      <td><strong>${escapeHtml(formatMoney(item.total_price))}</strong></td>
      <td>${escapeHtml(item.issued_to || '-')}</td>
      <td>${escapeHtml(item.notes || '-')}</td>
      <td>${escapeHtml(item.created_by_name || '-')}</td>
      <td>
        <button class="icon-btn" title="Edit stock out" onclick="openStockUsageDialogById(${item.id})">Edit</button>
        <button class="icon-btn danger-icon" title="Delete stock out" onclick="deleteStockUsage(${item.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function deleteStockUsage(id) {
  if (!confirm('Delete this stock out entry and restore the quantity?')) return;

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
  await loadStock();
  await loadStockUsage();
}

async function deleteStock(id) {
  if (!confirm('Delete this stock item?')) return;

  const res = await fetch('/api/stock/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Stock delete failed');
    return;
  }

  showToast(data.message || 'Stock deleted');
  await loadStock();
  await loadStockUsage();
}

async function loadAttendance() {
  const tbody = document.getElementById('attendanceTableBody');
  if (!tbody) return;

  const res = await fetch('/api/attendance/all', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="8">Failed to load attendance</td></tr>`;
    return;
  }

  const rows = data.attendance || [];
  notifyAttendanceChanges(rows);
  attendanceCache = rows;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">No attendance records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((a) => `
    <tr>
      <td>${escapeHtml(a.name || '-')}</td>
      <td>${escapeHtml(a.email || '-')}</td>
      <td>${escapeHtml(a.clock_in || '-')}</td>
      <td>${escapeHtml(a.clock_out || '-')}</td>
      <td>${escapeHtml(Number(a.total_hours || 0).toFixed(2))}</td>
      <td>${escapeHtml(String(a.work_date || '').slice(0, 10))}</td>
      <td>${escapeHtml(a.notes || '-')}</td>
      <td>
        <button class="small-btn" onclick="openAttendanceDialog(${a.id})">Edit</button>
        <button class="danger-btn" onclick="deleteAttendance(${a.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function notifyAttendanceChanges(rows) {
  const next = new Map();

  rows.forEach((row) => {
    const key = String(row.id);
    const state = {
      clock_in: row.clock_in || '',
      clock_out: row.clock_out || ''
    };
    next.set(key, state);

    const previous = attendanceSnapshot.get(key);
    if (attendanceFirstLoad) return;

    if (!previous) {
      showToast(`${row.name || 'Staff'} clocked in`);
      sendAdminNotification('Staff clocked in', `${row.name || 'A staff member'} started shift at ${state.clock_in}`);
      if (state.clock_out) {
        showToast(`${row.name || 'Staff'} clocked out`);
        sendAdminNotification('Staff clocked out', `${row.name || 'A staff member'} ended shift at ${state.clock_out}`);
      }
      return;
    }

    if (!previous.clock_in && state.clock_in) {
      showToast(`${row.name || 'Staff'} clocked in`);
      sendAdminNotification('Staff clocked in', `${row.name || 'A staff member'} started shift at ${state.clock_in}`);
    }

    if (!previous.clock_out && state.clock_out) {
      showToast(`${row.name || 'Staff'} clocked out`);
      sendAdminNotification('Staff clocked out', `${row.name || 'A staff member'} ended shift at ${state.clock_out}`);
    }
  });

  attendanceSnapshot = next;
  attendanceFirstLoad = false;
}

function toDateTimeLocal(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace(' ', 'T').slice(0, 16);
  }

  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function openAttendanceDialog(attendanceId = null) {
  const record = attendanceId
    ? attendanceCache.find((row) => Number(row.id) === Number(attendanceId))
    : null;

  const staffOptions = staffCache
    .filter((user) => String(user.role).toLowerCase() !== 'admin')
    .map((user) => `
      <option value="${user.id}" ${Number(record?.user_id) === Number(user.id) ? 'selected' : ''}>
        ${escapeHtml(user.name)} (${escapeHtml(user.email)})
      </option>
    `)
    .join('');

  showDialog(
    record ? 'Edit Staff Timesheet' : 'Add / Fix Staff Timesheet',
    `
      <div class="form-grid" style="grid-template-columns:1fr;">
        <select id="attendanceUserId">
          <option value="">Select staff</option>
          ${staffOptions}
        </select>
        <label>
          <span class="muted-text">Clock In</span>
          <input id="attendanceClockIn" type="datetime-local" value="${escapeHtml(toDateTimeLocal(record?.clock_in))}" />
        </label>
        <label>
          <span class="muted-text">Clock Out</span>
          <input id="attendanceClockOut" type="datetime-local" value="${escapeHtml(toDateTimeLocal(record?.clock_out))}" />
        </label>
        <textarea id="attendanceNotes" placeholder="Reason / notes">${escapeHtml(record?.notes || '')}</textarea>
      </div>
      <p class="status-note">Use this when staff forgot to clock in/out or started shift by mistake.</p>
    `,
    async () => {
      const body = {
        id: record?.id,
        user_id: Number(document.getElementById('attendanceUserId')?.value),
        clock_in: document.getElementById('attendanceClockIn')?.value,
        clock_out: document.getElementById('attendanceClockOut')?.value,
        notes: document.getElementById('attendanceNotes')?.value.trim()
      };

      const res = await fetch('/api/attendance/admin/save', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });

      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Attendance save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Attendance saved');
      attendanceFirstLoad = true;
      await loadAttendance();
      await loadTimesheets();
    },
    record ? 'Update Timesheet' : 'Save Timesheet'
  );
}

async function deleteAttendance(id) {
  if (!confirm('Delete this attendance record?')) return;

  const res = await fetch('/api/attendance/admin/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });

  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Attendance delete failed');
    return;
  }

  showToast(data.message || 'Attendance deleted');
  attendanceFirstLoad = true;
  await loadAttendance();
  await loadTimesheets();
}

async function loadTimesheets() {
  const tbody = document.getElementById('timesheetAdminBody');
  if (!tbody) return;

  const res = await fetch('/api/attendance/timesheets', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5">Failed to load timesheets</td></tr>`;
    return;
  }

  const rows = data.timesheets || [];

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5">No weekly timesheets yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((t) => `
    <tr>
      <td>${escapeHtml(t.name || '-')}</td>
      <td>${escapeHtml(String(t.week_start || '').slice(0, 10))}</td>
      <td>${escapeHtml(String(t.week_end || '').slice(0, 10))}</td>
      <td>${escapeHtml(Number(t.total_hours || 0).toFixed(2))}</td>
      <td>${escapeHtml(t.status || 'open')}</td>
    </tr>
  `).join('');
}

async function loadSelectedStaffTimesheets() {
  const staffSelect = document.getElementById('timesheetStaffSelect');
  const periodSelect = document.getElementById('timesheetPeriodSelect');
  const summaryBody = document.getElementById('selectedTimesheetSummaryBody');
  const recordsBody = document.getElementById('selectedTimesheetRecordsBody');
  const title = document.getElementById('selectedTimesheetTitle');

  if (!staffSelect || !periodSelect || !summaryBody || !recordsBody) return;

  const userId = Number(staffSelect.value || 0);
  const period = periodSelect.value || 'weekly';

  if (!userId) {
    showToast('Select a staff member');
    return;
  }

  const selectedStaff = staffCache.find((u) => Number(u.id) === userId);
  if (title) {
    title.innerText = `${selectedStaff?.name || 'Staff'} ${period === 'monthly' ? 'Monthly' : 'Weekly'} Timesheet`;
  }

  summaryBody.innerHTML = `<tr><td colspan="6">Loading selected staff timesheet...</td></tr>`;
  recordsBody.innerHTML = `<tr><td colspan="5">Loading shift records...</td></tr>`;

  const res = await fetch(`/api/attendance/timesheets/user?user_id=${encodeURIComponent(userId)}&period=${encodeURIComponent(period)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    summaryBody.innerHTML = `<tr><td colspan="6">${escapeHtml(data.message || 'Failed to load staff timesheet')}</td></tr>`;
    recordsBody.innerHTML = `<tr><td colspan="5">-</td></tr>`;
    return;
  }

  const summaryRows = data.summary || [];
  const recordRows = data.records || [];

  if (!summaryRows.length) {
    summaryBody.innerHTML = `<tr><td colspan="6">No ${escapeHtml(period)} timesheet records for this staff member.</td></tr>`;
  } else {
    summaryBody.innerHTML = summaryRows.map((row) => `
      <tr>
        <td>${escapeHtml(formatDate(row.period_start))}</td>
        <td>${escapeHtml(formatDate(row.period_end))}</td>
        <td>${escapeHtml(row.shifts || 0)}</td>
        <td><strong>${escapeHtml(Number(row.total_hours || 0).toFixed(2))}</strong></td>
        <td>${escapeHtml(formatDate(row.first_shift))}</td>
        <td>${escapeHtml(formatDate(row.last_shift))}</td>
      </tr>
    `).join('');
  }

  if (!recordRows.length) {
    recordsBody.innerHTML = `<tr><td colspan="5">No shift records for this staff member.</td></tr>`;
  } else {
    recordsBody.innerHTML = recordRows.map((row) => `
      <tr>
        <td>${escapeHtml(formatDate(row.work_date))}</td>
        <td>${escapeHtml(formatDateTime(row.clock_in))}</td>
        <td>${escapeHtml(formatDateTime(row.clock_out))}</td>
        <td>${escapeHtml(Number(row.total_hours || 0).toFixed(2))}</td>
        <td>${escapeHtml(row.notes || '-')}</td>
      </tr>
    `).join('');
  }
}

async function bootAdminDashboard() {
  try {
    setupNavigation();
    startResponsiveTableObserver();

    const user = await loadMe();
    if (!user || redirectingToLogin) return;

    await Promise.all([
      loadDashboardStats(),
      loadRFQs(),
      loadInvoices(),
      loadTasks(),
      loadAnnouncements(),
      loadStaff(),
      loadCustomers(),
      loadStock(),
      loadStockUsage(),
      loadMaterials('raw_material'),
      loadMaterials('packaging'),
      loadAttendance(),
      loadTimesheets(),
      loadSettings()
    ]);

    setInterval(loadAttendance, 15000);
  } catch (err) {
    if (!redirectingToLogin) {
      console.error('ADMIN DASHBOARD STARTUP ERROR:', err);
      showToast('Dashboard could not load. Please refresh or login again.');
    }
  }
}

document.addEventListener('DOMContentLoaded', bootAdminDashboard);
