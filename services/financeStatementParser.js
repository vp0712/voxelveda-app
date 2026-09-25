'use strict';

const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const { createWorker, OEM, PSM } = require('tesseract.js');
const englishData = require('@tesseract.js-data/eng');
const canvasModule = require('@napi-rs/canvas');
const { detectStatementFile, printableText, rejection } = require('./financeStatementDetection');
const { amountDirection, normaliseMoneyToken } = require('./financeStatementMoney');
const { selectAdapter } = require('./financeStatementAdapters');
const { normaliseDate } = require('./financeStatementAdapters/generic');

const PARSER_VERSION = 'finance-ingestion-v1';
const MAX_ROWS = () => Math.max(1, Math.min(50000, Number(process.env.FINANCE_STATEMENT_MAX_ROWS || 10000)));
const MAX_PAGES = () => Math.max(1, Math.min(500, Number(process.env.FINANCE_STATEMENT_MAX_PAGES || 100)));
const MAX_IMAGE_PIXELS = () => Math.max(1000000, Number(process.env.FINANCE_STATEMENT_MAX_IMAGE_PIXELS || 40000000));
let pdfModulePromise;
let ocrWorkerPromise;

function parserError(message, code, status = 422, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

async function pdfModule() {
  if (!pdfModulePromise) {
    globalThis.DOMMatrix ||= canvasModule.DOMMatrix;
    globalThis.ImageData ||= canvasModule.ImageData;
    globalThis.Path2D ||= canvasModule.Path2D;
    pdfModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfModulePromise;
}

async function ocrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker(englishData.code, OEM.LSTM_ONLY, {
      langPath: englishData.langPath,
      gzip: englishData.gzip,
      cacheMethod: 'readOnly',
      logger: () => {}
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300'
      });
      return worker;
    }).catch((error) => { ocrWorkerPromise = null; throw error; });
  }
  return ocrWorkerPromise;
}

async function shutdownOcrWorker() {
  if (!ocrWorkerPromise) return;
  const worker = await ocrWorkerPromise.catch(() => null);
  ocrWorkerPromise = null;
  if (worker) await worker.terminate().catch(() => {});
}

