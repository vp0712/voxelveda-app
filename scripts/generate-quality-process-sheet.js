const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'public', 'forms');
const outputPath = path.join(outputDir, 'voxel-veda-quality-process-sheet.pdf');
const logoPath = path.join(root, 'public', 'Frame 1.png');

fs.mkdirSync(outputDir, { recursive: true });

const doc = new PDFDocument({ size: 'A4', margin: 34 });
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

const W = doc.page.width;
const navy = '#07111f';
const cyan = '#18d6d0';
const ink = '#111827';
const muted = '#475569';
const line = '#cbd5e1';

function text(value, x, y, options = {}) {
  doc.fillColor(options.color || ink)
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size || 8.5)
    .text(value, x, y, options);
}

function box(x, y, w, h, label, value = '') {
  doc.lineWidth(0.7).strokeColor(line).roundedRect(x, y, w, h, 5).stroke();
  text(label, x + 8, y + 7, { size: 7.5, color: muted, bold: true });
  if (value) text(value, x + 8, y + 21, { size: 8.2 });
}

function check(x, y, label) {
  doc.strokeColor(line).rect(x, y, 9, 9).stroke();
  text(label, x + 14, y - 1, { size: 7.6 });
}

function section(title, y) {
  doc.fillColor(navy).roundedRect(34, y, W - 68, 18, 4).fill();
  text(title, 42, y + 5, { color: '#ffffff', bold: true, size: 8.5 });
}

doc.fillColor(navy).rect(0, 0, W, 78).fill();
if (fs.existsSync(logoPath)) {
  doc.image(logoPath, 36, 17, { width: 96 });
}
text('QUALITY PROCESS SHEET', 214, 19, { color: '#ffffff', bold: true, size: 19 });
text('Production Traceability, Inspection & Release Record', 214, 45, { color: cyan, bold: true, size: 10 });
text('Document No: VV-QA-PS-001 | Revision: 1.0 | Controlled internal form', 36, 86, { color: muted, size: 8 });

let y = 104;
section('1. Job & Customer Details', y);
y += 26;
box(34, y, 126, 42, 'Job / Work Order No');
box(168, y, 126, 42, 'Customer / Project');
box(302, y, 126, 42, 'Part / Product Name');
box(436, y, 125, 42, 'Drawing / Revision');
y += 50;
box(34, y, 126, 42, 'Purchase Order / RFQ');
box(168, y, 126, 42, 'Quantity Required');
box(302, y, 126, 42, 'Due Date');
box(436, y, 125, 42, 'Prepared By / Date');

y += 58;
section('2. Material, Batch & Supplier Traceability', y);
y += 26;
box(34, y, 160, 42, 'Material / Resin / Component');
box(202, y, 126, 42, 'Supplier');
box(336, y, 108, 42, 'Batch / Lot / Heat');
box(452, y, 109, 42, 'COA / SDS Ref');
y += 50;
box(34, y, 160, 42, 'Machine / Equipment Used');
box(202, y, 126, 42, 'Operator');
box(336, y, 108, 42, 'Program / Setting Ref');
box(452, y, 109, 42, 'Material Accepted By');

y += 58;
section('3. Process Controls & In-Process Checks', y);
y += 28;
text('Record actual settings and verification results. Attach photos, inspection reports, calibration evidence or process logs where required.', 42, y - 5, { size: 7.8, color: muted });
y += 12;
const tableX = 34;
const col = [0, 92, 196, 300, 404];
['Process Step', 'Required Setting / Criteria', 'Actual Result', 'Checked By / Time', 'Pass / Hold / Fail'].forEach((h, i) => {
  box(tableX + col[i], y, i === 4 ? 123 : 96, 22, h);
});
y += 22;
for (let i = 0; i < 5; i += 1) {
  doc.strokeColor(line).rect(tableX, y, 527, 26).stroke();
  doc.moveTo(tableX + 92, y).lineTo(tableX + 92, y + 26).stroke();
  doc.moveTo(tableX + 196, y).lineTo(tableX + 196, y + 26).stroke();
  doc.moveTo(tableX + 300, y).lineTo(tableX + 300, y + 26).stroke();
  doc.moveTo(tableX + 404, y).lineTo(tableX + 404, y + 26).stroke();
  y += 26;
}

y += 16;
section('4. Final Quality Inspection & Release Criteria', y);
y += 26;
check(42, y, 'Visual condition accepted');
check(190, y, 'Dimensions verified against drawing/specification');
check(420, y, 'Quantity verified');
y += 18;
check(42, y, 'No contamination, damage or foreign material');
check(300, y, 'Packaging/labelling accepted');
y += 18;
check(42, y, 'Customer or regulatory requirements reviewed');
check(300, y, 'Process sheet and attachments complete');
y += 24;
box(34, y, 170, 38, 'Inspection Method / Gauge ID');
box(212, y, 170, 38, 'Final Result');
box(390, y, 171, 38, 'Released By / Date');

y += 54;
section('5. Non-Conformance, Hold, Rework & Corrective Action', y);
y += 26;
box(34, y, 527, 56, 'Issue, risk, hold reason, rework details, root cause and corrective action');
y += 66;
box(34, y, 170, 38, 'NCR / CAPA Reference');
box(212, y, 170, 38, 'Disposition');
box(390, y, 171, 38, 'Approved By / Date');

doc.addPage({ margin: 34 });
doc.fillColor(navy).rect(0, 0, W, 58).fill();
if (fs.existsSync(logoPath)) doc.image(logoPath, 36, 14, { width: 78 });
text('QUALITY PROCESS SHEET - CONTINUATION', 186, 20, { color: '#ffffff', bold: true, size: 15 });

y = 76;
section('6. Attachments & Evidence Checklist', y);
y += 28;
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
  check(42 + (index % 2) * 260, y + Math.floor(index / 2) * 22, label);
});

y += 104;
section('7. Job Close-Out Declaration', y);
y += 28;
text('I confirm the job record has been reviewed, mandatory evidence is attached, deviations have been recorded, and released product is traceable to material, process and inspection records.', 42, y, { size: 8.3, width: 500 });
y += 34;
box(34, y, 160, 42, 'Prepared By / Signature');
box(206, y, 160, 42, 'Quality Approval / Signature');
box(378, y, 183, 42, 'Date / Time');

y += 60;
section('8. Use Instructions', y);
y += 28;
[
  'Fill this form for production jobs requiring traceability, inspection evidence, customer review, council review, government body review, complaint investigation, product failure investigation or internal quality release.',
  'Complete Sections 1-4 before release. Complete Section 5 if any hold, defect, rework, concession or corrective action occurs.',
  'Upload the completed PDF or scanned copy into Compliance & Licences under Quality / Process Sheet, or attach it to the related raw material, packaging or job record.',
  'Keep original supporting evidence with the job record: photos, drawings, material certificates, inspection results, approval emails and delivery documents.',
  'This is an internal controlled evidence template. Confirm any site-specific statutory form with your local council, regulator, customer contract or certifier.'
].forEach((item, index) => {
  text(`${index + 1}. ${item}`, 46, y + index * 28, { size: 8.5, width: 500 });
});

y += 168;
doc.strokeColor(line).roundedRect(34, y, 527, 78, 8).stroke();
text('Controlled Document Notice', 46, y + 12, { bold: true, size: 9 });
text('Voxel Veda Pty Ltd should review this form when process, product, customer, site, council or regulatory requirements change. Retain completed copies according to company record-retention policy and applicable contract or statutory requirements.', 46, y + 30, { size: 8.2, color: muted, width: 500 });

doc.end();

stream.on('finish', () => {
  console.log(outputPath);
});
