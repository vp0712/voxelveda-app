const pool = require('../config/db');
const crypto = require('crypto');
const { logAudit } = require('../services/auditService');

let stockSchemaPromise;

async function addStockColumn(sql) {
  try { await pool.query(sql); return true; } catch (error) {
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error;
    return false;
  }
}

function ensureStockTable() {
  if (!stockSchemaPromise) stockSchemaPromise = createStockTables().catch((error) => { stockSchemaPromise = null; throw error; });
  return stockSchemaPromise;
}

async function createStockTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_batches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_name VARCHAR(180) NOT NULL,
      category VARCHAR(120) NULL,
      batch_code VARCHAR(120) NOT NULL,
      manufacture_date DATE NULL,
      expiry_date DATE NULL,
      box_qty INT NOT NULL DEFAULT 0,
      unit_qty INT NOT NULL DEFAULT 0,
      box_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      updated_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const addedCurrentQuantity = await addStockColumn('ALTER TABLE stock_batches ADD COLUMN current_unit_qty INT NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stock_id INT NOT NULL,
      movement_type VARCHAR(40) NOT NULL DEFAULT 'issue',
      quantity INT NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      issued_to VARCHAR(180) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await addStockColumn('ALTER TABLE stock_movements ADD COLUMN voided_at DATETIME NULL');
  await addStockColumn('ALTER TABLE stock_movements ADD COLUMN voided_by INT NULL');
  await addStockColumn('ALTER TABLE stock_movements ADD COLUMN request_key CHAR(64) NULL');
  await addStockColumn('ALTER TABLE stock_movements ADD UNIQUE KEY uniq_stock_movement_request (request_key)');

  if (addedCurrentQuantity) {
    // Reconstruct only a newly added compatibility column from retained source records.
    // Existing zero balances remain authoritative and are never repopulated.
    await pool.query(`UPDATE stock_batches s
      LEFT JOIN (SELECT stock_id, SUM(quantity) AS issued FROM stock_movements
        WHERE voided_at IS NULL GROUP BY stock_id) m ON m.stock_id = s.id
      SET s.current_unit_qty = GREATEST(0, s.unit_qty - COALESCE(m.issued, 0))`);
  }
}

function invalid(field, message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, fields: { [field]: message } });
}

function identifier(value, field = 'id', optional = false) {
  if (optional && (value === undefined || value === null || value === '' || value === 0 || value === '0')) return 0;
  if (!['number', 'string'].includes(typeof value)) throw invalid(field, 'Use a positive integer ID');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw invalid(field, 'Use a positive integer ID');
  return id;
}

function quantityValue(value, field, positive = false) {
  if ((value !== undefined && value !== null && typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) throw invalid(field, 'Enter a whole number of units');
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0) || number > 2147483647) throw invalid(field, positive ? 'Enter a positive whole number of units' : 'Enter a non-negative whole number of units');
  return number;
}

function textValue(value, field, max, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid(field, 'Enter text for this field');
  const text = String(value || '').trim();
  if (required && !text) throw invalid(field, 'This field is required');
  if (text.length > max) throw invalid(field, `Use no more than ${max} characters`);
  return text;
}

function validDate(value, field) {
  if (!value) return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw invalid(field, 'Enter a valid date in YYYY-MM-DD format');
  return date;
}

