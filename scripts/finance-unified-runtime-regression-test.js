'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

const intelligence=read('controllers/financeIntelligenceController.js');
const search=read('controllers/financeSearchController.js');
const receipts=read('controllers/financeReceiptController.js');
const master=read('public/finance-master.js');
const app=read('app.js');

assert.match(intelligence,/period:\s*\{\s*from:\s*filters\.from\s*\|\|\s*null,\s*to:\s*filters\.to\s*\|\|\s*null\s*\}/,
  'Finance dashboard must use the normalized filter range and never undeclared from/to variables.');
assert.doesNotMatch(intelligence,/Failed to load premium banking dashboard/,
  'Unified Finance errors must not expose retired premium-banking terminology.');
assert.match(intelligence,/Failed to load Finance dashboard/,
  'Unified Finance dashboard error boundary must be explicit.');

assert.match(search,/SELECT id,query_uid,question,status,raised_at,assigned_to\s+FROM accountant_queries/,
  'Company Finance must read the actual accountant_queries schema.');
assert.doesNotMatch(search,/SELECT id,query_uid,subject,status,priority,raised_at,due_date/,
  'Company Finance must not query removed/nonexistent accountant query columns.');

assert.match(receipts,/CAST\(sd\.record_id AS UNSIGNED\)=bt\.id/,
  'Receipt joins must use numeric transaction identity to avoid mixed-collation string comparisons.');
assert.doesNotMatch(receipts,/CAST\(bt\.id AS CHAR\)=sd\.record_id|record_id=CAST\(bt\.id AS CHAR\)/,
  'Receipt centre must not use collation-sensitive transaction id joins.');

assert.match(master,/daily-briefing\?date='\+encodeURIComponent\(localIsoDay\(\)\)/,
  'Daily Finance Briefing must always send the required browser-local date.');
assert.match(master,/q\.question\|\|q\.query_uid/,
  'Company Finance must render the canonical accountant question field.');

assert.match(app,/app\.get\('\/banking',noIndex,pageAuth\(\),redirectPreservingQuery\('\/finance-intelligence'\)\)/,
  'The retired standalone Banking entry must resolve to the single unified Finance OS.');

console.log('Unified Finance production runtime regression contract passed.');
