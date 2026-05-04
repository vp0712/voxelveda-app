const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

if (!token) {
  window.location.href = '/login.html';
}

if (currentUser.role !== 'admin') {
  alert('Access denied. Admin only.');
  window.location.href = '/staff-dashboard.html';
}
  //console.log('CURRENT USER:', currentUser);
  //alert('Access denied');
  //window.location.href = '/login.html';
//}

//const role = localStorage.getItem('role');

//if (role !== 'admin') {
//  alert('Access denied');
//  window.location.href = 'login.html';
//}

let rfqChartInstance = null;
let invoiceChartInstance = null;

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

function loginSuccess(data) {
localStorage.setItem('token', data.token);
localStorage.setItem('user', JSON.stringify(data.user));
localStorage.setItem('role', data.user.role);
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('role');
  window.location.href = '/login.html';
}

async function loadStaff() {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/users', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      console.error(data.message || 'Failed to load staff');
      return;
    }

    tbody.innerHTML = '';

    (data.users || []).forEach((user) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(user.id)}</td>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.email)}</td>
        <td>${escapeHtml(user.role)}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Staff load failed:', err);
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ================= NAVIGATION ================= */

function setupNavigation() {
  const buttons = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.page-section');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;

      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      sections.forEach((section) => {
        section.classList.add('hidden-section');
      });

      const selected = document.getElementById(target);
      if (selected) selected.classList.remove('hidden-section');
    });
  });
}

/* ================= USER ================= */

async function loadMe() {
  const adminInfo = document.getElementById('adminInfo');
  if (!adminInfo) return;

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      adminInfo.innerText = data.message || 'Failed to load user';
      return;
    }

    adminInfo.innerText = `${data.user.name} | ${data.user.email} | ${data.user.role}`;
  } catch {
    adminInfo.innerText = 'Server error loading user';
  }
}

/* ================= DASHBOARD STATS + CHARTS ================= */

async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      console.error('Stats error:', data);
      return;
    }

    const rfqStatus = document.getElementById('rfqStatus');
    const invoiceStatus = document.getElementById('invoiceStatus');

    if (rfqStatus) {
      rfqStatus.innerText =
        `${data.rfqs.total_rfqs || 0} total | ${data.rfqs.pending_rfqs || 0} pending | ${data.rfqs.quoted_rfqs || 0} quoted`;
    }

    if (invoiceStatus) {
      invoiceStatus.innerText =
        `${data.invoices.total_invoices || 0} total | $${Number(data.invoices.paid_revenue || 0).toFixed(2)} paid`;
    }

    renderDashboardCharts(data);
  } catch (err) {
    console.error('Dashboard stats failed:', err);
  }
}

function renderDashboardCharts(data) {
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
      plugins: {
        legend: {
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
      scales: {
        x: { ticks: { color: '#f8fafc' } },
        y: { beginAtZero: true, ticks: { color: '#f8fafc', precision: 0 } }
      },
      plugins: {
        legend: {
          labels: { color: '#f8fafc' }
        }
      }
    }
  });
}

/* ================= RFQS ================= */

function buildRFQActions(rfq) {
  const status = String(rfq.status || 'Pending').trim().toLowerCase();

  if (status === 'pending') {
    return `<button class="small-btn" onclick="approveRFQ(${rfq.id})">Approve</button>`;
  }

  if (status === 'approved') {
    return `<button class="small-btn" onclick="createInvoice(${rfq.id})">Create Invoice</button>`;
  }

  if (status === 'quoted') {
    return `<span class="status-note">Already Quoted</span>`;
  }

  if (status === 'rejected') {
    return `<span class="status-note">Rejected</span>`;
  }

  if (status === 'closed') {
    return `<span class="status-note">Closed</span>`;
  }

  return `<span class="status-note">No Action</span>`;
}