function stockFields(body) {
  const fields = {
    product_name: textValue(body.product_name, 'product_name', 180, true),
    category: textValue(body.category, 'category', 120),
    batch_code: textValue(body.batch_code, 'batch_code', 120) || `STK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    manufacture_date: validDate(body.manufacture_date, 'manufacture_date'),
    unit_qty: quantityValue(body.unit_qty, 'unit_qty'),
    unit_price: Number(body.unit_price ?? 0)
  };
  if ((body.unit_price !== undefined && body.unit_price !== null && !['number', 'string'].includes(typeof body.unit_price)) || !Number.isFinite(fields.unit_price) || fields.unit_price < 0 || fields.unit_price > 99999999.99 || Math.abs(fields.unit_price * 100 - Math.round(fields.unit_price * 100)) > 0.00001) throw invalid('unit_price', 'Enter a non-negative price with at most two decimal places');
  return fields;
}

function movementFields(body) {
  return {
    stock_id: identifier(body.stock_id, 'stock_id'),
    quantity: quantityValue(body.quantity, 'quantity', true),
    issued_to: textValue(body.issued_to, 'issued_to', 180, true),
    notes: textValue(body.notes, 'notes', 10000)
  };
}

function movementTotal(quantity, unitPrice) {
  const total = Math.round(quantity * unitPrice * 100) / 100;
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(total) || total > 9999999999.99) throw invalid('quantity', 'The movement value exceeds the supported amount');
  return total;
}

function stockAudit(connection, req, action, recordType, recordId, oldValue, newValue) {
  return logAudit(connection, { actorId: req.user.id, action, module: 'Inventory', recordType, recordId, oldValue, newValue,
    ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId, sessionId: req.session?.id });
}

function listOptions(query, columns, defaultSort) {
  const sort = query.sort || defaultSort;
  if (!Object.hasOwn(columns, sort)) throw invalid('sort', 'Choose a supported sort field');
  const direction = String(query.direction || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) throw invalid('direction', 'Sort direction must be asc or desc');
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = Number(query.page || 1), limit = Number(query.limit || 50);
  if (paginated && (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger((page - 1) * limit))) throw invalid('page', 'Use a positive page and a limit from 1 to 200');
  return { order: `${columns[sort]} ${direction.toUpperCase()}`, paginated, page, limit };
}

function failure(res, error, message) {
  console.error(message, { code: error.code, message: error.message });
  const retryable = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code);
  return res.status(error.statusCode || (retryable ? 409 : 500)).json({ message: error.statusCode ? error.message : retryable ? 'The record changed during another operation. Retry this action.' : message,
    ...(error.fields ? { fields: error.fields } : {}), ...(retryable ? { retryable: true } : {}) });
}

async function pagination(db, options, sql, params) {
  if (!options.paginated) return {};
  const [[row]] = await db.query(sql, params);
  const total = Number(row.total);
  return { pagination: { page: options.page, limit: options.limit, total, pages: Math.ceil(total / options.limit) } };
}

exports.getStock = async (req, res) => {
  try {
    await ensureStockTable();
    const query = req.query || {};
    const options = listOptions(query, { id: 's.id', product_name: 's.product_name', batch_code: 's.batch_code', current_unit_qty: 's.current_unit_qty', created_at: 's.created_at' }, 'created_at');
    const params = [];
    let where = 'WHERE IFNULL(s.deleted, 0) = 0';
    const search = String(query.search || '').trim().slice(0, 180);
    if (search) {
      where += ' AND (s.product_name LIKE ? OR s.category LIKE ? OR s.batch_code LIKE ?)';
      params.push(...Array(3).fill(`%${search}%`));
    }
    if (query.category) { where += ' AND s.category = ?'; params.push(textValue(query.category, 'category', 120)); }
    if (query.availability) {
      if (!['available', 'depleted'].includes(query.availability)) throw invalid('availability', 'Choose available or depleted');
      where += query.availability === 'available' ? ' AND s.current_unit_qty > 0' : ' AND s.current_unit_qty = 0';
    }
    const [rows] = await pool.query(`SELECT s.*, (s.unit_qty * s.unit_price) AS total_input_value,
      (s.current_unit_qty * s.unit_price) AS current_value, (s.unit_qty - s.current_unit_qty) AS issued_unit_qty,
      cu.name AS created_by_name, uu.name AS updated_by_name
      FROM stock_batches s LEFT JOIN users cu ON cu.id = s.created_by LEFT JOIN users uu ON uu.id = s.updated_by
      ${where} ORDER BY ${options.order}, s.id ASC ${options.paginated ? 'LIMIT ? OFFSET ?' : ''}`,
      [...params, ...(options.paginated ? [options.limit, (options.page - 1) * options.limit] : [])]);
    res.json({ stock: rows, ...await pagination(pool, options, `SELECT COUNT(*) AS total FROM stock_batches s ${where}`, params) });
  } catch (error) { failure(res, error, 'Failed to load stock'); }
};

exports.saveStock = async (req, res) => {
  let connection;
  try {
    const id = identifier(req.body.id, 'id', true), fields = stockFields(req.body);
    await ensureStockTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let previous = null, stockId = id, currentQty = fields.unit_qty;
    if (id) {
      const [[existing]] = await connection.query('SELECT * FROM stock_batches WHERE id = ? AND IFNULL(deleted, 0) = 0 FOR UPDATE', [id]);
      if (!existing) throw invalid('id', 'Stock batch not found', 404);
      previous = existing;
      const alreadyIssued = Number(existing.unit_qty) - Number(existing.current_unit_qty);
      if (!Number.isSafeInteger(alreadyIssued) || alreadyIssued < 0) throw invalid('unit_qty', 'Existing stock quantities require review before this batch can be edited', 409);
      if (fields.unit_qty < alreadyIssued) throw invalid('unit_qty', `Input quantity cannot be less than already issued quantity (${alreadyIssued})`);
      currentQty = fields.unit_qty - alreadyIssued;
      await connection.query(`UPDATE stock_batches SET product_name = ?, category = ?, batch_code = ?, manufacture_date = ?,
        unit_qty = ?, unit_price = ?, current_unit_qty = ?, updated_by = ? WHERE id = ? AND IFNULL(deleted, 0) = 0`,
        [...Object.values(fields), currentQty, req.user.id, id]);
    } else {
      const [result] = await connection.query(`INSERT INTO stock_batches
        (product_name, category, batch_code, manufacture_date, unit_qty, unit_price, current_unit_qty, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [...Object.values(fields), currentQty, req.user.id]);
      stockId = result.insertId;
    }
    await stockAudit(connection, req, id ? 'UPDATE' : 'CREATE', 'stock_batch', stockId, previous, { id: stockId, ...fields, current_unit_qty: currentQty });
    await connection.commit();
    res.json({ message: id ? 'Stock batch updated successfully' : 'Stock batch created successfully', stock_id: stockId });
  } catch (error) { if (connection) await connection.rollback(); failure(res, error, 'Failed to save stock'); }
  finally { connection?.release(); }
};

