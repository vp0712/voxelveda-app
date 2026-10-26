const pool = require('../config/db');
const { assertOriginalRegisterSchema } = require('../services/originalRegisterSchema');
const { externalHttpUrl } = require('../utils/externalHttpUrl');

function ensureCompetitorTable() {
  return assertOriginalRegisterSchema('competitors', pool);
}

exports.getCompetitors = async (req, res) => {
  try {
    await ensureCompetitorTable();

    const [rows] = await pool.query(`
      SELECT
        c.*,
        cu.name AS created_by_name,
        uu.name AS updated_by_name
      FROM competitors c
      LEFT JOIN users cu ON cu.id = c.created_by
      LEFT JOIN users uu ON uu.id = c.updated_by
      WHERE c.deleted = 0
      ORDER BY c.id ASC
    `);

    res.json({ competitors: rows });
  } catch (error) {
    console.error('getCompetitors error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to load competitors', code: error.code });
  }
};

exports.seedIndustryCompetitors = (_req, res) => res.status(409).json({ code: 'EXPLICIT_IMPORT_REQUIRED', message: 'Add or import verified competitor records before they appear in this register.' });

exports.saveCompetitor = async (req, res) => {
  try {
    const website = externalHttpUrl(req.body.website, 'website');
    const sourceUrl = externalHttpUrl(req.body.source_url, 'source_url');
    await ensureCompetitorTable();

    const id = Number(req.body.id || 0);
    const companyName = String(req.body.company_name || '').trim();
    const category = String(req.body.category || '').trim();
    const country = String(req.body.country || '').trim();
    const city = String(req.body.city || '').trim();
    const capabilities = String(req.body.capabilities || '').trim();
    const materials = String(req.body.materials || '').trim();
    const targetMarket = String(req.body.target_market || '').trim();
    const strength = String(req.body.strength || '').trim();
    const sourceType = String(req.body.source_type || 'manual').trim() || 'manual';
    const notes = String(req.body.notes || '').trim();

    if (!companyName) return res.status(400).json({ message: 'Company name is required' });

    if (id) {
      const [result] = await pool.query(
        `
        UPDATE competitors
        SET company_name = ?, category = ?, country = ?, city = ?, website = ?, capabilities = ?,
            materials = ?, target_market = ?, strength = ?, source_type = ?, source_url = ?,
            notes = ?, updated_by = ?
        WHERE id = ? AND deleted = 0
        `,
        [companyName, category, country, city, website, capabilities, materials, targetMarket, strength, sourceType, sourceUrl, notes, req.user.id, id]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Competitor not found' });
      return res.json({ message: 'Competitor updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO competitors
      (company_name, category, country, city, website, capabilities, materials, target_market,
       strength, source_type, source_url, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [companyName, category, country, city, website, capabilities, materials, targetMarket, strength, sourceType, sourceUrl, notes, req.user.id]
    );

    res.json({ message: 'Competitor saved successfully', competitor_id: result.insertId });
  } catch (error) {
    console.error('saveCompetitor error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to save competitor', code: error.code, fields: error.fields });
  }
};

exports.deleteCompetitor = async (req, res) => {
  try {
    await ensureCompetitorTable();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Competitor ID is required' });

    const [result] = await pool.query(
      'UPDATE competitors SET deleted = 1, updated_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Competitor not found' });
    res.json({ message: 'Competitor deleted successfully' });
  } catch (error) {
    console.error('deleteCompetitor error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Failed to delete competitor', code: error.code });
  }
};
