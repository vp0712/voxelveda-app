'use strict';

// This module extracts private source files. It never writes business records,
// invokes a mail transport, evaluates workbook formulae, or chooses an OCR provider.
const crypto = require('node:crypto');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { TextDecoder } = require('node:util');
const { inflateRawSync } = require('node:zlib');

const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxZipEntryBytes: 16 * 1024 * 1024,
  maxZipEntries: 2048,
  maxSheets: 12,
  maxRows: 2000,
  maxCells: 20000,
  maxColumns: 64,
  maxRowBytes: 64 * 1024,
  maxFieldChars: 4000,
  maxPages: 50,
  maxTextChars: 250000,
  maxImagePixels: 12000000,
  timeoutMs: 15000,
  workerMemoryMb: 192
});
const IMPORT_FIELDS = Object.freeze([
  'supplier_name', 'reference', 'date', 'due_date', 'currency', 'description',
  'item_code', 'quantity', 'unit', 'unit_price', 'tax_rate', 'net', 'tax', 'total', 'notes',
  'category', 'priority', 'phase'
]);
const HEADER_ALIASES = Object.freeze(Object.fromEntries(Object.entries({
  supplier_name: ['supplier', 'supplier name', 'vendor', 'vendor name'],
  reference: ['reference', 'document reference', 'document number', 'invoice no', 'invoice number', 'quotation no', 'quotation number', 'quote no', 'po no', 'po number', 'purchase order number', 'order no'],
  date: ['date', 'document date', 'issue date', 'issued date', 'invoice date', 'quotation date', 'order date', 'po date'],
  due_date: ['due date', 'delivery date', 'expected date', 'required date'],
  currency: ['currency', 'currency code'],
  description: ['description', 'item description', 'product description', 'material description'],
  item_code: ['item code', 'product code', 'part code', 'part no', 'part number', 'sku', 'material code'],
  quantity: ['quantity', 'qty', 'ordered quantity', 'quantity ordered', 'order qty', 'required quantity'],
  unit: ['unit', 'units', 'uom', 'unit of measure'],
  unit_price: ['unit price', 'unit cost', 'price', 'rate', 'cost per unit', 'estimated unit price'],
  tax_rate: ['tax rate', 'tax percent', 'tax %', 'gst rate', 'gst percent', 'gst %'],
  net: ['net', 'net amount', 'subtotal', 'sub total', 'line subtotal', 'amount ex gst', 'amount excluding tax'],
  tax: ['tax', 'tax amount', 'gst', 'gst amount'],
  total: ['total', 'line total', 'gross', 'gross amount', 'amount inc gst', 'amount including tax'],
  notes: ['notes', 'note', 'comments', 'remarks'],
  category: ['category', 'item category', 'material category'],
  priority: ['priority', 'item priority', 'urgency'],
  phase: ['phase', 'project phase', 'procurement phase']
}).map(([key, aliases]) => [key, Object.freeze(aliases)])));
const CLASSIFICATIONS = new Set(['PLAN', 'QUOTATION', 'PURCHASE_ORDER', 'SUPPLIER_INVOICE']);
const FIELD_MAX = Object.freeze({ supplier_name: 255, reference: 120, description: 255, item_code: 120, unit: 30, notes: 4000, category: 120, priority: 8, phase: 120 });
const DECIMAL_FIELDS = Object.freeze({ quantity: { scale: 3, max: '1000000', positive: true }, unit_price: { scale: 2, max: '1000000000' }, tax_rate: { scale: 2, max: '100' }, net: { scale: 2, max: '1000000000000' }, tax: { scale: 2, max: '1000000000000' }, total: { scale: 2, max: '1000000000000' } });

class ImportExtractionError extends Error {
  constructor(message, code = 'IMPORT_EXTRACTION_FAILED', details = null, statusCode = 422) {
    super(message);
    this.name = 'ImportExtractionError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
function fail(code, message, details = null, statusCode = 422) { throw new ImportExtractionError(message, code, details, statusCode); }
function issue(field, code, message) { return { field, code, message }; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function headerKey(value) { return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[%]/g, ' percent ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '); }
const ALIAS_FIELDS = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) for (const alias of aliases) ALIAS_FIELDS.set(headerKey(alias), field);

function suggestImportMapping(headers) {
  if (!Array.isArray(headers)) fail('IMPORT_HEADERS_INVALID', 'Import headers must be an array.');
  const positions = new Map(), unmapped = [];
  headers.forEach((value, index) => {
    const field = ALIAS_FIELDS.get(headerKey(value));
    if (field) positions.set(field, [...(positions.get(field) || []), index]);
    else unmapped.push({ index, header: String(value ?? '') });
  });
  const mapping = {}, collisions = [];
  for (const [field, indices] of positions) {
    if (indices.length === 1) mapping[field] = indices[0];
    else collisions.push({ field, indices, code: 'IMPORT_HEADER_AMBIGUOUS', message: `Choose one column for ${field.replace(/_/g, ' ')}.` });
  }
  return { mapping, collisions, unmapped };
}

function boundedLimits(input = {}) {
  const result = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_LIMITS) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) fail('IMPORT_LIMIT_INVALID', `Invalid import limit: ${key}.`, { field: key }, 400);
    result[key] = value;
  }
  return result;
}
function detectImportFormat(buffer, filename = '', mimeType = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail('IMPORT_FILE_EMPTY', 'The uploaded file is empty.');
  const extension = path.extname(String(filename).replace(/\\/g, '/')).toLowerCase();
  let detected;
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') detected = 'PDF';
  else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) detected = 'PNG';
  else if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) detected = 'JPEG';
  else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))) detected = 'XLS';
  else if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) detected = 'XLSX';
  else if (extension === '.csv' || (!extension && /^(?:text\/csv|application\/csv)(?:;|$)/i.test(String(mimeType)))) detected = 'CSV';
  else fail('IMPORT_FORMAT_UNSUPPORTED', 'Use a CSV, XLS, XLSX, PDF, PNG or JPEG source file.');
  const allowed = { CSV: ['.csv'], XLS: ['.xls'], XLSX: ['.xlsx'], PDF: ['.pdf'], PNG: ['.png'], JPEG: ['.jpg', '.jpeg'] };
  if (extension && !allowed[detected].includes(extension)) fail('IMPORT_FORMAT_MISMATCH', 'The file contents do not match its filename format.', { extension, detected });
  return detected;
}

