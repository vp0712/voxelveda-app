const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'public', 'forms');
const outputPath = path.join(outputDir, 'voxel-veda-quality-process-sheet.pdf');
const logoPath = path.join(root, 'public', 'Frame 1.png');

fs.mkdirSync(outputDir, { recursive: true });

const doc = new PDFDocument({ size: 'A4', margin: 30 });
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

const pageW = doc.page.width;
const left = 30;
const right = pageW - 30;
const contentW = right - left;
const navy = '#07111f';
const panel = '#f8fafc';
const cyan = '#16d4cf';
const ink = '#111827';
const muted = '#64748b';
const border = '#cbd5e1';
const soft = '#e2e8f0';

function t(value, x, y, options = {}) {
  doc
    .fillColor(options.color || ink)
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size || 8)
    .text(value, x, y, options);
}

function header(title, subtitle) {
  doc.fillColor(navy).rect(0, 0, pageW, 72).fill();
  if (fs.existsSync(logoPath)) doc.image(logoPath, left, 6, { width: 62 });
  t(title, 116, 17, { color: '#ffffff', bold: true, size: 20 });
  t(subtitle, 116, 43, { color: cyan, bold: true, size: 9.5 });
  t('Document No: VV-QA-PS-001   Revision: 1.1   Controlled internal quality record', left, 80, { color: muted, size: 7.5 });
}

function section(y, title) {
  doc.fillColor(navy).roundedRect(left, y, contentW, 16, 4).fill();
  t(title, left + 8, y + 4.5, { color: '#ffffff', bold: true, size: 8 });
  return y + 22;
}

function field(x, y, w, h, label) {
  doc.fillColor('#ffffff').roundedRect(x, y, w, h, 4).fill();
  doc.strokeColor(border).lineWidth(0.65).roundedRect(x, y, w, h, 4).stroke();
  t(label, x + 6, y + 5, { color: muted, bold: true, size: 6.8 });
}

function rowFields(y, fields, h = 34) {
  const gap = 7;
  const totalGap = gap * (fields.length - 1);
  const unit = (contentW - totalGap) / fields.length;
  fields.forEach((label, index) => field(left + index * (unit + gap), y, unit, h, label));
  return y + h + 8;
}

function sectionPanel(y, h) {
  doc.fillColor(panel).roundedRect(left, y, contentW, h, 7).fill();
  doc.strokeColor(soft).lineWidth(0.7).roundedRect(left, y, contentW, h, 7).stroke();
}

function checkbox(x, y, label, w = 156) {
  doc.strokeColor(border).lineWidth(0.7).rect(x, y, 8, 8).stroke();
  t(label, x + 13, y - 0.5, { size: 7.2, width: w });
}

function table(y, headers, widths, rows, rowH = 23) {
  const tableW = widths.reduce((sum, w) => sum + w, 0);
  doc.fillColor(navy).roundedRect(left, y, tableW, 18, 4).fill();
  let x = left;
  headers.forEach((h, i) => {
    t(h, x + 5, y + 5, { color: '#ffffff', bold: true, size: 7 });
    x += widths[i];
  });
  y += 18;
  for (let r = 0; r < rows; r += 1) {
    doc.strokeColor(border).lineWidth(0.6).rect(left, y, tableW, rowH).stroke();
    x = left;
    widths.slice(0, -1).forEach((w) => {
      x += w;
      doc.moveTo(x, y).lineTo(x, y + rowH).stroke();
    });
    y += rowH;
  }
  return y;
}

header('QUALITY PROCESS SHEET', 'Production Traceability, Inspection & Release Record');

let y = 98;
y = section(y, '1. Job & Customer Details');
sectionPanel(y - 3, 80);
y = rowFields(y + 6, ['Job / Work Order No', 'Customer / Project', 'Part / Product Name', 'Drawing / Revision'], 30);
y = rowFields(y, ['Purchase Order / RFQ', 'Quantity Required', 'Due Date', 'Prepared By / Date'], 30);

y += 8;
y = section(y, '2. Material, Batch & Supplier Traceability');
sectionPanel(y - 3, 80);
y = rowFields(y + 6, ['Material / Resin / Component', 'Supplier', 'Batch / Lot / Heat', 'COA / SDS Ref'], 30);
y = rowFields(y, ['Machine / Equipment Used', 'Operator', 'Program / Setting Ref', 'Material Accepted By'], 30);

