'use strict';

const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { detectStatementFile } = require('../services/financeStatementDetection');
const parser = require('../services/financeStatementParser');
const { evaluateStatement } = require('../services/financeStatementValidation');
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
  assert.equal(pdfResult.classification.selectable_text, true);
  assert.ok(pdfResult.rows[0].source_bbox);

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
    { transaction_date: '2026-09-24', description: 'Same', debit: '12.00', credit: '0.00', currency: 'AUD' },
    { transaction_date: '2026-09-24', description: 'Same', debit: '12.00', credit: '0.00', currency: 'AUD' }
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

  console.log('FINANCE_STATEMENT_REAL_FILES_OK formats=CSV,XLSX,OFX,QFX,QIF,PDF_TEXT,PNG_OCR,PDF_OCR,PDF_PASSWORD cases=MAPPING,AMBIGUOUS,MALFORMED,DUPLICATE,MISMATCH,CORRUPT,OVERSIZE');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => parser.shutdownOcrWorker());