function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = []; let value = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) { row.push(value.trim()); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value.trim()); value = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function headerKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const COLUMN_ALIASES = Object.freeze({
  transaction_date: ['transaction_date', 'date', 'transactiondate', 'value_date', 'processed_date', 'transaction_date_'],
  posting_date: ['posting_date', 'posted_date', 'process_date'],
  description: ['description', 'details', 'transaction_details', 'narrative', 'memo', 'particulars'],
  merchant_name: ['merchant', 'merchant_name', 'payee', 'counterparty'],
  reference: ['reference', 'ref', 'transaction_reference', 'fitid'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money_out', 'debits', 'paid_out'],
  credit: ['credit', 'deposit', 'deposits', 'money_in', 'credits', 'paid_in'],
  amount: ['amount', 'transaction_amount', 'signed_amount'],
  running_balance: ['running_balance', 'balance', 'account_balance'],
  currency: ['currency', 'currency_code'],
  transaction_type: ['transaction_type', 'type'],
  category: ['category'],
  account_identifier: ['account_identifier', 'account', 'account_number']
});

function resolveColumnIndexes(headers, mapping = {}) {
  const normalHeaders = headers.map(headerKey);
  const result = {};
  for (const key of Object.keys(COLUMN_ALIASES)) {
    const requested = mapping.columns?.[key];
    if (Number.isInteger(Number(requested)) && String(requested).trim() !== '') result[key] = Number(requested);
    else if (requested) result[key] = normalHeaders.indexOf(headerKey(requested));
    else result[key] = COLUMN_ALIASES[key].map((alias) => normalHeaders.indexOf(alias)).find((index) => index >= 0) ?? -1;
  }
  return result;
}

function parseTabularRows(matrix, options = {}) {
  const headerRow = Math.max(1, Number(options.mapping?.header_row || 1));
  if (matrix.length < headerRow + 1) throw parserError('The file must contain a header and at least one transaction row.', 'STATEMENT_TABLE_EMPTY');
  const headers = matrix[headerRow - 1].map(String);
  const indexes = resolveColumnIndexes(headers, options.mapping || {});
  if (indexes.transaction_date < 0) return { rows: [], needsMapping: true, headers, reason: 'Transaction date column is not mapped.' };
  if (indexes.amount < 0 && indexes.debit < 0 && indexes.credit < 0) return { rows: [], needsMapping: true, headers, reason: 'Amount or debit/credit columns are not mapped.' };
  const rows = [];
  for (let position = headerRow; position < matrix.length; position += 1) {
    const cells = matrix[position] || [];
    if (!cells.some((cell) => String(cell ?? '').trim())) continue;
    const parsedDate = normaliseDate(cells[indexes.transaction_date], { dateFormat: options.mapping?.date_format || options.dateFormat });
    let debit = normaliseMoneyToken(indexes.debit >= 0 ? cells[indexes.debit] : '')?.decimal || '0.00';
    let credit = normaliseMoneyToken(indexes.credit >= 0 ? cells[indexes.credit] : '')?.decimal || '0.00';
    if (debit.startsWith('-')) debit = debit.slice(1);
    if (credit.startsWith('-')) credit = credit.slice(1);
    if (indexes.amount >= 0 && debit === '0.00' && credit === '0.00') {
      const direction = amountDirection(cells[indexes.amount], { signedAmountRule: options.mapping?.signed_amount_rule });
      debit = direction?.debit || '0.00'; credit = direction?.credit || '0.00';
    }
    rows.push({
      transaction_date: parsedDate.value,
      posting_date: indexes.posting_date >= 0 ? normaliseDate(cells[indexes.posting_date], { dateFormat: options.mapping?.date_format || options.dateFormat }).value : null,
      description: indexes.description >= 0 ? String(cells[indexes.description] || '').slice(0, 1000) : '',
      merchant_name: indexes.merchant_name >= 0 ? String(cells[indexes.merchant_name] || '').slice(0, 255) : null,
      reference: indexes.reference >= 0 ? String(cells[indexes.reference] || '').slice(0, 180) : null,
      debit, credit,
      running_balance: indexes.running_balance >= 0 ? normaliseMoneyToken(cells[indexes.running_balance])?.decimal || null : null,
      currency: indexes.currency >= 0 ? String(cells[indexes.currency] || '').trim().toUpperCase() || null : options.currency || null,
      transaction_type: indexes.transaction_type >= 0 ? String(cells[indexes.transaction_type] || '').slice(0, 80) : null,
      category: indexes.category >= 0 ? String(cells[indexes.category] || '').slice(0, 120) : null,
      source_page: 1,
      source_row_number: position + 1,
      source_snippet: cells.map((cell) => String(cell ?? '')).join(' | ').slice(0, 1000),
      confidence_score: parsedDate.ambiguous ? 0.5 : 1,
      validation_hint: parsedDate.ambiguous ? `Ambiguous date ${cells[indexes.transaction_date]}; select the source date format` : null,
      force_rejected: parsedDate.ambiguous
    });
    if (rows.length > MAX_ROWS()) throw parserError(`Statements are limited to ${MAX_ROWS()} transaction rows.`, 'STATEMENT_ROW_LIMIT', 413);
  }
  return { rows, needsMapping: false, headers };
}

function delimiterFor(text) {
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  return [',', ';', '\t'].map((delimiter) => ({ delimiter, count: first.split(delimiter).length - 1 })).sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseCsv(buffer, options = {}) {
  const text = printableText(buffer);
  if (text == null) throw parserError('CSV is not valid UTF-8 text.', 'CSV_ENCODING_UNSUPPORTED');
  return parseTabularRows(parseDelimited(text.replace(/^\uFEFF/, ''), delimiterFor(text)), options);
}

function workbookCell(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && Object.hasOwn(value, 'formula')) {
    return { value: value.result ?? '', formula: true };
  }
  if (value instanceof Date) return { value: value.toISOString().slice(0, 10), formula: false };
  if (value && typeof value === 'object' && Array.isArray(value.richText)) return { value: value.richText.map((item) => item.text).join(''), formula: false };
  return { value: value ?? '', formula: false };
}

async function parseXlsx(buffer, options = {}) {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'extLst'] }); }
  catch (error) { throw parserError('The XLSX workbook is corrupt or unsafe to read.', 'XLSX_INVALID', 422, { cause: error.code || error.name }); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw parserError('The XLSX workbook does not contain a readable worksheet.', 'XLSX_EMPTY');
  if (sheet.rowCount > MAX_ROWS() + 100) throw parserError(`Spreadsheets are limited to ${MAX_ROWS()} transaction rows.`, 'STATEMENT_ROW_LIMIT', 413);
  let formulaCount = 0;
  const matrix = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let index = 1; index <= Math.min(row.cellCount, 100); index += 1) {
      const safe = workbookCell(row.getCell(index));
      if (safe.formula) formulaCount += 1;
      values.push(safe.value);
    }
    matrix.push(values);
  });
  const result = parseTabularRows(matrix, options);
  result.formulaCount = formulaCount;
  if (formulaCount) result.warnings = [`${formulaCount} formula cell(s) were not executed; only cached values were read.`];
  return result;
}

