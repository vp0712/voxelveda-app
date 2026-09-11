const crypto = require('crypto');
const pool = require('../config/db');
const { PERMISSIONS } = require('../config/permissionCatalog');
const { ensureAssuranceSchema } = require('../services/assuranceSchema');
const { logAudit } = require('../services/auditService');
const { logSecurityEvent } = require('../services/sessionService');
const { queueSecurityEvent } = require('../services/securityEventOutboxService');
const { getRateLimitService } = require('../services/rateLimitService');

const DECISIONS = new Set(['CERTIFY', 'REVOKE', 'EXCEPTION']);
const RESULTS = new Set(['PASSED', 'PARTIAL', 'FAILED']);
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const text = (value, max = 500) => String(value || '').trim().slice(0, max);
const hash = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const list = (value) => [...new Set((Array.isArray(value) ? value : []).map((v) => text(v, 100).toUpperCase()).filter(Boolean))];

async function audit(req, action, type, id, value) {
  await logAudit(pool, { actorId: req.user.id, action, module: 'security_assurance', recordType: type, recordId: id, newValue: value, ipAddress: req.ip, userAgent: req.get('user-agent') });
  await logSecurityEvent({ actorId: req.user.id, eventType: action, req, sessionId: req.session?.id, metadata: value });
  await queueSecurityEvent(action, { actor_id: req.user.id, record_type: type, record_id: id, metadata: value });
}

exports.summary = async (req, res, next) => {
  try {
    await ensureAssuranceSchema();
    const queries = [
      "SELECT COUNT(*) count FROM privileged_access_requests WHERE status='ACTIVE' AND expires_at>NOW()",
      "SELECT COUNT(*) count FROM privileged_access_requests WHERE status='PENDING_APPROVAL' AND expires_at>NOW()",
      "SELECT COUNT(*) count FROM access_review_campaigns WHERE status='OPEN' AND due_at>=NOW()",
      "SELECT COUNT(*) count FROM access_review_campaigns WHERE status='OPEN' AND due_at<NOW()",
      "SELECT COUNT(*) count FROM security_risk_exceptions WHERE status='APPROVED' AND expires_at>NOW()",
      "SELECT COUNT(*) count FROM service_accounts WHERE status='ACTIVE' AND expires_at>NOW()",
      "SELECT COUNT(*) count FROM security_event_outbox WHERE status IN ('PENDING','RETRY')",
      "SELECT COUNT(*) count FROM resilience_exercises WHERE result='PASSED' AND started_at>=DATE_SUB(NOW(),INTERVAL 180 DAY)",
      'SELECT COUNT(*) count FROM audit_integrity_checkpoints'
    ];
    const rows = await Promise.all(queries.map((sql) => pool.query(sql)));
    const values = rows.map((row) => Number(row[0][0].count));
    const limiterStatus = getRateLimitService().status();
    return res.json({ generated_at: new Date().toISOString(), metrics: {
      active_jit_grants: values[0], pending_jit_requests: values[1], open_access_reviews: values[2], overdue_access_reviews: values[3],
      active_risk_exceptions: values[4], active_service_accounts: values[5], pending_security_events: values[6],
      successful_resilience_exercises_180d: values[7], audit_integrity_checkpoints: values[8]
    }, controls: {
      distributed_rate_limit: limiterStatus.distributed && limiterStatus.state === 'OPERATIONAL', webauthn_ready: Boolean(process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN),
      event_delivery_configured: Boolean(process.env.SECURITY_EVENT_DESTINATION), key_rotation_support: true,
      note: 'External controls are reported configured only when production evidence exists.'
    }});
  } catch (error) { next(error); }
};

exports.sealAudit = async (req, res, next) => {
  try {
    await ensureAssuranceSchema();
    const [[previous]] = await pool.query('SELECT last_audit_id, content_digest FROM audit_integrity_checkpoints ORDER BY sealed_at DESC LIMIT 1');
    const after = Number(previous?.last_audit_id || 0);
    const [rows] = await pool.query('SELECT id,actor_id,action,module,record_type,record_id,old_value,new_value,ip_address,user_agent,created_at FROM audit_logs WHERE id>? ORDER BY id ASC LIMIT 10000', [after]);
    if (!rows.length) return res.status(409).json({ message: 'No new audit records are available to seal' });
    const digest = hash({ previous_digest: previous?.content_digest || null, records: rows });
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO audit_integrity_checkpoints (id,first_audit_id,last_audit_id,record_count,previous_digest,content_digest,sealed_by) VALUES (?,?,?,?,?,?,?)', [id, rows[0].id, rows[rows.length - 1].id, rows.length, previous?.content_digest || null, digest, req.user.id]);
    await audit(req, 'AUDIT_INTEGRITY_SEALED', 'audit_checkpoint', id, { first_audit_id: rows[0].id, last_audit_id: rows[rows.length - 1].id, record_count: rows.length, content_digest: digest });
    return res.status(201).json({ id, record_count: rows.length, content_digest: digest, chain_previous: previous?.content_digest || null });
  } catch (error) { next(error); }
};

