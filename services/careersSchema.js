const pool = require('../config/db');

let schemaPromise;

const JOBS = [
  {
    slug: 'business-development-technical-sales-engineer',
    title: 'Business Development & Technical Sales Engineer',
    department: 'Sales & Business Development',
    location: 'Melbourne, VIC',
    employment_type: 'Full-time',
    openings: 1,
    summary: 'Develop qualified B2B opportunities for Voxel Veda engineering and advanced manufacturing services.',
    responsibilities: [
      'Identify prospective B2B customers across manufacturing and engineering sectors.',
      'Develop relationships with engineering companies, OEMs, startups, universities and R&D teams.',
      'Understand customer drawings, specifications and project requirements.',
      'Coordinate technical enquiries with the engineering team.',
      'Prepare proposals, quotations and follow-ups.',
      'Maintain the sales pipeline and CRM.',
      'Develop strategic partnerships and supplier relationships.',
      'Support tenders and larger commercial opportunities.',
      'Attend industry exhibitions, networking events and customer meetings.',
      'Track conversion rates, pipeline value and revenue opportunities.'
    ],
    requirements: [
      'Engineering, manufacturing or technical-commercial background.',
      'Strong B2B communication and negotiation skills.',
      'Ability to understand technical products and engineering requirements.',
      'Strong written and verbal communication.',
      'Australian working rights.'
    ],
    preferred: ['Additive manufacturing','Manufacturing services','CAD','Industrial equipment','Robotics','Engineering sales']
  },
  {
    slug: 'mechanical-product-design-engineer',
    title: 'Mechanical / Product Design Engineer',
    department: 'Engineering',
    location: 'Melbourne, VIC',
    employment_type: 'Full-time',
    openings: 1,
    summary: 'Support concept development, CAD modelling, prototyping, DfAM and manufacturing preparation.',
    responsibilities: [
      'Develop 3D CAD models and engineering assemblies.',
      'Convert concepts into manufacturable designs.',
      'Prepare engineering drawings and production documentation.',
      'Apply Design for Additive Manufacturing principles.',
      'Review fit, tolerance, assembly and functional requirements.',
      'Support prototyping and design iterations.',
      'Work with additive manufacturing and conventional production processes.',
      'Maintain revision-controlled technical files.',
      'Collaborate with customers during development projects.',
      'Support design verification and technical reviews.'
    ],
    requirements: [
      'Mechanical Engineering, Product Design, Mechatronics or related qualification.',
      'Strong 3D CAD capability.',
      'Understanding of manufacturing processes.',
      'Good engineering documentation practices.',
      'Strong problem-solving capability.'
    ],
    preferred: ['SolidWorks','Autodesk Fusion','Inventor','AutoCAD','Revit','Mesh and reverse-engineering software']
  },
  {
    slug: 'additive-manufacturing-technician',
    title: 'Additive Manufacturing Technician',
    department: 'Manufacturing',
    location: 'Melbourne, VIC',
    employment_type: 'Full-time',
    openings: 1,
    summary: 'Operate and maintain additive-manufacturing workflows from incoming production files through printing, inspection and post-processing.',
    responsibilities: [
      'Prepare manufacturing files for production.',
      'Operate additive-manufacturing equipment.',
      'Perform slicing and build preparation.',
      'Select appropriate manufacturing parameters.',
      'Monitor production jobs.',
      'Perform routine machine maintenance.',
      'Conduct post-processing and finishing.',
      'Perform dimensional and visual inspection.',
      'Record machine, material and batch information.',
      'Identify printing defects and troubleshoot failures.',
      'Maintain clean and controlled production areas.',
      'Support prototype and low-volume manufacturing work.'
    ],
    requirements: [
      'Practical experience with 3D printing or digital manufacturing.',
      'Understanding of common engineering materials.',
      'Experience with slicing software.',
      'Strong attention to detail.',
      'Ability to follow controlled manufacturing procedures.',
      'Basic dimensional inspection skills.'
    ],
    preferred: ['Engineering-grade FDM/FFF systems','Industrial prototyping']
  },
  {
    slug: 'cad-reverse-engineering-technician',
    title: 'CAD & Reverse Engineering Technician',
    department: 'Engineering',
    location: 'Melbourne, VIC',
    employment_type: 'Full-time',
    openings: 1,
    summary: 'Support reverse engineering, CAD reconstruction and technical drawing workflows.',
    responsibilities: [
      'Measure and document existing physical components.',
      'Support 3D scanning and data capture.',
      'Clean and process scan data.',
      'Convert meshes and reference geometry into usable CAD models.',
      'Produce manufacturing drawings.',
      'Reconstruct discontinued or legacy components where appropriate.',
      'Perform dimensional comparisons.',
      'Maintain controlled CAD revisions.',
      'Prepare files for prototyping and manufacturing.',
      'Work closely with engineering and production personnel.'
    ],
    requirements: [
      'Strong CAD capability and technical drawing literacy.',
      'Understanding of reverse-engineering workflows.',
      'Strong dimensional accuracy and attention to detail.'
    ],
    preferred: ['SolidWorks','Fusion','AutoCAD','Geomagic or equivalent','3D scanning','GD&T','Dimensional inspection']
  },
  {
    slug: 'quality-document-control-coordinator',
    title: 'Quality & Document Control Coordinator',
    department: 'Quality',
    location: 'Melbourne, VIC / Hybrid where suitable',
    employment_type: 'Part-time / Contract initially',
    openings: 1,
    summary: 'Help establish and maintain controlled engineering and manufacturing documentation as Voxel Veda expands.',
    responsibilities: [
      'Maintain controlled procedures, forms and records.',
      'Manage document numbers, revisions and approvals.',
      'Support implementation and maintenance of the Quality Management System.',
      'Maintain supplier and production quality records.',
      'Support NCR and CAPA processes.',
      'Maintain calibration and inspection records.',
      'Assist with internal audits.',
      'Support material and manufacturing traceability.',
      'Help prepare the organisation for future quality certifications.',
      'Maintain training and competency records.'
    ],
    requirements: ['Knowledge of quality-management principles and controlled documentation.'],
    preferred: ['ISO 9001','Engineering manufacturing','Aerospace','Defence','Medical','Automotive or regulated manufacturing']
  },
  {
    slug: 'marketing-growth-specialist-engineering-manufacturing',
    title: 'Marketing & Growth Specialist — Engineering & Manufacturing',
    department: 'Marketing',
    location: 'Melbourne / Hybrid',
    employment_type: 'Part-time / Contract initially',
    openings: 1,
    summary: 'Turn Voxel Veda engineering capabilities into qualified business opportunities through technical B2B marketing.',
    responsibilities: [
      'Develop technical marketing campaigns.',
      'Manage LinkedIn and selected social channels.',
      'Produce engineering-focused content.',
      'Develop case studies and capability material.',
      'Improve website conversion paths.',
      'Support SEO and search visibility.',
      'Develop targeted B2B outreach campaigns.',
      'Support email campaigns.',
      'Analyse website and campaign performance.',
      'Translate technical capabilities into accurate customer-facing material.'
    ],
    requirements: [
      'Experience in B2B or technical marketing.',
      'Strong written communication.',
      'Understanding of digital marketing and analytics.',
      'Ability to work with technical subject matter.'
    ],
    preferred: ['Engineering marketing','Manufacturing marketing','Industrial technology marketing']
  }
];

