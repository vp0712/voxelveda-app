'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hasAnyPermission } = require('./authorizationService');
const { injectGlobalBrand } = require('./globalBrandRenderer');
const sectionAccess = {
  erpSection:['VIEW_DASHBOARD'], dashboardSection:['VIEW_DASHBOARD'], rfqSection:['VIEW_RFQS'], invoiceSection:['VIEW_FINANCE'], customerSection:['VIEW_CUSTOMERS'], supplierSection:['VIEW_SUPPLIERS'], procurementSection:['VIEW_PROCUREMENT'], competitorSection:['VIEW_CUSTOMERS'], stockSection:['VIEW_INVENTORY'], stockUsageSection:['VIEW_INVENTORY'], rawMaterialSection:['VIEW_INVENTORY'], packagingSection:['VIEW_INVENTORY'], meetingSection:['VIEW_MEETINGS'], financeSection:['VIEW_FINANCE'], expenseSection:['VIEW_FINANCE'], taskSection:['VIEW_OWN_JOBS','MANAGE_JOBS','MANAGE_TEAM_JOBS'], attendanceSection:['VIEW_ATTENDANCE'], rosterSection:['VIEW_ATTENDANCE'], staffSection:['VIEW_STAFF_HR'], complianceSection:['VIEW_COMPLIANCE','VIEW_QMS'], companyFormsSection:['VIEW_COMPLIANCE','MANAGE_USERS'], approvalsSection:['VIEW_APPROVALS'], trashSection:['VIEW_TRASH'], securitySection:['MANAGE_SECURITY'], settingsSection:['MANAGE_USERS']
};
const views = { erpSection:'erp', dashboardSection:'dashboard', rfqSection:'rfqs', invoiceSection:'invoices', customerSection:'customers', supplierSection:'suppliers', procurementSection:'procurement', competitorSection:'competitors', stockSection:'stock', stockUsageSection:'stock-out', rawMaterialSection:'raw-material', packagingSection:'packaging', meetingSection:'meetings', financeSection:'finance', expenseSection:'expenses', taskSection:'tasks', attendanceSection:'timesheets', rosterSection:'roster', staffSection:'staff', complianceSection:'compliance', companyFormsSection:'forms', approvalsSection:'approvals', trashSection:'trash', securitySection:'security', settingsSection:'settings' };
const escape = text => String(text || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function sharedSidebar(user, template) {
  const match = template.match(/<aside id="primarySidebar"[\s\S]*?<\/aside>/);
  if (!match) throw new Error('Primary app navigation is missing');
  let aside = match[0].replace(/<button([^>]*)>([\s\S]*?)<\/button>/g, (whole, attrs, label) => {
    if (/sidebar-close/.test(attrs)) return whole;
    if (/logout-btn/.test(attrs)) return '<button class="logout-btn" type="button" data-workspace-logout>Logout</button>';
    const section = attrs.match(/data-section="([^"]+)"/)?.[1];
    const permission = attrs.match(/data-permission="([^"]+)"/)?.[1];
    const finance = /app-banking-nav/.test(attrs);
    if (!hasAnyPermission(user, finance ? ['VIEW_FINANCE','VIEW_BANKING'] : sectionAccess[section] || [permission])) return '';
    let href = finance ? '/finance-intelligence#overview' : '/admin?view=' + (views[section] || 'erp');
    if (/attendance-terminal/.test(attrs)) href = '/attendance-terminal';
    const focus = attrs.match(/data-erp-focus="([^"]+)"/)?.[1];
    if (focus && focus !== 'home') href = '/admin?view=' + (focus === 'supply' ? 'supply-chain' : focus);
    const clean = attrs.replace(/\s(?:onclick|type)="[^"]*"/g,'').replace(/\bhidden-section\b/g,'').replace(/\bactive\b/g,'');
    return `<a${clean} href="${href}"${finance ? ' aria-current="page"' : ''}>${label}</a>`;
  });
  aside = aside.replace(/Finance OS/g,'Finance').replace(/data-title="Finance" data-section="financeSection">Finance/g,'data-title="Accounting" data-section="financeSection">Accounting');
  return aside;
}
function renderFinancePage(req, res) {
  return res.type('html').set('Cache-Control','private, no-store').send(renderFinanceDocument(req));
}
function renderFinanceDocument(req, document = null) {
  const dir = path.join(__dirname,'..','public');
  const template = fs.readFileSync(path.join(dir,'admin-dashboard.html'),'utf8');
  let html = document || fs.readFileSync(path.join(dir,'finance-intelligence.html'),'utf8');
  const header = `<header class="topbar vv-topbar"><button class="topbar-menu-btn" type="button" aria-label="Open menu" aria-controls="primarySidebar" aria-expanded="false" data-mobile-menu-action="toggle"><span></span><span></span><span></span></button><div class="topbar-title"><span class="topbar-kicker">Voxel Veda Workspace</span><h2>Finance</h2><p>${escape(req.user?.username || req.user?.name || req.user?.email)} · ${escape(req.user?.role)}</p></div><div class="topbar-actions"><a class="secondary-btn" href="/dashboard">Main dashboard</a><a class="secondary-btn" href="/admin?view=expenses">Expenses & Payables</a></div></header>`;
  html = html.replace('<!-- SHARED_WORKSPACE_NAV -->', '<div class="mobile-sidebar-backdrop" data-mobile-menu-action="close" aria-hidden="true"></div>'+sharedSidebar(req.user,template));
  html = html.replace('<!-- SHARED_WORKSPACE_HEADER -->',header);
  return injectGlobalBrand(html);
}
module.exports = { renderFinancePage, renderFinanceDocument, sharedSidebar, sectionAccess };
