const token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentRole = String(currentUser.role || localStorage.getItem('role') || '').trim().toLowerCase();
let redirectingToLogin = false;

if (!token) redirectToLogin('Please login to continue.');

if (currentRole && currentRole !== 'admin') {
  alert('Access denied. Admin only.');
  window.location.href = '/dashboard';
}

let rfqChartInstance = null;
let invoiceChartInstance = null;
let financeChartInstance = null;
let supplierDebtChartInstance = null;
let expenseCategoryChartInstance = null;
let expenseMonthChartInstance = null;
let dashboardStatsCache = null;
let invoiceCache = [];
let manualInvoiceCustomerMatches = [];
let stockCache = [];
let stockUsageCache = [];
let customerCache = [];
let supplierCache = [];
let expenseCache = [];
let expensePage = 1;
let expenseLimit = 25;
let complianceCache = [];
let competitorCache = [];
let materialCache = {
  raw_material: [],
  packaging: []
};
let staffCache = [];
let attendanceCache = [];
let announcementCache = [];
let taskCache = [];
let meetingCache = [];
let rosterCache = [];
let staffMessageCache = [];
let staffWorkRequestCache = [];
let attendanceSnapshot = new Map();
let attendanceFirstLoad = true;
let shiftQrTimer = null;
let shiftQrCountdownTimer = null;
let shiftQrSecondsLeft = 20;
const registerPagerState = {};
const REGISTER_PAGE_SIZES = [10, 25, 50, 100, 200];

const ACCESS_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'rfqs', label: 'RFQs' },
  { id: 'rfqs_input', label: 'RFQs Input/Edit' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'invoices_input', label: 'Invoices Input/Edit' },
  { id: 'customers', label: 'Customers' },
  { id: 'customers_input', label: 'Customers Input/Edit' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'suppliers_input', label: 'Suppliers Input/Edit' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'expenses_input', label: 'Expenses Input/Edit' },
  { id: 'compliance', label: 'Compliance & Licences' },
  { id: 'compliance_input', label: 'Compliance Input/Edit' },
  { id: 'competitors', label: 'Competitors & Industry' },
  { id: 'competitors_input', label: 'Competitors Input/Edit' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'tasks_input', label: 'Tasks/Announcements Input/Edit' },
  { id: 'roster', label: 'Roster' },
  { id: 'roster_input', label: 'Roster Input/Edit' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'attendance_input', label: 'Attendance Input/Edit' },
  { id: 'attendance_qr_bypass', label: 'QR Shift Bypass' },
  { id: 'leave', label: 'Leave Requests' },
  { id: 'availability', label: 'Availability' },
  { id: 'documents', label: 'Staff Documents' },
  { id: 'forms', label: 'Forms & Checklists' },
  { id: 'messages', label: 'Messages' },
  { id: 'staff', label: 'Staff' },
  { id: 'stock', label: 'Stock Management' },
  { id: 'stock_in', label: 'Stock In' },
  { id: 'stock_in_input', label: 'Stock In Input/Edit' },
  { id: 'stock_out', label: 'Stock Out' },
  { id: 'stock_out_input', label: 'Stock Out Input/Edit' },
  { id: 'raw_material', label: 'Raw Material' },
  { id: 'raw_material_input', label: 'Raw Material Input/Edit' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'packaging_input', label: 'Packaging Input/Edit' },
  { id: 'meetings', label: 'Meetings & Inspections' },
  { id: 'meetings_input', label: 'Meetings Input/Edit' },
  { id: 'settings', label: 'Settings' }
];

const COMPANY_FORMS = [
  { category: 'Policy', title: 'Privacy, Confidentiality & Data Handling', file: '/forms/company/privacy-confidentiality-policy.pdf', visual: 'contract', note: 'Use for staff, contractors, suppliers, customers or visitors who access protected company information.' },
  { category: 'Operations', title: 'Delivery Docket / Dispatch Form', file: '/forms/company/delivery-docket-form.pdf', visual: 'dispatch', note: 'Use when finished goods, samples or job items leave the workshop.' },
  { category: 'HR', title: 'Staff Joining Form', file: '/forms/company/staff-joining-form.pdf', visual: 'staff', note: 'Use for onboarding, access approval, emergency contact and PPE issue records.' },
  { category: 'Safety', title: 'Safety Induction Form', file: '/forms/company/safety-induction-form.pdf', visual: 'safety', note: 'Use before staff, contractors or visitors work around production areas.' },
  { category: 'Client', title: 'Client / Project Intake Form', file: '/forms/company/client-intake-form.pdf', visual: 'client', note: 'Use before quote or job start to record customer, technical and quality requirements.' },
  { category: 'Contract', title: 'Job Contract / Work Agreement', file: '/forms/company/job-contract-agreement.pdf', visual: 'contract', note: 'Use when scope, payment, delivery and variation terms need written acceptance.' },
  { category: 'Safety', title: 'Incident / Near Miss Report', file: '/forms/company/incident-near-miss-report.pdf', visual: 'incident', note: 'Use immediately after a near miss, injury, machine event, spill or property damage.' },
  { category: 'Machinery', title: 'Machinery Pre-Start Checklist', file: '/forms/company/machinery-prestart-checklist.pdf', visual: 'machine', note: 'Use before operating machinery, printers, tools, compressors or workshop equipment.' },
  { category: 'Safety', title: 'Hazard & Risk Assessment Form', file: '/forms/company/hazard-risk-assessment.pdf', visual: 'risk', note: 'Use before high-risk, changed, unfamiliar or non-routine work.' },
  { category: 'Charts', title: 'Workshop Hygiene & Housekeeping Chart', file: '/forms/company/hygiene-housekeeping-chart.pdf', visual: 'hygiene', note: 'Display for clean, organised and inspection-ready work areas.' },
  { category: 'Charts', title: 'PPE & Safety Handling Rules Chart', file: '/forms/company/ppe-safety-rules-chart.pdf', visual: 'ppe', note: 'Display at entry or production areas for minimum PPE and handling rules.' },
  { category: 'Charts', title: 'Machinery Safety Chart', file: '/forms/company/machinery-safety-chart.pdf', visual: 'machinery-chart', note: 'Display near machines for guarding, isolation and safe operation rules.' },
  { category: 'Charts', title: 'Hazard & Chemical Handling Chart', file: '/forms/company/hazard-chemical-handling-chart.pdf', visual: 'hazard-chart', note: 'Display near chemical, resin, solvent and material storage areas.' },
  { category: 'Safety', title: 'Visitor / Contractor Induction', file: '/forms/company/visitor-contractor-induction.pdf', visual: 'visitor', note: 'Use before visitors or contractors enter production, storage or machinery areas.' }
];

const ADDITIONAL_COMPANY_FORMS = [
  { category: 'Supplier', title: 'Supplier Onboarding & Approval Form', file: '/forms/company/supplier-onboarding-approval.pdf', visual: 'supplier', note: 'Use before approving a supplier for raw material, packaging, transport, tooling, outsourced manufacturing or services.' },
  { category: 'Finance', title: 'Purchase Order & Supplier Bill Register', file: '/forms/company/purchase-order-supplier-bill-register.pdf', visual: 'contract', note: 'Use to control purchase orders, supplier bills, GST, payment status, due dates and approval evidence.' },
  { category: 'Quality', title: 'Raw Material Receiving & Traceability Form', file: '/forms/company/raw-material-receiving-traceability.pdf', visual: 'risk', note: 'Use when receiving material so batch, supplier, COA/SDS, quantity, condition and release status are traceable.' },
  { category: 'Quality', title: 'Packaging Receiving & Release Form', file: '/forms/company/packaging-receiving-release.pdf', visual: 'dispatch', note: 'Use when receiving cartons, labels, bags, inserts or packaging so quality release is recorded before use.' },
  { category: 'Production', title: 'Job Traveller / Production Batch Record', file: '/forms/company/job-traveller-production-batch-record.pdf', visual: 'machine', note: 'Use for every production job to connect customer order, drawing, material batch, operator checks and final release.' },
  { category: 'Quality', title: 'Quality Inspection & Release Certificate', file: '/forms/company/quality-inspection-release-certificate.pdf', visual: 'safety', note: 'Use before dispatch when dimensions, finish, quantity, test results and customer requirements must be signed off.' },
  { category: 'Quality', title: 'Non-Conformance & Corrective Action Form', file: '/forms/company/non-conformance-corrective-action.pdf', visual: 'incident', note: 'Use when product, material, process or delivery fails requirement and corrective action is required.' },
  { category: 'Quality', title: 'Customer Complaint & Product Failure Investigation', file: '/forms/company/customer-complaint-product-failure.pdf', visual: 'client', note: 'Use when a customer reports a product issue, failure, defect, shortage, delay or quality concern.' },
  { category: 'Machinery', title: 'Calibration & Measurement Tool Register', file: '/forms/company/calibration-measurement-tool-register.pdf', visual: 'machinery-chart', note: 'Use to track calipers, gauges, scales, test equipment and calibration status for inspection confidence.' },
  { category: 'Machinery', title: 'Preventive Maintenance & Service Log', file: '/forms/company/preventive-maintenance-service-log.pdf', visual: 'machine', note: 'Use for printers, tools, compressors and plant servicing, repairs, downtime and next maintenance date.' },
  { category: 'Safety', title: 'SWMS / Job Safety Analysis Form', file: '/forms/company/swms-jsa-work-method-statement.pdf', visual: 'risk', note: 'Use before higher-risk or non-routine work to record hazards, controls, PPE, isolation and worker sign-off.' },
  { category: 'Safety', title: 'Emergency Drill & Evacuation Checklist', file: '/forms/company/emergency-drill-evacuation-checklist.pdf', visual: 'safety', note: 'Use for evacuation practice, emergency readiness, assembly point checks and action follow-up.' },
  { category: 'Safety', title: 'First Aid & Fire Safety Inspection', file: '/forms/company/first-aid-fire-safety-inspection.pdf', visual: 'ppe', note: 'Use to inspect first-aid kits, extinguishers, exits, signage and emergency access.' },
  { category: 'HR', title: 'Training & Competency Matrix', file: '/forms/company/training-competency-matrix.pdf', visual: 'staff', note: 'Use to prove staff training, machinery authorisation, safety competence and refresher dates.' },
  { category: 'HR', title: 'Timesheet & Roster Approval Record', file: '/forms/company/timesheet-roster-approval-record.pdf', visual: 'staff', note: 'Use for weekly timesheet approval, roster exceptions, leave notes, overtime and payroll readiness.' },
  { category: 'Import / Export', title: 'Import & Customs Document Checklist', file: '/forms/company/import-customs-document-checklist.pdf', visual: 'contract', note: 'Use before importing goods to confirm supplier invoice, packing list, permits, declarations, duty/GST and freight records.' },
  { category: 'Import / Export', title: 'Export Dispatch Document Checklist', file: '/forms/company/export-dispatch-document-checklist.pdf', visual: 'dispatch', note: 'Use before exporting samples, goods or parts to confirm receiver details, invoice, customs declaration and carrier evidence.' },
  { category: 'Environment', title: 'Waste Disposal & Environmental Register', file: '/forms/company/waste-disposal-environment-register.pdf', visual: 'hazard-chart', note: 'Use for scrap, chemicals, resin, failed material, packaging waste and disposal evidence.' }
];

COMPANY_FORMS.push(...ADDITIONAL_COMPANY_FORMS);

const COMPANY_FORM_VERSION = '20260725-engineering-form-pack';

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
    localStorage.clear();
    window.location.href = '/login';
  }
}

function isMobileShellViewport() {
  return window.matchMedia('(max-width: 1023px)').matches;
}

function toggleMobileMenu(open) {
  const shouldOpen = typeof open === 'boolean'
    ? open
    : !document.body.classList.contains('mobile-menu-open');
  document.body.classList.toggle('mobile-menu-open', shouldOpen);
  document.documentElement.classList.toggle('mobile-menu-open', shouldOpen);
  document.body.classList.toggle('vv-scroll-locked', shouldOpen);
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.querySelector('.mobile-sidebar-backdrop');
  sidebar?.classList.toggle('is-open', shouldOpen);
  backdrop?.classList.toggle('is-open', shouldOpen);
  document.querySelectorAll('.topbar-menu-btn, .mobile-menu-btn').forEach((btn) => {
    btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  });
  if (sidebar) sidebar.setAttribute('aria-hidden', isMobileShellViewport() && !shouldOpen ? 'true' : 'false');
  if (backdrop) backdrop.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  if (shouldOpen) {
    closeNotificationPanel();
    window.setTimeout(() => document.querySelector('.sidebar .nav-btn, .sidebar .nav-group-toggle')?.focus?.(), 80);
  }
}

function closeMobileMenuOnCompact() {
  if (isMobileShellViewport()) toggleMobileMenu(false);
}

function compactName(value, fallback = 'Admin') {
  return String(value || fallback).trim() || fallback;
}

function syncTopbarUser(user = currentUser) {
  const name = compactName(user?.name || user?.username || user?.email, 'Admin');
  const initial = name.slice(0, 1).toUpperCase();
  const initialEl = document.getElementById('profileInitial');
  const nameEl = document.getElementById('profileNameLabel');
  if (initialEl) initialEl.innerText = initial;
  if (nameEl) nameEl.innerText = name.split(' ')[0] || name;
}

function setActivePageTitle(btn) {
  const title = btn?.dataset?.title || btn?.textContent?.trim() || 'Operational Dashboard';
  const titleEl = document.getElementById('activePageTitle');
  if (titleEl) titleEl.innerText = title === 'Home' ? 'Operational Dashboard' : title;
}

function closeNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  const bell = document.getElementById('notificationBell');
  if (panel) panel.hidden = true;
  if (bell) bell.setAttribute('aria-expanded', 'false');
}

function toggleNotificationPanel(event) {
  event?.stopPropagation?.();
  const panel = document.getElementById('notificationPanel');
  const bell = document.getElementById('notificationBell');
  if (!panel) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  if (bell) bell.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  if (willOpen) toggleMobileMenu(false);
}

function openNotificationTarget(sectionId) {
  if (sectionId) goSection(sectionId);
  closeNotificationPanel();
}

function addShellNotification(list, type, title, body, sectionId) {
  list.push({ type, title, body, sectionId });
}

function buildShellNotifications() {
  const list = [];
  const pendingRfqs = Number(dashboardStatsCache?.rfqs?.pending_rfqs || 0);
  if (pendingRfqs > 0) {
    addShellNotification(list, 'rfq', 'New RFQ received', `${pendingRfqs} RFQ${pendingRfqs === 1 ? '' : 's'} waiting for review.`, 'rfqSection');
  }

  const openInvoices = invoiceCache.filter((invoice) => Number(invoice.balance_due || 0) > 0 || String(invoice.status || '').toLowerCase().includes('overdue'));
  if (openInvoices.length) {
    const total = openInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0);
    addShellNotification(list, 'invoice', 'Invoice overdue', `${openInvoices.length} invoice${openInvoices.length === 1 ? '' : 's'} need payment follow-up. ${formatMoney(total)} open.`, 'invoiceSection');
  }

  const supplierBills = expenseCache.filter((expense) => !['paid', 'reimbursed', 'closed'].includes(String(expense.status || '').toLowerCase()));
  if (supplierBills.length) {
    const total = supplierBills.reduce((sum, expense) => sum + Number(expense.total_amount || 0), 0);
    addShellNotification(list, 'supplier', 'Supplier payment due', `${supplierBills.length} supplier bill${supplierBills.length === 1 ? '' : 's'} pending. ${formatMoney(total)} outstanding.`, 'expenseSection');
  }

  const materialRows = [...(materialCache.raw_material || []), ...(materialCache.packaging || [])];
  const lowStock = materialRows.filter((item) => {
    const level = Number(item.reorder_level || item.minimum_stock || 0);
    const qty = Number(item.current_qty || item.current_quantity || item.available_qty || 0);
    return level > 0 && qty <= level;
  });
  if (lowStock.length) {
    addShellNotification(list, 'stock', 'Low raw material stock', `${lowStock.length} raw/packaging item${lowStock.length === 1 ? '' : 's'} at reorder level.`, 'rawMaterialSection');
  }

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const dueCompliance = complianceCache.filter((row) => {
    const dateValue = row.expiry_date || row.renewal_date || row.due_date;
    const due = dateValue ? new Date(dateValue).getTime() : 0;
    const status = String(row.status || '').toLowerCase();
    return status.includes('due') || status.includes('renew') || (due && due - now <= thirtyDays);
  });
  if (dueCompliance.length) {
    addShellNotification(list, 'compliance', 'Compliance/licence reminder', `${dueCompliance.length} compliance record${dueCompliance.length === 1 ? '' : 's'} need attention.`, 'complianceSection');
  }
  const openStaffMessages = staffMessageCache.filter((message) => !['reviewed', 'approved', 'closed', 'deleted'].includes(String(message.status || '').toLowerCase()));
  if (openStaffMessages.length) {
    const label = openStaffMessages.length === 1 ? 'message' : 'messages';
    addShellNotification(list, 'message', 'Staff message received', String(openStaffMessages.length) + ' staff ' + label + ' waiting for admin review.', 'staffSection');
  }

  const openWorkHubRequests = staffWorkRequestCache.filter((request) => isOpenWorkHubStatus(request.status));
  if (openWorkHubRequests.length) {
    addShellNotification(list, 'workhub', 'Staff work request received', String(openWorkHubRequests.length) + ' staff request' + (openWorkHubRequests.length === 1 ? '' : 's') + ' waiting for admin action.', 'staffSection');
  }
  const upcomingMeetings = meetingCache.filter((meeting) => {
    const status = String(meeting.status || '').toLowerCase();
    if (['completed', 'cancelled'].includes(status)) return false;
    const dateValue = meeting.meeting_date || meeting.date || meeting.due_date;
    const due = dateValue ? new Date(dateValue).getTime() : 0;
    return due && due >= now - 24 * 60 * 60 * 1000 && due - now <= 7 * 24 * 60 * 60 * 1000;
  });
  if (upcomingMeetings.length) {
    addShellNotification(list, 'meeting', 'Meeting / inspection coming up', `${upcomingMeetings.length} scheduled meeting${upcomingMeetings.length === 1 ? '' : 's'} in the next 7 days.`, 'meetingSection');
  }

  return list.slice(0, 8);
}

function renderNotificationDropdown() {
  const listEl = document.getElementById('notificationList');
  const emptyEl = document.getElementById('notificationEmpty');
  const badgeEl = document.getElementById('notificationBadge');
  const countEl = document.getElementById('notificationPanelCount');
  if (!listEl || !emptyEl || !badgeEl || !countEl) return;

  const notifications = buildShellNotifications();
  badgeEl.innerText = notifications.length > 9 ? '9+' : String(notifications.length);
  badgeEl.classList.toggle('hidden-section', notifications.length === 0);
  countEl.innerText = notifications.length ? `${notifications.length} new` : 'All clear';
  emptyEl.style.display = notifications.length ? 'none' : 'block';

  listEl.innerHTML = notifications.map((item) => `
    <button class="notification-item" type="button" onclick="openNotificationTarget('${escapeHtml(item.sectionId)}')">
      <span class="notification-dot ${escapeHtml(item.type)}"></span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.body)}</small>
      </span>
    </button>
  `).join('');
}

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.notification-center')) closeNotificationPanel();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeNotificationPanel();
    toggleMobileMenu(false);
  }
});

window.addEventListener('resize', () => {
  window.requestAnimationFrame(() => {
    closeResponsiveOverlaysForViewport();
    enhanceResponsiveTables();
  });
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

function normalizeActionButtons(root = document) {
  root.querySelectorAll('button:not([type])').forEach((button) => {
    button.type = 'button';
  });
}

function closeResponsiveOverlaysForViewport() {
  if (window.innerWidth >= 1024) {
    toggleMobileMenu(false);
    closeNotificationPanel();
  } else if (!document.body.classList.contains('mobile-menu-open')) {
    document.querySelector('.sidebar')?.setAttribute('aria-hidden', 'true');
  }
}

function installMobileShellControls() {
  document.querySelectorAll('[data-mobile-menu-action]').forEach((control) => {
    if (control.dataset.mobileMenuBound === 'true') return;
    control.dataset.mobileMenuBound = 'true';
    control.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = control.dataset.mobileMenuAction;
      if (action === 'close') toggleMobileMenu(false);
      else if (action === 'open') toggleMobileMenu(true);
      else toggleMobileMenu();
    });
  });

  const sidebar = document.getElementById('primarySidebar');
  if (sidebar) sidebar.setAttribute('aria-hidden', isMobileShellViewport() ? 'true' : 'false');
}

function startResponsiveTableObserver() {
  normalizeActionButtons();
  enhanceResponsiveTables();

  let pendingFrame = false;
  const observer = new MutationObserver(() => {
    if (pendingFrame) return;
    pendingFrame = true;
    window.requestAnimationFrame(() => {
      pendingFrame = false;
      normalizeActionButtons();
      enhanceResponsiveTables();
    });
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

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function chronologicalRows(rows = []) {
  return [...rows].sort((a, b) => {
    const aId = Number(a.id || 0);
    const bId = Number(b.id || 0);
    if (aId && bId && aId !== bId) return aId - bId;

    const aTime = new Date(a.created_at || a.updated_at || a.work_date || a.meeting_date || 0).getTime() || 0;
    const bTime = new Date(b.created_at || b.updated_at || b.work_date || b.meeting_date || 0).getTime() || 0;
    return aTime - bTime;
  });
}

function ensureRegisterControls(key, tbody, onChange) {
  const tableCard = tbody.closest('.table-wrap') || tbody.closest('.card');
  if (!tableCard || tableCard.querySelector(`[data-register-controls="${key}"]`)) return;

  const controls = document.createElement('div');
  controls.className = 'register-control-panel';
  controls.dataset.registerControls = key;
  controls.innerHTML = `
    <div>
      <strong>Register view</strong>
      <span data-register-info="${key}">Loading entries...</span>
    </div>
    <div class="register-control-actions">
      <label>
        <span>Rows</span>
        <select data-register-size="${key}">
          ${REGISTER_PAGE_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="secondary-btn" data-register-prev="${key}">Previous</button>
      <button type="button" class="secondary-btn" data-register-next="${key}">Next</button>
    </div>
  `;

  const table = tbody.closest('table');
  tableCard.insertBefore(controls, table || tableCard.firstChild);

  controls.querySelector(`[data-register-size="${key}"]`)?.addEventListener('change', (event) => {
    registerPagerState[key] = {
      ...(registerPagerState[key] || {}),
      page: 1,
      pageSize: Number(event.target.value || 25)
    };
    onChange();
  });
  controls.querySelector(`[data-register-prev="${key}"]`)?.addEventListener('click', () => {
    const state = registerPagerState[key] || {};
    registerPagerState[key] = { ...state, page: Math.max(1, Number(state.page || 1) - 1) };
    onChange();
  });
  controls.querySelector(`[data-register-next="${key}"]`)?.addEventListener('click', () => {
    const state = registerPagerState[key] || {};
    registerPagerState[key] = { ...state, page: Number(state.page || 1) + 1 };
    onChange();
  });
}

function setRegisterLoading(tbody, colspan, message = 'Loading data...') {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${colspan}"><span class="table-loading-state">${escapeHtml(message)}</span></td></tr>`;
}

function renderRegisterPage({ key, tbody, rows, colspan, emptyMessage, rowRenderer, onChange }) {
  const orderedRows = chronologicalRows(rows || []);
  registerPagerState[key] = {
    page: Number(registerPagerState[key]?.page || 1),
    pageSize: Number(registerPagerState[key]?.pageSize || 25)
  };

  ensureRegisterControls(key, tbody, onChange || (() => {}));

  const state = registerPagerState[key];
  const totalPages = Math.max(1, Math.ceil(orderedRows.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), totalPages);

  const start = (state.page - 1) * state.pageSize;
  const pageRows = orderedRows.slice(start, start + state.pageSize);

  const infoEl = document.querySelector(`[data-register-info="${key}"]`);
  const sizeEl = document.querySelector(`[data-register-size="${key}"]`);
  const prevBtn = document.querySelector(`[data-register-prev="${key}"]`);
  const nextBtn = document.querySelector(`[data-register-next="${key}"]`);

  if (sizeEl) sizeEl.value = String(state.pageSize);
  if (infoEl) {
    const from = orderedRows.length ? start + 1 : 0;
    const to = Math.min(start + state.pageSize, orderedRows.length);
    infoEl.textContent = `${from}-${to} of ${orderedRows.length} entries | oldest first, newest at bottom`;
  }
  if (prevBtn) prevBtn.disabled = state.page <= 1;
  if (nextBtn) nextBtn.disabled = state.page >= totalPages;

  if (!orderedRows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}">${escapeHtml(emptyMessage)}</td></tr>`;
    return orderedRows;
  }

  tbody.innerHTML = pageRows.map((row, index) => rowRenderer(row, start + index)).join('');
  return orderedRows;
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
  }, 3200);
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

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

async function sendAdminNotification(title, body) {
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
          const message = data.message || "You don't have access to input or change data. Please contact admin.";
          showToast(message);
          sendAdminNotification('Access not enabled', message);
        }
      }).catch(() => {});
    }
    return res;
  };
}

function accessAttemptSeenKey() {
  return 'voxel-admin-seen-access-attempts';
}