y += 8;
y = section(y, '3. Process Controls & In-Process Checks');
t('Record actual settings and verification results. Attach photos, calibration evidence, inspection reports or machine logs where required.', left + 2, y, { color: muted, size: 7.3 });
y += 14;
y = table(
  y,
  ['Process Step', 'Required Setting / Criteria', 'Actual Result', 'Checked By / Time', 'Pass / Hold / Fail'],
  [88, 132, 112, 108, 100],
  6,
  22
);

y += 11;
y = section(y, '4. Final Quality Inspection & Release Criteria');
sectionPanel(y - 3, 92);
checkbox(left + 12, y + 10, 'Visual condition accepted');
checkbox(left + 190, y + 10, 'Dimensions verified against drawing/specification', 220);
checkbox(left + 430, y + 10, 'Quantity verified', 90);
checkbox(left + 12, y + 30, 'No contamination, damage or foreign material', 230);
checkbox(left + 280, y + 30, 'Packaging / labelling accepted', 180);
checkbox(left + 12, y + 50, 'Customer or regulatory requirements reviewed', 230);
checkbox(left + 280, y + 50, 'Process sheet and attachments complete', 200);
y += 70;
y = rowFields(y, ['Inspection Method / Gauge ID', 'Final Result', 'Released By / Date'], 28);

y += 5;
y = section(y, '5. Non-Conformance, Hold, Rework & Corrective Action');
sectionPanel(y - 3, 96);
field(left + 8, y + 6, contentW - 16, 44, 'Issue, risk, hold reason, rework details, root cause and corrective action');
field(left + 8, y + 58, 170, 28, 'NCR / CAPA Reference');
field(left + 188, y + 58, 170, 28, 'Disposition');
field(left + 368, y + 58, contentW - 376, 28, 'Approved By / Date');

doc.addPage({ margin: 30 });
header('QUALITY PROCESS SHEET', 'Continuation, Evidence & Close-Out');
y = 98;

y = section(y, '6. Attachments & Evidence Checklist');
sectionPanel(y - 3, 96);
[
  'Drawing / specification / customer approval',
  'Material certificate, COA, SDS or supplier document',
  'Machine setup record or program reference',
  'In-process inspection evidence',
  'Final inspection report',
  'Delivery docket / packing photo',
  'Customer communication / concession approval',
  'NCR, rework or corrective action record'
].forEach((label, index) => {
  checkbox(left + 12 + (index % 2) * 265, y + 10 + Math.floor(index / 2) * 20, label, 238);
});

y += 112;
y = section(y, '7. Job Close-Out Declaration');
sectionPanel(y - 3, 78);
t('I confirm the job record has been reviewed, mandatory evidence is attached, deviations have been recorded, and released product is traceable to material, process and inspection records.', left + 10, y + 9, { size: 8, width: contentW - 20 });
y += 35;
y = rowFields(y, ['Prepared By / Signature', 'Quality Approval / Signature', 'Date / Time'], 30);

y += 8;
y = section(y, '8. Use Instructions');
sectionPanel(y - 3, 158);
[
  'Use for production jobs requiring traceability, inspection evidence, customer review, council review, government body review, complaint investigation, product failure investigation or internal quality release.',
  'Complete Sections 1-4 before release. Complete Section 5 for any hold, defect, rework, concession or corrective action.',
  'Upload the completed PDF or scanned copy into Compliance & Licences under Quality / Process Sheet, or attach it to the related raw material, packaging or job record.',
  'Keep supporting evidence with the job record: photos, drawings, material certificates, inspection results, approval emails, delivery documents and NCR/CAPA records.',
  'This is an internal controlled evidence template. Confirm site-specific statutory forms with your local council, regulator, customer contract or certifier.'
].forEach((item, index) => {
  t(`${index + 1}. ${item}`, left + 12, y + 10 + index * 26, { size: 8, width: contentW - 24 });
});

y += 174;
doc.strokeColor(border).lineWidth(0.8).roundedRect(left, y, contentW, 62, 7).stroke();
t('Controlled Document Notice', left + 12, y + 10, { bold: true, size: 8.5 });
t('Voxel Veda Pty Ltd should review this form when process, product, customer, site, council or regulatory requirements change. Retain completed copies according to company record-retention policy and applicable contract or statutory requirements.', left + 12, y + 27, { size: 7.8, color: muted, width: contentW - 24 });

doc.end();

stream.on('finish', () => {
  console.log(outputPath);
});
