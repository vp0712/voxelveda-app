const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function ensureSupplierTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_name VARCHAR(180) NOT NULL,
      contact_name VARCHAR(180) NULL,
      email VARCHAR(180) NULL,
      phone VARCHAR(80) NULL,
      address TEXT NULL,
      category VARCHAR(120) NULL,
      payment_terms VARCHAR(160) NULL,
      abn_acn VARCHAR(120) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_id INT NOT NULL,
      file_type VARCHAR(80) NOT NULL,
      title VARCHAR(180) NULL,
      notes TEXT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(120) NULL,
      uploaded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      INDEX supplier_files_supplier_id_idx (supplier_id)
    )
  `);
}

exports.getSuppliers = async (req, res) => {
  try {
    await ensureSupplierTables();

    const [suppliers] = await pool.query(`
      SELECT
        s.*,
        cu.name AS created_by_name,
        uu.name AS updated_by_name,
        COALESCE(f.file_count, 0) AS file_count
      FROM suppliers s
      LEFT JOIN users cu ON cu.id = s.created_by
      LEFT JOIN users uu ON uu.id = s.updated_by
      LEFT JOIN (
        SELECT supplier_id, COUNT(*) AS file_count
        FROM supplier_files
        WHERE deleted = 0
        GROUP BY supplier_id
      ) f ON f.supplier_id = s.id
      WHERE s.deleted = 0
      ORDER BY s.id ASC
    `);

    const [files] = await pool.query(`
      SELECT sf.*, u.name AS uploaded_by_name
      FROM supplier_files sf
      LEFT JOIN users u ON u.id = sf.uploaded_by
      WHERE sf.deleted = 0
      ORDER BY sf.created_at ASC, sf.id ASC
    `);

    const filesBySupplier = files.reduce((acc, file) => {
      const key = String(file.supplier_id);
      acc[key] = acc[key] || [];
      acc[key].push(file);
      return acc;
    }, {});

    res.json({
      suppliers: suppliers.map((supplier) => ({
        ...supplier,
        files: filesBySupplier[String(supplier.id)] || []
      }))
    });
  } catch (error) {
    console.error('getSuppliers error:', error);
    res.status(500).json({ message: 'Failed to load suppliers', error: error.message });
  }
};

exports.saveSupplier = async (req, res) => {
  try {
    await ensureSupplierTables();

    const id = Number(req.body.id || 0);
    const supplierName = String(req.body.supplier_name || '').trim();
    const contactName = String(req.body.contact_name || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const address = String(req.body.address || '').trim();
    const category = String(req.body.category || '').trim();
    const paymentTerms = String(req.body.payment_terms || '').trim();
    const abnAcn = String(req.body.abn_acn || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!supplierName) {
      return res.status(400).json({ message: 'Supplier name is required' });
    }

    if (id) {
      const [result] = await pool.query(
        `
        UPDATE suppliers
        SET supplier_name = ?, contact_name = ?, email = ?, phone = ?, address = ?,
            category = ?, payment_terms = ?, abn_acn = ?, notes = ?, updated_by = ?
        WHERE id = ? AND deleted = 0
        `,
        [supplierName, contactName, email, phone, address, category, paymentTerms, abnAcn, notes, req.user.id, id]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Supplier not found' });
      return res.json({ message: 'Supplier updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO suppliers
      (supplier_name, contact_name, email, phone, address, category, payment_terms, abn_acn, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [supplierName, contactName, email, phone, address, category, paymentTerms, abnAcn, notes, req.user.id]
    );

    res.json({ message: 'Supplier saved successfully', supplier_id: result.insertId });
  } catch (error) {
    console.error('saveSupplier error:', error);
    res.status(500).json({ message: 'Failed to save supplier', error: error.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    await ensureSupplierTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Supplier ID is required' });

    const [result] = await pool.query(
      'UPDATE suppliers SET deleted = 1, updated_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Supplier not found' });
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('deleteSupplier error:', error);
    res.status(500).json({ message: 'Failed to delete supplier', error: error.message });
  }
};

exports.saveSupplierFile = async (req, res) => {
  try {
    await ensureSupplierTables();

    const supplierId = Number(req.params.id || 0);
    const fileType = String(req.body.file_type || 'bill_invoice').trim();
    const title = String(req.body.title || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!supplierId) return res.status(400).json({ message: 'Supplier ID is required' });
    if (!req.file) return res.status(400).json({ message: 'Choose a file or delivery invoice photo' });

    const [supplierRows] = await pool.query(
      'SELECT id FROM suppliers WHERE id = ? AND deleted = 0 LIMIT 1',
      [supplierId]
    );

    if (!supplierRows.length) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO supplier_files
      (supplier_id, file_type, title, notes, original_name, file_path, mime_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        supplierId,
        fileType,
        title,
        notes,
        req.file.originalname,
        `/uploads/suppliers/${req.file.filename}`,
        req.file.mimetype,
        req.user.id
      ]
    );

    res.json({ message: 'Supplier file uploaded successfully', file_id: result.insertId });
  } catch (error) {
    console.error('saveSupplierFile error:', error);
    res.status(500).json({ message: 'Failed to upload supplier file', error: error.message });
  }
};

exports.deleteSupplierFile = async (req, res) => {
  try {
    await ensureSupplierTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });

    const [rows] = await pool.query('SELECT file_path FROM supplier_files WHERE id = ? AND deleted = 0 LIMIT 1', [id]);
    const [result] = await pool.query('UPDATE supplier_files SET deleted = 1 WHERE id = ?', [id]);

    if (result.affectedRows === 0) return res.status(404).json({ message: 'File not found' });

    const filePath = rows[0]?.file_path ? path.join(__dirname, '..', rows[0].file_path.replace(/^\//, '')) : '';
    if (filePath && filePath.includes(`${path.sep}uploads${path.sep}suppliers${path.sep}`)) {
      fs.unlink(filePath, () => {});
    }

    res.json({ message: 'Supplier file deleted successfully' });
  } catch (error) {
    console.error('deleteSupplierFile error:', error);
    res.status(500).json({ message: 'Failed to delete supplier file', error: error.message });
  }
};
