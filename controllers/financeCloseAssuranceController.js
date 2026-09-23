'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { ensureFinanceSchema } = require('../services/financeSchema');
const { FinanceError } = require('../services/financeDomain');
const { logAudit } = require('../services/auditService');
const { computePeriodCloseReadiness, resolvePeriod } = require('../services/financeCloseAssuranceService');

function actor(req){return Number(req.user?.id||0)||null}
function clean(v,max=1000){const x=String(v??'').trim();return x?x.slice(0,max):null}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code,issues:error.issues});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_CLOSE_ASSURANCE_FAILED'});
}
function audit(req,action,recordId,oldValue,newValue){
  return {actorId:actor(req),action,module:'finance',recordType:'accounting_period_close',recordId:String(recordId),oldValue,newValue,ipAddress:req.ip,userAgent:req.get('user-agent')};
}
async function ensureRun(db,period,req){
  let [[run]]=await db.query('SELECT * FROM finance_period_close_runs WHERE accounting_period_id=? LIMIT 1 FOR UPDATE',[period.id]);
  if(!run){
    await db.query("INSERT INTO finance_period_close_runs (close_uid,accounting_period_id,status,created_by) VALUES (?,?,'DRAFT',?)",
      [crypto.randomUUID(),period.id,actor(req)]);
    [[run]]=await db.query('SELECT * FROM finance_period_close_runs WHERE accounting_period_id=? LIMIT 1 FOR UPDATE',[period.id]);
  }
  return run;
}
async function snapshot(db,req,run,readiness){
  const uid=crypto.randomUUID();
  const payload=JSON.stringify({
    period:readiness.period,readiness_status:readiness.readiness_status,blocker_count:readiness.blocker_count,
    warning_count:readiness.warning_count,checks:readiness.checks,informational:readiness.informational,
    fingerprint:readiness.fingerprint,generated_at:readiness.generated_at
  });
  const [result]=await db.query(`INSERT INTO finance_period_close_snapshots
    (snapshot_uid,accounting_period_id,close_run_id,readiness_status,blocker_count,warning_count,evidence_json,evidence_hash,captured_by)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [uid,readiness.period.id,run.id,readiness.readiness_status,readiness.blocker_count,readiness.warning_count,payload,readiness.fingerprint,actor(req)]);
  return {id:result.insertId,snapshot_uid:uid,evidence_hash:readiness.fingerprint};
}
exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const readiness=await computePeriodCloseReadiness(pool,req.query.period_id||null);
    const [runRows,periodRows,snapRows]=await Promise.all([
      pool.query('SELECT * FROM finance_period_close_runs WHERE accounting_period_id=? LIMIT 1',[readiness.period.id]).then(([rows])=>rows),
      pool.query(`SELECT ap.id,ap.period_key,ap.start_date,ap.end_date,ap.status,fy.label AS financial_year_label
        FROM accounting_periods ap JOIN financial_years fy ON fy.id=ap.financial_year_id
        ORDER BY ap.start_date DESC LIMIT 36`).then(([rows])=>rows),
      pool.query(`SELECT snapshot_uid,readiness_status,blocker_count,warning_count,evidence_hash,captured_at,captured_by
        FROM finance_period_close_snapshots WHERE accounting_period_id=? ORDER BY captured_at DESC,id DESC LIMIT 24`,[readiness.period.id]).then(([rows])=>rows)
    ]);
    return res.json({...readiness,run:runRows[0]||null,periods:periodRows,snapshots:snapRows});
  }catch(error){return fail(res,error,'Failed to load Finance Close & Assurance Centre.')}
};
exports.captureSnapshot=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const readiness=await computePeriodCloseReadiness(db,req.params.periodId);
    const run=await ensureRun(db,readiness.period,req);
    const snap=await snapshot(db,req,run,readiness);
    await logAudit(db,audit(req,'FINANCE_CLOSE_SNAPSHOT_CAPTURED',readiness.period.id,null,{snapshot_uid:snap.snapshot_uid,evidence_hash:snap.evidence_hash,blocker_count:readiness.blocker_count,warning_count:readiness.warning_count}));
    await db.commit();
    return res.status(201).json({message:'Close evidence snapshot captured. No accounting period status or financial record was changed.',snapshot:snap,readiness_status:readiness.readiness_status});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to capture close evidence.');}finally{db.release()}
};
exports.certify=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const readiness=await computePeriodCloseReadiness(db,req.params.periodId);
    if(readiness.period.status==='LOCKED')throw new FinanceError('Locked periods cannot be re-certified until they are explicitly unlocked.',409,'FINANCE_CLOSE_PERIOD_LOCKED');
    if(readiness.blocker_count)throw new FinanceError('The period is not ready to certify. Resolve every blocking close control first.',409,'FINANCE_CLOSE_NOT_READY',readiness.blockers);
    const run=await ensureRun(db,readiness.period,req);
    const snap=await snapshot(db,req,run,readiness);
    const note=clean(req.body.certification_note,1000);
    await db.query(`UPDATE finance_period_close_runs SET status='CERTIFIED',certified_snapshot_id=?,certified_fingerprint=?,
      certification_note=?,certified_by=?,certified_at=NOW(),reopened_by=NULL,reopened_at=NULL,reopen_reason=NULL WHERE id=?`,
      [snap.id,readiness.fingerprint,note,actor(req),run.id]);
    if(readiness.period.status!=='READY')await db.query("UPDATE accounting_periods SET status='READY' WHERE id=? AND status<>'LOCKED'",[readiness.period.id]);
    await logAudit(db,audit(req,'FINANCE_PERIOD_CLOSE_CERTIFIED',readiness.period.id,{status:run.status},{status:'CERTIFIED',snapshot_uid:snap.snapshot_uid,fingerprint:readiness.fingerprint,note}));
    await db.commit();
    return res.json({message:'Period close certified from current evidence. The period is READY but not locked; locking remains a separate step-up action.',status:'CERTIFIED',snapshot:snap,fingerprint:readiness.fingerprint});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to certify period close.');}finally{db.release()}
};
exports.reopen=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const period=await resolvePeriod(db,req.params.periodId);
    if(period.status==='LOCKED')throw new FinanceError('Unlock the accounting period through the controlled period workflow before reopening its close certification.',409,'FINANCE_CLOSE_LOCKED_PERIOD');
    const run=await ensureRun(db,period,req);
    const reason=clean(req.body.reason,1000);
    if(!reason)throw new FinanceError('A reopen reason is required.',400,'FINANCE_CLOSE_REOPEN_REASON_REQUIRED');
    await db.query(`UPDATE finance_period_close_runs SET status='REOPENED',certified_snapshot_id=NULL,certified_fingerprint=NULL,
      certification_note=NULL,certified_by=NULL,certified_at=NULL,reopened_by=?,reopened_at=NOW(),reopen_reason=? WHERE id=?`,
      [actor(req),reason,run.id]);
    if(period.status==='READY')await db.query("UPDATE accounting_periods SET status='REVIEWING' WHERE id=?",[period.id]);
    await logAudit(db,audit(req,'FINANCE_PERIOD_CLOSE_REOPENED',period.id,{status:run.status},{status:'REOPENED',reason}));
    await db.commit();return res.json({message:'Close certification reopened. Historical snapshots were retained.',status:'REOPENED'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to reopen period close.');}finally{db.release()}
};
