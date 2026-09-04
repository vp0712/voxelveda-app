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
        <span>${escape