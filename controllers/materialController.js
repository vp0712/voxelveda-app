const pool = require('../config/db');
const PDFDocument = require('pdfkit');

async function ensureMaterialTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_inventory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      inventory_type VARCHAR(40) NOT NULL,
      item_name VARCHAR(180) NOT NULL,
      supplier VARCHAR(180) NULL,
      reference_code VARCHAR(120) NULL,
      unit_label VARCHAR(40) NOT NULL DEFAULT 'pcs',
      input_qty DECIMAL(12,3) NOT NULL DEFAULT 0,
      current_qty DECIMAL(12,3) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      reorder_level DECIMAL(12,3) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      process_sheet TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`ALTER TABLE material_inventory ADD COLUMN process_sheet TEXT NULL`).catch(() => {});
}

function cleanType(value) {
  const type = String(value || '').trim().toLowerCase();
  return type === 'packaging' ? 'packaging' : 'raw_material';
}

function parseProcessSheet(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validateProcessSheet(sheet) {
  const required = [
    'received_date',
    'po_number',
    'supplier_batch',
    'received_by',
    'inspected_by',
    'visual_condition',
    'dimension_check',
    'contamination_check',
    'storage_condition',
    'coa_available',
    'sds_available',
    'quarantine_status',
    'final_disposition',
    'approved_by'
  ];

  const missing = required.filter((field) => !String(sheet[field] ?? '').trim());

  if (missing.length) {
    return `Process sheet incomplete. Missing: ${missing.join(', ')}`;
  }

  const finalDisposition = String(sheet.final_disposition || '').toLowerCase();
  const accepted = ['accepted', 'conditional', 'quarantine', 'rejected'];

  if (!accepted.includes(finalDisposition)) {
    return 'Final disposition must be accepted, conditional, quarantine, or rejected';
  }

  const criticalChecks = ['visual_condition', 'dimension_check', 'contamination_check', 'storage_condition'];
  const failedCritical = criticalChecks.some((field) => String(sheet[field] || '').toLowerCase() === 'fail');

  if (failedCritical && finalDisposition === 'accepted') {
    return 'Failed quality checks cannot be marked as accepted. Use conditional, quarantine, or rejected.';
  }

  return '';
}

exports.getMaterials = async (req, res) => {
  try {
    await ensureMaterialTable();

    const type = cleanType(req.query.type);
    const [rows] = await pool.query(
      `
      SELECT
        m.*,
        (m.current_qty * m.unit_price) AS current_value,
        (m.input_qty - m.current_qty) AS used_qty,
        cu.name AS created_by_name,
        uu.name AS updated_by_name
      FROM material_inventory m
      LEFT JOIN users cu ON cu.id = m.created_by
      LEFT JOIN users uu ON uu.id = m.updated_by
      WHERE m.deleted = 0
      AND m.inventory_type = ?
      ORDER BY m.item_name ASC
      `,
      [type]
    );

    res.json({
      materials: rows.map((row) => ({
        ...row,
        process_sheet: parseProcessSheet(row.process_sheet)
      }))
    });
  } catch (error) {
    console.error('getMaterials error:', error);
    res.status(500).json({ message: 'Failed to load material inventory', error: error.message });
  }
};

exports.saveMaterial = async (req, res) => {
  try {
    await ensureMaterialTable();

    const id = Number(req.body.id || 0);
    const type = cleanType(req.body.inventory_type);
    const itemName = String(req.body.item_name || '').trim();
    const supplier = String(req.body.supplier || '').trim();
    const referenceCode = String(req.body.reference_code || '').trim();
    const unitLabel = String(req.body.unit_label || 'pcs').trim();
    const inputQty = Number(req.body.input_qty || 0);
    const currentQty = Number(req.body.current_qty ?? inputQty);
    const unitPrice = Number(req.body.unit_price || 0);
    const reorderLevel = Number(req.body.reorder_level || 0);
    const notes = String(req.body.notes || '').trim();
    const processSheet = parseProcessSheet(req.body.process_sheet);
    const processSheetError = validateProcessSheet(processSheet);

    if (!itemName) return res.status(400).json({ message: 'Item name is required' });
    if (processSheetError) return res.status(400).json({ message: processSheetError });

    if ([inputQty, currentQty, unitPrice, reorderLevel].some((value) => Number.isNaN(value) || value < 0)) {
      return res.status(400).json({ message: 'Quantities and prices must be positive numbers' });
    }

    if (id) {
      const [result] = await pool.query(
        `
        UPDATE material_inventory
        SET item_name = ?, supplier = ?, reference_code = ?, unit_label = ?,
            input_qty = ?, current_qty = ?, unit_price = ?, reorder_level = ?,
            notes = ?, process_sheet = ?, updated_by = ?
        WHERE id = ? AND inventory_type = ? AND deleted = 0
        `,
        [itemName, supplier, referenceCode, unitLabel, inputQty, currentQty, unitPrice, reorderLevel, notes, JSON.stringify(processSheet), req.user.id, id, type]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Inventory item not found' });
      return res.json({ message: 'Inventory item updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO material_inventory
      (inventory_type, item_name, supplier, reference_code, unit_label, input_qty, current_qty, unit_price, reorder_level, notes, process_sheet, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [type, itemName, supplier, referenceCode, unitLabel, inputQty, currentQty, unitPrice, reorderLevel, notes, JSON.stringify(processSheet), req.user.id]
    );

    res.json({ message: 'Inventory item saved successfully', material_id: result.insertId });
  } catch (error) {
    console.error('saveMaterial error:', error);
    res.status(500).json({ message: 'Failed to save inventory item', error: error.message });
  }
};

exports.viewProcessSheetPdf = async (req, res) => {
  try {
    await ensureMaterialTable();

    const id = Number(req.params.id || 0);
    const [[item]] = await pool.query(
      `
      SELECT
        m.*,
        cu.name AS created_by_name,
        uu.name AS updated_by_name
      FROM material_inventory m
      LEFT JOIN users cu ON cu.id = m.created_by
      LEFT JOIN users uu ON uu.id = m.updated_by
      WHERE m.id = ?
      AND m.deleted = 0
      LIMIT 1
      `,
      [id]
    );

    if (!item) return res.status(404).json({ message: 'Inventory item not found' });

    const sheet = parseProcessSheet(item.process_sheet);
    const doc = new PDFDocument({ size: 'A4', margin: 44 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="process-sheet-${item.id}.pdf"`);
    doc.pipe(res);

    const typeLabel = item.inventory_type === 'packaging' ? 'Packaging' : 'Raw Material';
    const dark = '#0f172a';
    const cyan = '#2dd4bf';
    const blue = '#38bdf8';

    doc.rect(0, 0, doc.page.width, 92).fill(dark);
    doc.fillColor(cyan).fontSize(22).text('VOXEL VEDA PROCESS SHEET', 44, 30);
    doc.fillColor('#e2e8f0').fontSize(10).text(`${typeLabel} Quality & Traceability Record`, 44, 58);

    doc.fillColor('#111827').fontSize(14).text(item.item_name, 44, 120);
    doc.fontSize(10).fillColor('#475569');
    doc.text(`Supplier: ${item.supplier || '-'}`, 44, 144);
    doc.text(`Reference/Lot/SKU: ${item.reference_code || '-'}`, 44, 160);
    doc.text(`Quantity received: ${item.input_qty} ${item.unit_label}`, 44, 176);
    doc.text(`Created by: ${item.created_by_name || '-'}`, 330, 144);
    doc.text(`Updated by: ${item.updated_by_name || '-'}`, 330, 160);

    const rows = [
      ['Received date', sheet.received_date],
      ['PO / job number', sheet.po_number],
      ['Supplier batch / heat / lot', sheet.supplier_batch],
      ['Received by', sheet.received_by],
      ['Inspected by', sheet.inspected_by],
      ['COA / certificate available', sheet.coa_available],
      ['SDS / safety data available', sheet.sds_available],
      ['Visual condition', sheet.visual_condition],
      ['Dimension / weight check', sheet.dimension_check],
      ['Contamination check', sheet.contamination_check],
      ['Storage condition', sheet.storage_condition],
      ['Quarantine status', sheet.quarantine_status],
      ['Final disposition', sheet.final_disposition],
      ['Approved by', sheet.approved_by],
      ['Risk notes', sheet.risk_notes || '-'],
      ['Corrective action', sheet.corrective_action || '-']
    ];

    let y = 220;
    doc.roundedRect(44, y - 14, 508, 30, 6).fill(dark);
    doc.fillColor('#ffffff').fontSize(11).text('Audit Checklist', 60, y - 4);
    y += 28;

    rows.forEach(([label, value], index) => {
      doc.rect(44, y, 508, 28).fill(index % 2 === 0 ? '#f8fafc' : '#eef6ff');
      doc.fillColor('#0f172a').fontSize(9).text(label, 58, y + 9, { width: 190 });
      doc.fillColor('#111827').text(String(value || '-'), 260, y + 9, { width: 270 });
      y += 28;
    });

    doc.fillColor(blue).fontSize(11).text('Company Rule', 44, 730);
    doc.fillColor('#111827').fontSize(9).text(
      'This record must be completed before inventory acceptance. It supports traceability, quality review, quarantine decisions, and audit response if a customer, council, regulator, or government body raises a concern.',
      44,
      750,
      { width: 508 }
    );

    doc.end();
  } catch (error) {
    console.error('viewProcessSheetPdf error:', error);
    res.status(500).json({ message: 'Failed to generate process sheet PDF', error: error.message });
  }
};

exports.deleteMaterial = async (req, res) => {
  try {
    await ensureMaterialTable();

    const id = Number(req.body.id || 0);
    const type = cleanType(req.body.inventory_type);
    if (!id) return res.status(400).json({ message: 'Inventory item ID is required' });

    const [result] = await pool.query(
      'UPDATE material_inventory SET deleted = 1, updated_by = ? WHERE id = ? AND inventory_type = ?',
      [req.user.id, id, type]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Inventory item not found' });
    res.json({ message: 'Inventory item deleted successfully' });
  } catch (error) {
    console.error('deleteMaterial error:', error);
    res.status(500).json({ message: 'Failed to delete inventory item', error: error.message });
  }
};
