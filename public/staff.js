const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
const currentRole = String(currentUser.role || localStorage.getItem('role') || '').trim().toLowerCase();

if (!token || !currentRole) {
  window.location.href = '/login.html';
}

if (currentRole === 'admin') {
  window.location.href = '/admin-dashboard.html';
}

let lastTaskIds = new Set();
let firstTaskLoad = true;
let tenHourReminderShown = false;
let staffStockCache = [];
let staffStockOutCache = [];
let lastAnnouncementIds = new Set();
let firstAnnouncementLoad = true;

const clockInMessages = [
  'Today is another chance to build something precise, useful, and proudly Voxel Veda.',
  'Your shift has started. Bring focus, care, and steady energy to every task today.',
  'Great work starts with one clean first step. You are clocked in and ready to move.',
  'You are on shift now. Make today count with quality, teamwork, and sharp attention.'
];

const clockOutMessages = [
  'Shift complete. Thank you for the work, care, and effort you put in today.',
  'You are clocked out. Rest well knowing today moved the team forward.',
  'Good work today. Every finished task adds strength to the whole operation.',
  'Shift ended. Recharge well, and carry today’s wins into tomorrow.'
];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('role');
  window.location.href = '/login.html';
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
  return `$${Number(value || 0).toFixed(2)}`;
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
}

function hasPermission(permission) {
  const user = getStoredUser();
  const role = String(user.role || currentRole || '').trim().toLowerCase();
  if (role === 'admin') return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(permission);
}

function applyPermissionUI() {
  const canUseStock = hasPermission('stock');

  document.querySelectorAll('.nav-btn.permission-stock').forEach((el) => {
    el.classList.toggle('hidden-section', !canUseStock);
  });

  if (!canUseStock) {
    document.querySelectorAll('section.permission-stock').forEach((el) => {
      el.classList.add('hidden-section');
    });
    const activeStockNav = document.querySelector('.nav-btn.permission-stock.active');
    if (activeStockNav) document.querySelector('[data-section="dashboardSection"]')?.click();
  }
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
  }, 3500);
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
  primaryBtn.onclick = onPrimary;
  backdrop.classList.add('active');
}

function hideStaffDialog() {
  document.getElementById('staffDialogBackdrop')?.classList.remove('active');
}

function closeStaffDialog(event) {
  if (event?.target?.id === 'staffDialogBackdrop') hideStaffDialog();
}

function pickMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

async function sendShiftNotification(title, body) {
  const allowed = await requestNotificationPermission();

  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png'
  });
}

async function sendStaffNotification(title, body) {
  const allowed = await requestNotificationPermission();
  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png'
  });
}

function announcementBadgeClass(priority) {
  const clean = String(priority || 'normal').toLowerCase();
  if (clean === 'urgent') return 'badge danger-badge';
  if (clean === 'high') return 'badge active-badge';
  return 'badge';
}

function renderAnnouncements(rows) {
  const list = document.getElementById('announcementList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">No active announcements right now.</div>`;
    return;
  }

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
      list.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Failed to load announcements')}</div>`;
      return;
    }

    const rows = data.announcements || [];
    renderAnnouncements(rows);
    await notifyNewAnnouncements(rows);
  } catch {
    list.innerHTML = `<div class="empty-state">Server error loading announcements.</div>`;
  }
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

  if (clockInBtn) {
    clockInBtn.style.display = isClockedIn ? 'none' : 'inline-block';
  }

  if (clockOutBtn) {
    clockOutBtn.style.display = isClockedIn ? 'inline-block' : 'none';
  }
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

      if (target === 'stockInSection') loadStaffStock();
      if (target === 'stockOutSection') loadStaffStockOut();
    });
  });
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
      return;
    }

    const user = data.user;
    localStorage.setItem('user', JSON.stringify(user));
    applyPermissionUI();
    const role = String(user.role || '').trim().toLowerCase();

    if (role === 'admin') {
      window.location.href = '/admin-dashboard.html';
      return;
    }

    staffInfo.innerText = `${user.name} | ${user.email} | ${role}`;

    if (sidebarStaffName) {
      sidebarStaffName.innerText = user.name || 'Staff User';
    }

    if (hasPermission('stock')) {
      await loadStaffStock();
      await loadStaffStockOut();
    }
  } catch {
    staffInfo.innerText = 'Server error loading staff info';
    if (sidebarStaffName) sidebarStaffName.innerText = 'Staff';
  }
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

  const today = todayISO();

  const todayCount = tasks.filter((task) => {
    const due = task.due_date ? String(task.due_date).slice(0, 10) : '';
    return due === today && String(task.status || '').toLowerCase() !== 'done';
  }).length;

  const overdueCount = tasks.filter((task) => taskDisplayStatus(task) === 'overdue').length;

  if (todayCountEl) todayCountEl.innerText = todayCount;
  if (overdueCountEl) overdueCountEl.innerText = overdueCount;
}

