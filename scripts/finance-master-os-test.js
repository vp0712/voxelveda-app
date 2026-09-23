'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('public/finance-intelligence.html');
const css=read('public/finance-master.css');
const js=read('public/finance-master.js');

assert.match(html,/finance-master\.css\?v=20260923-control-centre/,'Master finance stylesheet must be loaded.');
assert.match(html,/finance-master\.js\?v=20260924-counterparty-v1/,'Master finance client must be loaded with the current cache-busting release id.');
assert.match(html,/finance-bootstrap-guard\.js\?v=20260924-startup-hardening/,'Finance startup watchdog must load with the current release id.');
assert.doesNotMatch(html,/finance-bank-app-v5/,'Legacy V5 assets must not be referenced.');
assert.match(html,/FINANCE OPERATING SYSTEM/,'Finance OS shell is required.');
for(const name of ['Overview','My Money','Company Finance','Consolidated','Accounts','Transactions','Cash','Transfers','Refunds','Reimbursements','Customers & Suppliers','Borrow & Lend','Recurring','Statements','Budgets','Savings Goals','Advanced Control','Insights','Rules','Review Centre','Reconciliation','Reports','Notifications','Team Access','Banking Connections','Finance Settings','Close & Assurance']){
  assert(js.includes(name),`Navigation must contain ${name}`);
}
assert.match(js,/banking-dashboard/,'Finance OS must use real banking dashboard data.');
assert.match(js,/I\+'\/transactions'/,'Finance OS must use the real transaction explorer endpoint.');
assert.match(js,/I\+'\/statements'/,'Finance OS must use the real statement vault endpoint.');
assert.match(js,/bank-transactions\/'\+id\+'\/original/,'Transaction detail must surface immutable original bank data.');
assert.match(js,/I\+'\/transactions'/,'Manual transaction workflow must write to the canonical bank transaction ledger API.');
assert.match(js,/relationship-candidates\/transfers/,'Transfer review must use the canonical relationship candidate API.');
assert.match(js,/relationship-candidates\/refunds/,'Refund review must use the canonical relationship candidate API.');
assert.match(js,/receiptUploadForm/,'Transaction detail must expose the secure receipt workflow.');
assert.match(js,/Daily Finance Briefing/,'Personal workspace must expose the daily finance briefing.');
assert.match(js,/data-debt-pay/,'Borrow & Lend must expose repayment lifecycle actions.');
assert.match(js,/data-goal-contribute/,'Savings goals must expose contribution workflow.');
assert.match(js,/data-recurring-complete/,'Recurring money must expose completion workflow.');
assert.match(js,/saved-views/,'Transaction Explorer must expose owner-private saved views.');
assert.match(js,/\/api\/notifications/,'Finance OS must expose the notification centre.');
assert.match(js,/companySettingsForm/,'Finance Settings must expose editable company reporting settings.');
assert.match(js,/runFinanceCommand/,'Finance OS must expose command search actions.');
assert.match(css,/@media\(max-width:700px\)/,'Finance OS must have a dedicated mobile layout.');
assert.match(css,/fm-drawer/,'Transaction/account detail drawer must be styled.');
console.log('Finance Master OS regression contract passed.');

assert.match(html,/id="fmMobileNav"/,'Finance OS must provide a dedicated mobile navigation surface.');
assert.match(js,/const MOBILE_NAV=.*\['more','☰','More'\]/,'Mobile Finance navigation must include a More control.');
assert.match(js,/function moreView\(\)/,'Mobile More must expose the full Finance module launcher.');
assert.match(js,/No separate Banking V3\/V4\/V5 screens/,'Unified Finance OS must explicitly keep legacy banking screens out of the active launcher.');
assert.match(js,/financeCommandCentre\(\)/,'Overview must expose the Finance command centre.');