exports.requestJit = async (req, res, next) => {
  try {
    await ensureAssuranceSchema();
    const permission = text(req.body.permission, 100).toUpperCase(); const reason = text(req.body.reason, 500); const hours = Number(req.body.duration_hours || 1); const userId = Number(req.body.user_id);
    if (!PERMISSIONS.includes(permission) || !Number.isInteger(userId) || reason.length < 10 || !Number.isFinite(hours) || hours <= 0 || hours > 8) return res.status(400).json({ message: 'Valid user, permission, 1-8 hour duration and reason are required' });
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO privileged_access_requests (id,user_id,permission_name,scope_type,scope_id,requested_by,reason,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))', [id,userId,permission,text(req.body.scope_type,40).toUpperCase() || 'ORGANISATION',text(req.body.scope_id,120)||null,req.user.id,reason,Math.round(hours*60)]);
    await audit(req, 'JIT_ACCESS_REQUESTED', 'jit_access', id, { user_id:userId, permission, duration_hours:hours });
    return res.status(201).json({ id, status:'PENDING_APPROVAL', message:'Temporary privilege requires approval by a different security administrator.' });
  } catch (error) { next(error); }
};

exports.approveJit = async (req, res, next) => {
  try {
    await ensureAssuranceSchema(); const reason=text(req.body.reason,500);
    const [[item]]=await pool.query('SELECT * FROM privileged_access_requests WHERE id=? LIMIT 1',[req.params.id]);
    if(!item)return res.status(404).json({message:'Access request not found'});
    if(Number(item.requested_by)===Number(req.user.id)||Number(item.user_id)===Number(req.user.id))return res.status(403).json({message:'Requester, beneficiary and approver must be different where applicable'});
    if(item.status!=='PENDING_APPROVAL'||new Date(item.expires_at)<=new Date())return res.status(409).json({message:'Access request is not approvable'});
    if(reason.length<10||req.body.confirmation!=='APPROVE TEMPORARY ACCESS')return res.status(400).json({message:'Exact confirmation and approval reason are required'});
    await pool.query("UPDATE privileged_access_requests SET status='ACTIVE',approved_by=?,approved_at=NOW(),starts_at=NOW() WHERE id=? AND status='PENDING_APPROVAL'",[req.user.id,item.id]);
    await audit(req,'JIT_ACCESS_APPROVED','jit_access',item.id,{user_id:item.user_id,permission:item.permission_name,expires_at:item.expires_at,reason});
    return res.json({message:'Temporary access approved until its fixed expiry.',expires_at:item.expires_at});
  } catch(error){next(error);}
};

exports.createReview = async (req,res,next)=>{try{await ensureAssuranceSchema();const name=text(req.body.name,160),days=Number(req.body.due_days||14),scope=list(req.body.roles);if(name.length<5||!Number.isInteger(days)||days<1||days>90)return res.status(400).json({message:'Review name and 1-90 day deadline are required'});const id=crypto.randomUUID();await pool.query('INSERT INTO access_review_campaigns (id,name,scope_json,due_at,created_by) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY),?)',[id,name,JSON.stringify({roles:scope}),days,req.user.id]);await audit(req,'ACCESS_REVIEW_CREATED','access_review',id,{name,roles:scope,due_days:days});return res.status(201).json({id,status:'OPEN'});}catch(error){next(error);}};
exports.recordReviewDecision = async(req,res,next)=>{try{await ensureAssuranceSchema();const decision=text(req.body.decision,20).toUpperCase(),reason=text(req.body.reason,500),userId=Number(req.body.user_id);if(!DECISIONS.has(decision)||!userId||reason.length<10)return res.status(400).json({message:'User, decision and detailed reason are required'});await pool.query('INSERT INTO access_review_decisions (id,campaign_id,user_id,reviewer_id,decision,reason) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE reviewer_id=VALUES(reviewer_id),decision=VALUES(decision),reason=VALUES(reason),decided_at=NOW()',[crypto.randomUUID(),req.params.id,userId,req.user.id,decision,reason]);await audit(req,'ACCESS_REVIEW_DECISION','access_review',req.params.id,{user_id:userId,decision,reason});return res.json({message:'Access-review decision recorded. Revocation decisions require the existing controlled user-change workflow.'});}catch(error){next(error);}};