async function createCareersSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS career_jobs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(180) NOT NULL,
      title VARCHAR(220) NOT NULL,
      department VARCHAR(120) NOT NULL,
      location VARCHAR(180) NOT NULL,
      employment_type VARCHAR(100) NOT NULL,
      openings INT NOT NULL DEFAULT 1,
      summary TEXT NOT NULL,
      responsibilities_json LONGTEXT NOT NULL,
      requirements_json LONGTEXT NOT NULL,
      preferred_json LONGTEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      published_at DATETIME NULL,
      closes_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_career_job_slug (slug),
      INDEX idx_career_jobs_status (status, published_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS career_applications (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      public_id CHAR(36) NOT NULL,
      job_id BIGINT NOT NULL,
      full_name VARCHAR(180) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(80) NOT NULL,
      current_location VARCHAR(180) NULL,
      work_rights VARCHAR(120) NOT NULL,
      availability VARCHAR(120) NULL,
      expected_remuneration VARCHAR(120) NULL,
      linkedin_url VARCHAR(500) NULL,
      portfolio_url VARCHAR(500) NULL,
      cover_note TEXT NULL,
      resume_document_id CHAR(36) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'NEW',
      source VARCHAR(80) NOT NULL DEFAULT 'CAREERS_PORTAL',
      consent_version VARCHAR(40) NOT NULL DEFAULT '2026-09',
      consent_at DATETIME NOT NULL,
      ip_hash CHAR(64) NULL,
      user_agent VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_career_application_public_id (public_id),
      INDEX idx_career_application_job_status (job_id, status, created_at),
      INDEX idx_career_application_email (email, created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS career_application_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      application_id BIGINT NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NULL,
      note TEXT NULL,
      actor_user_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_career_events_application (application_id, created_at)
    )
  `);

  for (const job of JOBS) {
    await pool.query(
      `INSERT INTO career_jobs
       (slug,title,department,location,employment_type,openings,summary,responsibilities_json,requirements_json,preferred_json,status,published_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'OPEN', NOW())
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), department=VALUES(department), location=VALUES(location),
         employment_type=VALUES(employment_type), openings=VALUES(openings), summary=VALUES(summary),
         responsibilities_json=VALUES(responsibilities_json), requirements_json=VALUES(requirements_json),
         preferred_json=VALUES(preferred_json)`,
      [job.slug, job.title, job.department, job.location, job.employment_type, job.openings, job.summary,
       JSON.stringify(job.responsibilities), JSON.stringify(job.requirements), JSON.stringify(job.preferred)]
    );
  }
}

async function ensureCareersSchema() {
  if (!schemaPromise) {
    schemaPromise = createCareersSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureCareersSchema };
