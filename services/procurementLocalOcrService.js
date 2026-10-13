'use strict';

// Opt-in local OCR only. Uploaded sources never leave the application runtime.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const PROVIDER = 'local_tesseract';
const OCR_LIMITS = Object.freeze({ maxPages: 5, maxDimension: 2000, maxWords: 20000, maxOutputBytes: 4 * 1024 * 1024, memoryBytes: 256 * 1024 * 1024, maxFileBytes: 8 * 1024 * 1024, maxImagePixels: 12000000, timeoutMs: 15000 });
function detectedBinary(name) {
  for (const root of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']) {
    const candidate = path.join(root, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* Missing tools are a capability outcome. */ }
  }
  return null;
}
function tools() { return { tesseract: detectedBinary('tesseract'), pdftoppm: detectedBinary('pdftoppm'), prlimit: detectedBinary('prlimit') }; }
function ocrCapability() {
  const enabled = process.env.PROCUREMENT_OCR_ENABLED === 'true', binaries = tools();
  const limitsAvailable = process.platform === 'linux' && !!binaries.prlimit;
  const imageAvailable = enabled && !!binaries.tesseract && limitsAvailable;
  return {
    enabled, available: imageAvailable, provider: PROVIDER,
    status: imageAvailable ? 'AVAILABLE' : 'NOT_CONFIGURED',
    reason: !enabled ? 'DISABLED' : !binaries.tesseract ? 'TESSERACT_MISSING' : !limitsAvailable ? 'RESOURCE_LIMIT_TOOL_MISSING' : null,
    formats: { PNG: imageAvailable, JPEG: imageAvailable, PDF: imageAvailable && !!binaries.pdftoppm },
    binaries: { tesseract: !!binaries.tesseract, pdftoppm: !!binaries.pdftoppm, resourceLimits: limitsAvailable },
    runtimeVerified: false,
    requiresReview: true, limits: OCR_LIMITS,
    configuration: 'PROCUREMENT_OCR_ENABLED=true'
  };
}
function ocrError(code, message) { return Object.assign(new Error(message), { code, statusCode: 422, safeImportMessage: true }); }
function runBounded(binary, args, context) {
  const remaining = context.deadline - Date.now();
  if (context.signal?.aborted || remaining <= 0) return Promise.reject(ocrError('IMPORT_OCR_TIMEOUT', 'Local OCR exceeded its processing time limit.'));
  if (!context.prlimit) return Promise.reject(ocrError('IMPORT_OCR_NOT_CONFIGURED', 'Local OCR requires a runtime resource-limit tool.'));
  const commandArgs = [`--as=${OCR_LIMITS.memoryBytes}`, '--cpu=15', '--fsize=16777216', '--', binary, ...args];
  return new Promise((resolve, reject) => {
    execFile(context.prlimit, commandArgs, {
      timeout: remaining, signal: context.signal, killSignal: 'SIGKILL', maxBuffer: OCR_LIMITS.maxOutputBytes,
      windowsHide: true, env: { ...process.env, OMP_THREAD_LIMIT: '1', OMP_NUM_THREADS: '1' }
    }, (error, stdout) => {
      if (error) {
        if (context.signal?.aborted || error.killed || error.name === 'AbortError') reject(ocrError('IMPORT_OCR_TIMEOUT', 'Local OCR exceeded its processing time or resource limit.'));
        else reject(ocrError('IMPORT_OCR_PROCESS_FAILED', 'A local OCR tool failed. Verify its installation and language model, then retry the retained source.'));
      } else resolve(stdout);
    });
  });
}
function parseTsv(tsv, sourcePage, limits) {
  const records = tsv.split(/\r?\n/), header = records.shift()?.split('\t') || [];
  const keys = Object.fromEntries(header.map((key, index) => [key, index]));
  if (!['level', 'left', 'top', 'width', 'height', 'conf', 'text', 'block_num', 'par_num', 'line_num'].every(key => Number.isInteger(keys[key]))) throw ocrError('IMPORT_OCR_RESULT_INVALID', 'The local OCR result has an invalid structure.');
  if (records.length > OCR_LIMITS.maxWords * 2) throw ocrError('IMPORT_OCR_RESULT_LIMIT', 'The local OCR result contains too many entries.');
  const lines = new Map(); let words = 0, textChars = 0, confidenceWeight = 0, confidenceTotal = 0;
  for (const record of records) {
    const cells = record.split('\t');
    if (cells[keys.level] !== '5') continue;
    const text = cells.slice(keys.text).join('\t').trim();
    if (!text) continue;
    if (++words > OCR_LIMITS.maxWords || (textChars += text.length + 1) > limits.maxTextChars) throw ocrError('IMPORT_OCR_RESULT_LIMIT', 'The local OCR text exceeds its import limit.');
    const confidence = Number(cells[keys.conf]), box = {};
    for (const key of ['left', 'top', 'width', 'height']) {
      const value = Number(cells[keys[key]]);
      if (!Number.isFinite(value) || value < 0 || value > OCR_LIMITS.maxDimension) throw ocrError('IMPORT_OCR_RESULT_INVALID', 'The local OCR word position is invalid.');
      box[key] = value;
    }
    const lineKey = `${cells[keys.block_num]}:${cells[keys.par_num]}:${cells[keys.line_num]}`;
    if (!lines.has(lineKey)) lines.set(lineKey, { sourcePage, lineNumber: lines.size + 1, text: '', words: [] });
    const line = lines.get(lineKey);
    line.text = `${line.text} ${text}`.trim();
    line.words.push({ text, confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? Math.round(confidence * 100) / 100 : null, ...box });
    if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) { confidenceWeight += text.length; confidenceTotal += confidence * text.length; }
  }
  const extracted = [...lines.values()];
  return { pageNumber: sourcePage, text: extracted.map(line => line.text).join('\n'), lines: extracted, wordCount: words, confidence: confidenceWeight ? Math.round(confidenceTotal / confidenceWeight * 100) / 100 : null, source: { kind: 'LOCAL_OCR', page: sourcePage } };
}
async function normaliseImage(buffer, filename) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  let image;
  try { image = await loadImage(buffer); } catch { throw ocrError('IMPORT_OCR_IMAGE_INVALID', 'The OCR image could not be decoded.'); }
  if (!image.width || !image.height || image.width * image.height > OCR_LIMITS.maxImagePixels) throw ocrError('IMPORT_OCR_IMAGE_LIMIT', 'The OCR image exceeds its pixel limit.');
  const scale = Math.min(1, OCR_LIMITS.maxDimension / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  await fsp.writeFile(filename, canvas.toBuffer('image/png'), { mode: 0o600 });
}
async function localExtract(buffer, input = {}, binaries) {
  const format = String(input.format || '').toUpperCase();
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > OCR_LIMITS.maxFileBytes) throw ocrError('IMPORT_OCR_SOURCE_LIMIT', 'The OCR source is empty or exceeds its size limit.');
  if (!['PDF', 'PNG', 'JPEG'].includes(format)) throw ocrError('IMPORT_OCR_FORMAT_UNSUPPORTED', 'Local OCR accepts PDF, PNG or JPEG sources only.');
  if (!binaries.tesseract || !binaries.prlimit || (format === 'PDF' && !binaries.pdftoppm)) throw ocrError('IMPORT_OCR_NOT_CONFIGURED', 'The required local OCR tools are not installed.');
  const pageCount = format === 'PDF' ? input.pageCount : 1;
  const pageNumbers = format === 'PDF' && Array.isArray(input.pageNumbers) ? input.pageNumbers : Array.from({ length: Math.min(Number.isSafeInteger(pageCount) ? pageCount : OCR_LIMITS.maxPages + 1, OCR_LIMITS.maxPages + 1) }, (_, index) => index + 1);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 50 || !pageNumbers.length || pageNumbers.length > OCR_LIMITS.maxPages || new Set(pageNumbers).size !== pageNumbers.length || pageNumbers.some(page => !Number.isSafeInteger(page) || page < 1 || page > pageCount)) throw ocrError('IMPORT_OCR_PAGE_LIMIT', `Local OCR accepts at most ${OCR_LIMITS.maxPages} scanned pages per source. No OCR pages were partially accepted.`);
  const deadline = Date.now() + Math.min(input.limits?.timeoutMs || OCR_LIMITS.timeoutMs, OCR_LIMITS.timeoutMs) - 250;
  const context = { prlimit: binaries.prlimit, signal: input.signal, deadline };
  const limits = { maxTextChars: Math.min(input.limits?.maxTextChars || 250000, 250000) };
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'voxel-procurement-ocr-'));
  try {
    await fsp.chmod(tempDir, 0o700);
    const source = path.join(tempDir, format === 'PDF' ? 'source.pdf' : 'source.png');
    if (format === 'PDF') await fsp.writeFile(source, buffer, { mode: 0o600 });
    else await normaliseImage(buffer, source);
    const pages = []; let totalChars = 0, totalWords = 0;
    for (const page of pageNumbers) {
      let image = source;
      if (format === 'PDF') {
        const prefix = path.join(tempDir, `page-${page}`);
        await runBounded(binaries.pdftoppm, ['-f', String(page), '-l', String(page), '-scale-to', String(OCR_LIMITS.maxDimension), '-singlefile', '-png', source, prefix], context);
        image = `${prefix}.png`;
        const stat = await fsp.stat(image);
        if (!stat.size || stat.size > 16 * 1024 * 1024) throw ocrError('IMPORT_OCR_IMAGE_LIMIT', 'A rendered OCR page exceeds its image size limit.');
      }
      const tsv = await runBounded(binaries.tesseract, [image, 'stdout', '-l', 'eng', '--psm', '3', 'tsv'], context);
      const output = parseTsv(tsv, page, limits);
      if ((totalChars += output.text.length) > limits.maxTextChars || (totalWords += output.wordCount) > OCR_LIMITS.maxWords) throw ocrError('IMPORT_OCR_RESULT_LIMIT', 'The complete OCR source exceeds its text limit. No OCR pages were partially accepted.');
      pages.push(output);
      if (format === 'PDF') await fsp.unlink(image);
    }
    if (!pages.some(page => page.text.trim())) throw ocrError('IMPORT_OCR_NO_TEXT', 'Local OCR found no readable text. Review the original source or enter its values manually.');
    return { pages, provider: PROVIDER, requiresReview: true };
  } finally { await fsp.rm(tempDir, { recursive: true, force: true }); }
}
function localOcrOptions() {
  const enabled = process.env.PROCUREMENT_OCR_ENABLED === 'true';
  const capability = ocrCapability(), binaries = tools();
  return {
    ocrEnabled: enabled, ocrProvider: PROVIDER,
    ocrAdapter: capability.available ? { name: PROVIDER, supportsFormat: format => !!capability.formats[format], extractText: (buffer, input) => localExtract(buffer, input, binaries) } : null
  };
}

module.exports = { localOcrOptions, ocrCapability, OCR_LIMITS };
