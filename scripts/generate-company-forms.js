const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'public', 'forms', 'company');
const logoPath = path.join(root, 'public', 'Frame 1.png');
const privacyQrPath = path.join(root, 'public', 'privacy-qr.png');
const privacyPolicyUrl = 'https://voxelveda-app-production.up.railway.app/privacy-policy.html';

fs.mkdirSync(outputDir, { recursive: true });

const colors = {
  navy: '#07111f',
  cyan: '#16d4cf',
  ink: '#111827',
  muted: '#64748b',
  border: '#cbd5e1',
  panel: '#f8fafc',
  warn: '#f59e0b'
};

const forms = [
  {
    file: 'privacy-confidentiality-policy.pdf',
    title: 'Privacy, Confidentiality & Data Handling',
    category: 'Policy',
    subtitle: 'Strict information access, disclosure and document handling acknowledgement',
    visual: 'contract',
    note: 'Use for staff, contractors, suppliers, customers or visitors who access company, customer, supplier, invoice, production, quality, safety or inspection information.',
    sections: [
      ['Recipient Details', ['Name / Company', 'Role / Relationship', 'Email', 'Phone', 'Date Issued', 'Issued By']],
      ['Information Covered', ['Customer / RFQ data', 'Invoices / payments', 'Supplier records', 'Staff records', 'Drawings / designs', 'Quality / process evidence']],
      ['Acknowledgement', ['Access purpose', 'Restrictions explained', 'No unauthorised sharing', 'Return/delete requirement', 'Recipient signature', 'Company sign-off']]
    ],
    checklist: ['Identity verified', 'Access need confirmed', 'Policy explained', 'QR policy link provided', 'Signed acknowledgement retained']
  },
  {
    file: 'delivery-docket-form.pdf',
    title: 'Delivery Docket / Dispatch Form',
    category: 'Operations',
    subtitle: 'Dispatch, handover and delivery evidence',
    visual: 'dispatch',
    note: 'Use when goods, parts, samples or finished jobs leave the workshop. Keep a signed copy with the job or invoice record.',
    sections: [
      ['Delivery Details', ['Docket No', 'Date', 'Customer / Receiver', 'Contact Number', 'Delivery Address', 'Carrier / Driver']],
      ['Item Register', ['Item / Part Description', 'Job / Invoice Ref', 'Qty', 'Condition', 'Packed By', 'Checked By']],
      ['Handover Confirmation', ['Receiver Name', 'Signature', 'Delivery Time', 'Notes / Damage / Shortage']]
    ],
    checklist: ['Goods checked against order', 'Packaging acceptable', 'Photos taken if required', 'Customer notified', 'Signed proof retained']
  },
  {
    file: 'staff-joining-form.pdf',
    title: 'Staff Joining Form',
    category: 'HR',
    subtitle: 'New staff onboarding and access setup',
    visual: 'staff',
    note: 'Use before a new staff member starts. Store with employment, training and system access records.',
    sections: [
      ['Personal Details', ['Full Name', 'Preferred Name', 'Email', 'Mobile', 'Emergency Contact', 'Address']],
      ['Employment Details', ['Role', 'Department', 'Start Date', 'Manager', 'Pay / Award Reference', 'Probation Review Date']],
      ['Access & Equipment', ['Portal Username', 'Allowed Sections', 'Keys / Devices Issued', 'PPE Issued', 'Induction Completed', 'Signed By']]
    ],
    checklist: ['Identity checked', 'Tax/super paperwork received', 'WHS induction booked', 'Portal access approved', 'Policies acknowledged']
  },
  {
    file: 'safety-induction-form.pdf',
    title: 'Safety Induction Form',
    category: 'Safety',
    subtitle: 'Workshop safety briefing and sign-off',
    visual: 'safety',
    note: 'Use for staff, contractors and visitors before working around machinery, chemicals, tools or production areas.',
    sections: [
      ['Inductee', ['Name', 'Company', 'Role / Purpose', 'Date', 'Inducted By', 'Site Area']],
      ['Topics Covered', ['Emergency exits', 'PPE', 'Machine isolation', 'Manual handling', 'Chemical/SDS access', 'Incident reporting']],
      ['Declaration', ['Inductee Signature', 'Inductor Signature', 'Restrictions / Supervision Required']]
    ],
    checklist: ['PPE explained', 'No-go zones explained', 'Emergency process explained', 'Hazards explained', 'Questions answered']
  },
  {
    file: 'client-intake-form.pdf',
    title: 'Client / Project Intake Form',
    category: 'Client',
    subtitle: 'New customer requirement capture',
    visual: 'client',
    note: 'Use before quoting or starting a job so technical, quality and delivery expectations are recorded.',
    sections: [
      ['Client Details', ['Company', 'Contact Name', 'Email', 'Phone', 'Billing Address', 'Delivery Address']],
      ['Project Details', ['Part / Product', 'Material', 'Quantity', 'Application', 'Drawing / File Ref', 'Target Date']],
      ['Quality Requirements', ['Tolerance / Finish', 'Certification Needed', 'Inspection Requirement', 'Packaging Requirement', 'Special Notes']]
    ],
    checklist: ['Drawing received', 'Material confirmed', 'Use/application understood', 'Risk reviewed', 'Quote approval captured']
  },
  {
    file: 'job-contract-agreement.pdf',
    title: 'Job Contract / Work Agreement',
    category: 'Contract',
    subtitle: 'Scope, commercial terms and acceptance',
    visual: 'contract',
    note: 'Use before commencing custom work where scope, payment, delivery or variation terms need written acceptance.',
    sections: [
      ['Parties', ['Customer / Company', 'Contact', 'Voxel Veda Representative', 'Date', 'Quote / RFQ Ref']],
      ['Scope', ['Work Description', 'Files / Drawings', 'Materials', 'Quantity', 'Delivery Method', 'Exclusions']],
      ['Commercial Terms', ['Price / Rate', 'Deposit', 'Payment Terms', 'Lead Time', 'Variation Approval', 'Acceptance Signature']]
    ],
    checklist: ['Scope confirmed', 'Payment terms accepted', 'Variation rule accepted', 'Customer approval signed', 'Files archived']
  },
  {
    file: 'incident-near-miss-report.pdf',
    title: 'Incident / Near Miss Report',
    category: 'Safety',
    subtitle: 'Safety event, injury, damage or near-miss record',
    visual: 'incident',
    note: 'Use immediately after any injury, near miss, machine event, chemical spill, property damage or safety concern.',
    sections: [
      ['Event Details', ['Date / Time', 'Reported By', 'Location', 'People Involved', 'Witnesses', 'Immediate Action']],
      ['Description', ['What happened', 'Potential cause', 'Injury / Damage', 'Photos / Evidence', 'Supervisor Notified']],
      ['Corrective Action', ['Action Required', 'Owner', 'Due Date', 'Completed Date', 'Manager Sign-off']]
    ],
    checklist: ['Area made safe', 'First aid offered', 'Evidence captured', 'Root cause reviewed', 'Corrective action assigned']
  },
  {
    file: 'machinery-prestart-checklist.pdf',
    title: 'Machinery Pre-Start Checklist',
    category: 'Machinery',
    subtitle: 'Daily machine safety and readiness check',
    visual: 'machine',
    note: 'Use before operating printers, CNC, compressors, cutting tools, handling equipment or workshop machinery.',
    sections: [
      ['Machine Details', ['Machine ID', 'Operator', 'Date', 'Start Time', 'Job / Program', 'Supervisor']],
      ['Checks', ['Guards in place', 'Emergency stop tested', 'Cables/hoses safe', 'Tooling secure', 'Ventilation/area clear', 'Abnormal noise/leak']],
      ['Outcome', ['Safe to operate?', 'Faults found', 'Maintenance required', 'Operator Signature']]
    ],
    checklist: ['PPE worn', 'Emergency stop tested', 'Area clean', 'No visible defects', 'Faults reported before use']
  },
  {
    file: 'hazard-risk-assessment.pdf',
    title: 'Hazard & Risk Assessment Form',
    category: 'Safety',
    subtitle: 'Job hazard analysis and control record',
    visual: 'risk',
    note: 'Use before high-risk, unfamiliar, changed or non-routine work. Keep with job record and review after changes.',
    sections: [
      ['Task Details', ['Task / Job', 'Location', 'Assessor', 'Date', 'People Consulted', 'Review Date']],
      ['Hazard Table', ['Hazard', 'Risk', 'Existing Controls', 'Risk Rating', 'Additional Controls', 'Responsible Person']],
      ['Approval', ['Work approved by', 'Controls verified by', 'Review notes']]
    ],
    checklist: ['Workers consulted', 'Controls selected', 'PPE defined', 'Residual risk acceptable', 'Review date set']
  },
  {
    file: 'hygiene-housekeeping-chart.pdf',
    title: 'Workshop Hygiene & Housekeeping Chart',
    category: 'Charts',
    subtitle: 'Clean, organised and inspection-ready workspace rules',
    visual: 'hygiene',
    note: 'Display in work areas and use during internal inspections or council/customer visits.',
    chart: ['Keep walkways clear', 'Clean spills immediately', 'Store materials in labelled areas', 'Remove dust and waste daily', 'Separate clean/dirty work zones', 'Wash hands before handling finished goods', 'Keep bins closed and emptied', 'Report pests, leaks or contamination'],
    checklist: ['Daily floor check', 'Waste removed', 'Tools returned', 'Benches cleared', 'Photos taken if required']
  },
  {
    file: 'ppe-safety-rules-chart.pdf',
    title: 'PPE & Safety Handling Rules Chart',
    category: 'Charts',
    subtitle: 'Minimum safety expectations for workshop operations',
    visual: 'ppe',
    note: 'Display near entry and machines. Use during induction, audits and incident review.',
    chart: ['Safety glasses in production areas', 'Closed footwear required', 'Gloves for sharp/hot/chemical handling', 'Hearing protection where required', 'Tie hair and loose clothing', 'Never bypass machine guards', 'Use extraction/ventilation', 'Stop work if unsafe'],
    checklist: ['PPE available', 'Damaged PPE replaced', 'Visitors briefed', 'Unsafe work stopped', 'Supervisor notified']
  },
  {
    file: 'machinery-safety-chart.pdf',
    title: 'Machinery Safety Chart',
    category: 'Charts',
    subtitle: 'Machine guarding, isolation and safe operation rules',
    visual: 'machinery',
    note: 'Display near machinery and use in staff training. Update if machines or guarding change.',
    chart: ['Only trained users operate machines', 'Complete pre-start check', 'Keep guards/interlocks active', 'Use lockout/isolation before maintenance', 'Keep hands clear of moving parts', 'Do not leave running machines unattended', 'Report faults immediately', 'Record maintenance actions'],
    checklist: ['Training current', 'Pre-start complete', 'Guards checked', 'Faults tagged out', 'Maintenance logged']
  },
  {
    file: 'hazard-chemical-handling-chart.pdf',
    title: 'Hazard & Chemical Handling Chart',
    category: 'Charts',
    subtitle: 'Chemical, resin, solvent and hazardous material control',
    visual: 'hazard',
    note: 'Display near chemical/material storage. Use with SDS and hazardous chemical register.',
    chart: ['Read SDS before use', 'Label every container', 'Store incompatible chemicals separately', 'Use ventilation', 'Wear correct PPE', 'Clean spills using approved method', 'Dispose waste correctly', 'Report exposure or uncontrolled spills'],
    checklist: ['SDS available', 'Containers labelled', 'Spill kit stocked', 'Waste labelled', 'Register updated']
  },
  {
    file: 'visitor-contractor-induction.pdf',
    title: 'Visitor / Contractor Induction',
    category: 'Safety',
    subtitle: 'Site entry, supervision and safety acknowledgement',
    visual: 'visitor',
    note: 'Use before visitors or contractors enter production, machinery, storage or inspection areas.',
    sections: [
      ['Visitor Details', ['Name', 'Company', 'Purpose', 'Host', 'Arrival Time', 'Departure Time']],
      ['Safety Briefing', ['PPE Required', 'Restricted Areas', 'Emergency Assembly', 'Photos Allowed?', 'Supervision Required']],
      ['Acknowledgement', ['Visitor Signature', 'Host Signature', 'Notes / Restrictions']]
    ],
    checklist: ['Signed in', 'PPE issued', 'Emergency process explained', 'Supervision assigned', 'Signed out']
  }
];