function zipPreflight(buffer, limits) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) fail('IMPORT_WORKBOOK_INVALID', 'The XLSX archive is incomplete.');
  const entries = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== entries || entries === 65535 || size === 0xffffffff || start === 0xffffffff) fail('IMPORT_WORKBOOK_UNSUPPORTED', 'Split or ZIP64 workbook archives are not supported.');
  if (entries > limits.maxZipEntries || start + size > end) fail('IMPORT_WORKBOOK_LIMIT', 'The workbook archive exceeds its safe parsing limit.');
  let offset = start, expanded = 0;
  const names = new Set();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > start + size || buffer.readUInt32LE(offset) !== 0x02014b50) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive directory is invalid.');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20), bytes = buffer.readUInt32LE(offset + 24);
    const nameBytes = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), localOffset = buffer.readUInt32LE(offset + 42);
    if ((flags & 1) || ![0, 8].includes(method)) fail('IMPORT_WORKBOOK_UNSUPPORTED', 'Encrypted or unsupported workbook compression is not supported.');
    if (offset + 46 + nameBytes + extra + comment > start + size || localOffset + 30 > start || bytes === 0xffffffff || compressed === 0xffffffff) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive entry is invalid.');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive entry is missing.');
    const localName = buffer.readUInt16LE(localOffset + 26), localExtra = buffer.readUInt16LE(localOffset + 28);
    if (localOffset + 30 + localName + localExtra + compressed > start) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive entry extends outside its data.');
    if (bytes > limits.maxZipEntryBytes || (expanded += bytes) > limits.maxExpandedBytes) fail('IMPORT_WORKBOOK_LIMIT', 'The expanded workbook exceeds its safe parsing limit.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8');
    if (buffer.subarray(localOffset + 30, localOffset + 30 + localName).toString('utf8') !== name || buffer.readUInt16LE(localOffset + 8) !== method) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive entry metadata does not agree.');
    const packed = buffer.subarray(localOffset + 30 + localName + localExtra, localOffset + 30 + localName + localExtra + compressed);
    try {
      // Do not trust ZIP directory sizes: a forged size must not allow an
      // unbounded native allocation when SheetJS decompresses the same entry.
      const unpacked = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, Math.min(bytes, limits.maxZipEntryBytes)) });
      if (unpacked.length !== bytes) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive entry size is invalid.');
    } catch (error) {
      if (error instanceof ImportExtractionError) throw error;
      fail('IMPORT_WORKBOOK_LIMIT', 'The workbook entry exceeds its declared or safe expanded size.');
    }
    if (names.has(name)) fail('IMPORT_WORKBOOK_INVALID', 'The workbook archive contains duplicate entries.');
    names.add(name);
    offset += 46 + nameBytes + extra + comment;
  }
  if (offset !== start + size || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) fail('IMPORT_WORKBOOK_INVALID', 'The archive is not an XLSX workbook.');
}

function decodeCsv(buffer) {
  try {
    if (buffer.length >= 2 && buffer[0] === 255 && buffer[1] === 254) return new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
    if (buffer.length >= 2 && buffer[0] === 254 && buffer[1] === 255) return new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch { fail('IMPORT_CSV_ENCODING', 'The CSV must use UTF-8 or a UTF-16 byte-order mark.'); }
}
function parseCsv(buffer, limits, delimiter = ',', preserveSourceRows = false) {
  if (![',', ';', '\t'].includes(delimiter)) fail('IMPORT_DELIMITER_INVALID', 'Choose a comma, semicolon or tab CSV delimiter.');
  const text = decodeCsv(buffer);
  if (text.includes('\0')) fail('IMPORT_CSV_BINARY', 'The CSV contains binary data.');
  const rows = [];
  let cells = [], field = '', inQuotes = false, afterQuote = false, rowErrors = [], physicalLine = 1, sourceRow = 1, rowBytes = 0, fieldLength = 0;
  function addError(code, message) { if (!rowErrors.some(error => error.code === code)) rowErrors.push(issue(null, code, message)); }
  function append(character) {
    fieldLength += character.length;
    if (fieldLength <= limits.maxFieldChars) field += character;
    else addError('IMPORT_FIELD_LIMIT', 'A field exceeds the import character limit.');
  }
  function endField() {
    if (cells.length < limits.maxColumns) cells.push(field);
    else addError('IMPORT_COLUMN_LIMIT', 'The row has too many columns.');
    field = ''; fieldLength = 0; afterQuote = false;
  }
  function endRow() {
    endField();
    if (rowBytes > limits.maxRowBytes) addError('IMPORT_ROW_LIMIT', 'The CSV row exceeds the import byte limit.');
    if (preserveSourceRows || rowErrors.length || cells.some(cell => cell.trim())) rows.push({ sourceRow, cells, ...(rowErrors.length ? { errors: rowErrors } : {}) });
    if (rows.length > limits.maxRows + 20) fail('IMPORT_ROW_COUNT_LIMIT', 'The CSV contains too many rows. No rows from this file were accepted.');
    cells = []; rowErrors = []; rowBytes = 0; sourceRow = physicalLine + 1;
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]; rowBytes += Buffer.byteLength(character);
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { append('"'); index += 1; rowBytes += 1; }
        else { inQuotes = false; afterQuote = true; }
      } else {
        if (character === '\r' && text[index + 1] === '\n') { append('\n'); index += 1; rowBytes += 1; physicalLine += 1; }
        else { append(character); if (character === '\n' || character === '\r') physicalLine += 1; }
      }
    } else if (character === delimiter) endField();
    else if (character === '\r' || character === '\n') {
      endRow(); if (character === '\r' && text[index + 1] === '\n') index += 1;
      physicalLine += 1; sourceRow = physicalLine;
    } else if (character === '"') {
      if (!fieldLength && !afterQuote) inQuotes = true;
      else { addError('IMPORT_CSV_QUOTE_INVALID', 'A quote must begin a quoted CSV field.'); append(character); }
    } else {
      if (afterQuote) addError('IMPORT_CSV_QUOTE_INVALID', 'A closing quote must be followed by a delimiter or line ending.');
      append(character);
    }
  }
  if (inQuotes) addError('IMPORT_CSV_QUOTE_UNCLOSED', 'The final quoted CSV field is incomplete.');
  if (fieldLength || cells.length || rowErrors.length || afterQuote) endRow();
  return rows;
}

