const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');


if (!token) {
  window.location.href = '/login.html';
}
if (!currentUser.role) {
  window.location.href = '/login.html';
}

if (currentUser.role === 'admin') {
  window.location.href = '/dashboard.html';
}

//const role = localStorage.getItem('role');

//if (!role || role === 'admin') {
  //window.location.href = 'login.html';
//}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (err) {
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

async function loadStaffInfo() {
  const staffInfo = document.getElementById('staffInfo');
  if (!staffInfo) return;

  try {
    const res = await fetch('/api/auth/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      staffInfo.innerText = data.message || 'Failed to load user';
      return;
    }

    const user = data.user;

    if (!['staff', 'production', 'viewer', 'sales', 'admin'].includes(user.role)) {
      logout();
      return;
    }

    staffInfo.innerText = `${user.name} | ${user.email} | ${user.role}`;
  } catch (err) {
    staffInfo.innerText = 'Server error loading staff info';
  }
}

async function loadJobs() {
  const jobStatus = document.getElementById('jobStatus');
  const tbody = document.getElementById('jobTableBody');

  if (!tbody) return;

  try {
    const res = await fetch('/api/rfq', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      jobStatus.innerText = data.message || 'Failed to load jobs';
      return;
    }

    const rfqs = Array.isArray(data) ? data : (data.rfqs || []);

    const jobs = rfqs.filter((rfq) => {
      const status = String(rfq.status || '').toLowerCase();
      return ['approved', 'quoted', 'closed'].includes(status);
    });

    tbody.innerHTML = '';
    jobStatus.innerText = `${jobs.length} job(s) found`;

    jobs.forEach((job) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(job.id)}</td>
        <td>${escapeHtml(job.full_name)}</td>
        <td>${escapeHtml(job.material)}</td>
        <td>${escapeHtml(job.quantity)}</td>
        <td>${escapeHtml(job.application)}</td>
        <td>${escapeHtml(job.status)}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    jobStatus.innerText = 'Server error loading jobs';
  }
}

async function loadInvoices() {
  const invoiceStatus = document.getElementById('invoiceStatus');
  const tbody = document.getElementById('invoiceTableBody');

  if (!tbody) return;

  try {
    const res = await fetch('/api/invoice', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await safeJson(res);

    if (!res.ok) {
      invoiceStatus.innerText = data.message || 'Failed to load invoices';
      return;
    }

    const invoices = Array.isArray(data) ? data : (data.invoices || []);
    tbody.innerHTML = '';
    invoiceStatus.innerText = `${invoices.length} invoice(s) found`;

    invoices.forEach((inv) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(inv.id)}</td>
        <td>${escapeHtml(inv.invoice_no)}</td>
        <td>${escapeHtml(inv.rfq_id)}</td>
        <td>${escapeHtml(inv.total)}</td>
        <td>${escapeHtml(inv.status)}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    invoiceStatus.innerText = 'Server error loading invoices';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStaffInfo();
  loadJobs();
  loadInvoices();
});``