function writeText(doc, value, x, y, options = {}) {
  doc
    .fillColor(options.color || colors.ink)
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size || 8)
    .text(value, x, y, options);
}

function header(doc, form) {
  const pageW = doc.page.width;
  doc.fillColor(colors.navy).rect(0, 0, pageW, 74).fill();
  if (fs.existsSync(logoPath)) doc.image(logoPath, 32, 6, { width: 62 });
  writeText(doc, form.title, 118, 18, { color: '#ffffff', bold: true, size: 17, width: 434 });
  writeText(doc, form.subtitle, 118, 44, { color: colors.cyan, bold: true, size: 9.2, width: 434 });
  writeText(doc, `VOXEL VEDA | ${form.category} | Controlled internal form`, 32, 82, { color: colors.muted, size: 7.5 });
}

function sectionBar(doc, y, title) {
  doc.fillColor(colors.navy).roundedRect(32, y, 531, 17, 4).fill();
  writeText(doc, title, 40, y + 5, { color: '#ffffff', bold: true, size: 8 });
  return y + 24;
}

function field(doc, x, y, w, h, label) {
  doc.fillColor('#ffffff').roundedRect(x, y, w, h, 4).fill();
  doc.strokeColor(colors.border).lineWidth(0.6).roundedRect(x, y, w, h, 4).stroke();
  writeText(doc, label, x + 6, y + 5, { color: colors.muted, bold: true, size: 6.7 });
}

