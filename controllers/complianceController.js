const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const DEFAULT_ENTRIES = [
  {
    category: 'Business Licences',
    title: 'ABLIS licence and permit check',
    authority: 'business.gov.au / ABLIS',
    requirement_type: 'Mandatory check',
    status: 'review_required',
    official_link: 'https://business.gov.au/Registrations/Register-licences-and-permits',
    notes: 'Use ABLIS for the exact licences and permits required for your activity, council area, materials, equipment and location.'
  },
  {
    category: 'Manufacturing',
    title: 'Manufacturing industry compliance review',
    authority: 'business.gov.au',
    requirement_type: 'Industry checklist',
    status: 'review_required',
    official_link: 'https://business.gov.au/Planning/Industry-information/Manufacturing-industry',
    notes: 'Review workplace health and safety, employment, product, environmental and controlled substance requirements.'
  },
  {
    category: 'Import / Export',
    title: 'ABF import requirements check',
    authority: 'Australian Border Force',
    requirement_type: 'Import checklist',
    status: 'review_required',
    official_link: 'https://www.abf.gov.au/imports/Pages/How-to-import/Requirements.aspx',
    notes: 'Use before importing any machinery, parts, resin, raw material, packaging or equipment. Check whether the goods are restricted, need a permit, correct tariff classification, labelling or duty/GST assessment.'
  },
  {
    category: 'Import / Export',
    title: 'ABF Import Declaration N10 - B650',
    authority: 'Australian Border Force',
    requirement_type: 'Original import form',
    status: 'review_required',
    official_link: 'https://www.abf.gov.au/form-listing/forms/b650.pdf',
    notes: 'Use when imported goods over AUD 1,000 are cleared into home consumption and a paper import declaration is lodged at an ABF counter. Fill before customs clearance, usually with your customs broker, then submit through ICS or at an ABF counter as required.'
  },
  {
    category: 'Import / Export',
    title: 'ABF Export Declaration - B957',
    authority: 'Australian Border Force',
    requirement_type: 'Original export form',
    status: 'review_required',
    official_link: 'https://www.abf.gov.au/form-listing/forms/b957.pdf',
    notes: 'Use for export consignments where an export declaration is required. Fill before goods leave Australia, one declaration per consignment, then lodge electronically through ICS or at an ABF counter if paper lodgement is permitted.'
  },
  {
    category: 'Import / Export',
    title: 'Export declaration guidance',
    authority: 'Australian Border Force',
    requirement_type: 'Submission guidance',
    status: 'review_required',
    official_link: 'https://www.abf.gov.au/importing-exporting-and-manufacturing/exporting/how-to-export/export-declaration',
    notes: 'Use this guidance before export dispatch to confirm when B957 is required, how to lodge it, and what export evidence must be kept for audit.'
  },
  {
    category: 'Council / Local',
    title: 'Local council approval and site compliance',
    authority: 'Local council',
    requirement_type: 'Council record',
    status: 'review_required',
    official_link: '',
    notes: 'Store planning approvals, waste, signage, operating hours, fire safety, trade waste and inspection records for your site.'
  },
  {
    category: 'Council / Local',
    title: 'NSW Development Application record',
    authority: 'Service NSW / NSW Planning Portal',
    requirement_type: 'Council planning application',
    status: 'review_required',
    official_link: 'https://www.service.nsw.gov.au/transaction/apply-for-a-development-application',
    notes: 'Use before construction, change of use, building works or site changes. Discuss requirements with council first, then lodge online through the NSW Planning Portal with plans, owner consent, environmental effects and fee payment.'
  },
  {
    category: 'Environment / Safety',
    title: 'NSW EPA licence check',
    authority: 'NSW EPA',
    requirement_type: 'Environmental licence check',
    status: 'review_required',
    official_link: 'https://www.epa.nsw.gov.au/licensing-and-regulation/licensing',
    notes: 'Check whether your processes, chemicals, waste, emissions, radiation or dangerous goods activities need EPA licensing.'
  },
  {
    category: 'Environment / Safety',
    title: 'Hazardous chemical register template',
    authority: 'Safe Work Australia',
    requirement_type: 'Original WHS template',
    status: 'review_required',
    official_link: 'https://www.safeworkaustralia.gov.au/system/files/documents/1909/hazardous_chemical_register_template.pdf',
    notes: 'Use if chemicals, resins, solvents, adhesives, gases or dangerous goods are stored or used. Fill when a hazardous chemical is first introduced and update whenever chemicals or SDS details change. Keep onsite for workers and inspectors.'
  },
  {
    category: 'Quality / Process Sheet',
    title: 'Job process sheet and traceability record',
    authority: 'Internal QA',
    requirement_type: 'Mandatory job record',
    status: 'active',
    official_link: '',
    process_sheet_required: 1,
    notes: 'Attach the completed process sheet for every production job requiring traceability, inspection, batch, material and approval evidence.'
  }
];

