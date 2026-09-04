Warning: truncated output (original token count: 104018)
Total output lines: 9107

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
const financeState = {
  years: [],
  selectedYearId: null,
  overview: null,
  setup: null,
  issues: [],
  issueFilter: '',
  transactionPage: 1,
  transactionLimit: 25,
  transactionTotal: 0,
  transactionRows: [],
  searchTimer: null,
  reports: null,
  activeTab: 'overview',
  billPage: 1,
  billLimit: 25,
  billTotal: 0,
  billRows: [],
  billSearchTimer: null,
  bankAccounts: [],
  selectedBankAccountId: null,
  bankTransactions: [],
  periods: [],
  accountantQueries: [],
  assets: []
};
const FINANCE_TRANSACTION_TYPES = [
  'SALE', 'CUSTOMER_PAYMENT', 'EXPENSE', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT',
  'PAYROLL', 'REFUND', 'TRANSFER', 'ASSET_PURCHASE', 'OWNER_CONTRIBUTION',
  'OWNER_DRAWING', 'JOURNAL_ADJUSTMENT', 'OTHER'
];
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
  { id: 'finance', label: 'Finance' },
  { id: 'finance_input', label: 'Finance Draft Input/Edit' },
  { id: 'finance_setup', label: 'Finance Setup' },
  { id: 'finance_post_transaction', label: 'Post Finance Transactions' },
  { id: 'finance_create_journal', label: 'Create Journals' },
  { id: 'finance_lock_period', label: 'Lock Financial Periods' },
  { id: 'finance_reconcile', label: 'Bank Reconciliation' },
  { id: 'finance_export', label: 'Finance Export' },
  { id: 'finance_view_payroll', label: 'View Payroll Finance' },
  { id: 'finance_void', label: 'Void Posted Transactions' },
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
    const total = supplierBills.reduce((sum, expense) => sum + Number(expense.balance_due ?? expense.total_amount ?? 0), 0);
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

  panel?.classList.remove('wide-dialog', 'material-dialog', 'supplier-dialog', 'compliance-dialog', 'manual-invoice-dialog', 'staff-access-dialog', 'admin-workhub-dialog', 'finance-dialog');
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
      if (btn.dataset.section === 'financeSection') loadFinanceWorkspace();
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
  const section = requestedAdminSection();
  if (section && canAccessAdminSection(section)) window.setTimeout(() => goSection(section), 0);
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
  return ['admin', 'super_admin'].includes(currentRole) || permissions.includes(permission);
}

const ADMIN_SECTION_ACCESS = Object.freeze({
  dashboardSection: ['dashboard'],
  rfqSection: ['rfqs'],
  invoiceSection: ['invoices'],
  customerSection: ['customers'],
  supplierSection: ['suppliers'],
  competitorSection: ['competitors'],
  stockSection: ['stock', 'stock_in'],
  stockUsageSection: ['stock', 'stock_out'],
  rawMaterialSection: ['stock', 'raw_material'],
  packagingSection: ['stock', 'packaging'],
  meetingSection: ['meetings'],
  financeSection: ['finance'],
  expenseSection: ['expenses'],
  taskSection: ['tasks'],
  attendanceSection: ['attendance'],
  rosterSection: ['roster'],
  staffSection: ['staff'],
  complianceSection: ['compliance'],
  companyFormsSection: ['compliance', 'settings'],
  settingsSection: ['settings']
});

function canAccessAdminSection(sectionId) {
  if (['admin', 'super_admin'].includes(currentRole)) return true;
  return (ADMIN_SECTION_ACCESS[sectionId] || []).some((permission) => hasCurrentPermission(permission));
}

function requestedAdminSection() {
  const view = new URLSearchParams(window.location.search).get('view');
  const sections = {
    rfqs: 'rfqSection', invoices: 'invoiceSection', customers: 'customerSection',
    suppliers: 'supplierSection', stock: 'stockSection', 'raw-material': 'rawMaterialSection',
    packaging: 'packagingSection', finance: 'financeSection', expenses: 'expenseSection', workforce: 'attendanceSection',
    timesheets: 'attendanceSection', roster: 'rosterSection', staff: 'staffSection',
    compliance: 'complianceSection', forms: 'companyFormsSection', settings: 'settingsSection',
    meetings: 'meetingSection', tasks: 'taskSection'
  };
  return sections[view] || '';
}

function configureRestrictedWorkspaceView() {
  if (['admin', 'super_admin'].includes(currentRole)) return;

  document.querySelectorAll('.nav-btn[data-section]').forEach((btn) => {
    btn.classList.toggle('hidden-section', !canAccessAdminSection(btn.dataset.section));
  });
  document.querySelectorAll('.nav-btn[data-permission]').forEach((btn) => {
    btn.classList.toggle('hidden-section', !hasCurrentPermission(btn.dataset.permission));
  });
  document.querySelectorAll('.page-section').forEach((section) => {
    section.classList.toggle('hidden-section', !canAccessAdminSection(section.id));
  });
  document.querySelectorAll('.nav-group').forEach((group) => {
    const visibleChild = [...group.querySelectorAll('.nav-btn')]
      .some((button) => !button.classList.contains('hidden-section'));
    group.classList.toggle('hidden-section', !visibleChild);
  });
  document.querySelectorAll('.nav-section-label').forEach((label) => {
    let node = label.nextElementSibling;
    let hasVisibleItem = false;
    while (node && !node.classList.contains('nav-section-label')) {
      if (!node.classList.contains('hidden-section')) hasVisibleItem = true;
      node = node.nextElementSibling;
    }
    label.classList.toggle('hidden-section', !hasVisibleItem);
  });

  document.querySelector('.topbar-quick-action')?.classList.toggle(
    'hidden-section',
    !hasCurrentPermission('invoices_input')
  );
  document.querySelector('.profile-chip')?.classList.toggle(
    'hidden-section',
    !hasCurrentPermission('staff')
  );

  const allowedSections = Object.keys(ADMIN_SECTION_ACCESS).filter(canAccessAdminSection);
  const requested = requestedAdminSection();
  const target = requested && allowedSections.includes(requested) ? requested : allowedSections[0];
  if (target) window.setTimeout(() => goSection(target), 0);
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

  currentUser = { ...data.user, role };
  currentRole = role;
  localStorage.setItem('user', JSON.stringify(currentUser));
  localStorage.setItem('role', role);

  if (!['admin', 'super_admin'].includes(role)) {
    const hasWorkspaceSection = Object.keys(ADMIN_SECTION_ACCESS).some(canAccessAdminSection);
    if (!hasWorkspaceSection) {
      window.location.replace('/dashboard');
      return null;
    }
    el.innerText = `${data.user.name} | ${data.user.email} | ${role.replaceAll('_', ' ')}`;
    syncTopbarUser(currentUser);
    configureRestrictedWorkspaceView();
    return data.user;
  }

  el.innerText = `${data.user.name} | ${data.user.email} | ${role}`;
  syncTopbarUser(currentUser);
  return data.user;
}

async function loadRestrictedWorkspaceData() {
  const jobs = [];
  if (hasCurrentPermission('dashboard')) jobs.push(loadDashboardStats());
  if (hasCurrentPermission('rfqs')) jobs.push(loadRFQs());
  if (hasCurrentPermission('invoices')) jobs.push(loadInvoices());
  if (hasCurrentPermission('customers')) jobs.push(loadCustomers());
  if (hasCurrentPermission('suppliers')) jobs.push(loadSuppliers());
  if (hasCurrentPermission('finance')) jobs.push(loadFinanceWorkspace());
  if (hasCurrentPermission('expenses')) jobs.push(loadExpenses());
  if (hasCurrentPermission('competitors')) jobs.push(loadCompetitors());
  if (hasCurrentPermission('compliance')) jobs.push(loadComplianceEntries());
  if (hasCurrentPermission('stock') || hasCurrentPermission('stock_in')) jobs.push(loadStock());
  if (hasCurrentPermission('stock') || hasCurrentPermission('stock_out')) jobs.push(loadStockUsage());
  if (hasCurrentPermission('stock') || hasCurrentPermission('raw_material')) jobs.push(loadMaterials('raw_material'));
  if (hasCurrentPermission('stock') || hasCurrentPermission('packaging')) jobs.push(loadMaterials('packaging'));
  if (hasCurrentPermission('meetings')) jobs.push(loadMeetings());
  if (hasCurrentPermission('roster')) jobs.push(loadRoster());
  if (hasCurrentPermission('attendance')) jobs.push(loadAttendance(), loadTimesheets());
  if (hasCurrentPermission('tasks')) jobs.push(loadTasks(), loadAnnouncements());
  if (hasCurrentPermission('staff')) jobs.push(loadStaff(), loadAdminStaffMessages(), loadAdminWorkHubRequests());
  if (hasCurrentPermission('settings')) jobs.push(loadSettings());
  await Promise.all(jobs);
  renderNotificationDropdown();
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
  const nextPaymentValue = Number(payables.next_payment?.balance_due ?? payables.next_payment?.total_amount ?? 0);
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
  const extra = ['rejected', 'deleted', 'disabled', 'overdue'].includes(clean)
    ? ' danger-badge'
    : ['approved', 'paid', 'quoted', 'done', 'active'].includes(clean)
      ? ' success-badge'
      : ['sent', 'in_progress', 'partially_paid'].includes(clean)
        ? ' active-badge'
        : '';

  return `<span class="badge${extra}">${escapeHtml(clean.replaceAll('_', ' '))}</span>`;
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
              <input id="manualInvoiceGst" type="number" min="0" step="0.01" value="10" placeho…54018 tokens truncated…atMoney(row.total_amount || 0)}</strong></td><td>${formatMoney(row.paid_amount || 0)}</td><td><strong>${formatMoney(row.balance || 0)}</strong></td>
      <td><span class="finance-status-pill" data-status="${escapeHtml(String(row.status || '').toLowerCase())}">${escapeHtml(String(row.status || '').replaceAll('_', ' '))}</span></td>
      <td><div class="finance-row-actions finance-bill-actions">
        ${editable ? `<button type="button" class="secondary-btn" onclick="openSupplierBillDialog(${Number(row.id)})">Edit</button>` : ''}
        ${row.status === 'DRAFT' ? `<button type="button" class="primary-btn" onclick="openFinanceBillStatusDialog(${Number(row.id)}, 'PENDING_APPROVAL')">Submit</button>` : ''}
        ${row.status === 'PENDING_APPROVAL' ? `<button type="button" class="primary-btn" onclick="openFinanceBillStatusDialog(${Number(row.id)}, 'APPROVED')">Approve</button>` : ''}
        ${payable ? `<button type="button" class="primary-btn" onclick="openSupplierPaymentDialog(${Number(row.id)})">Pay</button>` : ''}
        ${!['PAID', 'VOID'].includes(row.status) ? `<button type="button" class="danger-btn" onclick="openFinanceBillStatusDialog(${Number(row.id)}, 'VOID')">Void</button>` : ''}
      </div></td></tr>`;
  }).join('');
  enhanceResponsiveTables();
}

async function loadFinanceSupplierBills(page = financeState.billPage) {
  if (!financeState.selectedYearId) return;
  financeState.billPage = Math.max(1, Number(page || 1));
  const body = document.getElementById('financeSupplierBillBody');
  if (body) body.innerHTML = '<tr><td colspan="7"><span class="table-loading-state">Loading supplier bills...</span></td></tr>';
  const query = new URLSearchParams({ financial_year_id: String(financeState.selectedYearId), page: String(financeState.billPage), limit: String(financeState.billLimit) });
  const search = document.getElementById('financeBillSearch')?.value?.trim();
  const status = document.getElementById('financeBillStatus')?.value;
  if (search) query.set('search', search);
  if (status) query.set('status', status);
  try {
    const data = await financeApi(`/supplier-bills?${query}`);
    financeState.billRows = data.bills || [];
    financeState.billTotal = Number(data.total || 0);
    renderFinanceSupplierBills(financeState.billRows, Number(data.page || 1), Number(data.limit || financeState.billLimit), financeState.billTotal);
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="7">${escapeHtml(financeErrorText(error))}</td></tr>`;
  }
}

function changeFinanceBillPage(delta) {
  const max = Math.max(1, Math.ceil(financeState.billTotal / financeState.billLimit));
  loadFinanceSupplierBills(Math.min(max, Math.max(1, financeState.billPage + Number(delta || 0))));
}

function setFinanceBillLimit(value) {
  financeState.billLimit = Math.min(100, Math.max(10, Number(value || 25)));
  loadFinanceSupplierBills(1);
}

function queueFinanceBillSearch() {
  clearTimeout(financeState.billSearchTimer);
  financeState.billSearchTimer = setTimeout(() => loadFinanceSupplierBills(1), 280);
}

function financeSupplierOptions(selectedId = '') {
  return supplierCache.filter((supplier) => !Number(supplier.deleted)).map((supplier) => `<option value="${Number(supplier.id)}" ${String(supplier.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(supplier.supplier_name || supplier.contact_name || `Supplier ${supplier.id}`)}</option>`).join('');
}

function financeBillLineHtml(line = {}, index = 0) {
  return `<div class="finance-bill-line" data-finance-bill-line>
    <label class="finance-line-description"><span>Description *</span><input data-field="description" value="${escapeHtml(line.description || '')}" placeholder="Material, service or operating cost"></label>
    <label><span>Quantity *</span><input data-field="quantity" inputmode="decimal" value="${escapeHtml(line.quantity || '1')}"></label>
    <label><span>Unit price *</span><input data-field="unit_price" inputmode="decimal" value="${escapeHtml(line.unit_price || '0.00')}"></label>
    <label><span>Account</span><select data-field="account_id"><option value="">Review required</option>${financeAccountOptions(line.account_id)}</select></label>
    <button type="button" class="icon-btn finance-remove-line" aria-label="Remove bill line" title="Remove bill line" onclick="this.closest('[data-finance-bill-line]').remove()">&times;</button>
  </div>`;
}

function addFinanceBillLine(line = {}) {
  document.getElementById('financeBillLines')?.insertAdjacentHTML('beforeend', financeBillLineHtml(line, document.querySelectorAll('[data-finance-bill-line]').length));
}

async function openSupplierBillDialog(id = 0) {
  try {
    if (!financeState.setup) financeState.setup = await financeApi('/setup');
    if (!supplierCache.length) await loadSuppliers();
    let bill = {};
    let items = [{}];
    if (id) {
      const data = await financeApi(`/supplier-bills/${Number(id)}`);
      bill = data.bill || {};
      items = data.items?.length ? data.items : [{}];
    }
    showDialog(id ? 'Edit Supplier Bill' : 'Add Supplier Bill', `
      <div class="finance-dialog-layout compact" data-finance-bill-id="${Number(id || 0)}">
        <section class="dialog-card"><div class="finance-form-grid two-col">
          <label><span>Supplier *</span><select id="financeBillSupplier"><option value="">Select supplier</option>${financeSupplierOptions(bill.supplier_id)}</select></label>
          <label><span>Supplier invoice number *</span><input id="financeBillInvoiceNo" value="${escapeHtml(bill.supplier_invoice_no || '')}"></label>
          <label><span>Issue date *</span><input id="financeBillIssueDate" type="date" value="${escapeHtml(String(bill.issue_date || new Date().toISOString().slice(0, 10)).slice(0, 10))}"></label>
          <label><span>Due date</span><input id="financeBillDueDate" type="date" value="${escapeHtml(String(bill.due_date || '').slice(0, 10))}"></label>
          <label><span>GST treatment *</span><select id="financeBillTax"><option value="">Select GST treatment</option>${financeTaxOptions(bill.tax_code || 'GST_ON_EXPENSES')}</select></label>
          <label><span>Job / project reference</span><input id="financeBillJob" value="${escapeHtml(bill.job_reference || '')}"></label>
          <label class="full"><span>Workflow</span><select id="financeBillSaveStatus"><option value="DRAFT" ${bill.status === 'DRAFT' ? 'selected' : ''}>Save draft</option><option value="PENDING_APPROVAL" ${bill.status === 'PENDING_APPROVAL' ? 'selected' : ''}>Submit for approval</option></select></label>
        </div></section>
        <section class="dialog-card"><div class="finance-panel-head"><div><h4>Bill lines</h4><p>Amounts are recalculated on the server using cent-safe rules.</p></div><button type="button" class="secondary-btn" onclick="addFinanceBillLine()">Add Line</button></div><div id="financeBillLines" class="finance-bill-lines">${items.map(financeBillLineHtml).join('')}</div></section>
      </div>`, saveSupplierBill, id ? 'Update Bill' : 'Save Bill');
    document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
  } catch (error) { showToast(financeErrorText(error)); }
}