exports.saveSodPolicy = async(req,res,next)=>{try{await ensureAssuranceSchema();const key=text(req.body.policy_key,100).toUpperCase(),a=text(req.body.permission_a,100).toUpperCase(),b=text(req.body.permission_b,100).toUpperCase(),severity=text(req.body.severity,20).toUpperCase();if(!/^[A-Z0-9_]{3,100}$/.test(key)||a===b||!PERMISSIONS.includes(a)||!PERMISSIONS.includes(b)||!SEVERITIES.has(severity))return res.status(400).json({message:'Valid conflicting permissions and severity are required'});await pool.query('INSERT INTO segregation_policies (id,policy_key,permission_a,permission_b,severity,active,updated_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE permission_a=VALUES(permission_a),permission_b=VALUES(permission_b),severity=VALUES(severity),active=VALUES(active),updated_by=VALUES(updated_by)',[crypto.randomUUID(),key,a,b,severity,req.body.active===false?0:1,req.user.id]);await audit(req,'SEGREGATION_POLICY_CHANGED','sod_policy',key,{permission_a:a,permission_b:b,severity,active:req.body.active!==false});return res.json({message:'Segregation-of-duties policy saved.'});}catch(error){next(error);}};

exports.requestException = async(req,res,next)=>{try{await ensureAssuranceSchema();const control=text(req.body.control_key,120).toUpperCase(),reason=text(req.body.reason,700),controls=text(req.body.compensating_controls,1000),days=Number(req.body.duration_days||30),owner=Number(req.body.owner_id);if(!control||reason.length<20||controls.length<20||!owner||!Number.isInteger(days)||days<1||days>90)return res.status(400).json({message:'A named owner, detailed rationale, compensating controls and 1-90 day expiry are required'});const id=crypto.randomUUID();await pool.query('INSERT INTO security_risk_exceptions (id,control_key,owner_id,reason,compensating_controls,requested_by,expires_at) VALUES (?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY))',[id,control,owner,reason,controls,req.user.id,days]);await audit(req,'RISK_EXCEPTION_REQUESTED','risk_exception',id,{control_key:control,owner_id:owner,duration_days:days});return res.status(201).json({id,status:'PENDING_APPROVAL'});}catch(error){next(error);}};
exports.approveException = async(req,res,next)=>{try{await ensureAssuranceSchema();const [[item]]=await pool.query('SELECT * FROM security_risk_exceptions WHERE id=? LIMIT 1',[req.params.id]);if(!item)return res.status(404).json({message:'Risk exception not found'});if(Number(item.requested_by)===Number(req.user.id)||Number(item.owner_id)===Number(req.user.id))return res.status(403).json({message:'Requester or owner cannot approve this exception'});if(item.status!=='PENDING_APPROVAL'||new Date(item.expires_at)<=new Date())return res.status(409).json({message:'Exception is not approvable'});if(req.body.confirmation!=='ACCEPT RESIDUAL RISK')return res.status(400).json({message:'Exact residual-risk confirmation is required'});await pool.query("UPDATE security_risk_exceptions SET status='APPROVED',approved_by=?,approved_at=NOW() WHERE id=? AND status='PENDING_APPROVAL'",[req.user.id,item.id]);await audit(req,'RISK_EXCEPTION_APPROVED','risk_exception',item.id,{control_key:item.control_key,expires_at:item.expires_at});return res.json({message:'Time-limited risk exception approved.'});}catch(error){next(error);}};

exports.recordKeyVersion = async(req,res,next)=>{try{await ensureAssuranceSchema();const name=text(req.body.key_name,100).toUpperCase(),version=text(req.body.key_version,30),purpose=text(req.body.purpose,300),fingerprint=text(req.body.fingerprint_sha256,64).toLowerCase(),status=text(req.body.status,30).toUpperCase();if(!/^[A-Z][A-Z0-9_]{2,99}$/.test(name)||!version||purpose.length<10||!/^[a-f0-9]{64}$/.test(fingerprint)||!['ACTIVE','DECRYPT_ONLY','RETIRED'].includes(status))return res.status(400).json({message:'Valid non-secret key metadata and SHA-256 fingerprint are required'});await pool.query('INSERT INTO cryptographic_key_versions (key_name,key_version,purpose,status,activated_at,retired_at,fingerprint_sha256,recorded_by) VALUES (?,?,?,?,IF(?=\'ACTIVE\',NOW(),NULL),IF(?=\'RETIRED\',NOW(),NULL),?,?) ON DUPLICATE KEY UPDATE purpose=VALUES(purpose),status=VALUES(status),activated_at=COALESCE(activated_at,VALUES(activated_at)),retired_at=VALUES(retired_at),fingerprint_sha256=VALUES(fingerprint_sha256),recorded_by=VALUES(recorded_by)',[name,version,purpose,status,status,status,fingerprint,req.user.id]);await audit(req,'CRYPTO_KEY_VERSION_RECORDED','crypto_key',`${name}:${version}`,{purpose,status,fingerprint_sha256:fingerprint});return res.json({message:'Key metadata recorded; no key material was stored.'});}catch(error){next(error);}};