async function loadRFQs() {
  const tbody = document.getElementById('rfqTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/rfq', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      console.error(data.message || 'Failed to load RFQs');
      return;
    }

    const rfqs = Array.isArray(data) ? data : (data.rfqs || []);
    tbody.innerHTML = '';

    rfqs.forEach((rfq) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(rfq.id)}</td>
        <td>${escapeHtml(rfq.customer_name)}</td>
        <td>${escapeHtml(rfq.email)}</td>
        <td>${escapeHtml(rfq.material)}</td>
        <td>${escapeHtml(rfq.quantity)}</td>
        <td>${escapeHtml(rfq.status || 'Pending')}</td>
        <td>${buildRFQActions(rfq)}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('RFQ load failed:', err);
  }
}

async function approveRFQ(rfqId) {
  if (!confirm(`Approve RFQ #${rfqId}?`)) return;

  try {
    const res = await fetch('/api/rfq/approve', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rfq_id: rfqId })
    });

    const data = await safeJson(res);
    alert(data.message || 'Approve response received');

    if (res.ok) {
      await loadRFQs();
      await loadDashboardStats();
    }
  } catch {
    alert('Error approving RFQ');
  }
}

async function submitRFQ() {
  const body = {
    customer_name: document.getElementById('rfqCustomerName').value,
    email: document.getElementById('rfqEmail').value,
    phone: document.getElementById('rfqPhone').value,
    material: document.getElementById('rfqMaterial').value,
    quantity: document.getElementById('rfqQuantity').value,
    application: document.getElementById('rfqApplication').value
  };

  const res = await fetch('/api/rfq', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });

  const data = await safeJson(res);
  alert(data.message || 'RFQ response');

  if (res.ok) {
    loadRFQs();
    loadDashboardStats();
  }
}

async function createInvoice(rfqId) {
  if (!confirm(`Create invoice for RFQ #${rfqId}?`)) return;

  try {
    const res = await fetch('/api/invoice', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rfq_id: rfqId })
    });

    const data = await safeJson(res);

    if (!res.ok) {
      alert(data.message || 'Invoice creation failed');
      return;
    }

    alert(data.message || 'Invoice created successfully');

    await loadRFQs();
    await loadInvoices();
    await loadDashboardStats();
  } catch {
    alert('Error creating invoice');
  }
}

/* ================= INVOICES ================= */

function buildInvoiceActions(inv) {
  const status = String(inv.status || '').trim().toLowerCase();
  const invoiceNo = String(inv.invoice_no || '').replace(/'/g, "\\'");

  let actions = `
    <button class="small-btn" onclick="viewInvoice(${inv.id}, '${invoiceNo}')">View</button>
  `;

  if (status === 'draft') {
    actions += `<button class="small-btn" onclick="approveInvoice(${inv.id})">Approve</button>`;
  } else if (status === 'approved') {
    actions += `<button class="small-btn" onclick="sendInvoice(${inv.id})">Send</button>`;
  } else if (status === 'sent') {
    actions += `<button class="small-btn" onclick="markInvoicePaid(${inv.id})">Mark Paid</button>`;
  } else if (status === 'paid') {
    actions += `<span class="status-note">Paid</span>`;
  } else if (status === 'cancelled') {
    actions += `<span class="status-note">Cancelled</span>`;
  }

  return actions;
}

async function loadInvoices() {
  const tbody = document.getElementById('invoiceTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/invoice', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      console.error(data.message || 'Failed to load invoices');
      return;
    }

    const invoices = Array.isArray(data) ? data : (data.invoices || []);
    tbody.innerHTML = '';

    invoices.forEach((inv) => {
      const tr = document.createElement('tr');
      tr.id = `invoice-row-${inv.id}`;

      tr.innerHTML = `
        <td>${escapeHtml(inv.id)}</td>
        <td>${escapeHtml(inv.invoice_no)}</td>
        <td>${escapeHtml(inv.rfq_id)}</td>
        <td>${escapeHtml(Number(inv.total || 0).toFixed(2))}</td>
        <td>${escapeHtml(inv.status)}</td>
        <td>${buildInvoiceActions(inv)}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Invoice load failed:', err);
  }
}

function viewInvoice(invoiceId) {
  window.open(`/api/invoice/${invoiceId}/pdf`, '_blank');
}

async function approveInvoice(invoiceId) {
  if (!confirm(`Approve invoice #${invoiceId}?`)) return;

  try {
    const res = await fetch('/api/invoice/approve', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ invoice_id: invoiceId })
    });

    const data = await safeJson(res);
    alert(data.message || 'Invoice approve response received');

    if (res.ok) {
      await loadInvoices();
      await loadDashboardStats();
    }
  } catch {
    alert('Server error approving invoice');
  }
}