function idempotencyKey(req) {
  const value = req.get?.('Idempotency-Key') || req.body.idempotency_key;
  if (!value) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(value)) throw invalid('idempotency_key', 'Use an 8 to 120 character retry key');
  return crypto.createHash('sha256').update(`stock-issue:${req.user.id}:${value}`).digest('hex');
}

function sameMovement(movement, fields) {
  return Number(movement.stock_id) === fields.stock_id && Number(movement.quantity) === fields.quantity &&
    String(movement.issued_to || '') === fields.issued_to && String(movement.notes || '') === fields.notes && !movement.voided_at;
}

exports.issueStock = async (req, res) => {
  let connection;
  try {
    const fields = movementFields(req.body), requestKey = idempotencyKey(req);
    await ensureStockTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[stock]] = await connection.query('SELECT * FROM stock_batches WHERE id = ? AND IFNULL(deleted, 0) = 0 FOR UPDATE', [fields.stock_id]);
    if (!stock) throw invalid('stock_id', 'Stock item not found', 404);
    if (requestKey) {
      const [[existing]] = await connection.query('SELECT * FROM stock_movements WHERE request_key = ? FOR UPDATE', [requestKey]);
      if (existing) {
        if (!sameMovement(existing, fields)) throw invalid('idempotency_key', 'This retry key was already used for a different or voided stock issue', 409);
        await connection.commit();
        return res.json({ message: 'Stock issued successfully', movement_id: existing.id, total_price: Number(existing.total_price), replayed: true });
      }
    }
    if (Number(stock.current_unit_qty) < fields.quantity) throw invalid('quantity', 'Not enough stock available');
    const unitPrice = Number(stock.unit_price), totalPrice = movementTotal(fields.quantity, unitPrice);
    const [changed] = await connection.query(`UPDATE stock_batches SET current_unit_qty = current_unit_qty - ?, updated_by = ?
      WHERE id = ? AND IFNULL(deleted, 0) = 0 AND current_unit_qty >= ?`, [fields.quantity, req.user.id, fields.stock_id, fields.quantity]);
    if (changed.affectedRows !== 1) throw invalid('quantity', 'Stock changed during issue. Refresh and retry.', 409);
    const [movement] = await connection.query(`INSERT INTO stock_movements
      (stock_id, movement_type, quantity, unit_price, total_price, issued_to, notes, created_by, request_key)
      VALUES (?, 'issue', ?, ?, ?, ?, ?, ?, ?)`, [fields.stock_id, fields.quantity, unitPrice, totalPrice, fields.issued_to, fields.notes, req.user.id, requestKey]);
    await stockAudit(connection, req, 'ISSUE', 'stock_movement', movement.insertId, { stock_id: stock.id, current_unit_qty: stock.current_unit_qty },
      { id: movement.insertId, ...fields, unit_price: unitPrice, total_price: totalPrice, current_unit_qty: Number(stock.current_unit_qty) - fields.quantity });
    await connection.commit();
    res.json({ message: 'Stock issued successfully', movement_id: movement.insertId, total_price: totalPrice });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This retry key is already in use. Retry the original request.', retryable: true });
    failure(res, error, 'Failed to issue stock');
  } finally { connection?.release(); }
};

