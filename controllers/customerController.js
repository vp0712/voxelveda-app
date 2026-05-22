const pool = require('../config/db');

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
        WHERE deleted = 0 OR deleted IS NULL
        GROUP BY customer_email
      ) i ON i.customer_email = c.email
      WHERE c.deleted = 0
      ORDER BY c.company_name ASC
    `);

    res.json({ customers: rows });
  } catch (error) {
    console.error('getCustomers error:', error);
    res.status(500).json({ message: 'Failed to load customers', error: error.message });
  }
};

exports.saveCustomer = async (req, res) => {
  try {
    await ensureCustomerTable();

    const id = Number(req.body.id || 0);
    const companyName = String(req.body.company_name || '').trim();
    const contactName = String(req.body.contact_name || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const address = String(req.body.address || '').trim();
    const notes = String(req.body.notes || '').trim();
    const fileLink = String(req.body.file_link || '').trim();

    if (!companyName) {
      return res.status(400).json({ message: 'Customer/company name is required' });
    }

    if (id) {
      const [result] = await pool.query(
        `
        UPDATE customers
        SET company_name = ?, contact_name = ?, email = ?, phone = ?,
            address = ?, notes = ?, file_link = ?, updated_by = ?
        WHERE id = ? AND deleted = 0
        `,
        [companyName, contactName, email, phone, address, notes, fileLink, req.user.id, id]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Customer not found' });
      return res.json({ message: 'Customer updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO customers
      (company_name, contact_name, email, phone, address, notes, file_link, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [companyName, contactName, email, phone, address, notes, fileLink, req.user.id]
    );

    res.json({ message: 'Customer saved successfully', customer_id: result.insertId });
  } catch (error) {
    console.error('saveCustomer error:', error);
    res.status(500).json({ message: 'Failed to save customer', error: error.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    await ensureCustomerTable();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Customer ID is required' });

    const [result] = await pool.query(
      'UPDATE customers SET deleted = 1, updated_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('deleteCustomer error:', error);
    res.status(500).json({ message: 'Failed to delete customer', error: error.message });
  }
};