function visualPanel(doc, x, y, w, h, type) {
  doc.save();
  doc.fillColor('#eefcff').roundedRect(x, y, w, h, 10).fill();
  doc.strokeColor('#9bdcf0').lineWidth(0.8).roundedRect(x, y, w, h, 10).stroke();
  doc.fillColor('#dff7fb').roundedRect(x + 10, y + 10, w - 20, h - 28, 7).fillOpacity(0.7).fill();
  doc.fillOpacity(1);

  const cx = x + w / 2;
  const cy = y + h / 2;
  const accent = colors.cyan;
  const dark = colors.navy;

  const label = {
    dispatch: 'DISPATCH',
    staff: 'STAFF',
    safety: 'SAFETY',
    client: 'CLIENT',
    contract: 'CONTRACT',
    incident: 'INCIDENT',
    machine: 'MACHINE',
    risk: 'RISK',
    hygiene: 'HYGIENE',
    ppe: 'PPE',
    machinery: 'MACHINE',
    hazard: 'HAZARD',
    visitor: 'VISITOR'
  }[type] || 'CONTROL';

  if (type === 'dispatch') {
    doc.fillColor(dark).roundedRect(x + 19, cy - 13, 58, 24, 5).fill();
    doc.fillColor(accent).roundedRect(x + 77, cy - 7, 28, 18, 4).fill();
    doc.fillColor('#ffffff').rect(x + 27, cy - 7, 22, 8).fill();
    doc.fillColor(dark).circle(x + 35, cy + 15, 6).fill().circle(x + 87, cy + 15, 6).fill();
    doc.strokeColor(accent).lineWidth(2).moveTo(x + 112, cy).lineTo(x + 134, cy).lineTo(x + 127, cy - 7).stroke();
  } else if (type === 'staff' || type === 'visitor') {
    doc.fillColor(accent).circle(cx - 24, cy - 18, 13).fill();
    doc.fillColor(dark).roundedRect(cx - 43, cy, 38, 27, 10).fill();
    doc.strokeColor(dark).lineWidth(2).roundedRect(cx + 6, cy - 25, 50, 48, 5).stroke();
    doc.fillColor(accent).rect(cx + 17, cy - 11, 28, 4).fill().rect(cx + 17, cy + 1, 22, 4).fill();
  } else if (type === 'safety') {
    doc.fillColor(accent).moveTo(cx, y + 14).lineTo(x + w - 38, y + 28).lineTo(x + w - 48, y + h - 26).lineTo(cx, y + h - 16).lineTo(x + 38, y + h - 26).lineTo(x + 28, y + 28).closePath().fill();
    doc.strokeColor(dark).lineWidth(4).moveTo(cx - 22, cy - 1).lineTo(cx - 6, cy + 15).lineTo(cx + 28, cy - 21).stroke();
  } else if (type === 'client' || type === 'contract') {
    doc.fillColor('#ffffff').roundedRect(cx - 42, y + 14, 84, 54, 5).fill();
    doc.strokeColor(dark).roundedRect(cx - 42, y + 14, 84, 54, 5).stroke();
    doc.fillColor(accent).rect(cx - 30, y + 27, 58, 5).fill().rect(cx - 30, y + 39, 46, 5).fill().rect(cx - 30, y + 51, 54, 5).fill();
    if (type === 'contract') doc.strokeColor(dark).lineWidth(2).moveTo(cx + 8, y + 61).lineTo(cx + 30, y + 50).stroke();
  } else if (type === 'incident' || type === 'risk' || type === 'hazard') {
    doc.fillColor(colors.warn).moveTo(cx, y + 14).lineTo(x + w - 38, y + h - 24).lineTo(x + 38, y + h - 24).closePath().fill();
    doc.strokeColor(dark).lineWidth(2).moveTo(cx, y + 14).lineTo(x + w - 38, y + h - 24).lineTo(x + 38, y + h - 24).closePath().stroke();
    doc.fillColor(dark).rect(cx - 3, cy - 9, 6, 22).fill().circle(cx, cy + 19, 3.8).fill();
  } else if (type === 'machine' || type === 'machinery') {
    doc.fillColor(dark).roundedRect(cx - 48, cy - 25, 96, 42, 7).fill();
    doc.fillColor(accent).circle(cx - 22, cy - 4, 12).fill().circle(cx + 22, cy - 4, 12).fill();
    doc.strokeColor('#ffffff').lineWidth(2).moveTo(cx - 22, cy - 20).lineTo(cx - 22, cy + 12).moveTo(cx + 22, cy - 20).lineTo(cx + 22, cy + 12).stroke();
    doc.fillColor(colors.warn).roundedRect(cx - 14, cy + 21, 28, 10, 3).fill();
  } else if (type === 'hygiene') {
    doc.strokeColor(accent).lineWidth(3).moveTo(x + 32, cy + 8).lineTo(x + 62, cy + 24).lineTo(x + 116, cy - 32).stroke();
    doc.fillColor(dark).roundedRect(x + 28, y + 18, 34, 38, 8).fill();
    doc.fillColor(accent).rect(x + 36, y + 24, 18, 5).fill().rect(x + 36, y + 35, 18, 5).fill();
  } else if (type === 'ppe') {
    doc.fillColor(colors.warn).circle(cx - 26, cy - 8, 18).fill();
    doc.fillColor(accent).roundedRect(cx + 7, cy - 29, 38, 36, 16).fill();
    doc.strokeColor(dark).lineWidth(3).moveTo(cx - 43, cy - 7).lineTo(cx - 10, cy - 7).moveTo(cx + 14, cy - 9).lineTo(cx + 38, cy - 9).stroke();
    doc.fillColor(dark).roundedRect(cx - 36, cy + 17, 72, 9, 4).fill();
  } else {
    doc.fillColor(accent).roundedRect(cx - 42, cy - 28, 84, 48, 8).fill();
    doc.fillColor(dark).rect(cx - 26, cy - 12, 52, 7).fill().rect(cx - 26, cy + 3, 36, 7).fill();
  }

  writeText(doc, label, x + 12, y + h - 15, { color: dark, bold: true, size: 7.2, width: w - 24, align: 'center' });
  doc.restore();
}

