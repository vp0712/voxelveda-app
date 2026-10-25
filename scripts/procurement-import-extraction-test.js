'use strict';

// Real parser fixtures. All business data below is synthetic and no database,
// external OCR service, network connection or mail recipient is used.
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { createCanvas } = require('@napi-rs/canvas');
const {
  extractImportFile, normalizeImportRow, suggestImportMapping, detectImportFormat,
  ImportExtractionError, DEFAULT_LIMITS, IMPORT_FIELDS, HEADER_ALIASES
} = require('../services/procurementImportExtractionService');
const { localOcrOptions, ocrCapability, OCR_LIMITS } = require('../services/procurementLocalOcrService');

function file(filename, body, mimeType) { return { filename, buffer: Buffer.isBuffer(body) ? body : Buffer.from(body), mimeType }; }
const baseOptions = { classification: 'PLAN', mapping: { description: 0, quantity: 1 } };
function normalized(cells, options = {}) { return normalizeImportRow(cells, { ...baseOptions, ...options }); }
function workbook(sheets, bookType = 'xlsx', options = {}) {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, Array.isArray(sheet) ? XLSX.utils.aoa_to_sheet(sheet) : sheet, name);
  if (options.date1904) book.Workbook = { WBProps: { date1904: true } };
  return XLSX.write(book, { type: 'buffer', bookType, compression: true });
}

// Excel stores calendar dates as serial days, not JavaScript instants. Construct
// real numeric date cells so SheetJS cannot introduce the runner's local time.
function excelCalendarCell(isoDate, date1904 = false) {
  assert.match(isoDate, /^\d{4}-\d{2}-\d{2}$/);
  const [year, month, day] = isoDate.split('-').map(Number);
  const instant = Date.UTC(year, month - 1, day);
  assert.equal(new Date(instant).toISOString().slice(0, 10), isoDate, 'Fixture must be a real calendar date.');
  const serial1900 = (instant - Date.UTC(1899, 11, 31)) / 86400000 + (instant >= Date.UTC(1900, 2, 1) ? 1 : 0);
  const serial = serial1900 - (date1904 ? 1462 : 0);
  assert.ok(Number.isInteger(serial) && serial >= 0, 'Fixture must use a supported whole Excel serial day.');
  return { t: 'n', v: serial, z: 'yyyy-mm-dd' };
}

function pdfFixture({ pages = 2, imageOnly = false, encrypted = false } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 32, ...(encrypted ? { userPassword: 'fixture-only' } : {}) });
  const chunks = [];
  const completed = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) doc.addPage();
    if (imageOnly) { doc.rect(42, 42, 200, 200).fill('#102b4e'); continue; }
    doc.font('Helvetica').fontSize(10).fillColor('#172a43');
    doc.text('Fixture supplier quotation', 40, 40);
    const columns = [{ text: 'Description', x: 40 }, { text: 'Quantity', x: 270 }, { text: 'Unit price', x: 355 }, { text: 'Tax rate', x: 450 }];
    for (const column of columns) doc.text(column.text, column.x, 85, { width: 90 });
    for (const column of [{ text: `Fixture part ${page}`, x: 40 }, { text: '2', x: 270 }, { text: '12.50', x: 355 }, { text: '10', x: 450 }]) doc.text(column.text, column.x, 115, { width: 90 });
    doc.text('Total 27.50', 40, 160);
  }
  doc.end(); return completed;
}
function imageFixture(format = 'png') {
  const canvas = createCanvas(12, 10), context = canvas.getContext('2d');
  context.fillStyle = '#102b4e'; context.fillRect(0, 0, 12, 10);
  return canvas.toBuffer(format === 'jpeg' ? 'image/jpeg' : 'image/png');
}
function ocrImageFixture() {
  const canvas = createCanvas(1100, 340), context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000'; context.font = '42px sans-serif';
  context.fillText('FIXTURE QUOTATION', 35, 65);
  context.fillText('Description        Quantity', 35, 140);
  context.fillText('Fixture steel plate       2', 35, 215);
  return canvas.toBuffer('image/png');
}
function scannedPdfFixture(png, pages = 1, withNativeText = false) {
  const doc = new PDFDocument({ size: 'A4', margin: 32 }), chunks = [];
  const completed = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  if (withNativeText) doc.font('Helvetica').fontSize(12).text('Fixture original native PDF text remains authoritative.', 32, 32);
  for (let index = 0; index < pages; index += 1) { if (index || withNativeText) doc.addPage(); doc.image(png, 32, 32, { width: 530 }); }
  doc.end(); return completed;
}

