'use strict';
// This suite is destructive ONLY to an explicitly named, disposable CI database.
if(process.env.REPAIR_DB_TEST!=='true'||process.env.DB_NAME!=='voxelveda_repair_test')throw new Error('Disposable repair database opt-in required');
const assert=require('node:assert/strict');
const pool=require('../config/db');
const schema=require('../services/financeSchema');
schema.ensureFinanceSchema=async()=>{};
const controller=require('../controllers/financeIntelligenceController');
const {paymentSql}=require('../services/expensePaymentDomain');
const {expenseFilters}=require('../services/expenseRegisterFilters');
async function transactions(query,user=1,bankingAccessScope){
  let result,status=200;
  const res={status(code){status=code;return this;},json(body){result=body;return this;}};
  await controller.getTransactions({query,user:{id:user},bankingAccessScope},res);
  assert.equal(status,200,JSON.stringify(result));return result;
}
async function main(){
  await pool.query(`CREATE TABLE bank_accounts(id INT PRIMARY KEY,nickname VARCHAR(100),institution VARCHAR(100),entity_name VARCHAR(100),ownership_scope VARCHAR(30),created_by INT)`);
  await pool.query(`CREATE TABLE bank_transactions(id INT PRIMARY KEY,bank_account_id INT,transaction_date DATE,posting_date DATE,description VARCHAR(500),reference VARCHAR(180),debit DECIMAL(18,2),credit DECIMAL(18,2),running_balance DECIMAL(18,2),merchant_name VARCHAR(100),merchant_normalized VARCHAR(100),category VARCHAR(120),currency VARCHAR(3),ownership_scope VARCHAR(30),classification_status VARCHAR(30),reconciliation_status VARCHAR(30),is_internal_transfer INT,ignored_reason VARCHAR(200),project_ref VARCHAR(100),tags_json TEXT,gst_treatment VARCHAR(30),reviewed_at DATETIME,reviewed_by INT,source_type VARCHAR(30),source_provider VARCHAR(30),statement_import_uid VARCHAR(80),statement_row_id INT,review_source_status VARCHAR(30),manual_override INT,imported_at DATETIME,archived_at DATETIME)`);
  await pool.query(`CREATE TABLE bank_transaction_splits(id INT PRIMARY KEY,parent_bank_transaction_id INT,category VARCHAR(120),amount DECIMAL(18,2))`);
  await pool.query(`CREATE TABLE finance_refund_links(refund_bank_transaction_id INT,linked_amount DECIMAL(18,2),status VARCHAR(20))`);
  await pool.query(`CREATE TABLE statement_import_files(bank_account_id INT,import_uid VARCHAR(80),original_name VARCHAR(200),source_format VARCHAR(20))`);
  await pool.query(`INSERT INTO bank_accounts VALUES(1,'Owner one','Test bank',NULL,'PERSONAL',1),(2,'Owner two','Test bank',NULL,'PERSONAL',2),(3,'Rupee account','Test bank',NULL,'PERSONAL',1),(4,'Company','Test bank',NULL,'BUSINESS',2)`);
  const rows=[
    [1,1,'Groceries','100.00','0.00','AUD',0,'UNRECONCILED'],[2,1,'Transfer','1000.00','0.00','AUD',1,'UNRECONCILED'],
    [3,1,'Transfer','50.00','0.00','AUD',0,'UNRECONCILED'],[4,1,'Unclassified','20.00','0.00','AUD',0,'UNRECONCILED'],
    [5,1,'Groceries','999.00','0.00','AUD',0,'IGNORED'],[6,2,'Groceries','777.00','0.00','AUD',0,'UNRECONCILED'],
    [7,3,'Groceries','100.00','0.00','INR',0,'UNRECONCILED'],[8,1,'Groceries','10.00','0.00','AUD',0,'UNRECONCILED'],
    [9,1,'Groceries','10.00','0.00','AUD',0,'UNRECONCILED'],[10,4,'Groceries','333.00','0.00','AUD',0,'UNRECONCILED'],
    [11,1,'Refund','0.00','10.00','AUD',0,'UNRECONCILED']
  ];
  for(const [id,account,category,debit,credit,currency,transfer,reconciliation] of rows)await pool.query(`INSERT INTO bank_transactions(id,bank_account_id,transaction_date,description,debit,credit,category,currency,is_internal_transfer,reconciliation_status,ownership_scope,manual_override,classification_status) VALUES(?,?,'2026-09-01','Synthetic repeated fixture',?,?,?,?,?,?,?,0,'CLASSIFIED')`,[id,account,debit,credit,category,currency,transfer,reconciliation,account===4?'BUSINESS':'PERSONAL']);
  await pool.query(`INSERT INTO bank_transaction_splits VALUES(1,1,'Groceries',40.00),(2,1,'Fuel',60.00)`);
  await pool.query(`INSERT INTO finance_refund_links VALUES(11,10.00,'ACTIVE')`);
  const groceries=await transactions({account_id:'1',category:'Groceries',type:'EXPENSE',currency:'AUD',from:'2026-09-01',to:'2026-09-30'});
  assert.equal(groceries.total,3);assert.equal(groceries.summary.money_out,'60.00');
  assert.deepEqual(groceries.transactions.map(row=>row.category_allocated_debit),['40.00','10.00','10.00']);
  const fuel=await transactions({account_id:'1',category:'Fuel',type:'EXPENSE'});
  assert.equal(fuel.summary.money_out,'60.00');assert.equal(fuel.transactions[0].debit,'100.00');
  const uncategorised=await transactions({account_id:'1',category:'Unclassified'});
  assert.equal(uncategorised.total,1);assert.equal(uncategorised.summary.money_out,'20.00');
  const ledger=await transactions({account_id:'1'});
  assert.equal(ledger.summary.money_out,'190.00');assert.equal(ledger.summary.transfer_movement,'1000.00');
  assert.equal(ledger.summary.linked_refund_inflow,'10.00');assert.equal(ledger.summary.ordinary_money_in,'0.00');
  assert.equal(ledger.summary.net_economic_expense,'180.00');
  assert.equal((await transactions({account_id:'2'})).total,0,'another personal owner is isolated');
  const delegated=await transactions({scope:'ALL'},1,{has_explicit_grants:true,is_admin:false,allowed_business_account_ids:[]});
  assert(!delegated.transactions.some(row=>row.bank_account_id===2||row.bank_account_id===4));
  assert.equal(delegated.summary.consolidated_available,false,'AUD and INR cannot be silently combined');
  assert.equal((await transactions({account_id:'1',from:'2026-10-01'})).total,0);
  await pool.query(`CREATE TABLE expenses(id INT PRIMARY KEY,total_amount DECIMAL(18,2),status VARCHAR(30),due_date DATE,expense_date DATE,deleted INT,category VARCHAR(120),supplier_name VARCHAR(100),invoice_no VARCHAR(100),description VARCHAR(100))`);
  await pool.query(`CREATE TABLE expense_payments(expense_id INT,amount DECIMAL(18,2),voided_at DATETIME)`);
  await pool.query(`INSERT INTO expenses VALUES(1,100,'unpaid',NULL,'2026-09-01',0,'Material','Test',NULL,NULL),(2,100,'unpaid','2020-01-01','2026-09-01',0,'Material','Test',NULL,NULL),(3,100,'paid',NULL,'2026-09-01',0,'Material','Test',NULL,NULL),(4,100,'unpaid',NULL,'2026-09-01',1,'Material','Test',NULL,NULL)`);
  await pool.query(`INSERT INTO expense_payments VALUES(2,25.25,NULL),(2,20.00,NOW()),(4,100.00,NULL)`);
  const sql=paymentSql();const filtered=expenseFilters({fy:'2026'});
  const [[totals]]=await pool.query(`SELECT SUM(${sql.paid}) AS paid,SUM(${sql.due}) AS due FROM expenses e ${sql.join} ${filtered.where}`,filtered.params);
  assert.equal(totals.paid,'125.25');assert.equal(totals.due,'174.75');
  const overdue=expenseFilters({status:'overdue'});const [bills]=await pool.query(`SELECT e.id FROM expenses e ${sql.join} ${overdue.where}`,overdue.params);
  assert.deepEqual(bills.map(row=>row.id),[2]);
  console.log('MYSQL_REPAIR_OK: real SQL validates split/category totals, transfers, refunds, repeats, currencies, owner/grant isolation, dates and full/partial/zero payables.');
}
main().then(()=>pool.end()).catch(error=>{console.error(error);process.exitCode=1;pool.end();});