function getSeenAccessAttempts() {
  try {
    return new Set(JSON.parse(localStorage.getItem(accessAttemptSeenKey()) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeenAccessAttempts(ids) {
  localStorage.setItem(accessAttemptSeenKey(), JSON.stringify(Array.from(ids).slice(-200)));
}

async function loadAccessAttempts() {
  if (currentRole !== 'admin') return;

  const res = await fetch('/api/access-attempts', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);
  if (!res.ok) return;
  const attempts = data.attempts || [];
  const seen = getSeenAccessAttempts();
  const fresh = attempts.filter((attempt) => !seen.has(Number(attempt.id)));

  attempts.forEach((attempt) => seen.add(Number(attempt.id)));
  saveSeenAccessAttempts(seen);

  fresh.reverse().forEach((attempt) => {
    const who = attempt.user_name || attempt.user_email || 'A user';
    const section = String(attempt.section || 'restricted input');
    const message = `${who} tried to input/change data without access: ${section}`;
    showToast(message);
    sendAdminNotification('Restricted access attempt', message);
  });
}

function showDialog(title, bodyHtml, onPrimary, primaryText = 'Save') {
  const backdrop = document.getElementById('dialogBackdrop');
  const panel = document.querySelector('.dialog-panel');
  const titleEl = document.getElementById('dialogTitle');
  const bodyEl = document.getElementById('dialogBody');
  const primaryBtn = document.getElementById('dialogPrimaryBtn');

  if (!backdrop || !titleEl || !bodyEl || !primaryBtn) return;

  panel?.classList.remove('wide-dialog', 'material-dialog', 'supplier-dialog', 'compliance-dialog', 'manual-invoice-dialog', 'staff-access-dialog', 'admin-workhub-dialog');
  titleEl.innerText = title;
  bodyEl.innerHTML = bodyHtml;
  primaryBtn.innerText = primaryText;
  primaryBtn.onclick = onPrimary;
  normalizeActionButtons(bodyEl);
  enhanceResponsiveTables();
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
    if (!btn.dataset.section) return;
    btn.onclick = () => {
      const targetSection = document.getElementById(btn.dataset.section);
      if (!targetSection) {
        showToast('Section is not available yet');
        return;
      }

      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setActivePageTitle(btn);
      closeNotificationPanel();

      document.querySelectorAll('.page-section').forEach((s) => s.classList.add('hidden-section'));
      targetSection.classList.remove('hidden-section');

      if (btn.dataset.section === 'customerSection') loadCustomers();
      if (btn.dataset.section === 'supplierSection') loadSuppliers();
      if (btn.dataset.section === 'expenseSection') loadExpenses();
      if (btn.dataset.section === 'competitorSection') loadCompetitors();
      if (btn.dataset.section === 'complianceSection') loadComplianceEntries();
      if (btn.dataset.section === 'rawMaterialSection') loadMaterials('raw_material');
      if (btn.dataset.section === 'packagingSection') loadMaterials('packaging');
      if (btn.dataset.section === 'invoiceSection') loadInvoices();
      if (btn.dataset.section === 'taskSection') {
        loadTasks();
        loadAnnouncements();
      }
      if (btn.dataset.section === 'meetingSection') loadMeetings();
      if (btn.dataset.section === 'rosterSection') loadRoster();
      if (btn.dataset.section === 'shiftQrSection') loadShiftQr();
      if (btn.dataset.section === 'companyFormsSection') renderCompanyForms();
      toggleMobileMenu(false);
    };
  });
}

function goSection(sectionId) {
  const targetSection = document.getElementById(sectionId);
  const btn = document.querySelector('[data-section="' + sectionId + '"]');
  if (!targetSection || !btn) {
    showToast('Section is not available yet');
    document.querySelector('[data-section="dashboardSection"]')?.click();
    return;
  }
  btn.click();
}

function openAdminViewFromUrl() {
  const view = new URLSearchParams(window.location.search).get('view');
  if (!view) return;
  const sections = {
    rfqs: 'rfqSection', invoices: 'invoiceSection', customers: 'customerSection',
    suppliers: 'supplierSection', stock: 'stockSection', 'raw-material': 'rawMaterialSection',
    packaging: 'packagingSection', expenses: 'expenseSection', workforce: 'attendanceSection',
    timesheets: 'attendanceSection', roster: 'rosterSection', staff: 'staffSection',
    compliance: 'complianceSection', forms: 'companyFormsSection', settings: 'settingsSection',
    meetings: 'meetingSection', tasks: 'taskSection'
  };
  if (sections[view]) window.setTimeout(() => goSection(sections[view]), 0);
}

function renderCompanyForms() {
  const panel = document.getElementById('companyFormsLibrary');
  if (!panel) return;

  const category = String(document.getElementById('companyFormCategory')?.value || '').trim();
  const query = String(document.getElementById('companyFormSearch')?.value || '').trim().toLowerCase();

  const rows = COMPANY_FORMS.filter((form) => {
    if (category && form.category !== category) return false;
    if (!query) return true;
    return [form.title, form.category, form.note].some((value) => value.toLowerCase().includes(query));
  });

  if (!rows.length) {
    panel.innerHTML = '<div class="card">No matching company forms found.</div>';
    return;
  }

  const grouped = rows.reduce((acc, form) => {
    acc[form.category] = acc[form.category] || [];
    acc[form.category].push(form);
    return acc;
  }, {});
  const digitalRecords = loadCompanyFormRecords();

  panel.innerHTML = Object.entries(grouped).map(([groupName, forms]) => `
    <div class="card form-group">
      <div class="section-head compact-head">
        <h3>${escapeHtml(groupName)}</h3>
        <span class="live-pill">${forms.length} forms</span>
      </div>
      <div class="form-card-grid">
        ${forms.map((form) => {
          const fileUrl = `${form.file}?v=${COMPANY_FORM_VERSION}`;
          const formKey = companyFormKey(form);
          const savedCount = digitalRecords.filter((record) => record.formKey === formKey).length;
          return `
          <article class="form-card ${form.category === 'Charts' ? 'chart-form-card' : ''}">
            <div class="form-visual form-visual-${escapeHtml(form.visual || form.category.toLowerCase())}">
              <div class="form-visual-screen">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div class="form-visual-badge">${escapeHtml(form.category)}</div>
            </div>
            <span class="status-chip">${escapeHtml(form.category)}</span>
            <h4>${escapeHtml(form.title)}</h4>
            <p>${escapeHtml(form.note)}</p>
            <div class="form-record-line">${savedCount} digital record${savedCount === 1 ? '' : 's'} saved</div>
            <div class="dialog-actions inline-actions form-action-stack">
              <button class="primary-btn" onclick="openCompanyFormFiller('${escapeHtml(formKey)}')">Fill Digitally</button>
              <button class="icon-btn" onclick="openCompanyFormEntries('${escapeHtml(formKey)}')">Entries</button>
              <button class="icon-btn" onclick="window.open('${escapeHtml(fileUrl)}', '_blank', 'noopener')">Preview PDF</button>
              <a class="icon-btn" href="${escapeHtml(fileUrl)}" download>Download</a>
            </div>
          </article>
        `}).join('')}
      </div>
    </div>
  `).join('');
}

function companyFormKey(formOrTitle) {
  const title = typeof formOrTitle === 'string' ? formOrTitle : formOrTitle?.title;
  return String(title || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findCompanyFormByKey(formKey) {
  return COMPANY_FORMS.find((form) => companyFormKey(form) === formKey);
}

function loadCompanyFormRecords() {
  try {
    const records = JSON.parse(localStorage.getItem('voxelVedaCompanyFormRecordsV1') || '[]');
    return Array.isArray(records) ? records : [];
  } catch (error) {
    return [];
  }
}

function saveCompanyFormRecords(records) {
  localStorage.setItem('voxelVedaCompanyFormRecordsV1', JSON.stringify(records));
}

function companyFormFieldId(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function companyFormFields(form) {
  const title = String(form?.title || '').toLowerCase();
  const category = String(form?.category || '').toLowerCase();
  let fields = [
    { label: 'Record Date', type: 'date', required: true },
    { label: 'Prepared By', required: true },
    { label: 'Reference Number' },
    { label: 'Related Job / Supplier / Customer' },
    { label: 'Status', type: 'select', options: ['Draft', 'In Review', 'Approved', 'Submitted', 'Closed'], required: true },
    { label: 'Notes / Evidence', type: 'textarea' }
  ];

  if (title.includes('supplier onboarding')) {
    fields = [
      { label: 'Supplier / Company Name', required: true },
      { label: 'ABN / Supplier ID', required: true },
      { label: 'Contact Person' },
      { label: 'Email', type: 'email' },
      { label: 'Phone' },
      { label: 'Supply Category', required: true },
      { label: 'Payment Terms' },
      { label: 'Quality Evidence / Insurance' },
      { label: 'Approved By', required: true },
      { label: 'Review Date', type: 'date' },
      { label: 'Notes', type: 'textarea' }
    ];
  } else if (title.includes('purchase order') || title.includes('supplier bill')) {
    fields = [
      { label: 'PO Number', required: true },
      { label: 'Supplier', required: true },
      { label: 'Supplier Invoice No' },
      { label: 'Category' },
      { label: 'Amount Ex GST', type: 'number', required: true },
      { label: 'GST Amount', type: 'number' },
      { label: 'Total Payable', type: 'number', required: true },
      { label: 'Due Date', type: 'date' },
      { label: 'Payment Status', type: 'select', options: ['Pending', 'Approved', 'Paid', 'On Hold'], required: true },
      { label: 'Approved By' },
      { label: 'Notes', type: 'textarea' }
    ];
  } else if (title.includes('raw material') || title.includes('packaging receiving')) {
    fields = [
      { label: 'Item / Material Name', required: true },
      { label: 'Supplier', required: true },
      { label: 'Batch / Lot / SKU', required: true },
      { label: 'Quantity Received', type: 'number', required: true },
      { label: 'Unit' },
      { label: 'COA / SDS / Certificate Ref' },
      { label: 'Condition', type: 'select', options: ['Accepted', 'Quarantine', 'Rejected'], required: true },
      { label: 'Released By', required: true },
      { label: 'Release Date', type: 'date' },
      { label: 'Quality Notes', type: 'textarea' }
    ];
  } else if (title.includes('job traveller') || title.includes('production')) {
    fields = [
      { label: 'Job / Batch Number', required: true },
      { label: 'Customer / Project', required: true },
      { label: 'Part / Product Name', required: true },
      { label: 'Drawing / Revision' },
      { label: 'Material Batch' },
      { label: 'Operator', required: true },
      { label: 'Accepted Quantity', type: 'number' },
      { label: 'Rejected Quantity', type: 'number' },
      { label: 'Final Release By' },
      { label: 'Process Notes', type: 'textarea' }
    ];
  } else if (category.includes('quality') || title.includes('non-conformance') || title.includes('complaint')) {
    fields = [
      { label: 'Case / Inspection Number', required: true },
      { label: 'Customer / Supplier / Job' },
      { label: 'Item / Part', required: true },
      { label: 'Issue / Inspection Result', required: true, type: 'textarea' },
      { label: 'Root Cause' },
      { label: 'Corrective Action', type: 'textarea' },
      { label: 'Owner' },
      { label: 'Due Date', type: 'date' },
      { label: 'Final Status', type: 'select', options: ['Open', 'In Progress', 'Approved', 'Closed'], required: true },
      { label: 'Approved By' }
    ];
  } else if (category.includes('safety') || title.includes('swms') || title.includes('emergency') || title.includes('first aid')) {
    fields = [
      { label: 'Date', type: 'date', required: true },
      { label: 'Area / Location', required: true },
      { label: 'Person Responsible', required: true },
      { label: 'Hazards / Findings', type: 'textarea', required: true },
      { label: 'Controls / Actions', type: 'textarea' },
      { label: 'PPE / Equipment Checked' },
      { label: 'Follow Up Date', type: 'date' },
      { label: 'Status', type: 'select', options: ['Open', 'Action Required', 'Completed'], required: true }
    ];
  } else if (category.includes('import') || category.includes('export')) {
    fields = [
      { label: 'Shipment / Consignment Ref', required: true },
      { label: 'Supplier / Customer', required: true },
      { label: 'Country' },
      { label: 'Invoice / Declaration Ref' },
      { label: 'Carrier / Broker' },
      { label: 'Duty / GST Notes' },
      { label: 'Dispatch / Arrival Date', type: 'date' },
      { label: 'Document Status', type: 'select', options: ['Preparing', 'Submitted', 'Cleared', 'Delivered'], required: true },
      { label: 'Notes', type: 'textarea' }
    ];
  }

  return fields.map((field) => ({ ...field, id: companyFormFieldId(field.label) }));
}

function openCompanyFormFiller(formKey, recordId = '') {
  const form = findCompanyFormByKey(formKey);
  if (!form) {
    showToast('Form is not available');
    return;
  }
  const records = loadCompanyFormRecords();
  const record = records.find((item) => item.id === recordId);
  const values = record?.values || {};
  const fields = companyFormFields(form);
  const today = new Date().toISOString().slice(0, 10);
  const fieldHtml = fields.map((field) => {
    const value = values[field.id] ?? (field.type === 'date' && field.required ? today : '');
    const required = field.required ? 'required' : '';
    const label = `${escapeHtml(field.label)}${field.required ? ' *' : ''}`;
    if (field.type === 'textarea') {
      return `<label>${label}<textarea id="companyFormField_${field.id}" ${required}>${escapeHtml(value)}</textarea></label>`;
    }
    if (field.type === 'select') {
      return `<label>${label}<select id="companyFormField_${field.id}" ${required}>${(field.options || []).map((option) => `<option ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
    }
    return `<label>${label}<input id="companyFormField_${field.id}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(value)}" ${required}></label>`;
  }).join('');

  showDialog(
    record ? `Edit ${form.title}` : `Fill ${form.title}`,
    `
      <input type="hidden" id="companyDigitalFormKey" value="${escapeHtml(formKey)}">
      <input type="hidden" id="companyDigitalRecordId" value="${escapeHtml(recordId)}">
      <div class="digital-form-shell">
        <div class="digital-form-summary">
          <span class="status-chip">${escapeHtml(form.category)}</span>
          <h4>${escapeHtml(form.title)}</h4>
          <p>${escapeHtml(form.note)}</p>
        </div>
        <div class="digital-form-grid">${fieldHtml}</div>
      </div>
    `,
    saveCompanyFormRecord,
    record ? 'Update Digital Form' : 'Save Digital Form'
  );
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

function saveCompanyFormRecord() {
  const formKey = document.getElementById('companyDigitalFormKey')?.value;
  const recordId = document.getElementById('companyDigitalRecordId')?.value;
  const form = findCompanyFormByKey(formKey);
  if (!form) return;

  const fields = companyFormFields(form);
  const values = {};
  const missing = [];
  fields.forEach((field) => {
    const value = String(document.getElementById(`companyFormField_${field.id}`)?.value || '').trim();
    values[field.id] = value;
    if (field.required && !value) missing.push(field.label);
  });
  if (missing.length) {
    showToast(`Please fill required fields: ${missing.slice(0, 3).join(', ')}`);
    return;
  }

  const records = loadCompanyFormRecords();
  const now = new Date().toISOString();
  const nextRecord = {
    id: recordId || `cff-${Date.now()}`,
    formKey,
    formTitle: form.title,
    category: form.category,
    values,
    createdAt: recordId ? records.find((item) => item.id === recordId)?.createdAt || now : now,
    updatedAt: now,
    updatedBy: currentUser?.name || currentUser?.email || 'Admin'
  };
  const nextRecords = recordId
    ? records.map((item) => (item.id === recordId ? nextRecord : item))
    : [...records, nextRecord];
  saveCompanyFormRecords(nextRecords);
  hideDialog();
  showToast(recordId ? 'Digital form updated successfully' : 'Digital form saved successfully');
  renderCompanyForms();
}

function openCompanyFormEntries(formKey) {
  const form = findCompanyFormByKey(formKey);
  if (!form) {
    showToast('Form is not available');
    return;
  }
  const records = loadCompanyFormRecords().filter((record) => record.formKey === formKey);
  const body = records.length
    ? records.map((record) => {
        const values = record.values || {};
        const titleValue = values.supplier_company_name || values.item_material_name || values.job_batch_number || values.case_inspection_number || values.shipment_consignment_ref || values.reference_number || record.formTitle;
        return `
          <div class="form-record-card">
            <div>
              <strong>${escapeHtml(titleValue)}</strong>
              <span>${escapeHtml(record.formTitle)} • ${new Date(record.updatedAt).toLocaleString()}</span>
            </div>
            <div class="inline-actions">
              <button class="icon-btn" onclick="previewCompanyFormRecord('${escapeHtml(record.id)}')">Preview</button>
              <button class="primary-btn" onclick="openCompanyFormFiller('${escapeHtml(formKey)}', '${escapeHtml(record.id)}')">Edit</button>
              <button class="danger-btn" onclick="deleteCompanyFormRecord('${escapeHtml(record.id)}', '${escapeHtml(formKey)}')">Delete</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="empty-state">No digital entries saved for this form yet.</div>';

  showDialog(
    `${form.title} Entries`,
    `<div class="form-entry-list">${body}</div>`,
    () => openCompanyFormFiller(formKey),
    'New Entry'
  );
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

function deleteCompanyFormRecord(recordId, formKey) {
  if (!confirm('Delete this saved digital form entry?')) return;
  saveCompanyFormRecords(loadCompanyFormRecords().filter((record) => record.id !== recordId));
  showToast('Digital form entry deleted');
  openCompanyFormEntries(formKey);
  renderCompanyForms();
}

function previewCompanyFormRecord(recordId) {
  const record = loadCompanyFormRecords().find((item) => item.id === recordId);
  if (!record) {
    showToast('Saved entry not found');
    return;
  }
  const form = findCompanyFormByKey(record.formKey) || record;
  const fields = companyFormFields(form);
  const rows = fields.map((field) => `
    <tr>
      <th>${escapeHtml(field.label)}</th>
      <td>${escapeHtml(record.values?.[field.id] || '-')}</td>
    </tr>
  `).join('');
  const preview = window.open('', '_blank', 'noopener');
  if (!preview) {
    showToast('Popup blocked. Allow popups to preview the form.');
    return;
  }
  preview.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(record.formTitle)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 36px; color: #0f172a; }
          header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #0ea5e9; padding-bottom: 16px; margin-bottom: 24px; }
          img { width: 86px; height: 86px; object-fit: contain; border-radius: 18px; }
          h1 { margin: 0; font-size: 26px; }
          p { margin: 4px 0 0; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { text-align: left; vertical-align: top; border: 1px solid #cbd5e1; padding: 12px; }
          th { width: 34%; background: #f1f5f9; }
          footer { margin-top: 28px; font-size: 12px; color: #64748b; }
          @media print { body { margin: 16mm; } button { display: none; } }
        </style>
      </head>
      <body>
        <button onclick="window.print()">Print / Save PDF</button>
        <header>
          <img src="/Frame 1.png" alt="Voxel Veda">
          <div>
            <p>Voxel Veda Pty Ltd</p>
            <h1>${escapeHtml(record.formTitle)}</h1>
            <p>${escapeHtml(record.category || '')} • Uploaded ${new Date(record.updatedAt).toLocaleString()}</p>
          </div>
        </header>
        <table>${rows}</table>
        <footer>Digital company form record. Keep with job, supplier, customer, safety, quality or compliance evidence as applicable.</footer>
      </body>
    </html>
  `);
  preview.document.close();
}

function hasCurrentPermission(permission) {
  const permissions = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
  return currentRole === 'admin' || permissions.includes(permission);
}

function configureTaskManagerView() {
  if (currentRole === 'admin') return;

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('hidden-section', btn.dataset.section !== 'taskSection');
  });
  document.querySelectorAll('.nav-group').forEach((group) => {
    const hasTaskButton = group.querySelector('[data-section="taskSection"]');
    group.classList.toggle('hidden-section', !hasTaskButton);
  });
  document.querySelectorAll('.page-section').forEach((section) => {
    section.classList.toggle('hidden-section', section.id !== 'taskSection');
  });
  document.querySelector('[data-section="taskSection"]')?.classList.add('active');
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
    if (!hasCurrentPermission('tasks')) {
      alert('Access denied. Admin only.');
      window.location.replace('/dashboard');
      return null;
    }

    el.innerText = `${data.user.name} | ${data.user.email} | task control`;
    syncTopbarUser(currentUser);
    configureTaskManagerView();
    return data.user;
  }

  currentUser = { ...data.user, role };
  currentRole = role;
  localStorage.setItem('user', JSON.stringify(currentUser));
  localStorage.setItem('role', role);
  el.innerText = `${data.user.name} | ${data.user.email} | ${role}`;
  syncTopbarUser(currentUser);
  return data.user;
}

async function loadDashboardStats() {
  const res = await fetch('/api/dashboard/stats', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);
  if (!res.ok) return;
  dashboardStatsCache = data;
  renderNotificationDropdown();

  const rfqStatus = document.getElementById('rfqStatus');
  const invoiceStatus = document.getElementById('invoiceStatus');

  if (rfqStatus) {
    rfqStatus.innerText =
      `${data.rfqs.total_rfqs || 0} total | ${data.rfqs.pending_rfqs || 0} pending`;
  }
  setText('homeRfqSignal', `${data.rfqs.approved_rfqs || 0} approved | ${data.rfqs.quoted_rfqs || 0} quoted`);

  if (invoiceStatus) {
    invoiceStatus.innerText =
      `${data.invoices.total_invoices || 0} total | ${formatMoney(data.invoices.paid_revenue || 0)} paid`;
  }
  setText('homeInvoiceSignal', `${data.invoices.sent_invoices || 0} sent | ${data.invoices.paid_invoices || 0} paid`);
  setText('homePipelineSignal', `FY ${data.finance?.financial_year || '-'} | GST position ${formatMoney(data.finance?.gst_position || 0)}`);

  setText('dashboardRevenueValue', formatMoney(data.finance?.revenue));
  setText('dashboardExpenseValue', formatMoney(data.finance?.expenses));
  setText('dashboardNetWorthValue', formatMoney(data.finance?.net_worth));
  setText('homeCashPulse', formatMoney(data.finance?.revenue));

  renderCharts(data);
  renderSupplierPayables(data.supplier_payables || {});
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
    setText('homeInventoryPulse', formatMoney(stockWorth));

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
  const financeCanvas = document.getElementById('financeChart');

  if (!rfqCanvas || !invoiceCanvas || typeof Chart === 'undefined') return;

  if (rfqChartInstance) rfqChartInstance.destroy();
  if (invoiceChartInstance) invoiceChartInstance.destroy();
  if (financeChartInstance) financeChartInstance.destroy();

  const chartGridColor = 'rgba(148, 163, 184, 0.11)';
  const chartTickColor = '#cbd5e1';
  const chartTooltip = {
    backgroundColor: 'rgba(2, 6, 23, 0.94)',
    borderColor: 'rgba(45, 212, 191, 0.42)',
    borderWidth: 1,
    titleColor: '#e0f2fe',
    bodyColor: '#f8fafc',
    padding: 12,
    displayColors: true
  };
  const verticalGradient = (context, top, bottom) => {
    const { chart } = context;
    const area = chart.chartArea;
    if (!area) return top;
    const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    return gradient;
  };
  const centerTextPlugin = {
    id: 'rfqCenterText',
    afterDraw(chart) {
      const dataset = chart.data.datasets?.[0];
      const meta = chart.getDatasetMeta(0);
      if (!dataset || !meta?.data?.[0]) return;
      const total = dataset.data.reduce((sum, value) => sum + Number(value || 0), 0);
      const { x, y } = meta.data[0];
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#67e8f9';
      ctx.font = '900 22px Inter, Arial, sans-serif';
      ctx.fillText(String(total), x, y - 8);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
      ctx.font = '800 11px Inter, Arial, sans-serif';
      ctx.fillText('RFQs', x, y + 16);
      ctx.restore();
    }
  };

  rfqChartInstance = new Chart(rfqCanvas, {
    type: 'doughnut',
    data: {
      labels: ['Pending', 'Approved', 'Quoted'],
      datasets: [{
        data: [
          Number(data.rfqs.pending_rfqs || 0),
          Number(data.rfqs.approved_rfqs || 0),
          Number(data.rfqs.quoted_rfqs || 0)
        ],
        backgroundColor: ['#38bdf8', '#fb7185', '#f59e0b'],
        borderColor: 'rgba(2, 6, 23, 0.92)',
        borderWidth: 5,
        borderRadius: 8,
        hoverBorderColor: '#e0f2fe',
        hoverOffset: 10,
        spacing: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { animateRotate: true, duration: 900 },
      plugins: {
        tooltip: chartTooltip,
        legend: {
          position: 'bottom',
          labels: {
            color: '#f8fafc',
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            padding: 14
          }
        }
      }
    },
    plugins: [centerTextPlugin]
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
        ],
        backgroundColor: (context) => {
          const colors = [
            ['rgba(37, 99, 235, 0.95)', 'rgba(37, 99, 235, 0.22)'],
            ['rgba(45, 212, 191, 0.95)', 'rgba(45, 212, 191, 0.18)'],
            ['rgba(56, 189, 248, 0.95)', 'rgba(56, 189, 248, 0.18)'],
            ['rgba(34, 197, 94, 0.95)', 'rgba(34, 197, 94, 0.18)']
          ];
          const color = colors[context.dataIndex] || colors[0];
          return verticalGradient(context, color[0], color[1]);
        },
        borderColor: 'rgba(125, 211, 252, 0.26)',
        borderWidth: 1,
        borderRadius: 16,
        borderSkipped: false,
        maxBarThickness: 42
      }, {
        type: 'line',
        label: 'Flow line',
        data: [
          Number(data.invoices.draft_invoices || 0),
          Number(data.invoices.approved_invoices || 0),
          Number(data.invoices.sent_invoices || 0),
          Number(data.invoices.paid_invoices || 0)
        ],
        borderColor: '#67e8f9',
        backgroundColor: 'rgba(103, 232, 249, 0.15)',
        pointBackgroundColor: '#e0f2fe',
        pointBorderColor: '#0891b2',
        pointBorderWidth: 2,
        pointRadius: 4,
        tension: 0.42,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: chartTooltip,
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: '#f8fafc',
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            padding: 14
          }
        }
      },
      scales: {
        x: { ticks: { color: chartTickColor, font: { weight: 800 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: chartTickColor, precision: 0 }, grid: { color: chartGridColor } }
      }
    }
  });

  if (financeCanvas) {
    const months = data.finance?.months || [];
    financeChartInstance = new Chart(financeCanvas, {
      type: 'bar',
      data: {
        labels: months.map((row) => row.month_key),
        datasets: [
          {
            label: 'Revenue',
            data: months.map((row) => Number(row.revenue || 0)),
            backgroundColor: (context) => verticalGradient(context, 'rgba(45, 212, 191, 0.98)', 'rgba(45, 212, 191, 0.2)'),
            borderColor: 'rgba(45, 212, 191, 0.35)',
            borderWidth: 1,
            borderRadius: 16,
            borderSkipped: false,
            maxBarThickness: 46
          },
          {
            label: 'Expenses',
            data: months.map((row) => Number(row.expenses || 0)),
            backgroundColor: (context) => verticalGradient(context, 'rgba(251, 113, 133, 0.96)', 'rgba(251, 113, 133, 0.18)'),
            borderColor: 'rgba(251, 113, 133, 0.35)',
            borderWidth: 1,
            borderRadius: 16,
            borderSkipped: false,
            maxBarThickness: 46
          },
          {
            type: 'line',
            label: 'Net',
            data: months.map((row) => Number(row.revenue || 0) - Number(row.expenses || 0)),
            borderColor: '#facc15',
            backgroundColor: 'rgba(250, 204, 21, 0.14)',
            pointBackgroundColor: '#fef3c7',
            pointBorderColor: '#ca8a04',
            pointBorderWidth: 2,
            pointRadius: 4,
            tension: 0.4,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            ...chartTooltip,
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${formatMoney(context.parsed.y)}`;
              }
            }
          },
          legend: {
            position: 'bottom',
            labels: {
              color: '#f8fafc',
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              padding: 12
            }
          }
        },
        scales: {
          x: { ticks: { color: chartTickColor, font: { weight: 800 } }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: {
              color: chartTickColor,
              callback(value) {
                return formatMoney(value).replace('.00', '');
              }
            },
            grid: { color: chartGridColor }
          }
        }
      }
    });
  }
}

function renderSupplierPayables(payables) {
  const pendingValue = Number(payables.pending_value || 0);
  const paidValue = Number(payables.paid_value || 0);
  const overdueValue = Number(payables.overdue_value || 0);
  const nextPaymentValue = Number(payables.next_payment?.total_amount || 0);
  const supplierCount = Number(payables.supplier_count || 0);
  const pendingCount = Number(payables.pending_count || 0);

  setText('supplierPendingValue', formatMoney(pendingValue));
  setText('supplierPaidValue', formatMoney(paidValue));
  setText('supplierOverdueValue', formatMoney(overdueValue));
  setText('supplierNextPaymentValue', formatMoney(nextPaymentValue));
  setText('supplierPendingCount', `${pendingCount} pending bill${pendingCount === 1 ? '' : 's'}`);
  setText('supplierCountLabel', `${supplierCount} supplier${supplierCount === 1 ? '' : 's'}`);
  setText('supplierFyLabel', payables.financial_year ? `FY ${payables.financial_year}` : 'FY');
  setText('homeSupplierRisk', formatMoney(pendingValue));
  setText('homeSupplierRiskNote', pendingCount > 0 ? `${pendingCount} payable item${pendingCount === 1 ? '' : 's'} open` : 'No pending supplier debt');
  setText('supplierPressurePill', pendingValue > 0 ? `${formatMoney(pendingValue)} pending` : 'Ledger clean');

  const canvas = document.getElementById('supplierDebtChart');
  if (canvas && typeof Chart !== 'undefined') {
    if (supplierDebtChartInstance) supplierDebtChartInstance.destroy();

    const chartValues = [
      Math.max(paidValue, 0),
      Math.max(pendingValue - overdueValue, 0),
      Math.max(overdueValue, 0)
    ];
    const hasAnyValue = chartValues.some((value) => value > 0);

    supplierDebtChartInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Paid', 'Pending', 'Overdue'],
        datasets: [{
          data: hasAnyValue ? chartValues : [1, 1, 1],
          backgroundColor: hasAnyValue
            ? ['#2dd4bf', '#38bdf8', '#fb7185']
            : ['rgba(45,212,191,0.18)', 'rgba(56,189,248,0.16)', 'rgba(251,113,133,0.14)'],
          borderColor: ['rgba(255,255,255,0.88)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.68)'],
          borderWidth: 2,
          hoverOffset: 9
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${formatMoney(context.raw)}`
            }
          }
        }
      }
    });
  }

  renderSupplierCategoryFlows(payables.categories || []);
  renderSupplierUpcoming(payables.upcoming || []);
  renderSupplierExposure(payables.suppliers || []);
}

function renderSupplierCategoryFlows(categories) {
  const container = document.getElementById('supplierCategoryFlows');
  if (!container) return;

  if (!categories.length) {
    container.innerHTML = '<div class="empty-state compact-empty">No supplier bill categories recorded yet.</div>';
    return;
  }

  const maxValue = Math.max(...categories.map((row) => Number(row.paid_value || 0) + Number(row.pending_value || 0)), 1);
  container.innerHTML = categories.map((row) => {
    const paid = Number(row.paid_value || 0);
    const pending = Number(row.pending_value || 0);
    const total = paid + pending;
    const width = Math.max(5, Math.round((total / maxValue) * 100));
    const pendingWidth = total ? Math.round((pending / total) * 100) : 0;

    return `
      <div class="supplier-flow-row">
        <div class="supplier-flow-label">
          <strong>${escapeHtml(row.category || 'Other')}</strong>
          <span>${escapeHtml(row.bill_count || 0)} bill${Number(row.bill_count || 0) === 1 ? '' : 's'} | ${escapeHtml(formatMoney(total))}</span>
        </div>
        <div class="supplier-flow-track" title="${escapeHtml(formatMoney(total))}">
          <span class="supplier-flow-fill" style="width:${width}%">
            <i style="width:${pendingWidth}%"></i>
          </span>
        </div>
        <div class="supplier-flow-money">
          <span>Paid ${escapeHtml(formatMoney(paid))}</span>
          <strong>Due ${escapeHtml(formatMoney(pending))}</strong>
        </div>
      </div>
    `;
  }).join('');
}

function renderSupplierUpcoming(upcoming) {
  const container = document.getElementById('supplierUpcomingList');
  if (!container) return;

  if (!upcoming.length) {
    container.innerHTML = '<div class="empty-state compact-empty">No upcoming supplier payments. Clean ledger.</div>';
    return;
  }

  container.innerHTML = upcoming.map((row, index) => {
    const due = row.due_date ? formatDate(row.due_date) : '-';
    return `
      <div class="supplier-upcoming-item">
        <span class="supplier-payment-rank">${index + 1}</span>
        <div>
          <strong>${escapeHtml(row.supplier_name || 'Supplier')}</strong>
          <span>${escapeHtml(row.category || 'Other')} | ${escapeHtml(row.invoice_no || 'No invoice ref')}</span>
        </div>
        <div>
          <strong>${escapeHtml(formatMoney(row.total_amount))}</strong>
          <span>Due ${escapeHtml(due)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSupplierExposure(suppliers) {
  const container = document.getElementById('supplierExposureList');
  if (!container) return;

  if (!suppliers.length) {
    container.innerHTML = `
      <div class="supplier-exposure-card">
        <span>No supplier exposure yet</span>
        <strong>Add supplier bills in Expenses</strong>
      </div>
    `;
    return;
  }

  container.innerHTML = suppliers.map((supplier) => {
    const pending = Number(supplier.pending_value || 0);
    const paid = Number(supplier.paid_value || 0);
    const dueDate = supplier.next_due_date ? formatDate(supplier.next_due_date) : 'No due bill';
    return `
      <div class="supplier-exposure-card">
        <span>${escapeHtml(supplier.supplier_name || 'Supplier')}</span>
        <strong>${escapeHtml(formatMoney(pending))}</strong>
        <small>Paid ${escapeHtml(formatMoney(paid))} | Next ${escapeHtml(dueDate)}</small>
      </div>
    `;
  }).join('');
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatClockTime(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(value);
  }
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

function accessSwitchInput(accessId, inputId, checked = false, label = '') {
  return `
    <span class="access-switch-control">
      <input
        class="access-switch-input"
        type="checkbox"
        data-access="${accessId}"
        id="${inputId}"
        ${label ? `aria-label="${escapeHtml(label)}"` : ''}
        ${checked ? 'checked' : ''}
      >
      <span class="access-switch-ui" aria-hidden="true"><span></span></span>
    </span>
  `;
}

function accessCheckboxes(selected = [], prefix = 'access') {
  const enabled = new Set(selected);
  const visibleOptions = ACCESS_OPTIONS.filter((item) => item.id !== 'attendance_qr_bypass');

  return `
    <div class="access-grid">
      ${visibleOptions.map((item) => `
        <label class="access-check access-switch-card">
          <span class="access-switch-copy">${escapeHtml(item.label)}</span>
          ${accessSwitchInput(item.id, `${prefix}_${item.id}`, enabled.has(item.id), item.label)}
        </label>
      `).join('')}
    </div>
  `;
}

function accessLabels(selected = []) {
  const labels = new Map(ACCESS_OPTIONS.map((item) => [item.id, item.label]));
  return selected.map((id) => labels.get(id) || id);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function suggestUsernameFromEmail(value) {
  return String(value || '')
    .split('@')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_');
}

function collectAccess() {
  const selected = new Set(
    Array.from(document.querySelectorAll('[data-access]:checked'))
    .map((input) => input.dataset.access)
      .filter(Boolean)
  );
  const explicitlySelectedStock = selected.has('stock');

  const inputParents = {
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

  Object.entries(inputParents).forEach(([inputPermission, parents]) => {
    if (selected.has(inputPermission)) parents.forEach((parent) => selected.add(parent));
  });

  if (selected.has('stock_in') || selected.has('stock_out') || selected.has('raw_material') || selected.has('packaging')) selected.add('stock');
  if (explicitlySelectedStock) {
    selected.add('stock_in');
    selected.add('stock_out');
    selected.add('raw_material');
    selected.add('packaging');
  }

  return ACCESS_OPTIONS
    .map((item) => item.id)
    .filter((id) => selected.has(id));
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
  setRegisterLoading(tbody, 11, 'Loading RFQs...');

  const res = await fetch('/api/rfq', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">Failed to load RFQs</td></tr>`;
    return;
  }

  renderRegisterPage({
    key: 'rfqs',
    tbody,
    rows: data.rfqs || [],
    colspan: 7,
    emptyMessage: 'No RFQs yet.',
    onChange: loadRFQs,
    rowRenderer: (r) => {
    const status = String(r.status || '').toLowerCase();
    const canInvoice = status === 'approved';

    return `
      <tr>
        <td>${escapeHtml(r.id)}</td>
        <td>${escapeHtml(r.customer_name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.material || '-')}</td>
        <td>${escapeHtml(r.quantity || 0)}</td>
        <td>${statusBadge(status)}</td>
        <td class="register-action-cell">
          <button class="small-btn" onclick="updateRFQ(${r.id}, 'approve')">Approve</button>
          <button class="secondary-btn" onclick="updateRFQ(${r.id}, 'reject')">Reject</button>
          ${canInvoice ? `<button class="small-btn" onclick="createInvoiceFromRFQ(${r.id})">${status === 'quoted' ? 'Open Invoice' : 'Invoice'}</button>` : ''}
          <button class="secondary-btn" onclick="updateRFQ(${r.id}, 'close')">Close</button>
        </td>
      </tr>
    `;
    }
  });
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
  let rfqs = [];
  try {
    const res = await fetch('/api/rfq', { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || 'Failed to load RFQs');
    rfqs = chronologicalRows(data.rfqs || []).filter((rfq) => String(rfq.status || '').toLowerCase() === 'approved');
  } catch (err) {
    showToast(err.message || 'Failed to load RFQs');
    return;
  }

  const options = rfqs.map((rfq) => {
    const label = `#${rfq.id} - ${rfq.name || rfq.customer_name || 'Customer'} - ${rfq.material || rfq.project_name || 'RFQ'}`;
    return `<option value="${escapeHtml(rfq.id)}">${escapeHtml(label)}</option>`;
  }).join('');

  showDialog(
    'Create Invoice From RFQ',
    rfqs.length ? `
      <div class="rfq-picker-panel">
        <label>
          <span>Approved RFQ</span>
          <select id="dialogRfqId" onchange="previewSelectedRFQ()">${options}</select>
        </label>
        <div id="rfqInvoicePreview" class="rfq-invoice-preview"></div>
      </div>
    ` : `
      <div class="empty-state-panel">
        <strong>No approved RFQs ready for invoicing.</strong>
        <span>Approve an RFQ first, then create the invoice from here.</span>
      </div>
    `,
    async () => {
      const rfqId = Number(document.getElementById('dialogRfqId')?.value);
      if (!rfqId) {
        if (!rfqs.length) hideDialog();
        else showToast('Select an approved RFQ');
        return;
      }

      hideDialog();
      await createInvoiceFromRFQ(rfqId);
    },
    rfqs.length ? 'Create Invoice' : 'Close'
  );

  window.__rfqInvoiceOptions = rfqs;
  previewSelectedRFQ();
}

function previewSelectedRFQ() {
  const preview = document.getElementById('rfqInvoicePreview');
  if (!preview) return;
  const rfqId = Number(document.getElementById('dialogRfqId')?.value);
  const rfq = (window.__rfqInvoiceOptions || []).find((item) => Number(item.id) === rfqId);
  if (!rfq) {
    preview.innerHTML = '<span class="status-note">Select an approved RFQ to preview invoice data.</span>';
    return;
  }

  preview.innerHTML = `
    <div><span>Customer</span><strong>${escapeHtml(rfq.name || rfq.customer_name || '-')}</strong></div>
    <div><span>Email</span><strong>${escapeHtml(rfq.email || '-')}</strong></div>
    <div><span>Scope / Item</span><strong>${escapeHtml(rfq.material || rfq.project_name || '-')}</strong></div>
    <div><span>Quantity</span><strong>${escapeHtml(rfq.quantity || '-')}</strong></div>
    <div><span>Status</span><strong>Approved</strong></div>
  `;
}

function invoiceItemRows(items = [{ description: '', quantity: 1, unit_price: 0 }]) {
  return items.map((item, index) => `
    <div class="invoice-item-row" data-invoice-item-row>
      <label>
        <span>Item description</span>
        <input class="invoiceItemDescription" placeholder="Item description" autocomplete="off" value="${escapeHtml(item.description || '')}" />
      </label>
      <label>
        <span>Qty</span>
        <input class="invoiceItemQty" type="number" min="0.001" step="0.001" placeholder="Qty" value="${escapeHtml(item.quantity || 1)}" oninput="updateManualInvoiceSummary()" />
      </label>
      <label>
        <span>Unit price</span>
        <input class="invoiceItemPrice" type="number" min="0" step="0.01" placeholder="Unit price" value="${escapeHtml(item.unit_price || 0)}" oninput="updateManualInvoiceSummary()" />
      </label>
      <button type="button" class="secondary-btn invoice-remove-btn" onclick="removeInvoiceItemRow(this)">Remove</button>
    </div>
  `).join('');
}

function addInvoiceItemRow() {
  const container = document.getElementById('invoiceItemsContainer');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', invoiceItemRows([{ description: '', quantity: 1, unit_price: 0 }]));
  updateManualInvoiceSummary();
}

function removeInvoiceItemRow(button) {
  const rows = document.querySelectorAll('[data-invoice-item-row]');
  if (rows.length <= 1) {
    showToast('Invoice needs at least one item');
    return;
  }
  button.closest('[data-invoice-item-row]')?.remove();
  updateManualInvoiceSummary();
}

function collectInvoiceItems() {
  return Array.from(document.querySelectorAll('[data-invoice-item-row]')).map((row) => ({
    description: row.querySelector('.invoiceItemDescription')?.value.trim(),
    quantity: Number(row.querySelector('.invoiceItemQty')?.value || 0),
    unit_price: Number(row.querySelector('.invoiceItemPrice')?.value || 0)
  }));
}

function manualInvoiceGstRate() {
  const gstEnabled = document.getElementById('manualInvoiceGstEnabled')?.checked ?? true;
  const input = document.getElementById('manualInvoiceGst');
  if (!gstEnabled) return 0;
  return Math.max(Number(input?.value || 0), 0);
}

function toggleManualInvoiceGst() {
  const enabled = document.getElementById('manualInvoiceGstEnabled')?.checked ?? true;
  const input = document.getElementById('manualInvoiceGst');
  const label = document.getElementById('manualInvoiceGstLabel');
  const card = document.querySelector('.gst-control-panel');

  if (input) {
    input.disabled = !enabled;
    if (!enabled) input.value = '0';
    if (enabled && Number(input.value || 0) <= 0) input.value = '10';
  }
  if (label) label.textContent = enabled ? 'GST On' : 'GST Off';
  card?.classList.toggle('gst-off', !enabled);
  updateManualInvoiceSummary();
}

function updateManualInvoiceSummary() {
  const subtotal = collectInvoiceItems().reduce((sum, item) => {
    return sum + (Number(item.quantity || 0) * Number(item.unit_price || 0));
  }, 0);
  const gstRate = manualInvoiceGstRate();
  const gstAmount = subtotal * (gstRate / 100);
  const total = subtotal + gstAmount;

  setText('manualInvoiceSubtotal', formatMoney(subtotal));
  setText('manualInvoiceGstAmount', formatMoney(gstAmount));
  setText('manualInvoiceTotal', formatMoney(total));
  setText('manualInvoiceGstSummaryLabel', gstRate > 0 ? `GST (${gstRate}%)` : 'GST disabled');
}

async function ensureCustomerCache() {
  if (customerCache.length) return customerCache;

  const res = await fetch('/api/customers', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (res.ok) {
    customerCache = chronologicalRows(data.customers || []);
  }

  return customerCache;
}

async function ensureInvoiceHistoryCache() {
  if (invoiceCache.length) return invoiceCache;

  const res = await fetch('/api/invoice', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (res.ok) {
    invoiceCache = chronologicalRows(data.invoices || []);
  }

  return invoiceCache;
}

function manualCustomerSources() {
  const sources = new Map();

  customerCache.forEach((customer) => {
    const name = customer.company_name || customer.contact_name || '';
    const email = customer.email || '';
    const key = (email || `customer:${name}`).toLowerCase();
    if (!name || !key) return;
    sources.set(key, {
      key,
      source: 'Customer register',
      name,
      contact: customer.contact_name || '',
      email,
      phone: customer.phone || '',
      address: customer.address || '',
      order_count: Number(customer.order_count || 0),
      total_spend: Number(customer.total_spend || 0)
    });
  });

  invoiceCache.forEach((invoice) => {
    const name = invoice.customer_name || '';
    const email = invoice.customer_email || '';
    const key = (email || `invoice:${name}`).toLowerCase();
    if (!name || !key) return;

    const existing = sources.get(key);
    if (existing) {
      existing.order_count += 1;
      existing.total_spend += Number(invoice.total || 0);
      existing.source = existing.source.includes('Invoice') ? existing.source : `${existing.source} + Invoice history`;
      return;
    }

    sources.set(key, {
      key,
      source: 'Invoice history',
      name,
      contact: '',
      email,
      phone: '',
      address: '',
      order_count: 1,
      total_spend: Number(invoice.total || 0)
    });
  });

  return Array.from(sources.values()).sort((a, b) => b.order_count - a.order_count || a.name.localeCompare(b.name));
}

function manualCustomerSearchText(customer) {
  return [
    customer.name,
    customer.contact,
    customer.email,
    customer.phone,
    customer.address
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderManualCustomerSuggestions() {
  const query = String(document.getElementById('manualInvoiceCustomer')?.value || '').trim().toLowerCase();
  const panel = document.getElementById('manualCustomerSuggestions');
  if (!panel) return;

  if (!query) {
    panel.innerHTML = '';
    return;
  }

  const matches = manualCustomerSources()
    .filter((customer) => manualCustomerSearchText(customer).includes(query))
    .slice(0, 8);
  manualInvoiceCustomerMatches = matches;

  if (!matches.length) {
    panel.innerHTML = '<div class="customer-search-empty">New customer profile will be remembered after invoice creation.</div>';
    return;
  }

  panel.innerHTML = matches.map((customer, index) => `
    <button type="button" class="customer-suggestion-btn" onclick="selectManualInvoiceCustomer(${index})">
      <strong>${escapeHtml(customer.name || 'Customer')}</strong>
      <span>${escapeHtml(customer.contact || customer.source)} | ${escapeHtml(customer.email || '-')} | ${escapeHtml(customer.phone || '-')}</span>
      <small>${escapeHtml(customer.source)} | ${escapeHtml(Number(customer.order_count || 0))} invoice/order record${Number(customer.order_count || 0) === 1 ? '' : 's'} | ${escapeHtml(formatMoney(customer.total_spend || 0))}</small>
    </button>
  `).join('');
}

function selectManualInvoiceCustomer(index) {
  const customer = manualInvoiceCustomerMatches[Number(index)];
  if (!customer) return;

  const name = customer.name || '';
  const email = customer.email || '';

  const nameEl = document.getElementById('manualInvoiceCustomer');
  const emailEl = document.getElementById('manualInvoiceEmail');
  const selectedEl = document.getElementById('manualInvoiceSelectedCustomer');

  if (nameEl) nameEl.value = name;
  if (emailEl) emailEl.value = email;
  if (selectedEl) {
    selectedEl.innerHTML = `
      <strong>${escapeHtml(name || 'Selected customer')}</strong>
      <span>${escapeHtml(customer.contact || customer.source)} | ${escapeHtml(email || '-')} | ${escapeHtml(customer.phone || '-')}</span>
      ${customer.address ? `<small>${escapeHtml(customer.address)}</small>` : ''}
    `;
    selectedEl.classList.remove('hidden-section');
  }

  manualInvoiceCustomerMatches = [];
  const panel = document.getElementById('manualCustomerSuggestions');
  if (panel) panel.innerHTML = '';
}

function openManualInvoiceDialog() {
  showDialog(
    'Manual Invoice',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Customer</h4>
          <input id="manualInvoiceCustomer" placeholder="Type first letter, company, contact, phone or email" oninput="renderManualCustomerSuggestions()" autocomplete="off" />
          <div id="manualInvoiceSelectedCustomer" class="selected-customer-card hidden-section"></div>
          <div id="manualCustomerSuggestions" class="customer-suggestion-list"></div>
          <input id="manualInvoiceEmail" type="email" placeholder="Customer email" />
          <div class="gst-control-panel">
            <div class="gst-control-head">
              <div>
                <strong>GST Control</strong>
                <span>Switch off for a GST-free invoice.</span>
              </div>
              <label class="gst-toggle">
                <input id="manualInvoiceGstEnabled" type="checkbox" checked onchange="toggleManualInvoiceGst()" />
                <span class="gst-toggle-track"></span>
                <b id="manualInvoiceGstLabel">GST On</b>
              </label>
            </div>
            <label class="gst-rate-field">
              <span>GST rate %</span>
              <input id="manualInvoiceGst" type="number" min="0" step="0.01" value="10" placeholder="GST rate" oninput="updateManualInvoiceSummary()" />
            </label>
          </div>
        </div>
        <div class="dialog-card">
          <h4>Line Items</h4>
          <div id="invoiceItemsContainer">${invoiceItemRows()}</div>
          <button type="button" class="secondary-btn" onclick="addInvoiceItemRow()">Add Item</button>
          <div class="manual-invoice-summary">
            <div><span>Subtotal</span><strong id="manualInvoiceSubtotal">$0.00</strong></div>
            <div><span id="manualInvoiceGstSummaryLabel">GST (10%)</span><strong id="manualInvoiceGstAmount">$0.00</strong></div>
            <div class="manual-invoice-total"><span>Total</span><strong id="manualInvoiceTotal">$0.00</strong></div>
          </div>
        </div>
      </div>
    `,
    async () => {
      const body = {
        customer_name: document.getElementById('manualInvoiceCustomer')?.value.trim(),
        customer_email: document.getElementById('manualInvoiceEmail')?.value.trim(),
        gst_rate: manualInvoiceGstRate(),
        items: collectInvoiceItems()
      };

      const invalidItem = body.items.find((item) => !item.description || Number(item.quantity) <= 0 || Number(item.unit_price) < 0);
      if (!body.customer_name || !body.items.length || invalidItem) {
        showToast('Please fill required fields');
        return;
      }

      if (body.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customer_email)) {
        showToast('Enter a valid customer email');
        return;
      }

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
      customerCache = [];
      await loadInvoices();
      await ensureCustomerCache();
      await loadDashboardStats();
    },
    'Create Invoice'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'manual-invoice-dialog');
  updateManualInvoiceSummary();
  Promise.all([ensureCustomerCache(), ensureInvoiceHistoryCache()]).then(() => {
    renderManualCustomerSuggestions();
  }).catch(() => {
    const panel = document.getElementById('manualCustomerSuggestions');
    if (panel) panel.innerHTML = '<div class="customer-search-empty">History is temporarily unavailable. Manual entry is ready.</div>';
  });
}

async function loadInvoices() {
  const tbody = document.getElementById('invoiceTableBody');
  if (!tbody) return;
  setRegisterLoading(tbody, 9, 'Loading invoices...');

  const res = await fetch('/api/invoice', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">Failed to load invoices</td></tr>`;
    return;
  }

  const invoices = chronologicalRows(data.invoices || []);
  invoiceCache = invoices;
  updateInvoiceMetrics(invoices);
  renderNotificationDropdown();

  renderRegisterPage({
    key: 'invoices',
    tbody,
    rows: invoices,
    colspan: 9,
    emptyMessage: 'No invoices yet.',
    onChange: loadInvoices,
    rowRenderer: (invoice, index) => `
      <tr>
        <td>${escapeHtml(index + 1)}</td>
        <td>${escapeHtml(invoice.invoice_no || '-')}</td>
        <td>${escapeHtml(invoice.customer_name || '-')}</td>
        <td>${escapeHtml(invoice.rfq_id || 'Manual')}</td>
        <td>${escapeHtml(formatMoney(invoice.total))}</td>
        <td class="money-positive">${escapeHtml(formatMoney(invoice.paid_amount))}</td>
        <td class="${Number(invoice.balance_due || 0) > 0 ? 'money-danger' : 'money-positive'}">${escapeHtml(formatMoney(invoice.balance_due))}</td>
        <td>${statusBadge(invoice.status)}</td>
        <td class="register-action-cell invoice-action-cell">
          <button class="small-btn" onclick="invoiceAction(${invoice.id}, 'approve')">Approve</button>
          <button class="small-btn" onclick="openSendInvoiceDialog(${invoice.id})">Send</button>
          <button class="small-btn" onclick="openInvoicePaymentDialog(${invoice.id})">Payment</button>
          <button class="small-btn" onclick="invoiceAction(${invoice.id}, 'paid')">Paid</button>
          <button class="secondary-btn" onclick="openEditInvoiceDialog(${invoice.id})">Edit</button>
          <button class="secondary-btn" onclick="openInvoicePdf(${invoice.id})">PDF</button>
          <button class="secondary-btn" onclick="openInvoiceQrDialog(${invoice.id})">QR</button>
          <button class="danger-btn" onclick="invoiceAction(${invoice.id}, 'delete')">Delete</button>
        </td>
      </tr>
    `
  });
}

function updateInvoiceMetrics(invoices) {
  const totalEl = document.getElementById('invoiceTotalValue');
  const unpaidEl = document.getElementById('invoiceUnpaidValue');
  const sentPaidEl = document.getElementById('invoiceSentPaidCount');

  const total = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const paidValue = invoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount || 0), 0);
  const unpaid = invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due || 0), 0);
  const paid = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() === 'paid').length;

  if (totalEl) totalEl.innerText = formatMoney(total);
  if (unpaidEl) unpaidEl.innerText = formatMoney(unpaid);
  if (sentPaidEl) sentPaidEl.innerText = `${formatMoney(paidValue)} / ${paid}`;
}

function paymentHistoryRows(payments, invoiceId) {
  if (!payments.length) {
    return '<tr><td colspan="6">No payments recorded yet.</td></tr>';
  }

  return payments.map((payment) => `
    <tr>
      <td>${escapeHtml(payment.payment_date || '-')}</td>
      <td>${escapeHtml(formatMoney(payment.amount))}</td>
      <td>${escapeHtml(payment.method || '-')}</td>
      <td>${escapeHtml(payment.reference || '-')}</td>
      <td>${escapeHtml(payment.notes || '-')}</td>
      <td><button class="danger-btn" onclick="deleteInvoicePayment(${invoiceId}, ${payment.id})">Delete</button></td>
    </tr>
  `).join('');
}

async function openInvoicePaymentDialog(invoiceId) {
  const res = await fetch(`/api/invoice/${invoiceId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Failed to load invoice payment details');
    return;
  }

  const invoice = data.invoice || {};
  const payments = data.payments || [];
  const balanceDue = Number(invoice.balance_due || 0);

  showDialog(
    `Payments: ${invoice.invoice_no || 'Invoice'}`,
    `
      <div class="payment-summary-grid">
        <div class="payment-summary-card">
          <span>Invoice Total</span>
          <strong>${escapeHtml(formatMoney(invoice.total))}</strong>
        </div>
        <div class="payment-summary-card">
          <span>Payment Taken</span>
          <strong class="money-positive">${escapeHtml(formatMoney(invoice.paid_amount))}</strong>
        </div>
        <div class="payment-summary-card">
          <span>Debt / Balance Left</span>
          <strong class="${balanceDue > 0 ? 'money-danger' : 'money-positive'}">${escapeHtml(formatMoney(balanceDue))}</strong>
        </div>
      </div>

      <div class="stock-dialog-grid payment-dialog-grid">
        <div class="dialog-card">
          <h4>Record Payment</h4>
          <label class="field-label">Amount received</label>
          <input id="paymentAmount" type="number" min="0.01" max="${escapeHtml(balanceDue)}" step="0.01" value="${escapeHtml(balanceDue || '')}" placeholder="Payment amount" />
          <label class="field-label">Payment date</label>
          <input id="paymentDate" type="date" value="${todayISO()}" />
          <label class="field-label">Payment method</label>
          <select id="paymentMethod">
            <option>Bank transfer</option>
            <option>Card</option>
            <option>Cash</option>
            <option>Online payment</option>
            <option>Cheque</option>
            <option>Other</option>
          </select>
          <label class="field-label">Reference / receipt number</label>
          <input id="paymentReference" placeholder="Bank reference, receipt, transaction ID" />
          <label class="field-label">Accounts note</label>
          <textarea id="paymentNotes" rows="3" placeholder="Deposit, partial payment, follow-up note"></textarea>
        </div>
        <div class="dialog-card">
          <h4>Payment History</h4>
          <div class="mini-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${paymentHistoryRows(payments, invoiceId)}</tbody>
            </table>
          </div>
        </div>
      </div>
    `,
    async () => {
      const amount = Number(document.getElementById('paymentAmount')?.value || 0);
      const body = {
        invoice_id: invoiceId,
        amount,
        payment_date: document.getElementById('paymentDate')?.value,
        method: document.getElementById('paymentMethod')?.value,
        reference: document.getElementById('paymentReference')?.value.trim(),
        notes: document.getElementById('paymentNotes')?.value.trim()
      };

      if (amount <= 0) {
        showToast('Enter payment amount');
        return;
      }

      const payRes = await fetch('/api/invoice/payment', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const payData = await safeJson(payRes);

      if (!payRes.ok) {
        showToast(payData.message || 'Payment save failed');
        return;
      }

      hideDialog();
      showToast(payData.message || 'Payment saved');
      await loadInvoices();
      await loadDashboardStats();
    },
    'Save Payment'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

async function deleteInvoicePayment(invoiceId, paymentId) {
  if (!confirm('Delete this payment entry?')) return;

  const res = await fetch('/api/invoice/payment/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ invoice_id: invoiceId, payment_id: paymentId })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Payment delete failed');
    return;
  }

  showToast(data.message || 'Payment deleted');
  hideDialog();
  await loadInvoices();
  await loadDashboardStats();
  await openInvoicePaymentDialog(invoiceId);
}

function customerStatementPdfUrl(match, download = false) {
  const params = new URLSearchParams({
    token,
    customer_name: match.customer_name || '',
    customer_email: match.customer_email || ''
  });
  if (download) params.set('download', '1');
  return `/api/invoice/statement/pdf?${params.toString()}`;
}

function statementMatchCards(matches) {
  if (!matches.length) {
    return '<div class="empty-state">Search customer name, email, or invoice number to build a full account statement.</div>';
  }

  return matches.map((match, index) => `
    <article class="statement-result-card">
      <div>
        <strong>${escapeHtml(match.customer_name || 'Customer')}</strong>
        <span>${escapeHtml(match.customer_email || '-')}</span>
      </div>
      <div class="statement-result-metrics">
        <span>${escapeHtml(match.invoice_count || 0)} invoices</span>
        <span>Paid ${escapeHtml(formatMoney(match.paid_amount))}</span>
        <span class="${Number(match.balance_due || 0) > 0 ? 'money-danger' : 'money-positive'}">Debt ${escapeHtml(formatMoney(match.balance_due))}</span>
      </div>
      <div class="card-actions">
        <button class="small-btn" onclick="openCustomerStatementPdf(${index}, false)">Open PDF</button>
        <button class="secondary-btn" onclick="openCustomerStatementPdf(${index}, true)">Download</button>
        <button class="primary-btn" onclick="openCustomerStatementSendDialog(${index})">Send</button>
      </div>
    </article>
  `).join('');
}

async function runCustomerStatementSearch() {
  const input = document.getElementById('statementSearchInput');
  const results = document.getElementById('statementSearchResults');
  const search = input?.value.trim() || '';

  if (!results) return;
  if (search.length < 2) {
    results.innerHTML = '<div class="empty-state">Type at least 2 letters.</div>';
    return;
  }

  results.innerHTML = '<div class="empty-state">Searching account history...</div>';
  const res = await fetch(`/api/invoice/statement/search?search=${encodeURIComponent(search)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    results.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Statement search failed')}</div>`;
    return;
  }

  window.__statementMatches = data.matches || [];
  results.innerHTML = statementMatchCards(window.__statementMatches);
}

function openCustomerStatementPdf(index, download = false) {
  const match = (window.__statementMatches || [])[index];
  if (!match) {
    showToast('Choose a customer first');
    return;
  }
  window.open(customerStatementPdfUrl(match, download), '_blank', 'noopener');
}

function openCustomerStatementDialog() {
  window.__statementMatches = [];
  showDialog(
    'Customer Payment Statement',
    `
      <p class="status-note">Search once to see the customer whole invoice, payment and debt history. Then open PDF, download it, email it, or prepare a WhatsApp message.</p>
      <div class="statement-search-bar">
        <input id="statementSearchInput" placeholder="Search customer name, email or invoice number" onkeydown="if(event.key === 'Enter') runCustomerStatementSearch()" />
        <button class="primary-btn" type="button" onclick="runCustomerStatementSearch()">Search</button>
      </div>
      <div id="statementSearchResults" class="statement-results">
        <div class="empty-state">Search customer name, email, or invoice number to build a full account statement.</div>
      </div>
    `,
    () => hideDialog(),
    'Close'
  );
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

function openCustomerStatementSendDialog(index) {
  const match = (window.__statementMatches || [])[index];
  if (!match) {
    showToast('Choose a customer first');
    return;
  }

  showDialog(
    `Send Statement: ${match.customer_name || 'Customer'}`,
    `
      <div class="payment-summary-grid">
        <div class="payment-summary-card"><span>Invoice Value</span><strong>${escapeHtml(formatMoney(match.invoice_value))}</strong></div>
        <div class="payment-summary-card"><span>Payments Taken</span><strong class="money-positive">${escapeHtml(formatMoney(match.paid_amount))}</strong></div>
        <div class="payment-summary-card"><span>Debt Left</span><strong class="${Number(match.balance_due || 0) > 0 ? 'money-danger' : 'money-positive'}">${escapeHtml(formatMoney(match.balance_due))}</strong></div>
      </div>
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Email PDF Statement</h4>
          <label class="field-label">Email address</label>
          <input id="statementEmail" type="email" value="${escapeHtml(match.customer_email || '')}" placeholder="customer@email.com" />
        </div>
        <div class="dialog-card">
          <h4>WhatsApp Summary</h4>
          <label class="field-label">Mobile number with country code</label>
          <input id="statementMobile" placeholder="614xxxxxxxx" />
          <p class="status-note">WhatsApp opens with the payment summary. Attach the downloaded PDF if required.</p>
        </div>
      </div>
    `,
    async () => {
      const body = {
        customer_name: match.customer_name || '',
        customer_email: match.customer_email || '',
        email: document.getElementById('statementEmail')?.value.trim(),
        mobile: document.getElementById('statementMobile')?.value.trim()
      };

      if (!body.email && !body.mobile) {
        showToast('Enter email or mobile number');
        return;
      }

      const res = await fetch('/api/invoice/statement/send', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Statement send failed');
        return;
      }

      showToast(data.message || 'Statement ready');
      if (data.whatsapp_url) window.open(data.whatsapp_url, '_blank', 'noopener');
      hideDialog();
    },
    'Send Statement'
  );
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

function openInvoicePdf(invoiceId) {
  const url = `/invoice/view?id=${encodeURIComponent(invoiceId)}`;
  const opened = window.open(url, '_blank', 'noopener');

  if (!opened) {
    window.location.href = url;
  }
}

async function openInvoiceQrDialog(invoiceId) {
  const invoice = invoiceCache.find((item) => Number(item.id) === Number(invoiceId));
  const invoiceNo = invoice?.invoice_no || `INV-${invoiceId}`;
  const invoiceUrl = `${window.location.origin}/invoice/view?id=${encodeURIComponent(invoiceId)}`;
  const qrUrl = `/api/qr?data=${encodeURIComponent(invoiceUrl)}`;

  showDialog(
    `Invoice QR - ${escapeHtml(invoiceNo)}`,
    `
      <div class="invoice-qr-dialog">
        <div class="invoice-qr-card">
          <img src="${qrUrl}" alt="Invoice QR code for ${escapeHtml(invoiceNo)}" />
          <strong>Scan to open invoice</strong>
          <span>Invoice ${escapeHtml(invoiceNo)} opens in the secure Voxel Veda invoice viewer.</span>
        </div>
        <div class="invoice-qr-actions">
          <button type="button" class="primary-btn" onclick="openInvoicePdf(${Number(invoiceId)})">Open Invoice</button>
          <a class="secondary-btn" href="${qrUrl}" download="${escapeHtml(invoiceNo)}-qr.png">Download QR</a>
        </div>
      </div>
    `,
    () => hideDialog(),
    'Close'
  );
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
  const invoice = invoiceCache.find((item) => Number(item.id) === Number(invoiceId));
  const invoiceReference = invoice?.invoice_no || `INV-${invoiceId}`;
  showDialog(
    'Send Invoice',
    `
      <p class="status-note">Send the PDF by email. Mobile number is saved on the send record for follow-up/SMS setup.</p>
      <input id="sendInvoiceEmail" type="email" placeholder="Customer email address" />
      <input id="sendInvoiceMobile" placeholder="Customer mobile number" />
      <div id="sendInvoiceDeliveryStatus" class="email-delivery-status" hidden></div>
      <div class="document-recovery-actions">
        <button type="button" class="secondary-btn" onclick="openInvoicePdf(${Number(invoiceId)})">Preview PDF</button>
        <button type="button" class="secondary-btn" onclick="openInvoiceMailDraft(${Number(invoiceId)})">Open Mail Draft</button>
      </div>
    `,
    async () => {
      const sendButton = document.getElementById('dialogPrimaryBtn');
      if (sendButton?.disabled) return;
      const email = document.getElementById('sendInvoiceEmail')?.value.trim();
      const mobile = document.getElementById('sendInvoiceMobile')?.value.trim();

      if (!email && !mobile) {
        showToast('Enter email or mobile number');
        return;
      }

      if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = 'Sending...';
      }

      try {
        const res = await fetch('/api/invoice/send', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ invoice_id: invoiceId, email, mobile })
        });

        const data = await safeJson(res);

        if (!res.ok) {
          const status = document.getElementById('sendInvoiceDeliveryStatus');
          if (status && /^EMAIL_|^SMTP_/.test(String(data.code || ''))) {
            status.hidden = false;
            status.setAttribute('role', 'status');
            status.innerHTML = `<strong>Delivery options for ${escapeHtml(invoiceReference)}</strong><span>${escapeHtml(data.message || 'Direct delivery is unavailable. Preview the PDF or open a prepared mail draft below.')}</span>`;
            if (sendButton) sendButton.dataset.deliveryUnavailable = 'true';
          } else {
            showToast(data.message || 'Invoice send failed');
          }
          return;
        }

        hideDialog();
        showToast(data.message || 'Invoice sent');
        await loadInvoices();
        await loadDashboardStats();
      } catch (error) {
        const status = document.getElementById('sendInvoiceDeliveryStatus');
        if (status) {
          status.hidden = false;
          status.setAttribute('role', 'status');
          status.innerHTML = `<strong>Delivery options for ${escapeHtml(invoiceReference)}</strong><span>The email service could not be reached. Preview the PDF or open a prepared mail draft below.</span>`;
        }
        if (sendButton) sendButton.dataset.deliveryUnavailable = 'true';
      } finally {
        if (sendButton && document.body.contains(sendButton)) {
          sendButton.disabled = false;
          sendButton.textContent = sendButton.dataset.deliveryUnavailable === 'true' ? 'Retry Email' : 'Send Invoice';
        }
      }
    },
    'Send Invoice'
  );
}

function openInvoiceMailDraft(invoiceId) {
  const invoice = invoiceCache.find((item) => Number(item.id) === Number(invoiceId));
  const reference = invoice?.invoice_no || `INV-${invoiceId}`;
  const email = document.getElementById('sendInvoiceEmail')?.value.trim() || invoice?.customer_email || '';
  const customer = invoice?.customer_name || 'Customer';
  const body = `Hello ${customer},\n\nPlease find invoice ${reference} from Voxel Veda. Use Preview PDF to open the invoice, then attach or share it from your device.\n\nThank you,\nVoxel Veda`;
  openEmailDraft(email, `Invoice ${reference} from Voxel Veda`, body);
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

  customerCache = chronologicalRows(data.customers || []);

  renderRegisterPage({
    key: 'customers',
    tbody,
    rows: customerCache,
    colspan: 7,
    emptyMessage: 'No customers saved yet.',
    onChange: loadCustomers,
    rowRenderer: (customer) => `
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
    `
  });
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

async function loadSuppliers() {
  const tbody = document.getElementById('supplierTableBody');
  if (!tbody) return;

  const res = await fetch('/api/suppliers', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load suppliers')}</td></tr>`;
    return;
  }

  supplierCache = chronologicalRows(data.suppliers || []);
  renderSuppliers();
}

function supplierFileTypeLabel(type) {
  const labels = {
    bill_invoice: 'Bill / Invoice',
    delivery_photo: 'Delivery Photo',
    delivery_invoice: 'Delivery Invoice',
    account_document: 'Account Document',
    note_attachment: 'Note Attachment'
  };

  return labels[type] || 'Supplier File';
}

function renderSuppliers() {
  const tbody = document.getElementById('supplierTableBody');
  if (!tbody) return;

  const query = String(document.getElementById('supplierSearch')?.value || '').trim().toLowerCase();
  const rows = supplierCache.filter((supplier) => {
    if (!query) return true;
    return [
      supplier.supplier_name,
      supplier.contact_name,
      supplier.email,
      supplier.phone,
      supplier.category,
      supplier.payment_terms,
      supplier.abn_acn,
      supplier.notes
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });

  renderRegisterPage({
    key: 'suppliers',
    tbody,
    rows,
    colspan: 7,
    emptyMessage: 'No suppliers found.',
    onChange: renderSuppliers,
    rowRenderer: (supplier) => {
    const files = supplier.files || [];
    const filePreview = files.slice(0, 3).map((file) => `
      <div class="file-row">
        <span>${escapeHtml(file.title || file.original_name)}</span>
        <div class="file-action-row">
          <button class="icon-btn" onclick="viewSupplierFile(${file.id})">View</button>
          <button class="mini-danger" onclick="deleteSupplierFile(${file.id})">Delete</button>
        </div>
      </div>
      <small>${escapeHtml(supplierFileTypeLabel(file.file_type))} - Uploaded ${escapeHtml(formatDateTime(file.created_at))}${file.notes ? ` - ${escapeHtml(file.notes)}` : ''}</small>
    `).join('');

    return `
      <tr>
        <td>
          <strong>${escapeHtml(supplier.supplier_name)}</strong><br>
          <span class="muted-text">${escapeHtml(supplier.address || '-')}</span>
        </td>
        <td>
          ${escapeHtml(supplier.contact_name || '-')}<br>
          <span class="muted-text">${escapeHtml(supplier.email || '-')}</span><br>
          <span class="muted-text">${escapeHtml(supplier.phone || '-')}</span>
        </td>
        <td>
          <strong>${escapeHtml(supplier.category || '-')}</strong><br>
          <span class="muted-text">${escapeHtml(supplier.payment_terms || '-')}</span><br>
          <span class="muted-text">${escapeHtml(supplier.abn_acn || '')}</span>
        </td>
        <td>
          ${filePreview || '<span class="muted-text">No files yet</span>'}
          ${files.length > 3 ? `<small>+${files.length - 3} more files</small>` : ''}
        </td>
        <td>${escapeHtml(supplier.notes || '-')}</td>
        <td>
          <span class="muted-text">Created: ${escapeHtml(supplier.created_by_name || '-')}</span><br>
          <span class="muted-text">Updated: ${escapeHtml(supplier.updated_by_name || '-')}</span>
        </td>
        <td>
          <button class="icon-btn" onclick="openSupplierDialog(${supplier.id})">Edit</button>
          <button class="icon-btn" onclick="openSupplierFileDialog(${supplier.id})">Upload</button>
          <button class="icon-btn danger-icon" onclick="deleteSupplier(${supplier.id})">Delete</button>
        </td>
      </tr>
    `;
    }
  });

  enhanceResponsiveTables();
}

function openSupplierDialog(id = null) {
  const supplier = supplierCache.find((row) => Number(row.id) === Number(id)) || {};

  showDialog(
    id ? 'Edit Supplier Profile' : 'Add Supplier Profile',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Supplier Identity</h4>
          <input id="supplierName" placeholder="Supplier / Company Name" value="${escapeHtml(supplier.supplier_name || '')}" />
          <input id="supplierContact" placeholder="Contact Person" value="${escapeHtml(supplier.contact_name || '')}" />
          <div class="split-grid">
            <input id="supplierEmail" type="email" placeholder="Email" value="${escapeHtml(supplier.email || '')}" />
            <input id="supplierPhone" placeholder="Phone / Mobile" value="${escapeHtml(supplier.phone || '')}" />
          </div>
          <textarea id="supplierAddress" rows="3" placeholder="Address">${escapeHtml(supplier.address || '')}</textarea>
        </div>
        <div class="dialog-card">
          <h4>Commercial Details</h4>
          <input id="supplierCategory" placeholder="Category: raw material, packaging, machine parts..." value="${escapeHtml(supplier.category || '')}" />
          <input id="supplierPaymentTerms" placeholder="Payment terms / account terms" value="${escapeHtml(supplier.payment_terms || '')}" />
          <input id="supplierAbnAcn" placeholder="ABN / ACN / Supplier ID" value="${escapeHtml(supplier.abn_acn || '')}" />
          <textarea id="supplierNotes" rows="4" placeholder="Notes, preferred delivery process, quality notes, payment notes">${escapeHtml(supplier.notes || '')}</textarea>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: supplier.id,
        supplier_name: document.getElementById('supplierName')?.value.trim(),
        contact_name: document.getElementById('supplierContact')?.value.trim(),
        email: document.getElementById('supplierEmail')?.value.trim(),
        phone: document.getElementById('supplierPhone')?.value.trim(),
        address: document.getElementById('supplierAddress')?.value.trim(),
        category: document.getElementById('supplierCategory')?.value.trim(),
        payment_terms: document.getElementById('supplierPaymentTerms')?.value.trim(),
        abn_acn: document.getElementById('supplierAbnAcn')?.value.trim(),
        notes: document.getElementById('supplierNotes')?.value.trim()
      };

      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Supplier save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Supplier saved');
      await loadSuppliers();
    },
    id ? 'Update Supplier' : 'Save Supplier'
  );
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'supplier-dialog');
}

