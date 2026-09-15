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

function renderAdminPage(req, res) {
  const rendered = injectFinanceIntelligence(source());
  res.type('html');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(rendered);
}

module.exports = { injectFinanceIntelligence, renderAdminPage };
