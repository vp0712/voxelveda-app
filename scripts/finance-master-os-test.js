'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('public/finance-intelligence.html');
const css=read('public/finance-master.css');
const js=read('public/finance-master.js');

assert.match(html,/finance-master\.css\?v=20260923-master1/,'Master finance stylesheet must be loaded.');
assert.match(html,/finance-master\.js\?v=20260923-master1/,'Master finance client must be loaded.');
assert.doesNotMatch(html,/finance-bank-app-v5/,'Legacy V5 assets must not be referenced.');
assert.match(html,/FINANCE OPERATING SYSTEM/,'Finance OS shell is required.');
for(const name of ['Overview','Accounts','Transactions','Statements','Cash','Budgets','Savings','Borrow & Lend','Reports','Review','Reconciliation','Audit Log','Settings']){
  assert(js.includes(name),`Navigation must contain ${name}`);
}
assert.match(js,/banking-dashboard/,'Finance OS must use real banking dashboard data.');
assert.match(js,/intelligence\/transactions/,'Finance OS must use the real transaction explorer endpoint.');
assert.match(js,/intelligence\/statements/,'Finance OS must use the real statement vault endpoint.');
assert.match(js,/bank-transactions\/'\+id\+'\/original/,'Transaction detail must surface immutable original bank data.');
assert.match(js,/api\(API\+'\/transactions'/,'Manual transaction workflow must write to the finance ledger API.');
assert.match(css,/@media\(max-width:700px\)/,'Finance OS must have a dedicated mobile layout.');
assert.match(css,/fm-drawer/,'Transaction/account detail drawer must be styled.');
console.log('Finance Master OS regression contract passed.');