function drawFields(doc, y, labels, columns = 3) {
  const left = 32;
  const gap = 8;
  const w = (531 - gap * (columns - 1)) / columns;
  labels.forEach((label, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    field(doc, left + col * (w + gap), y + row * 38, w, 30, label);
  });
  return y + Math.ceil(labels.length / columns) * 38 + 8;
}

function drawChecklist(doc, y, checklist = []) {
  y = sectionBar(doc, y, 'Checklist / Confirmation');
  checklist.forEach((item, index) => {
    const x = 42 + (index % 2) * 260;
    const yy = y + Math.floor(index / 2) * 20;
    doc.strokeColor(colors.border).rect(x, yy, 9, 9).stroke();
    writeText(doc, item, x + 15, yy - 1, { size: 7.5, width: 220 });
  });
  return y + Math.ceil(checklist.length / 2) * 20 + 18;
}

function drawChartIcon(doc, x, y, type, index) {
  doc.fillColor(colors.cyan).circle(x + 15, y + 19, 13).fill();
  doc.fillColor(colors.navy).font('Helvetica-Bold').fontSize(8).text(index + 1, x + 12, y + 14.5, { width: 8, align: 'center' });
  doc.strokeColor(colors.navy).lineWidth(1.5);
  if (type === 'hygiene') {
    doc.moveTo(x + 7, y + 18).lineTo(x + 13, y + 24).lineTo(x + 25, y + 12).stroke();
  } else if (type === 'ppe') {
    doc.circle(x + 10, y + 16, 4).stroke().circle(x + 20, y + 16, 4).stroke().moveTo(x + 14, y + 16).lineTo(x + 16, y + 16).stroke();
  } else if (type === 'machinery') {
    doc.rect(x + 8, y + 12, 14, 14).stroke().moveTo(x + 6, y + 28).lineTo(x + 25, y + 28).stroke();
  } else if (type === 'hazard') {
    doc.moveTo(x + 15, y + 9).lineTo(x + 25, y + 27).lineTo(x + 5, y + 27).closePath().stroke();
  }
}

