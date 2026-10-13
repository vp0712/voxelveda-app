const pool = require('../config/db');

let schemaPromise;

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

  // Preserve existing vacancies; restoration does not create or overwrite business records.

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