function openSupplierFileDialog(supplierId) {
  const supplier = supplierCache.find((row) => Number(row.id) === Number(supplierId));
  if (!supplier) return;

  showDialog(
    `Upload Supplier File`,
    `
      <div class="stock-dialog-grid single-dialog-grid">
        <div class="dialog-card">
          <h4>${escapeHtml(supplier.supplier_name)}</h4>
          <select id="supplierFileType">
            <option value="bill_invoice">Paying Bill / Supplier Invoice</option>
            <option value="delivery_photo">Delivery Photo</option>
            <option value="delivery_invoice">Delivery Invoice / Docket</option>
            <option value="account_document">Account / Contract Document</option>
            <option value="note_attachment">Note Attachment</option>
          </select>
          <input id="supplierFileTitle" placeholder="File title / invoice number / delivery reference" />
          <input id="supplierFileInput" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
          <textarea id="supplierFileNotes" rows="4" placeholder="Notes about this bill, delivery invoice, photo, payment or issue"></textarea>
        </div>
      </div>
    `,
    async () => {
      const fileInput = document.getElementById('supplierFileInput');
      if (!fileInput?.files?.length) {
        showToast('Choose a bill, invoice, photo or document first');
        return;
      }

      const form = new FormData();
      form.append('file', fileInput.files[0]);
      form.append('file_type', document.getElementById('supplierFileType')?.value || 'bill_invoice');
      form.append('title', document.getElementById('supplierFileTitle')?.value.trim() || fileInput.files[0].name);
      form.append('notes', document.getElementById('supplierFileNotes')?.value.trim() || '');

      const res = await fetch(`/api/suppliers/${supplierId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Supplier file upload failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Supplier file uploaded');
      await loadSuppliers();
    },
    'Upload File'
  );
}

async function viewSupplierFile(id) {
  try {
    const res = await fetch(`/api/suppliers/files/${id}/view`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await safeJson(res);
      showToast(data.message || 'Supplier file could not be opened');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    showToast('Supplier file could not be opened');
  }
}

async function deleteSupplier(id) {
  if (!confirm('Delete this supplier profile and hide its files?')) return;

  const res = await fetch('/api/suppliers/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Supplier delete failed');
    return;
  }

  showToast(data.message || 'Supplier deleted');
  await loadSuppliers();
}

async function deleteSupplierFile(id) {
  if (!confirm('Delete this supplier file/photo?')) return;

  const res = await fetch('/api/suppliers/files/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Supplier file delete failed');
    return;
  }

  showToast(data.message || 'Supplier file deleted');
  await loadSuppliers();
}

function setExpenseFinancialYearOptions() {
  const select = document.getElementById('expenseFinancialYear');
  if (!select || select.dataset.ready) return;

  const now = new Date();
  const currentStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  select.innerHTML = `
    <option value="" selected>All years</option>
    ${Array.from({ length: 7 }, (_, index) => currentStart - index).map((year) => `
      <option value="${year}">FY ${year}-${year + 1}</option>
    `).join('')}
  `;
  select.dataset.ready = '1';
}

function setExpensePageSize() {
  expenseLimit = Number(document.getElementById('expensePageSize')?.value || 25);
  loadExpenses(1);
}

function changeExpensePage(delta) {
  loadExpenses(Math.max(1, expensePage + delta));
}

async function loadExpenses(page = expensePage) {
  const tbody = document.getElementById('expenseTableBody');
  if (!tbody) return;

  setExpenseFinancialYearOptions();
  expensePage = page;

  const params = new URLSearchParams({
    page: expensePage,
    limit: expenseLimit,
    fy: document.getElementById('expenseFinancialYear')?.value || '',
    search: document.getElementById('expenseSearch')?.value.trim() || ''
  });

  const res = await fetch(`/api/expenses?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="10">${escapeHtml(data.message || 'Failed to load expenses')}</td></tr>`;
    return;
  }

  expenseCache = data.expenses || [];
  renderNotificationDropdown();
  renderExpenseSummary(data.summary || {}, data.total || 0, data.page || 1, data.limit || expenseLimit);
  renderExpenseCharts(data.summary || {});

  if (!expenseCache.length) {
    tbody.innerHTML = `<tr><td colspan="10">No expenses found for this view.</td></tr>`;
    return;
  }

  tbody.innerHTML = expenseCache.map((expense) => `
    <tr>
      <td>${escapeHtml(formatDate(expense.expense_date))}</td>
      <td>
        <strong>${escapeHtml(expense.supplier_name || '-')}</strong><br>
        <span class="muted-text">${escapeHtml(expense.description || '-')}</span>
      </td>
      <td>${escapeHtml(expense.category || '-')}</td>
      <td>${escapeHtml(expense.invoice_no || '-')}</td>
      <td>${escapeHtml(formatMoney(expense.amount_ex_gst))}</td>
      <td>${escapeHtml(formatMoney(expense.gst_amount))}</td>
      <td><strong>${escapeHtml(formatMoney(expense.total_amount))}</strong></td>
      <td>${statusBadge(expense.status)}</td>
      <td>
        ${Number(expense.file_count || 0)
          ? `<button class="file-badge-btn" onclick="openExpenseFileDialog(${expense.id})">${escapeHtml(expense.file_count)} bill${Number(expense.file_count) === 1 ? '' : 's'} attached</button>`
          : '<span class="muted-text">No bill</span>'}
      </td>
      <td>
        <button class="icon-btn" onclick="openExpenseDialog(${expense.id})">Edit</button>
        <button class="icon-btn" onclick="openExpenseFileDialog(${expense.id})">Bill</button>
        <button class="icon-btn danger-icon" onclick="deleteExpense(${expense.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderExpenseSummary(summary, totalRows, page, limit) {
  setText('expenseTotalValue', formatMoney(summary.total_expense));
  setText('expenseGstPaid', formatMoney(summary.gst_paid));
  setText('expenseGstCollected', formatMoney(summary.gst_collected));
  setText('expenseGstPosition', formatMoney(summary.gst_position));

  const info = document.getElementById('expensePageInfo');
  if (info) {
    const start = totalRows ? ((page - 1) * limit) + 1 : 0;
    const end = Math.min(page * limit, totalRows);
    info.innerText = `FY ${summary.financial_year || '-'} | Showing ${start}-${end} of ${totalRows} entries`;
  }
}

function renderExpenseCharts(summary) {
  if (typeof Chart === 'undefined') return;

  const categoryCanvas = document.getElementById('expenseCategoryChart');
  const monthCanvas = document.getElementById('expenseMonthChart');
  if (!categoryCanvas || !monthCanvas) return;

  if (expenseCategoryChartInstance) expenseCategoryChartInstance.destroy();
  if (expenseMonthChartInstance) expenseMonthChartInstance.destroy();

  const categories = summary.categories || [];
  const months = summary.months || [];

  expenseCategoryChartInstance = new Chart(categoryCanvas, {
    type: 'doughnut',
    data: {
      labels: categories.map((row) => row.category),
      datasets: [{
        data: categories.map((row) => Number(row.total_amount || 0)),
        backgroundColor: ['#2dd4bf', '#38bdf8', '#818cf8', '#f59e0b', '#ef4444', '#22c55e', '#a78bfa', '#14b8a6']
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc' } } }
    }
  });

  expenseMonthChartInstance = new Chart(monthCanvas, {
    type: 'bar',
    data: {
      labels: months.map((row) => row.month),
      datasets: [{
        label: 'Expenses',
        data: months.map((row) => Number(row.total_amount || 0)),
        backgroundColor: '#38bdf8'
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f8fafc' } } },
      scales: {
        x: { ticks: { color: '#f8fafc' } },
        y: { beginAtZero: true, ticks: { color: '#f8fafc' } }
      }
    }
  });
}

function openExpenseDialog(id = null) {
  const expense = expenseCache.find((row) => Number(row.id) === Number(id)) || {};
  const amountExGst = Number(expense.amount_ex_gst || 0);
  const gstRate = Number(expense.gst_rate ?? 10);
  const expenseCategories = [
    'Fuel',
    'Vehicle & Transport',
    'Materials',
    'Raw Material',
    'Packaging',
    'Tools & Consumables',
    'Machinery',
    'Machine Maintenance',
    'Repairs & Servicing',
    'Workshop Supplies',
    'Freight & Courier',
    'Rent',
    'Utilities',
    'Software & Subscriptions',
    'Insurance',
    'Compliance & Licences',
    'Safety & PPE',
    'Professional Services',
    'Accounting & Bookkeeping',
    'Bank Fees',
    'Marketing',
    'Office Supplies',
    'Cleaning & Waste',
    'Staff Training',
    'Meals & Travel',
    'Other'
  ];
  const currentCategory = String(expense.category || '').trim();
  const categoryOptions = [...expenseCategories];
  if (currentCategory && !categoryOptions.includes(currentCategory)) {
    categoryOptions.push(currentCategory);
  }

  showDialog(
    id ? 'Edit Expense' : 'Add Expense',
    `
      <div class="expense-dialog-shell">
        <div class="dialog-card">
          <h4>Expense Details</h4>
          <label class="field-label">Expense date</label>
          <input id="expenseDate" type="date" value="${escapeHtml(expense.expense_date || todayISO())}" />
          <label class="field-label">Supplier / Company</label>
          <input id="expenseSupplier" placeholder="Supplier or company name" value="${escapeHtml(expense.supplier_name || '')}" />
          <label class="field-label">Category</label>
          <select id="expenseCategory">
            ${categoryOptions.map((cat) => `
              <option value="${cat}" ${currentCategory === cat ? 'selected' : ''}>${cat}</option>
            `).join('')}
          </select>
          <label class="field-label">Description</label>
          <textarea id="expenseDescription" rows="3" placeholder="What was purchased or paid for">${escapeHtml(expense.description || '')}</textarea>
        </div>

        <div class="dialog-card expense-money-card">
          <div class="expense-card-head">
            <div>
              <h4>Amount & GST</h4>
              <p>Enter the ex-GST amount. GST and total will calculate automatically.</p>
            </div>
            <span class="expense-status-chip">${escapeHtml(String(expense.status || 'paid').toUpperCase())}</span>
          </div>

          <label class="field-label">Invoice / bill number</label>
          <input id="expenseInvoiceNo" placeholder="Invoice or bill reference" value="${escapeHtml(expense.invoice_no || '')}" />
          <label class="field-label">Payment method</label>
          <input id="expensePaymentMethod" placeholder="Bank, card, cash, account" value="${escapeHtml(expense.payment_method || '')}" />

          <div class="split-grid">
            <div class="form-field">
              <span>Amount ex GST</span>
              <input id="expenseAmountExGst" type="number" min="0" step="0.01" value="${escapeHtml(amountExGst)}" oninput="calculateExpenseGst()" />
            </div>
            <div class="form-field">
              <span>GST rate %</span>
              <input id="expenseGstRate" type="number" min="0" step="0.01" value="${escapeHtml(gstRate)}" oninput="calculateExpenseGst()" />
            </div>
          </div>
          <div class="split-grid">
            <div class="form-field">
              <span>GST amount</span>
              <input id="expenseGstAmount" type="number" min="0" step="0.01" value="${escapeHtml(expense.gst_amount || (amountExGst * gstRate / 100).toFixed(2))}" oninput="updateExpenseSummaryTiles()" />
            </div>
            <div class="form-field">
              <span>Total paid</span>
              <input id="expenseTotalAmount" type="number" min="0" step="0.01" value="${escapeHtml(expense.total_amount || (amountExGst + (amountExGst * gstRate / 100)).toFixed(2))}" oninput="updateExpenseSummaryTiles()" />
            </div>
          </div>

          <label class="field-label">Payment status</label>
          <select id="expenseStatus" onchange="updateExpenseSummaryTiles()">
            ${['paid', 'unpaid', 'reimbursed', 'disputed'].map((status) => `
              <option value="${status}" ${String(expense.status || 'paid') === status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>

          <div class="expense-summary-strip">
            <div>
              <span>EX GST</span>
              <strong id="expenseSummaryExGst">$0.00</strong>
            </div>
            <div>
              <span>GST CREDIT</span>
              <strong id="expenseSummaryGst">$0.00</strong>
            </div>
            <div>
              <span>TOTAL PAID</span>
              <strong id="expenseSummaryTotal">$0.00</strong>
            </div>
          </div>

          <textarea id="expenseNotes" rows="3" placeholder="Notes, approval, GST reminder">${escapeHtml(expense.notes || '')}</textarea>
        </div>
      </div>
      <div class="expense-upload-note">
        <strong>Bill evidence</strong>
        <span>Save the expense first, then use the Bill button in the register to attach photos, invoices, receipts, and supporting files.</span>
      </div>
    `,
    async () => {
      const body = {
        id: expense.id,
        expense_date: document.getElementById('expenseDate')?.value,
        supplier_name: document.getElementById('expenseSupplier')?.value.trim(),
        category: document.getElementById('expenseCategory')?.value,
        description: document.getElementById('expenseDescription')?.value.trim(),
        invoice_no: document.getElementById('expenseInvoiceNo')?.value.trim(),
        payment_method: document.getElementById('expensePaymentMethod')?.value.trim(),
        amount_ex_gst: Number(document.getElementById('expenseAmountExGst')?.value || 0),
        gst_rate: Number(document.getElementById('expenseGstRate')?.value || 0),
        gst_amount: Number(document.getElementById('expenseGstAmount')?.value || 0),
        total_amount: Number(document.getElementById('expenseTotalAmount')?.value || 0),
        status: document.getElementById('expenseStatus')?.value,
        notes: document.getElementById('expenseNotes')?.value.trim()
      };

      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Expense save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Expense saved');
      const fySelect = document.getElementById('expenseFinancialYear');
      if (fySelect) fySelect.value = '';
      await loadExpenses(1);
    },
    id ? 'Update Expense' : 'Save Expense'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'expense-dialog-panel');
  updateExpenseSummaryTiles();
}

function calculateExpenseGst() {
  const amount = Number(document.getElementById('expenseAmountExGst')?.value || 0);
  const rate = Number(document.getElementById('expenseGstRate')?.value || 0);
  const gst = amount * (rate / 100);
  const total = amount + gst;
  const gstEl = document.getElementById('expenseGstAmount');
  const totalEl = document.getElementById('expenseTotalAmount');
  if (gstEl) gstEl.value = gst.toFixed(2);
  if (totalEl) totalEl.value = total.toFixed(2);
  updateExpenseSummaryTiles();
}

function updateExpenseSummaryTiles() {
  const amount = Number(document.getElementById('expenseAmountExGst')?.value || 0);
  const gst = Number(document.getElementById('expenseGstAmount')?.value || 0);
  const total = Number(document.getElementById('expenseTotalAmount')?.value || 0);
  const status = document.getElementById('expenseStatus')?.value || 'paid';
  const chip = document.querySelector('.expense-status-chip');

  setText('expenseSummaryExGst', formatMoney(amount));
  setText('expenseSummaryGst', formatMoney(gst));
  setText('expenseSummaryTotal', formatMoney(total));
  if (chip) chip.textContent = status.toUpperCase();
}

function openExpenseFileDialog(id) {
  const expense = expenseCache.find((row) => Number(row.id) === Number(id)) || {};
  const files = Array.isArray(expense.files) ? expense.files : [];
  const fileRows = files.length ? files.map((file) => `
    <div class="file-row expense-file-row">
      <div>
        <a href="${escapeHtml(file.file_path)}" target="_blank" rel="noopener">${escapeHtml(file.original_name || 'Expense bill')}</a>
        <small>
          ${escapeHtml(file.mime_type || 'file')} |
          Uploaded ${escapeHtml(formatDateTime(file.created_at))}
          ${file.uploaded_by_name ? ` by ${escapeHtml(file.uploaded_by_name)}` : ''}
        </small>
      </div>
      <div class="file-action-row">
        <button class="icon-btn" onclick="viewExpenseFile(${file.id})">View</button>
        <button class="mini-danger" onclick="deleteExpenseFile(${file.id})">Delete</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state">No bill photo or file uploaded yet.</div>';

  showDialog(
    'Expense Bills & Photos',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Attached Bills</h4>
          <p class="status-note">${escapeHtml(expense.supplier_name || 'Expense')} | ${escapeHtml(expense.invoice_no || 'No bill number')}</p>
          <div class="expense-file-list">
            ${fileRows}
          </div>
        </div>
        <div class="dialog-card">
          <h4>Upload Another Bill</h4>
          <p class="status-note">Take a bill photo from your phone or upload a PDF/image. Every file stays linked to this expense for audit and GST records.</p>
          <input id="expenseBillFile" type="file" accept="image/*,.pdf" capture="environment" />
          <p class="status-note">Automatic bill reading/OCR can be connected later with a dedicated OCR provider. Confirm the amount fields manually for accounting accuracy.</p>
        </div>
      </div>
    `,
    async () => {
      const file = document.getElementById('expenseBillFile')?.files?.[0];
      if (!file) {
        showToast('Choose a bill photo or file');
        return;
      }

      const form = new FormData();
      form.append('file', file);

      const res = await fetch(`/api/expenses/${id}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Bill upload failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Bill uploaded');
      await loadExpenses(expensePage);
    },
    'Upload Bill'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

async function viewExpenseFile(id) {
  try {
    const res = await fetch(`/api/expenses/files/${id}/view`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await safeJson(res);
      showToast(data.message || 'Bill file could not be opened');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    showToast('Bill file could not be opened');
  }
}

async function deleteExpenseFile(id) {
  if (!confirm('Delete this bill/photo only?')) return;

  const res = await fetch('/api/expenses/files/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Bill file delete failed');
    return;
  }

  showToast(data.message || 'Bill file deleted');
  hideDialog();
  await loadExpenses(expensePage);
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense entry?')) return;

  const res = await fetch('/api/expenses/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Expense delete failed');
    return;
  }

  showToast(data.message || 'Expense deleted');
  await loadExpenses(expensePage);
}

async function loadCompetitors() {
  const panel = document.getElementById('competitorRegister');
  if (panel) panel.innerHTML = '<div class="card">Loading competitors...</div>';

  const res = await fetch('/api/competitors', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    if (panel) panel.innerHTML = `<div class="card">${escapeHtml(data.message || 'Failed to load competitors')}</div>`;
    return;
  }

  competitorCache = data.competitors || [];
  populateCompetitorFilters();
  renderCompetitors();
}

function populateCompetitorFilters() {
  const categorySelect = document.getElementById('competitorCategoryFilter');
  const countrySelect = document.getElementById('competitorCountryFilter');
  if (!categorySelect || !countrySelect) return;

  const currentCategory = categorySelect.value;
  const currentCountry = countrySelect.value;
  const categories = [...new Set(competitorCache.map((item) => item.category).filter(Boolean))].sort();
  const countries = [...new Set(competitorCache.map((item) => item.country).filter(Boolean))].sort();

  categorySelect.innerHTML = '<option value="">All categories</option>' + categories.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
  countrySelect.innerHTML = '<option value="">All countries / regions</option>' + countries.map((item) => `<option>${escapeHtml(item)}</option>`).join('');

  if (categories.includes(currentCategory)) categorySelect.value = currentCategory;
  if (countries.includes(currentCountry)) countrySelect.value = currentCountry;
}

function renderCompetitors() {
  const panel = document.getElementById('competitorRegister');
  if (!panel) return;

  const category = String(document.getElementById('competitorCategoryFilter')?.value || '').trim();
  const country = String(document.getElementById('competitorCountryFilter')?.value || '').trim();
  const query = String(document.getElementById('competitorSearch')?.value || '').trim().toLowerCase();

  const rows = competitorCache.filter((item) => {
    if (category && item.category !== category) return false;
    if (country && item.country !== country) return false;
    if (!query) return true;
    return [
      item.company_name,
      item.category,
      item.country,
      item.city,
      item.website,
      item.capabilities,
      item.materials,
      item.target_market,
      item.strength,
      item.notes
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });

  const categories = new Set(competitorCache.map((item) => item.category).filter(Boolean));
  const countries = new Set(competitorCache.map((item) => item.country).filter(Boolean));
  setText('competitorTotal', competitorCache.length);
  setText('competitorCountries', countries.size);
  setText('competitorCategories', categories.size);

  if (!rows.length) {
    panel.innerHTML = '<div class="card">No competitor records found.</div>';
    return;
  }

  const grouped = rows.reduce((acc, item) => {
    const key = item.category || 'Uncategorised';
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  panel.innerHTML = Object.entries(grouped).map(([groupName, companies]) => `
    <div class="card form-group">
      <div class="section-head compact-head">
        <h3>${escapeHtml(groupName)}</h3>
        <span class="live-pill">${companies.length} companies</span>
      </div>
      <div class="form-card-grid competitor-card-grid">
        ${companies.map((company) => {
          const website = String(company.website || '').trim();
          const sourceUrl = String(company.source_url || website || '').trim();
          const onlineQuery = encodeURIComponent(`${company.company_name || ''} ${company.country || ''} engineering manufacturing 3D printing`);
          return `
            <article class="form-card competitor-card">
              <div class="competitor-card-head">
                <span class="status-chip">${escapeHtml(company.country || 'Worldwide')}</span>
                <h4>${escapeHtml(company.company_name)}</h4>
              </div>
              <div class="competitor-info-grid">
                <div class="competitor-info-row">
                  <span>Location</span>
                  <strong>${escapeHtml([company.city, company.country].filter(Boolean).join(', ') || '-')}</strong>
                </div>
                <div class="competitor-info-row">
                  <span>Capabilities</span>
                  <strong>${escapeHtml(company.capabilities || '-')}</strong>
                </div>
                <div class="competitor-info-row">
                  <span>Materials</span>
                  <strong>${escapeHtml(company.materials || '-')}</strong>
                </div>
                <div class="competitor-info-row">
                  <span>Market</span>
                  <strong>${escapeHtml(company.target_market || '-')}</strong>
                </div>
                <div class="competitor-info-row">
                  <span>Why track</span>
                  <strong>${escapeHtml(company.strength || company.notes || '-')}</strong>
                </div>
              </div>
              <div class="competitor-actions">
                ${website ? `<button class="icon-btn" onclick="window.open('${escapeHtml(website)}', '_blank', 'noopener')">Website</button>` : ''}
                ${sourceUrl ? `<button class="icon-btn" onclick="window.open('${escapeHtml(sourceUrl)}', '_blank', 'noopener')">Source</button>` : ''}
                <button class="icon-btn" onclick="window.open('https://www.google.com/search?q=${onlineQuery}', '_blank', 'noopener')">Search Online</button>
                <button class="icon-btn" onclick="openCompetitorDialog(${company.id})">Edit</button>
                <button class="danger-btn" onclick="deleteCompetitor(${company.id})">Delete</button>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function openCompetitorDialog(id = null) {
  const item = competitorCache.find((entry) => Number(entry.id) === Number(id)) || {};

  showDialog(
    id ? `Edit Competitor: ${item.company_name}` : 'Add Competitor / Industry Company',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Company Identity</h4>
          <input id="competitorName" placeholder="Company name" value="${escapeHtml(item.company_name || '')}" />
          <input id="competitorCategory" placeholder="Category, e.g. CNC, 3D Printing, Prototyping" value="${escapeHtml(item.category || '')}" />
          <div class="split-grid">
            <input id="competitorCountry" placeholder="Country / region" value="${escapeHtml(item.country || '')}" />
            <input id="competitorCity" placeholder="City / location" value="${escapeHtml(item.city || '')}" />
          </div>
          <input id="competitorWebsite" placeholder="Website" value="${escapeHtml(item.website || '')}" />
          <input id="competitorSourceUrl" placeholder="Source / listing URL" value="${escapeHtml(item.source_url || '')}" />
        </div>
        <div class="dialog-card">
          <h4>Industry Intelligence</h4>
          <textarea id="competitorCapabilities" rows="3" placeholder="What they do: 3D printing, CNC, design, production...">${escapeHtml(item.capabilities || '')}</textarea>
          <textarea id="competitorMaterials" rows="2" placeholder="Materials, technologies, equipment or services">${escapeHtml(item.materials || '')}</textarea>
          <textarea id="competitorTargetMarket" rows="2" placeholder="Customer type / target market">${escapeHtml(item.target_market || '')}</textarea>
          <textarea id="competitorStrength" rows="2" placeholder="What makes them strong or why to track them">${escapeHtml(item.strength || '')}</textarea>
          <textarea id="competitorNotes" rows="3" placeholder="Notes, pricing clues, delivery, quality, marketing, weakness...">${escapeHtml(item.notes || '')}</textarea>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: item.id,
        company_name: document.getElementById('competitorName')?.value.trim(),
        category: document.getElementById('competitorCategory')?.value.trim(),
        country: document.getElementById('competitorCountry')?.value.trim(),
        city: document.getElementById('competitorCity')?.value.trim(),
        website: document.getElementById('competitorWebsite')?.value.trim(),
        source_url: document.getElementById('competitorSourceUrl')?.value.trim(),
        source_type: item.source_type || 'manual',
        capabilities: document.getElementById('competitorCapabilities')?.value.trim(),
        materials: document.getElementById('competitorMaterials')?.value.trim(),
        target_market: document.getElementById('competitorTargetMarket')?.value.trim(),
        strength: document.getElementById('competitorStrength')?.value.trim(),
        notes: document.getElementById('competitorNotes')?.value.trim()
      };

      if (!body.company_name) {
        showToast('Company name is required');
        return;
      }

      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Competitor save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Competitor saved');
      await loadCompetitors();
    },
    id ? 'Update Company' : 'Save Company'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

async function seedIndustryCompetitors() {
  const res = await fetch('/api/competitors/seed', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Industry list load failed');
    return;
  }

  showToast(data.message || 'Industry list loaded');
  await loadCompetitors();
}

async function deleteCompetitor(id) {
  if (!confirm('Delete this competitor record?')) return;

  const res = await fetch('/api/competitors/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Competitor delete failed');
    return;
  }

  showToast(data.message || 'Competitor deleted');
  await loadCompetitors();
}

async function loadComplianceEntries() {
  const panel = document.getElementById('complianceRegister');
  if (!panel) return;

  const res = await fetch('/api/compliance', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    panel.innerHTML = `<div class="card">${escapeHtml(data.message || 'Failed to load compliance register')}</div>`;
    return;
  }

  complianceCache = data.entries || [];
  renderNotificationDropdown();
  renderComplianceEntries();
}

function complianceStatusLabel(status) {
  const labels = {
    review_required: 'Review required',
    active: 'Active',
    submitted: 'Submitted',
    approved: 'Approved',
    expired: 'Expired',
    not_applicable: 'Not applicable'
  };

  return labels[status] || 'Review required';
}

function complianceFileTypeLabel(type) {
  const labels = {
    form: 'Blank form',
    filled_form: 'Filled form',
    licence: 'Licence / Permit',
    process_sheet: 'Process sheet',
    council_record: 'Council record',
    export_import: 'Import / Export',
    evidence: 'Evidence / Photo'
  };

  return labels[type] || 'File';
}

function renderComplianceEntries() {
  const panel = document.getElementById('complianceRegister');
  if (!panel) return;

  const category = String(document.getElementById('complianceCategoryFilter')?.value || '').trim();
  const query = String(document.getElementById('complianceSearch')?.value || '').trim().toLowerCase();
  const rows = complianceCache.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (!query) return true;
    return [
      entry.category,
      entry.title,
      entry.authority,
      entry.requirement_type,
      entry.status,
      entry.form_number,
      entry.notes,
      entry.filled_notes
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });

  const reviewCount = complianceCache.filter((entry) => ['review_required', 'expired'].includes(entry.status)).length;
  const processCount = complianceCache.filter((entry) => entry.process_sheet_required).length;
  const fileCount = complianceCache.reduce((sum, entry) => sum + (entry.files || []).length, 0);
  const reviewEl = document.getElementById('complianceReviewCount');
  const processEl = document.getElementById('complianceProcessCount');
  const fileEl = document.getElementById('complianceFileCount');
  if (reviewEl) reviewEl.innerText = reviewCount;
  if (processEl) processEl.innerText = processCount;
  if (fileEl) fileEl.innerText = fileCount;

  if (!rows.length) {
    panel.innerHTML = '<div class="card">No compliance entries found.</div>';
    return;
  }

  const grouped = rows.reduce((acc, entry) => {
    acc[entry.category] = acc[entry.category] || [];
    acc[entry.category].push(entry);
    return acc;
  }, {});

  panel.innerHTML = Object.entries(grouped).map(([groupName, entries]) => `
    <div class="card compliance-group">
      <div class="section-head compact-head">
        <h3>${escapeHtml(groupName)}</h3>
        <span class="live-pill">${entries.length} entries</span>
      </div>
      <div class="compliance-grid">
        ${entries.map((entry) => renderComplianceCard(entry)).join('')}
      </div>
    </div>
  `).join('');
}

function renderComplianceCard(entry) {
  const files = entry.files || [];
  const fileList = files.map((file) => `
    <div class="file-row">
      <a href="${escapeHtml(file.file_path)}" target="_blank" rel="noopener">${escapeHtml(file.file_label || file.original_name)}</a>
      <button class="mini-danger" onclick="deleteComplianceFile(${file.id})">Delete</button>
    </div>
    <small>${escapeHtml(complianceFileTypeLabel(file.file_type))} - Uploaded ${escapeHtml(formatDateTime(file.created_at))} by ${escapeHtml(file.uploaded_by_name || '-')}</small>
  `).join('');

  return `
    <article class="compliance-card">
      <div class="compliance-card-top">
        <div>
          <h4>${escapeHtml(entry.title)}</h4>
          <p>${escapeHtml(entry.authority || '-')}</p>
        </div>
        <span class="status-chip">${escapeHtml(complianceStatusLabel(entry.status))}</span>
      </div>
      <div class="compliance-meta">
        <span>Type: ${escapeHtml(entry.requirement_type || '-')}</span>
        <span>Form: ${escapeHtml(entry.form_number || '-')}</span>
        <span>Due: ${escapeHtml(formatDate(entry.due_date))}</span>
        <span>Renewal: ${escapeHtml(formatDate(entry.renewal_date))}</span>
      </div>
      ${entry.process_sheet_required ? '<div class="warning-strip">Process sheet required for related jobs</div>' : ''}
      <p class="muted-text">${escapeHtml(entry.notes || '-')}</p>
      ${entry.filled_notes ? `<p>${escapeHtml(entry.filled_notes)}</p>` : ''}
      ${entry.official_link ? `<a class="secondary-link" href="${escapeHtml(entry.official_link)}" target="_blank" rel="noopener">Preview original form / guidance</a>` : ''}
      <div class="compliance-files">${fileList || '<span class="muted-text">No uploaded forms yet.</span>'}</div>
      <div class="dialog-actions inline-actions">
        <button class="icon-btn" onclick="openComplianceDialog(${entry.id})">Edit / Fill</button>
        <button class="icon-btn" onclick="openComplianceFileDialog(${entry.id})">Upload</button>
        <button class="icon-btn danger-icon" onclick="deleteComplianceEntry(${entry.id})">Delete</button>
      </div>
    </article>
  `;
}

function openComplianceDialog(id = null) {
  const entry = complianceCache.find((row) => Number(row.id) === Number(id)) || {};

  showDialog(
    id ? 'Edit / Fill Compliance Entry' : 'Add Compliance Entry',
    `
      <div class="stock-dialog-grid compliance-dialog-grid">
        <div class="dialog-card">
          <h4>Requirement Details</h4>
          <input id="complianceTitle" placeholder="Form, licence, permit or process sheet name" value="${escapeHtml(entry.title || '')}" />
          <div class="split-grid">
            <input id="complianceCategory" placeholder="Category" value="${escapeHtml(entry.category || 'Business Licences')}" />
            <input id="complianceAuthority" placeholder="Authority / Government body / Council" value="${escapeHtml(entry.authority || '')}" />
          </div>
          <div class="split-grid">
            <input id="complianceType" placeholder="Requirement type" value="${escapeHtml(entry.requirement_type || '')}" />
            <input id="complianceFormNumber" placeholder="Form / Licence number" value="${escapeHtml(entry.form_number || '')}" />
          </div>
          <input id="complianceOfficialLink" placeholder="Official link or reference URL" value="${escapeHtml(entry.official_link || '')}" />
        </div>
        <div class="dialog-card">
          <h4>Status & Dates</h4>
          <div class="split-grid">
            <select id="complianceStatus">
              ${['review_required', 'active', 'submitted', 'approved', 'expired', 'not_applicable'].map((status) => (
                `<option value="${status}" ${entry.status === status ? 'selected' : ''}>${complianceStatusLabel(status)}</option>`
              )).join('')}
            </select>
            <label class="access-check">
              <input id="complianceProcessRequired" type="checkbox" ${entry.process_sheet_required ? 'checked' : ''} />
              <span>Process sheet required</span>
            </label>
          </div>
          <div class="split-grid">
            <input id="complianceDueDate" type="date" value="${escapeHtml((entry.due_date || '').slice(0, 10))}" />
            <input id="complianceRenewalDate" type="date" value="${escapeHtml((entry.renewal_date || '').slice(0, 10))}" />
          </div>
          <textarea id="complianceNotes" rows="4" placeholder="Step-by-step requirements, government/council notes, documents needed">${escapeHtml(entry.notes || '')}</textarea>
        </div>
        <div class="dialog-card full-span">
          <h4>Fill / Internal Record</h4>
          <textarea id="complianceFilledNotes" rows="6" placeholder="Write the filled details here: reference numbers, submitted dates, approval notes, inspector comments, job process sheet details">${escapeHtml(entry.filled_notes || '')}</textarea>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: entry.id,
        title: document.getElementById('complianceTitle')?.value.trim(),
        category: document.getElementById('complianceCategory')?.value.trim(),
        authority: document.getElementById('complianceAuthority')?.value.trim(),
        requirement_type: document.getElementById('complianceType')?.value.trim(),
        form_number: document.getElementById('complianceFormNumber')?.value.trim(),
        official_link: document.getElementById('complianceOfficialLink')?.value.trim(),
        status: document.getElementById('complianceStatus')?.value,
        process_sheet_required: document.getElementById('complianceProcessRequired')?.checked,
        due_date: document.getElementById('complianceDueDate')?.value || null,
        renewal_date: document.getElementById('complianceRenewalDate')?.value || null,
        notes: document.getElementById('complianceNotes')?.value.trim(),
        filled_notes: document.getElementById('complianceFilledNotes')?.value.trim()
      };

      const res = await fetch('/api/compliance', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Compliance entry save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Compliance entry saved');
      await loadComplianceEntries();
    },
    id ? 'Update Entry' : 'Save Entry'
  );
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'compliance-dialog');
}

function openComplianceFileDialog(entryId) {
  const entry = complianceCache.find((row) => Number(row.id) === Number(entryId));
  if (!entry) return;

  showDialog(
    'Upload Compliance File',
    `
      <div class="stock-dialog-grid single-dialog-grid">
        <div class="dialog-card">
          <h4>${escapeHtml(entry.title)}</h4>
          <select id="complianceFileType">
            <option value="form">Blank form</option>
            <option value="filled_form">Filled form</option>
            <option value="licence">Licence / Permit</option>
            <option value="process_sheet">Process sheet</option>
            <option value="council_record">Council record</option>
            <option value="export_import">Import / Export</option>
            <option value="evidence">Evidence / Photo</option>
          </select>
          <input id="complianceFileLabel" placeholder="File label / licence number / job number" />
          <input id="complianceFileInput" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
        </div>
      </div>
    `,
    async () => {
      const fileInput = document.getElementById('complianceFileInput');
      if (!fileInput?.files?.length) {
        showToast('Choose a form, licence, process sheet or photo first');
        return;
      }

      const form = new FormData();
      form.append('file', fileInput.files[0]);
      form.append('file_type', document.getElementById('complianceFileType')?.value || 'form');
      form.append('file_label', document.getElementById('complianceFileLabel')?.value.trim() || fileInput.files[0].name);

      const res = await fetch(`/api/compliance/${entryId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Compliance file upload failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Compliance file uploaded');
      await loadComplianceEntries();
    },
    'Upload File'
  );
}

async function deleteComplianceEntry(id) {
  if (!confirm('Delete this compliance entry?')) return;

  const res = await fetch('/api/compliance/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Compliance delete failed');
    return;
  }

  showToast(data.message || 'Compliance entry deleted');
  await loadComplianceEntries();
}

async function deleteComplianceFile(id) {
  if (!confirm('Delete this uploaded compliance file?')) return;

  const res = await fetch('/api/compliance/files/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Compliance file delete failed');
    return;
  }

  showToast(data.message || 'Compliance file deleted');
  await loadComplianceEntries();
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

  const tasks = chronologicalRows(data.tasks || []);
  taskCache = tasks;

  renderRegisterPage({
    key: 'tasks',
    tbody,
    rows: tasks,
    colspan: 7,
    emptyMessage: 'No tasks assigned yet.',
    onChange: loadTasks,
    rowRenderer: (t) => `
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
          <button class="small-btn" onclick="openTaskDialog(${t.id})">Edit</button>
          <button class="small-btn danger-icon" onclick="deleteTask(${t.id})">Delete</button>
        </td>
      </tr>
    `
  });

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
  const res = await fetch('/api/tasks/status', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ task_id: id, status })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Task update failed');
    return;
  }

  await loadTasks();
}

function openTaskDialog(id) {
  const task = taskCache.find((row) => Number(row.id) === Number(id));
  if (!task) return;

  const staffOptions = staffCache
    .filter((u) => String(u.role || '').toLowerCase() !== 'admin')
    .map((u) => `<option value="${u.id}" ${Number(task.assigned_to) === Number(u.id) ? 'selected' : ''}>${escapeHtml(u.name || u.email)}</option>`)
    .join('');

  showDialog(
    'Edit Task',
    `
      <div class="stock-dialog-grid single-dialog-grid">
        <div class="dialog-card">
          <h4>Task Details</h4>
          <input id="editTaskTitle" placeholder="Task title" value="${escapeHtml(task.title || '')}" />
          <textarea id="editTaskDescription" rows="4" placeholder="Task instructions">${escapeHtml(task.description || '')}</textarea>
          <div class="split-grid">
            <select id="editTaskAssignedTo">${staffOptions}</select>
            <select id="editTaskPriority">
              ${['low', 'medium', 'high', 'urgent'].map((priority) => `<option value="${priority}" ${task.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}
            </select>
          </div>
          <div class="split-grid">
            <input id="editTaskDueDate" type="date" value="${escapeHtml(String(task.due_date || '').slice(0, 10))}" />
            <select id="editTaskStatus">
              ${['pending', 'in_progress', 'done'].map((status) => `<option value="${status}" ${task.status === status ? 'selected' : ''}>${status}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    `,
    async () => {
      const body = {
        task_id: task.id,
        title: document.getElementById('editTaskTitle')?.value.trim(),
        description: document.getElementById('editTaskDescription')?.value.trim(),
        assigned_to: Number(document.getElementById('editTaskAssignedTo')?.value),
        priority: document.getElementById('editTaskPriority')?.value,
        due_date: document.getElementById('editTaskDueDate')?.value,
        status: document.getElementById('editTaskStatus')?.value
      };

      const res = await fetch('/api/tasks/update', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Task update failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Task updated');
      await loadTasks();
    },
    'Update Task'
  );
}

async function deleteTask(id) {
  if (!confirm('Delete this task from the register?')) return;

  const res = await fetch('/api/tasks/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ task_id: id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Task delete failed');
    return;
  }

  showToast(data.message || 'Task deleted');
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

  announcementCache = chronologicalRows(data.announcements || []);

  renderRegisterPage({
    key: 'announcements',
    tbody,
    rows: announcementCache,
    colspan: 7,
    emptyMessage: 'No announcements yet.',
    onChange: loadAnnouncements,
    rowRenderer: (item) => {
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
        <td>
          <button class="icon-btn" onclick="openAnnouncementDialog(${item.id})">Edit</button>
          <button class="icon-btn danger-icon" onclick="deleteAnnouncement(${item.id})">Delete</button>
        </td>
      </tr>
    `;
    }
  });
}

function openAnnouncementDialog(id = null) {
  const item = announcementCache.find((row) => Number(row.id) === Number(id)) || {};
  const targets = Array.isArray(item.target_user_ids) ? item.target_user_ids.map(Number) : [];
  const staffOptions = staffCache
    .filter((u) => String(u.role || '').toLowerCase() !== 'admin')
    .map((u) => `
      <label class="access-check">
        <input type="checkbox" class="announcement-target" value="${u.id}" ${targets.includes(Number(u.id)) ? 'checked' : ''} />
        <span>${escapeHtml(u.name || u.email)} (${escapeHtml(u.email || u.username || '')})</span>
      </label>
    `).join('');

  showDialog(
    id ? 'Edit Announcement' : 'New Announcement',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>News Details</h4>
          <input id="announcementTitle" placeholder="Announcement title" value="${escapeHtml(item.title || '')}" />
          <textarea id="announcementMessage" rows="4" placeholder="Important message or news">${escapeHtml(item.message || '')}</textarea>
          <div class="split-grid">
            <select id="announcementPriority">
              ${['normal', 'high', 'urgent'].map((priority) => `<option value="${priority}" ${item.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}
            </select>
            <select id="announcementAudience">
              <option value="selected" ${item.audience_type !== 'all' ? 'selected' : ''}>Selected Staff</option>
              <option value="all" ${item.audience_type === 'all' ? 'selected' : ''}>Everyone</option>
            </select>
          </div>
          <div class="split-grid">
            <input id="announcementStartsAt" type="date" value="${escapeHtml(String(item.starts_at || todayISO()).slice(0, 10))}" />
            <input id="announcementExpiresAt" type="date" value="${escapeHtml(String(item.expires_at || todayISO(7)).slice(0, 10))}" />
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
        id: item.id,
        title: document.getElementById('announcementTitle')?.value.trim(),
        message: document.getElementById('announcementMessage')?.value.trim(),
        priority: document.getElementById('announcementPriority')?.value,
        audience_type: audience,
        target_user_ids: targetUserIds,
        starts_at: document.getElementById('announcementStartsAt')?.value,
        expires_at: document.getElementById('announcementExpiresAt')?.value
      };

      const res = await fetch(id ? '/api/tasks/announcements/update' : '/api/tasks/announcements', {
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
      showToast(data.message || (id ? 'Announcement updated' : 'Announcement published'));
      await loadAnnouncements();
    },
    id ? 'Update' : 'Publish'
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

  let res = await fetch('/api/users', {
    headers: { Authorization: `Bearer ${token}` }
  });

  let data = await safeJson(res);
  if (!res.ok && hasCurrentPermission('tasks')) {
    res = await fetch('/api/tasks/staff', {
      headers: { Authorization: `Bearer ${token}` }
    });
    data = await safeJson(res);
  }
  if (!res.ok) return;

  const users = chronologicalRows(data.users || []);
  staffCache = users;
  populateTimesheetStaffSelect(users);
  populateRosterStaffSelect(users);

  if (select) {
    select.innerHTML = '<option value="">Select Staff</option>';
    users.forEach((u) => {
      if (String(u.role).toLowerCase() !== 'admin') {
        select.innerHTML += `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`;
      }
    });
  }

  if (tbody) {
    renderRegisterPage({
      key: 'staff',
      tbody,
      rows: users,
      colspan: 8,
      emptyMessage: 'No staff users found.',
      onChange: loadStaff,
      rowRenderer: (u) => `
        <tr>
          <td>${escapeHtml(u.id)}</td>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.username || '-')}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.role)}</td>
          <td>${escapeHtml(String(u.role).toLowerCase() === 'admin' ? 'All sections' : accessLabels(parseAccess(u.permissions)).join(', ') || 'No extra access')}</td>
          <td>${statusBadge(u.active ? 'active' : 'disabled')}</td>
          <td>
            <div class="staff-account-actions">
              <button class="small-btn" onclick="openEditStaffDialog(${u.id})">Edit</button>
              <button class="small-btn" onclick="openAccessDialog(${u.id})">Access</button>
              <button class="secondary-btn" onclick="openPasswordResetDialog(${u.id})">Reset Password</button>
              ${Number(u.id) === Number(currentUser.id) ? '' : `<button class="danger-btn" onclick="openDeleteStaffDialog(${u.id})">Delete Account</button>`}
            </div>
          </td>
        </tr>
      `
    });
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


const ADMIN_WORK_HUB_MODULES = {
  leave: { title: 'Leave Requests', metric: 'Pending leave', placeholder: 'Leave request, date range or approval note' },
  availability: { title: 'Availability Planner', metric: 'Availability records', placeholder: 'Available days, restrictions or shift preference' },
  documents: { title: 'Staff Documents', metric: 'Document records', placeholder: 'Licence, induction, certificate or document note' },
  forms: { title: 'Forms & Checklists', metric: 'Checklist records', placeholder: 'Checklist, onboarding form or inspection record' },
  messages: { title: 'Staff Messages', metric: 'Message records', placeholder: 'Message subject or team instruction' }
};

function adminWorkHubStorageKey(type) {
  return `voxel-admin-workhub-${type}`;
}

function readAdminWorkHub(type) {
  try {
    return JSON.parse(localStorage.getItem(adminWorkHubStorageKey(type)) || '[]');
  } catch (_) {
    return [];
  }
}

function writeAdminWorkHub(type, rows) {
  localStorage.setItem(adminWorkHubStorageKey(type), JSON.stringify(rows));
}

function adminWorkHubCountId(type) {
  return {
    leave: 'adminWorkHubLeaveCount',
    availability: 'adminWorkHubAvailabilityCount',
    documents: 'adminWorkHubDocumentsCount',
    forms: 'adminWorkHubFormsCount',
    messages: 'adminWorkHubMessagesCount'
  }[type];
}

function isOpenWorkHubStatus(status) {
  return !['approved', 'reviewed', 'completed', 'closed', 'deleted'].includes(String(status || 'Open').toLowerCase());
}

function adminServerWorkHubRows(type) {
  return staffWorkRequestCache.filter((row) => String(row.request_type || '').toLowerCase() === type && !Number(row.deleted || 0));
}

function renderAdminWorkHubSummary() {
  Object.keys(ADMIN_WORK_HUB_MODULES).forEach((type) => {
    const localRows = readAdminWorkHub(type);
    const serverRows = type === 'messages'
      ? staffMessageCache.filter((row) => isOpenWorkHubStatus(row.status))
      : adminServerWorkHubRows(type).filter((row) => isOpenWorkHubStatus(row.status));
    const countEl = document.getElementById(adminWorkHubCountId(type));
    if (countEl) countEl.textContent = localRows.length + serverRows.length;
  });
}

function describeStaffWorkPayload(row) {
  let payload = {};
  try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch (_) { payload = {}; }
  const parts = [];
  if (payload.from || payload.to) parts.push(`${payload.from || '-'} to ${payload.to || '-'}`);
  if (payload.date) parts.push(payload.date);
  if (payload.result) parts.push(payload.result);
  if (payload.title && payload.title !== row.title) parts.push(payload.title);
  return parts.join(' | ');
}

function renderServerWorkHubRequest(row) {
  const meta = describeStaffWorkPayload(row);
  return `
    <article class="admin-workhub-row staff-request-row">
      <div>
        <strong>${escapeHtml(row.title || '-')} <span>${escapeHtml(row.request_type || '')}</span></strong>
        <span>${escapeHtml(row.staff_name || row.staff_email || 'Staff')} | ${escapeHtml(row.status || 'Open')} | ${escapeHtml(new Date(row.created_at || Date.now()).toLocaleString())}</span>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
        ${row.body ? `<small>${escapeHtml(row.body)}</small>` : ''}
      </div>
      <div class="admin-message-actions">
        <button type="button" class="primary-btn small-btn" onclick="updateStaffWorkRequest(${Number(row.id)}, 'Approved')">Approve</button>
        <button type="button" class="danger-btn small-btn" onclick="deleteStaffWorkRequest(${Number(row.id)})">Delete</button>
      </div>
    </article>`;
}

function renderAdminWorkHubRows(type) {
  const isMessageModule = type === 'messages';
  const serverRows = isMessageModule
    ? staffMessageCache.filter((row) => !Number(row.deleted || 0))
    : adminServerWorkHubRows(type);
  const localRows = readAdminWorkHub(type);
  if (!serverRows.length && !localRows.length) {
    return '<div class="empty-state compact">No staff requests or saved records yet.</div>';
  }
  const serverHtml = isMessageModule
    ? serverRows.map(renderAdminStaffMessageRow).join('')
    : serverRows.map(renderServerWorkHubRequest).join('');
  const localHtml = localRows.map((row) => `
    <article class="admin-workhub-row">
      <div>
        <strong>${escapeHtml(row.title || '-')}</strong>
        <span>${escapeHtml(row.assigned || 'All assigned staff')} | ${escapeHtml(row.due || 'No due date')} | ${escapeHtml(row.status || 'Open')}</span>
        ${row.notes ? `<small>${escapeHtml(row.notes)}</small>` : ''}
      </div>
      <button type="button" class="danger-btn small-btn" onclick="deleteAdminWorkHubEntry('${type}', ${Number(row.id)})">Delete</button>
    </article>
  `).join('');
  return serverHtml + localHtml;
}

async function openAdminWorkHub(type) {
  const config = ADMIN_WORK_HUB_MODULES[type];
  if (!config) return;
  if (type === 'messages') {
    await loadAdminStaffMessages();
    await loadAdminWorkHubRequests();
  } else {
    await loadAdminWorkHubRequests();
  }
  showDialog(config.title, `
    <div class="admin-workhub-dialog-body">
      <section class="admin-workhub-entry-form">
        <label>Record title<input id="adminWorkHubTitle" placeholder="${escapeHtml(config.placeholder)}" /></label>
        <label>Assigned to<input id="adminWorkHubAssigned" placeholder="Staff name, team or all staff" /></label>
        <label>Due / review date<input id="adminWorkHubDue" type="date" /></label>
        <label>Status
          <select id="adminWorkHubStatus">
            <option>Open</option>
            <option>Pending review</option>
            <option>Approved</option>
            <option>Completed</option>
          </select>
        </label>
        <label class="span-2">Notes<textarea id="adminWorkHubNotes" rows="3" placeholder="Add instruction, document reference, approval note or follow-up detail"></textarea></label>
      </section>
      <section>
        <div class="admin-workhub-register-head">
          <h4>Saved Records</h4>
          <span>${escapeHtml(config.metric)}</span>
        </div>
        <div id="adminWorkHubRegister" data-type="${escapeHtml(type)}" class="admin-workhub-register">${renderAdminWorkHubRows(type)}</div>
      </section>
    </div>
  `, () => saveAdminWorkHubEntry(type), 'Save Entry');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'admin-workhub-dialog');
}


async function loadAdminWorkHubRequests() {
  try {
    const res = await fetch('/api/tasks/workhub', { headers: authHeaders() });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || 'Failed to load staff requests');
    staffWorkRequestCache = Array.isArray(data.requests) ? data.requests : [];
    renderAdminWorkHubSummary();
    renderAdminStaffMessageSurfaces();
    const register = document.getElementById('adminWorkHubRegister');
    if (register && register.dataset.type) register.innerHTML = renderAdminWorkHubRows(register.dataset.type);
    renderNotificationDropdown();
    return staffWorkRequestCache;
  } catch (err) {
    staffWorkRequestCache = [];
    renderAdminWorkHubSummary();
    return [];
  }
}

async function updateStaffWorkRequest(id, status) {
  const res = await fetch('/api/tasks/workhub/update', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id, status })
  });
  const data = await safeJson(res);
  if (!res.ok) {
    showToast(data.message || 'Request update failed');
    return;
  }
  showToast(data.message || 'Request updated');
  await loadAdminWorkHubRequests();
}

async function deleteStaffWorkRequest(id) {
  const res = await fetch('/api/tasks/workhub/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);
  if (!res.ok) {
    showToast(data.message || 'Request delete failed');
    return;
  }
  showToast(data.message || 'Request deleted');
  await loadAdminWorkHubRequests();
}
async function loadAdminStaffMessages() {
  try {
    const res = await fetch('/api/tasks/messages', { headers: authHeaders() });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || 'Failed to load staff messages');
    staffMessageCache = Array.isArray(data.messages) ? data.messages : [];
    renderAdminWorkHubSummary();
    renderAdminStaffMessageSurfaces();
    renderNotificationDropdown();
    return staffMessageCache;
  } catch (err) {
    staffMessageCache = [];
    renderAdminWorkHubSummary();
    renderAdminStaffMessageSurfaces();
    return [];
  }
}

function renderAdminStaffMessageSurfaces() {
  const html = renderAdminUnifiedStaffQueueRows();
  ['adminStaffMessageRegister', 'adminStaffMessageInline'].forEach((id) => {
    const target = document.getElementById(id);
    if (target) target.innerHTML = html;
  });
}

function renderAdminUnifiedStaffQueueRows() {
  const messageRows = staffMessageCache.map((row) => ({ ...row, queue_type: 'message' }));
  const requestRows = staffWorkRequestCache.map((row) => ({ ...row, queue_type: row.request_type || 'request' }));
  const rows = [...messageRows, ...requestRows]
    .filter((row) => !Number(row.deleted || 0) && isOpenWorkHubStatus(row.status))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (!rows.length) return '<div class="empty-state compact">No staff requests waiting.</div>';
  return rows.map((row) => row.queue_type === 'message' ? renderAdminStaffMessageRow(row) : renderServerWorkHubRequest(row)).join('');
}

function renderAdminStaffMessageRows(rows = staffMessageCache) {
  if (!rows.length) return '<div class="empty-state compact">No staff messages waiting.</div>';
  return rows.map(renderAdminStaffMessageRow).join('');
}

function renderAdminStaffMessageRow(row) {
  return `
    <article class="admin-workhub-row staff-message-row">
      <div>
        <strong>${escapeHtml(row.staff_name || row.staff_email || 'Staff')} <span>${escapeHtml(row.priority || 'Normal')}</span></strong>
        <span>${escapeHtml(row.body || '')}</span>
        <small>${escapeHtml(new Date(row.created_at || Date.now()).toLocaleString())} | ${escapeHtml(row.status || 'Open')}</small>
      </div>
      <div class="admin-message-actions">
        <button type="button" class="primary-btn small-btn" onclick="updateAdminStaffMessage(${Number(row.id)}, 'Approved')">Approve</button>
        <button type="button" class="danger-btn small-btn" onclick="deleteAdminStaffMessage(${Number(row.id)})">Delete</button>
      </div>
    </article>`;
}

async function openAdminStaffMessages() {
  await loadAdminStaffMessages();
  await loadAdminWorkHubRequests();
  showDialog('Staff Messages', `
    <div class="admin-workhub-dialog-body single-column">
      <section>
        <div class="admin-workhub-register-head">
          <h4>Incoming Staff Queue</h4>
          <button type="button" class="secondary-btn small-btn" onclick="refreshAdminStaffMessagesPanel()">Refresh</button>
        </div>
        <div id="adminStaffMessageRegister" class="admin-workhub-register">${renderAdminUnifiedStaffQueueRows()}</div>
      </section>
    </div>
  `, hideDialog, 'Close');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'admin-workhub-dialog');
}

async function refreshAdminStaffMessagesPanel() {
  await loadAdminStaffMessages();
  await loadAdminWorkHubRequests();
  renderAdminStaffMessageSurfaces();
}

async function updateAdminStaffMessage(id, status) {
  const res = await fetch('/api/tasks/messages/update', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id, status })
  });
  const data = await safeJson(res);
  if (!res.ok) {
    showToast(data.message || 'Message update failed');
    return;
  }
  showToast(data.message || 'Message updated');
  await refreshAdminStaffMessagesPanel();
}

async function deleteAdminStaffMessage(id) {
  const res = await fetch('/api/tasks/messages/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);
  if (!res.ok) {
    showToast(data.message || 'Message delete failed');
    return;
  }
  showToast(data.message || 'Message deleted');
  await refreshAdminStaffMessagesPanel();
}
function saveAdminWorkHubEntry(type) {
  const title = document.getElementById('adminWorkHubTitle')?.value.trim();
  if (!title) {
    showToast('Please enter a record title', 'error');
    return;
  }
  const rows = readAdminWorkHub(type);
  rows.push({
    id: Date.now(),
    title,
    assigned: document.getElementById('adminWorkHubAssigned')?.value.trim() || 'All assigned staff',
    due: document.getElementById('adminWorkHubDue')?.value || '',
    status: document.getElementById('adminWorkHubStatus')?.value || 'Open',
    notes: document.getElementById('adminWorkHubNotes')?.value.trim() || '',
    createdAt: new Date().toISOString()
  });
  writeAdminWorkHub(type, rows);
  renderAdminWorkHubSummary();
  const register = document.getElementById('adminWorkHubRegister');
  if (register) register.innerHTML = renderAdminWorkHubRows(type);
  ['adminWorkHubTitle', 'adminWorkHubAssigned', 'adminWorkHubDue', 'adminWorkHubNotes'].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
  showToast('Saved successfully');
}

function deleteAdminWorkHubEntry(type, id) {
  const rows = readAdminWorkHub(type).filter((row) => Number(row.id) !== Number(id));
  writeAdminWorkHub(type, rows);
  renderAdminWorkHubSummary();
  const register = document.getElementById('adminWorkHubRegister');
  if (register) register.innerHTML = renderAdminWorkHubRows(type);
  showToast('Deleted successfully');
}

document.addEventListener('DOMContentLoaded', () => {
  renderAdminWorkHubSummary();
});

async function openAddStaff() {
  showDialog(
    'Add Staff Member',
    `
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <label class="form-field">
          <span>Full name</span>
          <input id="dialogStaffName" placeholder="Example: Neel Patel" autocomplete="name" />
        </label>
        <label class="form-field">
          <span>Email address</span>
          <input id="dialogStaffEmail" type="email" placeholder="name@company.com" autocomplete="email" />
        </label>
        <label class="form-field">
          <span>Login username</span>
          <input id="dialogStaffUsername" placeholder="Example: neel_17" autocomplete="username" />
        </label>
        <label class="form-field">
          <span>Temporary password</span>
          <input id="dialogStaffPassword" type="text" placeholder="Minimum 6 characters" autocomplete="new-password" />
        </label>
        <label class="form-field">
          <span>Role</span>
          <select id="dialogStaffRole">
            <option value="staff">Staff</option>
            <option value="sales">Sales</option>
            <option value="production">Production</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
      </div>
      <label class="access-toggle-row">
        <span>
          <strong>QR bypass for shift start/end</strong>
          <small>Use only for trusted emergency or supervisor-approved accounts.</small>
        </span>
        ${accessSwitchInput('attendance_qr_bypass', 'addStaffQrBypass', false, 'QR bypass for shift start/end')}
      </label>
      <h4>Section Access</h4>
      ${accessCheckboxes(['dashboard', 'tasks', 'attendance'])}
      <p class="status-note">Email and username are separate login options. Staff can sign in with either one.</p>
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

      if (!isValidEmail(email)) {
        showToast('Please enter a valid email address');
        return;
      }

      if (password.length < 6) {
        showToast('Temporary password must be at least 6 characters');
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

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'staff-access-dialog');

  const emailInput = document.getElementById('dialogStaffEmail');
  const usernameInput = document.getElementById('dialogStaffUsername');
  emailInput?.addEventListener('blur', () => {
    if (usernameInput && !usernameInput.value.trim()) {
      usernameInput.value = suggestUsernameFromEmail(emailInput.value);
    }
  });
}

function populateRosterStaffSelect(users = staffCache) {
  const select = document.getElementById('rosterStaffSelect');
  if (!select) return;

  const selected = new Set(Array.from(select.selectedOptions || []).map((option) => Number(option.value)));
  const staffUsers = users.filter((u) => String(u.role || '').toLowerCase() !== 'admin');

  select.innerHTML = staffUsers.map((u) => `
    <option value="${u.id}" ${selected.has(Number(u.id)) ? 'selected' : ''}>
      ${escapeHtml(u.name || u.email)} (${escapeHtml(u.email || u.username || '-')})
    </option>
  `).join('');
}

async function openEditStaffDialog(userId) {
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
    `Edit Staff: ${user.name}`,
    `
      <div class="form-grid" style="grid-template-columns:1fr 1fr;">
        <label class="form-field">
          <span>System ID</span>
          <input value="${escapeHtml(user.id)}" readonly />
        </label>
        <label class="form-field">
          <span>Full name</span>
          <input id="editStaffName" value="${escapeHtml(user.name || '')}" />
        </label>
        <label class="form-field">
          <span>Username</span>
          <input id="editStaffUsername" value="${escapeHtml(user.username || '')}" />
        </label>
        <label class="form-field">
          <span>Email address</span>
          <input id="editStaffEmail" type="email" value="${escapeHtml(user.email || '')}" />
        </label>
        <label class="form-field">
          <span>Role</span>
          <select id="editStaffRole">
            <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option>
            <option value="sales" ${user.role === 'sales' ? 'selected' : ''}>Sales</option>
            <option value="production" ${user.role === 'production' ? 'selected' : ''}>Production</option>
            <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </label>
        <label class="form-field">
          <span>Status</span>
          <select id="editStaffActive">
            <option value="1" ${user.active ? 'selected' : ''}>Active</option>
            <option value="0" ${!user.active ? 'selected' : ''}>Disabled</option>
          </select>
        </label>
      </div>
      <label class="access-toggle-row">
        <span>
          <strong>QR bypass for shift start/end</strong>
          <small>Use only for trusted emergency or supervisor-approved accounts.</small>
        </span>
        ${accessSwitchInput('attendance_qr_bypass', 'editStaffQrBypass', parseAccess(user.permissions).includes('attendance_qr_bypass'), 'QR bypass for shift start/end')}
      </label>
      <h4>Allowed Sections</h4>
      ${accessCheckboxes(parseAccess(user.permissions), 'editAccess')}
      <p class="status-note">System ID is fixed so existing timesheets, tasks, stock records and audit history stay connected.</p>
    `,
    async () => {
      const name = document.getElementById('editStaffName')?.value.trim();
      const username = document.getElementById('editStaffUsername')?.value.trim();
      const email = document.getElementById('editStaffEmail')?.value.trim();
      const role = document.getElementById('editStaffRole')?.value || 'staff';
      const active = document.getElementById('editStaffActive')?.value === '1';
      const permissions = collectAccess();

      if (!name || !username || !email || !role) {
        showToast('Name, username, email and role are required');
        return;
      }

      const updateRes = await fetch(`/api/users/${userId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, username, email, role, active, permissions })
      });

      const updateData = await safeJson(updateRes);

      if (!updateRes.ok) {
        showToast(updateData.message || 'Staff update failed');
        return;
      }

      hideDialog();
      showToast(updateData.message || 'Staff details updated');
      await loadStaff();
    },
    'Update Staff'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'staff-access-dialog');
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
      <label class="access-toggle-row">
        <span>
          <strong>QR bypass for shift start/end</strong>
          <small>Allow this user to clock in or out without scanning the live attendance QR.</small>
        </span>
        ${accessSwitchInput('attendance_qr_bypass', 'accessQrBypass', parseAccess(user.permissions).includes('attendance_qr_bypass'), 'QR bypass for shift start/end')}
      </label>
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
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'staff-access-dialog');
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

function openDeleteStaffDialog(userId) {
  const user = staffCache.find((item) => Number(item.id) === Number(userId));
  if (!user) {
    showToast('User not found');
    return;
  }

  showDialog(
    `Delete Account: ${user.name || user.email}`,
    `
      <div class="account-delete-warning">
        <strong>This permanently removes login access.</strong>
        <p>The account will disappear from Staff Management. Existing timesheets, approvals, stock records and audit history will remain linked to an anonymous system ID.</p>
      </div>
      <label class="form-field">
        <span>Reason (optional)</span>
        <textarea id="deleteStaffReason" rows="3" placeholder="Employment ended, duplicate account, account created in error"></textarea>
      </label>
      <label class="form-field">
        <span>Type DELETE to confirm</span>
        <input id="deleteStaffConfirmation" autocomplete="off" placeholder="DELETE" />
      </label>
    `,
    async () => {
      const confirmation = document.getElementById('deleteStaffConfirmation')?.value.trim();
      const reason = document.getElementById('deleteStaffReason')?.value.trim();
      if (confirmation !== 'DELETE') {
        showToast('Type DELETE to confirm account deletion');
        return;
      }

      const res = await fetch(`/api/users/${Number(userId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ reason })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        showToast(data.message || 'Account deletion failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'User account deleted');
      await loadStaff();
    },
    'Delete Account'
  );
  document.querySelector('.dialog-panel')?.classList.add('account-delete-dialog');
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

  const companyEmail = document.getElementById('settingEmail');
  if (companyEmail && !companyEmail.value.trim()) companyEmail.value = 'info@voxelveda.com';
  const testRecipient = document.getElementById('emailTestRecipient');
  if (testRecipient && !testRecipient.value.trim()) testRecipient.value = companyEmail?.value || 'info@voxelveda.com';

  updateQrTargetFromType();
  loadEmailControl();
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
  updateQrTargetFromType();
}

function emailRecipientLabel(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return parsed.filter(Boolean).join(', ') || '-';
  } catch {
    return String(value || '-');
  }
}

function emailStatusClass(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'SENT') return 'email-delivery-sent';
  if (value === 'FAILED') return 'email-delivery-failed';
  if (value === 'RETRY') return 'email-delivery-retry';
  return 'email-delivery-pending';
}

async function loadEmailControl() {
  const list = document.getElementById('emailDeliveryList');
  if (!list) return;

  try {
    const [configRes, queueRes, logsRes] = await Promise.all([
      fetch('/api/email/config', { headers: authHeaders() }),
      fetch('/api/email/queue?limit=50', { headers: authHeaders() }),
      fetch('/api/email/logs?limit=10', { headers: authHeaders() })
    ]);
    const [config, queueData, logData] = await Promise.all([
      safeJson(configRes), safeJson(queueRes), safeJson(logsRes)
    ]);
    if (!configRes.ok || !queueRes.ok || !logsRes.ok) {
      throw new Error(config.message || queueData.message || logData.message || 'Email control could not load');
    }

    const counts = queueData.counts || {};
    const pending = Number(counts.PENDING || 0) + Number(counts.RETRY || 0) + Number(counts.SENDING || 0);
    const failed = Number(counts.FAILED || 0);
    const status = document.getElementById('emailDeliveryStatus');
    if (status) {
      status.textContent = config.configured ? 'Connected' : 'Setup required';
      status.className = `email-state-chip ${config.configured ? 'email-state-connected' : 'email-state-warning'}`;
    }
    const sender = document.getElementById('emailSenderAddress');
    const transport = document.getElementById('emailTransportState');
    const pendingEl = document.getElementById('emailPendingCount');
    const failureEl = document.getElementById('emailFailureCount');
    const lastDelivery = document.getElementById('emailLastDelivery');
    if (sender) sender.textContent = config.from_address || 'info@voxelveda.com';
    if (transport) {
      transport.textContent = config.configured ? `${config.provider} : ${config.port}` : 'Not connected';
    }
    if (pendingEl) pendingEl.textContent = String(pending);
    if (failureEl) failureEl.textContent = `${failed} failed`;
    const logs = logData.logs || [];
    const lastSent = logs.find((row) => String(row.status).toUpperCase() === 'SENT');
    if (lastDelivery) lastDelivery.textContent = lastSent?.created_at ? formatDateTime(lastSent.created_at) : '-';

    const activity = logs.length ? logs : (queueData.emails || []).slice(0, 10);
    list.innerHTML = activity.length ? activity.map((row) => {
      const state = String(row.status || 'PENDING').toUpperCase();
      const queueId = Number(row.queue_id || row.id || 0);
      const retryButton = ['FAILED', 'RETRY'].includes(state) && queueId
        ? `<button type="button" class="secondary-btn compact-btn" onclick="retryEmailDelivery(${queueId})">Retry</button>`
        : '';
      return `
        <article class="email-delivery-row ${emailStatusClass(state)}">
          <div>
            <strong>${escapeHtml(row.subject || 'Email delivery')}</strong>
            <span>${escapeHtml(row.recipients || emailRecipientLabel(row.to_json))}</span>
          </div>
          <div class="email-delivery-meta">
            <span>${escapeHtml(state)}</span>
            <small>${escapeHtml(formatDateTime(row.created_at || row.sent_at || new Date()))}</small>
            ${retryButton}
          </div>
        </article>`;
    }).join('') : '<div class="empty-state">No email delivery activity yet.</div>';
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Email control could not load.')}</div>`;
  }
}

async function verifyEmailDelivery() {
  const res = await fetch('/api/email/verify', { method: 'POST', headers: authHeaders() });
  const data = await safeJson(res);
  showToast(data.message || (res.ok ? 'Email connection verified' : 'Email verification failed'));
  await loadEmailControl();
}

async function sendEmailTest() {
  const recipient = document.getElementById('emailTestRecipient')?.value.trim();
  if (!isValidEmail(recipient)) return showToast('Enter a valid test recipient');
  const res = await fetch('/api/email/test', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ to: recipient })
  });
  const data = await safeJson(res);
  showToast(data.message || (res.ok ? 'Test email sent' : 'Test email failed'));
  await loadEmailControl();
}

async function processPendingEmails() {
  const res = await fetch('/api/email/process', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ limit: 25 })
  });
  const data = await safeJson(res);
  const sent = (data.outcomes || []).filter((item) => item.status === 'SENT').length;
  showToast(res.ok ? `${sent} queued email${sent === 1 ? '' : 's'} delivered` : (data.message || 'Email queue processing failed'));
  await loadEmailControl();
}

