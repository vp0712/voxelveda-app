const fs = require('node:fs');
const path = require('node:path');

const adminPagePath = path.join(__dirname, '..', 'public', 'admin-dashboard.html');
let cachedSource = null;

function source() {
  if (!cachedSource || process.env.NODE_ENV !== 'production') {
    cachedSource = fs.readFileSync(adminPagePath, 'utf8');
  }
  return cachedSource;
}

function injectFinanceIntelligence(html) {
  const financeNavNeedle = '<button class="nav-btn" data-icon="FN" data-title="Finance" data-section="financeSection">Finance</button>\n        <button class="nav-btn" data-icon="$" data-title="Expenses" data-section="expenseSection">Expenses</button>';
  const financeNavReplacement = '<button class="nav-btn" data-icon="FN" data-title="Finance" data-section="financeSection">Finance</button>\n        <button class="nav-btn" data-icon="AI" data-title="Finance Intelligence" type="button" onclick="openSystemPage(\'/finance-intelligence\')">Finance Intelligence</button>\n        <button class="nav-btn" data-icon="$" data-title="Expenses" data-section="expenseSection">Expenses</button>';

  const bankingNeedle = '<div class="finance-tab-panel" data-finance-panel="banking">\n          <div class="finance-banking-layout">';
  const bankingReplacement = `<div class="finance-tab-panel" data-finance-panel="banking">
          <section class="finance-intelligence-launch card" style="margin-bottom:16px">
            <div class="section-head compact-head">
              <div>
                <span class="panel-kicker">Finance Intelligence</span>
                <h3>Personal + Business Banking Command Center</h3>
                <p>Import statements, separate personal and Voxel Veda spending, review duplicates, identify transfers and recurring costs, and understand where money is going.</p>
              </div>
              <button type="button" class="primary-btn" onclick="openSystemPage('/finance-intelligence')">Open Finance Intelligence</button>
            </div>
            <div class="dashboard-action-row" style="margin-top:12px">
              <button class="quick-pill command-pill" type="button" onclick="openSystemPage('/finance-intelligence?action=import')"><span>01</span>Import Statement</button>
              <button class="quick-pill command-pill" type="button" onclick="openSystemPage('/finance-intelligence?action=accounts')"><span>02</span>Accounts</button>
              <button class="quick-pill command-pill" type="button" onclick="openSystemPage('/finance-intelligence?action=review')"><span>03</span>Review Queue</button>
              <button class="quick-pill command-pill" type="button" onclick="openSystemPage('/finance-intelligence?action=insights')"><span>04</span>Money Insights</button>
            </div>
          </section>
          <div class="finance-banking-layout">`;

  let rendered = html;
  if (!rendered.includes('data-title="Finance Intelligence"')) {
    rendered = rendered.replace(financeNavNeedle, financeNavReplacement);
  }
  if (!rendered.includes('class="finance-intelligence-launch')) {
    rendered = rendered.replace(bankingNeedle, bankingReplacement);
  }
  return rendered;
}

function injectRecoveryAssurance(html) {
  const metricNeedle = '        <div class="metric-grid security-metric-grid">';
  const recoveryPanel = `        <section id="recoveryAssurancePanel" class="card recovery-assurance" aria-live="polite">
          <div class="recovery-assurance-head">
            <div>
              <span class="eyebrow">Disaster Recovery</span>
              <h3>Backup & Restore Assurance</h3>
              <p>Evidence-based recovery status. A configured switch alone is never treated as proof of a usable backup.</p>
            </div>
            <div class="recovery-assurance-actions">
              <span id="recoveryAssuranceState" class="recovery-state is-loading">CHECKING</span>
              <button type="button" class="secondary-btn" id="refreshRecoveryAssurance">Refresh Recovery Check</button>
            </div>
          </div>
          <div class="recovery-assurance-summary">
            <strong id="recoveryAssuranceHeadline">Checking recovery evidence…</strong>
            <p id="recoveryAssuranceSummary">Loading provider, backup freshness and restore-drill evidence.</p>
          </div>
          <div class="recovery-assurance-metrics">
            <article><span>Backup freshness target</span><strong id="recoveryBackupTarget">≤ 26h</strong></article>
            <article><span>Restore drill target</span><strong id="recoveryRestoreTarget">≤ 90d</strong></article>
            <article><span>Fail-closed gate</span><strong id="recoveryMandatoryGate">OFF</strong></article>
            <article><span>Evidence provider</span><strong id="recoveryProviderStatus">UNVERIFIED</strong></article>
          </div>
          <div class="recovery-assurance-columns">
            <div>
              <h4>Automated evidence</h4>
              <div id="recoveryAssuranceChecks" class="recovery-check-list"><p class="status-note">Checking…</p></div>
            </div>
            <div>
              <h4>Required next actions</h4>
              <div id="recoveryAssuranceGuidance" class="recovery-check-list"><p class="status-note">Checking…</p></div>
            </div>
          </div>
          <p class="recovery-assurance-footnote">A restore must be tested in an isolated environment. This screen intentionally has no one-click production restore control.</p>
        </section>

`;
  let rendered = html;
  if (!rendered.includes('id="recoveryAssurancePanel"')) {
    rendered = rendered.replace(metricNeedle, `${recoveryPanel}${metricNeedle}`);
  }
  if (!rendered.includes('/recovery-assurance.css')) {
    rendered = rendered.replace('</head>', '<link rel="stylesheet" href="/recovery-assurance.css?v=20260917">\n</head>');
  }
  if (!rendered.includes('/recovery-assurance.js')) {
    rendered = rendered.replace('</body>', '<script src="/recovery-assurance.js?v=20260917"></script>\n</body>');
  }
  return rendered;
}

function renderAdminPage(req, res) {
  const rendered = injectRecoveryAssurance(injectFinanceIntelligence(source()));
  res.type('html');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(rendered);
}

module.exports = { injectFinanceIntelligence, injectRecoveryAssurance, renderAdminPage };
