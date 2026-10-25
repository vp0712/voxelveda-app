'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { companyProfile } = require('../config/companyProfile');
const DOCUMENT_LAYOUT_VERSION = '2026-10-25.1';

function pdfError(message, code = 'PDF_DOCUMENT_INVALID') {
  return Object.assign(new Error(message), { code, status: 422 });
}
function safePdfFilename(value) {
  const base = String(value || 'document').normalize('NFKC').replace(/[\\/\r\n\0"<>:|?*]/g, '-').replace(/[^\x20-\x7E]/g, '-').replace(/\s+/g, ' ').trim().replace(/(?:\.pdf)+$/i, '').replace(/\.(?:tmp|html?|csv|xlsx?|zip|jpe?g|png)$/i, '').slice(0, 160) || 'document';
  return `${base}.pdf`;
}
function compact(value) { return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase(); }
async function validatePdf(buffer, { expectedText = [], orderedExpectedText = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 20 * 1024 * 1024 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw pdfError('Document generation did not produce PDF bytes. No document was sent.');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
  try {
    const pdf = await task.promise;
    if (!pdf.numPages || pdf.numPages > 500) throw pdfError('The PDF has no valid pages or exceeds the page limit.');
    const texts = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const layer = await page.getTextContent();
      texts.push(layer.items.map(item => item.str || '').join(' '));
      page.cleanup();
    }
    const text = texts.join(' ').replace(/\s+/g, ' ').trim();
    const body = compact(text);
    let contentAt = 0;
    for (const expected of expectedText.filter(value => value !== undefined && value !== null && String(value).trim())) {
      const wanted = compact(expected), found = body.indexOf(wanted, orderedExpectedText ? contentAt : 0);
      if (found < 0) throw pdfError('The PDF content does not match its document data.', 'PDF_CONTENT_MISMATCH');
      if (orderedExpectedText) contentAt = found + wanted.length;
    }
    return { pages: pdf.numPages, text, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length, status: 'VALIDATED' };
  } catch (error) {
    if (error.code?.startsWith('PDF_')) throw error;
    throw pdfError('The PDF could not be parsed. No document was sent.', 'PDF_PARSE_FAILED');
  } finally { await task.destroy(); }
}
function money(value, currency = 'AUD') {
  if (!Number.isFinite(Number(value))) throw pdfError('A document amount is invalid.', 'PDF_DATA_INVALID');
  return `${currency} ${Number(value).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
async function buildDocumentPdf(data, proofOnly = false) {
  const PDFDocument = require('pdfkit');
  const company = companyProfile();
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: `${data.title} ${data.reference || ''}`, Author: company.name } });
  doc.registerFont('DocumentRegular', path.join(__dirname, '..', 'assets', 'fonts', 'OpenSans-Regular.ttf'));
  doc.registerFont('DocumentBold', path.join(__dirname, '..', 'assets', 'fonts', 'OpenSans-Bold.ttf'));
  const chunks = [];
  const completion = new Promise((resolve, reject) => { doc.on('data', chunk => { if (!proofOnly) chunks.push(chunk); }); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const left = 42, width = doc.page.width - 84, bottom = doc.page.height - 64;
  const navy = '#102b4e', blue = '#2563eb', ink = '#172a43', muted = '#526277';
  let y, pageStartY;
  function text(value, x, at, available, options = {}) { if (!proofOnly) doc.text(String(value ?? ''), x, at, { width: available, lineGap: 2, ...options }); }
  function header(continued = false) {
    if (!proofOnly) doc.rect(0, 0, doc.page.width, 8).fill(blue);
    const logo = path.join(__dirname, '..', 'public', 'Frame 1.png');
    if (!proofOnly && fs.existsSync(logo)) doc.image(logo, left, 24, { fit: [94, 56] });
    doc.font('DocumentBold').fontSize(19).fillColor(navy);
    const titleWidth=width-118;
    const longTitle=String(data.title).length>24 || doc.widthOfString(String(data.title))>titleWidth*0.85;
    let titleSize=longTitle?15:19;
    doc.fontSize(titleSize);
    while(titleSize>12 && doc.widthOfString(String(data.title))>titleWidth){titleSize--;doc.fontSize(titleSize);}
    const titleHeight=doc.heightOfString(data.title,{width:titleWidth,lineGap:2});
    // Long headings use the full available panel from its left edge. This
    // keeps their complete title readable without a right-aligned overflow.
    text(data.title,160,29,titleWidth,{align:longTitle?'left':'right'});
    const referenceY=29+titleHeight+5;
    doc.font('DocumentRegular').fontSize(9).fillColor(muted);
    text(data.reference || '', 160, referenceY, width - 118, { align: 'right' });
    const referenceHeight=doc.heightOfString(data.reference || '',{width:width-118,lineGap:2});
    const dateY=referenceY+referenceHeight+3;
    text(continued ? 'Continued' : `${data.issueLabel || 'Issued'} ${dateLabel(data.issueDate || new Date())}`, 160, dateY, width - 118, { align: 'right' });
    const headerEnd=Math.max(94,dateY+22);
    if (!proofOnly) doc.moveTo(left, headerEnd).lineTo(left + width, headerEnd).strokeColor('#d9e1ec').stroke();
    y = headerEnd+14; pageStartY = y;
  }
  function nextPage() {
    if (doc.bufferedPageRange().count >= 500) throw pdfError('The document exceeds the PDF page limit. Narrow the report selection.', 'PDF_DATA_INVALID');
    doc.addPage(); header(true);
  }
  // PDFKit can wrap an entire cell onto additional pages by itself, which
  // would bypass the table heading/background and move the other cells to a
  // different row. Fit an exact prefix instead, then continue every remaining
  // cell together beneath the next repeated heading. Never truncate data.
  function cellFragment(value, availableWidth, availableHeight) {
    const height = content => doc.heightOfString(content, { width: availableWidth, lineGap: 2 });
    if (!value || height(value) <= availableHeight) return value;
    const characters = Array.from(value);
    let low = 0, high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (height(characters.slice(0, middle).join('')) <= availableHeight) low = middle;
      else high = middle - 1;
    }
    if (!low) throw pdfError('Document text needs enough space for a readable page.', 'PDF_DATA_INVALID');
    let fragment = characters.slice(0, low).join('');
    // Prefer a whole-word boundary. A long reference with no spaces still
    // progresses at Unicode code-point boundaries and retains every character.
    const boundary = fragment.search(/\s+\S*$/u);
    if (boundary > 0) fragment = fragment.slice(0, boundary + 1);
    return fragment;
  }
  const expectedText = [data.title, data.reference];
  function paragraph(value, options = {}) {
    const style = () => doc.font(options.bold ? 'DocumentBold' : 'DocumentRegular').fontSize(options.size || 9).fillColor(options.color || ink);
    style();
    let remaining = String(value ?? ''), firstFragment = true;
    const height = doc.heightOfString(remaining, { width, lineGap: 2 });
    // Ordinary paragraphs stay together. Longer authorised notes/party details
    // continue without losing words, style or document identity at a page break.
    if (height <= bottom-pageStartY && y+height > bottom) nextPage();
    while (firstFragment || remaining) {
      style();
      const lineHeight = doc.heightOfString('M', {width,lineGap:2});
      if (bottom-y < lineHeight) { nextPage(); style(); }
      const fragment = cellFragment(remaining,width,bottom-y);
      const fragmentHeight = doc.heightOfString(fragment,{width,lineGap:2});
      text(fragment,left,y,width); y += fragmentHeight;
      expectedText.push(fragment);
      remaining = remaining.slice(fragment.length);
      firstFragment = false;
      if (remaining) nextPage();
    }
    y += 9;
  }
  header();
  const details = [company.legalName || company.name, company.address, company.phone, company.email, company.abn ? `ABN ${company.abn}` : ''].filter(Boolean);
  paragraph(details.join(' | '), { size: 8, color: muted });
  if (data.party) paragraph(data.party, { bold: true, size: 11 });
  if (data.period) paragraph(`Period: ${data.period}`);
  for (const table of data.tables || [{ columns: data.columns || [], rows: data.rows || [] }]) {
    const columns = table.columns;
    if (!columns.length) continue;
    const scale = width / columns.reduce((sum, col) => sum + (col.width || 1), 0);
    if (table.title) {
      // Keep a section title with its repeated heading and first data row.
      // This avoids orphaned headings at the foot of a multipage report.
      doc.font('DocumentBold').fontSize(11);
      const titleHeight=doc.heightOfString(table.title,{width,lineGap:2})+9;
      doc.font('DocumentBold').fontSize(8);
      const headingHeight=Math.max(26,...columns.map(col=>doc.heightOfString(String(col.label),{width:(col.width||1)*scale-14,lineGap:2})+16));
      doc.font('DocumentRegular').fontSize(8);
      const first=table.rows[0]||columns.map((_,i)=>i?'':'No records for this period.');
      const firstHeight=Math.max(28,...first.map((cell,i)=>doc.heightOfString(String(cell??''),{width:(columns[i].width||1)*scale-14,lineGap:2})+16));
      const firstReserve = firstHeight > bottom-pageStartY-headingHeight ? 28 : firstHeight;
      if(y+titleHeight+headingHeight+firstReserve>bottom)nextPage();
      paragraph(table.title,{bold:true,size:11});
    }
    function tableHeader() {
      doc.font('DocumentBold').fontSize(8).fillColor('#ffffff');
      const height=Math.max(26,...columns.map(col=>doc.heightOfString(String(col.label),{width:(col.width || 1)*scale-14,lineGap:2})+16));
      if(height>80)throw pdfError('Document table headings need wider columns for a readable layout.','PDF_DATA_INVALID');
      if (y + height + 6 > bottom) nextPage();
      if (!proofOnly) doc.rect(left, y, width, height).fill(navy); let x = left;
      doc.font('DocumentBold').fontSize(8).fillColor('#ffffff');
      for (const col of columns) { const w = (col.width || 1) * scale; text(col.label, x + 7, y + 8, w - 14, { align: col.align || 'left' }); x += w; }
      y += height;
    }
    tableHeader();
    const rows = table.rows.length ? table.rows : [columns.map((_, index) => index ? '' : 'No records for this period.')];
    rows.forEach((row, index) => {
      const cells = row.map(value => String(value ?? ''));
      doc.font('DocumentRegular').fontSize(8);
      const rowHeight = Math.max(28, ...cells.map((cell, i) => doc.heightOfString(cell, { width: (columns[i].width || 1) * scale - 14, lineGap: 2 }) + 16));
      doc.font('DocumentBold').fontSize(8);
      const headingHeight=Math.max(26,...columns.map(col=>doc.heightOfString(String(col.label),{width:(col.width||1)*scale-14,lineGap:2})+16));
      // Keep ordinary rows intact when they fit a fresh page. Oversized rows
      // are split across as many pages as necessary, with the same row shade.
      if (rowHeight <= bottom-pageStartY-headingHeight && y + rowHeight > bottom) { nextPage(); tableHeader(); }
      let remaining = cells, firstFragment = true;
      while (firstFragment || remaining.some(Boolean)) {
        if (bottom-y < 28) { nextPage(); tableHeader(); }
        doc.font('DocumentRegular').fontSize(8);
        const fragments = remaining.map((cell,i)=>cellFragment(cell,(columns[i].width||1)*scale-14,bottom-y-16));
        const height = Math.max(28,...fragments.map((cell,i)=>doc.heightOfString(cell,{width:(columns[i].width||1)*scale-14,lineGap:2})+16));
        if (!proofOnly) doc.rect(left,y,width,height).fill(index % 2 ? '#ffffff' : '#f2f6fc');
        let x = left;
        fragments.forEach((cell,i)=>{const w=(columns[i].width||1)*scale;doc.fillColor(ink).font('DocumentRegular').fontSize(8);text(cell,x+7,y+8,w-14,{align:columns[i].align||'left'});x+=w;});
        y += height;
        expectedText.push(...fragments);
        remaining = remaining.map((cell,i)=>cell.slice(fragments[i].length));
        firstFragment = false;
        if (remaining.some(Boolean)) { nextPage(); tableHeader(); }
      }
    });
    y += 17;
  }
  if (data.totals?.length) {
    const blockHeight = data.totals.length * 28 + (data.notes || []).reduce((sum, note) => sum + doc.font('DocumentRegular').fontSize(8).heightOfString(note, { width, lineGap: 2 }) + 9, 0);
    if (y + Math.min(blockHeight, bottom - 130) > bottom) nextPage();
  }
  for (const total of data.totals || []) paragraph(`${total.label}: ${total.value}`, { bold: true, size: 10 });
  for (const note of data.notes || []) paragraph(note, { size: 8, color: muted });
  if(data.verificationUrl){
    if(y+130>bottom)nextPage();
    if (!proofOnly) {
      const QRCode=require('qrcode');
      const qr=await QRCode.toBuffer(String(data.verificationUrl),{errorCorrectionLevel:'H',margin:2,width:240});
      doc.image(qr,left,y,{width:100,height:100});
      doc.link(left,y,100,100,String(data.verificationUrl));
    }
    doc.font('DocumentRegular').fontSize(8).fillColor(muted);text('Scan to verify the current credential.',left+114,y+40,width-114);
    y+=116;
  }
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    doc.font('DocumentRegular').fontSize(8).fillColor(muted);
    const oldBottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    text(company.name, left, doc.page.height - 34, width / 2);
    text(`Page ${index + 1} of ${pages.count}`, left + width / 2, doc.page.height - 34, width / 2, { align: 'right' });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  const buffer = await completion;
  const contentProof = { schema_version: 1, layout_version: DOCUMENT_LAYOUT_VERSION, source_sha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'), fragments: expectedText };
  if (proofOnly) return contentProof;
  const validation = await validatePdf(buffer, { expectedText, orderedExpectedText: true });
  return { buffer, filename: safePdfFilename(data.filename || data.reference || data.title), contentType: 'application/pdf', contentDisposition: 'attachment', validation, contentProof };
}
async function createDocumentPdf(data) { return buildDocumentPdf(data); }
// Re-derive complete content identity from the trusted model using the exact
// layout/font metrics, without drawing a second business document. A retained
// PDF caller cannot supply, omit or forge the expected fragments.
async function deriveDocumentContentProof(data) { return buildDocumentPdf(data, true); }
async function sendPdfResponse(res, artifact, download = false) {
  await validatePdf(artifact.buffer);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${safePdfFilename(artifact.filename)}"`);
  res.setHeader('Content-Length', artifact.buffer.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(artifact.buffer);
}
async function storedDocumentArtifact(body, filename) {
  if (!Buffer.isBuffer(body) || body.length > 20 * 1024 * 1024) throw pdfError('The stored document is missing or exceeds the PDF processing limit.');
  if (body.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { buffer: body, filename: safePdfFilename(filename), validation: await validatePdf(body) };
  }
  const jpeg = body.length > 3 && body[0] === 255 && body[1] === 216 && body[2] === 255;
  const png = body.length > 8 && body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!jpeg && !png) throw pdfError('This historical document format cannot be delivered as a validated PDF. Its original file and record are preserved.', 'PDF_SOURCE_FORMAT_UNSUPPORTED');
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 32, info: { Title: safePdfFilename(filename) } });
  const chunks = [];
  const complete = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  try {
    const image = doc.openImage(body);
    if (image.width * image.height > 40000000) throw pdfError('The scanned document is too large to render safely.', 'PDF_SOURCE_IMAGE_LIMIT');
    doc.image(image, 32, 32, { fit: [doc.page.width - 64, doc.page.height - 64], align: 'center', valign: 'center' });
    doc.end();
    const buffer = await complete;
    return { buffer, filename: safePdfFilename(filename), validation: await validatePdf(buffer), converted_from: jpeg ? 'image/jpeg' : 'image/png' };
  } catch (error) { doc.destroy(); throw error; }
}
module.exports = { createDocumentPdf, deriveDocumentContentProof, DOCUMENT_LAYOUT_VERSION, validatePdf, safePdfFilename, sendPdfResponse, storedDocumentArtifact, money, dateLabel, pdfError };
