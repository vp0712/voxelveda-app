const crypto = require('crypto');
const fs = require('fs');
const pool = require('../config/db');
const { ensureCareersSchema } = require('../services/careersSchema');
const { registerDocument } = require('../services/documentSecurityService');

const VALID_STATUSES = new Set(['NEW','SCREENING','SHORTLISTED','INTERVIEW','TECHNICAL_ASSESSMENT','REFERENCE_CHECK','OFFER','HIRED','REJECTED','TALENT_POOL']);

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseJson(value) {
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function publicJob(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    department: row.department,
    location: row.location,
    employment_type: row.employment_type,
    openings: Number(row.openings || 1),
    summary: row.summary,
    responsibilities: parseJson(row.responsibilities_json),
    requirements: parseJson(row.requirements_json),
    preferred: parseJson(row.preferred_json),
    closes_at: row.closes_at
  };
}

async function listPublicJobs(req, res) {
  await ensureCareersSchema();
  const [rows] = await pool.query(
    `SELECT * FROM career_jobs
     WHERE status='OPEN' AND (closes_at IS NULL OR closes_at >= CURDATE())
     ORDER BY FIELD(department,'Sales & Business Development','Engineering','Manufacturing','Quality','Marketing'), id`
  );
  return res.json({ jobs: rows.map(publicJob) });
}

async function getPublicJob(req, res) {
  await ensureCareersSchema();
  const [[row]] = await pool.query(
    `SELECT * FROM career_jobs WHERE slug=? AND status='OPEN' AND (closes_at IS NULL OR closes_at >= CURDATE()) LIMIT 1`,
    [clean(req.params.slug, 180)]
  );
  if (!row) return res.status(404).json({ message: 'Vacancy not found or no longer open.' });
  return res.json({ job: publicJob(row) });
}

async function removeFile(file) {
  if (file?.path) await fs.promises.unlink(file.path).catch(() => {});
}