async function saveSupplierBill() {
  const wrapper = document.querySelector('[data-finance-bill-id]');
  const items = [...document.querySelectorAll('[data-finance-bill-line]')].map((line) => ({
    description: line.querySelector('[data-field="description"]')?.value,
    quantity: line.querySelector('[data-field="quantity"]')?.value,
    unit_price: line.querySelector('[data-field="unit_price"]')?.value,
    account_id: line.querySelector('[data-field="account_id"]')?.value || null
  }));
  const payload = { id: Number(wrapper?.dataset.financeBillId || 0) || undefined, supplier_id: document.getElementById('financeBillSupplier')?.value, supplier_invoice_no: document.getElementById('financeBillInvoiceNo')?.value, issue_date: document.getElementById('financeBillIssueDate')?.value, due_date: document.getElementById('financeBillDueDate')?.value, tax_code: document.getElementById('financeBillTax')?.value, job_reference: document.getElementById('financeBillJob')?.value, status: document.getElementById('financeBillSaveStatus')?.value, items };
  try {
    const data = await financeApi('/supplier-bills', { method: 'POST', body: JSON.stringify(payload) });
    hideDialog(); showToast(data.message || 'Supplier bill saved successfully.'); await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceBillStatusDialog(id, status) {
  const label = String(status).replaceAll('_', ' ');
  showDialog(`${label} Supplier Bill`, `<div class="finance-confirm-panel"><p>This action is audit logged and cannot silently rewrite approved accounting records.</p><label><span>Reason / approval note ${status === 'VOID' ? '*' : ''}</span><textarea id="financeBillStatusReason" rows="3"></textarea></label></div>`, () => updateFinanceBillStatus(id, status), label);
}

async function updateFinanceBillStatus(id, status) {
  try {
    const data = await financeApi(`/supplier-bills/${Number(id)}/status`, { method: 'POST', body: JSON.stringify({ status, reason: document.getElementById('financeBillStatusReason')?.value?.trim() }) });
    hideDialog(); showToast(data.message || 'Supplier bill updated successfully.'); await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

async function openSupplierPaymentDialog(id) {
  try {
    if (!financeState.bankAccounts.length) await loadFinanceBankAccounts(false);
    const row = financeState.billRows.find((bill) => Number(bill.id) === Number(id)) || {};
    showDialog('Record Supplier Payment', `<div class="finance-confirm-panel" data-finance-payment-bill="${Number(id)}"><div class="finance-report-metrics"><div><span>Supplier</span><strong>${escapeHtml(row.supplier_name || '-')}</strong></div><div><span>Invoice</span><strong>${escapeHtml(row.supplier_invoice_no || '-')}</strong></div><div><span>Balance</span><strong>${formatMoney(row.balance || 0)}</strong></div></div><div class="finance-form-grid two-col"><label><span>Payment date *</span><input id="financePaymentDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label><span>Amount *</span><input id="financePaymentAmount" inputmode="decimal" value="${escapeHtml(row.balance || '')}"></label><label><span>Bank account</span><select id="financePaymentBank"><option value="">Not linked</option>${financeState.bankAccounts.map((account) => `<option value="${Number(account.id)}">${escapeHtml(account.nickname)}</option>`).join('')}</select></label><label><span>Payment method</span><input id="financePaymentMethod" value="Bank"></label><label class="full"><span>Reference</span><input id="financePaymentReference"></label><label class="full"><span>Notes</span><textarea id="financePaymentNotes" rows="2"></textarea></label></div></div>`, saveSupplierPayment, 'Post Payment');
    document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
  } catch (error) { showToast(financeErrorText(error)); }
}

async function saveSupplierPayment() {
  const billId = Number(document.querySelector('[data-finance-payment-bill]')?.dataset.financePaymentBill || 0);
  const payload = { payment_date: document.getElementById('financePaymentDate')?.value, amount: document.getElementById('financePaymentAmount')?.value, bank_account_id: document.getElementById('financePaymentBank')?.value || null, payment_method: document.getElementById('financePaymentMethod')?.value, reference: document.getElementById('financePaymentReference')?.value, notes: document.getElementById('financePaymentNotes')?.value };
  try {
    const data = await financeApi(`/supplier-bills/${billId}/payments`, { method: 'POST', body: JSON.stringify(payload) });
    hideDialog(); showToast(data.message || 'Supplier payment recorded successfully.'); await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

function renderFinanceBankAccounts() {
  const panel = document.getElementById('financeBankAccountList');
  if (!panel) return;
  if (!financeState.bankAccounts.length) {
    panel.innerHTML = '<div class="empty-state compact">No bank accounts configured. Add a masked account to begin reconciliation.</div>';
    return;
  }
  panel.innerHTML = financeState.bankAccounts.map((account) => `<button type="button" class="finance-account-item ${Number(account.id) === Number(financeState.selectedBankAccountId) ? 'is-active' : ''}" onclick="selectFinanceBankAccount(${Number(account.id)})"><span><strong>${escapeHtml(account.nickname)}</strong><small>${escapeHtml(account.institution || 'Institution not recorded')} | ${escapeHtml(account.account_number_masked || 'masked')}</small></span><span><strong>${Number(account.unreconciled_count || 0)}</strong><small>unreconciled</small></span></button>`).join('');
}

async function loadFinanceBankAccounts(loadTransactions = true) {
  try {
    const data = await financeApi('/bank-accounts');
    financeState.bankAccounts = data.bank_accounts || [];
    if (!financeState.selectedBankAccountId && financeState.bankAccounts.length) financeState.selectedBankAccountId = Number(financeState.bankAccounts[0].id);
    if (financeState.selectedBankAccountId && !financeState.bankAccounts.some((entry) => Number(entry.id) === Number(financeState.selectedBankAccountId))) financeState.selectedBankAccountId = Number(financeState.bankAccounts[0]?.id || 0) || null;
    renderFinanceBankAccounts();
    const importButton = document.getElementById('financeBankImportButton');
    if (importButton) importButton.disabled = !financeState.selectedBankAccountId;
    if (loadTransactions && financeState.selectedBankAccountId) await loadFinanceBankTransactions();
  } catch (error) {
    const panel = document.getElementById('financeBankAccountList');
    if (panel) panel.innerHTML = `<div class="empty-state compact">${escapeHtml(financeErrorText(error))}</div>`;
  }
}

async function selectFinanceBankAccount(id) {
  financeState.selectedBankAccountId = Number(id || 0) || null;
  renderFinanceBankAccounts();
  await loadFinanceBankTransactions();
}

function renderFinanceBankTransactions(rows) {
  const body = document.getElementById('financeBankTransactionBody');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state compact">No bank statement entries have been imported for this account.</div></td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => `<tr><td>${financeFormatDate(row.transaction_date)}</td><td><strong>${escapeHtml(row.description || '-')}</strong><small class="finance-cell-note">${escapeHtml(row.reference || '')}</small></td><td>${Number(row.debit || 0) ? formatMoney(row.debit) : '-'}</td><td>${Number(row.credit || 0) ? formatMoney(row.credit) : '-'}</td><td>${formatMoney(row.matched_amount || 0)}</td><td><span class="finance-status-pill" data-status="${escapeHtml(String(row.reconciliation_status || '').toLowerCase())}">${escapeHtml(row.reconciliation_status || '-')}</span></td><td><div class="finance-row-actions">${!['RECONCILED', 'IGNORED'].includes(row.reconciliation_status) ? `<button type="button" class="primary-btn" onclick="openFinanceReconcileDialog(${Number(row.id)})">Match</button><button type="button" class="secondary-btn" onclick="openFinanceIgnoreDialog(${Number(row.id)})">Ignore</button>` : '<span class="finance-locked-label">Reviewed</span>'}</div></td></tr>`).join('');
  enhanceResponsiveTables();
}

async function loadFinanceBankTransactions() {
  if (!financeState.selectedBankAccountId) return;
  const body = document.getElementById('financeBankTransactionBody');
  if (body) body.innerHTML = '<tr><td colspan="7"><span class="table-loading-state">Loading bank entries...</span></td></tr>';
  try {
    const data = await financeApi(`/bank-accounts/${financeState.selectedBankAccountId}/transactions?limit=200`);
    financeState.bankTransactions = data.bank_transactions || [];
    const account = financeState.bankAccounts.find((entry) => Number(entry.id) === Number(financeState.selectedBankAccountId));
    setText('financeBankPageInfo', `${account?.nickname || 'Bank account'} | ${Number(data.total || 0)} imported entries`);
    renderFinanceBankTransactions(financeState.bankTransactions);
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="7">${escapeHtml(financeErrorText(error))}</td></tr>`;
  }
}

function openFinanceBankAccountDialog() {
  showDialog('Add Bank Account', `<div class="finance-dialog-layout compact"><section class="dialog-card"><div class="finance-form-grid two-col"><label><span>Account nickname *</span><input id="financeBankNickname" placeholder="Operating account"></label><label><span>Institution</span><input id="financeBankInstitution"></label><label><span>Masked BSB</span><input id="financeBankBsb" placeholder="***-***"></label><label><span>Masked account number</span><input id="financeBankNumber" placeholder="****1234"></label><label><span>Currency</span><input id="financeBankCurrency" value="AUD" maxlength="3"></label><label><span>Opening balance</span><input id="financeBankOpening" inputmode="decimal" value="0.00"></label></div></section></div>`, saveFinanceBankAccount, 'Save Account');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
}

async function saveFinanceBankAccount() {
  const payload = { nickname: document.getElementById('financeBankNickname')?.value, institution: document.getElementById('financeBankInstitution')?.value, bsb_masked: document.getElementById('financeBankBsb')?.value, account_number_masked: document.getElementById('financeBankNumber')?.value, currency: document.getElementById('financeBankCurrency')?.value, opening_balance: document.getElementById('financeBankOpening')?.value };
  try {
    const data = await financeApi('/bank-accounts', { method: 'POST', body: JSON.stringify(payload) });
    hideDialog(); financeState.selectedBankAccountId = Number(data.bank_account_id); showToast(data.message || 'Bank account saved successfully.'); await loadFinanceBankAccounts();
  } catch (error) { showToast(financeErrorText(error)); }
}

function parseFinanceCsvLine(line) {
  const values = []; let current = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(current.trim()); current = ''; }
    else current += char;
  }
  values.push(current.trim());
  return values;
}

function financeCsvRows(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('The CSV needs a header row and at least one transaction.');
  const headers = parseFinanceCsvLine(lines.shift()).map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const aliases = { date: 'transaction_date', transactiondate: 'transaction_date', details: 'description', narration: 'description', amount_debit: 'debit', withdrawal: 'debit', amount_credit: 'credit', deposit: 'credit', balance: 'running_balance' };
  return lines.map((line) => {
    const values = parseFinanceCsvLine(line); const row = {};
    headers.forEach((header, index) => { row[aliases[header] || header] = values[index] ?? ''; });
    return row;
  });
}

function openFinanceBankImportDialog() {
  if (!financeState.selectedBankAccountId) return showToast('Select a bank account first.');
  showDialog('Import Bank Statement', `<div class="finance-dialog-layout compact"><section class="dialog-card"><div class="finance-form-grid"><label><span>CSV statement *</span><input id="financeBankCsvFile" type="file" accept=".csv,text/csv" onchange="loadFinanceBankCsvFile(this)"></label><label><span>CSV content</span><textarea id="financeBankCsvText" rows="10" placeholder="transaction_date,description,reference,debit,credit,running_balance"></textarea></label><p class="finance-report-note">Required columns: transaction_date, description, debit or credit. Duplicate rows are detected by a secure row hash.</p></div></section></div>`, saveFinanceBankImport, 'Import Statement');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
}

async function loadFinanceBankCsvFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  document.getElementById('financeBankCsvText').value = await file.text();
}

async function saveFinanceBankImport() {
  try {
    const rows = financeCsvRows(document.getElementById('financeBankCsvText')?.value);
    const filename = document.getElementById('financeBankCsvFile')?.files?.[0]?.name || 'pasted-statement.csv';
    const data = await financeApi(`/bank-accounts/${financeState.selectedBankAccountId}/import`, { method: 'POST', body: JSON.stringify({ original_name: filename, rows }) });
    hideDialog(); showToast(data.message || 'Bank statement imported successfully.'); await loadFinanceBankAccounts();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceReconcileDialog(id) {
  const row = financeState.bankTransactions.find((entry) => Number(entry.id) === Number(id));
  if (!row) return;
  const amount = Math.abs(Number(row.credit || 0) - Number(row.debit || 0)).toFixed(2);
  const posted = financeState.transactionRows.filter((entry) => ['POSTED', 'RECONCILED'].includes(entry.status));
  showDialog('Match Bank Transaction', `<div class="finance-confirm-panel" data-bank-transaction-id="${Number(id)}"><div class="finance-report-metrics"><div><span>Date</span><strong>${financeFormatDate(row.transaction_date)}</strong></div><div><span>Description</span><strong>${escapeHtml(row.description || '-')}</strong></div><div><span>Amount</span><strong>${formatMoney(amount)}</strong></div></div><label><span>Posted ledger transaction *</span><select id="financeReconcileTransaction"><option value="">Select transaction</option>${posted.map((entry) => `<option value="${Number(entry.id)}">${escapeHtml(entry.transaction_uid)} | ${escapeHtml(entry.description || '')} | ${formatMoney(entry.gross_amount || 0)}</option>`).join('')}</select></label><label><span>Matched amount *</span><input id="financeReconcileAmount" inputmode="decimal" value="${amount}"></label><label><span>Review note</span><textarea id="financeReconcileNote" rows="2"></textarea></label></div>`, saveFinanceReconciliation, 'Save Match');
}

async function saveFinanceReconciliation() {
  const id = Number(document.querySelector('[data-bank-transaction-id]')?.dataset.bankTransactionId || 0);
  try {
    const data = await financeApi(`/bank-transactions/${id}/reconcile`, { method: 'POST', body: JSON.stringify({ finance_transaction_id: document.getElementById('financeReconcileTransaction')?.value, matched_amount: document.getElementById('financeReconcileAmount')?.value, note: document.getElementById('financeReconcileNote')?.value }) });
    hideDialog(); showToast(data.message || 'Bank transaction matched successfully.'); await loadFinanceBankAccounts();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceIgnoreDialog(id) {
  showDialog('Ignore Bank Transaction', `<div class="finance-confirm-panel" data-bank-ignore-id="${Number(id)}"><p>The row remains in the audit trail and is excluded from the active reconciliation queue.</p><label><span>Reason *</span><textarea id="financeIgnoreReason" rows="3"></textarea></label></div>`, saveFinanceIgnoredTransaction, 'Ignore Entry');
}

async function saveFinanceIgnoredTransaction() {
  const id = Number(document.querySelector('[data-bank-ignore-id]')?.dataset.bankIgnoreId || 0);
  try {
    const data = await financeApi(`/bank-transactions/${id}/ignore`, { method: 'POST', body: JSON.stringify({ reason: document.getElementById('financeIgnoreReason')?.value }) });
    hideDialog(); showToast(data.message || 'Bank entry ignored.'); await loadFinanceBankAccounts();
  } catch (error) { showToast(financeErrorText(error)); }
}

function renderFinancePeriods() {
  const body = document.getElementById('financePeriodBody');
  if (!body) return;
  if (!financeState.periods.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state compact">No accounting periods configured for this year.</div></td></tr>';
    return;
  }
  body.innerHTML = financeState.periods.map((period) => `<tr><td><strong>${escapeHtml(period.period_key)}</strong><small class="finance-cell-note">${escapeHtml(period.financial_year_label || '')}</small></td><td>${financeFormatDate(period.start_date)}<small class="finance-cell-note">to ${financeFormatDate(period.end_date)}</small></td><td><span class="finance-status-pill" data-status="${escapeHtml(String(period.status || '').toLowerCase())}">${escapeHtml(period.status || '-')}</span></td><td>${period.locked_at ? financeFormatDate(period.locked_at) : '-'}</td><td><button type="button" class="secondary-btn" onclick="openFinancePeriodDialog(${Number(period.id)})">Control</button></td></tr>`).join('');
  enhanceResponsiveTables();
}

function renderFinanceQueries() {
  const panel = document.getElementById('financeQueryList');
  if (!panel) return;
  if (!financeState.accountantQueries.length) {
    panel.innerHTML = '<div class="empty-state compact">No accountant questions recorded for this year.</div>';
    return;
  }
  panel.innerHTML = financeState.accountantQueries.map((query) => `<article class="finance-issue-item info"><div><span>${escapeHtml(query.query_uid)}</span><strong>${escapeHtml(query.status)}</strong></div><p>${escapeHtml(query.question)}</p>${query.answer ? `<p><strong>Answer:</strong> ${escapeHtml(query.answer)}</p>` : ''}<div class="finance-issue-meta"><span>${escapeHtml(query.raised_by_name || 'User')}</span><span>${financeFormatDate(query.raised_at)}</span></div><button type="button" class="text-btn" onclick="openFinanceQueryDialog(${Number(query.id)})">${query.answer ? 'Review' : 'Answer'}</button></article>`).join('');
}

function renderFinanceAssets() {
  const body = document.getElementById('financeAssetBody');
  if (!body) return;
  if (!financeState.assets.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state compact">No assets have been recorded.</div></td></tr>';
    return;
  }
  body.innerHTML = financeState.assets.map((asset) => `<tr><td><strong>${escapeHtml(asset.asset_number)}</strong><small class="finance-cell-note">${escapeHtml(asset.description)}</small></td><td>${financeFormatDate(asset.purchase_date)}<small class="finance-cell-note">${escapeHtml(asset.supplier_name || '')}</small></td><td><strong>${formatMoney(asset.purchase_cost || 0)}</strong><small class="finance-cell-note">GST ${formatMoney(asset.gst_amount || 0)}</small></td><td>${escapeHtml(asset.location || '-')}</td><td><span class="finance-status-pill" data-status="${escapeHtml(String(asset.accounting_status || '').toLowerCase())}">${escapeHtml(String(asset.accounting_status || '').replaceAll('_', ' '))}</span></td><td><button type="button" class="secondary-btn" onclick="openFinanceAssetDialog(${Number(asset.id)})">Edit</button></td></tr>`).join('');
  enhanceResponsiveTables();
}

async function loadFinanceControlData() {
  if (!financeState.selectedYearId) return;
  try {
    const [periods, queries, assets] = await Promise.all([
      financeApi(`/accounting-periods?financial_year_id=${financeState.selectedYearId}`),
      financeApi(`/accountant-queries?financial_year_id=${financeState.selectedYearId}`),
      financeApi('/assets')
    ]);
    financeState.periods = periods.accounting_periods || [];
    financeState.accountantQueries = queries.queries || [];
    financeState.assets = assets.assets || [];
    renderFinancePeriods(); renderFinanceQueries(); renderFinanceAssets();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinancePeriodDialog(id) {
  const period = financeState.periods.find((entry) => Number(entry.id) === Number(id));
  if (!period) return;
  showDialog('Accounting Period Control', `<div class="finance-confirm-panel" data-finance-period-id="${Number(id)}"><span class="panel-kicker">${escapeHtml(period.period_key)}</span><h4>${financeFormatDate(period.start_date)} to ${financeFormatDate(period.end_date)}</h4><label><span>New status</span><select id="financePeriodStatus"><option>OPEN</option><option>REVIEWING</option><option>READY</option><option>LOCKED</option></select></label><label><span>Reason</span><textarea id="financePeriodReason" rows="3"></textarea></label><label><span>Lock confirmation</span><input id="financePeriodConfirmation" placeholder="Type LOCK ${escapeHtml(period.period_key)} when locking"></label></div>`, saveFinancePeriodStatus, 'Update Period');
  document.getElementById('financePeriodStatus').value = period.status || 'OPEN';
}

async function saveFinancePeriodStatus() {
  const id = Number(document.querySelector('[data-finance-period-id]')?.dataset.financePeriodId || 0);
  try {
    const data = await financeApi(`/accounting-periods/${id}/status`, { method: 'POST', body: JSON.stringify({ status: document.getElementById('financePeriodStatus')?.value, reason: document.getElementById('financePeriodReason')?.value, confirmation: document.getElementById('financePeriodConfirmation')?.value }) });
    hideDialog(); showToast(data.message || 'Accounting period updated successfully.'); await loadFinanceControlData();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceQueryDialog(id = 0) {
  const query = financeState.accountantQueries.find((entry) => Number(entry.id) === Number(id)) || {};
  showDialog(id ? 'Accountant Query' : 'New Accountant Query', `<div class="finance-confirm-panel" data-finance-query-id="${Number(id || 0)}">${id ? `<p><strong>Question:</strong> ${escapeHtml(query.question || '')}</p><label><span>Answer</span><textarea id="financeQueryAnswer" rows="4">${escapeHtml(query.answer || '')}</textarea></label><label><span>Status</span><select id="financeQueryStatus"><option>QUESTION</option><option>ANSWERED</option><option>RESOLVED</option></select></label>` : `<label><span>Question *</span><textarea id="financeQueryQuestion" rows="4" placeholder="Record the accounting treatment or evidence question"></textarea></label>`}</div>`, id ? saveFinanceQueryUpdate : saveFinanceQuery, id ? 'Save Response' : 'Create Query');
  if (id) document.getElementById('financeQueryStatus').value = query.status || 'QUESTION';
}

async function saveFinanceQuery() {
  try {
    const data = await financeApi('/accountant-queries', { method: 'POST', body: JSON.stringify({ financial_year_id: financeState.selectedYearId, question: document.getElementById('financeQueryQuestion')?.value }) });
    hideDialog(); showToast(data.message || 'Accountant query created.'); await loadFinanceControlData();
  } catch (error) { showToast(financeErrorText(error)); }
}

async function saveFinanceQueryUpdate() {
  const id = Number(document.querySelector('[data-finance-query-id]')?.dataset.financeQueryId || 0);
  try {
    const data = await financeApi(`/accountant-queries/${id}`, { method: 'POST', body: JSON.stringify({ answer: document.getElementById('financeQueryAnswer')?.value, status: document.getElementById('financeQueryStatus')?.value }) });
    hideDialog(); showToast(data.message || 'Accountant query updated.'); await loadFinanceControlData();
  } catch (error) { showToast(financeErrorText(error)); }
}

async function openFinanceAssetDialog(id = 0) {
  try {
    if (!supplierCache.length) await loadSuppliers();
    const asset = financeState.assets.find((entry) => Number(entry.id) === Number(id)) || {};
    showDialog(id ? 'Edit Asset' : 'Add Asset', `<div class="finance-dialog-layout compact" data-finance-asset-id="${Number(id || 0)}"><section class="dialog-card"><div class="finance-form-grid two-col"><label><span>Asset number *</span><input id="financeAssetNumber" value="${escapeHtml(asset.asset_number || '')}"></label><label><span>Description *</span><input id="financeAssetDescription" value="${escapeHtml(asset.description || '')}"></label><label><span>Category</span><input id="financeAssetCategory" value="${escapeHtml(asset.category || '')}"></label><label><span>Purchase date</span><input id="financeAssetDate" type="date" value="${escapeHtml(String(asset.purchase_date || '').slice(0, 10))}"></label><label><span>Supplier</span><select id="financeAssetSupplier"><option value="">Not linked</option>${financeSupplierOptions(asset.supplier_id)}</select></label><label><span>Purchase cost *</span><input id="financeAssetCost" inputmode="decimal" value="${escapeHtml(asset.purchase_cost || '0.00')}"></label><label><span>GST amount</span><input id="financeAssetGst" inputmode="decimal" value="${escapeHtml(asset.gst_amount || '0.00')}"></label><label><span>Net cost *</span><input id="financeAssetNet" inputmode="decimal" value="${escapeHtml(asset.net_cost || '0.00')}"></label><label><span>Serial number</span><input id="financeAssetSerial" value="${escapeHtml(asset.serial_number || '')}"></label><label><span>Location</span><input id="financeAssetLocation" value="${escapeHtml(asset.location || '')}"></label><label><span>Accounting status</span><select id="financeAssetStatus"><option>REVIEW_REQUIRED</option><option>CONFIRMED</option><option>DISPOSED</option></select></label><label><span>Useful life (months)</span><input id="financeAssetLife" inputmode="numeric" value="${escapeHtml(asset.useful_life_months || '')}"></label></div></section></div>`, saveFinanceAsset, id ? 'Update Asset' : 'Save Asset');
    document.getElementById('financeAssetStatus').value = asset.accounting_status || 'REVIEW_REQUIRED';
    document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
  } catch (error) { showToast(financeErrorText(error)); }
}

async function saveFinanceAsset() {
  const payload = { id: Number(document.querySelector('[data-finance-asset-id]')?.dataset.financeAssetId || 0) || undefined, asset_number: document.getElementById('financeAssetNumber')?.value, description: document.getElementById('financeAssetDescription')?.value, category: document.getElementById('financeAssetCategory')?.value, purchase_date: document.getElementById('financeAssetDate')?.value, supplier_id: document.getElementById('financeAssetSupplier')?.value || null, purchase_cost: document.getElementById('financeAssetCost')?.value, gst_amount: document.getElementById('financeAssetGst')?.value, net_cost: document.getElementById('financeAssetNet')?.value, serial_number: document.getElementById('financeAssetSerial')?.value, location: document.getElementById('financeAssetLocation')?.value, accounting_status: document.getElementById('financeAssetStatus')?.value, useful_life_months: document.getElementById('financeAssetLife')?.value };
  try {
    const data = await financeApi('/assets', { method: 'POST', body: JSON.stringify(payload) });
    hideDialog(); showToast(data.message || 'Asset saved successfully.'); await loadFinanceControlData();
  } catch (error) { showToast(financeErrorText(error)); }
}

async function selectFinanceYear(value) {
  financeState.selectedYearId = Number(value || 0);
  financeState.transactionPage = 1;
  financeState.issueFilter = '';
  await loadFinanceWorkspace();
}

function financeAccountOptions(selectedId = '') {
  return (financeState.setup?.accounts || []).filter((account) => Number(account.active) === 1).map((account) => `
    <option value="${Number(account.id)}" ${String(account.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(account.account_code)} | ${escapeHtml(account.account_name)}</option>
  `).join('');
}

function financeTaxOptions(selectedCode = '') {
  return (financeState.setup?.tax_codes || []).filter((code) => Number(code.active) === 1).map((code) => `
    <option value="${escapeHtml(code.code)}" ${code.code === selectedCode ? 'selected' : ''}>${escapeHtml(code.code.replaceAll('_', ' '))}</option>
  `).join('');
}

function financeMoneyCents(value) {
  const raw = String(value ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');
  const cents = (Number(whole) * 100) + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

function financeAmountFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function calculateFinanceGstFromGross() {
  const grossInput = document.getElementById('financeTxnGross');
  const netInput = document.getElementById('financeTxnNet');
  const gstInput = document.getElementById('financeTxnGst');
  const taxInput = document.getElementById('financeTxnTax');
  const gross = financeMoneyCents(grossInput?.value);
  if (gross === null || gross < 0 || !netInput || !gstInput) return;
  const taxCode = taxInput?.value || '';
  const taxable = ['GST_ON_INCOME', 'GST_ON_EXPENSES'].includes(taxCode);
  const rate = Number(financeState.setup?.settings?.default_gst_rate || 10);
  const gst = taxable ? Math.round(gross * rate / (100 + rate)) : 0;
  netInput.value = financeAmountFromCents(gross - gst);
  gstInput.value = financeAmountFromCents(gst);
  renderFinanceEntryCompleteness();
}

function renderFinanceEntryCompleteness() {
  const panel = document.getElementById('financeEntryCompleteness');
  if (!panel) return;
  const net = financeMoneyCents(document.getElementById('financeTxnNet')?.value);
  const gst = financeMoneyCents(document.getElementById('financeTxnGst')?.value);
  const gross = financeMoneyCents(document.getElementById('financeTxnGross')?.value);
  const checks = [
    ['Date', Boolean(document.getElementById('financeTxnDate')?.value)],
    ['Description', Boolean(document.getElementById('financeTxnDescription')?.value?.trim())],
    ['Debit account', Boolean(document.getElementById('financeTxnDebit')?.value)],
    ['Credit account', Boolean(document.getElementById('financeTxnCredit')?.value)],
    ['GST treatment', Boolean(document.getElementById('financeTxnTax')?.value)],
    ['Amount equation', net !== null && gst !== null && gross !== null && net + gst === gross]
  ];
  const ready = checks.every((check) => check[1]);
  panel.innerHTML = `<strong>${ready ? 'Ready for validation' : 'Draft incomplete'}</strong>${checks.map((check) => `<span class="${check[1] ? 'ok' : 'missing'}">${check[1] ? '&#10003;' : '&#215;'} ${escapeHtml(check[0])}</span>`).join('')}`;
}

async function openFinanceTransactionDialog(id = 0) {
  if (!financeState.setup) {
    try { financeState.setup = await financeApi('/setup'); } catch (error) { showToast(financeErrorText(error)); return; }
  }
  let row = null;
  if (id) {
    try {
      row = financeState.transactionRows.find((item) => Number(item.id) === Number(id)) || null;
      if (!row) {
        const data = await financeApi(`/transactions/${Number(id)}`);
        row = data.transaction || null;
      }
      if (!row) throw new Error('Finance transaction was not found.');
    } catch (error) { showToast(financeErrorText(error)); return; }
  }
  const today = new Date().toISOString().slice(0, 10);
  const body = `
    <div class="finance-dialog-layout" data-finance-transaction-id="${Number(row?.id || 0)}">
      <section class="dialog-card">
        <h4>Transaction identity</h4>
        <div class="finance-form-grid two-col">
          <label><span>Effective date *</span><input id="financeTxnDate" type="date" value="${escapeHtml(String(row?.effective_date || today).slice(0, 10))}" oninput="renderFinanceEntryCompleteness()"></label>
          <label><span>Type *</span><select id="financeTxnType" onchange="renderFinanceEntryCompleteness()">${FINANCE_TRANSACTION_TYPES.map((type) => `<option value="${type}" ${type === row?.transaction_type ? 'selected' : ''}>${type.replaceAll('_', ' ')}</option>`).join('')}</select></label>
          <label><span>Reference</span><input id="financeTxnReference" value="${escapeHtml(row?.reference || '')}" placeholder="Bank, invoice or bill reference"></label>
          <label><span>Customer / supplier</span><input id="financeTxnParty" value="${escapeHtml(row?.party_name || '')}" placeholder="Party name"></label>
          <label class="full"><span>Description *</span><input id="financeTxnDescription" value="${escapeHtml(row?.description || '')}" placeholder="Business purpose and transaction detail" oninput="renderFinanceEntryCompleteness()"></label>
          <label><span>Category</span><input id="financeTxnCategory" value="${escapeHtml(row?.category || '')}" placeholder="Reporting category"></label>
          <label><span>Job / project</span><input id="financeTxnJob" value="${escapeHtml(row?.job_reference || '')}" placeholder="Optional job reference"></label>
        </div>
      </section>
      <section class="dialog-card">
        <h4>Accounting allocation</h4>
        <div class="finance-form-grid two-col">
          <label><span>Debit account *</span><select id="financeTxnDebit" onchange="renderFinanceEntryCompleteness()"><option value="">Select debit account</option>${financeAccountOptions(row?.debit_account_id)}</select></label>
          <label><span>Credit account *</span><select id="financeTxnCredit" onchange="renderFinanceEntryCompleteness()"><option value="">Select credit account</option>${financeAccountOptions(row?.credit_account_id)}</select></label>
          <label><span>GST treatment *</span><select id="financeTxnTax" onchange="calculateFinanceGstFromGross()"><option value="">Select GST treatment</option>${financeTaxOptions(row?.tax_code)}</select></label>
          <label><span>Payment method</span><input id="financeTxnPaymentMethod" value="${escapeHtml(row?.payment_method || '')}" placeholder="Bank, card, cash or account"></label>
        </div>
        <div class="finance-amount-grid">
          <label><span>Net amount *</span><input id="financeTxnNet" inputmode="decimal" value="${escapeHtml(row?.net_amount || '0.00')}" oninput="renderFinanceEntryCompleteness()"></label>
          <label><span>GST amount *</span><input id="financeTxnGst" inputmode="decimal" value="${escapeHtml(row?.gst_amount || '0.00')}" oninput="renderFinanceEntryCompleteness()"></label>
          <label><span>Gross amount *</span><input id="financeTxnGross" inputmode="decimal" value="${escapeHtml(row?.gross_amount || '0.00')}" oninput="renderFinanceEntryCompleteness()"></label>
          <button type="button" class="secondary-btn" onclick="calculateFinanceGstFromGross()">Calculate GST</button>
        </div>
        <label><span>Notes</span><textarea id="financeTxnNotes" rows="3" placeholder="Approval, evidence or review notes">${escapeHtml(row?.notes || '')}</textarea></label>
      </section>
      <aside id="financeEntryCompleteness" class="finance-entry-completeness"></aside>
      <button type="button" class="secondary-btn finance-ready-action" onclick="saveFinanceTransaction('READY')">Validate & Mark Ready</button>
    </div>`;
  showDialog(row ? 'Edit Finance Transaction' : 'Add Finance Transaction', body, () => saveFinanceTransaction('DRAFT'), 'Save Draft');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
  renderFinanceEntryCompleteness();
}

function collectFinanceTransaction(status) {
  const wrapper = document.querySelector('[data-finance-transaction-id]');
  return {
    id: Number(wrapper?.dataset.financeTransactionId || 0) || undefined,
    effective_date: document.getElementById('financeTxnDate')?.value,
    type: document.getElementById('financeTxnType')?.value,
    reference: document.getElementById('financeTxnReference')?.value?.trim(),
    party_name: document.getElementById('financeTxnParty')?.value?.trim(),
    description: document.getElementById('financeTxnDescription')?.value?.trim(),
    category: document.getElementById('financeTxnCategory')?.value?.trim(),
    job_reference: document.getElementById('financeTxnJob')?.value?.trim(),
    debit_account_id: Number(document.getElementById('financeTxnDebit')?.value || 0) || null,
    credit_account_id: Number(document.getElementById('financeTxnCredit')?.value || 0) || null,
    tax_code: document.getElementById('financeTxnTax')?.value,
    payment_method: document.getElementById('financeTxnPaymentMethod')?.value?.trim(),
    net_amount: document.getElementById('financeTxnNet')?.value,
    gst_amount: document.getElementById('financeTxnGst')?.value,
    gross_amount: document.getElementById('financeTxnGross')?.value,
    notes: document.getElementById('financeTxnNotes')?.value?.trim(),
    document_count: 0,
    status
  };
}

async function saveFinanceTransaction(status = 'DRAFT') {
  const primary = document.getElementById('dialogPrimaryBtn');
  if (primary) primary.disabled = true;
  try {
    const data = await financeApi('/transactions', { method: 'POST', body: JSON.stringify(collectFinanceTransaction(status)) });
    hideDialog();
    showToast(data.message || 'Finance transaction saved successfully.');
    await loadFinanceWorkspace();
  } catch (error) {
    const issues = (error.issues || []).map((issue) => `<li><strong>${escapeHtml(issue.severity || 'ERROR')}</strong> ${escapeHtml(issue.message || '')}</li>`).join('');
    const panel = document.getElementById('financeEntryCompleteness');
    if (panel) panel.innerHTML = `<strong>${escapeHtml(error.message || 'Cannot continue')}</strong>${issues ? `<ul>${issues}</ul>` : ''}`;
    showToast(financeErrorText(error));
  } finally {
    if (primary) primary.disabled = false;
  }
}

function confirmPostFinanceTransaction(id, uid) {
  showDialog('Post Finance Transaction', `
    <div class="finance-confirm-panel"><span class="panel-kicker">Controlled Posting</span><h4>${escapeHtml(uid || `Transaction ${id}`)}</h4><p>Posting creates an official balanced journal. The transaction can no longer be edited directly after posting.</p><p>Confirm that the accounts, GST treatment and evidence have been reviewed.</p></div>
  `, () => postFinanceTransaction(id), 'Post Transaction');
}

async function postFinanceTransaction(id) {
  try {
    const data = await financeApi(`/transactions/${Number(id)}/post`, { method: 'POST', body: '{}' });
    hideDialog();
    showToast(data.message || 'Finance transaction posted successfully.');
    await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceVoidDialog(id, uid) {
  showDialog('Void Posted Transaction', `
    <div class="finance-confirm-panel">
      <span class="panel-kicker">Controlled Reversal</span>
      <h4>${escapeHtml(uid || `Transaction ${id}`)}</h4>
      <p>The original record will be preserved and a balanced reversal journal will be posted. This action is audit logged.</p>
      <label><span>Void reason *</span><textarea id="financeVoidReason" rows="4" placeholder="Explain the correction and supporting evidence"></textarea></label>
    </div>
  `, () => voidFinanceTransaction(id), 'Post Reversal');
}

async function voidFinanceTransaction(id) {
  const reason = document.getElementById('financeVoidReason')?.value?.trim();
  if (!reason) return showToast('Enter a reason before voiding this transaction.');
  try {
    const data = await financeApi(`/transactions/${Number(id)}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    hideDialog();
    showToast(data.message || 'Transaction voided with a controlled reversal.');
    await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceIssueDialog(id) {
  const issue = financeState.issues.find((item) => Number(item.id) === Number(id));
  if (!issue) return;
  const canIgnore = issue.severity !== 'BLOCKING_ERROR';
  showDialog('Review Finance Issue', `
    <div class="finance-confirm-panel">
      <span class="finance-status-pill" data-status="${escapeHtml(String(issue.severity || '').toLowerCase())}">${escapeHtml(String(issue.severity || '').replaceAll('_', ' '))}</span>
      <h4>${escapeHtml(issue.title || 'Finance issue')}</h4><p>${escapeHtml(issue.message || '')}</p>
      <label><span>Resolution / review note *</span><textarea id="financeIssueReason" rows="4" placeholder="Describe the check performed and evidence reviewed"></textarea></label>
      <div class="card-actions"><button type="button" class="secondary-btn" onclick="updateFinanceIssue(${Number(id)}, 'IN_PROGRESS')">Mark In Progress</button>${canIgnore ? `<button type="button" class="secondary-btn" onclick="updateFinanceIssue(${Number(id)}, 'IGNORED')">Ignore With Reason</button>` : ''}</div>
    </div>
  `, () => updateFinanceIssue(id, 'RESOLVED'), 'Resolve Issue');
}

async function updateFinanceIssue(id, status) {
  const reason = document.getElementById('financeIssueReason')?.value?.trim() || (status === 'IN_PROGRESS' ? 'Review started.' : '');
  if (['RESOLVED', 'IGNORED'].includes(status) && !reason) { showToast('Enter a review reason before continuing.'); return; }
  try {
    const data = await financeApi(`/issues/${Number(id)}`, { method: 'POST', body: JSON.stringify({ status, reason }) });
    hideDialog();
    showToast(data.message || 'Finance issue updated successfully.');
    await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

async function runFinanceHealthCheck() {
  if (!financeState.selectedYearId) return;
  try {
    showToast('Finance health check is running.');
    const data = await financeApi(`/financial-years/${financeState.selectedYearId}/check`, { method: 'POST', body: '{}' });
    showToast(data.message || 'Financial-year health check completed successfully.');
    await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceSetupDialog() {
  const settings = financeState.setup?.settings || {};
  const gstValue = settings.gst_registered === null || settings.gst_registered === undefined ? '' : String(Number(settings.gst_registered));
  showDialog('Finance Setup', `
    <div class="finance-dialog-layout compact">
      <section class="dialog-card"><h4>Company finance settings</h4><p class="muted-text">Confirm these settings with your accountant. The app will not infer GST registration or entity treatment.</p>
        <div class="finance-form-grid two-col">
          <label><span>Default currency</span><input id="financeSetupCurrency" maxlength="3" value="${escapeHtml(settings.default_currency || 'AUD')}"></label>
          <label><span>GST registered *</span><select id="financeSetupGst"><option value="" ${gstValue === '' ? 'selected' : ''}>Not confirmed</option><option value="1" ${gstValue === '1' ? 'selected' : ''}>Yes</option><option value="0" ${gstValue === '0' ? 'selected' : ''}>No</option></select></label>
          <label><span>Default GST rate %</span><input id="financeSetupRate" inputmode="decimal" value="${escapeHtml(settings.default_gst_rate || '10.00')}"></label>
          <label><span>Amounts include GST</span><select id="financeSetupInclusive"><option value="1" ${Number(settings.amounts_include_gst) ? 'selected' : ''}>Yes</option><option value="0" ${!Number(settings.amounts_include_gst) ? 'selected' : ''}>No</option></select></label>
          <label><span>Receipt required above</span><input id="financeSetupReceipt" inputmode="decimal" value="${escapeHtml(settings.receipt_required_above ?? '')}" placeholder="Optional threshold"></label>
          <label><span>Accountant email</span><input id="financeSetupAccountant" type="email" value="${escapeHtml(settings.accountant_email || '')}"></label>
          <label class="full"><span>Entity type</span><input id="financeSetupEntity" value="${escapeHtml(settings.entity_type || '')}" placeholder="Confirm with accountant"></label>
        </div>
      </section>
    </div>
  `, saveFinanceSetup, 'Save for Review');
  document.querySelector('.dialog-panel')?.classList.add('wide-dialog', 'finance-dialog');
}

async function saveFinanceSetup() {
  const gstRaw = document.getElementById('financeSetupGst')?.value;
  const payload = {
    default_currency: document.getElementById('financeSetupCurrency')?.value,
    gst_registered: gstRaw === '' ? null : gstRaw === '1',
    default_gst_rate: document.getElementById('financeSetupRate')?.value,
    amounts_include_gst: document.getElementById('financeSetupInclusive')?.value === '1',
    receipt_required_above: document.getElementById('financeSetupReceipt')?.value,
    accountant_email: document.getElementById('financeSetupAccountant')?.value,
    entity_type: document.getElementById('financeSetupEntity')?.value
  };
  try {
    const data = await financeApi('/setup', { method: 'POST', body: JSON.stringify(payload) });
    financeState.setup = null;
    hideDialog();
    showToast(data.message || 'Finance setup saved successfully.');
    await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

function openFinanceYearDialog() {
  const year = financeSelectedYear();
  if (!year) return;
  showDialog('Financial Year Control', `
    <div class="finance-confirm-panel">
      <span class="panel-kicker">${escapeHtml(year.label)}</span><h4>${financeFormatDate(year.start_date)} to ${financeFormatDate(year.end_date)}</h4>
      <p>Run the health check before changing status. Locking is blocked while critical issues remain and preserves an audit trail.</p>
      <label><span>New status</span><select id="financeYearNewStatus"><option>OPEN</option><option>REVIEWING</option><option>READY_TO_CLOSE</option><option>LOCKED</option><option>ARCHIVED</option></select></label>
      <label><span>Reason</span><textarea id="financeYearReason" rows="3" placeholder="Required for locking or unlocking"></textarea></label>
      <label><span>Lock confirmation</span><input id="financeYearConfirmation" placeholder="Type LOCK ${escapeHtml(year.label)} when locking"></label>
    </div>
  `, saveFinanceYearStatus, 'Update Status');
  document.getElementById('financeYearNewStatus').value = year.status || 'OPEN';
}

async function saveFinanceYearStatus() {
  const year = financeSelectedYear();
  if (!year) return;
  const payload = {
    status: document.getElementById('financeYearNewStatus')?.value,
    reason: document.getElementById('financeYearReason')?.value?.trim(),
    confirmation: document.getElementById('financeYearConfirmation')?.value?.trim()
  };
  try {
    const data = await financeApi(`/financial-years/${year.id}/status`, { method: 'POST', body: JSON.stringify(payload) });
    hideDialog();
    financeState.years = [];
    showToast(data.message || 'Financial-year status updated successfully.');
    await loadFinanceWorkspace();
  } catch (error) { showToast(financeErrorText(error)); }
}

async function downloadFinanceExport(kind) {
  if (!financeState.selectedYearId) return;
  try {
    const response = await fetch(`/api/finance/exports/${encodeURIComponent(kind)}?financial_year_id=${encodeURIComponent(financeState.selectedYearId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const data = await safeJson(response);
      throw new Error(data.message || 'Finance export failed.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `Voxel-Veda-${financeSelectedYear()?.label || 'Finance'}-${kind}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Finance export downloaded successfully.');
  } catch (error) { showToast(error.message || 'Finance export failed.'); }
}

async function bootAdminDashboard() {
  try {
    installAccessDeniedHandler();
    installMobileShellControls();
    normalizeActionButtons();
    setupNavigation();
    startResponsiveTableObserver();

    const user = await loadMe();
    if (!user || redirectingToLogin) return;

    openAdminViewFromUrl();

    if (!['admin', 'super_admin'].includes(currentRole)) {
      await loadRestrictedWorkspaceData();
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
      loadFinanceWorkspace(),
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