function makeSheet(name, matrix, limits, requestedHeaderRow, preserveSourceRows = false) {
  if (!matrix.length) return { name, headers: [], headerRow: null, columnCount: 0, rows: [], preamble: [], ...(preserveSourceRows ? { sourceRows: [] } : {}) };
  let headerIndex = -1;
  if (requestedHeaderRow !== undefined) {
    if (!Number.isSafeInteger(requestedHeaderRow) || requestedHeaderRow < 1) fail('IMPORT_HEADER_ROW_INVALID', 'The header row must be a positive row number.');
    headerIndex = matrix.findIndex(row => row.sourceRow === requestedHeaderRow);
    if (headerIndex < 0) fail('IMPORT_HEADER_ROW_INVALID', 'The requested header row is not present.');
  } else {
    headerIndex = matrix.slice(0, 20).findIndex(row => {
      const suggestion = suggestImportMapping(row.cells);
      return !row.errors?.length && Object.keys(suggestion.mapping).length + suggestion.collisions.length >= 2 && ('quantity' in suggestion.mapping || 'description' in suggestion.mapping || suggestion.collisions.some(collision => ['quantity', 'description'].includes(collision.field)));
    });
  }
  const headers = headerIndex >= 0 ? matrix[headerIndex].cells.map(value => String(value ?? '')) : [];
  const rows = headerIndex >= 0 ? matrix.slice(headerIndex + 1) : matrix;
  if (rows.length > limits.maxRows) fail('IMPORT_ROW_COUNT_LIMIT', 'The source contains too many data rows. No rows from this file were accepted.');
  const width = headers.length || Math.max(...rows.map(row => row.cells.length), 0);
  let cellCount = 0;
  for (const row of rows) {
    if (row.cells.length > limits.maxColumns || (cellCount += row.cells.length) > limits.maxCells) fail('IMPORT_CELL_LIMIT', 'The source contains too many cells. No rows from this file were accepted.');
    if (headers.length && row.cells.length !== width && row.cells.some(value => String(value ?? '').trim())) row.errors = [...(row.errors || []), issue(null, 'IMPORT_ROW_WIDTH', 'The row has a different number of columns from its headers.')];
  }
  if (preserveSourceRows && matrix.reduce((count, row) => count + row.cells.length, 0) > limits.maxCells) fail('IMPORT_CELL_LIMIT', 'The complete source contains too many cells for a faithful preview.');
  return { name, headers, headerRow: headerIndex >= 0 ? matrix[headerIndex].sourceRow : null, columnCount: width, rows, preamble: headerIndex >= 0 ? matrix.slice(0, headerIndex) : [], ...(preserveSourceRows ? { sourceRows: matrix } : {}) };
}

