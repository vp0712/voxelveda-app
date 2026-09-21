const crypto = require('crypto');
const fs = require('fs');
const pool = require('../config/db');
const { ensureCareersSchema } = require('../services/careersSchema');
const { registerDocument } = require('../services/documentSecurityService');
const { queueEmail } = require('../services/emailQueue');

const VALID_STATUSES = new Set(['NEW','SCREENING','SHORTLISTED','INTERVIEW','TECHNICAL_ASSESSMENT','REFERENCE_CHECK','OFFER','HIRED','REJECTED','TALENT_POOL']);

function clean(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseJson(value) {
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function publicAppUrl() {
  return String(
    process.env.PUBLIC_APP_URL
      || process.env.APP_BASE_URL
      || 'https://voxelveda-app-production.up.railway.app'
  ).replace(/\/+$/, '');
}

async function addApplicationEvent(applicationId, eventType, note) {
  await pool.query(
    `INSERT INTO career_application_events (application_id,event_type,to_status,note)
     VALUES (?, ?, 'NEW', ?)`,
    [applicationId, eventType, clean(note, 2000)]
  );
}

async function queueApplicationEmails({ applicationId, publicId, job, applicant, resumeStatus }) {
  const notificationEmail = clean(process.env.CAREERS_NOTIFICATION_EMAIL || 'info@voxelveda.com', 255);
  const adminUrl = `${publicAppUrl()}/careers-admin`;
  const safeName = escapeHtml(applicant.fullName);
  const safeRole = escapeHtml(job.title);
  const safeReference = escapeHtml(publicId);
  const safeEmail = escapeHtml(applicant.email);
  const safePhone = escapeHtml(applicant.phone);
  const safeLocation = escapeHtml(applicant.currentLocation || 'Not supplied');
  const safeWorkRights = escapeHtml(applicant.workRights);
  const safeAvailability = escapeHtml(applicant.availability || 'Not supplied');
  const safeResumeStatus = escapeHtml(resumeStatus);

  let adminQueueId = null;
  let candidateQueueId = null;
  const queueFailures = [];
  try {
    adminQueueId = await queueEmail({
    templateKey: 'career_application_admin',
    to: notificationEmail,
    replyTo: applicant.email,
    subject: `New career application: ${job.title} — ${applicant.fullName}`,
    text: [
      'A new Voxel Veda career application has been received.',
      '',
      `Reference: ${publicId}`,
      `Role: ${job.title}`,
      `Applicant: ${applicant.fullName}`,
      `Email: ${applicant.email}`,
      `Phone: ${applicant.phone}`,
      `Current location: ${applicant.currentLocation || 'Not supplied'}`,
      `Work rights: ${applicant.workRights}`,
      `Availability: ${applicant.availability || 'Not supplied'}`,
      `Resume security status: ${resumeStatus}`,
      '',
      `Review securely: ${adminUrl}`,
      '',
      'The CV remains in the private recruitment system and is not attached to this email.'
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#102238">
        <div style="padding:24px;background:#071522;color:#fff;border-radius:16px 16px 0 0">
          <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#71e6f2">VOXEL VEDA PEOPLE OPERATIONS</div>
          <h1 style="margin:10px 0 0;font-size:26px">New career application</h1>
        </div>
        <div style="padding:24px;border:1px solid #dbe5ec;border-top:0;border-radius:0 0 16px 16px">
          <p><strong>${safeName}</strong> applied for <strong>${safeRole}</strong>.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#637487">Reference</td><td style="padding:8px 0"><strong>${safeReference}</strong></td></tr>
            <tr><td style="padding:8px 0;color:#637487">Email</td><td style="padding:8px 0">${safeEmail}</td></tr>
            <tr><td style="padding:8px 0;color:#637487">Phone</td><td style="padding:8px 0">${safePhone}</td></tr>
            <tr><td style="padding:8px 0;color:#637487">Location</td><td style="padding:8px 0">${safeLocation}</td></tr>
            <tr><td style="padding:8px 0;color:#637487">Work rights</td><td style="padding:8px 0">${safeWorkRights}</td></tr>
            <tr><td style="padding:8px 0;color:#637487">Availability</td><td style="padding:8px 0">${safeAvailability}</td></tr>
            <tr><td style="padding:8px 0;color:#637487">CV status</td><td style="padding:8px 0">${safeResumeStatus}</td></tr>
          </table>
          <p style="margin:24px 0 0"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#0e7490;color:#fff;text-decoration:none;font-weight:700">Review application securely</a></p>
          <p style="margin-top:18px;color:#637487;font-size:13px">The CV is retained in the private recruitment system and is not attached to this notification.</p>
        </div>
      </div>`,
    relatedModule: 'careers',
    relatedRecordId: applicationId,
      idempotencyKey: `career-application:${publicId}:admin`
    });
  } catch (error) {
    queueFailures.push(`recruitment:${clean(error.code || error.name || 'UNKNOWN', 120)}`);
  }

  try {
    candidateQueueId = await queueEmail({
      templateKey: 'career_application_candidate',
      to: applicant.email,
      replyTo: notificationEmail,
      subject: `We received your Voxel Veda application — ${job.title}`,
      text: [
        `Hello ${applicant.fullName},`,
        '',
        `Thank you for applying for ${job.title} at Voxel Veda.`,
        `Your application reference is ${publicId}.`,
        '',
        'Your application has been securely recorded. Our team will contact shortlisted applicants using the details supplied.',
        '',
        'Regards,',
        'Voxel Veda People Operations'
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#102238">
          <div style="padding:28px;background:#071522;color:#fff;border-radius:16px 16px 0 0">
            <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#71e6f2">VOXEL VEDA</div>
            <h1 style="margin:10px 0 0;font-size:28px">Application received</h1>
          </div>
          <div style="padding:28px;border:1px solid #dbe5ec;border-top:0;border-radius:0 0 16px 16px">
            <p>Hello ${safeName},</p>
            <p>Thank you for applying for <strong>${safeRole}</strong>. Your application has been securely recorded.</p>
            <div style="margin:22px 0;padding:18px;border-radius:12px;background:#eff8fb">
              <div style="font-size:12px;color:#637487;text-transform:uppercase;letter-spacing:.08em">Application reference</div>
              <strong style="display:block;margin-top:6px;font-size:20px;color:#0e7490">${safeReference}</strong>
            </div>
            <p>Our team will contact shortlisted applicants using the details supplied.</p>
            <p style="margin-top:26px">Regards,<br><strong>Voxel Veda People Operations</strong></p>
          </div>
        </div>`,
      relatedModule: 'careers',
      relatedRecordId: applicationId,
      idempotencyKey: `career-application:${publicId}:candidate`
    });
  } catch (error) {
    queueFailures.push(`candidate:${clean(error.code || error.name || 'UNKNOWN', 120)}`);
  }

  if (!adminQueueId && !candidateQueueId) {
    const error = new Error(`Career application emails could not be queued (${queueFailures.join(', ') || 'unknown error'})`);
    error.code = 'CAREER_EMAIL_QUEUE_FAILED';
    throw error;
  }

  await addApplicationEvent(
    applicationId,
    queueFailures.length ? 'APPLICATION_EMAIL_QUEUE_PARTIAL' : 'APPLICATION_EMAILS_QUEUED',
    [
      adminQueueId ? `Recruitment notification queued for ${notificationEmail}` : `Recruitment notification queue failed`,
      candidateQueueId ? `candidate confirmation queued for ${applicant.email}` : 'candidate confirmation queue failed',
      queueFailures.length ? `failures: ${queueFailures.join(', ')}` : ''
    ].filter(Boolean).join('; ')
  );

  return { adminQueueId, candidateQueueId, notificationEmail };
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
    `SELECT id,public_id,resume_document_id FROM career_applications
     WHERE job_id=? AND email=? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
     ORDER BY created_at DESC LIMIT 1`,
    [job.id, email]
  );
  if (recent?.resume_document_id) {
    await removeFile(req.file);
    return res.status(409).json({ message: 'An application for this role was recently submitted with this email address.' });
  }

  // A previous attempt may have saved the applicant record before secure CV registration failed.
  // Reuse that incomplete record so the candidate can retry without creating a duplicate.
  const publicId = recent?.public_id || crypto.randomUUID();
  const ip = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex') : null;
  const db = await pool.getConnection();
  let applicationId;
  try {
    await db.beginTransaction();
    if (recent) {
      applicationId = Number(recent.id);
      await db.query(
        `UPDATE career_applications
            SET full_name=?,phone=?,current_location=?,work_rights=?,availability=?,expected_remuneration=?,
                linkedin_url=?,portfolio_url=?,cover_note=?,status='NEW',consent_at=NOW(),ip_hash=?,user_agent=?
          WHERE id=? AND resume_document_id IS NULL`,
        [fullName, phone, clean(body.current_location,180) || null, workRights,
         clean(body.availability,120) || null, clean(body.expected_remuneration,120) || null,
         clean(body.linkedin_url,500) || null, clean(body.portfolio_url,500) || null,
         clean(body.cover_note,4000) || null, ipHash, clean(req.headers['user-agent'],500) || null,
         applicationId]
      );
    } else {
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
      applicationId = Number(result.insertId);
    }
    await db.query(
      `INSERT INTO career_application_events (application_id,event_type,to_status,note)
       VALUES (?, ?, 'NEW', ?)`,
      [applicationId, recent ? 'APPLICATION_RESUBMITTED' : 'APPLICATION_SUBMITTED',
       recent ? 'Candidate retried an incomplete application through careers portal' : 'Application submitted through careers portal']
    );
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    await removeFile(req.file);
    throw error;
  } finally {
    db.release();
  }

  let responseStatus = 201;
  let responseMessage = 'Thank you. Your application was submitted successfully.';
  let resumeStatus = 'PENDING_REGISTRATION';
  try {
    const document = await registerDocument({
      module: 'careers',
      recordType: 'career_application',
      recordId: applicationId,
      uploadedBy: null,
      file: req.file,
      classification: 'CONFIDENTIAL'
    });
    await pool.query('UPDATE career_applications SET resume_document_id=? WHERE id=?', [document.id, applicationId]);
    await pool.query(
      `INSERT INTO career_application_events (application_id,event_type,to_status,note)
       VALUES (?, 'RESUME_SECURED', 'NEW', 'Applicant CV registered as a confidential document')`,
      [applicationId]
    );
    resumeStatus = document.scan_status;
  } catch (error) {
    console.error('Career resume registration failed:', {
      applicationId,
      publicId,
      errorName: error.name,
      errorCode: error.code || null
    });
    await pool.query(
      `INSERT INTO career_application_events (application_id,event_type,to_status,note)
       VALUES (?, 'RESUME_REGISTRATION_FAILED', 'NEW', ?)`,
      [applicationId, `Secure CV registration failed: ${clean(error.code || error.name || 'UNKNOWN', 120)}`]
    ).catch(() => {});
    // The applicant record must remain available even when document processing is temporarily degraded.
    // Keeping the validated staged file permits operational recovery or a clean retry against this record.
    responseStatus = 202;
    responseMessage = 'Thank you. Your application details were recorded, but the CV is still being secured. Keep this reference; Voxel Veda can follow up if another copy is needed.';
  }

  const applicant = {
    fullName,
    email,
    phone,
    currentLocation: clean(body.current_location, 180),
    workRights,
    availability: clean(body.availability, 120)
  };
  let emailQueued = false;
  let confirmationQueued = false;
  try {
    const queued = await queueApplicationEmails({ applicationId, publicId, job, applicant, resumeStatus });
    emailQueued = Boolean(queued.adminQueueId);
    confirmationQueued = Boolean(queued.candidateQueueId);
  } catch (error) {
    console.error('Career application email queue failed:', {
      applicationId,
      publicId,
      errorName: error.name,
      errorCode: error.code || null
    });
    await addApplicationEvent(
      applicationId,
      'APPLICATION_EMAIL_QUEUE_FAILED',
      `Application remains saved; email queue failed: ${clean(error.code || error.name || 'UNKNOWN', 120)}`
    ).catch(() => {});
  }

  return res.status(responseStatus).json({
    message: responseMessage,
    application_id: publicId,
    role: job.title,
    status: 'NEW',
    resume_status: resumeStatus,
    recruitment_email_queued: emailQueued,
    applicant_confirmation_queued: confirmationQueued
  });
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
