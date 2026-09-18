const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/financeIntelligenceController.js');
const financeRoutes=read('routes/financeRoutes.js');
const bankingRoutes=read('routes/bankingPortalRoutes.js');
const html=read('public/finance-intelligence.html');
const js=read('public/finance-intelligence.js');
const css=read('public/finance-intelligence.css');

assert(controller.includes('getStatementWarehouse'),'statement-first warehouse endpoint exists');
assert(controller.includes("architecture: 'STATEMENT_FIRST_MONEY_WAREHOUSE'"),'warehouse declares statement-first architecture');
assert(controller.includes('GROUP BY bt.currency'),'warehouse separates currencies');
assert(controller.includes('bank_net_position'),'warehouse exposes bank net position per currency');
assert(controller.includes('COUNT(DISTINCT sif.import_uid) AS statement_count'),'warehouse tracks statements per account');
assert(controller.includes('categories_by_currency'),'warehouse carries category analytics');
assert(controller.includes('monthly_by_currency'),'warehouse carries monthly history');

assert(financeRoutes.includes("'/intelligence/statement-warehouse'"),'finance API exposes statement warehouse');
assert(bankingRoutes.includes("'/intelligence/statement-warehouse'"),'standalone banking API exposes statement warehouse');

assert(html.includes('Statement Money Warehouse'),'primary UI is statement money warehouse');
assert(html.includes('multiple required'),'statement input accepts multiple files');
assert(html.includes('Every bank account stays separate'),'UI explains account separation');
assert(!html.includes('id="metricInflow"'),'old generic cross-currency metric card is removed');

assert(js.includes("api(\`\${FIN_PREFIX}/statement-warehouse?scope="),'dashboard loads statement warehouse');
assert(js.includes("const files = [...($('importFile').files || [])]"),'batch importer reads every selected file');
assert(js.includes("for(let i=0;i<files.length;i+=1)"),'batch importer processes every statement');
assert(js.includes('staged.push'),'each successfully parsed statement is staged independently');
assert(js.includes('await loadReviewQueue()'),'multi-file batch opens statement review queue');
assert(js.includes('renderWarehouse(warehouse)'),'warehouse data is rendered');
assert(js.includes('Bank net position'),'currency cards show bank net position');

assert(css.includes('.warehouse-currency-card'),'warehouse has dedicated currency-card styling');
assert(css.includes('.warehouse-lower'),'warehouse has accounts and statement-history layout');
if(process.exitCode)process.exit(process.exitCode);