async function retryEmailDelivery(queueId) {
  const retryRes = await fetch(`/api/email/queue/${Number(queueId)}/retry`, {
    method: 'POST',
    headers: authHeaders()
  });
  const retryData = await safeJson(retryRes);
  if (!retryRes.ok) return showToast(retryData.message || 'Email retry failed');
  await processPendingEmails();
}

function startShiftQrCountdown(seconds) {
  shiftQrSecondsLeft = Number(seconds || 20);
  const countdownEl = document.getElementById('shiftQrCountdown');
  if (countdownEl) countdownEl.innerText = `${shiftQrSecondsLeft}s`;

  clearInterval(shiftQrCountdownTimer);
  shiftQrCountdownTimer = setInterval(() => {
    shiftQrSecondsLeft -= 1;
    if (countdownEl) countdownEl.innerText = `${Math.max(0, shiftQrSecondsLeft)}s`;
    if (shiftQrSecondsLeft <= 0) clearInterval(shiftQrCountdownTimer);
  }, 1000);
}

async function loadShiftQr() {
  const image = document.getElementById('shiftQrImage');
  const tokenText = document.getElementById('shiftQrTokenText');
  if (!image) return;

  try {
    const res = await fetch('/api/attendance/shift-qr', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(res);

    if (!res.ok) {
      if (tokenText) tokenText.innerText = data.message || 'Unable to load shift QR.';
      return;
    }

    const qrData = data.qr_data || data.token;
    image.src = `/api/qr?data=${encodeURIComponent(qrData)}&v=${Date.now()}`;
    if (tokenText) tokenText.innerText = 'Live scan token active.';

    startShiftQrCountdown(data.expires_in_seconds || data.refresh_seconds || 20);
    clearTimeout(shiftQrTimer);
    shiftQrTimer = setTimeout(loadShiftQr, Number(data.refresh_seconds || 20) * 1000);
  } catch {
    if (tokenText) tokenText.innerText = 'Server error loading shift QR.';
  }
}

function openSystemPage(path) {
  toggleMobileMenu(false);
  closeNotificationPanel();
  const opened = window.open(path, '_blank', 'noopener');
  if (!opened) window.location.href = path;
}

function normalizeQrUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${window.location.origin}${url}`;
  return `https://${url}`;
}

