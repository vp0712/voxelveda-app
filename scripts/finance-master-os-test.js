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
assert.match(html,/finance-master\.js\?v=20260923-control-centre/,'Master finance client must be loaded.');
assert.doesNotMatch(html,/finance-bank-app-v5/,'Legacy V5 assets must not be referenced.');
assert.match(html,/FINANCE OPERATING SYSTEM/,'Finance OS shell is required.');
for(const name of ['Overview','My Money','Company Finance','Consolidated','Accounts','Transactions','Cash','Transfers','Refunds','Reimbursements','Borrow & Lend','Recurring','Statements','Budgets','Savings Goals','Insights','Rules','Review Centre','Reconciliation','Reports','Notifications','Team Access','Banking Connections','Finance Settings']){
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