function notifyNewTasks(tasks) {
  const currentIds = new Set(tasks.map((task) => Number(task.id)));

  if (!firstTaskLoad) {
    const newTasks = tasks.filter((task) => !lastTaskIds.has(Number(task.id)));

    if (newTasks.length > 0) {
      showToast(`${newTasks.length} new task assigned`);
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
  if (!hasPermission('stock')) return;

  const tbody = document.getElementById('staffStockTableBody');
  if (!tbody) return;

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
        <button class="icon-btn" onclick="openStaffStockDialog(${item.id})">Edit</button>
        <button class="icon-btn" onclick="openStaffStockOutDialog(${item.id})">Out</button>
      </td>
    </tr>
  `).join('');
}

function openStaffStockDialog(stockId = null) {
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
  if (!hasPermission('stock')) return;

  const tbody = document.getElementById('staffStockOutTableBody');
  if (!tbody) return;

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
        <button class="icon-btn" onclick="openStaffStockOutById(${item.id})">Edit</button>
        <button class="icon-btn danger-icon" onclick="deleteStaffStockOut(${item.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openStaffStockOutDialog(stockId = null, movement = null) {
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
  const movement = staffStockOutCache.find((row) => Number(row.id) === Number(id));
  if (!movement) {
    showToast('Stock out entry not found');
    return;
  }
  openStaffStockOutDialog(movement.stock_id, movement);
}

async function deleteStaffStockOut(id) {
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
      updateShiftButtons(null);
      await checkTenHourReminder(null);
      return;
    }

    const row = data.attendance;

    status.innerText =
      `Clock In: ${formatDateTime(row.clock_in)} | ` +
      `Clock Out: ${formatDateTime(row.clock_out)} | ` +
      `Hours: ${Number(row.total_hours || 0).toFixed(2)}`;

    updateShiftButtons(row);
    await checkTenHourReminder(row);
  } catch {
    status.innerText = 'Server error loading attendance';
    updateShiftButtons(null);
  }
}

async function clockIn() {
  try {
    const res = await fetch('/api/attendance/clock-in', {
      method: 'POST',
      headers: authHeaders()
    });

    const data = await safeJson(res);

    showToast(data.message || 'Clock in response');

    if (res.ok) {
      const message = pickMessage(clockInMessages);
      const subtext = 'Your shift is started now. Stay safe, stay sharp, and keep the work moving.';
      showShiftDialog('Shift Started', message, subtext);
      await sendShiftNotification('Your shift has started', 'You are clocked in now. Have a focused and productive day.');
    }

    await loadAttendanceStatus();
    await loadTimesheet();
  } catch {
    showToast('Clock in failed');
  }
}

async function clockOut() {
  try {
    const res = await fetch('/api/attendance/clock-out', {
      method: 'POST',
      headers: authHeaders()
    });

    const data = await safeJson(res);

    showToast(data.message || 'Clock out response');

    if (res.ok) {
      const message = pickMessage(clockOutMessages);
      const subtext = 'Your shift is closed. Thank you for your contribution today.';
      showShiftDialog('Shift Complete', message, subtext);
      await sendShiftNotification('Your shift is complete', 'You are clocked out now. Thank you for today’s work.');
    }

    await loadAttendanceStatus();
    await loadTimesheet();
  } catch {
    showToast('Clock out failed');
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

        if (currentWeekRange) {
          currentWeekRange.innerText = `This timesheet is from ${formatShortDate(weekData.week_start)} to ${formatShortDate(weekData.week_end)} of this week`;
        }

        if (weekHours) {
          weekHours.innerText = totalHours.toFixed(2);
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
    await loadMyTasks();
    await loadAnnouncements();
    await loadAttendanceStatus();
    await loadTimesheet();
    if (hasPermission('stock')) {
      await loadStaffStock();
      await loadStaffStockOut();
    }
  }, 10000);
}

/* ================= STARTUP ================= */

document.addEventListener('DOMContentLoaded', () => {
  applyPermissionUI();
  setupStaffNavigation();
  loadStaffInfo();
  loadMyTasks();
  loadAnnouncements();
  loadAttendanceStatus();
  loadTimesheet();
  if (hasPermission('stock')) {
    loadStaffStock();
    loadStaffStockOut();
  }
  startAutoRefresh();
});