function getRfqUrl() {
  return `${window.location.origin}/request-quote`;
}

function getPrivacyPolicyUrl() {
  return `${window.location.origin}/privacy`;
}

function updateQrTargetFromType() {
  const type = document.getElementById('qrTargetType')?.value || 'rfq';
  const input = document.getElementById('qrTargetUrl');
  if (!input) return;

  if (type === 'rfq') {
    input.value = getRfqUrl();
  } else if (type === 'privacy') {
    input.value = getPrivacyPolicyUrl();
  } else if (type === 'website') {
    input.value = normalizeQrUrl(document.getElementById('settingWebsite')?.value || 'www.voxelveda.com');
  }

  renderQrCode();
}

function renderQrCode() {
  const type = document.getElementById('qrTargetType')?.value || 'rfq';
  const target = normalizeQrUrl(document.getElementById('qrTargetUrl')?.value || getRfqUrl());
  const image = document.getElementById('qrPreviewImage');
  const download = document.getElementById('qrDownloadLink');
  const title = document.getElementById('qrPreviewTitle');
  const urlText = document.getElementById('qrPreviewUrl');

  if (!image || !download || !target) return;

  const label = type === 'website'
    ? 'Company Website'
    : type === 'privacy'
      ? 'Privacy Policy'
      : type === 'custom'
        ? 'Custom QR Link'
        : 'Customer RFQ Form';
  const qrSrc = `/api/qr?data=${encodeURIComponent(target)}&v=20260608-local-qr`;
  image.src = qrSrc;
  download.href = qrSrc;
  download.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-qr.png`;
  if (title) title.innerText = label;
  if (urlText) urlText.innerText = target;
}

function openQrTarget() {
  const target = normalizeQrUrl(document.getElementById('qrTargetUrl')?.value || getRfqUrl());
  if (target) window.open(target, '_blank', 'noopener');
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
    loadSuppliers(),
    loadExpenses(),
    loadCompetitors(),
    loadComplianceEntries(),
    loadStock(),
    loadStockUsage(),
    loadMaterials('raw_material'),
    loadMaterials('packaging'),
    loadMeetings(),
    loadRoster(),
    loadAttendance(),
    loadTimesheets(),
    loadAdminStaffMessages(),
    loadAdminWorkHubRequests(),
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
    invoices: '/api/invoice',
    competitors: '/api/competitors'
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
      : type === 'competitors'
        ? data.competitors || []
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

  const rows = chronologicalRows(data.materials || []);
  materialCache[type] = rows;
  updateMaterialMetrics(type, rows);
  renderNotificationDropdown();

  renderRegisterPage({
    key: type,
    tbody,
    rows,
    colspan: 8,
    emptyMessage: `No ${materialLabel(type).toLowerCase()} items yet.`,
    onChange: () => loadMaterials(type),
    rowRenderer: (item) => {
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
    }
  });
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
  const inputQty = Number(item.input_qty || 0);
  const currentQty = Number(item.current_qty ?? item.input_qty ?? 0);
  const unitPrice = Number(item.unit_price || 0);
  const reorderLevel = Number(item.reorder_level || 0);

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
          <div class="split-grid labelled-grid">
            <label class="form-field">
              <span>Opening / received quantity</span>
              <input id="materialInputQty" type="number" min="0" step="0.001" placeholder="Example: 500" value="${escapeHtml(inputQty)}" />
            </label>
            <label class="form-field">
              <span>Current quantity left</span>
              <input id="materialCurrentQty" type="number" min="0" step="0.001" placeholder="Example: 430" value="${escapeHtml(currentQty)}" />
            </label>
          </div>
          <div class="split-grid labelled-grid">
            <label class="form-field">
              <span>Unit type</span>
              <input id="materialUnitLabel" placeholder="kg, roll, pcs, sheet" value="${escapeHtml(item.unit_label || 'pcs')}" />
            </label>
            <label class="form-field">
              <span>Unit price</span>
              <input id="materialUnitPrice" type="number" min="0" step="0.01" placeholder="Price per unit" value="${escapeHtml(unitPrice)}" />
            </label>
          </div>
          <label class="form-field">
            <span>Reorder alert level</span>
            <input id="materialReorderLevel" type="number" min="0" step="0.001" placeholder="Minimum stock before reorder" value="${escapeHtml(reorderLevel)}" />
          </label>
          <div class="material-live-summary">
            <div>
              <span>Total worth left</span>
              <strong id="materialWorthPreview">${escapeHtml(formatMoney(currentQty * unitPrice))}</strong>
            </div>
            <div>
              <span>Used quantity</span>
              <strong id="materialUsedPreview">${escapeHtml(Math.max(inputQty - currentQty, 0).toFixed(3).replace(/\.?0+$/, ''))}</strong>
            </div>
            <div>
              <span>Stock status</span>
              <strong id="materialStatusPreview">${currentQty <= reorderLevel ? 'Reorder needed' : 'Healthy'}</strong>
            </div>
          </div>
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

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'material-dialog');
  setupMaterialWorthPreview();
}

function setupMaterialWorthPreview() {
  const ids = ['materialInputQty', 'materialCurrentQty', 'materialUnitPrice', 'materialReorderLevel'];
  const recalculate = () => {
    const inputQty = Number(document.getElementById('materialInputQty')?.value || 0);
    const currentQty = Number(document.getElementById('materialCurrentQty')?.value || 0);
    const unitPrice = Number(document.getElementById('materialUnitPrice')?.value || 0);
    const reorderLevel = Number(document.getElementById('materialReorderLevel')?.value || 0);
    const worthEl = document.getElementById('materialWorthPreview');
    const usedEl = document.getElementById('materialUsedPreview');
    const statusEl = document.getElementById('materialStatusPreview');

    if (worthEl) worthEl.innerText = formatMoney(currentQty * unitPrice);
    if (usedEl) usedEl.innerText = Math.max(inputQty - currentQty, 0).toFixed(3).replace(/\.?0+$/, '');
    if (statusEl) {
      statusEl.innerText = currentQty <= reorderLevel ? 'Reorder needed' : 'Healthy';
      statusEl.classList.toggle('danger-text', currentQty <= reorderLevel);
    }
  };

  ids.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', recalculate);
  });
  recalculate();
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
  window.open(`/api/materials/${id}/process-sheet.pdf`, '_blank');
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

  const rows = chronologicalRows(data.stock || []);
  stockCache = rows;

  renderRegisterPage({
    key: 'stock',
    tbody,
    rows,
    colspan: 9,
    emptyMessage: 'No stock items yet.',
    onChange: loadStock,
    rowRenderer: (item) => `
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
    `
  });
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

  const rows = chronologicalRows(data.movements || []);
  stockUsageCache = rows;

  renderRegisterPage({
    key: 'stockUsage',
    tbody,
    rows,
    colspan: 9,
    emptyMessage: 'No stock usage recorded yet.',
    onChange: loadStockUsage,
    rowRenderer: (item) => `
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
    `
  });
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
    tbody.innerHTML = `<tr><td colspan="6">Failed to load attendance</td></tr>`;
    return;
  }

  const rows = chronologicalRows(data.attendance || []);
  notifyAttendanceChanges(rows);
  attendanceCache = rows;

  renderRegisterPage({
    key: 'attendance',
    tbody,
    rows,
    colspan: 6,
    emptyMessage: 'No attendance records yet.',
    onChange: loadAttendance,
    rowRenderer: (a) => `
      <tr>
        <td>
          <strong>${escapeHtml(a.name || '-')}</strong>
          <span class="cell-subtext">${escapeHtml(a.email || '-')}</span>
        </td>
        <td>${escapeHtml(formatDate(a.work_date || a.clock_in))}</td>
        <td>
          <div class="time-pair">
            <span>In: ${escapeHtml(formatClockTime(a.clock_in))}</span>
            <span>Out: ${escapeHtml(formatClockTime(a.clock_out))}</span>
          </div>
        </td>
        <td><strong>${escapeHtml(Number(a.total_hours || 0).toFixed(2))}</strong></td>
        <td>${renderTimesheetNote(a.notes)}</td>
        <td>
          <div class="table-action-stack">
            <button class="small-btn" onclick="openAttendanceDialog(${a.id})">Edit</button>
            <button class="danger-btn" onclick="deleteAttendance(${a.id})">Delete</button>
          </div>
        </td>
      </tr>
    `
  });
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

function meetingStatusClass(status) {
  const clean = String(status || 'scheduled').toLowerCase();
  if (clean === 'cancelled') return 'badge danger-badge';
  if (clean === 'completed') return 'badge active-badge';
  return 'badge';
}

function meetingAttendeeNames(ids = []) {
  const selected = new Set((ids || []).map(Number));
  const names = staffCache
    .filter((user) => selected.has(Number(user.id)))
    .map((user) => user.name || user.email);
  return names.length ? names.join(', ') : '-';
}

function meetingAttendeeCheckboxes(selected = []) {
  const selectedIds = new Set((selected || []).map(Number));
  const users = staffCache.filter((user) => String(user.role || '').toLowerCase() !== 'admin');

  if (!users.length) return '<p class="muted-text">No staff users found yet.</p>';

  return users.map((user) => `
    <label class="access-check">
      <input type="checkbox" data-meeting-attendee value="${user.id}" ${selectedIds.has(Number(user.id)) ? 'checked' : ''}>
      <span>${escapeHtml(user.name || user.email)} (${escapeHtml(user.email || '-')})</span>
    </label>
  `).join('');
}

function collectMeetingAttendees() {
  return Array.from(document.querySelectorAll('[data-meeting-attendee]:checked'))
    .map((input) => Number(input.value))
    .filter(Boolean);
}

async function loadMeetings() {
  const tbody = document.getElementById('meetingTableBody');
  if (!tbody) return;

  const res = await fetch('/api/meetings', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(data.message || 'Failed to load meetings')}</td></tr>`;
    return;
  }

  const rows = chronologicalRows(data.meetings || []);
  meetingCache = rows;
  renderNotificationDropdown();

  renderRegisterPage({
    key: 'meetings',
    tbody,
    rows,
    colspan: 6,
    emptyMessage: 'No meetings or inspections scheduled yet.',
    onChange: loadMeetings,
    rowRenderer: (meeting) => `
      <tr>
        <td>
          <strong>${escapeHtml(meeting.title)}</strong>
          <span class="cell-subtext">${escapeHtml(meetingTypeLabel(meeting.meeting_type))}${meeting.organisation ? ` - ${escapeHtml(meeting.organisation)}` : ''}</span>
        </td>
        <td>
          <strong>${escapeHtml(formatDate(meeting.meeting_date))}</strong>
          <span class="cell-subtext">${escapeHtml(String(meeting.meeting_time || '').slice(0, 5))}</span>
        </td>
        <td>
          <strong>${escapeHtml(meeting.location_type || '-')}</strong>
          <span class="cell-subtext">${escapeHtml(meeting.location_details || '-')}</span>
        </td>
        <td>${escapeHtml(meetingAttendeeNames(meeting.assigned_user_ids))}</td>
        <td><span class="${meetingStatusClass(meeting.status)}">${escapeHtml(meeting.status || 'scheduled')}</span></td>
        <td>
          <div class="table-action-stack">
            <button class="small-btn" onclick="openMeetingDialog(${meeting.id})">Edit</button>
            <button class="danger-btn" onclick="deleteMeeting(${meeting.id})">Delete</button>
          </div>
        </td>
      </tr>
    `
  });
}