function percentageFormat(format) {
  // Quoted or escaped percent signs are literal text, not numeric multipliers.
  const sections = String(format || '').replace(/"(?:[^"]|"")*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').split(';').slice(0, 3).filter(section => /[0#?]/.test(section));
  const counts = sections.map(section => (section.match(/%/g) || []).length);
  return { percent: counts.some(count => count > 0), percentScale: counts.length && counts.every(count => count === 1) ? 1 : null };
}
function extractWorkbook(buffer, format, limits, headerRow, preserveSourceRows = false) {
  if (format === 'XLSX') zipPreflight(buffer, limits);
  const XLSX = require('xlsx');
  let book;
  try { book = XLSX.read(buffer, { type: 'buffer', dense: true, cellDates: false, cellFormula: true, cellHTML: false, cellNF: true, cellText: false, sheetRows: limits.maxRows + 21, bookVBA: false, bookDeps: false, WTF: false }); }
  catch { fail('IMPORT_WORKBOOK_INVALID', 'The spreadsheet could not be parsed as a workbook.'); }
  if (!book.SheetNames?.length) fail('IMPORT_WORKBOOK_EMPTY', 'The workbook has no worksheets.');
  if (book.SheetNames.length > limits.maxSheets) fail('IMPORT_SHEET_LIMIT', 'The workbook contains too many worksheets.');
  const sheets = []; let totalCells = 0;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name], matrix = [];
    if (!sheet?.['!ref']) { sheets.push(makeSheet(name, [], limits, headerRow, preserveSourceRows)); continue; }
    let range;
    try { range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']); }
    catch { fail('IMPORT_WORKBOOK_INVALID', 'A worksheet has an invalid cell range.'); }
    if (range.e.c >= limits.maxColumns || range.e.r - range.s.r + 1 > limits.maxRows + 20) fail('IMPORT_CELL_LIMIT', 'A worksheet range exceeds the import limit. No rows from this file were accepted.');
    for (let rowNumber = range.s.r; rowNumber <= range.e.r; rowNumber += 1) {
      const cells = [], cellMeta = {}, errors = [];
      for (let col = 0; col <= range.e.c; col += 1) {
        const cell = sheet['!data']?.[rowNumber]?.[col] || sheet[XLSX.utils.encode_cell({ r: rowNumber, c: col })];
        let value = cell?.v ?? '';
        if (cell?.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
          // Any fractional Excel serial contains time, including subsecond
          // fractions that SSF may round away in its H/M/S fields.
          const calendarSerial = Number.isFinite(value) && Number.isInteger(value);
          const parts = calendarSerial && XLSX.SSF.parse_date_code(value, { date1904: !!book.Workbook?.WBProps?.date1904 });
          const date = parts && `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
          const parsed = date && new Date(`${date}T00:00:00Z`);
          if (!parts || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || parts.H || parts.M || parts.S) {
            errors.push(issue(null, 'IMPORT_DATE_INVALID', 'A spreadsheet date is invalid or contains a time; confirm its calendar date.')); value = '';
          } else { value = date; cellMeta[col] = { date: true }; }
        } else if (cell?.t === 'd') {
          if (!(value instanceof Date) || Number.isNaN(value.getTime())) { errors.push(issue(null, 'IMPORT_DATE_INVALID', 'A spreadsheet date is invalid.')); value = ''; }
          else { value = value.toISOString(); cellMeta[col] = { date: true }; }
        }
        if (cell?.t === 'e') errors.push(issue(null, 'IMPORT_SPREADSHEET_CELL_ERROR', 'A spreadsheet cell contains an error.'));
        const percent = cell?.t === 'n' ? percentageFormat(cell.z) : { percent: false };
        if (percent.percent) cellMeta[col] = { ...(cellMeta[col] || {}), ...percent };
        if (cell?.f) {
          // SheetJS represents an absent numeric formula cache as NaN. It is
          // an unknown value, not a numeric result that can be persisted.
          const cachedValueAvailable = cell.v !== undefined && cell.v !== null && !(typeof cell.v === 'number' && !Number.isFinite(cell.v)) && !(cell.t === 'n' && cell.v === '');
          cellMeta[col] = { ...(cellMeta[col] || {}), formula: true, formulaText: String(cell.f), cachedValueAvailable };
          if (!cachedValueAvailable) value = '';
          if (String(cell.f).length > limits.maxFieldChars) errors.push(issue(null, 'IMPORT_FIELD_LIMIT', 'A spreadsheet formula exceeds the import character limit.'));
        }
        if (sheet['!merges']?.some(merge => rowNumber >= merge.s.r && rowNumber <= merge.e.r && col >= merge.s.c && col <= merge.e.c)) cellMeta[col] = { ...(cellMeta[col] || {}), merged: true };
        if (cell && (preserveSourceRows || percent.percent) && cell.v !== undefined && cell.v !== null && cellMeta[col]?.cachedValueAvailable !== false) {
          let display;
          try { display = XLSX.utils.format_cell(cell); } catch { errors.push(issue(null, 'IMPORT_DISPLAY_INVALID', 'A saved spreadsheet value could not be formatted faithfully.')); }
          if (display !== undefined) {
            if (String(display).length > limits.maxFieldChars) errors.push(issue(null, 'IMPORT_FIELD_LIMIT', 'A formatted spreadsheet field exceeds the import character limit.'));
            else cellMeta[col] = { ...(cellMeta[col] || {}), display: String(display) };
          }
        }
        if (typeof value === 'string' && value.length > limits.maxFieldChars) errors.push(issue(null, 'IMPORT_FIELD_LIMIT', 'A spreadsheet field exceeds the import character limit.'));
        cells.push(value);
      }
      if (preserveSourceRows || cells.some(value => value !== '' && value !== null) || Object.values(cellMeta).some(metadata => metadata.formula) || errors.length) {
        if ((totalCells += cells.length) > limits.maxCells) fail('IMPORT_CELL_LIMIT', 'The workbook contains too many cells. No rows from this file were accepted.');
        matrix.push({ sourceRow: rowNumber + 1, cells, ...(Object.keys(cellMeta).length ? { cellMeta } : {}), ...(errors.length ? { errors } : {}) });
      }
    }
    sheets.push(makeSheet(name, matrix, limits, headerRow, preserveSourceRows));
  }
  return { sheets, pages: [], warnings: [] };
}

function pdfLines(items) {
  const lines = [];
  for (const item of items.filter(item => typeof item.str === 'string' && item.str.trim()).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const y = item.transform[5], x = item.transform[4];
    let line = lines.find(candidate => Math.abs(candidate.y - y) <= 2);
    if (!line) { line = { y, segments: [] }; lines.push(line); }
    line.segments.push({ x, width: Math.max(0, Number(item.width) || 0), text: item.str });
  }
  return lines.sort((a, b) => b.y - a.y).map((line, index) => ({ lineNumber: index + 1, y: line.y, segments: line.segments.sort((a, b) => a.x - b.x), text: line.segments.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim() }));
}
function lineCells(line) {
  const groups = [];
  for (const segment of line.segments) {
    const previous = groups[groups.length - 1];
    if (previous && segment.x - previous.end < 12) { previous.text += ` ${segment.text}`; previous.end = Math.max(previous.end, segment.x + segment.width); }
    else groups.push({ x: segment.x, end: segment.x + segment.width, text: segment.text });
  }
  return groups;
}
function pdfCandidateSheet(page, limits) {
  let header = null, headers = [], anchors = [], rows = [];
  for (const line of page.lines) {
    const groups = lineCells(line), suggestion = suggestImportMapping(groups.map(group => group.text));
    const isHeader = Object.keys(suggestion.mapping).length >= 2 && 'quantity' in suggestion.mapping && ('description' in suggestion.mapping || 'item_code' in suggestion.mapping);
    if (isHeader) {
      if (!header) { header = line.lineNumber; headers = groups.map(group => group.text); anchors = groups.map(group => group.x); }
      else if (headers.join('|') !== groups.map(group => group.text).join('|')) break;
      continue;
    }
    if (!header) continue;
    // Stop at document totals; they are document metadata, not purchasing lines.
    if (/^(?:sub\s*total|grand\s+total|total|gst|tax|balance\s+due|terms|notes)\b/i.test(line.text)) break;
    const cells = headers.map(() => '');
    for (const segment of line.segments) {
      let index = 0;
      for (let col = 1; col < anchors.length; col += 1) if (segment.x >= anchors[col] - 6) index = col;
      cells[index] = `${cells[index]} ${segment.text}`.trim();
    }
    if (cells.some(Boolean)) rows.push({ sourceRow: line.lineNumber, sourcePage: page.pageNumber, cells, warnings: [issue(null, 'IMPORT_PDF_REVIEW_REQUIRED', 'Confirm PDF column boundaries and values against the source document.')] });
    if (rows.length > limits.maxRows) fail('IMPORT_ROW_COUNT_LIMIT', 'The PDF table contains too many rows.');
  }
  return { name: `Page ${page.pageNumber}`, headers, headerRow: header, columnCount: headers.length, rows, preamble: [], requiresReview: true };
}
async function extractPdf(buffer, limits) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  try {
    const pdf = await task.promise;
    if (!pdf.numPages) fail('IMPORT_PDF_INVALID', 'The PDF has no valid pages.');
    if (pdf.numPages > limits.maxPages) fail('IMPORT_PAGE_LIMIT', 'The PDF contains too many pages.');
    const pages = []; let chars = 0, cells = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber), layer = await page.getTextContent();
      const lines = pdfLines(layer.items), text = lines.map(line => line.text).join('\n');
      if ((chars += text.length) > limits.maxTextChars) fail('IMPORT_TEXT_LIMIT', 'The extracted PDF text exceeds the import limit.');
      pages.push({ pageNumber, text, lines }); page.cleanup();
    }
    const sheets = pages.map(page => pdfCandidateSheet(page, limits));
    for (const sheet of sheets) for (const row of sheet.rows) if ((cells += row.cells.length) > limits.maxCells) fail('IMPORT_CELL_LIMIT', 'The PDF contains too many candidate cells.');
    const ocrPageNumbers = pages.filter(page => !page.text.trim()).map(page => page.pageNumber);
    return { pages, sheets, warnings: [issue(null, 'IMPORT_PDF_REVIEW_REQUIRED', 'Review the PDF extraction and confirm its mapping before creating records.'), ...(ocrPageNumbers.length ? [issue(null, 'IMPORT_OCR_REQUIRED', 'Some PDF pages have no extractable text and require manual entry or explicitly configured OCR.')] : [])], needsOcr: ocrPageNumbers.length > 0, ocrPageNumbers };
  } catch (error) {
    if (error instanceof ImportExtractionError) throw error;
    if (error.name === 'PasswordException') fail('IMPORT_PDF_ENCRYPTED', 'Password-protected PDFs cannot be extracted. Upload an authorised unlocked copy.');
    fail('IMPORT_PDF_INVALID', 'The PDF could not be parsed.');
  } finally { await task.destroy().catch(() => {}); }
}

function imageDimensions(buffer, format, limits) {
  let width, height;
  if (format === 'PNG') {
    if (buffer.length < 33 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') fail('IMPORT_IMAGE_INVALID', 'The PNG image header is invalid.');
    width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
  } else {
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 255) fail('IMPORT_IMAGE_INVALID', 'The JPEG marker is invalid.');
      while (buffer[offset] === 255) offset += 1;
      const marker = buffer[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > buffer.length) break;
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || offset + size > buffer.length) fail('IMPORT_IMAGE_INVALID', 'The JPEG segment is incomplete.');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (size < 8) fail('IMPORT_IMAGE_INVALID', 'The JPEG size is invalid.');
        height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); break;
      }
      offset += size;
    }
  }
  if (!width || !height || width * height > limits.maxImagePixels) fail('IMPORT_IMAGE_LIMIT', 'The image is invalid or exceeds the pixel limit.');
  return { width, height };
}
async function extractInWorker(data) {
  const buffer = Buffer.from(data.buffer), { format, limits, headerRow, delimiter, preserveSourceRows } = data;
  if (format === 'CSV') return { sheets: [makeSheet('CSV', parseCsv(buffer, limits, delimiter, preserveSourceRows), limits, headerRow, preserveSourceRows)], pages: [], warnings: [] };
  if (format === 'XLS' || format === 'XLSX') return extractWorkbook(buffer, format, limits, headerRow, preserveSourceRows);
  if (format === 'PDF') return extractPdf(buffer, limits);
  const dimensions = imageDimensions(buffer, format, limits);
  try {
    const image = await require('@napi-rs/canvas').loadImage(buffer);
    if (image.width !== dimensions.width || image.height !== dimensions.height) fail('IMPORT_IMAGE_INVALID', 'The image dimensions could not be verified.');
  } catch { fail('IMPORT_IMAGE_INVALID', 'The image could not be decoded.'); }
  return { sheets: [], pages: [], image: dimensions, needsOcr: true, warnings: [issue(null, 'IMPORT_OCR_REQUIRED', 'This image requires manual entry or explicitly configured OCR.')] };
}
function workerExtract(buffer, format, limits, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { task: 'procurement-extraction', buffer, format, limits, headerRow: options.headerRow, delimiter: options.delimiter, preserveSourceRows: options.preserveSourceRows === true },
      resourceLimits: { maxOldGenerationSizeMb: limits.workerMemoryMb, maxYoungGenerationSizeMb: 24 },
      stdout: true, stderr: true
    });
    // Parser diagnostics must not expose private source content in server logs.
    worker.stdout.resume(); worker.stderr.resume();
    let completed = false;
    const finish = (error, result) => {
      if (completed) return;
      completed = true; clearTimeout(timer);
      worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new ImportExtractionError('Source extraction timed out. The source is retained for controlled retry.', 'IMPORT_PARSE_TIMEOUT')), limits.timeoutMs);
    worker.once('message', message => message.ok ? finish(null, message.result) : finish(new ImportExtractionError(message.error.message, message.error.code, message.error.details, message.error.statusCode)));
    worker.once('error', () => finish(new ImportExtractionError('Source extraction exceeded its runtime limit or failed. The source is retained.', 'IMPORT_PARSE_FAILED')));
    worker.once('exit', code => { if (!completed) finish(new ImportExtractionError('Source extraction ended before producing a result.', code ? 'IMPORT_PARSE_FAILED' : 'IMPORT_PARSE_INCOMPLETE')); });
  });
}
async function optionalOcr(buffer, result, options, limits, metadata) {
  const provider = typeof options.ocrAdapter?.name === 'string' ? options.ocrAdapter.name.trim() : String(options.ocrProvider || '').trim();
  const extractText = typeof options.ocrAdapter === 'function' ? options.ocrAdapter : options.ocrAdapter?.extractText;
  result.ocr = { requested: options.ocrEnabled === true, provider: options.ocrEnabled === true && provider ? provider : null, status: 'NOT_CONFIGURED' };
  if (!result.needsOcr || options.ocrEnabled !== true || !provider || typeof extractText !== 'function' || (typeof options.ocrAdapter?.supportsFormat === 'function' && !options.ocrAdapter.supportsFormat(metadata.format))) return result;
  const abort = new AbortController(); let timer;
  try {
    const output = await Promise.race([
      Promise.resolve().then(() => extractText.call(typeof options.ocrAdapter === 'function' ? undefined : options.ocrAdapter, buffer, { ...metadata, pageCount: metadata.format === 'PDF' ? result.pages.length : 1, pageNumbers: result.ocrPageNumbers, signal: abort.signal, limits })),
      new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new ImportExtractionError('OCR timed out. Review the retained source or retry.', 'IMPORT_OCR_TIMEOUT')); }, limits.timeoutMs); })
    ]);
    const pages = typeof output === 'string' ? [{ pageNumber: 1, text: output }] : output?.pages;
    if (!Array.isArray(pages) || pages.length > limits.maxPages || !pages.length || pages.some(page => typeof page.text !== 'string') || !pages.some(page => page.text.trim()) || pages.reduce((sum, page) => sum + page.text.length, 0) > limits.maxTextChars) fail('IMPORT_OCR_RESULT_INVALID', 'The OCR result is empty, invalid or exceeds its limit.');
    const extractedPages = pages.map((page, index) => {
      const pageNumber = page.pageNumber ?? result.ocrPageNumbers?.[index] ?? index + 1;
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > (metadata.format === 'PDF' ? result.pages.length : 1)) fail('IMPORT_OCR_RESULT_INVALID', 'OCR returned an invalid source page reference.');
      return { pageNumber, text: page.text, confidence: typeof page.confidence === 'number' ? page.confidence : null, wordCount: Number.isSafeInteger(page.wordCount) ? page.wordCount : null, source: { kind: 'OCR', page: pageNumber, provider }, lines: Array.isArray(page.lines) ? page.lines : page.text.split(/\r?\n/).filter(Boolean).map((text, line) => ({ lineNumber: line + 1, text })) };
    });
    const byPage = new Map(extractedPages.map(page => [page.pageNumber, page]));
    if (byPage.size !== extractedPages.length || (result.ocrPageNumbers || [1]).some(page => !byPage.has(page))) fail('IMPORT_OCR_RESULT_INVALID', 'OCR did not return every requested source page.');
    const mergedPages = metadata.format === 'PDF' ? result.pages.map(page => byPage.get(page.pageNumber) || page) : extractedPages;
    if (mergedPages.reduce((sum, page) => sum + page.text.length, 0) > limits.maxTextChars) fail('IMPORT_OCR_RESULT_LIMIT', 'The complete source text exceeds the import limit.');
    result.pages = mergedPages;
    result.needsOcr = false;
    result.ocr.status = 'EXTRACTED_REVIEW_REQUIRED';
    result.ocr.pages = extractedPages.map(page => ({ pageNumber: page.pageNumber, confidence: page.confidence, wordCount: page.wordCount }));
    result.warnings = [...result.warnings.filter(warning => warning.code !== 'IMPORT_OCR_REQUIRED'), issue(null, 'IMPORT_OCR_REVIEW_REQUIRED', 'Verify all OCR text and enter or map its values before confirming records.')];
    return result;
  } catch (error) {
    result.ocr.status = error.code === 'IMPORT_OCR_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED';
    const knownCode = /^IMPORT_OCR_[A-Z_]+$/.test(String(error.code || ''));
    result.warnings.push(issue(null, knownCode ? error.code : 'IMPORT_OCR_FAILED', error instanceof ImportExtractionError || (knownCode && error.safeImportMessage === true) ? error.message : 'OCR failed. The original source remains available for review or retry.'));
    return result;
  } finally { clearTimeout(timer); }
}
async function extractImportFile(file, options = {}) {
  const limits = boundedLimits(options.limits);
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail('IMPORT_FILE_EMPTY', 'The uploaded file is empty.');
  if (buffer.length > limits.maxFileBytes) fail('IMPORT_FILE_LIMIT', 'The uploaded file exceeds the source size limit.', { maxBytes: limits.maxFileBytes }, 413);
  const filename = String(file.filename ?? file.originalname ?? '');
  const mimeType = String(file.mimeType ?? file.mimetype ?? 'application/octet-stream');
  const metadata = { filename, mimeType, bytes: buffer.length, sha256: digest(buffer), format: detectImportFormat(buffer, filename, mimeType) };
  try {
    let result = await workerExtract(buffer, metadata.format, limits, options);
    result = await optionalOcr(buffer, result, options, limits, metadata);
    const requiresReview = ['PDF', 'PNG', 'JPEG'].includes(metadata.format);
    const hasRows = result.sheets.some(sheet => sheet.rows.length);
    const readableSource = options.preserveSourceRows === true && result.sheets.some(sheet => sheet.sourceRows?.some(row => row.cells.some(value => String(value ?? '').trim()) || Object.values(row.cellMeta || {}).some(cell => cell.formula)));
    if (!hasRows && !requiresReview && !readableSource) fail('IMPORT_NO_DATA_ROWS', 'The source contains no data rows.');
    return { ...metadata, ...result, status: requiresReview ? 'REVIEW_REQUIRED' : 'EXTRACTED', requiresReview, limits };
  } catch (error) {
    if (error instanceof ImportExtractionError) { error.details = { ...(error.details || {}), file: metadata }; throw error; }
    throw new ImportExtractionError('Source extraction failed. The original source is retained.', 'IMPORT_EXTRACTION_FAILED', { file: metadata });
  }
}

function decimalValue(value, field) {
  const rule = DECIMAL_FIELDS[field];
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) return { error: issue(field, 'IMPORT_NUMBER_INVALID', `${field.replace(/_/g, ' ')} must be a finite decimal number.`) };
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || text.length > 32) return { error: issue(field, 'IMPORT_NUMBER_INVALID', `${field.replace(/_/g, ' ')} must use digits and a decimal point without currency symbols, grouping or exponents.`) };
  const [integer, fraction = ''] = text.split('.');
  if (fraction.length > rule.scale) return { error: issue(field, 'IMPORT_NUMBER_SCALE', `${field.replace(/_/g, ' ')} supports at most ${rule.scale} decimal places.`) };
  const digits = BigInt(`${integer}${fraction.padEnd(rule.scale, '0')}`), max = BigInt(rule.max) * 10n ** BigInt(rule.scale);
  if (digits > max || (rule.positive && digits === 0n)) return { error: issue(field, 'IMPORT_NUMBER_RANGE', `${field.replace(/_/g, ' ')} must be ${rule.positive ? 'greater than zero and ' : ''}within the supported range.`) };
  const trimmedFraction = fraction.replace(/0+$/, '');
  return { value: `${BigInt(integer).toString()}${trimmedFraction ? `.${trimmedFraction}` : ''}` };
}
function percentageValue(value, metadata, field) {
  if (metadata?.percent && field !== 'tax_rate') return { warning: issue(field, 'IMPORT_PERCENT_FIELD_REVIEW_REQUIRED', 'A percentage-formatted source cell cannot be interpreted as this business field. Enter its intended value explicitly.') };
  if (field !== 'tax_rate') return { value };
  if (metadata?.percent) {
    if (metadata.percentScale !== 1) return { warning: issue(field, 'IMPORT_PERCENT_FORMAT_REVIEW_REQUIRED', 'This custom percentage format needs an explicit reviewed tax rate.') };
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) return { value };
    const text = String(value).trim();
    if (!/^\d+(?:\.\d+)?$/.test(text) || text.length > 32) return { value };
    const [integer, fraction = ''] = text.split('.');
    const coefficient = BigInt(`${integer}${fraction}`), remainingScale = fraction.length - 2;
    if (remainingScale <= 0) return { value: (coefficient * 10n ** BigInt(-remainingScale)).toString() };
    const base = 10n ** BigInt(remainingScale), decimal = (coefficient % base).toString().padStart(remainingScale, '0').replace(/0+$/, '');
    return { value: `${coefficient / base}${decimal ? `.${decimal}` : ''}` };
  }
  // An explicit CSV percent marker already expresses percentage points.
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (match) return { value: match[1] };
  }
  return { value };
}
function calendarDate(value, dateOrder, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { error: issue(field, 'IMPORT_DATE_INVALID', 'The date is invalid.') };
    value = value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  let parts = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/), year, month, day;
  if (parts) [, year, month, day] = parts;
  else {
    parts = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!parts) return { error: issue(field, 'IMPORT_DATE_INVALID', 'Use a valid calendar date in YYYY-MM-DD or the explicitly selected date order.') };
    if (dateOrder === 'ISO') return { warning: issue(field, 'IMPORT_DATE_AMBIGUOUS', 'Choose DMY or MDY before interpreting this date.') };
    year = parts[3]; month = dateOrder === 'DMY' ? parts[2] : parts[1]; day = dateOrder === 'DMY' ? parts[1] : parts[2];
  }
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number(year) < 1900 || Number(year) > 2199 || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { error: issue(field, 'IMPORT_DATE_INVALID', 'The date is not a supported calendar date.') };
  return { value: date };
}
function scaledDecimal(value, scale) {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
}
function centsText(cents) {
  const fraction = (cents % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${cents / 100n}${fraction ? `.${fraction}` : ''}`;
}
function checkDocumentAmounts(values, errors) {
  const derivedFields = [];
  function reconcile(field, expected) {
    if (expected > BigInt(DECIMAL_FIELDS[field].max) * 100n) { errors.push(issue(field, 'IMPORT_NUMBER_RANGE', `The derived ${field} exceeds the supported amount range.`)); return; }
    if (values[field] === null) { values[field] = centsText(expected); derivedFields.push(field); }
    else if (scaledDecimal(values[field], 2) !== expected) errors.push(issue(field, 'INVALID_TOTAL', `The supplied ${field} does not agree with the provided quantities, prices and tax amounts.`));
  }
  if (values.quantity !== null && values.unit_price !== null) {
    const product = scaledDecimal(values.quantity, 3) * scaledDecimal(values.unit_price, 2);
    reconcile('net', (product + 500n) / 1000n);
  }
  if (values.net !== null && values.tax_rate !== null) {
    const tax = scaledDecimal(values.net, 2) * scaledDecimal(values.tax_rate, 2);
    reconcile('tax', (tax + 5000n) / 10000n);
  }
  if (values.net !== null && values.tax !== null) reconcile('total', scaledDecimal(values.net, 2) + scaledDecimal(values.tax, 2));
  return derivedFields;
}
function normalizeImportRow(raw, options = {}) {
  const row = Array.isArray(raw) ? { cells: raw } : raw;
  const values = Object.fromEntries(IMPORT_FIELDS.map(field => [field, null]));
  const errors = [], warnings = [];
  if (!row || !Array.isArray(row.cells)) return { values, errors: [issue(null, 'IMPORT_ROW_INVALID', 'The import row must contain a cells array.')], warnings, status: 'REJECTED', fingerprint: digest(JSON.stringify(values)) };
  const mapping = options.mapping === undefined ? {} : options.mapping, indices = new Map();
  const classification = options.classification;
  const dateOrder = options.dateOrder || 'ISO';
  if (!CLASSIFICATIONS.has(classification)) errors.push(issue('classification', 'IMPORT_CLASSIFICATION_INVALID', 'Choose PLAN, QUOTATION, PURCHASE_ORDER or SUPPLIER_INVOICE.'));
  if (!['ISO', 'DMY', 'MDY'].includes(dateOrder)) errors.push(issue('dateOrder', 'IMPORT_DATE_ORDER_INVALID', 'Choose ISO, DMY or MDY date order.'));
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) errors.push(issue(null, 'IMPORT_MAPPING_INVALID', 'Column mapping must be an object.'));
  else for (const [field, index] of Object.entries(mapping)) {
    if (!IMPORT_FIELDS.includes(field)) { errors.push(issue(field, 'IMPORT_MAPPING_FIELD_INVALID', 'This field is not an import field.')); continue; }
    if (!Number.isSafeInteger(index) || index < 0 || index >= DEFAULT_LIMITS.maxColumns) { errors.push(issue(field, 'IMPORT_MAPPING_INDEX_INVALID', 'Choose a valid zero-based column index.')); continue; }
    if (indices.has(index)) errors.push(issue(field, 'IMPORT_MAPPING_COLUMN_REUSED', `This column is already mapped to ${indices.get(index).replace(/_/g, ' ')}.`));
    indices.set(index, field);
    const metadata = row.cellMeta?.[index];
    if (metadata?.formula) warnings.push(issue(field, 'IMPORT_FORMULA_REVIEW_REQUIRED', 'Verify the cached spreadsheet formula value against the source; formulas are not evaluated.'));
    if (metadata?.merged) warnings.push(issue(field, 'IMPORT_MERGED_CELL_REVIEW_REQUIRED', 'Confirm the value and row boundaries of this merged cell.'));
    let value = row.cells[index];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue;
    const percentage = percentageValue(value, metadata, field);
    if (percentage.warning) { warnings.push(percentage.warning); continue; }
    value = percentage.value;
    if (field in DECIMAL_FIELDS) {
      const result = decimalValue(value, field); if (result.error) errors.push(result.error); else values[field] = result.value;
    } else if (field === 'date' || field === 'due_date') {
      const result = calendarDate(value, dateOrder, field); if (result.error) errors.push(result.error); else if (result.warning) warnings.push(result.warning); else values[field] = result.value;
    } else {
      if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) { errors.push(issue(field, 'IMPORT_TEXT_INVALID', 'The field must contain plain text.')); continue; }
      const text = String(value).normalize('NFKC').trim();
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) errors.push(issue(field, 'IMPORT_TEXT_INVALID', 'The field contains unsupported control characters.'));
      else if (text.length > (FIELD_MAX[field] || 3)) errors.push(issue(field, 'IMPORT_TEXT_LIMIT', `The field exceeds ${FIELD_MAX[field] || 3} characters.`));
      else if (field === 'currency' && !/^[A-Za-z]{3}$/.test(text)) errors.push(issue(field, 'IMPORT_CURRENCY_INVALID', 'Currency must be an explicit three-letter code.'));
      else if (field === 'priority' && !['P1', 'P2', 'P3', 'P4', 'LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(text.toUpperCase())) errors.push(issue(field, 'IMPORT_PRIORITY_INVALID', 'Priority must be P1, P2, P3, P4, LOW, NORMAL, HIGH or CRITICAL.'));
      else values[field] = ['currency', 'priority'].includes(field) ? text.toUpperCase() : text;
    }
  }
  for (const field of ['description', 'quantity']) if (values[field] === null && !errors.some(error => error.field === field)) warnings.push(issue(field, 'IMPORT_REQUIRED_VALUE_MISSING', `Map or enter ${field} before confirming this row.`));
  if (row.cells.length > DEFAULT_LIMITS.maxColumns) errors.push(issue(null, 'IMPORT_COLUMN_LIMIT', 'The row contains too many columns.'));
  if (row.errors !== undefined && !Array.isArray(row.errors)) errors.push(issue(null, 'IMPORT_ROW_INVALID', 'Source row errors must be an array.'));
  if (row.warnings !== undefined && !Array.isArray(row.warnings)) errors.push(issue(null, 'IMPORT_ROW_INVALID', 'Source row warnings must be an array.'));
  for (const error of Array.isArray(row.errors) ? row.errors : []) errors.push(issue(error?.field || null, error?.code || 'IMPORT_SOURCE_ROW_INVALID', error?.message || 'The source row is invalid.'));
  for (const warning of Array.isArray(row.warnings) ? row.warnings : []) warnings.push(issue(warning?.field || null, warning?.code || 'IMPORT_SOURCE_REVIEW_REQUIRED', warning?.message || 'Review this source row.'));
  if (options.requiresReview || ['PDF', 'PNG', 'JPEG', 'IMAGE'].includes(String(options.sourceFormat || '').toUpperCase())) warnings.push(issue(null, 'IMPORT_SOURCE_REVIEW_REQUIRED', 'Confirm these extracted values against the source document.'));
  if (values.date && values.due_date && values.due_date < values.date) errors.push(issue('due_date', 'IMPORT_DUE_DATE_BEFORE_DATE', 'The due date must not precede the document date.'));
  const derivedFields = checkDocumentAmounts(values, errors);
  const fingerprint = digest(JSON.stringify({ classification, values }));
  return { values, errors, warnings, derivedFields, status: errors.length ? 'REJECTED' : warnings.length ? 'REVIEW_REQUIRED' : 'VALIDATED', fingerprint };
}

if (!isMainThread && workerData?.task === 'procurement-extraction') {
  Promise.resolve().then(() => extractInWorker(workerData)).then(
    result => parentPort.postMessage({ ok: true, result }),
    error => parentPort.postMessage({ ok: false, error: { code: error instanceof ImportExtractionError ? error.code : 'IMPORT_PARSE_FAILED', message: error instanceof ImportExtractionError ? error.message : 'The source could not be parsed.', details: error.details || null, statusCode: error.statusCode || 422 } })
  );
}

module.exports = { extractImportFile, normalizeImportRow, suggestImportMapping, detectImportFormat, ImportExtractionError, DEFAULT_LIMITS, IMPORT_FIELDS, HEADER_ALIASES };
