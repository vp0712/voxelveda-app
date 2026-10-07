'use strict';
// This check runs only against the existing explicitly disposable CI database.
if(process.env.REPAIR_DB_TEST!=='true'||process.env.DB_NAME!=='voxelveda_repair_test')throw new Error('Disposable repair database opt-in required');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pool=require('../config/db');
const {splitMigrationSql}=require('../services/migrationRunner');
process.env.FINANCE_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
const service=require('../services/financeReportSnapshotService');
async function main(){
  for(const sql of splitMigrationSql(fs.readFileSync(path.join(__dirname,'..','migrations','20261007_finance_report_snapshots.sql'),'utf8')))await pool.query(sql);
  const owner={user:{id:1},bankingAccessScope:{has_explicit_grants:true,allowed_business_account_ids:[]}};
  const report={metadata:{report_type:'TRANSACTION_REGISTER',scope:'PERSONAL',account_ids:[1],from:'2026-09-30',to:'2026-10-06',currency:'AUD',generated_at:'2026-10-07T12:00:00Z',source_transaction_count:1},transactions:[{bank_account_id:1,description:crypto.randomBytes(400000).toString('base64'),debit:'76.80',credit:'0',currency:'AUD'}],summary_by_currency:[{currency:'AUD',source_transaction_count:1,money_out:'76.80',money_in:'0',net_cash_flow:'-76.80'}],coverage:{accounts:[{account_id:1}]}};
  const saved=await service.capture(owner,report,{legalName:'Voxel Veda'}),id=saved.report.metadata.report_id;
  assert(saved.row.snapshot_chunks>1,'large snapshots must span real durable chunks');
  report.transactions[0].debit='999';
  delete require.cache[require.resolve('../services/financeReportSnapshotService')];const restarted=require('../services/financeReportSnapshotService');
  assert.equal((await restarted.load(owner,id)).report.transactions[0].debit,'76.80');
  await assert.rejects(()=>restarted.load({user:{id:2}},id),e=>e.code==='REPORT_UNAVAILABLE');
  const [[stored]]=await pool.query('SELECT COUNT(*) AS count,SUM(OCTET_LENGTH(content)) AS bytes FROM finance_report_snapshot_chunks WHERE report_uid=?',[id]);
  assert.equal(stored.count,saved.row.snapshot_chunks);assert.equal(Number(stored.bytes),saved.row.snapshot_bytes);
  await restarted.pdfUnavailable(id,{code:'FORCED_RENDERER_FAILURE'});assert.equal((await restarted.load(owner,id)).pdf_status,'UNAVAILABLE');
  await restarted.recordEmail(id,{status:'PROVIDER_ACCEPTED',received_verified:false});assert.equal((await restarted.load(owner,id)).email_outcome.status,'PROVIDER_ACCEPTED');
  const [[before]]=await pool.query('SELECT COUNT(*) AS count FROM bank_transactions');
  await restarted.revoke(owner,id);await assert.rejects(()=>restarted.load(owner,id),e=>e.code==='REPORT_REVOKED');
  const [[after]]=await pool.query('SELECT COUNT(*) AS count FROM bank_transactions');assert.equal(after.count,before.count,'snapshot operations cannot mutate financial records');
  console.log('MYSQL_REPORT_SNAPSHOT_OK: production migration, encrypted chunk persistence/restart, owner isolation, PDF-failure/email outcomes, revocation and preserved ledger.');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>pool.end());
