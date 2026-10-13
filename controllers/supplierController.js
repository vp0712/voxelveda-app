const { storedDocumentArtifact, sendPdfResponse } = require('../services/documentPdfService');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { moveToTrash } = require('../services/trashService');
const { logSecurityEvent } = require('../services/sessionService');
const { safeDispositionName } = require('../services/documentSecurityService');
const { logAudit } = require('../services/auditService');

let originalSchemaPromise;
function ensureSupplierTables() {
  if (!originalSchemaPromise) originalSchemaPromise = createSupplierTablesStructures().catch((error) => { originalSchemaPromise = null; throw error; });
  return originalSchemaPromise;
}

async function createSupplierTablesStructures() {
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
      file_data LONGBLOB NULL,
      uploaded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      INDEX supplier_files_supplier_id_idx (supplier_id)
    )
  `);

  await pool.query('ALTER TABLE supplier_files ADD COLUMN file_data LONGBLOB NULL').catch(() => {});
  await pool.query("ALTER TABLE supplier_files ADD COLUMN classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL'").catch(() => {});
  await pool.query("ALTER TABLE supplier_files ADD COLUMN scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE'").catch(() => {});
  await pool.query('ALTER TABLE supplier_files ADD COLUMN size_bytes BIGINT NULL').catch(() => {});
}

exports.getSuppliers = async (req, res) => {
  try {
    await ensureSupplierTables();

    const query = req.query || {}, params = [], archived = String(query.archived || '').toLowerCase() === 'true';
    let where = 's.deleted = ?'; params.push(archived ? 1 : 0);
    const search = String(query.q || query.search || '').trim();
    if (search) { where += ' AND (s.supplier_name LIKE ? OR s.contact_name LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)'; params.push(...Array(4).fill('%' + search.slice(0, 180) + '%')); }
    if (query.category) { where += ' AND s.category = ?'; params.push(String(query.category).slice(0,120)); }
    const sortColumns = { id: 's.id', name: 's.supplier_name', category: 's.category', created_at: 's.created_at' };
    const sort = Object.hasOwn(sortColumns, query.sort) ? sortColumns[query.sort] : 's.id';
    const direction = String(query.direction || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const paginated = query.page != null || query.limit != null;
    const page = Math.max(1, Math.floor(Number(query.page) || 1)), limit = Math.min(200, Math.max(1, Math.floor(Number(query.limit) || 25)));

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
      WHERE ${where}
      ORDER BY ${sort} ${direction}, s.id ${direction}
      ${paginated ? 'LIMIT ? OFFSET ?' : ''}
    `, [...params, ...(paginated ? [limit,(page-1)*limit] : [])]);

    const ids = suppliers.map((supplier) => supplier.id);
    const [files] = ids.length ? await pool.query(`
      SELECT sf.id, sf.supplier_id, sf.file_type, sf.title, sf.notes, sf.original_name, sf.mime_type,
             sf.classification, sf.scan_status, sf.size_bytes, sf.uploaded_by, sf.created_at, u.name AS uploaded_by_name
      FROM supplier_files sf
      JOIN suppliers s ON s.id = sf.supplier_id
      LEFT JOIN users u ON u.id = sf.uploaded_by
      WHERE sf.deleted = 0 AND sf.supplier_id IN (?)
      ORDER BY sf.created_at ASC, sf.id ASC
    `, [ids]) : [[]];

    const filesBySupplier = files.reduce((acc, file) => {
      const key = String(file.supplier_id);
      acc[key] = acc[key] || [];
      acc[key].push(file);
      return acc;
    }, {});

    let pagination;
    if (paginated) { const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM suppliers s WHERE ${where}`, params); pagination = { page, limit, total: Number(count.total), pages: Math.ceil(Number(count.total)/limit) }; }
    res.json({
      suppliers: suppliers.map((supplier) => ({
        ...supplier,
        files: (filesBySupplier[String(supplier.id)] || []).map((file) => ({ ...file, download_url: `/api/suppliers/files/${file.id}/view` }))
      })), ...(pagination ? { pagination } : {})
    });
  } catch (error) {
    console.error('getSuppliers error:', error);
    res.status(500).json({ message: 'Failed to load suppliers', error: error.message });
  }
};

exports.saveSupplier = async (req, res) => {
  let connection;
  try {
    const id = Number(req.body.id || 0), fields = {}, errors = {};
    if (!Number.isSafeInteger(id) || id < 0) errors.id = 'Choose a valid supplier';
    for (const [name, maximum] of Object.entries({ supplier_name: 180, contact_name: 180, email: 180, phone: 80, address: 10000, category: 120, payment_terms: 160, abn_acn: 120, notes: 10000 })) {
      fields[name] = String(req.body[name] || '').trim();
      if (fields[name].length > maximum) errors[name] = `Maximum ${maximum} characters`;
    }
    if (!fields.supplier_name) errors.supplier_name = 'Supplier name is required';
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address';
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Check the highlighted supplier fields.', fields: errors });
    await ensureSupplierTables(); connection = await pool.getConnection(); await connection.beginTransaction();
    let previous = null, recordId = id;
    if (id) {
      const [[row]] = await connection.query('SELECT * FROM suppliers WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!row) { await connection.rollback(); return res.status(404).json({ message: 'Supplier not found' }); }
      previous = row;
      await connection.query(`UPDATE suppliers SET supplier_name = ?, contact_name = ?, email = ?, phone = ?, address = ?, category = ?, payment_terms = ?, abn_acn = ?, notes = ?, updated_by = ? WHERE id = ? AND deleted = 0`, [...Object.values(fields), req.user.id, id]);
    } else {
      const [result] = await connection.query(`INSERT INTO suppliers
        (supplier_name, contact_name, email, phone, address, category, payment_terms, abn_acn, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...Object.values(fields), req.user.id]);
      recordId = result.insertId;
    }
    await logAudit(connection, { actorId: req.user.id, action: id ? 'SUPPLIER_UPDATED' : 'SUPPLIER_CREATED', module: 'Suppliers', recordType: 'supplier', recordId,
      oldValue: previous, newValue: { id: recordId, ...fields }, ipAddress: req.ip, userAgent: req.get?.('user-agent'), requestId: req.requestId, sessionId: req.session?.id });
    await connection.commit(); return res.json({ message: id ? 'Supplier updated successfully' : 'Supplier saved successfully', supplier_id: recordId });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Supplier save failed:', error.code || error.name);
    return res.status(500).json({ message: 'Supplier could not be saved. Refresh before retrying.' });
  } finally { if (connection) connection.release(); }
};

