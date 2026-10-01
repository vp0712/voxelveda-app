'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

process.env.FINANCE_REPORT_DELIVERY_SECRET='test-finance-report-delivery-secret-20260930';
process.env.FINANCE_REPORT_PUBLIC_BASE_URL='https://verified.example.test/';

const delivery=require('../services/financeReportDeliveryService');

assert.equal(delivery.safePdfFilename('Monthly Report.pdf'),'Monthly Report.pdf');
assert.equal(delivery.safePdfFilename('Monthly Report'),'Monthly Report.pdf');
assert.equal(delivery.safePdfFilename('../bad\\name'),'..-bad-name.pdf');
assert.equal(delivery._test.publicAppUrl(),'https://verified.example.test');

const payload={
  v:2,
  id:'11111111-2222-3333-4444-555555555555',
  key:'finance-email-delivery-v2/11111111-2222-3333-4444-555555555555/Report.pdf',
  filename:'Report.pdf',
  sha256:'a'.repeat(64),
  exp:Date.now()+60000
};
const token=delivery.createDeliveryToken(payload);
assert.deepEqual(delivery.decodeDeliveryToken(token),payload);
assert.throws(
  ()=>delivery.decodeDeliveryToken(token.slice(0,-1)+(token.endsWith('a')?'b':'a')),
  /Invalid finance report delivery token/
);

const root=path.resolve(__dirname,'..');
const emailService=fs.readFileSync(path.join(root,'services','emailService.js'),'utf8');
const reportController=fs.readFileSync(path.join(root,'controllers','financeReportBuilderController.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');

assert.match(emailService,/PDF_ATTACHMENT_RELAY_FILENAME_UNSAFE/);
assert.doesNotMatch(emailService,/transport:\s*'https_relay_pdf_fallback'/);
assert.match(reportController,/deliveryMode='durable_pdf_download'/);
assert.match(reportController,/attachments:\[\]/);
assert.match(reportController,/issuePdfDelivery/);
assert.match(app,/\/api\/public\/finance-report\/:token\/:filename/);
assert.match(delivery._test.publicAppUrl(),/^https:\/\//);
assert.equal(delivery._test.boundedTtlMinutes(1),60);
assert.equal(delivery._test.boundedTtlMinutes(999999),90*24*60);

console.log('FINANCE_EMAIL_PDF_DELIVERY_TEST_OK');
