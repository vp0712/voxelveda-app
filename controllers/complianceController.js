const { storedDocumentArtifact, sendPdfResponse } = require('../services/documentPdfService');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { logSecurityEvent } = require('../services/sessionService');
const { safeDispositionName } = require('../services/documentSecurityService');
const { externalHttpUrl } = require('../utils/externalHttpUrl');

let originalSchemaPromise;
function ensureComplianceTables() {
  if (!originalSchemaPromise) originalSchemaPromise = createComplianceTablesStructures().catch((error) => { originalSchemaPromise = null; throw error; });
  return originalSchemaPromise;
}

async function createComplianceTablesStructures() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(120) NOT NULL,
      title VARCHAR(220) NOT NULL,
      authority VARCHAR(180) NULL,
      requirement_type VARCHAR(120) NULL,
      status VARCHAR(80) NOT NULL DEFAULT 'review_required',
      due_date DATE NULL,
      renewal_date DATE NULL,
      official_link TEXT NULL,
      form_number VARCHAR(120) NULL,
      process_sheet_required TINYINT(1) NOT NULL DEFAULT 0,
      filled_notes TEXT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      entry_id INT NOT NULL,
      file_label VARCHAR(180) NULL,
      file_type VARCHAR(80) NOT NULL DEFAULT 'form',
      original_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(120) NULL,
      uploaded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      INDEX compliance_files_entry_id_idx (entry_id)
    )
  `);
  await pool.query("ALTER TABLE compliance_files ADD COLUMN classification VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL'").catch(() => {});
  await pool.query("ALTER TABLE compliance_files ADD COLUMN scan_status VARCHAR(20) NOT NULL DEFAULT 'UNAVAILABLE'").catch(() => {});
  await pool.query('ALTER TABLE compliance_files ADD COLUMN size_bytes BIGINT NULL').catch(() => {});

  // Retained records and attachments remain authoritative; no automatic sample insert/update.

}

exports.getComplianceEntries = async (req, res) => {
  try {
    await ensureComplianceTables();

    const [entries] = await pool.query(`
      SELECT e.*, cu.name AS created_by_name, uu.name AS updated_by_name
      FROM compliance_entries e
      LEFT JOIN users cu ON cu.id = e.created_by
      LEFT JOIN users uu ON uu.id = e.updated_by
      WHERE e.deleted = 0
      ORDER BY e.id ASC
    `);

    const [files] = await pool.query(`
      SELECT cf.id, cf.entry_id, cf.file_label, cf.file_type, cf.original_name, cf.mime_type,
             cf.classification, cf.scan_status, cf.size_bytes, cf.uploaded_by, cf.created_at, u.name AS uploaded_by_name
      FROM compliance_files cf
      LEFT JOIN users u ON u.id = cf.uploaded_by
      WHERE cf.deleted = 0
      ORDER BY cf.created_at ASC, cf.id ASC
    `);

    const filesByEntry = files.reduce((acc, file) => {
      const key = String(file.entry_id);
      acc[key] = acc[key] || [];
      acc[key].push(file);
      return acc;
    }, {});

    res.json({
      entries: entries.map((entry) => ({
        ...entry,
        process_sheet_required: Number(entry.process_sheet_required) === 1,
        files: (filesByEntry[String(entry.id)] || []).map((file) => ({ ...file, download_url: `/api/compliance/files/${file.id}/view` }))
      }))
    });
  } catch (error) {
    console.error('getComplianceEntries error:', error);
    res.status(500).json({ message: 'Failed to load compliance register', error: error.message });
  }
};

exports.saveComplianceEntry = async (req, res) => {
  try {
    const officialLink = externalHttpUrl(req.body.official_link, 'official_link');
    await ensureComplianceTables();

    const id = Number(req.body.id || 0);
    const category = String(req.body.category || '').trim();
    const title = String(req.body.title || '').trim();
    const authority = String(req.body.authority || '').trim();
    const requirementType = String(req.body.requirement_type || '').trim();
    const status = String(req.body.status || 'review_required').trim();
    const dueDate = req.body.due_date || null;
    const renewalDate = req.body.renewal_date || null;
    const formNumber = String(req.body.form_number || '').trim();
    const processSheetRequired = req.body.process_sheet_required ? 1 : 0;
    const filledNotes = String(req.body.filled_notes || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!category || !title) {
      return res.status(400).json({ message: 'Category and title are required' });
    }

    if (id) {
      const [result] = await pool.query(
        `
        UPDATE compliance_entries
        SET category = ?, title = ?, authority = ?, requirement_type = ?, status = ?,
            due_date = ?, renewal_date = ?, official_link = ?, form_number = ?,
            process_sheet_required = ?, filled_notes = ?, notes = ?, updated_by = ?
        WHERE id = ? AND deleted = 0
        `,
        [category, title, authority, requirementType, status, dueDate, renewalDate, officialLink, formNumber, processSheetRequired, filledNotes, notes, req.user.id, id]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Compliance entry not found' });
      return res.json({ message: 'Compliance entry updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO compliance_entries
      (category, title, authority, requirement_type, status, due_date, renewal_date, official_link, form_number, process_sheet_required, filled_notes, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [category, title, authority, requirementType, status, dueDate, renewalDate, officialLink, formNumber, processSheetRequired, filledNotes, notes, req.user.id]
    );

    res.json({ message: 'Compliance entry saved successfully', entry_id: result.insertId });
  } catch (error) {
    console.error('saveComplianceEntry error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to save compliance entry', code: error.code, fields: error.fields });
  }
};

exports.deleteComplianceEntry = async (req, res) => {
  try {
    await ensureComplianceTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Compliance entry ID is required' });

    const [result] = await pool.query('UPDATE compliance_entries SET deleted = 1, updated_by = ? WHERE id = ?', [req.user.id, id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Compliance entry not found' });

    res.json({ message: 'Compliance entry deleted successfully' });
  } catch (error) {
    console.error('deleteComplianceEntry error:', error);
    res.status(500).json({ message: 'Failed to delete compliance entry', error: error.message });
  }
};

exports.saveComplianceFile = async (req, res) => {
  try {
    await ensureComplianceTables();

    const entryId = Number(req.params.id || 0);
    const fileLabel = String(req.body.file_label || '').trim();
    const fileType = String(req.body.file_type || 'form').trim();

    if (!entryId) return res.status(400).json({ message: 'Compliance entry ID is required' });
    if (!req.file) return res.status(400).json({ message: 'Choose a form, licence, PDF, process sheet or photo' });

    const [entryRows] = await pool.query('SELECT id FROM compliance_entries WHERE id = ? AND deleted = 0 LIMIT 1', [entryId]);
    if (!entryRows.length) return res.status(404).json({ message: 'Compliance entry not found' });

    const [result] = await pool.query(
      `
      INSERT INTO compliance_files
      (entry_id, file_label, file_type, original_name, file_path, mime_type, uploaded_by, classification, scan_status, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIDENTIAL', 'UNAVAILABLE', ?)
      `,
      [entryId, fileLabel, fileType, req.file.originalname, `/uploads/compliance/${req.file.filename}`, req.file.mimetype, req.user.id, Number(req.file.size || 0)]
    );

    res.json({ message: 'Compliance file uploaded successfully', file_id: result.insertId });
  } catch (error) {
    console.error('saveComplianceFile error:', error);
    res.status(500).json({ message: 'Failed to upload compliance file', error: error.message });
  }
};

exports.viewComplianceFile = async (req, res) => {
  try {
    await ensureComplianceTables();
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });
    const [[file]] = await pool.query('SELECT original_name, file_path, mime_type, scan_status FROM compliance_files WHERE id = ? AND deleted = 0 LIMIT 1', [id]);
    if (!file) return res.status(404).json({ message: 'Compliance file not found' });
    if (['PENDING_SCAN', 'QUARANTINED'].includes(file.scan_status)) return res.status(423).json({ message: 'File is not available while security review is pending' });
    const candidate = file.file_path ? path.resolve(__dirname, '..', file.file_path.replace(/^\//, '')) : '';
    const root = path.resolve(__dirname, '..', 'uploads', 'compliance');
    if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) return res.status(404).json({ message: 'Compliance file is no longer available' });
    const artifact = await storedDocumentArtifact(await fs.promises.readFile(candidate),file.original_name || `compliance-file-${id}`);
    await logSecurityEvent({actorId:req.user.id,eventType:'SENSITIVE_DOCUMENT_VIEWED',req,sessionId:req.session?.id,metadata:{module:'compliance',fileId:id,pdfValidated:true}});
    return await sendPdfResponse(res,artifact,Boolean(req.query.download));

  } catch (error) {
    return res.status(error.status || 500).json({ code: error.code, message: 'Failed to open compliance file' });
  }
};

exports.deleteComplianceFile = async (req, res) => {
  try {
    await ensureComplianceTables();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'File ID is required' });

    const [rows] = await pool.query('SELECT file_path FROM compliance_files WHERE id = ? AND deleted = 0 LIMIT 1', [id]);
    const [result] = await pool.query('UPDATE compliance_files SET deleted = 1 WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'File not found' });

    // Archive metadata while retaining the authoritative attachment bytes.

    res.json({ message: 'Compliance file deleted successfully' });
  } catch (error) {
    console.error('deleteComplianceFile error:', error);
    res.status(500).json({ message: 'Failed to delete compliance file', error: error.message });
  }
};

exports.ensureComplianceTables = ensureComplianceTables;