async function submitApplication(req, res) {
  await ensureCareersSchema();
  const body = req.body || {};
  const honeypot = clean(body.company_website, 200);
  if (honeypot) {
    await removeFile(req.file);
    return res.status(202).json({ message: 'Application received.' });
  }

  const fullName = clean(body.full_name, 180);
  const email = clean(body.email, 255).toLowerCase();
  const phone = clean(body.phone, 80);
  const workRights = clean(body.work_rights, 120);
  const consent = ['1','true','yes','on'].includes(clean(body.consent, 10).toLowerCase());
  const slug = clean(body.job_slug, 180);

  if (!fullName || !email || !phone || !workRights || !slug || !consent) {
    await removeFile(req.file);
    return res.status(400).json({ message: 'Complete all required fields and accept the applicant privacy consent.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await removeFile(req.file);
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (!req.file) return res.status(400).json({ message: 'Please attach your CV/resume as a PDF or Word document.' });

  const [[job]] = await pool.query(
    `SELECT id,title FROM career_jobs WHERE slug=? AND status='OPEN' AND (closes_at IS NULL OR closes_at >= CURDATE()) LIMIT 1`,
    [slug]
  );
  if (!job) {
    await removeFile(req.file);
    return res.status(404).json({ message: 'This vacancy is no longer accepting applications.' });
  }

  const [[recent]] = await pool.query(
    `SELECT id FROM career_applications
     WHERE job_id=? AND email=? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
     LIMIT 1`,
    [job.id, email]
  );
  if (recent) {
    await removeFile(req.file);
    return res.status(409).json({ message: 'An application for this role was recently submitted with this email address.' });
  }

  const publicId = crypto.randomUUID();
  const ip = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex') : null;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [result] = await db.query(
      `INSERT INTO career_applications
       (public_id,job_id,full_name,email,phone,current_location,work_rights,availability,expected_remuneration,
        linkedin_url,portfolio_url,cover_note,status,consent_at,ip_hash,user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'NEW', NOW(), ?, ?)`,
      [publicId, job.id, fullName, email, phone, clean(body.current_location,180) || null, workRights,
       clean(body.availability,120) || null, clean(body.expected_remuneration,120) || null,
       clean(body.linkedin_url,500) || null, clean(body.portfolio_url,500) || null,
       clean(body.cover_note,4000) || null, ipHash, clean(req.headers['user-agent'],500) || null]
    );
    await db.query(
      `INSERT INTO career_application_events (application_id,event_type,to_status,note)
       VALUES (?, 'APPLICATION_SUBMITTED', 'NEW', 'Application submitted through careers portal')`,
      [result.insertId]
    );
    await db.commit();

    const document = await registerDocument({
      module: 'careers',
      recordType: 'career_application',
      recordId: result.insertId,
      uploadedBy: null,
      file: req.file,
      classification: 'CONFIDENTIAL'
    });
    await pool.query('UPDATE career_applications SET resume_document_id=? WHERE id=?', [document.id, result.insertId]);

    return res.status(201).json({
      message: 'Application submitted successfully.',
      application_id: publicId,
      role: job.title,
      status: 'NEW'
    });
  } catch (error) {
    await db.rollback().catch(() => {});
    await removeFile(req.file);
    throw error;
  } finally {
    db.release();
  }
}

async function listApplications(req, res) {
  await ensureCareersSchema();
  const status = clean(req.query.status, 40).toUpperCase();
  const department = clean(req.query.department, 120);
  const search = clean(req.query.search, 160);
  const where = [];
  const params = [];
  if (status && VALID_STATUSES.has(status)) { where.push('a.status=?'); params.push(status); }
  if (department) { where.push('j.department=?'); params.push(department); }
  if (search) {
    where.push('(a.full_name LIKE ? OR a.email LIKE ? OR j.title LIKE ?)');
    const like = `%${search}%`; params.push(like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT a.id,a.public_id,a.full_name,a.email,a.phone,a.current_location,a.work_rights,a.availability,
            a.expected_remuneration,a.linkedin_url,a.portfolio_url,a.cover_note,a.resume_document_id,
            a.status,a.created_at,a.updated_at,j.title AS job_title,j.department,j.location
     FROM career_applications a
     JOIN career_jobs j ON j.id=a.job_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.created_at DESC
     LIMIT 500`,
    params
  );
  return res.json({ applications: rows });
}

async function updateApplicationStatus(req, res) {
  await ensureCareersSchema();
  const id = Number(req.params.id);
  const nextStatus = clean(req.body?.status, 40).toUpperCase();
  const note = clean(req.body?.note, 2000) || null;
  if (!Number.isInteger(id) || id <= 0 || !VALID_STATUSES.has(nextStatus)) {
    return res.status(400).json({ message: 'Invalid application or pipeline status.' });
  }
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[row]] = await db.query('SELECT status FROM career_applications WHERE id=? FOR UPDATE', [id]);
    if (!row) {
      await db.rollback();
      return res.status(404).json({ message: 'Application not found.' });
    }
    await db.query('UPDATE career_applications SET status=? WHERE id=?', [nextStatus, id]);
    await db.query(
      `INSERT INTO career_application_events
       (application_id,event_type,from_status,to_status,note,actor_user_id)
       VALUES (?, 'STATUS_CHANGED', ?, ?, ?, ?)`,
      [id, row.status, nextStatus, note, req.user?.id || null]
    );
    await db.commit();
    return res.json({ message: 'Application status updated.', id, status: nextStatus });
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function listAdminJobs(req, res) {
  await ensureCareersSchema();
  const [rows] = await pool.query(
    `SELECT j.*,
      (SELECT COUNT(*) FROM career_applications a WHERE a.job_id=j.id) AS application_count,
      (SELECT COUNT(*) FROM career_applications a WHERE a.job_id=j.id AND a.status NOT IN ('REJECTED','HIRED')) AS active_candidates
     FROM career_jobs j ORDER BY j.id`
  );
  return res.json({ jobs: rows.map((row) => ({ ...publicJob(row), status: row.status, application_count: Number(row.application_count), active_candidates: Number(row.active_candidates), published_at: row.published_at })) });
}

async function setJobStatus(req, res) {
  await ensureCareersSchema();
  const id = Number(req.params.id);
  const status = clean(req.body?.status, 30).toUpperCase();
  if (!Number.isInteger(id) || id <= 0 || !['OPEN','PAUSED','CLOSED'].includes(status)) {
    return res.status(400).json({ message: 'Invalid job status.' });
  }
  const [result] = await pool.query(
    `UPDATE career_jobs SET status=?, published_at=CASE WHEN ?='OPEN' AND published_at IS NULL THEN NOW() ELSE published_at END WHERE id=?`,
    [status, status, id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Job not found.' });
  return res.json({ message: 'Vacancy status updated.', id, status });
}

module.exports = {
  getPublicJob,
  listAdminJobs,
  listApplications,
  listPublicJobs,
  setJobStatus,
  submitApplication,
  updateApplicationStatus
};