async function lockMovementStocks(connection, movement, stockId = movement.stock_id) {
  const ids = [...new Set([Number(movement.stock_id), Number(stockId)])].sort((a, b) => a - b);
  const [rows] = await connection.query(`SELECT * FROM stock_batches WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC FOR UPDATE`, ids);
  const stocks = new Map(rows.map((row) => [Number(row.id), row]));
  for (const id of ids) if (!stocks.has(id) || Number(stocks.get(id).deleted)) throw invalid('stock_id', 'An affected stock batch is archived or missing. Restore it before changing this issue.', 409);
  const original = stocks.get(Number(movement.stock_id));
  if (!Number.isSafeInteger(Number(movement.quantity)) || Number(movement.quantity) <= 0 || Number(original.current_unit_qty) + Number(movement.quantity) > Number(original.unit_qty)) throw invalid('quantity', 'Existing stock quantities require review before this issue can be changed', 409);
  return stocks;
}

exports.updateStockMovement = async (req, res) => {
  let connection;
  try {
    const id = identifier(req.body.id), fields = movementFields(req.body);
    await ensureStockTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[movement]] = await connection.query('SELECT * FROM stock_movements WHERE id = ? AND voided_at IS NULL FOR UPDATE', [id]);
    if (!movement) throw invalid('id', 'Stock out entry not found', 404);
    const stocks = await lockMovementStocks(connection, movement, fields.stock_id);
    const target = stocks.get(fields.stock_id);
    const restoredQuantity = Number(target.current_unit_qty) + (Number(movement.stock_id) === fields.stock_id ? Number(movement.quantity) : 0);
    if (restoredQuantity < fields.quantity) throw invalid('quantity', 'Not enough stock available for this correction');
    const unitPrice = Number(target.unit_price), totalPrice = movementTotal(fields.quantity, unitPrice);
    await connection.query('UPDATE stock_batches SET current_unit_qty = current_unit_qty + ?, updated_by = ? WHERE id = ?', [Number(movement.quantity), req.user.id, movement.stock_id]);
    await connection.query(`UPDATE stock_batches SET current_unit_qty = current_unit_qty - ?, updated_by = ? WHERE id = ? AND current_unit_qty >= ?`, [fields.quantity, req.user.id, fields.stock_id, fields.quantity]);
    await connection.query(`UPDATE stock_movements SET stock_id = ?, quantity = ?, unit_price = ?, total_price = ?, issued_to = ?, notes = ? WHERE id = ?`,
      [fields.stock_id, fields.quantity, unitPrice, totalPrice, fields.issued_to, fields.notes, id]);
    await stockAudit(connection, req, 'UPDATE', 'stock_movement', id, movement, { id, ...fields, unit_price: unitPrice, total_price: totalPrice });
    await connection.commit();
    res.json({ message: 'Stock out entry updated successfully', movement_id: id });
  } catch (error) { if (connection) await connection.rollback(); failure(res, error, 'Failed to update stock out entry'); }
  finally { connection?.release(); }
};

