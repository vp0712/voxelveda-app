'use strict';

const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const { createReportWorkbook }=require('../controllers/financeReportBuilderController')._test;

async function run(){
  const report={
    metadata:{report_id:'RPT_TEST',report_version:2,scope:'BUSINESS',account_ids:[42],from:'2026-08-01',to:'2026-08-31',currency:'AUD',transaction_type:'EXPENSE',category:null,merchant:null,source:null,reconciliation_status:null,receipt_status:null,q:null,generated_at:'2026-09-23T01:02:03.000Z',generated_by:17,source_transaction_count:1,currency_treatment:'Native currencies remain separate.',history_completeness:'COMPLETE',history_completeness_note:'Selected account history covers the requested period.'},
    transactions:[{transaction_date:'2026-08-15',posting_date:'2026-08-16',account_name:'Operating',institution:'CBA',merchant_name:'Officeworks',description:'Printer paper',reference:'INV-1',category:'Office Supplies',ownership_scope:'BUSINESS',currency:'AUD',debit:'123.45',credit:'0.00',is_internal_transfer:0,source_type:'STATEMENT_IMPORT',reconciliation_status:'RECONCILED',has_receipt:1}],
    summary_by_currency:[{currency:'AUD',source_transaction_count:1,money_in:'0.00',ordinary_money_in:'0.00',linked_refund_inflow:'0.00',money_out:'123.45',net_cash_flow:'-123.45',net_economic_expense:'123.45',transfer_movement:'0.00',cash_in:'0.00',cash_out:'0.00',unclassified:0}],
    categories:[{currency:'AUD',category:'Office Supplies',source_transaction_count:1,split_line_count:0,spent:'123.45'}],
    coverage:{accounts:[{account_id:42,account_name:'Operating',currency:'AUD',status:'COMPLETE',history_start:'2026-01-01',history_end:'2026-09-23',last_statement_date:'2026-08-31'}]}
  };
  const profile={legalName:'Voxel Veda Pty Ltd'};
  const workbook=await createReportWorkbook(report,profile,'Expense Report');
  const transactions=workbook.getWorksheet('Transactions');
  assert(transactions,'Transactions worksheet missing');
  assert.deepEqual(transactions.views,[{state:'frozen',ySplit:11,xSplit:0}]);
  assert(transactions.autoFilter,'Transactions worksheet filter missing');
  assert(transactions.getCell(12,1).value instanceof Date,'transaction date must be an XLSX date cell');
  assert.equal(transactions.getCell(12,11).value,123.45,'debit must be a numeric XLSX cell');
  assert.equal(transactions.getCell(12,10).value,'AUD','currency column missing');
  const buffer=await workbook.xlsx.writeBuffer();
  assert(buffer.length>5000,'generated XLSX is unexpectedly small');
  const loaded=new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  assert.deepEqual(loaded.worksheets.map(sheet=>sheet.name),['Transactions','Summary','Categories','Coverage']);
  assert.equal(loaded.getWorksheet('Transactions').getCell(12,11).value,123.45);
  console.log(`FINANCE_XLSX_EXPORT_TEST_OK bytes=${buffer.length}`);
}

run().catch(error=>{console.error(error);process.exit(1)});