async function openMeetingDialog(id = null) {
  if (!staffCache.length) await loadStaff();
  const meeting = meetingCache.find((item) => Number(item.id) === Number(id)) || {};

  showDialog(
    id ? `Edit Meeting: ${meeting.title}` : 'Schedule Meeting / Inspection',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Meeting Details</h4>
          <input id="meetingTitle" placeholder="Meeting / inspection title" value="${escapeHtml(meeting.title || '')}" />
          <select id="meetingType">
            ${['internal', 'client', 'council', 'government', 'inspection', 'supplier', 'conference'].map((type) => `
              <option value="${type}" ${meeting.meeting_type === type ? 'selected' : ''}>${meetingTypeLabel(type)}</option>
            `).join('')}
          </select>
          <input id="meetingOrganisation" placeholder="Organisation / body / company" value="${escapeHtml(meeting.organisation || '')}" />
          <input id="meetingContactPerson" placeholder="Contact person / officer / inspector" value="${escapeHtml(meeting.contact_person || '')}" />
          <input id="meetingContactDetails" placeholder="Contact phone / email / reference" value="${escapeHtml(meeting.contact_details || '')}" />
        </div>
        <div class="dialog-card">
          <h4>When & Where</h4>
          <div class="split-grid">
            <input id="meetingDate" type="date" value="${escapeHtml(formatDate(meeting.meeting_date) === '-' ? todayISO() : formatDate(meeting.meeting_date))}" />
            <input id="meetingTime" type="time" value="${escapeHtml(String(meeting.meeting_time || '09:00').slice(0, 5))}" />
          </div>
          <select id="meetingLocationType">
            ${['site', 'office', 'client_site', 'council_office', 'government_office', 'online', 'conference'].map((type) => `
              <option value="${type}" ${meeting.location_type === type ? 'selected' : ''}>${type.replace(/_/g, ' ')}</option>
            `).join('')}
          </select>
          <textarea id="meetingLocationDetails" rows="3" placeholder="Address, room, online link, booth, conference hall">${escapeHtml(meeting.location_details || '')}</textarea>
          <select id="meetingStatus">
            ${['scheduled', 'confirmed', 'completed', 'cancelled'].map((status) => `
              <option value="${status}" ${meeting.status === status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
        </div>
        <div class="dialog-card">
          <h4>Agenda & Preparation</h4>
          <textarea id="meetingAgenda" rows="4" placeholder="Purpose, agenda, inspection scope, topics to discuss">${escapeHtml(meeting.agenda || '')}</textarea>
          <textarea id="meetingPreparation" rows="4" placeholder="Documents, samples, drawings, reports, compliance records to prepare">${escapeHtml(meeting.required_preparation || '')}</textarea>
        </div>
        <div class="dialog-card">
          <h4>Who Must Attend</h4>
          <p class="muted-text">Selected staff will see this in their portal and receive reminders from 3 days before the meeting.</p>
          <div class="access-grid">${meetingAttendeeCheckboxes(meeting.assigned_user_ids)}</div>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: meeting.id,
        title: document.getElementById('meetingTitle')?.value.trim(),
        meeting_type: document.getElementById('meetingType')?.value,
        organisation: document.getElementById('meetingOrganisation')?.value.trim(),
        contact_person: document.getElementById('meetingContactPerson')?.value.trim(),
        contact_details: document.getElementById('meetingContactDetails')?.value.trim(),
        location_type: document.getElementById('meetingLocationType')?.value,
        location_details: document.getElementById('meetingLocationDetails')?.value.trim(),
        meeting_date: document.getElementById('meetingDate')?.value,
        meeting_time: document.getElementById('meetingTime')?.value,
        agenda: document.getElementById('meetingAgenda')?.value.trim(),
        required_preparation: document.getElementById('meetingPreparation')?.value.trim(),
        assigned_user_ids: collectMeetingAttendees(),
        status: document.getElementById('meetingStatus')?.value
      };

      const saveRes = await fetch('/api/meetings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const saveData = await safeJson(saveRes);

      if (!saveRes.ok) {
        showToast(saveData.message || 'Meeting save failed');
        return;
      }

      hideDialog();
      showToast(saveData.message || 'Meeting saved');
      await loadMeetings();
    },
    id ? 'Update Meeting' : 'Schedule Meeting'
  );

  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

async function deleteMeeting(id) {
  if (!confirm('Delete this meeting / inspection?')) return;

  const res = await fetch('/api/meetings/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Meeting delete failed');
    return;
  }

  showToast(data.message || 'Meeting removed');
  await loadMeetings();
}

function rosterShiftHours(shift) {
  const start = String(shift.start_time || '00:00').slice(0, 5);
  const end = String(shift.end_time || '00:00').slice(0, 5);
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = ((eh * 60) + em) - ((sh * 60) + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

function updateRosterMetrics(rows) {
  const today = todayISO();
  const upcoming = rows.filter((row) => String(row.shift_date || '') >= today);
  const staffIds = new Set(rows.map((row) => Number(row.user_id)).filter(Boolean));
  setText('rosterUpcomingCount', upcoming.length);
  setText('rosterHoursCount', rows.reduce((sum, row) => sum + rosterShiftHours(row), 0).toFixed(2));
  setText('rosterStaffCount', staffIds.size);
}

function setRosterLastWeek() {
  document.getElementById('rosterFromDate').value = todayISO(-7);
  document.getElementById('rosterToDate').value = todayISO(-1);
}

function selectedRosterStaffIds() {
  return Array.from(document.getElementById('rosterStaffSelect')?.selectedOptions || [])
    .map((option) => Number(option.value))
    .filter(Boolean);
}

async function loadRoster() {
  const tbody = document.getElementById('rosterTableBody');
  if (!tbody) return;

  if (!staffCache.length) await loadStaff();

  const res = await fetch('/api/roster', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await safeJson(res);

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(data.message || 'Failed to load roster')}</td></tr>`;
    return;
  }

  const rows = chronologicalRows(data.roster || []);
  rosterCache = rows;
  updateRosterMetrics(rows);

  renderRegisterPage({
    key: 'roster',
    tbody,
    rows,
    colspan: 7,
    emptyMessage: 'No roster shifts yet.',
    onChange: loadRoster,
    rowRenderer: (shift) => `
      <tr>
        <td>
          <strong>${escapeHtml(shift.staff_name || '-')}</strong>
          <span class="cell-subtext">${escapeHtml(shift.staff_email || '-')}</span>
        </td>
        <td>${escapeHtml(formatDate(shift.shift_date))}</td>
        <td>
          <strong>${escapeHtml(String(shift.start_time || '').slice(0, 5))} - ${escapeHtml(String(shift.end_time || '').slice(0, 5))}</strong>
          <span class="cell-subtext">${escapeHtml(rosterShiftHours(shift).toFixed(2))} planned hours</span>
        </td>
        <td>
          <strong>${escapeHtml(shift.role_label || '-')}</strong>
          <span class="cell-subtext">${escapeHtml(shift.location || '-')}</span>
          <span class="cell-subtext">${escapeHtml(shift.notes || '')}</span>
        </td>
        <td>${statusBadge(shift.status || 'scheduled')}</td>
        <td>
          <span class="cell-subtext">Created: ${escapeHtml(shift.created_by_name || '-')}</span>
          <span class="cell-subtext">Updated: ${escapeHtml(shift.updated_by_name || '-')}</span>
        </td>
        <td>
          <div class="table-action-stack">
            <button class="small-btn" onclick="openRosterShiftDialog(${shift.id})">Edit</button>
            <button class="danger-btn" onclick="deleteRosterShift(${shift.id})">Delete</button>
          </div>
        </td>
      </tr>
    `
  });
}

async function generateRoster() {
  const body = {
    user_ids: selectedRosterStaffIds(),
    from_date: document.getElementById('rosterFromDate')?.value,
    to_date: document.getElementById('rosterToDate')?.value,
    start_time: document.getElementById('rosterStartTime')?.value,
    end_time: document.getElementById('rosterEndTime')?.value,
    role_label: document.getElementById('rosterRoleLabel')?.value.trim(),
    location: document.getElementById('rosterLocation')?.value.trim(),
    notes: document.getElementById('rosterNotes')?.value.trim()
  };

  const res = await fetch('/api/roster/generate', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Roster generation failed');
    return;
  }

  showToast(data.message || 'Roster generated');
  await loadRoster();
}

function openRosterShiftDialog(id = null) {
  const shift = rosterCache.find((row) => Number(row.id) === Number(id)) || {};
  const staffOptions = staffCache
    .filter((user) => String(user.role || '').toLowerCase() !== 'admin')
    .map((user) => `
      <option value="${user.id}" ${Number(shift.user_id) === Number(user.id) ? 'selected' : ''}>
        ${escapeHtml(user.name || user.email)} (${escapeHtml(user.email || '-')})
      </option>
    `).join('');

  showDialog(
    id ? 'Edit Roster Shift' : 'Add Roster Shift',
    `
      <div class="stock-dialog-grid">
        <div class="dialog-card">
          <h4>Shift Assignment</h4>
          <select id="singleRosterUser">${staffOptions}</select>
          <div class="split-grid">
            <input id="singleRosterDate" type="date" value="${escapeHtml(formatDate(shift.shift_date) === '-' ? todayISO() : formatDate(shift.shift_date))}" />
            <input id="singleRosterRole" placeholder="Role / station" value="${escapeHtml(shift.role_label || 'Production')}" />
          </div>
          <div class="split-grid">
            <input id="singleRosterStart" type="time" value="${escapeHtml(String(shift.start_time || '08:00').slice(0, 5))}" />
            <input id="singleRosterEnd" type="time" value="${escapeHtml(String(shift.end_time || '16:00').slice(0, 5))}" />
          </div>
        </div>
        <div class="dialog-card">
          <h4>Operational Context</h4>
          <input id="singleRosterLocation" placeholder="Workshop / client site / machine area" value="${escapeHtml(shift.location || 'Voxel Veda Workshop')}" />
          <select id="singleRosterStatus">
            ${['scheduled', 'confirmed', 'completed', 'cancelled'].map((status) => `
              <option value="${status}" ${String(shift.status || 'scheduled') === status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
          <textarea id="singleRosterNotes" rows="3" placeholder="Job number, machine, safety note or handover">${escapeHtml(shift.notes || '')}</textarea>
        </div>
      </div>
    `,
    async () => {
      const body = {
        id: shift.id,
        user_id: Number(document.getElementById('singleRosterUser')?.value),
        shift_date: document.getElementById('singleRosterDate')?.value,
        start_time: document.getElementById('singleRosterStart')?.value,
        end_time: document.getElementById('singleRosterEnd')?.value,
        role_label: document.getElementById('singleRosterRole')?.value.trim(),
        location: document.getElementById('singleRosterLocation')?.value.trim(),
        status: document.getElementById('singleRosterStatus')?.value,
        notes: document.getElementById('singleRosterNotes')?.value.trim()
      };

      const res = await fetch('/api/roster', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);

      if (!res.ok) {
        showToast(data.message || 'Roster save failed');
        return;
      }

      hideDialog();
      showToast(data.message || 'Roster shift saved');
      await loadRoster();
    },
    id ? 'Update Shift' : 'Save Shift'
  );
}

async function deleteRosterShift(id) {
  if (!confirm('Delete this roster shift?')) return;

  const res = await fetch('/api/roster/delete', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ id })
  });
  const data = await safeJson(res);

  if (!res.ok) {
    showToast(data.message || 'Roster delete failed');
    return;
  }

  showToast(data.message || 'Roster shift deleted');
  await loadRoster();
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

  renderRegisterPage({
    key: 'timesheets',
    tbody,
    rows: data.timesheets || [],
    colspan: 5,
    emptyMessage: 'No weekly timesheets yet.',
    onChange: loadTimesheets,
    rowRenderer: (t) => `
      <tr>
        <td>${escapeHtml(t.name || '-')}</td>
        <td>${escapeHtml(String(t.week_start || '').slice(0, 10))}</td>
        <td>${escapeHtml(String(t.week_end || '').slice(0, 10))}</td>
        <td>${escapeHtml(Number(t.total_hours || 0).toFixed(2))}</td>
        <td>${escapeHtml(t.status || 'open')}</td>
      </tr>
    `
  });
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
    installAccessDeniedHandler();
    installMobileShellControls();
    normalizeActionButtons();
    setupNavigation();
    openAdminViewFromUrl();
    startResponsiveTableObserver();

    const user = await loadMe();
    if (!user || redirectingToLogin) return;

    if (currentRole !== 'admin' && hasCurrentPermission('tasks')) {
      await Promise.all([
        loadStaff(),
        loadTasks(),
        loadAnnouncements()
      ]);
      return;
    }

    await Promise.all([
      loadDashboardStats(),
      loadRFQs(),
      loadInvoices(),
      loadTasks(),
      loadAnnouncements(),
      loadStaff(),
      loadCustomers(),
      loadSuppliers(),
      loadExpenses(),
      loadCompetitors(),
      loadComplianceEntries(),
      loadStock(),
      loadStockUsage(),
      loadMaterials('raw_material'),
      loadMaterials('packaging'),
      loadMeetings(),
      loadRoster(),
      loadAttendance(),
      loadTimesheets(),
    loadAdminStaffMessages(),
    loadAdminWorkHubRequests(),
    loadSettings()
    ]);

    await loadAccessAttempts();
    renderNotificationDropdown();
    setInterval(loadAttendance, 15000);
    setInterval(loadAccessAttempts, 20000);
  } catch (err) {
    if (!redirectingToLogin) {
      console.error('ADMIN DASHBOARD STARTUP ERROR:', err);
      showToast('Dashboard could not load. Please refresh or login again.');
    }
  }
}

document.addEventListener('DOMContentLoaded', bootAdminDashboard);


/* ================= WORKFORCE OPS SUITE 20260703 ================= */
window.vvTimesheetCache = window.vvTimesheetCache || [];
let activeTimesheetTab = 'PENDING_APPROVAL';
function rosterNetHours(shift) { return Math.max(0, rosterShiftHours(shift) - (Number(shift.break_minutes || 0) / 60)); }
function rosterShiftCost(shift) { return rosterNetHours(shift) * Number(shift.hourly_rate || 0); }
function rosterWeekKey(value) { var date = new Date(value || todayISO()); if (Number.isNaN(date.getTime())) return 'Unscheduled'; var day = date.getDay(); date.setDate(date.getDate() - day + (day === 0 ? -6 : 1)); return date.toISOString().slice(0, 10); }
function updateWorkforceDashboardMetrics() {
  const timesheets = window.vvTimesheetCache || [];
  const active = attendanceCache.filter((row) => row.clock_in && !row.clock_out).length;
  const pendingStatuses = new Set(['PENDING_APPROVAL', 'CORRECTION_RESUBMITTED']);
  const pending = timesheets.filter((row) => pendingStatuses.has(String(row.status || '').toUpperCase())).length;
  const payrollReady = timesheets.filter((row) => String(row.payroll_status || '').toUpperCase() === 'READY').length;
  const overtime = timesheets.filter((row) => Number(row.overtime_hours || 0) > 0).length;
  setText('clockedInCount', active);
  setText('pendingTimesheetCount', pending);
  setText('payrollReadyCount', payrollReady);
  setText('overtimeWarningCount', overtime);
}
function renderRosterIntelligence(rows, summary) { summary = summary || {}; var alerts = document.getElementById('rosterComplianceAlerts'); var calendar = document.getElementById('rosterCalendarCards'); if (alerts) { var published = rows.filter(function(row) { return String(row.status || '').toLowerCase() === 'published'; }).length; var warnings = [{ label: 'Cost Signal', value: summary.budget && summary.cost > summary.budget ? 'Budget risk' : 'Controlled', tone: summary.budget && summary.cost > summary.budget ? 'danger' : 'ok' }, { label: 'Overtime', value: String(summary.overtime || 0) + ' shifts', tone: summary.overtime ? 'warn' : 'ok' }, { label: 'Published', value: published + '/' + (rows.length || 0), tone: published === rows.length && rows.length ? 'ok' : 'warn' }, { label: 'Payroll Sync', value: 'Integration setup required', tone: 'info' }]; alerts.innerHTML = warnings.map(function(item) { return '<div class="roster-signal-card ' + item.tone + '"><span>' + escapeHtml(item.label) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>'; }).join(''); } if (calendar) { var weeks = new Map(); rows.forEach(function(row) { var key = rosterWeekKey(row.shift_date); var item = weeks.get(key) || { hours: 0, cost: 0, shifts: 0 }; item.hours += rosterNetHours(row); item.cost += rosterShiftCost(row); item.shifts += 1; weeks.set(key, item); }); var cards = Array.from(weeks.entries()).slice(-6).map(function(pair) { return '<div class="roster-week-card"><span>Week ' + escapeHtml(pair[0]) + '</span><strong>' + pair[1].shifts + ' shifts</strong><small>' + pair[1].hours.toFixed(2) + ' hrs | ' + formatMoney(pair[1].cost) + '</small></div>'; }).join(''); calendar.innerHTML = cards || '<div class="empty-state compact">No roster weeks yet.</div>'; } }
function updateRosterMetrics(rows) { var today = todayISO(); var upcoming = rows.filter(function(row) { return String(row.shift_date || '') >= today; }); var staffIds = new Set(rows.map(function(row) { return Number(row.user_id); }).filter(Boolean)); var netHours = rows.reduce(function(sum, row) { return sum + rosterNetHours(row); }, 0); var cost = rows.reduce(function(sum, row) { return sum + rosterShiftCost(row); }, 0); var budget = rows.reduce(function(max, row) { return Math.max(max, Number(row.wage_budget || 0)); }, 0); var overtime = rows.filter(function(row) { return rosterNetHours(row) > 10; }).length; setText('rosterUpcomingCount', upcoming.length); setText('rosterHoursCount', netHours.toFixed(2)); setText('rosterStaffCount', staffIds.size); setText('rosterCostCount', formatMoney(cost)); setText('rosterBudgetStatus', budget && cost > budget ? 'Over budget' : (budget ? 'On track' : 'No budget')); setText('overtimeWarningCount', overtime); renderRosterIntelligence(rows, { cost: cost, budget: budget, overtime: overtime, upcoming: upcoming.length }); updateWorkforceDashboardMetrics(); }
function populateTimesheetSendStaffSelect() { var select = document.getElementById('timesheetSendStaffSelect'); if (!select) return; select.innerHTML = '<option value="">All staff</option>' + staffCache.filter(function(user) { return String(user.role || '').toLowerCase() !== 'admin'; }).map(function(user) { return '<option value="' + user.id + '">' + escapeHtml(user.name || user.email) + ' (' + escapeHtml(user.email || '-') + ')</option>'; }).join(''); var from = document.getElementById('timesheetSendFrom'); var to = document.getElementById('timesheetSendTo'); if (from && !from.value) from.value = todayISO(-7); if (to && !to.value) to.value = todayISO(); }
async function generateRoster() { var body = { user_ids: selectedRosterStaffIds(), from_date: document.getElementById('rosterFromDate')?.value, to_date: document.getElementById('rosterToDate')?.value, start_time: document.getElementById('rosterStartTime')?.value, end_time: document.getElementById('rosterEndTime')?.value, role_label: document.getElementById('rosterRoleLabel')?.value.trim(), location: document.getElementById('rosterLocation')?.value.trim(), notes: document.getElementById('rosterNotes')?.value.trim(), break_minutes: Number(document.getElementById('rosterBreakMinutes')?.value || 0), hourly_rate: Number(document.getElementById('rosterHourlyRate')?.value || 0), wage_budget: Number(document.getElementById('rosterWeeklyBudget')?.value || 0) }; var res = await fetch('/api/roster/generate', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }); var data = await safeJson(res); if (!res.ok) { showToast(data.message || 'Roster generation failed'); return; } showToast(data.message || 'Roster generated'); await loadRoster(); }
async function publishRoster() { var fromDate = document.getElementById('rosterFromDate')?.value || todayISO(); var toDate = document.getElementById('rosterToDate')?.value || fromDate; var res = await fetch('/api/roster/publish', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ from_date: fromDate, to_date: toDate }) }); var data = await safeJson(res); if (!res.ok) { showToast(data.message || 'Roster publish failed'); return; } showToast(String(data.published || 0) + ' roster shifts published' + (data.email_status === 'setup_required' ? ' - email setup required' : '')); await loadRoster(); }
function exportRosterCsv() { var rows = rosterCache.map(function(shift) { return { staff: shift.staff_name || '', email: shift.staff_email || '', date: formatDate(shift.shift_date), start: String(shift.start_time || '').slice(0, 5), end: String(shift.end_time || '').slice(0, 5), break_minutes: Number(shift.break_minutes || 0), net_hours: rosterNetHours(shift).toFixed(2), hourly_rate: Number(shift.hourly_rate || 0).toFixed(2), estimated_cost: rosterShiftCost(shift).toFixed(2), role: shift.role_label || '', location: shift.location || '', status: shift.status || '' }; }); if (!rows.length) { showToast('No roster data to export'); return; } saveCsv('voxel-veda-roster-' + todayISO() + '.csv', rows); }
function exportRosterPrint() { var rows = rosterCache.map(function(shift) { return '<tr><td>' + escapeHtml(shift.staff_name || '-') + '</td><td>' + escapeHtml(formatDate(shift.shift_date)) + '</td><td>' + escapeHtml(String(shift.start_time || '').slice(0,5)) + ' - ' + escapeHtml(String(shift.end_time || '').slice(0,5)) + '</td><td>' + rosterNetHours(shift).toFixed(2) + '</td><td>' + formatMoney(rosterShiftCost(shift)) + '</td><td>' + escapeHtml(shift.role_label || '-') + '</td><td>' + escapeHtml(shift.status || '-') + '</td></tr>'; }).join('') || '<tr><td colspan="7">No roster shifts available.</td></tr>'; var win = window.open('', '_blank'); if (!win) { showToast('Allow popup to preview roster'); return; } win.document.write('<!doctype html><html><head><title>Voxel Veda Roster</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse}th{background:#061525;color:#fff}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left}</style></head><body><h1>Voxel Veda Roster</h1><p>Generated ' + new Date().toLocaleString() + '</p><table><thead><tr><th>Staff</th><th>Date</th><th>Shift</th><th>Net Hours</th><th>Cost</th><th>Role</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>'); win.document.close(); win.focus(); }
function filteredTimesheetAttendanceRows() { var userId = Number(document.getElementById('timesheetSendStaffSelect')?.value || 0); var fromDate = document.getElementById('timesheetSendFrom')?.value || '0000-01-01'; var toDate = document.getElementById('timesheetSendTo')?.value || '9999-12-31'; return attendanceCache.filter(function(row) { var workDate = String(row.work_date || row.clock_in || '').slice(0, 10); return (!userId || Number(row.user_id) === userId) && workDate >= fromDate && workDate <= toDate; }); }
function exportTimesheetCsv() { var rows = filteredTimesheetAttendanceRows().map(function(row) { return { staff: row.name || '', email: row.email || '', date: formatDate(row.work_date || row.clock_in), clock_in: row.clock_in || '', clock_out: row.clock_out || '', total_hours: Number(row.total_hours || 0).toFixed(2), notes: row.notes || '' }; }); if (!rows.length) { showToast('No timesheet data to export'); return; } saveCsv('voxel-veda-timesheet-' + todayISO() + '.csv', rows); }
function exportTimesheetHtml() { var rows = filteredTimesheetAttendanceRows(); var total = rows.reduce(function(sum, row) { return sum + Number(row.total_hours || 0); }, 0); var tableRows = rows.map(function(row) { return '<tr><td>' + escapeHtml(row.name || '-') + '</td><td>' + escapeHtml(formatDate(row.work_date || row.clock_in)) + '</td><td>' + escapeHtml(formatClockTime(row.clock_in)) + '</td><td>' + escapeHtml(formatClockTime(row.clock_out)) + '</td><td>' + Number(row.total_hours || 0).toFixed(2) + '</td><td>' + escapeHtml(row.notes || '-') + '</td></tr>'; }).join('') || '<tr><td colspan="6">No records for this period.</td></tr>'; var win = window.open('', '_blank'); if (!win) { showToast('Allow popup to preview timesheet'); return; } win.document.write('<!doctype html><html><head><title>Voxel Veda Timesheet</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse}th{background:#061525;color:#fff}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left}</style></head><body><h1>Voxel Veda Timesheet Summary</h1><p>Total hours: <strong>' + total.toFixed(2) + '</strong></p><table><thead><tr><th>Staff</th><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Notes</th></tr></thead><tbody>' + tableRows + '</tbody></table></body></html>'); win.document.close(); }
async function sendTimesheetEmail() { var body = { user_id: Number(document.getElementById('timesheetSendStaffSelect')?.value || 0) || null, from_date: document.getElementById('timesheetSendFrom')?.value || todayISO(-7), to_date: document.getElementById('timesheetSendTo')?.value || todayISO(), recipient: document.getElementById('timesheetSendRecipient')?.value.trim(), include_employee: true }; var log = document.getElementById('timesheetEmailLogBody'); if (log) log.textContent = 'Sending timesheet summary...'; var res = await fetch('/api/attendance/timesheets/send', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }); var data = await safeJson(res); if (!res.ok) { var msg = data.missing ? data.message + ': ' + data.missing.join(', ') : (data.message || 'Timesheet email failed'); if (log) log.textContent = msg; showToast(msg); return; } if (log) log.textContent = data.message + '. Records: ' + data.records + ', hours: ' + data.total_hours; showToast(data.message || 'Timesheet sent'); }
async function loadTimesheets() { var tbody = document.getElementById('timesheetAdminBody'); if (!tbody) return; populateTimesheetSendStaffSelect(); var res = await fetch('/api/attendance/timesheets', { headers: { Authorization: 'Bearer ' + token } }); var data = await safeJson(res); if (!res.ok) { tbody.innerHTML = '<tr><td colspan="5">Failed to load timesheets</td></tr>'; return; } window.vvTimesheetCache = data.timesheets || []; updateWorkforceDashboardMetrics(); renderRegisterPage({ key: 'timesheets', tbody: tbody, rows: window.vvTimesheetCache, colspan: 5, emptyMessage: 'No weekly timesheets yet.', onChange: loadTimesheets, rowRenderer: function(t) { return '<tr><td>' + escapeHtml(t.name || '-') + '</td><td>' + escapeHtml(String(t.week_start || '').slice(0, 10)) + '</td><td>' + escapeHtml(String(t.week_end || '').slice(0, 10)) + '</td><td>' + escapeHtml(Number(t.total_hours || 0).toFixed(2)) + '</td><td>' + escapeHtml(t.status || 'open') + '</td></tr>'; } }); }


/* ================= ROSTER SHIFT DIALOG OVERRIDE 20260703 ================= */
function openRosterShiftDialog(id) {
  id = id || null;
  var shift = rosterCache.find(function(row) { return Number(row.id) === Number(id); }) || {};
  var staffOptions = staffCache.filter(function(user) { return String(user.role || '').toLowerCase() !== 'admin'; }).map(function(user) {
    return '<option value="' + user.id + '" ' + (Number(shift.user_id) === Number(user.id) ? 'selected' : '') + '>' + escapeHtml(user.name || user.email) + ' (' + escapeHtml(user.email || '-') + ')</option>';
  }).join('');
  var html = '<div class="stock-dialog-grid">' +
    '<div class="dialog-card"><h4>Shift Assignment</h4><select id="singleRosterUser">' + staffOptions + '</select>' +
    '<div class="split-grid"><input id="singleRosterDate" type="date" value="' + escapeHtml(formatDate(shift.shift_date) === '-' ? todayISO() : formatDate(shift.shift_date)) + '" /><input id="singleRosterRole" placeholder="Role / station" value="' + escapeHtml(shift.role_label || 'Production') + '" /></div>' +
    '<div class="split-grid"><input id="singleRosterStart" type="time" value="' + escapeHtml(String(shift.start_time || '08:00').slice(0, 5)) + '" /><input id="singleRosterEnd" type="time" value="' + escapeHtml(String(shift.end_time || '16:00').slice(0, 5)) + '" /></div>' +
    '<div class="split-grid"><input id="singleRosterBreak" type="number" min="0" placeholder="Break minutes" value="' + escapeHtml(String(shift.break_minutes || 30)) + '" /><input id="singleRosterRate" type="number" min="0" step="0.01" placeholder="Hourly rate" value="' + escapeHtml(String(shift.hourly_rate || 32)) + '" /></div>' +
    '<input id="singleRosterBudget" type="number" min="0" step="0.01" placeholder="Weekly wage budget" value="' + escapeHtml(String(shift.wage_budget || 0)) + '" /></div>' +
    '<div class="dialog-card"><h4>Operational Context</h4><input id="singleRosterLocation" placeholder="Workshop / client site / machine area" value="' + escapeHtml(shift.location || 'Voxel Veda Workshop') + '" />' +
    '<select id="singleRosterStatus">' + ['scheduled', 'published', 'confirmed', 'completed', 'cancelled'].map(function(status) { return '<option value="' + status + '" ' + (String(shift.status || 'scheduled') === status ? 'selected' : '') + '>' + status + '</option>'; }).join('') + '</select>' +
    '<textarea id="singleRosterNotes" rows="3" placeholder="Job number, machine, safety note or handover">' + escapeHtml(shift.notes || '') + '</textarea></div></div>';
  showDialog(id ? 'Edit Roster Shift' : 'Add Roster Shift', html, async function() {
    var body = { id: shift.id, user_id: Number(document.getElementById('singleRosterUser')?.value), shift_date: document.getElementById('singleRosterDate')?.value, start_time: document.getElementById('singleRosterStart')?.value, end_time: document.getElementById('singleRosterEnd')?.value, role_label: document.getElementById('singleRosterRole')?.value.trim(), location: document.getElementById('singleRosterLocation')?.value.trim(), status: document.getElementById('singleRosterStatus')?.value, notes: document.getElementById('singleRosterNotes')?.value.trim(), break_minutes: Number(document.getElementById('singleRosterBreak')?.value || 0), hourly_rate: Number(document.getElementById('singleRosterRate')?.value || 0), wage_budget: Number(document.getElementById('singleRosterBudget')?.value || 0) };
    var res = await fetch('/api/roster', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    var data = await safeJson(res);
    if (!res.ok) { showToast(data.message || 'Roster save failed'); return; }
    hideDialog(); showToast(data.message || 'Roster shift saved'); await loadRoster();
  }, id ? 'Update Shift' : 'Save Shift');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

function openSmartRosterDialog() {
  var availableStaff = staffCache.filter(function(user) { return String(user.role || '').toLowerCase() !== 'admin'; });
  var html = '<div class="stock-dialog-grid">' +
    '<div class="dialog-card"><h4>Roster Rules</h4>' +
    '<input id="smartRosterLocation" placeholder="Workshop / site" value="' + escapeHtml(document.getElementById('rosterLocation')?.value || 'Voxel Veda Workshop') + '" />' +
    '<input id="smartRosterRole" placeholder="Role / station" value="Production" />' +
    '<div class="split-grid"><input id="smartRosterMaxHours" type="number" min="1" value="38" placeholder="Max weekly hours" />' +
    '<input id="smartRosterBudget" type="number" min="0" step="0.01" value="' + escapeHtml(document.getElementById('rosterWeeklyBudget')?.value || '') + '" placeholder="Wage budget" /></div></div>' +
    '<div class="dialog-card"><h4>Readiness Check</h4>' +
    '<p class="status-note">' + availableStaff.length + ' staff available. This prepares safe defaults and flags overtime or budget risk before publishing.</p>' +
    '<p class="status-note">Payroll integrations such as Xero, MYOB and QuickBooks require setup before direct sync.</p></div></div>';
  showDialog('Smart Roster Builder', html, async function() {
    document.getElementById('rosterLocation').value = document.getElementById('smartRosterLocation')?.value || 'Voxel Veda Workshop';
    document.getElementById('rosterRoleLabel').value = document.getElementById('smartRosterRole')?.value || 'Production';
    document.getElementById('rosterHourlyRate').value = '32';
    document.getElementById('rosterWeeklyBudget').value = document.getElementById('smartRosterBudget')?.value || '';
    hideDialog();
    showToast('Smart roster draft prepared. Review dates and staff, then generate.');
  }, 'Prepare Draft');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}
/* ================= EMAIL FALLBACK OVERRIDE 20260703 ================= */
let lastTimesheetEmailDraft = null;

function buildTimesheetEmailDraft(rows, fromDate, toDate) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const total = cleanRows.reduce((sum, row) => sum + Number(row.total_hours || 0), 0);
  const staffNames = [...new Set(cleanRows.map((row) => row.name || row.email || 'Staff'))].join(', ') || 'All staff';
  const rowHtml = cleanRows.length ? cleanRows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.name || '-')}</td>
      <td>${escapeHtml(formatDate(row.work_date || row.clock_in))}</td>
      <td>${escapeHtml(formatClockTime(row.clock_in))}</td>
      <td>${escapeHtml(formatClockTime(row.clock_out))}</td>
      <td>${Number(row.total_hours || 0).toFixed(2)}</td>
      <td>${escapeHtml(row.notes || '-')}</td>
    </tr>
  `).join('') : '<tr><td colspan="7">No timesheet records found for this selected period.</td></tr>';
  const textLines = [
    'Voxel Veda Timesheet Summary',
    `Period: ${fromDate} to ${toDate}`,
    `Staff: ${staffNames}`,
    `Total hours: ${total.toFixed(2)}`,
    '',
    'Records:'
  ];
  cleanRows.forEach((row, index) => {
    textLines.push(`${index + 1}. ${row.name || '-'} | ${formatDate(row.work_date || row.clock_in)} | ${formatClockTime(row.clock_in)} - ${formatClockTime(row.clock_out)} | ${Number(row.total_hours || 0).toFixed(2)} hrs | ${row.notes || '-'}`);
  });
  if (!cleanRows.length) textLines.push('No records for this selected period.');

  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Voxel Veda Timesheet ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</title>
      <style>
        body{margin:0;background:#eef5f9;color:#0b1725;font-family:Arial,Helvetica,sans-serif}
        .sheet{max-width:1120px;margin:24px auto;background:#fff;border:1px solid #d7e3ec;border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,.16)}
        .hero{background:linear-gradient(135deg,#061324,#0c3148 58%,#11cdd4);color:#fff;padding:30px 34px;display:flex;justify-content:space-between;gap:20px;align-items:center}
        .brand{font-size:24px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.muted{color:#bcd6e6}.pill{display:inline-flex;border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:8px 12px;color:#dffbff;font-weight:800}
        .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:22px 34px;background:#f8fbfd}.card{border:1px solid #dce8f0;border-radius:14px;padding:14px}.label{font-size:11px;text-transform:uppercase;color:#5e7182;font-weight:800;letter-spacing:.08em}.value{font-size:21px;font-weight:900;margin-top:5px}
        .content{padding:26px 34px}.section-title{font-size:18px;font-weight:900;margin-bottom:12px}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#071827;color:#dffbff;text-align:left;padding:12px;border-bottom:1px solid #1a3950}td{padding:11px;border-bottom:1px solid #e4edf3;vertical-align:top}tr:nth-child(even) td{background:#f9fcfe}.footer{display:flex;justify-content:space-between;gap:16px;padding:20px 34px 30px;color:#637588;font-size:12px}.stamp{font-weight:900;color:#0b1725}
        @media(max-width:720px){.sheet{margin:0;border-radius:0}.hero,.footer{display:block}.summary{grid-template-columns:1fr}.content{padding:18px;overflow-x:auto}.hero,.summary,.footer{padding-left:18px;padding-right:18px}table{min-width:760px}}
        @media print{body{background:#fff}.sheet{box-shadow:none;margin:0;border-radius:0;border:0}.no-print{display:none!important}}
      </style>
    </head>
    <body>
      <main class="sheet">
        <section class="hero">
          <div><div class="brand">Voxel Veda</div><div class="muted">Workforce Timesheet Summary</div></div>
          <div class="pill">${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</div>
        </section>
        <section class="summary">
          <div class="card"><div class="label">Staff</div><div class="value">${escapeHtml(staffNames)}</div></div>
          <div class="card"><div class="label">Total Hours</div><div class="value">${total.toFixed(2)}</div></div>
          <div class="card"><div class="label">Records</div><div class="value">${cleanRows.length}</div></div>
        </section>
        <section class="content">
          <div class="section-title">Attendance Records</div>
          <table><thead><tr><th>#</th><th>Staff</th><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Notes</th></tr></thead><tbody>${rowHtml}</tbody></table>
        </section>
        <section class="footer"><div>Generated by Voxel Veda operations system.</div><div class="stamp">Voxel Veda Pty Ltd</div></section>
      </main>
    </body>
    </html>
  `;
  return { subject: `Voxel Veda Timesheet ${fromDate} to ${toDate}`, body: textLines.join('\n'), html };
}

function openEmailDraft(to, subject, body) {
  const href = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
}

function openTimesheetPreviewWindow() {
  if (!lastTimesheetEmailDraft?.html) return showToast('No timesheet preview ready');
  const win = window.open('', '_blank');
  if (!win) return showToast('Popup blocked. Allow popups to preview the timesheet.');
  win.document.open();
  win.document.write(lastTimesheetEmailDraft.html);
  win.document.close();
}

function printTimesheetPreview() {
  if (!lastTimesheetEmailDraft?.html) return showToast('No timesheet preview ready');
  const win = window.open('', '_blank');
  if (!win) return showToast('Popup blocked. Allow popups to print/save PDF.');
  win.document.open();
  win.document.write(lastTimesheetEmailDraft.html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}

async function copyTimesheetDraft() {
  if (!lastTimesheetEmailDraft?.body) return showToast('No timesheet draft ready');
  await navigator.clipboard?.writeText(lastTimesheetEmailDraft.body);
  showToast('Timesheet summary copied');
}

function openTimesheetMailDraft() {
  if (!lastTimesheetEmailDraft) return showToast('No timesheet draft ready');
  openEmailDraft(lastTimesheetEmailDraft.recipient || '', lastTimesheetEmailDraft.subject, lastTimesheetEmailDraft.body);
}

function showTimesheetEmailSetupDialog(data, draft) {
  const missingKeys = Array.isArray(data?.missing) ? data.missing.filter(Boolean) : [];
  const setupIncomplete = missingKeys.length > 0;
  const heading = setupIncomplete ? 'Company email setup is incomplete' : 'Direct email delivery is unavailable';
  const description = data?.message || 'The email provider could not complete delivery. Your timesheet is still ready to preview, print, or send from your mail app.';
  const deliveryStatus = setupIncomplete ? 'Setup required' : 'Connection unavailable';
  const html = `
    <style>
      .email-setup-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.65fr);gap:18px;max-width:100%}.email-setup-grid>*{min-width:0}.email-preview-card{border:1px solid rgba(56,189,248,.38);border-radius:14px;background:linear-gradient(145deg,rgba(15,23,42,.96),rgba(8,32,48,.94));padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.28)}.email-preview-card h3{margin:0 0 8px;overflow-wrap:anywhere}.email-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.smtp-chip{display:inline-flex;margin:4px 6px 4px 0;padding:7px 10px;border-radius:999px;background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.28);color:#9ff7ff;font-weight:800;font-size:12px}.smtp-note{color:#b7c7d6;line-height:1.55;overflow-wrap:anywhere}.smtp-box{border:1px solid rgba(56,189,248,.25);border-radius:14px;padding:14px;background:rgba(2,6,23,.45);overflow:hidden}.email-mini-table{width:100%;border-collapse:collapse;font-size:12px}.email-mini-table th,.email-mini-table td{padding:8px;border-bottom:1px solid rgba(148,163,184,.2);text-align:left;overflow-wrap:anywhere}.email-mini-table th{color:#49f4e7;text-transform:uppercase;font-size:10px}@media(max-width:760px){.email-setup-grid{grid-template-columns:1fr}.email-actions{display:grid;grid-template-columns:1fr 1fr}.email-actions .btn{width:100%;justify-content:center}.smtp-box{order:-1}}@media(max-width:460px){.email-actions{grid-template-columns:1fr}}
    </style>
    <div class="email-setup-grid">
      <div class="email-preview-card">
        <div class="eyebrow">Email delivery</div>
        <h3>${escapeHtml(heading)}</h3>
        <p class="smtp-note">${escapeHtml(description)}</p>
        ${missingKeys.length ? `<div>${missingKeys.map((key) => `<span class="smtp-chip">${escapeHtml(key)}</span>`).join('')}</div>` : ''}
        <div class="email-actions">
          <button class="btn primary" type="button" onclick="openTimesheetPreviewWindow()">Preview Timesheet</button>
          <button class="btn" type="button" onclick="printTimesheetPreview()">Print / Save PDF</button>
          <button class="btn" type="button" onclick="copyTimesheetDraft()">Copy Summary</button>
          <button class="btn" type="button" onclick="openTimesheetMailDraft()">Open Mail Draft</button>
        </div>
      </div>
      <div class="smtp-box">
        <div class="eyebrow">Preview</div>
        <h3>${escapeHtml(draft.subject)}</h3>
        <p class="smtp-note">Records: ${escapeHtml(data?.preview?.records ?? '0')}<br>Total hours: ${escapeHtml(data?.preview?.total_hours ?? '0')}</p>
        <table class="email-mini-table"><thead><tr><th>Action</th><th>Status</th></tr></thead><tbody><tr><td>Timesheet document</td><td>Ready</td></tr><tr><td>Direct email</td><td>${escapeHtml(deliveryStatus)}</td></tr></tbody></table>
      </div>
    </div>
  `;
  showDialog('Timesheet Email', html, hideDialog, 'Close');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

async function sendTimesheetEmail() {
  const body = {
    user_id: Number(document.getElementById('timesheetSendStaffSelect')?.value || 0) || null,
    from_date: document.getElementById('timesheetSendFrom')?.value || todayISO(-7),
    to_date: document.getElementById('timesheetSendTo')?.value || todayISO(),
    recipient: document.getElementById('timesheetSendRecipient')?.value.trim(),
    include_employee: true
  };
  const log = document.getElementById('timesheetEmailLogBody');
  const selectedRows = filteredTimesheetAttendanceRows();
  if (log) log.textContent = 'Preparing timesheet email...';

  const res = await fetch('/api/attendance/timesheets/send', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  const data = await safeJson(res);

  if (res.ok) {
    if (log) log.textContent = `${data.message}. Records: ${data.records}, hours: ${data.total_hours}`;
    showToast(data.message || 'Timesheet sent');
    return;
  }

  const draft = buildTimesheetEmailDraft(selectedRows, body.from_date, body.to_date);
  lastTimesheetEmailDraft = { ...draft, recipient: body.recipient || data?.recipient || '' };
  if (data?.missing) {
    const setup = `SMTP setup required: ${data.missing.join(', ')}`;
    if (log) log.textContent = `${setup}. Timesheet preview is ready.`;
    showToast('Email setup needed. Timesheet preview is ready.');
    showTimesheetEmailSetupDialog(data, lastTimesheetEmailDraft);
    return;
  }

  if (log) log.textContent = `${data.message || 'Email could not be sent.'} Timesheet preview is ready.`;
  showToast(data.message || 'Direct email unavailable. Timesheet preview is ready.');
  showTimesheetEmailSetupDialog(data, lastTimesheetEmailDraft);
}

function isAutoClockNote(note) {
  return /(^|\s)A(\s|$)|auto clock-out after 12 hours/i.test(String(note || ''));
}

function renderTimesheetNote(note) {
  if (isAutoClockNote(note)) {
    return '<span class="auto-clock-badge" title="Auto clock-out after 12 hours">A</span>';
  }
  return escapeHtml(note || '-');
}

function reviewPendingTimesheets() {
  setTimesheetTab('PENDING_APPROVAL');
  const pending = (window.vvTimesheetCache || []).filter((row) => ['PENDING_APPROVAL', 'CORRECTION_RESUBMITTED'].includes(String(row.status || '').toUpperCase()));
  showToast(pending.length ? `${pending.length} pending timesheet${pending.length === 1 ? '' : 's'} ready for review` : 'No pending timesheets');
}


function focusTimesheetRegister(message, rowClass) {
  const section = document.getElementById('timesheetAdminBody')?.closest('.table-wrap');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (rowClass) {
    document.querySelectorAll('#timesheetAdminBody tr').forEach((row) => row.classList.remove('timesheet-focus-row'));
    document.querySelectorAll(rowClass).forEach((row) => row.classList.add('timesheet-focus-row'));
    window.setTimeout(() => document.querySelectorAll(rowClass).forEach((row) => row.classList.remove('timesheet-focus-row')), 2800);
  }
  showToast(message);
}

function reviewPayrollReadyTimesheets() {
  setTimesheetTab('APPROVED');
  const ready = (window.vvTimesheetCache || []).filter((row) => String(row.status || '').toUpperCase() === 'APPROVED');
  focusTimesheetRegister(ready.length ? `${ready.length} payroll-ready timesheet${ready.length === 1 ? '' : 's'}` : 'No approved payroll-ready timesheets yet', '.timesheet-approved-row');
}

function reviewOvertimeTimesheets() {
  const overtime = (attendanceCache || []).filter((row) => Number(row.total_hours || 0) > 10);
  const section = document.getElementById('attendanceTableBody')?.closest('.table-wrap');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast(overtime.length ? `${overtime.length} overtime alert${overtime.length === 1 ? '' : 's'} in the register` : 'No overtime alerts');
}

async function updateTimesheetStatus(id, status) {
  try {
    const res = await fetch('/api/attendance/timesheets/status', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ id, status })
    });
    const data = await safeJson(res);
    showToast(data.message || (res.ok ? 'Timesheet updated' : 'Timesheet update failed'));
    if (res.ok) await loadTimesheets();
  } catch (err) {
    showToast('Timesheet update failed');
  }
}

function formatTimesheetStatusLabel(value) {
  return String(value || 'DRAFT')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function renderTimesheetStatusChip(status) {
  const clean = String(status || 'DRAFT').toLowerCase();
  const labels = {
    draft: 'Draft',
    pending_approval: 'Pending Approval',
    correction_resubmitted: 'Resubmitted',
    approved: 'Approved',
    rejected: 'Rejected',
    correction_required: 'Correction Required',
    archived: 'Archived'
  };
  const label = labels[clean] || formatTimesheetStatusLabel(clean);
  return '<span class="timesheet-status-chip ' + escapeHtml(clean) + '">' + escapeHtml(label) + '</span>';
}

function timesheetMatchesActiveTab(row) {
  const status = String(row.status || 'DRAFT').toUpperCase();
  if (activeTimesheetTab === 'ALL') return true;
  if (activeTimesheetTab === 'PENDING_APPROVAL') {
    return ['PENDING_APPROVAL', 'CORRECTION_RESUBMITTED'].includes(status);
  }
  return status === activeTimesheetTab;
}

function setTimesheetTab(status) {
  activeTimesheetTab = String(status || 'PENDING_APPROVAL').toUpperCase();
  document.querySelectorAll('.timesheet-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.timesheetStatus === activeTimesheetTab);
  });
  renderTimesheetRegister();
  document.getElementById('timesheetAdminBody')?.closest('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openTimesheetDetail(id) {
  const res = await fetch(`/api/attendance/timesheets/${Number(id)}`, { headers: authHeaders() });
  const data = await safeJson(res);
  if (!res.ok) return showToast(data.message || 'Unable to load timesheet detail');
  const timesheet = data.timesheet || {};
  const records = data.summary?.records || [];
  const rows = records.map((row) => `
    <tr><td>${escapeHtml(String(row.work_date || '').slice(0, 10))}</td><td>${escapeHtml(formatDateTime(row.clock_in))}</td><td>${escapeHtml(formatDateTime(row.clock_out))}</td><td>${Number(row.total_hours || 0).toFixed(2)}</td><td>${renderTimesheetNote(row.notes)}</td></tr>
  `).join('') || '<tr><td colspan="5">No attendance records.</td></tr>';
  showDialog('Timesheet Review', `
    <div class="timesheet-detail-summary">
      <article><small>Employee</small><strong>${escapeHtml(timesheet.name || timesheet.email || '-')}</strong></article>
      <article><small>Period</small><strong>${escapeHtml(String(timesheet.week_start || '').slice(0, 10))} to ${escapeHtml(String(timesheet.week_end || '').slice(0, 10))}</strong></article>
      <article><small>Submitted</small><strong>${Number(timesheet.total_hours || 0).toFixed(2)} hrs</strong></article>
      <article><small>Status</small><strong>${renderTimesheetStatusChip(timesheet.status)}</strong></article>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${timesheet.manager_comments ? `<div class="status-note"><strong>Manager note:</strong> ${escapeHtml(timesheet.manager_comments)}</div>` : ''}
  `, hideDialog, 'Close');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog');
}

async function approveTimesheetRecord(id, approvedHours, comments = '') {
  const res = await fetch(`/api/attendance/timesheets/${Number(id)}/approve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ approved_hours: approvedHours, comments })
  });
  const data = await safeJson(res);
  showToast(data.message || (res.ok ? 'Timesheet approved' : 'Timesheet approval failed'));
  if (res.ok) {
    hideDialog();
    await loadTimesheets();
  }
}

function openTimesheetDecision(id, action, submittedHours) {
  const labels = {
    approve: ['Approve Timesheet', 'Approve'],
    correction: ['Request Correction', 'Send Request'],
    reject: ['Reject Timesheet', 'Reject'],
    amend: ['Amend Approved Timesheet', 'Save Amendment']
  };
  const [title, buttonText] = labels[action] || labels.approve;
  const needsReason = action !== 'approve';
  showDialog(title, `
    <div class="form-stack">
      ${(action === 'approve' || action === 'amend') ? `<label>Approved hours<input id="timesheetDecisionHours" type="number" min="0" max="168" step="0.01" value="${Number(submittedHours || 0).toFixed(2)}"></label>` : ''}
      <label>${needsReason ? 'Reason / manager comments' : 'Manager comments (optional)'}<textarea id="timesheetDecisionComments" rows="4" placeholder="${needsReason ? 'Required for the audit history' : 'Optional approval note'}"></textarea></label>
    </div>
  `, async () => {
    const comments = document.getElementById('timesheetDecisionComments')?.value.trim() || '';
    const approvedHours = Number(document.getElementById('timesheetDecisionHours')?.value || submittedHours || 0);
    if (needsReason && !comments) return showToast('A reason is required');
    if (action === 'approve') return approveTimesheetRecord(id, approvedHours, comments);
    const endpoint = action === 'amend' ? 'amend' : action;
    const body = action === 'amend' ? { approved_hours: approvedHours, reason: comments } : { comments };
    const res = await fetch(`/api/attendance/timesheets/${Number(id)}/${endpoint}`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
    });
    const data = await safeJson(res);
    showToast(data.message || (res.ok ? 'Timesheet updated' : 'Timesheet update failed'));
    if (res.ok) { hideDialog(); await loadTimesheets(); }
  }, buttonText);
}

function renderTimesheetReviewActions(timesheet) {
  const id = Number(timesheet.id || 0);
  const status = String(timesheet.status || 'DRAFT').toUpperCase();
  if (!id) return '-';
  if (status === 'APPROVED') {
    return `<div class="table-action-stack timesheet-review-actions"><button class="secondary-btn small" onclick="openTimesheetDetail(${id})">View</button><button class="secondary-btn small" onclick="openTimesheetDecision(${id}, 'amend', ${Number(timesheet.approved_hours || 0)})">Amend</button></div>`;
  }
  if (['PENDING_APPROVAL', 'CORRECTION_RESUBMITTED'].includes(status)) {
    return `<div class="table-action-stack timesheet-review-actions"><button class="secondary-btn small" onclick="openTimesheetDetail(${id})">View</button><button class="small-btn" onclick="openTimesheetDecision(${id}, 'approve', ${Number(timesheet.total_hours || 0)})">Approve</button><button class="secondary-btn small" onclick="openTimesheetDecision(${id}, 'correction', ${Number(timesheet.total_hours || 0)})">Correction</button><button class="danger-btn small" onclick="openTimesheetDecision(${id}, 'reject', ${Number(timesheet.total_hours || 0)})">Reject</button></div>`;
  }
  return `<div class="table-action-stack timesheet-review-actions"><button class="secondary-btn small" onclick="openTimesheetDetail(${id})">View</button></div>`;
}

function renderTimesheetRegister() {
  var tbody = document.getElementById('timesheetAdminBody');
  if (!tbody) return;
  const visibleRows = (window.vvTimesheetCache || []).filter(timesheetMatchesActiveTab);
  renderRegisterPage({
    key: `timesheets-${activeTimesheetTab.toLowerCase()}`,
    tbody: tbody,
    rows: visibleRows,
    colspan: 8,
    emptyMessage: `No ${activeTimesheetTab === 'ALL' ? '' : formatTimesheetStatusLabel(activeTimesheetTab)} timesheets.`,
    onChange: renderTimesheetRegister,
    rowRenderer: function(t) {
      var status = String(t.status || 'DRAFT').toUpperCase();
      return `<tr class="${status === 'APPROVED' ? 'timesheet-approved-row' : (['PENDING_APPROVAL', 'CORRECTION_RESUBMITTED'].includes(status) ? 'timesheet-pending-row' : '')}"><td><strong>${escapeHtml(t.name || '-')}</strong><span class="cell-subtext">${escapeHtml(t.email || '-')}</span></td><td>${escapeHtml(String(t.week_start || '').slice(0, 10))}<span class="cell-subtext">to ${escapeHtml(String(t.week_end || '').slice(0, 10))}</span></td><td><strong>${Number(t.total_hours || 0).toFixed(2)}</strong></td><td>${Number(t.ordinary_hours || 0).toFixed(2)}</td><td>${Number(t.overtime_hours || 0).toFixed(2)}</td><td>${status === 'APPROVED' ? Number(t.approved_hours || 0).toFixed(2) : '-'}</td><td>${renderTimesheetStatusChip(status)}</td><td>${renderTimesheetReviewActions(t)}</td></tr>`;
    }
  });
}

async function loadTimesheets() {
  const tbody = document.getElementById('timesheetAdminBody');
  if (!tbody) return;
  populateTimesheetSendStaffSelect();
  tbody.innerHTML = '<tr><td colspan="8">Loading timesheets...</td></tr>';
  const res = await fetch('/api/attendance/timesheets?status=ALL', { headers: { Authorization: 'Bearer ' + token } });
  const data = await safeJson(res);
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(data.message || 'Failed to load timesheets')}</td></tr>`;
    return;
  }
  window.vvTimesheetCache = data.timesheets || [];
  updateWorkforceDashboardMetrics();
  renderTimesheetRegister();
}


if (!window.__adminStaffMessagePoller) {
  window.__adminStaffMessagePoller = setInterval(() => {
    if (token && !redirectingToLogin && document.visibilityState !== 'hidden') {
      loadAdminStaffMessages();
      loadAdminWorkHubRequests();
    }
  }, 30000);
}