exports.deleteStockMovement = async (req, res) => {
  let connection;
  try {
    const id = identifier(req.body.id);
    await ensureStockTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[movement]] = await connection.query('SELECT * FROM stock_movements WHERE id = ? FOR UPDATE', [id]);
    if (!movement) throw invalid('id', 'Stock out entry not found', 404);
    if (movement.voided_at) {
      await connection.commit();
      return res.json({ message: 'Stock out entry already voided; quantity was restored', movement_id: id, replayed: true });
    }
    await lockMovementStocks(connection, movement);
    await connection.query('UPDATE stock_batches SET current_unit_qty = current_unit_qty + ?, updated_by = ? WHERE id = ?', [Number(movement.quantity), req.user.id, movement.stock_id]);
    await connection.query('UPDATE stock_movements SET voided_at = CURRENT_TIMESTAMP, voided_by = ? WHERE id = ? AND voided_at IS NULL', [req.user.id, id]);
    await stockAudit(connection, req, 'VOID', 'stock_movement', id, movement, { ...movement, voided_by: req.user.id, voided: true });
    await connection.commit();
    res.json({ message: 'Stock out entry voided and quantity restored', movement_id: id });
  } catch (error) { if (connection) await connection.rollback(); failure(res, error, 'Failed to void stock out entry'); }
  finally { connection?.release(); }
};

exports.getStockMovements = async (req, res) => {
  try {
    await ensureStockTable();
    const query = req.query || {}, params = [];
    const options = listOptions(query, { id: 'm.id', product_name: 's.product_name', quantity: 'm.quantity', total_price: 'm.total_price', created_at: 'm.created_at' }, 'created_at');
    let where = 'WHERE m.voided_at IS NULL';
    if (query.status) {
      if (!['active', 'voided', 'all'].includes(query.status)) throw invalid('status', 'Choose active, voided or all');
      where = query.status === 'all' ? 'WHERE 1 = 1' : query.status === 'voided' ? 'WHERE m.voided_at IS NOT NULL' : where;
    }
    if (query.stock_id) { where += ' AND m.stock_id = ?'; params.push(identifier(query.stock_id, 'stock_id')); }
    const search = String(query.search || '').trim().slice(0, 180);
    if (search) { where += ' AND (s.product_name LIKE ? OR s.batch_code LIKE ? OR m.issued_to LIKE ?)'; params.push(...Array(3).fill(`%${search}%`)); }
    const [rows] = await pool.query(`SELECT m.*, s.product_name, s.category, s.batch_code, u.name AS created_by_name
      FROM stock_movements m LEFT JOIN stock_batches s ON s.id = m.stock_id LEFT JOIN users u ON u.id = m.created_by
      ${where} ORDER BY ${options.order}, m.id ASC ${options.paginated ? 'LIMIT ? OFFSET ?' : ''}`,
      [...params, ...(options.paginated ? [options.limit, (options.page - 1) * options.limit] : [])]);
    res.json({ movements: rows, ...await pagination(pool, options, `SELECT COUNT(*) AS total FROM stock_movements m LEFT JOIN stock_batches s ON s.id = m.stock_id ${where}`, params) });
  } catch (error) { failure(res, error, 'Failed to load stock usage'); }
};

async function archiveStock(req, res, restore) {
  let connection;
  try {
    const id = identifier(req.body.id);
    await ensureStockTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[stock]] = await connection.query('SELECT * FROM stock_batches WHERE id = ? FOR UPDATE', [id]);
    if (!stock) throw invalid('id', 'Stock batch not found', 404);
    const deleted = restore ? 0 : 1;
    if (Number(stock.deleted) !== deleted) {
      await connection.query('UPDATE stock_batches SET deleted = ?, updated_by = ? WHERE id = ?', [deleted, req.user.id, id]);
      await stockAudit(connection, req, restore ? 'RESTORE' : 'ARCHIVE', 'stock_batch', id, stock, { ...stock, deleted, updated_by: req.user.id });
    }
    await connection.commit();
    res.json({ message: restore ? 'Stock batch restored successfully' : 'Stock batch archived successfully', stock_id: id });
  } catch (error) { if (connection) await connection.rollback(); failure(res, error, restore ? 'Failed to restore stock' : 'Failed to archive stock'); }
  finally { connection?.release(); }
}

exports.deleteStock = (req, res) => archiveStock(req, res, false);
exports.restoreStock = (req, res) => archiveStock(req, res, true);

exports.ensureStockTable = ensureStockTable;
