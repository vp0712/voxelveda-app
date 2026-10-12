const pool = require('../config/db');
const { createDocumentPdf, sendPdfResponse } = require('../services/documentPdfService');
const path = require('path');
const urls = require('../config/urls');
const { logAudit } = require('../services/auditService');

let materialSchemaPromise;
function ensureMaterialTable() {
  if (!materialSchemaPromise) materialSchemaPromise = createMaterialTables().catch((error) => { materialSchemaPromise = null; throw error; });
  return materialSchemaPromise;
}

async function createMaterialTables() {
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

  try { await pool.query('ALTER TABLE material_inventory ADD COLUMN process_sheet TEXT NULL'); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  await pool.query(`CREATE TABLE IF NOT EXISTS material_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    material_id INT NOT NULL,
    movement_type VARCHAR(30) NOT NULL,
    quantity_delta DECIMAL(12,3) NOT NULL,
    input_qty_before DECIMAL(12,3) NOT NULL,
    input_qty_after DECIMAL(12,3) NOT NULL,
    current_qty_before DECIMAL(12,3) NOT NULL,
    current_qty_after DECIMAL(12,3) NOT NULL,
    notes TEXT NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_material_movement (material_id, created_at)
  ) ENGINE=InnoDB`);
}

function cleanType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!type) return 'raw_material';
  if (!['packaging', 'raw_material'].includes(type)) throw materialError('inventory_type', 'Choose raw_material or packaging');
  return type;
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

function materialError(field, message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, fields: { [field]: message } });
}

function materialId(value, optional = false) {
  if (optional && (value === undefined || value === null || value === '' || value === 0 || value === '0')) return 0;
  if (!['number', 'string'].includes(typeof value)) throw materialError('id', 'Use a positive integer inventory ID');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw materialError('id', 'Use a positive integer inventory ID');
  return id;
}

function materialText(body, field, max, fallback = '') {
  const value = body[field] ?? fallback;
  if (typeof value !== 'string') throw materialError(field, 'Enter text for this field');
  const text = value.trim();
  if (text.length > max) throw materialError(field, `Use no more than ${max} characters`);
  return text;
}

function materialNumber(value, field, scale, max) {
  if (value !== undefined && value !== null && !['number', 'string'].includes(typeof value)) throw materialError(field, 'Enter a valid non-negative number');
  if (typeof value === 'string' && !value.trim()) throw materialError(field, 'Enter a valid non-negative number');
  const number = Number(value ?? 0), factor = 10 ** scale;
  if (!Number.isFinite(number) || number < 0 || number > max || Math.abs(number * factor - Math.round(number * factor)) > 0.00001) throw materialError(field, `Enter a non-negative number with at most ${scale} decimal places`);
  return number;
}

function materialListOptions(query) {
  const columns = { id: 'm.id', item_name: 'm.item_name', supplier: 'm.supplier', current_qty: 'm.current_qty', current_value: 'current_value', created_at: 'm.created_at' };
  const sort = query.sort || 'id', direction = String(query.direction || 'asc').toLowerCase();
  if (!Object.hasOwn(columns, sort)) throw materialError('sort', 'Choose a supported sort field');
  if (!['asc', 'desc'].includes(direction)) throw materialError('direction', 'Sort direction must be asc or desc');
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = Number(query.page || 1), limit = Number(query.limit || 50);
  if (paginated && (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger((page - 1) * limit))) throw materialError('page', 'Use a positive page and a limit from 1 to 200');
  return { order: `${columns[sort]} ${direction.toUpperCase()}, m.id ASC`, paginated, page, limit };
}

function materialFailure(res, error, message) {
  console.error(message, { code: error.code, message: error.message });
  res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : message, ...(error.fields ? { fields: error.fields } : {}) });
}

function materialAudit(connection, req, action, id, oldValue, newValue) {
  return logAudit(connection, { actorId: req.user.id, action, module: 'Inventory', recordType: 'material_inventory', recordId: id, oldValue, newValue,
    ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId, sessionId: req.session?.id });
}