exports.supplierHistory = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Choose a valid supplier' });
    const [[supplier]] = await pool.query('SELECT id FROM suppliers WHERE id = ?', [id]);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
    const [history] = await pool.query(`SELECT a.action, a.old_value, a.new_value, a.created_at, u.name AS actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE LOWER(a.module) = 'suppliers' AND a.record_type = 'supplier' AND a.record_id = ? ORDER BY a.id DESC LIMIT 100`, [String(id)]);
    return res.json({ supplier_id: id, history });
  } catch (error) { console.error('Supplier history failed:', error.code || error.name); return res.status(500).json({ message: 'Supplier history could not be loaded' }); }
};

exports.deleteSupplier = async (req, res) => {
  try {
    await ensureSupplierTables();

    const id = Number(req.body.id || 0);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Choose a valid supplier' });

    const trash = await moveToTrash({
      entityType: 'supplier', entityId: id, actorId: req.user.id,
      reason: req.body.reason || 'Removed from Suppliers', req
    });
    res.json({ message: 'Supplier moved to Trash', ...trash });
  } catch (error) {
    console.error('deleteSupplier error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to delete supplier', code: error.code });
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

    const fileData = req.file?.path ? await fs.promises.readFile(req.file.path).catch(() => null) : null;

    const [result] = await pool.query(
      `
      INSERT INTO supplier_files
      (supplier_id, file_type, title, notes, original_name, file_path, mime_type, file_data, uploaded_by, classification, scan_status, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIDENTIAL', 'UNAVAILABLE', ?)
      `,
      [
        supplierId,
        fileType,
        title,
        notes,
        req.file.originalname,
        `/uploads/suppliers/${req.file.filename}`,
        req.file.mimetype,
        fileData,
        req.user.id,
        Number(req.file.size || fileData?.length || 0)
      ]
    );

    res.json({ message: 'Supplier file uploaded successfully', file_id: result.insertId });
  } catch (error) {
    console.error('saveSupplierFile error:', error);
    res.status(500).json({ message: 'Failed to upload supplier file', error: error.message });
  }
};

exports.viewSupplierFile = async (req, res) => {
  try {
    await ensureSupplierTables();

    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });

    const [[file]] = await pool.query(
      `SELECT sf.original_name, sf.file_path, sf.mime_type, sf.file_data
       FROM supplier_files sf JOIN suppliers s ON s.id = sf.supplier_id
       WHERE sf.id = ? AND sf.deleted = 0 AND s.deleted = 0 LIMIT 1`,
      [id]
    );

    if (!file) return res.status(404).json({ message: 'Supplier file not found' });

    let body = Buffer.isBuffer(file.file_data) && file.file_data.length ? file.file_data : null;
    if (!body) {
      const allowed = path.resolve(__dirname, '..', 'uploads', 'suppliers') + path.sep;
      const candidate = path.resolve(__dirname, '..', String(file.file_path || '').replace(/^\//,''));
      if (!candidate.startsWith(allowed) || !fs.existsSync(candidate)) return res.status(404).json({message:'The original stored document bytes were not found.'});
      body = await fs.promises.readFile(candidate);
    }
    const artifact = await storedDocumentArtifact(body,file.original_name || `supplier-file-${id}`);
    await logSecurityEvent({actorId:req.user.id,eventType:'SENSITIVE_DOCUMENT_VIEWED',req,sessionId:req.session?.id,metadata:{module:'supplier',fileId:id,pdfValidated:true}});
    return await sendPdfResponse(res,artifact,Boolean(req.query.download));

  } catch (error) {
    console.error('viewSupplierFile error:', error);
    res.status(error.status || 500).json({ code: error.code, message: 'Failed to open supplier file', error: error.message });
  }
};

exports.deleteSupplierFile = async (req, res) => {
  try {
    await ensureSupplierTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });

    const [rows] = await pool.query(
      `SELECT sf.file_path FROM supplier_files sf JOIN suppliers s ON s.id = sf.supplier_id
       WHERE sf.id = ? AND sf.deleted = 0 AND s.deleted = 0 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: 'File not found' });
    const [result] = await pool.query('UPDATE supplier_files SET deleted = 1 WHERE id = ? AND deleted = 0', [id]);

    if (result.affectedRows === 0) return res.status(404).json({ message: 'File not found' });

    // Archive metadata while retaining the authoritative attachment bytes.

    res.json({ message: 'Supplier file deleted successfully' });
  } catch (error) {
    console.error('deleteSupplierFile error:', error);
    res.status(500).json({ message: 'Failed to delete supplier file', error: error.message });
  }
};

exports.ensureSupplierTables = ensureSupplierTables;