async function sendInvoice(invoiceId) {
  if (!confirm(`Send invoice #${invoiceId}?`)) return;

  try {
    const res = await fetch('/api/invoice/send', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ invoice_id: invoiceId })
    });

    const data = await safeJson(res);

    if (!res.ok) {
      alert(`${data.message || 'Send failed'}\n${data.error || ''}`);
      return;
    }

    alert(data.message || 'Invoice sent successfully');

    await loadInvoices();
    await loadDashboardStats();
  } catch {
    alert('Server error sending invoice');
  }
}

async function markInvoicePaid(invoiceId) {
  if (!confirm(`Mark invoice #${invoiceId} as paid?`)) return;

  try {
    const res = await fetch('/api/invoice/paid', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ invoice_id: invoiceId })
    });

    const data = await safeJson(res);
    alert(data.message || 'Invoice paid response received');

    if (res.ok) {
      await loadInvoices();
      await loadDashboardStats();
    }
  } catch {
    alert('Server error marking invoice paid');
  }
}

async function manualCreateInvoice() {
  const rfqId = prompt('Enter approved RFQ ID to create invoice:');

  if (!rfqId) return;

  try {
    const res = await fetch('/api/invoice', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rfq_id: rfqId })
    });

    const data = await safeJson(res);

    if (!res.ok) {
      alert(`${data.message || 'Invoice creation failed'}\n${data.error || ''}`);
      return;
    }

    alert(data.message || 'Invoice created successfully');

    await loadInvoices();
    await loadDashboardStats();
  } catch (err) {
    console.error('Manual invoice error:', err);
    alert('Server error creating invoice');
  }
}

/* ================= SETTINGS ================= */

async function loadSettings() {
  try {
    const res = await fetch('/api/settings', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);

    if (!res.ok || !data.settings) return;

    const s = data.settings;

    if (document.getElementById('settingEmail')) {
      document.getElementById('settingEmail').value = s.company_email || '';
    }

    if (document.getElementById('settingAbn')) {
      document.getElementById('settingAbn').value = s.abn || '';
    }

    if (document.getElementById('settingTerms')) {
      document.getElementById('settingTerms').value = s.payment_terms || '';
    }

    if (document.getElementById('settingBank')) {
      document.getElementById('settingBank').value = s.bank_name || '';
    }
  } catch (err) {
    console.error('Settings load failed:', err);
  }
}

async function saveSettings() {
  const settings = {
    company_email: document.getElementById('settingEmail')?.value || '',
    abn: document.getElementById('settingAbn')?.value || '',
    payment_terms: document.getElementById('settingTerms')?.value || '',
    bank_name: document.getElementById('settingBank')?.value || ''
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(settings)
    });

    const data = await safeJson(res);
    alert(data.message || 'Settings saved');
  } catch {
    alert('Settings save failed');
  }
}

/* ================= STAFF PLACEHOLDER ================= */

async function openAddStaff() {
  const name = prompt('Staff name:');
  if (!name) return;

  const email = prompt('Staff email:');
  if (!email) return;

  const password = prompt('Temporary password:');
  if (!password) return;

  const role = prompt('Role: admin, sales, production, viewer, staff', 'staff');
  if (!role) return;

  const res = await fetch('/api/users', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, email, password, role })
  });

  const data = await safeJson(res);
  alert(data.message || 'Staff response');

  if (res.ok) loadStaff();
}

/* ================= STARTUP ================= */

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  loadMe();
  loadStaff();
  loadRFQs();
  loadInvoices();
  loadDashboardStats();
  loadSettings();
});