exports.getMaterials = async (req, res) => {
  try {
    await ensureMaterialTable();
    const query = req.query || {}, type = cleanType(query.type || query.inventory_type), params = [type];
    const options = materialListOptions(query);
    let where = 'm.deleted = 0 AND m.inventory_type = ?';
    const search = String(query.search || '').trim().slice(0, 180);
    if (search) { where += ' AND (m.item_name LIKE ? OR m.supplier LIKE ? OR m.reference_code LIKE ?)'; params.push(...Array(3).fill(`%${search}%`)); }
    if (query.stock_status) {
      if (!['low', 'healthy', 'depleted'].includes(query.stock_status)) throw materialError('stock_status', 'Choose low, healthy or depleted');
      where += query.stock_status === 'low' ? ' AND m.current_qty <= m.reorder_level' : query.stock_status === 'healthy' ? ' AND m.current_qty > m.reorder_level' : ' AND m.current_qty = 0';
    }
    const [rows] = await pool.query(`SELECT m.*, (m.current_qty * m.unit_price) AS current_value,
      (m.input_qty - m.current_qty) AS used_qty, cu.name AS created_by_name, uu.name AS updated_by_name
      FROM material_inventory m LEFT JOIN users cu ON cu.id = m.created_by LEFT JOIN users uu ON uu.id = m.updated_by
      WHERE ${where} ORDER BY ${options.order} ${options.paginated ? 'LIMIT ? OFFSET ?' : ''}`,
      [...params, ...(options.paginated ? [options.limit, (options.page - 1) * options.limit] : [])]);
    let pagination;
    if (options.paginated) {
      const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM material_inventory m WHERE ${where}`, params);
      pagination = { page: options.page, limit: options.limit, total: Number(count.total), pages: Math.ceil(Number(count.total) / options.limit) };
    }
    res.json({ materials: rows.map((row) => ({ ...row, process_sheet: parseProcessSheet(row.process_sheet) })), ...(pagination ? { pagination } : {}) });
  } catch (error) { materialFailure(res, error, 'Failed to load material inventory'); }
};

exports.saveMaterial = async (req, res) => {
  let connection;
  try {
    const id = materialId(req.body.id, true), type = cleanType(req.body.inventory_type);
    const inputQty = materialNumber(req.body.input_qty, 'input_qty', 3, 999999999.999);
    const currentQty = materialNumber(req.body.current_qty ?? inputQty, 'current_qty', 3, 999999999.999);
    const fields = {
      item_name: materialText(req.body, 'item_name', 180), supplier: materialText(req.body, 'supplier', 180),
      reference_code: materialText(req.body, 'reference_code', 120), unit_label: materialText(req.body, 'unit_label', 40, 'pcs'),
      input_qty: inputQty, current_qty: currentQty, unit_price: materialNumber(req.body.unit_price, 'unit_price', 2, 9999999999.99),
      reorder_level: materialNumber(req.body.reorder_level, 'reorder_level', 3, 999999999.999), notes: materialText(req.body, 'notes', 10000),
      process_sheet: parseProcessSheet(req.body.process_sheet)
    };
    if (!fields.item_name) throw materialError('item_name', 'Item name is required');
    if (!fields.unit_label) throw materialError('unit_label', 'Unit label is required');
    if (currentQty > inputQty) throw materialError('current_qty', 'Current quantity cannot exceed received quantity');
    const processSheetError = validateProcessSheet(fields.process_sheet);
    if (processSheetError) throw materialError('process_sheet', processSheetError);
    if (JSON.stringify(fields.process_sheet).length > 30000) throw materialError('process_sheet', 'Process sheet is too large');
    const values = Object.values(fields).map((value) => typeof value === 'object' ? JSON.stringify(value) : value);
    await ensureMaterialTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let previous = null, recordId = id;
    if (id) {
      const [[existing]] = await connection.query('SELECT * FROM material_inventory WHERE id = ? AND inventory_type = ? AND deleted = 0 FOR UPDATE', [id, type]);
      if (!existing) throw materialError('id', 'Inventory item not found', 404);
      previous = existing;
      await connection.query(`UPDATE material_inventory SET item_name = ?, supplier = ?, reference_code = ?, unit_label = ?,
        input_qty = ?, current_qty = ?, unit_price = ?, reorder_level = ?, notes = ?, process_sheet = ?, updated_by = ?
        WHERE id = ? AND inventory_type = ? AND deleted = 0`, [...values, req.user.id, id, type]);
    } else {
      const [result] = await connection.query(`INSERT INTO material_inventory
        (inventory_type, item_name, supplier, reference_code, unit_label, input_qty, current_qty, unit_price, reorder_level, notes, process_sheet, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [type, ...values, req.user.id]);
      recordId = result.insertId;
    }
    const inputBefore = Number(previous?.input_qty || 0), currentBefore = Number(previous?.current_qty || 0);
    if (!id || inputBefore !== inputQty || currentBefore !== currentQty) {
      await connection.query(`INSERT INTO material_movements
        (material_id, movement_type, quantity_delta, input_qty_before, input_qty_after, current_qty_before, current_qty_after, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [recordId, id ? 'adjustment' : 'opening', Math.round((currentQty - currentBefore) * 1000) / 1000, inputBefore, inputQty, currentBefore, currentQty, fields.notes, req.user.id]);
    }
    await materialAudit(connection, req, id ? 'UPDATE' : 'CREATE', recordId, previous, { id: recordId, inventory_type: type, ...fields });
    await connection.commit();
    res.json({ message: id ? 'Inventory item updated successfully' : 'Inventory item saved successfully', material_id: recordId });
  } catch (error) { if (connection) await connection.rollback(); materialFailure(res, error, 'Failed to save inventory item'); }
  finally { connection?.release(); }
};

exports.getMaterialMovements = async (req, res) => {
  try {
    const id = materialId(req.params.id);
    await ensureMaterialTable();
    const [[item]] = await pool.query('SELECT id FROM material_inventory WHERE id = ?', [id]);
    if (!item) throw materialError('id', 'Inventory item not found', 404);
    const [rows] = await pool.query(`SELECT m.*, u.name AS created_by_name FROM material_movements m
      LEFT JOIN users u ON u.id = m.created_by WHERE m.material_id = ? ORDER BY m.created_at DESC, m.id DESC`, [id]);
    res.json({ movements: rows });
  } catch (error) { materialFailure(res, error, 'Failed to load material movements'); }
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
    const labels = { received_date:'Received date',po_number:'PO / job reference',supplier_batch:'Supplier batch / heat / lot',received_by:'Received by',inspected_by:'Inspected by',coa_available:'COA / certificate available',sds_available:'Safety data available',visual_condition:'Visual condition',dimension_check:'Dimension / weight check',contamination_check:'Contamination check',storage_condition:'Storage condition',quarantine_status:'Quarantine status',final_disposition:'Final disposition',approved_by:'Approved by',risk_notes:'Risk notes',corrective_action:'Corrective action' };
    const data = { title:'MATERIAL PROCESS SHEET', reference:item.reference_code || `MATERIAL-${item.id}`, filename:`process-sheet-${item.id}`, issueDate:item.created_at,
      party:item.item_name, columns:[{label:'Check',width:2},{label:'Recorded result',width:4}], rows:[
        ['Supplier',item.supplier],['Quantity received',`${item.input_qty} ${item.unit_label}`],['Created by',item.created_by_name],['Updated by',item.updated_by_name],
        ...Object.entries(labels).map(([key,label])=>[label,sheet[key] || 'Not recorded']) ], notes:['Complete and review this record before inventory acceptance. Retain material and supplier traceability.'] };
    return await sendPdfResponse(res, await createDocumentPdf(data), Boolean(req.query.download));

  } catch (error) {
    console.error('viewProcessSheetPdf error:', error);
    res.status(500).json({ message: 'Failed to generate process sheet PDF', error: error.message });
  }
};

async function archiveMaterial(req, res, restore) {
  let connection;
  try {
    const id = materialId(req.body.id), type = cleanType(req.body.inventory_type), deleted = restore ? 0 : 1;
    await ensureMaterialTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[item]] = await connection.query('SELECT * FROM material_inventory WHERE id = ? AND inventory_type = ? FOR UPDATE', [id, type]);
    if (!item) throw materialError('id', 'Inventory item not found', 404);
    if (Number(item.deleted) !== deleted) {
      await connection.query('UPDATE material_inventory SET deleted = ?, updated_by = ? WHERE id = ? AND inventory_type = ?', [deleted, req.user.id, id, type]);
      await materialAudit(connection, req, restore ? 'RESTORE' : 'ARCHIVE', id, item, { ...item, deleted, updated_by: req.user.id });
    }
    await connection.commit();
    res.json({ message: restore ? 'Inventory item restored successfully' : 'Inventory item archived successfully', material_id: id });
  } catch (error) { if (connection) await connection.rollback(); materialFailure(res, error, restore ? 'Failed to restore inventory item' : 'Failed to archive inventory item'); }
  finally { connection?.release(); }
}
exports.deleteMaterial = (req, res) => archiveMaterial(req, res, false);
exports.restoreMaterial = (req, res) => archiveMaterial(req, res, true);

exports.ensureMaterialTable = ensureMaterialTable;
