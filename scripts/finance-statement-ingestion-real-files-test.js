'use strict';

const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { detectStatementFile } = require('../services/financeStatementDetection');
const parser = require('../services/financeStatementParser');
const { evaluateStatement, hasVerifiedNoActivity } = require('../services/financeStatementValidation');
const statementReview = require('../controllers/statementImportController');

function pdfBuffer(options, draw) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 40, ...options });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    draw(document);
    document.end();
  });
}

async function fixtureImage() {
  const svg = Buffer.from(`<svg width="2200" height="700" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="70" y="100" font-size="54" font-family="Arial">BANK STATEMENT AUD</text>
    <text x="70" y="230" font-size="48" font-family="Arial">24/09/2026 Supplier payment 42.50 DR 1057.50 CR</text>
    <text x="70" y="340" font-size="48" font-family="Arial">25/09/2026 Customer receipt 100.00 CR 1157.50 CR</text>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

async function verifyNoActivityCommit(parsed) {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../controllers/statementImportController'), 'utf8');
  const commitSource = source.slice(source.indexOf('exports.commit = async'), source.indexOf('exports.reject = async'));
  const { FinanceError } = require('../services/financeDomain');
  const account = { id: 7, currency: 'AUD', account_type: 'SAVINGS', history_end_date: '2026-09-30', current_ledger_balance: '500.00' };
  for (const completedJob of [true, false]) {
    const queries = [], audits = [];
    const session = { id: 1, import_uid: 'synthetic-zero-activity', status: 'PENDING_REVIEW', bank_account_id: 7, secure_document_id: 'synthetic-original', source_format: 'PDF', parser_version: parsed.parserVersion, original_name: 'anonymous-zero.pdf', opening_balance: parsed.classification.opening_balance, closing_balance: parsed.classification.closing_balance, statement_start_date: parsed.classification.statement_start_date, statement_end_date: parsed.classification.statement_end_date, extraction_diagnostics_json: JSON.stringify({ classification: parsed.classification }) };
    const db = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM statement_import_sessions')) return [[session]];
      if (sql.startsWith('SELECT * FROM bank_accounts')) return [[account]];
      if (sql.startsWith('SELECT id FROM finance_statement_import_jobs')) return [completedJob ? [{ id: 5 }] : []];
      if (sql.startsWith('SELECT')) return [[]];
      return [{ affectedRows: 1, insertId: 10 }];
    } };
    const context = { exports: {}, pool: { getConnection: async () => db }, FinanceError, evaluateStatement, hasVerifiedNoActivity,
      repairPendingReview: async () => ({ repaired: 0, future_dates_repaired: 0 }), isBalanceMarker: () => false,
      loadSemanticDuplicateSources: async () => new Set(), countRows: () => ({ valid: 0, warning: 0, duplicate: 0, rejected: 0 }),
      applyAutoRulesToImport: async () => ({ changes: [], matched: 0, applied: 0, skipped_period: 0 }), uid: () => 'synthetic-batch',
      audit: (_req, entry) => entry, logAudit: async (_db, entry) => audits.push(entry),
      fail: (res, error) => res.status(error.statusCode || 500).json({ code: error.code }) };
    vm.runInNewContext(commitSource, context);
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
    await context.exports.commit({ params: { uid: session.import_uid }, body: {}, user: { id: 1 } }, res);
    assert.equal(res.statusCode, completedJob ? 200 : 422, 'Only a completed server extraction can accept an empty statement');
    assert.ok(!queries.some(item => /INSERT(?: IGNORE)? INTO bank_transactions\b|UPDATE bank_accounts\b/.test(item.sql)), 'Empty acceptance must never invent transactions or replace a newer account balance');
    if (completedJob) {
      assert.equal(res.body.imported, 0);
      assert.equal(res.body.no_activity_statement, true);
      assert.deepEqual(JSON.parse(JSON.stringify(res.body.coverage)), { start: '2024-01-02', end: '2024-03-01' });
      const fileInsert = queries.find(item => item.sql.includes('INSERT INTO statement_import_files'));
      assert.ok(fileInsert, 'The original statement and its verified coverage are retained in the existing vault');
      assert.equal(fileInsert.params[5], '2024-01-02');
      assert.equal(fileInsert.params[6], '2024-03-01');
      assert.equal(audits.at(-1).newValue.no_activity_statement, true);
    } else assert.ok(!queries.some(item => item.sql.includes('INSERT INTO statement_import_files')), 'Client metadata without the completed durable-source job cannot create an accepted empty statement');
  }
}

async function run() {
  const csv = Buffer.from('Date,Description,Debit,Credit,Balance,Currency\n24/09/2026,Supplier payment,42.50,,1057.50,AUD\n25/09/2026,Customer receipt,,100.00,1157.50,AUD\n');
  const csvResult = await parser.parseStatementBuffer(csv, { originalName: 'statement.csv', mimeType: 'text/csv' }, { mapping: { date_format: 'DMY' } });
  assert.equal(csvResult.rows.length, 2);
  assert.equal(csvResult.rows[0].debit, '42.50');
  assert.equal(csvResult.rows[1].credit, '100.00');

  const mappingRequired = await parser.parseStatementBuffer(Buffer.from('When,Who,Value\n24/09/2026,Supplier,-42.50\n'), { originalName: 'custom.csv' }, { currency: 'AUD' });
  assert.equal(mappingRequired.needsMapping, true);
  assert.deepEqual(mappingRequired.headers, ['When', 'Who', 'Value']);

  const ambiguous = await parser.parseStatementBuffer(Buffer.from('Date,Description,Amount\n01/02/2026,Ambiguous,-10.00\n'), { originalName: 'ambiguous.csv' }, { currency: 'AUD' });
  assert.equal(ambiguous.rows[0].force_rejected, true);
  const malformed = statementReview._ingestion.normalizeRow(1, 'AUD', { transaction_date: 'not-a-date', description: 'Bad row', debit: 'oops', credit: 0 }, 1);
  assert.equal(malformed.validation_status, 'REJECTED');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transactions');
  sheet.addRow(['Date', 'Description', 'Amount', 'Balance', 'Currency']);
  sheet.addRow(['24/09/2026', 'Supplier payment', -42.50, 1057.50, 'AUD']);
  sheet.addRow(['25/09/2026', 'Customer receipt', 100, 1157.50, 'AUD']);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const xlsxResult = await parser.parseStatementBuffer(xlsx, { originalName: 'statement.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { mapping: { date_format: 'DMY' } });
  assert.equal(xlsxResult.rows.length, 2);
  assert.equal(xlsxResult.rows[0].debit, '42.50');

  const ofx = Buffer.from('OFXHEADER:100\nDATA:OFXSGML\n<OFX><CURDEF>AUD<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260924000000<TRNAMT>-42.50<FITID>fit-1<NAME>Supplier<MEMO>Material</STMTTRN></BANKTRANLIST></OFX>');
  const qfx = Buffer.from('<OFX><CURDEF>AUD<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260925000000<TRNAMT>100.00<FITID>fit-2<NAME>Customer</STMTTRN></BANKTRANLIST></OFX>');
  assert.equal((await parser.parseStatementBuffer(ofx, { originalName: 'statement.ofx' })).rows[0].debit, '42.50');
  assert.equal((await parser.parseStatementBuffer(qfx, { originalName: 'statement.qfx' })).rows[0].credit, '100.00');

  const qif = Buffer.from('!Type:Bank\nD24/09/2026\nT-42.50\nPSupplier\nMMaterial\n^\nD25/09/2026\nT100.00\nPCustomer\n^\n');
  const qifResult = await parser.parseStatementBuffer(qif, { originalName: 'statement.qif' }, { mapping: { date_format: 'DMY' } });
  assert.equal(qifResult.rows.length, 2);

  const textPdf = await pdfBuffer({}, (document) => {
    document.fontSize(18).text('BANK STATEMENT AUD');
    document.moveDown().fontSize(13).text('24/09/2026 Supplier payment 42.50 DR 1057.50 CR');
    document.text('25/09/2026 Customer receipt 100.00 CR 1157.50 CR');
  });
  const pdfResult = await parser.parseStatementBuffer(textPdf, { originalName: 'statement.pdf', mimeType: 'application/pdf' }, { currency: 'AUD' });
  assert.equal(pdfResult.rows.length, 2);
  const { parseLines: parseGenericStatement } = require('../services/financeStatementAdapters/generic');
  const genericTotals = parseGenericStatement([
    { page: 1, text: '02/09/2026 Supplier invoice 120.00 DR 1380.00 CR' },
    { page: 1, text: 'Page 1 of 2' },
    { page: 1, text: 'Total Withdrawals 120.00' },
    { page: 2, text: '03/09/2026 Customer deposit 500.00 CR 1880.00 CR' },
    { page: 2, text: 'Page 2 of 2' },
    { page: 2, text: 'Total Deposits 500.00' }
  ], { currency: 'AUD', dateFormat: 'DMY' });
  assert.equal(genericTotals.length, 2, 'page totals and markers must not be merged into statement rows');
  assert.equal(genericTotals[0].description, 'Supplier invoice');
  assert.equal(genericTotals[0].debit, '120.00');
  assert.equal(genericTotals[0].running_balance, '1380.00');
  assert.equal(genericTotals[1].description, 'Customer deposit');
  assert.equal(genericTotals[1].credit, '500.00');
  assert.equal(genericTotals[1].running_balance, '1880.00');

  assert.equal(pdfResult.classification.selectable_text, true);
  assert.ok(pdfResult.rows[0].source_bbox);

  const noActivityPdf = await pdfBuffer({}, document => {
    document.fontSize(15).text('ANZ ACCESS ADVANTAGE STATEMENT');
    document.fontSize(11).text('STATEMENT NUMBER 2').text('02 January 2024 to 01 March 2024');
    document.text('Account Number 0000000123');
    for (const [label, amount] of [['Opening Balance:', '500.00'], ['Total Deposits:', '0.00'], ['Total Withdrawals:', '0.00'], ['Closing Balance:', '500.00']]) {
      document.text(label, 350, document.y + 15).text('$', 385, document.y).text(amount, 390, document.y);
    }
    document.addPage().text('Transaction Details', 40, 40).text('Fee Summary');
    document.text('Fees Charged for period: 30 DEC 2023 to 31 JAN 2024');
    document.text('Your credit card statement and card account terms are separate from this savings account.');
    document.addPage(); // Real exported statements may append a genuinely blank page.
  });
  const stages = [];
  const noActivity = await parser.parseStatementBuffer(noActivityPdf, { originalName: 'anonymous-zero.pdf', mimeType: 'application/pdf' }, { currency: 'AUD' }, event => stages.push(event.stage));
  assert.equal(noActivity.rows.length, 0, 'Summary balances and totals are never imported as transactions');
  assert.equal(noActivity.classification.document_type, 'BANK_STATEMENT', 'Legal/footer card references cannot override the actual savings-statement heading');
  assert.equal(noActivity.classification.statement_start_date, '2024-01-02');
  assert.equal(noActivity.classification.statement_end_date, '2024-03-01', 'Fee cycles must not overwrite actual statement coverage');
  assert.equal(noActivity.classification.no_activity_verified, true);
  assert.equal(noActivity.pages.length, 3, 'Every original source page, including verified blank pages, remains available for review');
  assert.equal(noActivity.pages[2].extraction_method, 'PDF_BLANK');
  assert.ok(!stages.includes('OCR_REQUIRED'), 'Verified selectable zero-activity statements do not require destructive/redundant OCR fallback');
  const noActivityValidation = evaluateStatement({ rows: noActivity.rows, classification: noActivity.classification, account: { currency: 'AUD', account_type: 'SAVINGS' } });
  assert.equal(noActivityValidation.reconciliationStatus, 'BALANCED');
  assert.equal(noActivityValidation.validations.find(item => item.check === 'NO_ACTIVITY_STATEMENT').status, 'PASS');
  for (const change of [{ closing_balance: '500.01' }, { summary_total_credits: null }, { summary_total_debits: '12.00' }, { statement_end_date: null }, { multiple_accounts: true }, { appears_incomplete: true }]) assert.equal(hasVerifiedNoActivity({ ...noActivity.classification, ...change }, []), false, 'Ambiguous/damaged extraction is never treated as zero activity');
  assert.equal(hasVerifiedNoActivity(noActivity.classification, [{ description: 'Uncertain purchase', force_rejected: true }]), false, 'Unresolved transaction rows cannot be discarded as no activity');
  assert.equal(evaluateStatement({ rows: [], classification: { opening_balance: '500.00', closing_balance: '500.00' } }).reconciliationStatus, 'MISMATCH', 'Matching balances alone do not prove no activity');
  await verifyNoActivityCommit(noActivity);

  const image = await fixtureImage();
  if (process.env.FINANCE_OCR_DEBUG === 'true') {
    const debug = await parser._test.ocrImage(image, 1);
    console.log(JSON.stringify({ text: debug.text, lines: debug.lines }, null, 2));
  }
  const imageResult = await parser.parseStatementBuffer(image, { originalName: 'scan.png', mimeType: 'image/png' }, { currency: 'AUD' });
  assert.equal(imageResult.rows.length, 2);
  assert.equal(imageResult.classification.ocr_required, true);
  assert.ok(imageResult.rows.every((row) => row.source_page === 1));

  const scanPdf = await pdfBuffer({}, (document) => document.image(image, 35, 60, { fit: [525, 300] }));
  const scanResult = await parser.parseStatementBuffer(scanPdf, { originalName: 'scan.pdf', mimeType: 'application/pdf' }, { currency: 'AUD' });
  assert.equal(scanResult.rows.length, 2);
  assert.equal(scanResult.classification.ocr_required, true);

  const protectedPdf = await pdfBuffer({ userPassword: 'fixture-pass', ownerPassword: 'fixture-owner' }, (document) => {
    document.fontSize(18).text('BANK STATEMENT AUD');
    document.moveDown().fontSize(13).text('24/09/2026 Supplier payment 42.50 DR 1057.50 CR');
  });
  await assert.rejects(() => parser.parseStatementBuffer(protectedPdf, { originalName: 'protected.pdf' }, { currency: 'AUD' }), (error) => error.code === 'PDF_PASSWORD_REQUIRED');
  const protectedResult = await parser.parseStatementBuffer(protectedPdf, { originalName: 'protected.pdf' }, { currency: 'AUD', password: 'fixture-pass' });
  assert.equal(protectedResult.rows.length, 1);

  const mismatch = evaluateStatement({
    rows: [{ transaction_date: '2026-09-24', debit: '42.50', credit: '0.00', running_balance: '1057.50', currency: 'AUD' }],
    classification: { opening_balance: '1100.00', closing_balance: '999.99', classification_confidence: 1 },
    account: { currency: 'AUD', account_type: 'BANK' }
  });
  assert.equal(mismatch.reconciliationStatus, 'MISMATCH');

  const duplicateInput = [
    { transaction_date: '2026-09-24', description: 'Same', reference: 'unique-bank-payment-1', debit: '12.00', credit: '0.00', currency: 'AUD' },
    { transaction_date: '2026-09-24', description: 'Same', reference: 'unique-bank-payment-1', debit: '12.00', credit: '0.00', currency: 'AUD' }
  ];
  const deduped = await statementReview._ingestion.normalizeAndDedupe({ query: async () => [[]] }, { id: 1, currency: 'AUD' }, duplicateInput);
  assert.equal(deduped.normalized[1].validation_status, 'DUPLICATE');
  assert.equal(deduped.normalized[1].duplicate_status, 'DUPLICATE_IN_FILE');

  assert.throws(() => detectStatementFile(Buffer.from('not a statement'), 'statement.pdf'), (error) => error.code === 'STATEMENT_EXTENSION_MISMATCH' || error.code === 'UNSUPPORTED_STATEMENT_CONTENT');
  assert.throws(() => detectStatementFile(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'statement.xls'), (error) => error.code === 'LEGACY_XLS_UNSUPPORTED');
  assert.throws(() => detectStatementFile(Buffer.from('%PDF-corrupt'), 'statement.csv'), (error) => error.code === 'STATEMENT_EXTENSION_MISMATCH');
  await assert.rejects(() => parser.parseStatementBuffer(Buffer.from('%PDF-corrupt'), { originalName: 'corrupt.pdf' }), (error) => error.code === 'PDF_INVALID');
  const priorMaxBytes = process.env.FINANCE_STATEMENT_MAX_BYTES;
  process.env.FINANCE_STATEMENT_MAX_BYTES = '1024';
  assert.throws(() => detectStatementFile(Buffer.alloc(1025, 65), 'oversize.csv'), (error) => error.code === 'STATEMENT_FILE_TOO_LARGE');
  if (priorMaxBytes === undefined) delete process.env.FINANCE_STATEMENT_MAX_BYTES; else process.env.FINANCE_STATEMENT_MAX_BYTES = priorMaxBytes;

  console.log('FINANCE_STATEMENT_REAL_FILES_OK formats=CSV,XLSX,OFX,QFX,QIF,PDF_TEXT,PNG_OCR,PDF_OCR,PDF_PASSWORD cases=MAPPING,AMBIGUOUS,MALFORMED,DUPLICATE,MISMATCH,CORRUPT,OVERSIZE,VERIFIED_ZERO_ACTIVITY,FEE_PERIOD,MANUAL_EMPTY_ACCEPTANCE');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => parser.shutdownOcrWorker());
