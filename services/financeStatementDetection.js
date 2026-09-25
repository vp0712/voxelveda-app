'use strict';

const path = require('node:path');

const FORMAT_MIME = Object.freeze({
  PDF: 'application/pdf',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  OFX: 'application/x-ofx',
  QFX: 'application/x-qfx',
  QIF: 'application/x-qif'
});

const FORMAT_EXTENSIONS = Object.freeze({
  PDF: new Set(['.pdf']), PNG: new Set(['.png']), JPEG: new Set(['.jpg', '.jpeg']),
  CSV: new Set(['.csv']), XLSX: new Set(['.xlsx']), OFX: new Set(['.ofx']),
  QFX: new Set(['.qfx']), QIF: new Set(['.qif'])
});

function rejection(message, code, status = 415) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function printableText(buffer) {
  if (!buffer?.length || buffer.includes(0)) return null;
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return replacementCount <= Math.max(2, Math.floor(text.length * 0.005)) ? text : null;
}

function detectStatementFile(buffer, originalName = '', suppliedMime = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw rejection('The uploaded statement is empty.', 'EMPTY_STATEMENT_FILE', 400);
  const maxBytes = Math.max(1024, Number(process.env.FINANCE_STATEMENT_MAX_BYTES || 25 * 1024 * 1024));
  if (buffer.length > maxBytes) throw rejection(`Statement files are limited to ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 'STATEMENT_FILE_TOO_LARGE', 413);

  const extension = path.extname(String(originalName || '')).toLowerCase();
  const head = buffer.subarray(0, Math.min(buffer.length, 4096));
  const hex = head.toString('hex');
  let format = null;

  if (head.subarray(0, 5).toString('ascii') === '%PDF-') format = 'PDF';
  else if (hex.startsWith('89504e470d0a1a0a')) format = 'PNG';
  else if (hex.startsWith('ffd8ff')) format = 'JPEG';
  else if (hex.startsWith('d0cf11e0a1b11ae1')) {
    throw rejection('Legacy XLS files are not supported securely. Save the workbook as XLSX or CSV and upload it again.', 'LEGACY_XLS_UNSUPPORTED');
  } else if (head.subarray(4, 8).toString('ascii') === 'ftyp' && /(heic|heix|hevc|hevx|mif1|msf1)/i.test(head.toString('ascii'))) {
    throw rejection('HEIC statement images are not supported by the verified production decoder. Convert the image to PNG or JPEG.', 'HEIC_UNSUPPORTED');
  } else if (hex.startsWith('504b0304') || hex.startsWith('504b0506') || hex.startsWith('504b0708')) {
    // An OOXML workbook is a ZIP container. ExcelJS performs the structural workbook validation.
    if (extension !== '.xlsx' && !/spreadsheetml/i.test(String(suppliedMime || ''))) {
      throw rejection('ZIP containers are accepted only when they are structurally valid XLSX workbooks.', 'UNRECOGNISED_ZIP_CONTAINER');
    }
    format = 'XLSX';
  } else {
    const text = printableText(buffer);
    if (!text) throw rejection('The file content is not a supported financial statement format.', 'UNSUPPORTED_STATEMENT_CONTENT');
    const sample = text.slice(0, 20000);
    if (/<(?:OFX|STMTTRN|CCSTMTTRN)>/i.test(sample)) format = extension === '.qfx' ? 'QFX' : 'OFX';
    else if (/^!Type:(?:Bank|CCard|Cash|Oth)/im.test(sample) && /^\^\s*$/m.test(sample)) format = 'QIF';
    else if (/[,;\t]/.test(sample) && /\r?\n/.test(sample)) format = 'CSV';
  }

  if (!format) throw rejection('The file content is not a supported financial statement format.', 'UNSUPPORTED_STATEMENT_CONTENT');
  const permittedExtensions = FORMAT_EXTENSIONS[format];
  if (extension && permittedExtensions && !permittedExtensions.has(extension)) {
    throw rejection(`The file contents are ${format}, but the filename extension does not match. Rename or re-export the source file.`, 'STATEMENT_EXTENSION_MISMATCH', 400);
  }

  return {
    format,
    detectedMime: FORMAT_MIME[format],
    extension,
    suppliedMime: String(suppliedMime || '').slice(0, 120),
    sizeBytes: buffer.length
  };
}

module.exports = { FORMAT_EXTENSIONS, FORMAT_MIME, detectStatementFile, printableText, rejection };
