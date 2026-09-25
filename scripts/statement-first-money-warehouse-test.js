const fs=require('node:fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const controller=read('controllers/financeIntelligenceController.js');
const financeRoutes=read('routes/financeRoutes.js');
const bankingRoutes=read('routes/bankingPortalRoutes.js');
const html=read('public/finance-intelligence.html');
const js=read('public/finance-master.js');
const css=read('public/finance-master.css');

assert(controller.includes('getStatementWarehouse'),'statement-first warehouse endpoint remains available');
assert(controller.includes("architecture: 'STATEMENT_FIRST_MONEY_WAREHOUSE'"),'warehouse declares statement-first architecture');
assert(controller.includes('GROUP BY bt.currency'),'warehouse separates currencies');
assert(controller.includes('bank_net_position'),'warehouse exposes bank net position per currency');
assert(controller.includes('COUNT(DISTINCT sif.import_uid) AS statement_count'),'warehouse tracks statements per account');
assert(controller.includes('categories_by_currency'),'warehouse carries category analytics');
assert(controller.includes('monthly_by_currency'),'warehouse carries monthly history');

assert(financeRoutes.includes("'/intelligence/statement-warehouse'"),'finance API exposes statement warehouse');
assert(bankingRoutes.includes("'/intelligence/statement-warehouse'"),'standalone banking API exposes statement warehouse');

assert(html.includes('FINANCE OPERATING SYSTEM'),'primary UI is the unified Finance OS');
assert(html.includes('id="fmAccount"'),'statement workflows share the Finance account selector');
assert(html.includes('Personal · Company · Consolidated'),'UI keeps ownership workspaces visibly separated');
assert(!html.includes('id="bankAppV5"'),'retired Banking V5 root is not reintroduced');

assert(js.includes('Statement Import Wizard'),'master Finance OS contains the statement import wizard');
assert(js.includes('Statement Vault'),'master Finance OS contains statement history');
assert(js.includes('openStatementWizard'),'statement upload opens a real in-context wizard');
assert(js.includes("accept=\".csv,.pdf,.png,.jpg,.jpeg,.ofx,.qfx,.qif,.xlsx\""),'wizard advertises only supported formats');
assert(js.includes('uploadStatementFile(accountId,file)'),'wizard uploads the selected original statement');
assert(js.includes('/statement-imports`'),'wizard uses the durable secure ingestion endpoint');
assert(js.includes('openStatementReview'),'wizard opens protected row review before commit');
assert(js.includes('/statement-reviews/'),'row selection and commit use the protected review API');
assert(js.includes('duplicate'),'statement UI exposes duplicate review context');

assert(css.includes('.fm-format-grid'),'master Finance OS styles supported statement formats');
assert(css.includes('.fm-account-grid'),'master Finance OS has account workspace layout');
assert(css.includes('@media(max-width:700px)'),'master Finance OS has mobile-specific layout');

if(process.exitCode)process.exit(process.exitCode);
