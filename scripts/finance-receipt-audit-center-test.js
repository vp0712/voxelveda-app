'use strict';

const fs=require('node:fs');
const path=require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(value,message){if(!value)throw new Error(message)}

const routes=read('routes/financeRoutes.js');
const receipts=read('controllers/financeReceiptController.js');
const audit=read('controllers/financeAuditController.js');
const privacy=read('services/financePrivacyService.js');
const client=read('public/finance-master.js');

assert(routes.includes("router.get('/receipts'"),'Finance receipt centre route is missing');
assert(routes.includes("financePrivacy.bankTransactionParam('id')"),'transaction privacy middleware must remain on transaction routes');
assert(routes.includes("'/bank-transactions/:id/audit'"),'transaction audit timeline route is missing');

assert(receipts.includes("privacy.visibilitySql('ba', req)"),'receipt centre must enforce Finance account visibility');
assert(receipts.includes("sd.module='finance'"),'receipt centre must stay scoped to Finance documents');
assert(receipts.includes("sd.deleted_at IS NULL"),'receipt centre must exclude soft-deleted documents');
assert(receipts.includes("HAVING COUNT(sd.id)=0"),'missing receipt queue must be based on actual document absence');
assert(receipts.includes("/api/documents/\${row.id}/download"),'receipt downloads must use protected document route');
assert(!receipts.includes('/uploads/finance/'),'receipt centre must not expose direct upload paths');

assert(audit.includes("FROM audit_logs"),'transaction timeline must reuse the canonical audit chain');
assert(audit.includes("record_type='bank_transaction'"),'timeline must include bank transaction audit records');
assert(audit.includes("record_type='bank_transaction_receipt'"),'timeline must include receipt audit records');
assert(audit.includes('integrity_note'),'timeline must disclose its audit-integrity source');

assert(client.includes("['receipts','▧','Receipts']"),'Receipts navigation must be present in master Finance OS');
assert(client.includes('function receiptsView()'),'Receipts Centre UI is missing');
assert(client.includes('missing_receipts'),'missing receipt queue UI is missing');
assert(client.includes("api(API+'/bank-transactions/'+id+'/audit')"),'transaction detail must load audit history');
assert(client.includes('Audit History'),'transaction detail must render human-readable audit history');

assert(privacy.includes('requestAccountVisible'),'Finance privacy boundary is missing');
console.log('Finance receipt centre and audit timeline checks passed.');
