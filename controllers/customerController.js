const pool = require('../config/db');
const { moveToTrash } = require('../services/trashService');
const { logAudit } = require('../services/auditService');

function validationError(field, message) {
  return Object.assign(new Error(message), { statusCode: 400, fields: { [field]: message } });
}

function customerId(value, required = false) {
  if (value === undefined || value === null || value === '' || (!required && (value === 0 || value === '0'))) {
    if (!required) return 0;
    throw validationError('id', 'Customer ID is required');
  }
  if (!['number', 'string'].includes(typeof value)) throw validationError('id', 'Customer ID must be a positive integer');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw validationError('id', 'Customer ID must be a positive integer');
  return id;
}

function customerFields(body) {
  const fields = {};
  for (const [field, max] of Object.entries({ company_name: 180, contact_name: 180, email: 180, phone: 80, address: 10000, notes: 10000, file_link: 2048 })) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== 'string') throw validationError(field, 'Enter text for this field');
    fields[field] = String(value || '').trim();
    if (fields[field].length > max) throw validationError(field, `Use no more than ${max} characters`);
  }
  if (!fields.company_name) throw validationError('company_name', 'Customer/company name is required');
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw validationError('email', 'Enter a valid email address');
  if (fields.file_link && !/^(?:https?:\/\/|\/(?!\/))[^\s]+$/i.test(fields.file_link)) throw validationError('file_link', 'Use an HTTP(S) URL or an application file path');
  return fields;
}

function listOptions(query) {
  const columns = { id: 'c.id', company_name: 'c.company_name', contact_name: 'c.contact_name', created_at: 'c.created_at', order_count: 'order_count', total_spend: 'total_spend' };
  const sort = query.sort || 'id';
  if (!Object.hasOwn(columns, sort)) throw validationError('sort', 'Choose a supported sort field');
  const direction = String(query.direction || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) throw validationError('direction', 'Sort direction must be asc or desc');
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 50);
  if (paginated && (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger((page - 1) * limit))) throw validationError('page', 'Use a positive page and a limit from 1 to 200');
  return { order: `${columns[sort]} ${direction.toUpperCase()}, c.id ${direction.toUpperCase()}`, paginated, page, limit };
}

async function ensureCustomerTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_name VARCHAR(180) NOT NULL,
      contact_name VARCHAR(180) NULL,
      email VARCHAR(180) NULL,
      phone VARCHAR(80) NULL,
      address TEXT NULL,
      notes TEXT NULL,
      file_link TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
}

exports.getCustomers = async (req, res) => {
  try {
    await ensureCustomerTable();

    const options = listOptions(req.query || {});
    const search = String(req.query?.search || '').trim().slice(0, 180);
    const params = [];
    let where = 'c.deleted = 0';
    if (search) {
      where += ' AND (c.company_name LIKE ? OR c.contact_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)';
      params.push(...Array(4).fill(`%${search}%`));
    }

    const [rows] = await pool.query(`
      SELECT
        c.*,
        u.name AS created_by_name,
        COALESCE(i.order_count, 0) AS order_count,
        COALESCE(i.total_spend, 0) AS total_spend
      FROM customers c
      LEFT JOIN users u ON u.id = c.created_by
      LEFT JOIN (
        SELECT customer_email, COUNT(*) AS order_count, SUM(total) AS total_spend
        FROM invoices
        WHERE (deleted = 0 OR deleted IS NULL) AND LOWER(status) IN ('approved','sent','paid','partially_paid','overdue')
        GROUP BY customer_email
      ) i ON i.customer_email = c.email
      WHERE ${where}
      ORDER BY ${options.order}
      ${options.paginated ? 'LIMIT ? OFFSET ?' : ''}
    `, [...params, ...(options.paginated ? [options.limit, (options.page - 1) * options.limit] : [])]);

    let pagination;
    if (options.paginated) {
      const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM customers c WHERE ${where}`, params);
      pagination = { page: options.page, limit: options.limit, total: Number(count.total), pages: Math.ceil(Number(count.total) / options.limit) };
    }
    res.json({ customers: rows, ...(pagination ? { pagination } : {}) });
  } catch (error) {
    console.error('getCustomers error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to load customers', ...(error.fields ? { fields: error.fields } : {}) });
  }
};

exports.saveCustomer = async (req, res) => {
  let connection;
  try {
    const id = customerId(req.body.id);
    const fields = customerFields(req.body);
    const values = Object.values(fields);
    await ensureCustomerTable();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let oldValue = null;
    let customerRecordId = id;
    if (id) {
      const [[existing]] = await connection.query('SELECT * FROM customers WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!existing) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
      oldValue = existing;
      await connection.query(
        `
        UPDATE customers
        SET company_name = ?, contact_name = ?, email = ?, phone = ?,
            address = ?, notes = ?, file_link = ?, updated_by = ?
        WHERE id = ? AND deleted = 0
        `,
        [...values, req.user.id, id]
      );
    } else {
      const [result] = await connection.query(
      `
      INSERT INTO customers
      (company_name, contact_name, email, phone, address, notes, file_link, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [...values, req.user.id]
      );
      customerRecordId = result.insertId;
    }
    await logAudit(connection, {
      actorId: req.user.id, action: id ? 'UPDATE' : 'CREATE', module: 'Customers', recordType: 'customer', recordId: customerRecordId,
      oldValue, newValue: { id: customerRecordId, ...fields }, ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId, sessionId: req.session?.id
    });
    await connection.commit();
    res.json({ message: id ? 'Customer updated successfully' : 'Customer saved successfully', customer_id: customerRecordId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('saveCustomer error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to save customer', ...(error.fields ? { fields: error.fields } : {}) });
  } finally {
    connection?.release();
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    await ensureCustomerTable();

    const id = customerId(req.body.id, true);

    const trash = await moveToTrash({
      entityType: 'customer', entityId: id, actorId: req.user.id,
      reason: req.body.reason || 'Removed from Customers', req
    });
    res.json({ message: 'Customer moved to Trash', ...trash });
  } catch (error) {
    console.error('deleteCustomer error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to delete customer', code: error.code });
  }
};

exports.ensureCustomerTable = ensureCustomerTable;
