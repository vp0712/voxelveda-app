'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const client=fs.readFileSync(path.join(root,'public/finance-master.js'),'utf8');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

const numberStart=client.indexOf('function parseNumber');
const numberEnd=client.indexOf('function parseCsv',numberStart);
const parserStart=client.indexOf('const PDF_MONTH_INDEX');
const parserEnd=client.indexOf('async function parseStatement',parserStart);
assert(numberStart>=0&&numberEnd>numberStart&&parserStart>=0&&parserEnd>parserStart,'PDF parser extraction boundaries missing');

const factory=new Function(
  client.slice(numberStart,numberEnd)+
  client.slice(parserStart,parserEnd)+
  '\nreturn {parsePdfLines};'
);
const {parsePdfLines}=factory();

const classic=[
  'Commonwealth Bank of Australia',
  "Here's your account information and a list of transactions from 10/04/24-10/05/24.",
  'Date Transaction Debit Credit Balance',
  '10 Apr 2024 OPENING BALANCE $1,524.65',
  '11 Apr WOOLWORTHS W3174 ST_KILDA AUS',
  'Card xx7937 50.95 $1,473.70',
  '12 Apr Direct Credit 141000 WAGES J ALEXOPOULOS 1,546.61 $3,020.31',
  '13 Apr Transfer to CBA A/c CommBank app Savings',
  '1,000.00 $2,020.31',
  '14 Apr SW PETROL 3020 CAULFIELD VIC AU Cash Out $35.00 Purchase $51.14 86.14 $1,934.17',
  '10 May CLOSING BALANCE $1,934.17'
];
const rows=parsePdfLines(classic);
assert(rows.length===4,'classic CBA summary should extract four transaction rows');
assert(Number(rows[0].debit)===50.95&&Number(rows[0].credit)===0,'unsigned debit must be inferred from running-balance movement');
assert(Number(rows[1].credit)===1546.61,'Direct Credit must be identified as money in');
assert(Number(rows[2].debit)===1000,'Transfer-to transaction must be identified as money out');
assert(Number(rows[3].debit)===86.14,'Cash-out/purchase aggregate must use the transaction total, not detail amounts');
assert(rows[0].transaction_date==='2024-04-11','yearless CBA transaction date must inherit statement year');

const modern=[
  "Here's your account information and a list of transactions from 01/11/24-05/02/25.",
  'Date Transaction Debit Credit Balance',
  '01 Nov OPENING BALANCE $121,530.40 CR',
  '01 Nov Transfer to Andrew Mack PayID iPhone from CommBank App CREDIT TO ACCOUNT 100.00 $121,430.40 CR',
  '02 Nov SHIFTCARE SYDNEY Card xx0483 82.50 $121,347.90 CR',
  '03 Nov PAYMENT FROM CRANAGE FINANCIAL GROUP 918518448 14,058.50 $135,406.40 CR',
  '04 Jan DIRECT DEBIT MEDIBANK PRIVATE 150.00 $135,256.40 CR',
  '05 Feb CLOSING BALANCE $135,256.40 CR'
];
const modernRows=parsePdfLines(modern);
assert(modernRows.length===4,'modern CBA summary should extract four transaction rows');
assert(Number(modernRows[0].debit)===100,'CR on running balance must not misclassify an unsigned debit as credit');
assert(Number(modernRows[2].credit)===14058.5,'running-balance increase must infer credit');
assert(modernRows[3].transaction_date==='2025-01-04','statement parser must handle year rollover');

assert(client.includes("parser_version:'PDF_TABLE_V4_BALANCE_DELTA'"),'PDF parser version marker missing');
assert(client.includes('timeoutMs:90000'),'statement preview must have an extended timeout for large multi-PDF batches');
console.log('FINANCE_PDF_STATEMENT_PARSER_TEST_OK');
