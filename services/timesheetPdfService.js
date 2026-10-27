'use strict';
const { snapshotHash } = require('./weeklyTimesheetEligibility');
const { timesheetDocumentData } = require('./timesheetDocumentService');
const { createDocumentPdf, deriveDocumentContentProof, validatePdf, safePdfFilename, DOCUMENT_LAYOUT_VERSION } = require('./documentPdfService');
const objectStorage = require('./objectStorageService');

function invalid(message, code = 'TIMESHEET_PDF_SNAPSHOT_INVALID') {
  return Object.assign(new Error(message), { statusCode: 409, code });
}
function sourceKey(snapshot) {
  const { generated_at, ...source } = snapshot;
  return snapshotHash({ layout_version: DOCUMENT_LAYOUT_VERSION, source });
}
function documentData(snapshot) {
  return timesheetDocumentData({ rows: snapshot.rows, fromDate: snapshot.period_start, toDate: snapshot.period_end,
    staffName: snapshot.staff_name, employeeReference: snapshot.employee_reference, staffId: snapshot.staff_id,
    totalHours: snapshot.total_minutes / 60, totalMinutes: snapshot.total_minutes, status: snapshot.review_status,
    timezone: snapshot.timezone, version: snapshot.version, generatedAt: snapshot.generated_at, approvedHours: snapshot.approved_hours });
}
async function freezeSnapshot(db, snapshot) {
  const key = sourceKey(snapshot), data = documentData(snapshot);
  // A source version is inserted once. Concurrent app downloads and scheduled
  // email generation converge on this exact timestamp, model and PDF bytes.
  await db.query(`INSERT INTO timesheet_pdf_snapshots
    (source_key,user_id,period_start,period_end,version_no,layout_version,snapshot_json,document_json)
    VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_key=VALUES(source_key)`,
  [key, snapshot.staff_id, snapshot.period_start, snapshot.period_end, snapshot.version, DOCUMENT_LAYOUT_VERSION, JSON.stringify(snapshot), JSON.stringify(data)]);
  // A current locking read sees a concurrent winner even when the caller's
  // REPEATABLE READ transaction already read attendance before this insert.
  const [[stored]] = await db.query('SELECT snapshot_json,document_json FROM timesheet_pdf_snapshots WHERE source_key=? FOR UPDATE', [key]);
  let frozen;
  try { frozen = JSON.parse(stored.snapshot_json); } catch { throw invalid('The saved timesheet document snapshot cannot be read.'); }
  if (sourceKey(frozen) !== key || JSON.stringify(documentData(frozen)) !== stored.document_json) throw invalid('The saved timesheet source does not match its document version.');
  return frozen;
}
async function snapshotArtifact(db, snapshot, retainedAttachment = null, storage = objectStorage) {
  const key = sourceKey(snapshot);
  const [[stored]] = await db.query('SELECT * FROM timesheet_pdf_snapshots WHERE source_key=?', [key]);
  if (!stored || stored.snapshot_json !== JSON.stringify(snapshot)) throw invalid('The timesheet PDF does not match its frozen source.');
  const data = documentData(snapshot);
  if (stored.document_json !== JSON.stringify(data)) throw invalid('The saved timesheet model does not match its source.');
  const proof = await deriveDocumentContentProof(data);
  async function verify(buffer, filename, expectedHash) {
    const validation = await validatePdf(buffer, { documentProof: proof });
    if (filename !== safePdfFilename(data.filename) || (expectedHash && validation.sha256 !== expectedHash)) throw invalid('The saved timesheet PDF bytes or filename do not match this version.');
    return { buffer, filename, validation, sha256: validation.sha256, contentProof: proof };
  }
  async function load(row) {
    if (!/^timesheet-pdfs\/[a-f0-9]{64}\/[a-f0-9]{64}\.pdf$/.test(String(row.pdf_object_key)) || row.pdf_object_key !== `timesheet-pdfs/${key}/${row.pdf_sha256}.pdf`) throw invalid('The saved timesheet PDF storage identity is invalid.');
    const artifact = await verify(await storage.getObject(row.pdf_object_key), row.pdf_filename, row.pdf_sha256);
    if (artifact.buffer.length !== Number(row.pdf_bytes_count)) throw invalid('The saved timesheet PDF size does not match this version.');
    return artifact;
  }
  let uploadedKey;
  try {
    const retained = retainedAttachment ? await verify(retainedAttachment.content, retainedAttachment.filename, retainedAttachment.sha256) : null;
    if (stored.pdf_object_key) {
      const cached = await load(stored);
      if (retained && !cached.buffer.equals(retained.buffer)) throw invalid('The app PDF differs from the already retained email attachment. Review the document version before retrying.');
      return cached;
    }
    const artifact = retained || await createDocumentPdf(data);
    // Private, existing Railway object storage holds bytes. MySQL holds only
    // immutable source/hash/key metadata; no extra PDF BLOB or container copy.
    // Content-addressed keys prevent overlapping producers overwriting a
    // different valid PDF before the atomic database winner is selected.
    uploadedKey = `timesheet-pdfs/${key}/${artifact.validation.sha256}.pdf`;
    await storage.putObject(uploadedKey, artifact.buffer, 'application/pdf');
    await verify(await storage.getObject(uploadedKey), artifact.filename, artifact.validation.sha256);
    await db.query(`UPDATE timesheet_pdf_snapshots SET pdf_object_key=?,pdf_sha256=?,pdf_filename=?,pdf_pages=?,pdf_bytes_count=?,generation_status='VALIDATED',last_error_code=NULL
      WHERE source_key=? AND pdf_object_key IS NULL`, [uploadedKey, artifact.validation.sha256, artifact.filename, artifact.validation.pages, artifact.buffer.length, key]);
    const [[saved]] = await db.query('SELECT pdf_object_key,pdf_sha256,pdf_filename,pdf_bytes_count FROM timesheet_pdf_snapshots WHERE source_key=?', [key]);
    if (saved.pdf_object_key !== uploadedKey) await storage.deleteObject(uploadedKey).catch(() => {});
    const winner = await load(saved);
    if (retained && !winner.buffer.equals(retained.buffer)) throw invalid('The winning app PDF differs from the already retained email attachment. Review the document version before retrying.');
    return winner;
  } catch (failure) {
    // Never replace an established artifact or pretend generation succeeded.
    // Retain an actionable code; the same source can be retried safely.
    await db.query(`UPDATE timesheet_pdf_snapshots SET generation_status='GENERATION_FAILED',last_error_code=? WHERE source_key=? AND pdf_object_key IS NULL`, [String(failure.code || 'TIMESHEET_PDF_STORAGE_FAILED').slice(0,100), key]);
    if (String(failure.code || '').startsWith('OBJECT_STORAGE_')) {
      failure.statusCode = 503;
      failure.message = 'Private timesheet PDF storage is unavailable. The document request is retained; no alternative file or email was sent. Retry after storage is restored.';
    }
    throw failure;
  }
}
module.exports = { sourceKey, documentData, freezeSnapshot, snapshotArtifact };
