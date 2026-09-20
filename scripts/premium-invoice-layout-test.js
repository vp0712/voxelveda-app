const fs = require('node:fs');
function read(path){ return fs.readFileSync(path,'utf8'); }
function assert(condition,message){ if(!condition){ console.error('FAIL:',message); process.exitCode=1; } else console.log('PASS:',message); }

const controller = read('controllers/invoiceController.js');
const routes = read('routes/invoiceRoutes.js');
const admin = read('public/admin-dashboard.js');
const viewer = read('public/invoice-pdf.html');
const profile = read('config/companyProfile.js');

assert(routes.includes("router.get('/blank/pdf', invoiceController.viewBlankInvoicePdf)"), 'blank invoice PDF route exists');
assert(routes.indexOf("'/blank/pdf'") < routes.indexOf("'/:id'"), 'blank invoice route cannot be swallowed by invoice-id route');
assert(controller.includes('exports.viewBlankInvoicePdf'), 'blank invoice PDF controller exists');
assert(controller.includes('renderBlankInvoicePdf'), 'blank printable invoice renderer exists');
assert(controller.includes('drawInvoiceHero'), 'issued invoices use premium invoice hero');
assert(controller.includes('INVOICE FROM'), 'issued invoice contains invoice-from block');
assert(controller.includes('BILL TO'), 'issued invoice contains bill-to block');
assert(controller.includes('DESCRIPTION') && controller.includes('PRICE') && controller.includes('GST') && controller.includes('AMOUNT'), 'invoice table contains commercial columns');
assert(controller.includes('TOTAL DUE'), 'invoice uses total-due summary');
assert(controller.includes('PAYMENT INFORMATION'), 'invoice contains payment information section');
assert(controller.includes('AUTHORIZED SIGNATURE'), 'invoice contains signature section');
assert(!controller.includes("Bank: Commonwealth Bank"), 'invoice PDF does not hard-code a bank provider');
assert(controller.includes('company.bankName') && controller.includes('company.bankAccountNumber'), 'invoice PDF reads bank details from secure company profile');
assert(profile.includes('COMPANY_ABN') && profile.includes('COMPANY_BANK_BSB') && profile.includes('COMPANY_BANK_ACCOUNT_NUMBER'), 'company profile supports invoice legal/payment metadata');
assert(admin.includes('Blank Voxel Veda Invoice Template'), 'Company Forms contains blank invoice template');
assert(admin.includes("/api/invoice/blank/pdf?download=1"), 'Company Forms provides forced blank-PDF download');
assert(admin.includes("digital: false"), 'blank master invoice is not treated as a local digital record');
assert(viewer.includes('Invoice From') && viewer.includes('Bill To'), 'secure invoice viewer mirrors issued invoice structure');
assert(viewer.includes('<th>Price</th><th>GST</th><th>Amount</th>'), 'secure viewer uses premium invoice item columns');
assert(!viewer.includes('Bank: Commonwealth Bank'), 'secure preview does not display hard-coded bank data');

if(process.exitCode) process.exit(process.exitCode);
console.log('Premium invoice layout and blank-form safeguards passed.');
