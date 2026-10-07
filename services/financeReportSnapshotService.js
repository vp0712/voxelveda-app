'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const pool = require('../config/db');
const urls = require('../config/urls');
const privacy = require('./financePrivacyService');
const { encryptionKey } = require('./financeEncryptionService');
const { FinanceError } = require('./financeDomain');

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const CHUNK_BYTES = 192 * 1024;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function seal(bytes) {
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const content=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),content]);
}
function open(bytes) {
  if(bytes.length<29||bytes[0]!==1)throw new FinanceError('Saved report encryption format is unavailable.',503,'REPORT_CONTENT_UNAVAILABLE');
  const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(1,13));
  decipher.setAuthTag(bytes.subarray(13,29));
  return Buffer.concat([decipher.update(bytes.subarray(29)),decipher.final()]);
}
const reportPath = id => `/finance/reports/${encodeURIComponent(id)}/view`;
function viewUrl(id) {
  // The HTML viewer lives in the integrated app. The legacy PDF delivery origin
  // may point at another host and must not redirect new report-view links there.
  return new URL(reportPath(id), urls.app).toString();
}
function filename(report, extension) {
  const m = report.metadata;
  const type = String(m.report_type).replace(/[^A-Za-z0-9]+/g, '-');
  const currency = m.currency || 'Native-Currencies';
  return `Voxel-Veda-${type}-${m.from || 'All-History'}-to-${m.to || 'Latest'}-${currency}-${m.report_id}.${extension}`;
}
function descriptor(row) {
  const available = ['view', 'print', 'html', 'csv', 'xlsx'];
  if (row.pdf_status === 'READY') available.push('pdf');
  const pdf = row.pdf_metadata_json ? parse(row.pdf_metadata_json) : {};
  return {report_id:row.report_uid, view_url:viewUrl(row.report_uid), available_formats:available,
    pdf_status:row.pdf_status, pdf:{status:row.pdf_status,...pdf},
    email_outcome:row.email_outcome_json ? parse(row.email_outcome_json) : {status:'NOT_REQUESTED'}};
}
async function writeChunks(db, id, kind, bytes) {
  for (let index = 0; index < Math.ceil(bytes.length / CHUNK_BYTES); index += 1) {
    await db.query('INSERT INTO finance_report_snapshot_chunks (report_uid,artifact_kind,chunk_index,content) VALUES (?,?,?,?)',
      [id,kind,index,bytes.subarray(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES)]);
  }
}
async function readChunks(db, id, kind, count, byteSize, digest) {
  const [rows] = await db.query('SELECT chunk_index,content FROM finance_report_snapshot_chunks WHERE report_uid=? AND artifact_kind=? ORDER BY chunk_index',[id,kind]);
  if (rows.length !== Number(count) || rows.some((row,index)=>Number(row.chunk_index)!==index))
    throw new FinanceError('Saved report content is incomplete. Please contact support.',503,'REPORT_CONTENT_UNAVAILABLE');
  const bytes = Buffer.concat(rows.map(row=>Buffer.from(row.content)));
  if (bytes.length !== Number(byteSize) || hash(bytes) !== digest)
    throw new FinanceError('Saved report integrity check failed. Please contact support.',503,'REPORT_CONTENT_UNAVAILABLE');
  return bytes;
}
async function capture(req, report, profile) {
  const id = `RPT_${crypto.randomUUID()}`;
  // Copy before writing: subsequent renderer mutations cannot alter this snapshot.
  const saved = JSON.parse(JSON.stringify(report));
  saved.metadata.report_id = id;
  const accountIds = [...new Set([...(saved.coverage?.accounts || []).map(a=>Number(a.account_id)),
    ...(saved.transactions || []).map(t=>Number(t.bank_account_id)),...(saved.metadata.account_ids||[])]
    .filter(n=>Number.isInteger(n)&&n>0))];
  for (const accountId of accountIds) await privacy.assertAccountAccess(pool,accountId,req);
  const sourceCount = (saved.summary_by_currency || []).reduce((sum,row)=>sum+Number(row.source_transaction_count||0),0);
  if (sourceCount !== saved.transactions.length)
    throw new FinanceError('Report records changed during generation. Generate the report again.',409,'REPORT_DATA_CHANGED');
  const raw = Buffer.from(JSON.stringify({report:saved,profile}), 'utf8');
  if (raw.length > MAX_SNAPSHOT_BYTES)
    throw new FinanceError('This report is too large to save. Select a shorter period; no records have been dropped.',413,'REPORT_TOO_LARGE');
  const bytes = seal(await gzip(raw));
  const filters = Object.fromEntries(Object.entries(saved.metadata).filter(([key])=>
    ['report_type','scope','account_ids','from','to','currency','transaction_type','category','merchant','source','reconciliation_status','receipt_status','q'].includes(key)));
  const row = {report_uid:id,created_by:privacy.userId(req),report_type:saved.metadata.report_type,
    workspace_scope:saved.metadata.scope,metadata_json:saved.metadata,filters_json:filters,accounts_json:accountIds,
    summary_json:saved.summary_by_currency,snapshot_sha256:hash(bytes),snapshot_bytes:bytes.length,
    snapshot_chunks:Math.ceil(bytes.length/CHUNK_BYTES),pdf_status:'NOT_GENERATED',created_at:saved.metadata.generated_at};
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT INTO finance_report_snapshots
      (report_uid,created_by,report_type,workspace_scope,metadata_json,filters_json,accounts_json,summary_json,snapshot_sha256,snapshot_bytes,snapshot_chunks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id,row.created_by,row.report_type,row.workspace_scope,JSON.stringify(row.metadata_json),JSON.stringify(filters),JSON.stringify(accountIds),
        JSON.stringify(row.summary_json),row.snapshot_sha256,bytes.length,row.snapshot_chunks]);
    await writeChunks(db,id,'SNAPSHOT',bytes);
    await db.commit();
  } catch(error) { await db.rollback().catch(()=>{}); throw error; } finally { db.release(); }
  return {row,report:saved,profile,...descriptor(row)};
}
async function authorise(req, id) {
  const [[row]] = await pool.query('SELECT * FROM finance_report_snapshots WHERE report_uid=? AND created_by=? LIMIT 1',[String(id||''),privacy.userId(req)]);
  if (!row) throw new FinanceError('Report unavailable. It may not exist or you may not have access.',404,'REPORT_UNAVAILABLE');
  if (row.revoked_at) throw new FinanceError('This saved report has been revoked.',410,'REPORT_REVOKED');
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())
    throw new FinanceError('This saved report has expired.',410,'REPORT_EXPIRED');
  for (const accountId of parse(row.accounts_json)) await privacy.assertAccountAccess(pool,accountId,req);
  return row;
}
async function load(req, id) {
  const row = await authorise(req,id);
  const bytes = await readChunks(pool,row.report_uid,'SNAPSHOT',row.snapshot_chunks,row.snapshot_bytes,row.snapshot_sha256);
  const saved = JSON.parse((await gunzip(open(bytes),{maxOutputLength:MAX_SNAPSHOT_BYTES})).toString('utf8'));
  if (saved.report.metadata.report_id !== row.report_uid)
    throw new FinanceError('Saved report identity is invalid.',503,'REPORT_CONTENT_UNAVAILABLE');
  return {row,...saved,...descriptor(row)};
}
async function storePdf(id, artifact, validation) {
  const bytes = seal(artifact.buffer);
  const meta = {filename:artifact.filename,byte_length:artifact.buffer.length,sha256:hash(artifact.buffer),storage_sha256:hash(bytes),storage_bytes:bytes.length,pages:validation.pages,
    chunk_count:Math.ceil(bytes.length/CHUNK_BYTES),validation:'PARSED',created_at:new Date().toISOString()};
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // Serialize concurrent generation without touching immutable source chunks.
    await db.query('SELECT report_uid FROM finance_report_snapshots WHERE report_uid=? FOR UPDATE',[id]);
    await db.query("DELETE FROM finance_report_snapshot_chunks WHERE report_uid=? AND artifact_kind='PDF'",[id]);
    await writeChunks(db,id,'PDF',bytes);
    await db.query("UPDATE finance_report_snapshots SET pdf_status='READY',pdf_metadata_json=? WHERE report_uid=?",[JSON.stringify(meta),id]);
    await db.commit();
  } catch(error) { await db.rollback().catch(()=>{}); throw error; } finally { db.release(); }
  return meta;
}
async function pdfBytes(row) {
  const meta = parse(row.pdf_metadata_json);
  const bytes=open(await readChunks(pool,row.report_uid,'PDF',meta.chunk_count,meta.storage_bytes,meta.storage_sha256));
  if(bytes.length!==meta.byte_length||hash(bytes)!==meta.sha256)throw new FinanceError('Saved PDF integrity check failed.',503,'REPORT_CONTENT_UNAVAILABLE');
  return bytes;
}
async function pdfUnavailable(id,error) {
  const meta = {reason:String(error?.code||'PDF_GENERATION_FAILED'),message:'PDF is currently unavailable. View, Print, HTML, CSV and XLSX remain available.'};
  await pool.query("UPDATE finance_report_snapshots SET pdf_status='UNAVAILABLE',pdf_metadata_json=? WHERE report_uid=? AND pdf_status<>'READY'",[JSON.stringify(meta),id]);
  return meta;
}
async function recordEmail(id,outcome) {
  await pool.query('UPDATE finance_report_snapshots SET email_outcome_json=? WHERE report_uid=?',[JSON.stringify(outcome),id]);
}
async function list(req) {
  const [rows] = await pool.query('SELECT report_uid,report_type,workspace_scope,metadata_json,accounts_json,pdf_status,pdf_metadata_json,email_outcome_json,created_at,expires_at,revoked_at FROM finance_report_snapshots WHERE created_by=? ORDER BY created_at DESC LIMIT 100',[privacy.userId(req)]);
  const access=new Map(),visible=[];
  for(const row of rows){
    let permitted=true;
    for(const accountId of parse(row.accounts_json)){
      if(!access.has(accountId)){
        try{await privacy.assertAccountAccess(pool,accountId,req);access.set(accountId,true)}
        catch(error){if(error instanceof FinanceError&&error.statusCode===404)access.set(accountId,false);else throw error}
      }
      if(!access.get(accountId)){permitted=false;break}
    }
    if(permitted)visible.push({...descriptor(row),report_type:row.report_type,metadata:parse(row.metadata_json),created_at:row.created_at,revoked_at:row.revoked_at,expires_at:row.expires_at});
  }
  return visible;
}
async function revoke(req,id) {
  await authorise(req,id);
  await pool.query('UPDATE finance_report_snapshots SET revoked_at=NOW() WHERE report_uid=? AND created_by=?',[id,privacy.userId(req)]);
}
module.exports = {capture,load,authorise,storePdf,pdfBytes,pdfUnavailable,recordEmail,list,revoke,descriptor,filename,viewUrl,reportPath,
  _test:{hash,readChunks,writeChunks,seal,open,CHUNK_BYTES,MAX_SNAPSHOT_BYTES}};
