'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DateTime } = require('luxon');
const renderer = require('../services/weeklyTimesheetEmailService');

function fixtureSnapshot(kind = 'single') {
  const common = { staff_id: 31, staff_name: 'Fixture Staff A', employee_reference: 'FIXTURE-A', period_start: '2026-09-28', period_end: '2026-10-04',
    timezone: 'Australia/Sydney', version: 1, generated_at: '2026-10-04T20:00:00.000Z', review_status: 'DRAFT', approval_verified: false };
  const row = { id: 901, user_id: 31, name: common.staff_name, work_date: '2026-10-01', clock_in: '2026-10-01T22:00:00+10:00', clock_out: '2026-10-02T06:30:00+10:00',
    timestamp_basis: 'UTC', recorded_timezone: common.timezone, entry_source: 'CLOCK', total_minutes: 480, total_hours: 8, break_minutes: 30, project: 'Fixture overnight site' };
  if (kind === 'dst') return { ...common, total_minutes: 60, rows: [{ ...row, work_date: '2026-10-04', clock_in: '2026-10-04T01:30:00+10:00', clock_out: '2026-10-04T03:30:00+11:00', total_minutes: 60, total_hours: 1, break_minutes: 0, project: 'Fixture DST site' }] };
  if (kind === 'adjusted') return { ...common, version: 2, review_status: 'APPROVED', approval_verified: true, approved_hours: 7.5, total_minutes: 480, rows: [row] };
  if (kind === 'long') {
    const beginning = DateTime.fromISO('2026-10-01T00:00:00', { zone: common.timezone });
    const rows = Array.from({ length: 40 }, (_, index) => { const start = beginning.plus({ hours: index }); return { ...row, id: 901 + index, work_date: start.toISODate(), clock_in: start.toISO(), clock_out: start.plus({ hours: 1 }).toISO(), total_minutes: 60, total_hours: 1, break_minutes: index % 2 ? 0 : null, project: `Fixture job ${index + 1} — long reference and source-controlled work description` }; });
    return { ...common, staff_name: 'Fixture Staff A with a long employee name', employee_reference: 'FIXTURE-A-LONG-REFERENCE', total_minutes: 2400, rows: rows.map(entry => ({ ...entry, name: 'Fixture Staff A with a long employee name' })) };
  }
  return { ...common, total_minutes: 960, rows: [row, { ...row, id: 902, work_date: '2026-10-02', clock_in: '2026-10-02T22:00:00+10:00', clock_out: '2026-10-03T06:00:00+10:00', break_minutes: null, project: '' }] };
}
function main() {
  const source = fixtureSnapshot(), immutable = JSON.stringify(source);
  const report = renderer.renderWeeklyTimesheetEmail(source);
  assert.equal(report.format, 'HTML'); assert.equal(report.layoutVersion, 'weekly-html-v1');
  assert.equal(JSON.stringify(source), immutable, 'Rendering never modifies saved attendance');
  assert.deepEqual(renderer.renderWeeklyTimesheetEmail(source), report, 'Same frozen source renders byte-identical content');
  assert.equal(report.contentHash, renderer.contentHashFor(report));
  assert.equal(renderer.assertWeeklyTimesheetEmailContent(report, report.contentHash).contentHash, report.contentHash);
  for (const text of ['Fixture Staff A', 'FIXTURE-A', 'Australia/Sydney', '16.00 (16h 00m)', 'Not recorded', '30 min', 'Provisional — Draft', '1 Oct 2026', '4 Oct 2026']) {
    assert(report.html.includes(text), 'HTML report contains ' + text); assert(report.text.includes(text), 'Text alternative contains ' + text);
  }
  assert.match(report.html, /https:\/\/app\.voxelveda\.com\/logo\.png/);
  assert.match(report.html, /alt="Voxel Veda"/); assert.match(report.text, /Voxel Veda Pty Ltd/);
  assert.match(report.html, /@media screen and \(max-width:600px\)/);
  assert.match(report.html, /scope="col"/); assert.match(report.html, /class="mobile-label"/);
  assert.doesNotMatch(report.html, /<script|<iframe|<form|cid:|data:image|\.tmp|PDF is attached|PDF attached|page \d+ of|Staff B|FIXTURE-B/i);
  assert.equal(Object.hasOwn(report, 'attachments'), false, 'HTML weekly report has no implicit attachment');
  const dst = renderer.renderWeeklyTimesheetEmail(fixtureSnapshot('dst'));
  assert.match(dst.text, /01:30 (?:AEST|GMT\+10)/); assert.match(dst.text, /03:30 (?:AEDT|GMT\+11)/); assert.match(dst.text, /1.00 \(1h 00m\)/); assert.match(dst.text, /Break: 0 min/);
  const adjusted = renderer.renderWeeklyTimesheetEmail(fixtureSnapshot('adjusted'));
  assert.match(adjusted.html, /TIMESHEET — REVISION/); assert.match(adjusted.text, /Approved hours: 7.50 \(7h 30m\)/); assert.match(adjusted.text, /Weekly recorded hours: 8.00 \(8h 00m\)/);
  assert.match(adjusted.text, /Timesheet status: Approved/); assert.match(adjusted.text, /Report version 2 is an authorised corrected report/);
  const routinelyApproved = renderer.renderWeeklyTimesheetEmail({ ...fixtureSnapshot(), review_status: 'APPROVED', approval_verified: true });
  assert.match(routinelyApproved.text, /Approved hours: 16.00 \(16h 00m\)/, 'Routine verified approval is distinct from recorded hours');
  const long = renderer.renderWeeklyTimesheetEmail(fixtureSnapshot('long'));
  assert.match(long.text, /Fixture job 40/); assert.match(long.text, /40.00 \(40h 00m\)/);
  const escaped = renderer.renderWeeklyTimesheetEmail({ ...source, rows: source.rows.map((row, index) => ({ ...row, project: index ? row.project : 'Inspect <script>alert("bad")</script> & retain "trace"' })) });
  assert.match(escaped.html, /&lt;script&gt;alert\(&quot;bad&quot;\)&lt;\/script&gt; &amp;/); assert.doesNotMatch(escaped.html, /<script>/); assert.match(escaped.text, /<script>alert\("bad"\)<\/script>/);
  const invalid = transform => assert.throws(() => renderer.renderWeeklyTimesheetEmail(transform(fixtureSnapshot())), error => /^(?:WEEKLY_HTML_|PDF_)/.test(error.code));
  invalid(s => ({ ...s, staff_id: 0 })); invalid(s => ({ ...s, staff_name: '' })); invalid(s => ({ ...s, rows: [] }));
  invalid(s => ({ ...s, total_minutes: 0 })); invalid(s => ({ ...s, total_minutes: 100 })); invalid(s => ({ ...s, period_start: '2026-09-29' }));
  invalid(s => ({ ...s, generated_at: '2026-10-01T00:00:00Z' })); invalid(s => ({ ...s, generated_at: '2026-10-05T07:00:00' }));
  invalid(s => ({ ...s, review_status: 'APPROVED' })); invalid(s => ({ ...s, approved_hours: 12 }));
  invalid(s => ({ ...s, rows: [{ ...s.rows[0], user_id: 32 }] })); invalid(s => ({ ...s, rows: [{ ...s.rows[0], name: 'Staff B' }] }));
  invalid(s => ({ ...s, rows: [s.rows[0], s.rows[0]] })); invalid(s => ({ ...s, rows: [{ ...s.rows[0], clock_out: null }] }));
  invalid(s => ({ ...s, rows: [{ ...s.rows[0], attendance_status: 'CANCELLED' }] })); invalid(s => ({ ...s, rows: [{ ...s.rows[0], review_required: 1 }] }));
  invalid(s => ({ ...s, rows: [{ ...s.rows[0], total_minutes: 470 }] })); invalid(s => ({ ...s, rows: [{ ...s.rows[0], clock_out: '2026-10-07T00:00:00Z' }] }));
  invalid(s => ({ ...s, rows: [{ ...s.rows[0], entry_source: 'MANUAL', clock_in: null, clock_out: null }] }));
  const manual = renderer.renderWeeklyTimesheetEmail({ ...source, total_minutes: 120, rows: [{ ...source.rows[0], entry_source: 'MANUAL', clock_in: null, clock_out: null, total_minutes: 120, total_hours: 2, break_minutes: null, manual_authorised_by: 99, manual_authorised_at: '2026-10-03T00:00:00Z' }] });
  assert.match(manual.text, /Weekly recorded hours: 2.00 \(2h 00m\)/); assert.match(manual.text, /Start: Not recorded/);
  invalid(s => ({ ...s, staff_name: 'Invalid\ud800name' }));
  assert.throws(() => renderer.assertWeeklyTimesheetEmailContent({ ...report, html: report.html.replace('FIXTURE-A', 'FIXTURE-B') }, report.contentHash), { code: 'WEEKLY_HTML_CONTENT_MISMATCH' });
  assert.throws(() => renderer.assertWeeklyTimesheetEmailContent({ ...report, subject: report.subject + '\nBcc: other@example.invalid' }), { code: 'WEEKLY_HTML_CONTENT_INVALID' });
  assert.throws(() => renderer.assertWeeklyTimesheetEmailContent({ ...report, html: '<script>unsafe</script>' }), { code: 'WEEKLY_HTML_CONTENT_INVALID' });
  assert.throws(() => renderer.assertWeeklyTimesheetEmailContent({ ...report, html: 'x'.repeat(renderer.MAX_HTML_BYTES + 1) }), { code: 'WEEKLY_HTML_CONTENT_INVALID' });
  const pdf = require('../services/documentPdfService'), oldGenerate = pdf.createDocumentPdf, oldValidate = pdf.validatePdf;
  try {
    pdf.createDocumentPdf = () => { throw new Error('Synthetic PDF generation failure'); };
    pdf.validatePdf = () => { throw new Error('Synthetic parser failure'); };
    assert.deepEqual(renderer.renderWeeklyTimesheetEmail(source), report, 'PDF generation/parser failure never blocks an HTML report');
  } finally { pdf.createDocumentPdf = oldGenerate; pdf.validatePdf = oldValidate; }
  const output = process.env.WEEKLY_HTML_PROOF_DIR || '/tmp/voxel-weekly-html-evidence'; fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const artifacts = [];
  for (const kind of ['single', 'dst', 'adjusted', 'long']) {
    const value = renderer.renderWeeklyTimesheetEmail(fixtureSnapshot(kind));
    fs.writeFileSync(path.join(output, kind + '.html'), value.html); fs.writeFileSync(path.join(output, kind + '.txt'), value.text);
    artifacts.push({ kind, contentHash: value.contentHash, layoutVersion: value.layoutVersion, htmlBytes: Buffer.byteLength(value.html), textBytes: Buffer.byteLength(value.text) });
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result: 'passed', scope: 'Synthetic individual worked-time fixtures; no email sent', pdfGenerationRequired: false, artifacts }, null, 2));
  console.log('Weekly HTML timesheet tests passed: immutable deterministic body/text, worked-only identity, all rows/totals, overnight/DST, recorded/zero/missing breaks, actual review/adjustment status, escaped inputs, tamper/size checks and PDF-independent rendering. No real email sent.');
}
if (require.main === module) { try { main(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { fixtureSnapshot };