assert.match(js,/\['history','⇩','History Import'\]/,'Finance OS must expose a historical import centre.');
assert.match(js,/function openHistoricalImport\(/,'Historical import must support controlled multi-file staging.');
assert.match(js,/multiple required/,'Historical statement import must accept multiple files for the selected account.');
assert.match(js,/Nothing is committed automatically/,'Historical import must preserve explicit review before commit.');
for(const reportType of ['INCOME_VS_EXPENSE','ACCOUNT_ACTIVITY','ACCOUNT_STATEMENT','CASH','REIMBURSEMENT','GST_SUMMARY','RECONCILIATION','DATA_QUALITY','PERSONAL_MONTHLY_SUMMARY','COMPANY_MONTHLY_SUMMARY']){
  assert(js.includes(reportType),`Finance report catalogue must expose ${reportType}`);
}
assert.match(js,/fm-report-preset/,'Report Centre must expose one-click standard report presets.');

assert.match(js,/function openAccountForm\(/,'Finance OS must expose a real create/edit account workflow.');
assert.match(js,/I\+'\/accounts'/,'Account form must save through the canonical Finance account API.');
assert.match(js,/if\(kind==='account'\)\{openAccountForm\(\);return\}/,'Add Account must never open the transaction form.');
assert.match(js,/data-account-edit/,'Account workspace must provide account editing.');
assert.match(js,/data-personal-new="wallet"/,'Personal Money must expose wallet creation.');
assert.match(js,/personal-money\/wallets/,'Personal wallet form must save to the owner-isolated wallet API.');
assert.match(js,/fx_rate_to_wallet/,'Personal multi-currency cash entry must expose an explicit FX rate instead of inventing conversion.');

assert.match(js,/open-banking\/providers/,'Unified Finance OS must load Open Banking provider readiness.');
assert.match(js,/open-banking\/sessions/,'Unified Finance OS must load provider consent sessions.');
assert.match(js,/function startBankConsent\(/,'Finance OS must expose provider-controlled bank consent.');
assert.match(js,/Provider did not return a secure consent URL/,'Bank consent UI must reject non-HTTPS provider redirects.');
assert.match(js,/function syncBankConnection\(/,'Finance OS must expose connected-bank sync.');
assert.match(js,/function disconnectBankConnection\(/,'Finance OS must expose controlled bank disconnect while preserving history.');
assert.match(js,/never asks for or stores your bank password, PIN or OTP/,'Bank connection safety boundary must be visible.');

assert.match(js,/SPENDING & COST INTELLIGENCE/,'Finance OS must expose spending/cost intelligence.');
assert.match(js,/average_monthly_spend/,'Spending intelligence must expose evidence-backed monthly spend.');
assert.match(js,/recurring_monthly_estimate/,'Spending intelligence must surface recurring commitments.');
assert.match(js,/safe_to_spend_7d/,'Spending intelligence must surface short-horizon safe-to-spend evidence.');
assert.match(js,/data-merchant-filter/,'Top merchant spending must drill into the transaction ledger.');
assert.match(js,/does not label a legitimate expense as waste without evidence/,'Waste analysis must remain evidence-based rather than making unsupported judgments.');

assert.match(js,/personalBankDash:null,businessBankDash:null/,'Finance OS must maintain independent Personal and Company bank dashboards.');
assert.match(js,/banking-dashboard'\+scopeDashboardQuery\('PERSONAL'\)/,'Personal Banking dashboard must load independently of the top workspace selector.');
assert.match(js,/banking-dashboard'\+scopeDashboardQuery\('BUSINESS'\)/,'Company Banking dashboard must load independently of the top workspace selector.');
assert.match(js,/function scopedBankWorkspace\(/,'Finance OS must render real bank accounts and activity inside Personal and Company workspaces.');
assert.match(js,/Personal planning & cash/,'Personal planning wallets must be visibly separate from imported personal bank history.');
assert.match(js,/CONSOLIDATED — OWNERSHIP PRESERVED/,'Consolidated view must explicitly preserve Personal vs Company ownership.');
assert.match(js,/data-scope-view="PERSONAL"/,'Consolidated view must provide direct Personal-ledger navigation.');
assert.match(js,/data-scope-view="BUSINESS"/,'Consolidated view must provide direct Company-ledger navigation.');

assert.match(js,/Customer Receivables/,'Company Finance must expose real customer receivables.');
assert.match(js,/function customerInvoiceDetail\(/,'Company Finance must expose invoice/payment drill-down.');
assert.match(js,/api\/invoice\/payment/,'Customer payments must reuse the protected invoice payment ledger.');

assert.match(js,/\['setupcentre','✓','Setup Centre'\]/,'Finance OS must expose one setup and migration centre.');
assert.match(js,/function setupCentreView\(\)/,'Setup Centre view is missing.');
assert.match(js,/FINANCE DATA MIGRATION/,'Setup Centre must explain the historical data migration workflow.');
assert.match(js,/Complete these in order to make reports reliable/,'Setup Centre must expose ordered data-quality controls.');
assert.match(js,/Account migration map/,'Setup Centre must show every account separately before consolidation.');
assert.match(js,/No step silently fabricates balances, classifications or FX rates/,'Setup Centre must preserve finance correctness boundaries.');

assert.match(js,/\['bankops','⌁','Banking Operations'\]/,'Unified Finance OS must expose Banking Operations.');
assert.match(js,/function bankingOperationsView\(\)/,'Banking Operations view is missing.');
assert.match(js,/OS\+'\/spaces'/,'Money Spaces must use the canonical Banking OS API.');
assert.match(js,/OS\+'\/beneficiaries'/,'Beneficiaries must use the canonical Banking OS API.');
assert.match(js,/OS\+'\/payments'/,'Payment drafts must use the canonical Banking OS API.');
assert.match(js,/Creating this record does not send money/,'Payment draft UI must not imply bank execution.');
assert.match(js,/actual external execution requires a verified provider capability/,'Payment execution capability boundary must remain explicit.');
assert.match(js,/data-payment-decision/,'Independent approval actions must be integrated into the Finance OS.');

assert.match(js,/function reportSpecificPreview\(/,'Finance Report Centre must render report-specific results.');
assert.match(js,/Account Statement needs exactly one account/,'Account Statement UI must require one account before generation.');
assert.match(js,/GST review summary/,'Finance Report Centre must expose GST review results.');
assert.match(js,/Reimbursement lifecycle/,'Finance Report Centre must expose reimbursement report results.');
assert.match(js,/Data quality controls/,'Finance Report Centre must expose data-quality report results.');

assert.match(js,/\['currency','FX','Currency Centre'\]/,'Finance OS must expose the Currency Centre.');
assert.match(js,/function managementConversionCard\(\)/,'Finance OS must calculate explicit evidence-based management conversions.');
assert.match(js,/Finance will not invent an exchange rate/,'Missing FX evidence must remain fail-closed.');

assert.match(js,/data-wallet-active/,'Personal Money must expose recoverable wallet lifecycle controls.');
assert.match(js,/data-personal-budget-delete/,'Personal Money budgets must be removable without deleting financial history.');
assert.match(js,/data-recurring-active/,'Recurring Money must support archive and restore.');
assert.match(js,/data-goal-status/,'Savings Goals must support pause and resume lifecycle controls.');

assert.match(js,/function openTeamAccessForm\(/,'Team Finance Access must expose account-level delegation management.');
assert.match(js,/OS\+'\/team\/'\+encodeURIComponent\(user\.id\)\+'\/access'/,'Delegated banking access must save through the canonical Banking OS access route.');
assert.match(js,/Personal accounts are intentionally excluded/,'Team Access UI must explicitly preserve Personal Money privacy.');
assert.match(js,/PREPARE = create payment instructions/,'Team Access must explain preparation rights.');
assert.match(js,/APPROVE = approve another preparer/,'Team Access must explain approval separation of duties.');

assert.match(js,/id="bankingAlertForm"/,'Finance Notifications must expose banking alert thresholds.');
assert.match(js,/OS\+'\/alerts'/,'Banking alert preferences must save through the canonical Banking OS route.');
assert.match(js,/low_balance_threshold/,'Finance alerts must expose a low-balance threshold.');
assert.match(js,/large_transaction_threshold/,'Finance alerts must expose a large-transaction threshold.');
assert.match(js,/Current banking attention/,'Finance alerts must surface Banking command-centre attention.');

assert.match(js,/function requestFinanceStepUp\(\)/,'Canonical Finance OS must handle step-up verification itself.');
assert.match(js,/body\.code==='STEP_UP_REQUIRED'/,'Sensitive Finance actions must retry through the current master frontend.');
assert.match(js,/Never enter a bank password, bank PIN or bank OTP/,'Finance step-up must separate app credentials from bank credentials.');

assert.match(js,/\['advanced','⚡','Control Centre'\]/,'Advanced Finance Control must be a first-class canonical home module.');
assert.match(js,/function advancedControlView\(\)/,'Advanced Finance Control view must be mounted inside the master Finance OS.');
assert.match(js,/finance-advanced-control\.js\?v=20260924-advanced-control-v10/,'Advanced Finance Control must use the canonical versioned asset.');

assert.match(js,/view:'advanced',scope:'ALL'/,'Default Finance landing must be Advanced Control.');
assert.match(js,/const MOBILE_NAV=\[\['advanced','⚡','Control'\]/,'Mobile Finance Home must open Advanced Control.');

assert.match(js,/MONTH-END CLOSE & ASSURANCE/,'Finance OS must expose the period Close & Assurance centre.');
assert.match(js,/close-assurance/,'Finance OS must use the canonical Close Assurance API.');

assert.match(js,/Accountant Handover & Audit Pack/,'Master Finance OS must expose Accountant Handover.');
assert.match(js,/if\(v==='handover'\)return accountantHandoverView\(\);/,'Accountant Handover navigation must resolve inside canonical Finance OS.');

assert.match(js,/\['treasury','▥','Treasury'\]/,'Treasury must be a canonical Finance planning module.');
assert.match(js,/function treasuryControlView\(\)/,'Treasury Control view must exist inside Finance Master OS.');

assert.match(js,/\['performance','▤','Performance & Stress'\]/,'Performance & Stress Control must be a first-class canonical module.');
assert.match(js,/function performanceRiskView\(\)/,'Performance & Stress Control view must be mounted inside the master Finance OS.');

assert.match(js,/\['controlactions','!','Control Actions'\]/,'Control Actions must be a first-class canonical module.');
assert.match(js,/function controlActionsView\(\)/,'Control Actions view must be mounted inside Finance Master OS.');

assert.match(js,/\['anomaly','≈','Anomaly & Explain'\]/,'Anomaly & Explainability must be a first-class canonical module.');
assert.match(js,/function anomalyExplainView\(\)/,'Anomaly & Explainability view must be mounted inside the master Finance OS.');

assert.match(js,/function counterpartyControlView\(\)/,'Finance OS must expose Customers & Suppliers counterparty control.');
assert.match(js,/counterparty-control/,'Finance OS must hydrate Counterparty Control.');