function drawChart(doc, y, items, visual) {
  y = sectionBar(doc, y, 'Display Chart');
  items.forEach((item, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2;
    const x = 36 + col * 264;
    const yy = y + row * 48;
    doc.fillColor(colors.panel).roundedRect(x, yy, 255, 38, 7).fill();
    doc.strokeColor(colors.border).roundedRect(x, yy, 255, 38, 7).stroke();
    drawChartIcon(doc, x + 2, yy, visual, index);
    writeText(doc, item, x + 42, yy + 10, { bold: true, size: 8.5, width: 198 });
  });
  return y + Math.ceil(items.length / 2) * 48 + 10;
}

function drawForm(form) {
  const outputPath = path.join(outputDir, form.file);
  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  doc.pipe(fs.createWriteStream(outputPath));
  header(doc, form);

  let y = 104;
  doc.fillColor(colors.panel).roundedRect(32, y, 531, 116, 8).fill();
  doc.strokeColor(colors.border).roundedRect(32, y, 531, 116, 8).stroke();
  writeText(doc, 'When to use this form', 44, y + 10, { bold: true, size: 9 });
  writeText(doc, form.note, 44, y + 29, { color: colors.muted, size: 8, width: 292, lineGap: 1.2 });
  writeText(doc, 'Picture guide', 390, y + 10, { color: colors.muted, bold: true, size: 6.8, width: 140, align: 'center' });
  visualPanel(doc, 378, y + 25, 166, 78, form.visual);
  y += 132;

  if (form.chart) {
    y = drawChart(doc, y, form.chart, form.visual);
  } else {
    form.sections.forEach(([title, fields]) => {
      y = sectionBar(doc, y, title);
      y = drawFields(doc, y, fields, fields.length >= 6 ? 3 : 2);
    });
  }

  y = Math.min(y + 4, 640);
  y = drawChecklist(doc, y, form.checklist);

  if (y < 704) {
    y = 704;
  }
  doc.strokeColor(colors.border).roundedRect(32, y, 531, 78, 8).stroke();
  writeText(doc, 'Controlled Form, Privacy & Confidentiality Notice', 44, y + 10, { bold: true, size: 8.5 });
  writeText(
    doc,
    'This Voxel Veda form may contain confidential customer, supplier, staff, safety, quality, pricing or operational information. Use only for authorised business, audit, council, regulator, customer or compliance purposes. Confirm statutory or customer-specific requirements before relying on it as a mandatory external form.',
    44,
    y + 27,
    { color: colors.muted, size: 7.1, width: 440, lineGap: 1 }
  );
  if (fs.existsSync(privacyQrPath)) {
    doc.image(privacyQrPath, 510, y + 16, { width: 38 });
    doc.link(510, y + 16, 38, 38, privacyPolicyUrl);
    writeText(doc, 'Policy QR', 500, y + 58, { color: colors.muted, bold: true, size: 6.5, width: 58, align: 'center' });
  }

  doc.end();
  return outputPath;
}

forms.forEach(drawForm);
console.log(`Generated ${forms.length} company forms in ${outputDir}`);
