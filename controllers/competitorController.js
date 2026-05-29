const pool = require('../config/db');

const SEED_COMPETITORS = [
  {
    company_name: 'Formero',
    category: 'Australian 3D Printing Service Bureau',
    country: 'Australia',
    city: 'Melbourne / Sydney',
    website: 'https://formero.com.au/',
    capabilities: '3D printing, traditional manufacturing, contract manufacturing, metal 3D printing',
    materials: 'Polymers, resins, metals, production materials',
    target_market: 'Product development, engineering, industrial prototypes and production parts',
    strength: 'Large Australian 3D printing and manufacturing service provider',
    source_type: 'researched_seed',
    source_url: 'https://formero.com.au/',
    notes: 'Track as a local benchmark for additive manufacturing, quoting, service categories and production presentation.'
  },
  {
    company_name: 'Xometry',
    category: 'Global Manufacturing Marketplace',
    country: 'United States / Global',
    city: 'North Bethesda, MD',
    website: 'https://www.xometry.com/',
    capabilities: 'CNC machining, 3D printing, sheet metal fabrication, injection molding, die casting',
    materials: 'Metals, plastics, elastomers and industrial production materials',
    target_market: 'Engineers, procurement teams, prototype and production buyers',
    strength: 'Global supplier network and instant quoting marketplace',
    source_type: 'researched_seed',
    source_url: 'https://www.xometry.com/',
    notes: 'Useful benchmark for online quoting flow, manufacturing categories and marketplace positioning.'
  },
  {
    company_name: 'Materialise',
    category: 'Global Additive Manufacturing',
    country: 'Belgium / Global',
    city: 'Leuven',
    website: 'https://www.materialise.com/',
    capabilities: 'Industrial 3D printing services, additive manufacturing software, medical and industrial manufacturing',
    materials: 'Engineering polymers, metal AM materials and specialist 3D printing materials',
    target_market: 'Industrial, medical, product development and serial manufacturing',
    strength: 'Deep additive manufacturing knowledge, software plus service ecosystem',
    source_type: 'researched_seed',
    source_url: 'https://www.materialise.com/',
    notes: 'Track for quality systems, software-led manufacturing and industrial 3D printing service positioning.'
  },
  {
    company_name: 'Protolabs',
    category: 'Rapid Manufacturing',
    country: 'United States / Global',
    city: 'Maple Plain, MN',
    website: 'https://www.protolabs.com/',
    capabilities: '3D printing, CNC machining, injection molding, sheet metal and rapid prototyping',
    materials: 'Industrial plastics, metals, production polymers and prototyping materials',
    target_market: 'Fast prototype, low-volume and production manufacturing customers',
    strength: 'Speed-focused digital manufacturing and rapid production services',
    source_type: 'researched_seed',
    source_url: 'https://www.protolabs.com/',
    notes: 'Benchmark for professional invoice/order language, quoting speed and process breadth.'
  },
  {
    company_name: 'Protolabs Network',
    category: 'On-Demand Manufacturing Network',
    country: 'Global',
    city: 'Distributed network',
    website: 'https://www.hubs.com/',
    capabilities: 'CNC machining, 3D printing, injection molding, sheet metal fabrication',
    materials: 'Wide custom manufacturing material catalogue',
    target_market: 'Custom parts, product teams and engineering buyers',
    strength: 'Distributed partner network for custom part manufacturing',
    source_type: 'researched_seed',
    source_url: 'https://www.hubs.com/',
    notes: 'Track for service packaging, design-for-manufacturing content and manufacturing network UX.'
  },
  {
    company_name: 'Fictiv',
    category: 'Digital Manufacturing Platform',
    country: 'United States / Global',
    city: 'San Francisco, CA',
    website: 'https://www.fictiv.com/',
    capabilities: 'CNC machining, 3D printing, injection molding, urethane casting, mechanical parts',
    materials: 'Metals, plastics and production-grade materials',
    target_market: 'Hardware, engineering and supply chain teams',
    strength: 'Digital manufacturing platform and supplier network model',
    source_type: 'researched_seed',
    source_url: 'https://www.fictiv.com/',
    notes: 'Useful for comparing engineering customer experience and supplier quality messaging.'
  },
  {
    company_name: 'Quickparts',
    category: 'Custom Manufacturing',
    country: 'United States / Global',
    city: 'Global facilities',
    website: 'https://quickparts.com/',
    capabilities: '3D printing, CNC machining, injection molding and cast urethane',
    materials: 'Plastics, metals, elastomers and production materials',
    target_market: 'Prototype and custom production parts',
    strength: 'Broad custom manufacturing offer with production support',
    source_type: 'researched_seed',
    source_url: 'https://quickparts.com/',
    notes: 'Track service breadth, quotation structure and global manufacturing positioning.'
  },
  {
    company_name: 'Sculpteo',
    category: 'Online 3D Printing Service',
    country: 'France / Global',
    city: 'Paris',
    website: 'https://www.sculpteo.com/',
    capabilities: 'Online 3D printing, laser cutting, design resources and production support',
    materials: 'Nylon, resin, metals and specialist 3D printing materials',
    target_market: 'Designers, engineers, startups and manufacturing buyers',
    strength: 'Online 3D printing ordering and material catalogue',
    source_type: 'researched_seed',
    source_url: 'https://www.sculpteo.com/',
    notes: 'Benchmark for online catalogue, material pages and customer-facing technical guidance.'
  }
];