async function main() {
  assert.deepEqual(IMPORT_FIELDS, ['supplier_name', 'reference', 'date', 'due_date', 'currency', 'description', 'item_code', 'quantity', 'unit', 'unit_price', 'tax_rate', 'net', 'tax', 'total', 'notes', 'category', 'priority', 'phase']);
  assert.ok(Object.isFrozen(DEFAULT_LIMITS)); assert.ok(Object.isFrozen(HEADER_ALIASES.quantity));
  const suggestion = suggestImportMapping(['Supplier Name', 'Description', 'Qty', 'Unit Price', 'GST %', 'PO Number', 'Unexpected']);
  assert.deepEqual(suggestion.mapping, { supplier_name: 0, description: 1, quantity: 2, unit_price: 3, tax_rate: 4, reference: 5 });
  assert.deepEqual(suggestion.unmapped, [{ index: 6, header: 'Unexpected' }]);
  const collision = suggestImportMapping(['Description', 'Quantity', 'Qty']);
  assert.equal(collision.mapping.quantity, undefined); assert.deepEqual(collision.collisions[0].indices, [1, 2]);
  assert.equal(suggestImportMapping(['Amount', 'Item']).mapping.total, undefined, 'Ambiguous generic labels are not guessed.');

  const valid = normalized(['Fixture steel plate', '1.005']);
  assert.equal(valid.status, 'VALIDATED'); assert.equal(valid.values.quantity, '1.005');
  for (const field of ['supplier_name', 'currency', 'unit', 'unit_price', 'tax_rate', 'net', 'tax', 'total', 'date']) assert.equal(valid.values[field], null, `Missing ${field} must not be invented.`);
  assert.equal(normalized(['Fixture steel plate', '001.0050']).status, 'REJECTED', 'Extra precision is rejected rather than rounded.');
  assert.equal(normalized(['Fixture steel plate', '01.005']).fingerprint, valid.fingerprint);
  assert.equal(normalized(['Fixture steel plate', '']).status, 'REVIEW_REQUIRED');
  assert.equal(normalized(['', '2']).warnings[0].field, 'description');
  for (const quantity of [NaN, Infinity, -1, 0, '1e2', '1,000', '$2', '1.0001', '1000001', true, {}, '=1+1']) {
    const result = normalized(['Fixture part', quantity]);
    assert.equal(result.status, 'REJECTED', `Invalid quantity ${String(quantity)} must be rejected.`);
    assert.ok(result.errors.some(error => error.field === 'quantity'));
  }
  assert.equal(normalized(['Fixture part', '1'], { classification: 'GOODS_RECEIPT' }).errors[0].code, 'IMPORT_CLASSIFICATION_INVALID');
  assert.equal(normalized(['Fixture part', '1'], { classification: 'PURCHASE_ORDER' }).status, 'VALIDATED');
  assert.equal(normalized(['Fixture part', '1'], { classification: 'QUOTATION' }).status, 'VALIDATED');
  assert.equal(normalized(['Fixture part', '1'], { classification: 'SUPPLIER_INVOICE' }).status, 'VALIDATED');
  const categories = normalized(['Fixture part', '1', 'Raw material', 'high', 'Prototype'], { mapping: { description: 0, quantity: 1, category: 2, priority: 3, phase: 4 } });
  assert.equal(categories.status, 'VALIDATED'); assert.equal(categories.values.category, 'Raw material'); assert.equal(categories.values.priority, 'HIGH'); assert.equal(categories.values.phase, 'Prototype');
  assert.equal(normalized(['Fixture part', '1', 'URGENT'], { mapping: { description: 0, quantity: 1, priority: 2 } }).errors[0].code, 'IMPORT_PRIORITY_INVALID');
  for (const priority of ['P1', 'P2', 'P3', 'P4']) {
    const originalPriority = normalized(['Fixture catalog part', '1', priority], { mapping: { description: 0, quantity: 1, priority: 2 } });
    assert.equal(originalPriority.status, 'VALIDATED'); assert.equal(originalPriority.values.priority, priority, 'Original catalog priorities retain their values without mapping to modern labels.');
  }
  assert.equal(normalized(['Fixture part', '1', 'P5'], { mapping: { description: 0, quantity: 1, priority: 2 } }).errors[0].code, 'IMPORT_PRIORITY_INVALID');
  assert.deepEqual(suggestImportMapping(['Category', 'Priority', 'Procurement Phase']).mapping, { category: 0, priority: 1, phase: 2 });
  assert.equal(normalized(['Fixture part', '1'], { mapping: { description: 0, quantity: 0 } }).status, 'REJECTED');
  assert.equal(normalized(['Fixture part', '1'], { mapping: { description: 0, quantity: 70 } }).errors[0].code, 'IMPORT_MAPPING_INDEX_INVALID');
  assert.equal(normalized(['Fixture part', '1'], { sourceFormat: 'PDF' }).status, 'REVIEW_REQUIRED');
  assert.equal(normalized(['Fixture part', '1'], { requiresReview: true }).status, 'REVIEW_REQUIRED');
  assert.equal(normalizeImportRow({ cells: ['Fixture part', 2], cellMeta: { 1: { formula: true } } }, baseOptions).status, 'REVIEW_REQUIRED');
  assert.equal(normalizeImportRow({ cells: ['Fixture part', 2], errors: [{ code: 'IMPORT_ROW_WIDTH', message: 'Fixture row width differs.' }] }, baseOptions).status, 'REJECTED');

  const amounts = normalized(['Fixture part', '1.005', '1', '10'], { mapping: { description: 0, quantity: 1, unit_price: 2, tax_rate: 3 } });
  assert.equal(amounts.status, 'VALIDATED');
  assert.deepEqual(amounts.derivedFields, ['net', 'tax', 'total']);
  assert.deepEqual([amounts.values.net, amounts.values.tax, amounts.values.total], ['1.01', '0.1', '1.11']);
  const withoutTax = normalized(['Fixture part', '2', '12.50'], { mapping: { description: 0, quantity: 1, unit_price: 2 } });
  assert.equal(withoutTax.values.net, '25'); assert.equal(withoutTax.values.tax, null); assert.equal(withoutTax.values.total, null);
  const zeroTax = normalized(['Fixture part', '2', '12.50', '0'], { mapping: { description: 0, quantity: 1, unit_price: 2, tax_rate: 3 } });
  assert.equal(zeroTax.values.total, '25'); assert.equal(zeroTax.values.tax, '0');
  const explicitPercent = normalized(['Fixture part', '2', '12.50', '10%'], { mapping: { description: 0, quantity: 1, unit_price: 2, tax_rate: 3 } });
  assert.equal(explicitPercent.status, 'VALIDATED'); assert.equal(explicitPercent.values.tax_rate, '10'); assert.equal(explicitPercent.values.total, '27.5');
  const percentQuantity = normalizeImportRow({ cells: ['Fixture part', 0.1], cellMeta: { 1: { percent: true, percentScale: 1, display: '10%' } } }, baseOptions);
  assert.equal(percentQuantity.status, 'REVIEW_REQUIRED'); assert.equal(percentQuantity.values.quantity, null); assert.ok(percentQuantity.warnings.some(warning => warning.code === 'IMPORT_PERCENT_FIELD_REVIEW_REQUIRED'));
  const discrepancies = normalized(['Fixture part', '2', '12.50', '10', '26', '3', '99'], { mapping: { description: 0, quantity: 1, unit_price: 2, tax_rate: 3, net: 4, tax: 5, total: 6 } });
  assert.equal(discrepancies.status, 'REJECTED'); assert.deepEqual(discrepancies.errors.filter(error => error.code === 'INVALID_TOTAL').map(error => error.field), ['net', 'tax', 'total']);
  const totalOnly = normalized(['Fixture part', '2', '123.45'], { mapping: { description: 0, quantity: 1, total: 2 } });
  assert.equal(totalOnly.status, 'VALIDATED'); assert.equal(totalOnly.values.net, null); assert.equal(totalOnly.values.total, '123.45');
  assert.equal(normalized(['Fixture part', '1000000', '1000000000'], { mapping: { description: 0, quantity: 1, unit_price: 2 } }).errors[0].code, 'IMPORT_NUMBER_RANGE');

  const dateMapping = { description: 0, quantity: 1, date: 2, due_date: 3 };
  assert.equal(normalized(['Fixture part', '2', '2026-02-29'], { mapping: dateMapping }).status, 'REJECTED');
  assert.equal(normalized(['Fixture part', '2', '2024-02-29'], { mapping: dateMapping }).values.date, '2024-02-29');
  assert.equal(normalized(['Fixture part', '2', '01/02/2026'], { mapping: dateMapping }).status, 'REVIEW_REQUIRED');
  assert.equal(normalized(['Fixture part', '2', '01/02/2026'], { mapping: dateMapping, dateOrder: 'DMY' }).values.date, '2026-02-01');
  assert.equal(normalized(['Fixture part', '2', '01/02/2026'], { mapping: dateMapping, dateOrder: 'MDY' }).values.date, '2026-01-02');
  assert.equal(normalized(['Fixture part', '2', '2026-10-10', '2026-10-09'], { mapping: dateMapping }).errors[0].code, 'IMPORT_DUE_DATE_BEFORE_DATE');
  assert.equal(normalized(['Fixture part', '2', '2026-01-01T12:00:00Z'], { mapping: dateMapping }).status, 'REJECTED', 'A timestamp must not silently become a calendar date.');

  const csv = await extractImportFile(file('fixture.csv', '\uFEFFDescription,Qty,Notes\r\n"Fixture, plate",2,"Line one\r\nLine two"\r\nFixture rod,1,\r\n', 'text/csv'));
  assert.equal(csv.format, 'CSV'); assert.equal(csv.status, 'EXTRACTED');
  assert.equal(csv.filename, 'fixture.csv'); assert.match(csv.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(csv.sheets[0].headers, ['Description', 'Qty', 'Notes']);
  assert.deepEqual(csv.sheets[0].rows.map(row => row.sourceRow), [2, 4]);
  assert.deepEqual(csv.sheets[0].rows[0].cells, ['Fixture, plate', '2', 'Line one\nLine two']);
  const duplicateCsv = await extractImportFile(file('second-fixture.csv', 'Description,Quantity\nFixture part,2\nFixture part,02.000\n'));
  assert.equal(normalized(duplicateCsv.sheets[0].rows[0].cells).fingerprint, normalized(duplicateCsv.sheets[0].rows[1].cells).fingerprint);
  const ragged = await extractImportFile(file('ragged.csv', 'Description,Qty\nFixture part,2,unexpected\nFixture good,3\n'));
  assert.equal(ragged.sheets[0].rows.length, 2, 'A malformed row must not hide later rows.');
  assert.equal(normalizeImportRow(ragged.sheets[0].rows[0], baseOptions).status, 'REJECTED');
  assert.equal(normalizeImportRow(ragged.sheets[0].rows[1], baseOptions).status, 'VALIDATED');
  const incomplete = await extractImportFile(file('incomplete.csv', 'Description,Qty\nFixture good,1\n"Fixture unfinished,2'));
  assert.equal(incomplete.sheets[0].rows.length, 2);
  assert.ok(incomplete.sheets[0].rows[1].errors.some(error => error.code === 'IMPORT_CSV_QUOTE_UNCLOSED'));
  const oversizedField = await extractImportFile(file('long.csv', `Description,Qty\n${'x'.repeat(40)},1\nFixture good,2\n`), { limits: { maxFieldChars: 16 } });
  assert.equal(normalizeImportRow(oversizedField.sheets[0].rows[0], baseOptions).status, 'REJECTED');
  assert.equal(oversizedField.sheets[0].rows.length, 2);
  const semicolon = await extractImportFile(file('semicolon.csv', 'Description;Qty\nFixture part;1\n'), { delimiter: ';' });
  assert.equal(semicolon.sheets[0].rows[0].cells[1], '1');
  const utf16 = await extractImportFile(file('utf16.csv', Buffer.concat([Buffer.from([255, 254]), Buffer.from('Description,Qty\nFixture part,2\n', 'utf16le')])));
  assert.equal(utf16.sheets[0].rows[0].cells[1], '2');
  const headerless = await extractImportFile(file('headerless.csv', 'Fixture plate,2\nFixture rod,3\n'));
  assert.equal(headerless.sheets[0].headerRow, null); assert.equal(headerless.sheets[0].rows.length, 2, 'Headerless first records are preserved.');
  await assert.rejects(() => extractImportFile(file('many.csv', 'Description,Qty\nFixture one,1\nFixture two,2\n'), { limits: { maxRows: 1 } }), { code: 'IMPORT_ROW_COUNT_LIMIT' });
  await assert.rejects(() => extractImportFile(file('bad-encoding.csv', Buffer.from([255, 0, 128]))), { code: 'IMPORT_CSV_ENCODING' });
  await assert.rejects(() => extractImportFile(file('empty.csv', 'Description,Qty\n')), { code: 'IMPORT_NO_DATA_ROWS' });
  const headerOnlyPreview = await extractImportFile(file('header-only.csv', 'Description,Qty\n'), { preserveSourceRows: true });
  assert.equal(headerOnlyPreview.sheets[0].sourceRows.length, 1); assert.deepEqual(headerOnlyPreview.sheets[0].sourceRows[0].cells, ['Description', 'Qty']);
  const csvSourcePreview = await extractImportFile(file('preserved-source.csv', 'Fixture quotation\n\nDescription,Qty\nFixture plate,2\n'), { preserveSourceRows: true });
  assert.deepEqual(csvSourcePreview.sheets[0].sourceRows.map(row => row.sourceRow), [1, 2, 3, 4]);
  assert.equal(csvSourcePreview.sheets[0].rows[0].cells[0], 'Fixture plate');
  await assert.rejects(() => extractImportFile(file('limit.csv', 'Description,Qty\nFixture part,2'), { limits: { maxFileBytes: 8 } }), { code: 'IMPORT_FILE_LIMIT' });
  await assert.rejects(() => extractImportFile(file('limit.csv', 'Description,Qty\nFixture part,2'), { limits: { maxFileBytes: DEFAULT_LIMITS.maxFileBytes + 1 } }), { code: 'IMPORT_LIMIT_INVALID' });

  const sheet = XLSX.utils.aoa_to_sheet([['Fixture supplier quotation'], ['Description', 'Quantity', 'Unit Price', 'GST %', 'Date'], ['Fixture plate', 2, 12.5, 10, null], ['Fixture formula', 1, 1, 0, null]]);
  sheet.E3 = excelCalendarCell('2026-10-01'); sheet.E4 = excelCalendarCell('2026-10-02');
  // SheetJS BIFF output uses raw bf tokens rather than the xlsx f text.
  // cce=3, PtgInt=0x1e, integer=1 gives a genuine stored XLS formula =1.
  sheet.B4 = { t: 'n', v: 1, f: '1', bf: Buffer.from([3, 0, 0x1e, 1, 0]) };
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  for (const format of ['xlsx', 'xls']) {
    const book = await extractImportFile(file(`fixture.${format}`, workbook({ Quotation: sheet, Other: [['Description', 'Qty'], ['Fixture second sheet', 3]] }, format)));
    assert.equal(book.format, format.toUpperCase()); assert.equal(book.sheets.length, 2);
    assert.equal(book.sheets[0].headerRow, 2); assert.equal(book.sheets[0].preamble.length, 1); assert.equal(book.sheets[0].rows.length, 2);
    const map = suggestImportMapping(book.sheets[0].headers).mapping;
    const first = normalizeImportRow(book.sheets[0].rows[0], { classification: 'QUOTATION', mapping: map });
    assert.equal(first.status, 'VALIDATED'); assert.equal(first.values.date, '2026-10-01'); assert.equal(first.values.total, '27.5');
    const formula = normalizeImportRow(book.sheets[0].rows[1], { classification: 'QUOTATION', mapping: map });
    assert.equal(formula.status, 'REVIEW_REQUIRED'); assert.ok(formula.warnings.some(warning => warning.code === 'IMPORT_FORMULA_REVIEW_REQUIRED'));
  }

  // The same real XLS/XLSX bytes must represent the same calendar date in UTC,
  // Australia/Melbourne and its spring/fall DST boundary weeks. Both Excel
  // epochs are exercised through actual workbook metadata, not parser mocks.
  assert.equal(excelCalendarCell('1900-01-01').v, 1);
  assert.equal(excelCalendarCell('1900-02-28').v, 59);
  assert.equal(excelCalendarCell('1900-03-01').v, 61, 'Excel serial 60 is the fictitious 1900 leap day.');
  assert.equal(excelCalendarCell('1904-01-01', true).v, 0);
  assert.equal(excelCalendarCell('1904-02-29', true).v, 59);
  assert.equal(excelCalendarCell('1904-03-01', true).v, 60, 'Serial 60 is a real date in the 1904 system.');
  assert.equal(excelCalendarCell('2026-10-01').v, 46296);
  const dstCalendarDates = ['2024-02-29', '2026-04-04', '2026-04-05', '2026-04-06', '2026-10-03', '2026-10-04', '2026-10-05'];
  const calendarMapping = { description: 0, quantity: 1, date: 2 };
  for (const format of ['xlsx', 'xls']) {
    for (const date1904 of [false, true]) {
      const epochName = date1904 ? '1904' : '1900';
      const expectedDates = [...(date1904 ? ['1904-01-01', '1904-02-29', '1904-03-01'] : ['1900-01-01', '1900-02-28', '1900-03-01']), ...dstCalendarDates];
      const dateSheet = XLSX.utils.aoa_to_sheet([['Description', 'Qty', 'Date'], ...expectedDates.map(date => ['Fixture calendar ' + date, 1, null])]);
      expectedDates.forEach((date, index) => { dateSheet['C' + (index + 2)] = excelCalendarCell(date, date1904); });
      const extracted = await extractImportFile(file('calendar-' + epochName + '.' + format, workbook({ Calendar: dateSheet }, format, { date1904 })));
      assert.equal(extracted.sheets[0].rows.length, expectedDates.length);
      const dates = extracted.sheets[0].rows.map(row => normalizeImportRow(row, { classification: 'PLAN', mapping: calendarMapping }));
      assert.ok(dates.every(row => row.status === 'VALIDATED'), format + '/' + epochName + ' calendar dates must remain valid: ' + JSON.stringify(dates.map(row => row.errors)));
      assert.deepEqual(dates.map(row => row.values.date), expectedDates, format + '/' + epochName + ' dates must not shift with local timezone or DST.');
      assert.ok(extracted.sheets[0].rows.every(row => row.cellMeta[2].date === true));

      // Hidden time remains invalid even when the cell's display format omits
      // it. Include subsecond fractions that SSF can round below H/M/S.
      const fractions = [0.5, 1 / 24, 1 / 1440, 1 / 86400, 1 / 172800, 1 / 86400000, 1e-9];
      const timeSheet = XLSX.utils.aoa_to_sheet([['Description', 'Qty', 'Date'], ...fractions.map((_, index) => ['Fixture hidden time ' + index, 1, null])]);
      fractions.forEach((fraction, index) => {
        const cell = excelCalendarCell('2026-10-04', date1904);
        timeSheet['C' + (index + 2)] = { ...cell, v: cell.v + fraction };
      });
      const timed = await extractImportFile(file('hidden-time-' + epochName + '.' + format, workbook({ Times: timeSheet }, format, { date1904 })));
      assert.equal(timed.sheets[0].rows.length, fractions.length);
      for (const row of timed.sheets[0].rows) {
        const result = normalizeImportRow(row, { classification: 'PLAN', mapping: calendarMapping });
        assert.equal(result.status, 'REJECTED', format + '/' + epochName + ' time-bearing serial must not become a calendar date.');
        assert.ok(result.errors.some(error => error.code === 'IMPORT_DATE_INVALID'));
        assert.equal(result.values.date, null, 'Rejected time cannot fabricate a date.');
      }

      const textSheet = XLSX.utils.aoa_to_sheet([['Description', 'Qty', 'Date'], ['Fixture ambiguous DST date', 1, '04/05/2026'], ['Fixture repeated local hour', 1, '2026-04-05T02:30:00+11:00'], ['Fixture nonexistent local hour', 1, '2026-10-04T02:30:00+10:00'], ['Fixture invalid leap day', 1, '2026-02-29']]);
      const textBook = await extractImportFile(file('explicit-date-review-' + epochName + '.' + format, workbook({ Review: textSheet }, format, { date1904 })));
      const ambiguous = textBook.sheets[0].rows[0];
      const unresolved = normalizeImportRow(ambiguous, { classification: 'PLAN', mapping: calendarMapping });
      assert.equal(unresolved.status, 'REVIEW_REQUIRED'); assert.equal(unresolved.values.date, null);
      assert.ok(unresolved.warnings.some(warning => warning.code === 'IMPORT_DATE_AMBIGUOUS'));
      assert.equal(normalizeImportRow(ambiguous, { classification: 'PLAN', mapping: calendarMapping, dateOrder: 'DMY' }).values.date, '2026-05-04');
      assert.equal(normalizeImportRow(ambiguous, { classification: 'PLAN', mapping: calendarMapping, dateOrder: 'MDY' }).values.date, '2026-04-05');
      for (const row of textBook.sheets[0].rows.slice(1)) {
        const result = normalizeImportRow(row, { classification: 'PLAN', mapping: calendarMapping });
        assert.equal(result.status, 'REJECTED'); assert.ok(result.errors.some(error => error.code === 'IMPORT_DATE_INVALID'));
      }
    }
  }

  const percentSheet = XLSX.utils.aoa_to_sheet([['Description', 'Quantity', 'Unit price', 'GST %'], ['Fixture percent tax', 2, 12.5, 0.1], ['Fixture fractional tax', 2, 12.5, 0.075], ['Fixture literal percent', 2, 12.5, 10]]);
  percentSheet.D2.z = '0%'; percentSheet.D3.z = '0.0%'; percentSheet.D4.z = '0"%"';
  const percentBook = await extractImportFile(file('percent-tax.xlsx', workbook({ Data: percentSheet })));
  const percentMap = suggestImportMapping(percentBook.sheets[0].headers).mapping;
  const percentRows = percentBook.sheets[0].rows.map(row => normalizeImportRow(row, { classification: 'SUPPLIER_INVOICE', mapping: percentMap }));
  assert.deepEqual(percentRows.map(row => row.values.tax_rate), ['10', '7.5', '10']); assert.deepEqual(percentRows.map(row => row.status), ['VALIDATED', 'VALIDATED', 'VALIDATED']);
  assert.equal(percentBook.sheets[0].rows[0].cellMeta[3].display, '10%'); assert.equal(percentRows[0].values.total, '27.5');
  assert.equal(percentRows[1].values.tax, '1.88', 'Fractional percentage conversion and cent rounding are exact.');
  const sourceSheet = XLSX.utils.aoa_to_sheet([['Fixture source preamble'], ['Description', 'Quantity'], ['Fixture source plate', 2], ['', ''], ['', '']]);
  sourceSheet.A4 = { t: 'n', f: '1+1' }; sourceSheet['!merges'] = [{ s: { r: 4, c: 0 }, e: { r: 4, c: 1 } }]; sourceSheet['!ref'] = 'A1:B5';
  const sourcePreview = await extractImportFile(file('complete-source.xlsx', workbook({ Data: sourceSheet })), { preserveSourceRows: true });
  assert.deepEqual(sourcePreview.sheets[0].sourceRows.map(row => row.sourceRow), [1, 2, 3, 4, 5]);
  assert.equal(sourcePreview.sheets[0].sourceRows[3].cellMeta[0].formula, true); assert.equal(sourcePreview.sheets[0].sourceRows[3].cellMeta[0].formulaText, '1+1');
  assert.equal(sourcePreview.sheets[0].sourceRows[3].cellMeta[0].cachedValueAvailable, false); assert.equal(sourcePreview.sheets[0].sourceRows[3].cells[0], '', 'An absent numeric formula cache is unknown; NaN is never a business value.');
  assert.equal(sourcePreview.sheets[0].sourceRows[4].cellMeta[0].merged, true);
  const normalSource = await extractImportFile(file('normal-formula-source.xlsx', workbook({ Data: sourceSheet })));
  const formulaOnlyRow = normalSource.sheets[0].rows.find(row => row.sourceRow === 4);
  assert.ok(formulaOnlyRow, 'A formula-only source row must have an explicit outcome instead of disappearing.');
  const formulaOnlyOutcome = normalizeImportRow(formulaOnlyRow, baseOptions);
  assert.equal(formulaOnlyOutcome.status, 'REJECTED', 'An invalid or absent cache with missing mandatory values must not become importable by generic review.');
  assert.ok(formulaOnlyOutcome.errors.length, 'The source cache error must remain an explicit rejected-row outcome.');
  assert.equal(formulaOnlyOutcome.values.description, null); assert.equal(formulaOnlyOutcome.values.quantity, null);
  for (const field of ['description', 'quantity']) assert.ok([...formulaOnlyOutcome.errors, ...formulaOnlyOutcome.warnings].some(value => value.field === field && value.code === 'IMPORT_REQUIRED_VALUE_MISSING'), `Missing ${field} requires explicit correction.`);
  assert.ok(formulaOnlyOutcome.warnings.some(value => value.code === 'IMPORT_FORMULA_REVIEW_REQUIRED'));
  assert.equal(formulaOnlyRow.cellMeta[0].cachedValueAvailable, false);
  assert.ok(formulaOnlyRow.cells.every(value => typeof value !== 'number' || Number.isFinite(value)), 'No NaN or infinite cache value is retained.');
  assert.equal(normalSource.sheets[0].sourceRows, undefined, 'Complete source-row preservation remains an explicit preview option.');
  const leap = XLSX.utils.aoa_to_sheet([['Description', 'Qty', 'Date'], ['Fixture invalid Excel leap date', 2, 60]]); leap.C2.z = 'yyyy-mm-dd';
  const leapResult = await extractImportFile(file('excel-leap-day.xlsx', workbook({ Data: leap })));
  assert.equal(normalizeImportRow(leapResult.sheets[0].rows[0], { classification: 'PLAN', mapping: { description: 0, quantity: 1, date: 2 } }).status, 'REJECTED');
  const excessiveRange = XLSX.utils.aoa_to_sheet([['Description', 'Qty'], ['Fixture part', 1]]); excessiveRange['!ref'] = 'A1:B5000';
  await assert.rejects(() => extractImportFile(file('range.xlsx', workbook({ Data: excessiveRange }))), { code: 'IMPORT_CELL_LIMIT' });
  await assert.rejects(() => extractImportFile(file('sheets.xlsx', workbook({ One: [['Description', 'Qty'], ['Fixture part', 1]], Two: [['Description', 'Qty'], ['Fixture part', 2]] })), { limits: { maxSheets: 1 } }), { code: 'IMPORT_SHEET_LIMIT' });
  const tampered = workbook({ Data: [['Description', 'Qty'], ['Fixture part', 1]] });
  let central = tampered.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); assert.ok(central >= 0); tampered.writeUInt32LE(0, central + 24);
  await assert.rejects(() => extractImportFile(file('forged-size.xlsx', tampered)), error => error.code === 'IMPORT_WORKBOOK_LIMIT' || error.code === 'IMPORT_WORKBOOK_INVALID');
  assert.throws(() => detectImportFormat(workbook({ Data: [['Description', 'Qty'], ['Fixture part', 1]] }), 'disguised.csv'), { code: 'IMPORT_FORMAT_MISMATCH' });

  const pdf = await extractImportFile(file('fixture-quotation.pdf', await pdfFixture(), 'application/pdf'));
  assert.equal(pdf.status, 'REVIEW_REQUIRED'); assert.equal(pdf.pages.length, 2); assert.equal(pdf.sheets.length, 2);
  assert.match(pdf.pages[1].text, /Fixture part 2/);
  assert.equal(pdf.sheets.reduce((sum, source) => sum + source.rows.length, 0), 2, 'Repeated PDF headings and totals are not imported as line items.');
  for (const source of pdf.sheets) {
    const result = normalizeImportRow(source.rows[0], { classification: 'QUOTATION', mapping: suggestImportMapping(source.headers).mapping, sourceFormat: pdf.format });
    assert.equal(result.status, 'REVIEW_REQUIRED'); assert.equal(result.values.quantity, '2'); assert.equal(result.values.unit_price, '12.5');
  }
  await assert.rejects(() => extractImportFile(file('corrupt.pdf', Buffer.from('%PDF-1.7\ncorrupt fixture bytes'))), { code: 'IMPORT_PDF_INVALID' });
  await assert.rejects(async () => extractImportFile(file('encrypted.pdf', await pdfFixture({ encrypted: true }))), { code: 'IMPORT_PDF_ENCRYPTED' });
  await assert.rejects(async () => extractImportFile(file('pages.pdf', await pdfFixture()), { limits: { maxPages: 1 } }), { code: 'IMPORT_PAGE_LIMIT' });
  const scanned = await extractImportFile(file('scanned.pdf', await pdfFixture({ imageOnly: true })));
  assert.equal(scanned.needsOcr, true); assert.equal(scanned.ocr.status, 'NOT_CONFIGURED'); assert.equal(scanned.status, 'REVIEW_REQUIRED');

  let ocrCalls = 0;
  const adapter = { name: 'configured-fixture-local', extractText: async () => { ocrCalls += 1; return 'Fixture scan\nDescription Quantity\nFixture part 2'; } };
  const png = imageFixture(), jpeg = imageFixture('jpeg');
  for (const [filename, body] of [['fixture.png', png], ['fixture.jpeg', jpeg]]) {
    const image = await extractImportFile(file(filename, body), { ocrAdapter: adapter });
    assert.equal(image.status, 'REVIEW_REQUIRED'); assert.equal(image.needsOcr, true); assert.equal(image.ocr.status, 'NOT_CONFIGURED');
    assert.deepEqual(image.image, { width: 12, height: 10 });
  }
  assert.equal(ocrCalls, 0, 'Providing an adapter alone must not enable OCR or transmit sources.');
  const ocr = await extractImportFile(file('fixture.png', png), { ocrAdapter: adapter, ocrEnabled: true });
  assert.equal(ocrCalls, 1); assert.equal(ocr.ocr.status, 'EXTRACTED_REVIEW_REQUIRED'); assert.equal(ocr.status, 'REVIEW_REQUIRED'); assert.equal(ocr.sheets.length, 0, 'OCR prose must not invent mapped quantities.');
  const failedOcr = await extractImportFile(file('fixture.png', png), { ocrEnabled: true, ocrAdapter: { name: 'configured-fixture-local', extractText: async () => { throw new Error('Private provider response must not be logged.'); } } });
  assert.equal(failedOcr.ocr.status, 'FAILED'); assert.ok(failedOcr.warnings.some(warning => warning.code === 'IMPORT_OCR_FAILED')); assert.doesNotMatch(JSON.stringify(failedOcr), /Private provider/);
  // Height is only10px: width100,000 was1MP and reached the corrupt-CRC decoder.
  // Advertise more than the actual pixel budget so rejection happens before decoding.
  const hugeImage = Buffer.from(png); hugeImage.writeUInt32BE(DEFAULT_LIMITS.maxImagePixels + 1, 16);
  await assert.rejects(() => extractImportFile(file('huge.png', hugeImage)), { code: 'IMPORT_IMAGE_LIMIT' });

  const originalOcrFlag = process.env.PROCUREMENT_OCR_ENABLED;
  try {
    delete process.env.PROCUREMENT_OCR_ENABLED;
    assert.equal(ocrCapability().status, 'NOT_CONFIGURED'); assert.equal(localOcrOptions().ocrEnabled, false); assert.equal(localOcrOptions().ocrAdapter, null);
    process.env.PROCUREMENT_OCR_ENABLED = 'true';
    const capability = ocrCapability();
    assert.equal(capability.enabled, true); assert.equal(capability.provider, 'local_tesseract');
    if (capability.available) {
      const source = ocrImageFixture();
      const localImage = await extractImportFile(file('real-local-fixture.png', source), localOcrOptions());
      assert.equal(localImage.ocr.status, 'EXTRACTED_REVIEW_REQUIRED', JSON.stringify(localImage.warnings));
      assert.equal(localImage.status, 'REVIEW_REQUIRED'); assert.match(localImage.pages[0].text, /FIXTURE\s+QUOTATION/i); assert.match(localImage.pages[0].text, /steel\s+plate/i);
      assert.equal(localImage.pages[0].source.page, 1); assert.equal(localImage.pages[0].source.provider, 'local_tesseract');
      assert.ok(localImage.pages[0].confidence >= 0 && localImage.pages[0].confidence <= 100); assert.ok(localImage.pages[0].wordCount > 0);
      assert.ok(localImage.pages[0].lines.some(line => line.words?.some(word => Number.isFinite(word.left))));
      assert.equal(localImage.sheets.length, 0, 'Local OCR must not invent table mapping or business values.');
      if (capability.formats.PDF) {
        const localPdf = await extractImportFile(file('real-local-scanned-fixture.pdf', await scannedPdfFixture(source)), localOcrOptions());
        assert.equal(localPdf.ocr.status, 'EXTRACTED_REVIEW_REQUIRED', JSON.stringify(localPdf.warnings)); assert.equal(localPdf.status, 'REVIEW_REQUIRED');
        assert.match(localPdf.pages[0].text, /steel\s+plate/i); assert.equal(localPdf.ocr.pages[0].pageNumber, 1);
        const mixedPdf = await extractImportFile(file('mixed-native-scan-fixture.pdf', await scannedPdfFixture(source, 1, true)), localOcrOptions());
        assert.equal(mixedPdf.ocr.status, 'EXTRACTED_REVIEW_REQUIRED'); assert.equal(mixedPdf.pages.length, 2);
        assert.match(mixedPdf.pages[0].text, /original native PDF text remains authoritative/);
        assert.equal(mixedPdf.ocr.pages[0].pageNumber, 2); assert.equal(mixedPdf.pages[1].source.page, 2); assert.match(mixedPdf.pages[1].text, /steel\s+plate/i);
        const tooManyPages = await extractImportFile(file('local-ocr-page-limit.pdf', await scannedPdfFixture(source, OCR_LIMITS.maxPages + 1)), localOcrOptions());
        assert.equal(tooManyPages.ocr.status, 'FAILED'); assert.ok(tooManyPages.warnings.some(warning => warning.code === 'IMPORT_OCR_PAGE_LIMIT'));
        assert.equal(tooManyPages.pages.length, OCR_LIMITS.maxPages + 1, 'All original pages remain represented when OCR is limited.');
      } else console.log('Local scanned-PDF OCR fixture skipped: pdftoppm is unavailable; image OCR remains covered.');
    } else {
      assert.equal(localOcrOptions().ocrAdapter, null);
      console.log(`Real local OCR fixtures skipped: ${capability.reason}.`);
    }
  } finally {
    if (originalOcrFlag === undefined) delete process.env.PROCUREMENT_OCR_ENABLED;
    else process.env.PROCUREMENT_OCR_ENABLED = originalOcrFlag;
  }

  const uploaded = [file('good.csv', 'Description,Qty\nFixture plate,2\n'), file('broken.pdf', Buffer.from('%PDF-1.7\ncorrupt')), file('unknown.zip', Buffer.from('not supported')), file('scan.png', png)];
  const outcomes = await Promise.all(uploaded.map(async input => {
    try { return { filename: input.filename, status: (await extractImportFile(input)).status }; }
    catch (error) { assert.ok(error instanceof ImportExtractionError); return { filename: input.filename, status: 'REJECTED', code: error.code }; }
  }));
  assert.deepEqual(outcomes.map(outcome => outcome.filename), uploaded.map(input => input.filename));
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['EXTRACTED', 'REJECTED', 'REJECTED', 'REVIEW_REQUIRED']);
  console.log('Procurement import extraction fixtures passed: CSV/XLS/XLSX/PDF/PNG/JPEG, strict mapping, exact amounts, bounded parsing and explicit local OCR review.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
