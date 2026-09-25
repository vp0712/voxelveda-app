'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const client=read('public/finance-master.js');
const css=read('public/finance-master.css');
const html=read('public/finance-intelligence.html');

assert(html.includes('/finance-master.js'),'canonical Finance OS client must be loaded');
assert(client.includes('function openStatementWizard()'),'single-file statement import workflow is missing');
assert(client.includes('function openHistoricalImport('),'multi-file historical import workflow is missing');
assert(client.includes('accept=".csv,.pdf,.png,.jpg,.jpeg,.ofx,.qfx,.qif,.xlsx"'),'supported statement formats must remain explicit');
assert(client.includes('multiple required'),'historical import must allow multiple files for one selected account');
assert(client.includes('uploadStatementFile')&&client.includes("body.append('file',file,file.name)"),'wizard must upload original bytes as multipart data');
assert(client.includes('/statement-imports`')&&client.includes('/status`'),'wizard must use durable ingestion and status endpoints');
assert(client.includes('NEEDS_PASSWORD')&&client.includes('NEEDS_MAPPING'),'wizard must support actionable intervention states');
assert(client.includes('openStatementReview'),'completed extraction must open explicit review');
assert(client.includes("['DUPLICATE','REJECTED'].includes(row.validation_status)"),'duplicate/rejected rows must be excluded from selectable import rows');
assert(client.includes('data-review-commit')&&client.includes('data-review-reject'),'review decision actions are missing');
assert(client.includes('No transaction reaches the ledger until review and approval.'),'single-file non-posting safety copy is missing');
assert(client.includes('Nothing is committed automatically.'),'multi-file non-posting safety copy is missing');
assert(client.includes('fm-import-queue'),'multi-file import progress queue is missing');
assert(css.includes('.fm-import-queue')&&css.includes('.fm-ingestion-progress'),'ingestion progress styling is missing');
assert(css.includes('@media(max-width:700px)'),'Finance OS must include mobile layout rules');
assert(css.includes('.fm-table-wrap')&&css.includes('overflow:auto'),'compact review tables must remain horizontally usable');
assert(!html.includes('finance-bank-app-v3')&&!html.includes('premium-banking-app'),'retired Finance apps must stay removed');

console.log('Unified secure Finance statement import checks passed.');
