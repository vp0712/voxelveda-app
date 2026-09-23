'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const ui=read('public/finance-master.js');
const routes=read('routes/financeRoutes.js');
const controller=read('controllers/financeReportBuilderController.js');

for(const id of ['reportPdf','reportCsv','reportXlsx','reportSave'])assert(ui.includes(`id="${id}"`),`Report Centre missing ${id}`);
assert(ui.includes("location.href=API+'/reports/builder.pdf?'"),'PDF export must use the protected canonical report endpoint');
assert(ui.includes("location.href=API+'/reports/builder.csv?'"),'CSV export must use the protected canonical report endpoint');
assert(ui.includes("location.href=API+'/reports/builder.xlsx?'"),'XLSX export must use the protected canonical report endpoint');
assert(ui.includes("API+'/reports/saved'"),'saved-report workflow missing');
assert(ui.includes('Currencies are never converted or relabelled'),'Report Centre must preserve native-currency truth');

for(const endpoint of ['/reports/builder.pdf','/reports/builder.csv','/reports/builder.xlsx'])assert(routes.includes(endpoint),`protected report route missing ${endpoint}`);
assert(routes.includes("requireStepUp('EXPORT_FINANCIAL_DATA')"),'financial exports must retain step-up authentication');
assert(routes.includes("requireSensitiveExportApproval('FINANCE')"),'financial exports must retain sensitive-export approval');

assert(controller.includes("const PDFDocument = require('pdfkit')"),'server PDF generator missing');
assert(controller.includes('companyProfile'),'PDF must use the canonical company profile');
assert(controller.includes('exports.pdf=async'),'canonical filtered PDF export handler missing');
assert(controller.includes('currency_treatment'),'report output must disclose currency treatment');
assert(controller.includes('history_completeness'),'report output must disclose history completeness');

console.log('Canonical Finance Report Centre export regression checks passed.');