async function ensureCompetitorTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_name VARCHAR(180) NOT NULL,
      category VARCHAR(160) NULL,
      country VARCHAR(120) NULL,
      city VARCHAR(140) NULL,
      website TEXT NULL,
      capabilities TEXT NULL,
      materials TEXT NULL,
      target_market TEXT NULL,
      strength TEXT NULL,
      source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
      source_url TEXT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`ALTER TABLE competitors ADD COLUMN category VARCHAR(160) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN country VARCHAR(120) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN city VARCHAR(140) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN website TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN capabilities TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN materials TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN target_market TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN strength TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN source_type VARCHAR(80) NOT NULL DEFAULT 'manual'`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN source_url TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN notes TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN created_by INT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN updated_by INT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE competitors ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});
}

async function seedCompetitors(userId) {
  await ensureCompetitorTable();

  let inserted = 0;
  for (const competitor of SEED_COMPETITORS) {
    const [existing] = await pool.query(
      'SELECT id FROM competitors WHERE LOWER(company_name) = LOWER(?) AND deleted = 0 LIMIT 1',
      [competitor.company_name]
    );

    if (existing.length) continue;

    await pool.query(
      `
      INSERT INTO competitors
      (company_name, category, country, city, website, capabilities, materials, target_market,
       strength, source_type, source_url, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        competitor.company_name,
        competitor.category,
        competitor.country,
        competitor.city,
        competitor.website,
        competitor.capabilities,
        competitor.materials,
        competitor.target_market,
        competitor.strength,
        competitor.source_type,
        competitor.source_url,
        competitor.notes,
        userId || null
      ]
    );
    inserted += 1;
  }

  return inserted;
}

exports.getCompetitors = async (req, res) => {
  try {
    await ensureCompetitorTable();

    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM competitors WHERE deleted = 0');
    if (Number(countRows[0]?.total || 0) === 0) {
      await seedCompetitors(req.user?.id);
    }

    const [rows] = await pool.query(`
      SELECT
        c.*,
        cu.name AS created_by_name,
        uu.name AS updated_by_name
      FROM competitors c
      LEFT JOIN users cu ON cu.id = c.created_by
      LEFT JOIN users uu ON uu.id = c.updated_by
      WHERE c.deleted = 0
      ORDER BY c.category ASC, c.company_name ASC
    `);

    res.json({ competitors: rows });
  } catch (error) {
    console.error('getCompetitors error:', error);
    res.status(500).json({ message: 'Failed to load competitors', error: error.message });
  }
};

exports.seedIndustryCompetitors = async (req, res) => {
  try {
    const inserted = await seedCompetitors(req.user?.id);
    res.json({ message: inserted ? `Added ${inserted} researched industry records` : 'Industry records are already loaded', inserted });
  } catch (error) {
    console.error('seedIndustryCompetitors error:', error);
    res.status(500).json({ message: 'Failed to load researched competitors', error: error.message });
  }
};

exports.saveCompetitor = async (req, res) => {
  try {
    await ensureCompetitorTable();

    const id = Number(req.body.id || 0);
    const companyName = String(req.body.company_name || '').trim();
    const category = String(req.body.category || '').trim();
    const country = String(req.body.country || '').trim();
    const city = String(req.body.city || '').trim();
    const website = String(req.body.website || '').trim();
    const capabilities = String(req.body.capabilities || '').trim();
    const materials = String(req.body.materials || '').trim();
    const targetMarket = String(req.body.target_market || '').trim();
    const strength = String(req.body.strength || '').trim();
    const sourceType = String(req.body.source_type || 'manual').trim() || 'manual';
    const sourceUrl = String(req.body.source_url || '').trim();
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
    res.status(500).json({ message: 'Failed to save competitor', error: error.message });
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
    res.status(500).json({ message: 'Failed to delete competitor', error: error.message });
  }
};
