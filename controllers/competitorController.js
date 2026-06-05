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
  },
  {
    company_name: 'Zeal 3D',
    category: 'Australian 3D Printing Service Bureau',
    country: 'Australia',
    city: 'Melbourne',
    website: 'https://www.zeal3dprinting.com.au/',
    capabilities: '3D printing, CNC machining, vacuum casting, injection molding, laser cutting and product development',
    materials: 'Plastics, resins, metals and engineering materials',
    target_market: 'Australian engineering, product development and manufacturing customers',
    strength: 'Broad local service offer across additive and traditional manufacturing',
    source_type: 'researched_seed',
    source_url: 'https://www.zeal3dprinting.com.au/',
    notes: 'Track as an Australian competitor with wide service categories and local manufacturing positioning.'
  },
  {
    company_name: 'Objective3D',
    category: 'Australian Additive Manufacturing',
    country: 'Australia',
    city: 'Melbourne',
    website: 'https://www.objective3d.com.au/',
    capabilities: '3D printing bureau, additive manufacturing systems, prototyping and production services',
    materials: 'Polymer 3D printing materials and industrial additive materials',
    target_market: 'Industrial, design, product development and manufacturing teams',
    strength: 'Australian 3D printing bureau plus additive technology provider',
    source_type: 'researched_seed',
    source_url: 'https://www.objective3d.com.au/',
    notes: 'Track for service bureau positioning, machine ecosystem and local additive manufacturing market.'
  },
  {
    company_name: 'Titomic',
    category: 'Metal Additive Manufacturing',
    country: 'Australia / Global',
    city: 'Melbourne',
    website: 'https://www.titomic.com/',
    capabilities: 'Cold spray additive manufacturing, metal coatings, repair and production systems',
    materials: 'Titanium, metals and specialist cold spray materials',
    target_market: 'Aerospace, defence, industrial repair, tooling and metal manufacturing',
    strength: 'Specialised metal additive technology and advanced manufacturing focus',
    source_type: 'researched_seed',
    source_url: 'https://www.titomic.com/',
    notes: 'Track as an advanced metal additive company rather than a general bureau.'
  },
  {
    company_name: 'FATHOM',
    category: 'US Advanced Manufacturing',
    country: 'United States',
    city: 'Hartland, WI',
    website: 'https://fathommfg.com/',
    capabilities: 'Additive manufacturing, CNC machining, injection molding, sheet metal and advanced manufacturing',
    materials: 'Production plastics, metals and additive materials',
    target_market: 'Industrial, aerospace, medical, product development and production customers',
    strength: 'Large US digital manufacturing and additive production provider',
    source_type: 'researched_seed',
    source_url: 'https://fathommfg.com/',
    notes: 'Track for advanced manufacturing positioning and large-scale capability breadth.'
  },
  {
    company_name: '3D Systems On Demand',
    category: 'Global Additive Manufacturing',
    country: 'United States / Global',
    city: 'Rock Hill, SC',
    website: 'https://www.3dsystems.com/on-demand-manufacturing',
    capabilities: 'On-demand manufacturing, 3D printing, prototyping and production parts',
    materials: 'Plastics, metals and additive manufacturing materials',
    target_market: 'Engineering, healthcare, aerospace, automotive and industrial buyers',
    strength: 'Major additive manufacturing company with hardware, materials and services',
    source_type: 'researched_seed',
    source_url: 'https://www.3dsystems.com/on-demand-manufacturing',
    notes: 'Track for industrial 3D printing service language and application categories.'
  },
  {
    company_name: 'Stratasys Direct',
    category: 'Global Additive Manufacturing',
    country: 'United States / Global',
    city: 'United States',
    website: 'https://www.stratasys.com/en/stratasysdirect/',
    capabilities: '3D printing services, prototyping, production parts and additive manufacturing support',
    materials: 'FDM, PolyJet, stereolithography, nylon, resin and production materials',
    target_market: 'Product teams, engineers, industrial production and additive manufacturing users',
    strength: 'Service arm connected to a major additive manufacturing technology provider',
    source_type: 'researched_seed',
    source_url: 'https://www.stratasys.com/en/stratasysdirect/',
    notes: 'Track for additive service communication, materials and industry examples.'
  },
  {
    company_name: 'Weerg',
    category: 'European Online Manufacturing',
    country: 'Italy / Europe',
    city: 'Venice area',
    website: 'https://www.weerg.com/',
    capabilities: 'Online CNC machining and 3D printing',
    materials: 'Metals, plastics, nylon, resins and engineering materials',
    target_market: 'European engineers, designers and manufacturers ordering parts online',
    strength: 'Online manufacturing quote/order model in Europe',
    source_type: 'researched_seed',
    source_url: 'https://www.weerg.com/',
    notes: 'Track for online quoting, CNC plus 3D printing bundling and European market approach.'
  },
  {
    company_name: '3DPRINTUK',
    category: 'European 3D Printing Service Bureau',
    country: 'United Kingdom',
    city: 'London',
    website: 'https://www.3dprint-uk.co.uk/',
    capabilities: 'SLS and MJF 3D printing, batch production and post-processing',
    materials: 'Nylon PA12 and polymer powder-bed materials',
    target_market: 'UK and European product developers, engineers and production buyers',
    strength: 'Specialist polymer 3D printing service bureau',
    source_type: 'researched_seed',
    source_url: 'https://www.3dprint-uk.co.uk/',
    notes: 'Track for focused service messaging, pricing model and batch production communication.'
  },
  {
    company_name: 'FIT Additive Manufacturing Group',
    category: 'European Additive Manufacturing',
    country: 'Germany',
    city: 'Lupburg',
    website: 'https://fit.technology/',
    capabilities: 'Additive manufacturing, engineering, industrial 3D printing and production support',
    materials: 'Industrial polymer and metal additive materials',
    target_market: 'Industrial, aerospace, medical and production manufacturing customers',
    strength: 'Industrial additive manufacturing group with engineering capability',
    source_type: 'researched_seed',
    source_url: 'https://fit.technology/',
    notes: 'Track for European industrial additive positioning and production-grade messaging.'
  },
  {
    company_name: '1zu1',
    category: 'European Prototyping Service Bureau',
    country: 'Austria',
    city: 'Dornbirn',
    website: 'https://www.1zu1.eu/',
    capabilities: 'Prototypes, additive manufacturing, injection molding, vacuum casting and rapid tooling',
    materials: 'Plastics, resins and prototyping materials',
    target_market: 'European product developers and industrial manufacturers',
    strength: 'Prototyping and small-series manufacturing specialisation',
    source_type: 'researched_seed',
    source_url: 'https://www.1zu1.eu/',
    notes: 'Track for high-quality prototyping process, quality messaging and European service depth.'
  },
  {
    company_name: 'Laser Prototype Europe',
    category: 'European 3D Printing Service Bureau',
    country: 'Northern Ireland / Europe',
    city: 'Belfast area',
    website: 'https://www.laserproto.com/',
    capabilities: 'SLS, SLA, CNC machining, vacuum casting and rapid prototyping',
    materials: 'Nylon, resins, polymers and prototype materials',
    target_market: 'Product design, engineering and manufacturing customers',
    strength: 'Long-running rapid prototyping and 3D printing service bureau',
    source_type: 'researched_seed',
    source_url: 'https://www.laserproto.com/',
    notes: 'Track for rapid prototyping categories and European bureau positioning.'
  },
  {
    company_name: 'RapidDirect',
    category: 'Asian Online Manufacturing',
    country: 'China / Global',
    city: 'Shenzhen',
    website: 'https://www.rapiddirect.com/',
    capabilities: 'CNC machining, sheet metal, 3D printing, injection molding and rapid prototyping',
    materials: 'Metals, plastics and manufacturing-grade materials',
    target_market: 'Global customers sourcing prototypes and production parts from China',
    strength: 'Online manufacturing platform with China-based production network',
    source_type: 'researched_seed',
    source_url: 'https://www.rapiddirect.com/',
    notes: 'Track for price-positioning, manufacturing categories and online quote flow.'
  },
  {
    company_name: 'HLH Prototypes',
    category: 'Asian Prototyping Manufacturer',
    country: 'China / Global',
    city: 'Shenzhen',
    website: 'https://www.hlhprototypes.com/',
    capabilities: 'CNC machining, 3D printing, vacuum casting, injection molding and rapid tooling',
    materials: 'Metals, plastics, resins and prototyping materials',
    target_market: 'Global product development, prototype and low-volume manufacturing buyers',
    strength: 'China-based rapid prototyping and low-volume production provider',
    source_type: 'researched_seed',
    source_url: 'https://www.hlhprototypes.com/',
    notes: 'Track for low-volume production positioning and overseas manufacturing offer.'
  },
  {
    company_name: 'Star Rapid',
    category: 'Asian Prototyping Manufacturer',
    country: 'China / Global',
    city: 'Zhongshan',
    website: 'https://www.starrapid.com/',
    capabilities: 'CNC machining, plastic injection molding, metal 3D printing, vacuum casting and finishing',
    materials: 'Metals, plastics and production materials',
    target_market: 'International engineering and product development customers',
    strength: 'High-quality China-based manufacturing and prototyping service',
    source_type: 'researched_seed',
    source_url: 'https://www.starrapid.com/',
    notes: 'Track for quality messaging, international customer approach and process breadth.'
  },
  {
    company_name: 'WayKen',
    category: 'Asian Prototyping Manufacturer',
    country: 'China / Global',
    city: 'Shenzhen',
    website: 'https://waykenrm.com/',
    capabilities: 'CNC machining, rapid prototyping, injection molding, sheet metal and finishing',
    materials: 'Metals, plastics and engineering materials',
    target_market: 'Product development, automotive, medical, consumer and industrial buyers',
    strength: 'Rapid prototyping and precision manufacturing offer',
    source_type: 'researched_seed',
    source_url: 'https://waykenrm.com/',
    notes: 'Track for prototype sales copy, process presentation and overseas manufacturing categories.'
  },
  {
    company_name: 'Wenext',
    category: 'Asian Online Manufacturing',
    country: 'China / Global',
    city: 'Shenzhen',
    website: 'https://www.wenext.com/',
    capabilities: '3D printing, CNC machining, vacuum casting and injection molding services',
    materials: 'Resins, nylon, metals, plastics and prototyping materials',
    target_market: 'Engineers and product teams ordering custom parts online',
    strength: 'Online manufacturing marketplace model from China',
    source_type: 'researched_seed',
    source_url: 'https://www.wenext.com/',
    notes: 'Track for online order flow, category breadth and China-based custom part pricing.'
  },
  {
    company_name: 'JLC3DP',
    category: 'Asian Online Manufacturing',
    country: 'China / Global',
    city: 'Shenzhen',
    website: 'https://jlc3dp.com/',
    capabilities: 'Online 3D printing and related manufacturing services',
    materials: 'Resin, nylon, metal and 3D printing materials',
    target_market: 'Global makers, engineers and product developers',
    strength: 'Online 3D printing linked to large electronics/manufacturing ecosystem',
    source_type: 'researched_seed',
    source_url: 'https://jlc3dp.com/',
    notes: 'Track for low-cost online 3D print ordering and customer upload workflow.'
  },
  {
    company_name: 'PCBWay',
    category: 'Asian Online Manufacturing',
    country: 'China / Global',
    city: 'Shenzhen',
    website: 'https://www.pcbway.com/',
    capabilities: 'PCB fabrication, CNC machining, 3D printing, sheet metal and injection molding',
    materials: 'Electronics, plastics, metals and custom manufacturing materials',
    target_market: 'Electronics, engineering, prototyping and maker customers',
    strength: 'Large online manufacturing platform with PCB and mechanical part services',
    source_type: 'researched_seed',
    source_url: 'https://www.pcbway.com/',
    notes: 'Track for cross-selling PCB and mechanical manufacturing services.'
  },
  {
    company_name: 'Imaginarium',
    category: 'Indian Additive Manufacturing',
    country: 'India',
    city: 'Mumbai',
    website: 'https://www.imaginarium.io/',
    capabilities: '3D printing, additive manufacturing, rapid prototyping and production solutions',
    materials: 'Polymers, resins, metals and specialist AM materials',
    target_market: 'Jewellery, healthcare, industrial, product development and manufacturing customers',
    strength: 'Established Indian additive manufacturing and prototyping company',
    source_type: 'researched_seed',
    source_url: 'https://www.imaginarium.io/',
    notes: 'Track for India market approach and additive manufacturing service positioning.'
  },
  {
    company_name: 'think3D',
    category: 'Indian 3D Printing Service Bureau',
    country: 'India',
    city: 'Hyderabad',
    website: 'https://www.think3d.in/',
    capabilities: '3D printing, 3D scanning, design, prototyping and manufacturing services',
    materials: 'Plastics, resins, metals and 3D printing materials',
    target_market: 'Indian product developers, engineering teams, medical and industrial customers',
    strength: 'Broad Indian 3D printing and prototyping services',
    source_type: 'researched_seed',
    source_url: 'https://www.think3d.in/',
    notes: 'Track for Indian service bureau categories and training/resource positioning.'
  },
  {
    company_name: 'Objectify Technologies',
    category: 'Indian Additive Manufacturing',
    country: 'India',
    city: 'Noida',
    website: 'https://www.objectify.co.in/',
    capabilities: 'Industrial 3D printing, rapid prototyping, additive manufacturing and production parts',
    materials: 'Polymer and metal additive materials',
    target_market: 'Automotive, aerospace, medical, industrial and product development customers',
    strength: 'Industrial additive manufacturing service provider in India',
    source_type: 'researched_seed',
    source_url: 'https://www.objectify.co.in/',
    notes: 'Track for industrial AM market positioning and India-based production service.'
  },
  {
    company_name: 'Immensa',
    category: 'Middle East Digital Manufacturing',
    country: 'United Arab Emirates / Saudi Arabia',
    city: 'Dubai / Dammam',
    website: 'https://immensa.io/',
    capabilities: 'Digital manufacturing, additive manufacturing, spare parts digitisation and industrial production',
    materials: 'Industrial polymers, metals and AM spare-part materials',
    target_market: 'Energy, industrial, oil and gas, utilities and spare-part supply chain customers',
    strength: 'Middle East digital manufacturing and additive spare-parts focus',
    source_type: 'researched_seed',
    source_url: 'https://immensa.io/',
    notes: 'Track for regulated industrial sectors, spare-parts digitisation and digital inventory messaging.'
  },
  {
    company_name: 'Proto21',
    category: 'Middle East 3D Printing Service Bureau',
    country: 'United Arab Emirates',
    city: 'Dubai',
    website: 'https://proto21.ae/',
    capabilities: '3D printing, rapid prototyping, architectural models and product development support',
    materials: 'Polymers, resins and 3D printing materials',
    target_market: 'UAE businesses, designers, engineers and product developers',
    strength: 'Dubai-based 3D printing and prototyping service',
    source_type: 'researched_seed',
    source_url: 'https://proto21.ae/',
    notes: 'Track for Middle East bureau positioning and local business presentation.'
  },
  {
    company_name: 'Rapid 3D',
    category: 'African Additive Manufacturing',
    country: 'South Africa',
    city: 'Johannesburg / Cape Town',
    website: 'https://rapid3d.co.za/',
    capabilities: '3D printing, additive manufacturing systems, scanning and industrial services',
    materials: 'Polymer and metal additive manufacturing materials',
    target_market: 'South African industrial, engineering and product development customers',
    strength: 'African additive manufacturing service and technology provider',
    source_type: 'researched_seed',
    source_url: 'https://rapid3d.co.za/',
    notes: 'Track for South African additive market positioning and regional service categories.'
  },
  {
    company_name: '3DGBIRE',
    category: 'UK Additive Manufacturing Provider',
    country: 'United Kingdom / Ireland',
    city: 'Chorley',
    website: 'https://3dgbire.com/',
    capabilities: '3D printing equipment, materials, training, bureau services and additive support',
    materials: 'Industrial 3D printing filaments, polymers and AM materials',
    target_market: 'Education, engineering, manufacturing and additive users',
    strength: 'UK and Ireland additive manufacturing ecosystem provider',
    source_type: 'researched_seed',
    source_url: 'https://3dgbire.com/',
    notes: 'Track for equipment-plus-service model and additive support/training language.'
  },
  {
    company_name: '3ERP',
    category: 'Asian Prototyping Manufacturer',
    country: 'China / Global',
    city: 'Zhongshan',
    website: 'https://www.3erp.com/',
    capabilities: 'CNC machining, rapid prototyping, 3D printing, urethane casting and injection molding',
    materials: 'Metals, plastics and engineering-grade materials',
    target_market: 'Global engineering, prototype and low-volume production customers',
    strength: 'Custom prototype and low-volume manufacturing from China',
    source_type: 'researched_seed',
    source_url: 'https://www.3erp.com/',
    notes: 'Track for service category breadth, lead-time messaging and China export manufacturing model.'
  },
  {
    company_name: 'Makenica',
    category: 'Indian Manufacturing Marketplace',
    country: 'India',
    city: 'Bengaluru',
    website: 'https://makenica.com/',
    capabilities: '3D printing, CNC machining, vacuum casting, injection molding and fabrication',
    materials: 'Plastics, resins, metals and engineering materials',
    target_market: 'Indian startups, engineers, product teams and manufacturers',
    strength: 'Online manufacturing platform model in India',
    source_type: 'researched_seed',
    source_url: 'https://makenica.com/',
    notes: 'Track for India online manufacturing customer flow and service packaging.'
  },
  {
    company_name: 'FacFox',
    category: 'Asian Online 3D Printing Service',
    country: 'China / Global',
    city: 'Hangzhou',
    website: 'https://facfox.com/',
    capabilities: 'Online 3D printing, CNC machining, mold making and custom manufacturing',
    materials: 'Metals, plastics, resins, ceramics and additive manufacturing materials',
    target_market: 'Global custom manufacturing and 3D printing buyers',
    strength: 'Broad online material and manufacturing options',
    source_type: 'researched_seed',
    source_url: 'https://facfox.com/',
    notes: 'Track for material catalogue, quoting content and global custom manufacturing positioning.'
  },
  {
    company_name: 'MakerVerse',
    category: 'European Manufacturing Marketplace',
    country: 'Germany / Europe',
    city: 'Berlin',
    website: 'https://www.makerverse.ai/',
    capabilities: 'On-demand manufacturing platform, CNC machining, additive manufacturing and industrial parts',
    materials: 'Metals, polymers and industrial manufacturing materials',
    target_market: 'Industrial companies, procurement teams and engineering buyers',
    strength: 'European digital manufacturing platform with industrial focus',
    source_type: 'researched_seed',
    source_url: 'https://www.makerverse.ai/',
    notes: 'Track for European manufacturing platform language and industrial customer focus.'
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
      ORDER BY c.id ASC
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
