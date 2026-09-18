const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const js=read('public/finance-statement-report-center.js');
assert(js.includes('function ensurePrintRoot()'),'same-page print root exists');
assert(js.includes("root.id='vvPrintRoot'"),'dedicated print container exists');
assert(js.includes('window.print()'),'current-page print sheet is invoked');
assert(!js.includes("window.open('','_blank','noopener,noreferrer')"),'popup-based print flow is removed');
assert(js.includes("body>*:not(#vvPrintRoot){display:none!important}"),'non-report app UI is hidden only for print');
assert(js.includes('@page{size:A4;margin:12mm}'),'A4 print layout is defined');
assert(js.includes('Voxel Veda Financial History Report'),'print report has a meaningful title');
assert(js.includes('vv-print-footer'),'printed report includes report footer');
if(process.exitCode)process.exit(process.exitCode);