exports.createServiceAccount = async(req,res,next)=>{try{await ensureAssuranceSchema();const name=text(req.body.account_name,120).toLowerCase(),purpose=text(req.body.purpose,500),scopes=list(req.body.scopes),owner=Number(req.body.owner_user_id),days=Number(req.body.expires_in_days||90);if(!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(name)||purpose.length<10||!owner||!scopes.length||scopes.some((s)=>!PERMISSIONS.includes(s))||!Number.isInteger(days)||days<1||days>365)return res.status(400).json({message:'Valid owner, least-privilege scopes, purpose and 1-365 day expiry are required'});const id=crypto.randomUUID();await pool.query('INSERT INTO service_accounts (id,account_name,owner_user_id,purpose,scopes_json,expires_at,created_by) VALUES (?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY),?)',[id,name,owner,purpose,JSON.stringify(scopes),days,req.user.id]);await audit(req,'SERVICE_ACCOUNT_CREATED','service_account',id,{account_name:name,owner_user_id:owner,scopes,expires_in_days:days});return res.status(201).json({id,message:'Service account identity created without credentials. Issue a separate scoped API token if required.'});}catch(error){next(error);}};

exports.recordExercise = async(req,res,next)=>{try{await ensureAssuranceSchema();const type=text(req.body.exercise_type,60).toUpperCase(),scenario=text(req.body.scenario,700),findings=text(req.body.findings,1200),result=text(req.body.result,30).toUpperCase(),minutes=Number(req.body.recovery_minutes);const started=new Date(req.body.started_at);if(!type||scenario.length<20||findings.length<20||!RESULTS.has(result)||!Number.isFinite(started.getTime())||started>new Date()||!Number.isInteger(minutes)||minutes<0||minutes>10080)return res.status(400).json({message:'Valid exercise evidence, result and recovery time are required'});const evidence=hash({type,scenario,findings,result,minutes,started_at:started.toISOString()});const id=crypto.randomUUID();await pool.query('INSERT INTO resilience_exercises (id,exercise_type,scenario,started_at,completed_at,recovery_minutes,evidence_sha256,result,findings,conducted_by) VALUES (?,?,?,?,NOW(),?,?,?,?,?)',[id,type,scenario,started,minutes,evidence,result,findings,req.user.id]);await audit(req,'RESILIENCE_EXERCISE_RECORDED','resilience_exercise',id,{exercise_type:type,result,recovery_minutes:minutes,evidence_sha256:evidence});return res.status(201).json({id,evidence_sha256:evidence,message:'Exercise evidence recorded; this does not claim provider recovery capability.'});}catch(error){next(error);}};

exports.catalog = async(req,res,next)=>{try{await ensureAssuranceSchema();const sets=await Promise.all([
pool.query('SELECT id,user_id,permission_name,scope_type,scope_id,status,starts_at,expires_at,created_at FROM privileged_access_requests ORDER BY created_at DESC LIMIT 100'),
pool.query('SELECT id,name,scope_json,due_at,status,completed_at,created_at FROM access_review_campaigns ORDER BY created_at DESC LIMIT 50'),
pool.query('SELECT policy_key,permission_a,permission_b,severity,active,updated_at FROM segregation_policies ORDER BY severity,policy_key'),
pool.query('SELECT id,control_key,owner_id,status,expires_at,created_at FROM security_risk_exceptions ORDER BY created_at DESC LIMIT 100'),
pool.query('SELECT key_name,key_version,purpose,status,activated_at,retired_at,fingerprint_sha256,created_at FROM cryptographic_key_versions ORDER BY key_name,created_at DESC'),
pool.query('SELECT id,account_name,owner_user_id,purpose,scopes_json,expires_at,status,last_reviewed_at,created_at FROM service_accounts ORDER BY created_at DESC LIMIT 100'),
pool.query('SELECT id,exercise_type,started_at,completed_at,recovery_minutes,evidence_sha256,result FROM resilience_exercises ORDER BY started_at DESC LIMIT 50'),
pool.query('SELECT id,first_audit_id,last_audit_id,record_count,previous_digest,content_digest,sealed_at FROM audit_integrity_checkpoints ORDER BY sealed_at DESC LIMIT 50')]);return res.json({jit_access:sets[0][0],access_reviews:sets[1][0],segregation_policies:sets[2][0],risk_exceptions:sets[3][0],key_versions:sets[4][0],service_accounts:sets[5][0],resilience_exercises:sets[6][0],audit_checkpoints:sets[7][0]});}catch(error){next(error);}};
