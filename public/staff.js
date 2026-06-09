const token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentRole = String(currentUser.role || localStorage.getItem('role') || '').trim().toLowerCase();
let redirectingToLogin = false;

if (!token) redirectToLogin('Please login to continue.');

if (currentRole === 'admin') {
  window.location.href = '/admin-dashboard.html';
}

let lastTaskIds = new Set();
let firstTaskLoad = true;
let tenHourReminderShown = false;
let staffStockCache = [];
let staffStockOutCache = [];
let staffMeetingCache = [];
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
  "Shift ended. Recharge well, and carry today's wins into tomorrow."
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
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('role');
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

function hasPermission(permission) {
  const user = getStoredUser();
  const role = String(user.role || currentRole || '').trim().toLowerCase();
  if (role === 'admin') return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (permission === 'stock') {
    return permissions.includes('stock') || permissions.includes('stock_in') || permissions.includes('stock_out');
  }
  if (permission === 'stock_in' || permission === 'stock_out') {
    return permissions.includes(permission) || permissions.includes('stock');
  }
  return permissions.includes(permission);
}

function applyPermissionUI() {
  const canUseTasks = hasPermission('tasks');
  const canUseAttendance = hasPermission('attendance');
  const canUseRoster = hasPermission('roster');
  const canUseMeetings = hasPermission('meetings');
  const canUseStockIn = hasPermission('stock_in');
  const canUseStockOut = hasPermission('stock_out');
  const canUseStock = hasPermission('stock') || canUseStockIn || canUseStockOut;
  const canUseFinance = hasPermission('invoices') || hasPermission('expenses');

  setPermissionVisibility('.permission-tasks', canUseTasks);
  setPermissionVisibility('.permission-attendance', canUseAttendance);
  setPermissionVisibility('.permission-roster', canUseRoster);
  setPermissionVisibility('.permission-meetings', canUseMeetings);
  setPermissionVisibility('.permission-stock', canUseStock);
  setPermissionVisibility('.permission-stock-in', canUseStockIn);
  setPermissionVisibility('.permission-stock-out', canUseStockOut);
  setPermissionVisibility('.permission-finance', canUseFinance);

  if (document.querySelector('.nav-btn.active.hidden-section')) {
    document.querySelector('[data-section="dashboardSection"]')?.click();
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
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
  const allowed = await requestNotificationPermission();

  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png?v=20260601-clean-logo'
  });
}

async function sendStaffNotification(title, body) {
  const allowed = await requestNotificationPermission();
  if (!allowed) return;

  new Notification(title, {
    body,
    icon: '/Frame 1.png?v=20260601-clean-logo'
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
          alert(message);
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
      if (target === 'meetingsSection') loadMyMeetings();
      if (target === 'rosterSection') loadMyRoster();
      toggleMobileMenu(false);
    });
  });
}

function goStaffSection(sectionId) {
  document.querySelector(`[data-section="${sectionId}"]`)?.click();
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

    if (role === 'admin') {
      window.location.href = '/admin-dashboard.html';
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
  if (!hasPermission('stock_out')) return;

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
  const next = rows[0];
  setText('staffRosterCount', rows.length);
  setText('staffRosterHours', rows.reduce((sum, row) => sum + rosterShiftHours(row), 0).toFixed(2));
  setText('staffNextShiftDate', next ? formatShortDate(next.shift_date) : '-');
  setText('staffNextShiftTime', next ? `${next.start_time} - ${next.end_time}` : 'No upcoming shift');
}

function renderMyRoster(rows) {
  const list = document.getElementById('staffRosterList');
  if (!list) return;

  updateStaffRosterMetrics(rows);

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">No rostered shifts are assigned yet.</div>';
    return;
  }

  list.innerHTML = rows.map((shift) => `
    <article class="roster-shift-card">
      <div class="roster-date-block">
        <strong>${escapeHtml(formatShortDate(shift.shift_date))}</strong>
        <span>${escapeHtml(shift.status || 'scheduled')}</span>
      </div>
      <div class="roster-shift-main">
        <h3>${escapeHtml(shift.role_label || 'Assigned shift')}</h3>
        <p>${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)} | ${escapeHtml(rosterShiftHours(shift).toFixed(2))} hrs</p>
        <small>${escapeHtml(shift.location || 'Location not set')}</small>
        ${shift.notes ? `<div class="roster-note">${escapeHtml(shift.notes)}</div>` : ''}
      </div>
    </article>
  `).join('');
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
      await sendShiftNotification('Your shift is complete', "You are clocked out now. Thank you for today's work.");
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
    await loadStaffFinanceOverview();
    if (hasPermission('stock')) {
      await loadStaffStock();
      await loadStaffStockOut();
    }
    if (hasPermission('meetings')) {
      await loadMyMeetings();
    }
    if (hasPermission('roster')) {
      await loadMyRoster();
    }
  }, 10000);
}

/* ================= STARTUP ================= */

async function bootStaffDashboard() {
  try {
    installAccessDeniedHandler();
    setupStaffNavigation();
    startResponsiveTableObserver();

    const user = await loadStaffInfo();
    if (!user || redirectingToLogin) return;

    applyPermissionUI();

    await Promise.all([
      loadMyTasks(),
      loadAnnouncements(),
      loadAttendanceStatus(),
      loadTimesheet(),
      loadMyRoster(),
      loadStaffFinanceOverview()
    ]);

    if (hasPermission('stock')) {
      await loadStaffStock();
      await loadStaffStockOut();
    }
    if (hasPermission('meetings')) {
      await loadMyMeetings();
    }
    if (hasPermission('roster')) {
      await loadMyRoster();
    }

    startAutoRefresh();
  } catch (err) {
    if (!redirectingToLogin) {
      console.error('STAFF DASHBOARD STARTUP ERROR:', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', bootStaffDashboard);
