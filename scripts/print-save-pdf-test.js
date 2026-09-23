'use strict';

const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}

const controller=read('controllers/financeReportBuilderController.js');
const client=read('public/finance-master.js');

assert(client.includes('id="reportPdf"'),'Report Centre exposes protected PDF export');
assert(client.includes('id="reportCsv"'),'Report Centre exposes CSV export');
assert(client.includes('id="reportXlsx"'),'Report Centre exposes XLSX export');
assert(controller.includes('exports.pdf=async'),'server-side Finance PDF exporter exists');
assert(controller.includes("new PDFDocument({size:'A4'"),'Finance PDF is generated as A4');
assert(controller.includes('bufferPages:true'),'PDF buffers pages so branding can be applied consistently');
assert(controller.includes("res.setHeader('Content-Type','application/pdf')"),'PDF response content type is explicit');
assert(controller.includes('Content-Disposition'),'PDF download filename is explicit');
assert(controller.includes('Voxel-Veda-${safeName}.pdf'),'PDF filename is Voxel Veda branded');
assert(controller.includes("path.join(__dirname,'..','public','Frame 1.png')"),'original company logo is used when available');
assert(controller.includes('doc.switchToPage(index)'),'PDF header/footer is applied to every page');
assert(controller.includes('profile.legalName'),'company legal name appears in report branding');
assert(controller.includes('profile.abn'),'ABN appears in report identity when configured');
assert(controller.includes('profile.website'),'website appears in report identity when configured');
assert(controller.includes('profile.email'),'company email appears in report identity when configured');
assert(controller.includes('Generated ${generatedAt.toLocaleString'),'report generation date/time is printed');
assert(controller.includes('Page ${index+1} of ${pages.count}'),'every page has page numbering');
assert(controller.includes('profile.footer'),'configured report footer is printed on every page');
assert(controller.includes('Currency treatment:'),'PDF states its currency treatment');
assert(controller.includes('report.metadata.from')&&controller.includes('report.metadata.to'),'PDF includes report period metadata');

if(process.exitCode)process.exit(process.exitCode);
console.log('Finance branded PDF export regression checks passed.');