async function ensureComplianceTables() {
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

  for (const entry of DEFAULT_ENTRIES) {
    const [existing] = await pool.query(
      'SELECT id FROM compliance_entries WHERE category = ? AND title = ? AND deleted = 0 LIMIT 1',
      [entry.category, entry.title]
    );

    if (!existing.length) {
      await pool.query(
        `
        INSERT INTO compliance_entries
        (category, title, authority, requirement_type, status, official_link, process_sheet_required, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          entry.category,
          entry.title,
          entry.authority,
          entry.requirement_type,
          entry.status,
          entry.official_link,
          entry.process_sheet_required ? 1 : 0,
          entry.notes
        ]
      );
    }
  }
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
      ORDER BY e.category ASC, e.title ASC
    `);

    const [files] = await pool.query(`
      SELECT cf.*, u.name AS uploaded_by_name
      FROM compliance_files cf
      LEFT JOIN users u ON u.id = cf.uploaded_by
      WHERE cf.deleted = 0
      ORDER BY cf.created_at DESC
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
        files: filesByEntry[String(entry.id)] || []
      }))
    });
  } catch (error) {
    console.error('getComplianceEntries error:', error);
    res.status(500).json({ message: 'Failed to load compliance register', error: error.message });
  }
};

exports.saveComplianceEntry = async (req, res) => {
  try {
    await ensureComplianceTables();

    const id = Number(req.body.id || 0);
    const category = String(req.body.category || '').trim();
    const title = String(req.body.title || '').trim();
    const authority = String(req.body.authority || '').trim();
    const requirementType = String(req.body.requirement_type || '').trim();
    const status = String(req.body.status || 'review_required').trim();
    const dueDate = req.body.due_date || null;
    const renewalDate = req.body.renewal_date || null;
    const officialLink = String(req.body.official_link || '').trim();
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
    res.status(500).json({ message: 'Failed to save compliance entry', error: error.message });
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
      (entry_id, file_label, file_type, original_name, file_path, mime_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [entryId, fileLabel, fileType, req.file.originalname, `/uploads/compliance/${req.file.filename}`, req.file.mimetype, req.user.id]
    );

    res.json({ message: 'Compliance file uploaded successfully', file_id: result.insertId });
  } catch (error) {
    console.error('saveComplianceFile error:', error);
    res.status(500).json({ message: 'Failed to upload compliance file', error: error.message });
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

    const filePath = rows[0]?.file_path ? path.join(__dirname, '..', rows[0].file_path.replace(/^\//, '')) : '';
    if (filePath && filePath.includes(`${path.sep}uploads${path.sep}compliance${path.sep}`)) {
      fs.unlink(filePath, () => {});
    }

    res.json({ message: 'Compliance file deleted successfully' });
  } catch (error) {
    console.error('deleteComplianceFile error:', error);
    res.status(500).json({ message: 'Failed to delete compliance file', error: error.message });
  }
};