function ofxTag(block, name) {
  const match = block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseOfx(buffer, options = {}) {
  const text = printableText(buffer);
  const blocks = String(text || '').match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
  const rows = blocks.map((block, index) => {
    const rawAmount = ofxTag(block, 'TRNAMT');
    const posted = ofxTag(block, 'DTPOSTED').slice(0, 8);
    const transactionDate = /^\d{8}$/.test(posted) ? `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}` : null;
    const name = ofxTag(block, 'NAME'); const memo = ofxTag(block, 'MEMO');
    const direction = amountDirection(rawAmount, { signedAmountRule: 'NEGATIVE_DEBIT' });
    return {
      transaction_date: transactionDate,
      description: [name, memo].filter(Boolean).join(' · '),
      merchant_name: name || null,
      reference: ofxTag(block, 'FITID') || ofxTag(block, 'REFNUM') || null,
      debit: direction?.debit || '0.00', credit: direction?.credit || '0.00', running_balance: null,
      currency: ofxTag(text, 'CURDEF') || options.currency || null,
      transaction_type: ofxTag(block, 'TRNTYPE') || null,
      source_page: 1, source_row_number: index + 1, source_snippet: block.slice(0, 1000), confidence_score: 1
    };
  });
  if (!rows.length) throw parserError('No OFX/QFX transactions were found.', 'OFX_NO_TRANSACTIONS');
  return { rows, needsMapping: false, headers: [] };
}

function parseQif(buffer, options = {}) {
  const text = printableText(buffer);
  const records = String(text || '').split(/^\^\s*$/m).map((record) => record.trim()).filter(Boolean);
  const rows = [];
  for (const record of records) {
    const fields = {};
    for (const line of record.split(/\r?\n/)) if (line[0] && line[0] !== '!') fields[line[0]] = line.slice(1).trim();
    if (!fields.D || fields.T === undefined) continue;
    const parsedDate = normaliseDate(String(fields.D).replace(/'/g, '/'), { dateFormat: options.mapping?.date_format || options.dateFormat || 'DMY' });
    const direction = amountDirection(fields.T, { signedAmountRule: 'NEGATIVE_DEBIT' });
    rows.push({
      transaction_date: parsedDate.value, description: [fields.P, fields.M].filter(Boolean).join(' · '), merchant_name: fields.P || null,
      reference: fields.N || null, debit: direction?.debit || '0.00', credit: direction?.credit || '0.00', running_balance: null,
      category: fields.L || null, currency: options.currency || null, source_page: 1, source_row_number: rows.length + 1,
      source_snippet: record.slice(0, 1000), confidence_score: parsedDate.ambiguous ? 0.5 : 1,
      validation_hint: parsedDate.ambiguous ? `Ambiguous date ${fields.D}; select the QIF date format` : null, force_rejected: parsedDate.ambiguous
    });
  }
  if (!rows.length) throw parserError('No QIF transactions were found.', 'QIF_NO_TRANSACTIONS');
  return { rows, needsMapping: false, headers: [] };
}

function groupWords(words, page) {
  const groups = new Map();
  for (const word of words) {
    const key = `${page}:${Math.round(Number(word.y || word.top || 0) / 4) * 4}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  }
  return [...groups.values()].sort((left, right) => Number(right[0]?.y || right[0]?.top || 0) - Number(left[0]?.y || left[0]?.top || 0)).map((lineWords) => ({
    page,
    words: lineWords.sort((left, right) => Number(left.x || left.left || 0) - Number(right.x || right.left || 0)),
    text: lineWords.sort((left, right) => Number(left.x || left.left || 0) - Number(right.x || right.left || 0)).map((word) => word.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  })).filter((line) => line.text);
}

function parseTsv(tsv, page) {
  const words = [];
  const lines = String(tsv || '').split(/\r?\n/);
  const headers = lines.shift()?.split('\t') || [];
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  for (const line of lines) {
    const cells = line.split('\t'); const text = cells[index.text] || '';
    if (!text.trim() || Number(cells[index.level]) !== 5) continue;
    words.push({ text: text.trim(), x: Number(cells[index.left] || 0), y: Number(cells[index.top] || 0), width: Number(cells[index.width] || 0), height: Number(cells[index.height] || 0), confidence: Number(cells[index.conf] || 0) });
  }
  // OCR coordinates have a top-down origin, so normalise y for the common grouping helper.
  return groupWords(words.map((word) => ({ ...word, y: -word.y })), page);
}

function linesFromBlocks(blocks, page) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = (line.words || []).map((word) => ({
          text: String(word.text || '').trim(),
          x: Number(word.bbox?.x0 || 0),
          y: -Number(word.bbox?.y0 || 0),
          width: Math.max(0, Number(word.bbox?.x1 || 0) - Number(word.bbox?.x0 || 0)),
          height: Math.max(0, Number(word.bbox?.y1 || 0) - Number(word.bbox?.y0 || 0)),
          confidence: Number(word.confidence || line.confidence || 0)
        })).filter((word) => word.text);
        if (words.length) lines.push({ page, words, text: String(line.text || words.map((word) => word.text).join(' ')).replace(/\s+/g, ' ').trim() });
      }
    }
  }
  return lines;
}

async function preprocessImage(buffer) {
  const image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS() });
  const metadata = await image.metadata();
  const pixels = Number(metadata.width || 0) * Number(metadata.height || 0);
  if (!metadata.width || !metadata.height || pixels > MAX_IMAGE_PIXELS()) throw parserError('The image dimensions exceed the safe statement limit.', 'STATEMENT_IMAGE_DIMENSION_LIMIT', 413);
  const width = Math.min(2800, Math.max(Number(metadata.width), Number(metadata.width) < 1600 ? Number(metadata.width) * 2 : Number(metadata.width)));
  const prepared = await image.rotate().resize({ width, withoutEnlargement: false, fit: 'inside' }).grayscale().normalize().sharpen().png({ compressionLevel: 8 }).toBuffer();
  return { buffer: prepared, metadata: { width: metadata.width, height: metadata.height, format: metadata.format } };
}

async function ocrImage(buffer, page, progress) {
  progress?.({ stage: 'OCR_REQUIRED', page });
  const prepared = await preprocessImage(buffer);
  const worker = await ocrWorker();
  const result = await worker.recognize(prepared.buffer, {}, { text: true, tsv: true, blocks: true });
  const lines = parseTsv(result.data.tsv, page);
  if (!lines.length) lines.push(...linesFromBlocks(result.data.blocks, page));
  return { lines, text: result.data.text || lines.map((line) => line.text).join('\n'), metadata: prepared.metadata };
}

function pdfTextLines(items, page) {
  return groupWords((items || []).map((item) => ({
    text: String(item.str || '').trim(), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0),
    width: Number(item.width || 0), height: Math.abs(Number(item.height || item.transform?.[3] || 0)), confidence: 100
  })).filter((word) => word.text), page);
}

async function renderPdfPage(page) {
  const viewport = page.getViewport({ scale: Math.max(1.5, Math.min(3, Number(process.env.FINANCE_PDF_RENDER_SCALE || 2.2))) });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toBuffer('image/png');
}

function classify(text, metadata = {}) {
  const source = String(text || '').replace(/\s+/g, ' ');
  const upper = source.toUpperCase();
  let documentType = 'UNKNOWN_FINANCIAL_DOCUMENT';
  if (/CREDIT CARD STATEMENT|CARD ACCOUNT/.test(upper)) documentType = 'CREDIT_CARD_STATEMENT';
  else if (/LOAN STATEMENT|MORTGAGE STATEMENT/.test(upper)) documentType = 'LOAN_STATEMENT';
  else if (/BANK STATEMENT|ACCOUNT STATEMENT|TRANSACTION HISTORY/.test(upper)) documentType = 'BANK_STATEMENT';
  else if (/DIGITAL WALLET|PAYPAL|WALLET STATEMENT/.test(upper)) documentType = 'DIGITAL_WALLET_STATEMENT';
  else if (/CREDIT NOTE/.test(upper)) documentType = 'CREDIT_NOTE';
  else if (/TAX INVOICE|SUPPLIER INVOICE/.test(upper)) documentType = 'SUPPLIER_INVOICE';
  else if (/INVOICE/.test(upper)) documentType = 'CUSTOMER_INVOICE';
  else if (/RECEIPT/.test(upper)) documentType = 'RECEIPT';
  const adapterChoice = selectAdapter({ text: source });
  const institution = adapterChoice.adapter.institution?.(source) || null;
  const currencies = [...new Set((upper.match(/\b(?:AUD|USD|NZD|EUR|GBP|INR|JPY|CAD|SGD)\b/g) || []))];
  const accountMatch = source.match(/(?:account(?: number| no\.?| #)?|acct)\s*[:#-]?\s*([*xX•\d -]{4,30})/i);
  const maskedAccountIdentifier = accountMatch ? `••••${accountMatch[1].replace(/\D/g, '').slice(-4)}` : null;
  const balance = (label) => {
    const match = source.match(new RegExp(`${label}\\s*(?:balance)?\\s*[:$]?\\s*((?:CR|DR)?\\s*[-+]?\\(?[$€£¥₹]?\\d[\\d.,]*[.,]\\d{2}\\)?(?:\\s*(?:CR|DR))?)`, 'i'));
    return match ? normaliseMoneyToken(match[1])?.decimal || null : null;
  };
  const periodMatch = source.match(/(?:statement period|period)\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\s*(?:to|through|[-–—])\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/i);
  const periodStart = periodMatch ? normaliseDate(periodMatch[1], { dateFormat: institution ? 'DMY' : '' }).value : null;
  const periodEnd = periodMatch ? normaliseDate(periodMatch[2], { dateFormat: institution ? 'DMY' : '' }).value : null;
  return {
    document_type: documentType,
    classification_confidence: documentType === 'UNKNOWN_FINANCIAL_DOCUMENT' ? 0.35 : Math.max(0.75, adapterChoice.score),
    institution,
    account_name: null,
    masked_account_identifier: maskedAccountIdentifier,
    statement_currency: currencies.length === 1 ? currencies[0] : null,
    opening_balance: balance('opening'),
    closing_balance: balance('closing'),
    available_balance: balance('available'),
    statement_start_date: periodStart,
    statement_end_date: periodEnd,
    page_count: metadata.pageCount || 1,
    selectable_text: Boolean(metadata.selectableText),
    ocr_required: Boolean(metadata.ocrRequired),
    multiple_accounts: (source.match(/\bACCOUNT(?: NUMBER| NO\.?| #)?\b/gi) || []).length > 2,
    multiple_currencies: currencies.length > 1,
    appears_incomplete: Boolean(metadata.appearsIncomplete),
    currencies,
    adapter_name: adapterChoice.adapter.VERSION,
    adapter_confidence: adapterChoice.score
  };
}

async function parsePdf(buffer, options = {}, progress) {
  const pdfjs = await pdfModule();
  let document;
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), password: options.password || undefined, disableWorker: true, isEvalSupported: false, stopAtErrors: true });
    document = await task.promise;
  } catch (error) {
    if (error?.name === 'PasswordException' || /password/i.test(String(error?.message || ''))) {
      throw parserError(options.password ? 'The PDF password was not accepted.' : 'This PDF is password protected.', options.password ? 'PDF_PASSWORD_INVALID' : 'PDF_PASSWORD_REQUIRED', 422);
    }
    throw parserError('The PDF is corrupt or could not be opened safely.', 'PDF_INVALID', 422, { cause: error.code || error.name });
  }
  if (document.numPages > MAX_PAGES()) throw parserError(`PDF statements are limited to ${MAX_PAGES()} pages.`, 'STATEMENT_PAGE_LIMIT', 413);
  const pages = []; const allLines = []; let textCharacters = 0; let ocrRequired = false;
  for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
    progress?.({ stage: 'EXTRACTING', page: pageNo, totalPages: document.numPages });
    const page = await document.getPage(pageNo);
    const content = await page.getTextContent({ disableNormalization: false });
    let lines = pdfTextLines(content.items, pageNo);
    let pageText = lines.map((line) => line.text).join('\n');
    let method = 'PDF_TEXT';
    if (pageText.replace(/\s/g, '').length < 24) {
      ocrRequired = true; method = 'OCR';
      const ocr = await ocrImage(await renderPdfPage(page), pageNo, progress);
      lines = ocr.lines; pageText = ocr.text;
    }
    textCharacters += pageText.replace(/\s/g, '').length;
    pages.push({ page_number: pageNo, extraction_method: method, text_content: pageText.slice(0, 200000), word_count: lines.reduce((sum, line) => sum + line.words.length, 0), confidence: lines.length ? lines.reduce((sum, line) => sum + (line.words.reduce((inner, word) => inner + Number(word.confidence || 0), 0) / Math.max(1, line.words.length)), 0) / lines.length / 100 : 0 });
    allLines.push(...lines);
    page.cleanup?.();
  }
  await document.destroy?.();
  const text = allLines.map((line) => line.text).join('\n');
  const classification = classify(text, { pageCount: pages.length, selectableText: textCharacters > 24 && !ocrRequired, ocrRequired, appearsIncomplete: pages.some((page) => !page.word_count) });
  const adapterChoice = selectAdapter({ text });
  const rows = adapterChoice.adapter.parseLines(allLines, { dateFormat: options.mapping?.date_format, currency: classification.statement_currency || options.currency, signedAmountRule: options.mapping?.signed_amount_rule, allowUnsignedAmounts: false });
  if (!rows.length) throw parserError('No transaction rows with a safely identifiable date and debit/credit direction were extracted.', 'PDF_NO_SAFE_TRANSACTIONS');
  return { rows, pages, classification, parserName: adapterChoice.adapter.VERSION, parserConfidence: adapterChoice.score, needsMapping: false, warnings: [] };
}

async function parseImage(buffer, detection, options = {}, progress) {
  const ocr = await ocrImage(buffer, 1, progress);
  const classification = classify(ocr.text, { pageCount: 1, selectableText: false, ocrRequired: true, appearsIncomplete: !ocr.lines.length });
  const adapterChoice = selectAdapter({ text: ocr.text });
  const rows = adapterChoice.adapter.parseLines(ocr.lines, { dateFormat: options.mapping?.date_format, currency: classification.statement_currency || options.currency, signedAmountRule: options.mapping?.signed_amount_rule, allowUnsignedAmounts: false });
  if (!rows.length) throw parserError('OCR completed but no transaction rows with a safe debit/credit direction were found.', 'OCR_NO_SAFE_TRANSACTIONS');
  return { rows, pages: [{ page_number: 1, extraction_method: 'OCR', text_content: ocr.text.slice(0, 200000), word_count: ocr.lines.reduce((sum, line) => sum + line.words.length, 0), confidence: rows.reduce((sum, row) => sum + Number(row.confidence_score || 0), 0) / rows.length }], classification, parserName: adapterChoice.adapter.VERSION, parserConfidence: adapterChoice.score, needsMapping: false, warnings: [], detectedFormat: detection.format };
}

async function parseStatementBuffer(buffer, file = {}, options = {}, progress) {
  const detection = detectStatementFile(buffer, file.originalName || file.original_name, file.mimeType || file.mimetype);
  progress?.({ stage: 'CLASSIFYING', format: detection.format });
  let parsed;
  if (detection.format === 'PDF') parsed = await parsePdf(buffer, options, progress);
  else if (detection.format === 'PNG' || detection.format === 'JPEG') parsed = await parseImage(buffer, detection, options, progress);
  else if (detection.format === 'CSV') parsed = parseCsv(buffer, options);
  else if (detection.format === 'XLSX') parsed = await parseXlsx(buffer, options);
  else if (detection.format === 'OFX' || detection.format === 'QFX') parsed = parseOfx(buffer, options);
  else if (detection.format === 'QIF') parsed = parseQif(buffer, options);
  else throw rejection('This statement format is not implemented.', 'UNSUPPORTED_STATEMENT_FORMAT');

  if (!parsed.classification) {
    const text = printableText(buffer) || parsed.rows.map((row) => row.source_snippet || row.description || '').join('\n');
    parsed.classification = classify(text, { pageCount: 1, selectableText: true, ocrRequired: false });
  }
  parsed.rows = (parsed.rows || []).map((row) => ({ ...row, currency: row.currency || parsed.classification.statement_currency || options.currency || null }));
  parsed.pages ||= [{ page_number: 1, extraction_method: detection.format, text_content: null, word_count: 0, confidence: 1 }];
  parsed.parserName ||= detection.format.toLowerCase();
  parsed.parserConfidence ??= parsed.needsMapping ? 0 : 1;
  parsed.format = detection.format;
  parsed.detectedMime = detection.detectedMime;
  parsed.sizeBytes = buffer.length;
  parsed.fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  parsed.parserVersion = PARSER_VERSION;
  return parsed;
}

module.exports = {
  COLUMN_ALIASES,
  PARSER_VERSION,
  classify,
  parseCsv,
  parseDelimited,
  parseOfx,
  parseQif,
  parseStatementBuffer,
  parseTabularRows,
  parseXlsx,
  shutdownOcrWorker,
  _test: { linesFromBlocks, ocrImage, parseTsv, pdfTextLines, preprocessImage }
};
