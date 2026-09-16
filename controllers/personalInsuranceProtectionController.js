const crypto=require('node:crypto');
const pool=require('../config/db');

function uid(req){const v=req.user?.id??req.user?.user_id;if(v===undefined||v===null||v==='')throw Object.assign(new Error('User identity unavailable.'),{statusCode:401});return String(v);}
function fail(res,e,msg){const s=Number(e?.statusCode||500);if(s>=500)console.error(msg,e);return res.status(s).json({message:s>=500?msg:e.message});}
function clean(v,max=255){const s=String(v??'').trim();return s?s.slice(0,max):null;}
function required(v,label,max=160){const s=clean(v,max);if(!s)throw Object.assign(new Error(`${label} is required.`),{statusCode:400});return s;}
function date(v,label){if(v===undefined||v===null||v==='')return null;const s=String(v).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Object.assign(new Error(`${label} must use YYYY-MM-DD.`),{statusCode:400});return s;}
function money(v,label){if(v===undefined||v===null||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0||n>999999999999)throw Object.assign(new Error(`${label} must be zero or a positive amount.`),{statusCode:400});return Math.round(n*100)/100;}
function currency(v){const s=String(v||'AUD').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(s))throw Object.assign(new Error('Currency must be a three-letter code such as AUD, USD or INR.'),{statusCode:400});return s;}
function enumVal(v,allowed,label){const s=String(v||'').trim().toUpperCase();if(!allowed.has(s))throw Object.assign(new Error(`Choose a valid ${label}.`),{statusCode:400});return s;}
function masked(v){const s=String(v||'').trim();if(!s)return null;return s.length<=4?'••••':`•••• ${s.slice(-4)}`;}
async function ensureSchema(){await pool.query(`CREATE TABLE IF NOT EXISTS personal_insurance_policies (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  policy_type ENUM('VEHICLE','HOME_CONTENTS','HEALTH','LIFE','INCOME_PROTECTION','TRAVEL','PET','OTHER') NOT NULL,
  policy_name VARCHAR(160) NOT NULL,
  insurer VARCHAR(160) NULL,
  policy_reference VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  premium_amount DECIMAL(15,2) NULL,
  premium_frequency ENUM('WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','OTHER') NULL,
  insured_amount DECIMAL(15,2) NULL,
  excess_amount DECIMAL(15,2) NULL,
  start_date DATE NULL,
  renewal_date DATE NULL,
  expiry_date DATE NULL,
  beneficiary_note VARCHAR(500) NULL,
  coverage_note VARCHAR(1000) NULL,
  document_name VARCHAR(255) NULL,
  document_reference VARCHAR(500) NULL,
  reminder_days INT NOT NULL DEFAULT 30,
  status ENUM('ACTIVE','PENDING','EXPIRED','CANCELLED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pip_owner_status (user_id,status),
  INDEX idx_pip_owner_renewal (user_id,renewal_date),
  INDEX idx_pip_owner_expiry (user_id,expiry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);}
function shape(r){return{...r,premium_amount:r.premium_amount===null?null:Number(r.premium_amount),insured_amount:r.insured_amount===null?null:Number(r.insured_amount),excess_amount:r.excess_amount===null?null:Number(r.excess_amount),policy_reference_masked:masked(r.policy_reference),policy_reference:undefined};}
exports.list=async(req,res)=>{try{await ensureSchema();const userId=uid(req);const [rows]=await pool.query(`SELECT * FROM personal_insurance_policies WHERE user_id=? AND status<>'ARCHIVED' ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'EXPIRED' THEN 2 ELSE 3 END,COALESCE(renewal_date,expiry_date,'9999-12-31'),created_at DESC`,[userId]);const today=new Date().toISOString().slice(0,10);const summary={total:rows.length,active:0,renewing_30_days:0,expired:0,by_type:{}};for(const r of rows){if(r.status==='ACTIVE')summary.active++;if(r.status==='EXPIRED'||(r.expiry_date&&String(r.expiry_date).slice(0,10)<today))summary.expired++;const d=r.renewal_date||r.expiry_date;if(d){const days=Math.ceil((new Date(`${String(d).slice(0,10)}T00:00:00Z`)-new Date(`${today}T00:00:00Z`))/86400000);if(days>=0&&days<=30)summary.renewing_30_days++;}summary.by_type[r.policy_type]=(summary.by_type[r.policy_type]||0)+1;}return res.json({privacy:'Owner-only personal protection register. Policy references are masked in API responses.',coverage_rule:'A recorded policy proves only that a policy record exists; this app does not verify legal adequacy, exclusions, claims eligibility or insurer status.',currencies_rule:'Currencies stay separate. No FX conversion is assumed.',summary,policies:rows.map(shape)});}catch(e){return fail(res,e,'Failed to load personal protection register.');}};
exports.create=async(req,res)=>{try{await ensureSchema();const userId=uid(req),types=new Set(['VEHICLE','HOME_CONTENTS','HEALTH','LIFE','INCOME_PROTECTION','TRAVEL','PET','OTHER']),freqs=new Set(['WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','OTHER']);const id=crypto.randomUUID(),type=enumVal(req.body.policy_type,types,'policy type'),name=required(req.body.policy_name,'Policy name'),freq=req.body.premium_frequency?enumVal(req.body.premium_frequency,freqs,'premium frequency'):null,reminder=Math.max(1,Math.min(365,Number(req.body.reminder_days||30)||30));await pool.query(`INSERT INTO personal_insurance_policies (id,user_id,policy_type,policy_name,insurer,policy_reference,currency,premium_amount,premium_frequency,insured_amount,excess_amount,start_date,renewal_date,expiry_date,beneficiary_note,coverage_note,document_name,document_reference,reminder_days,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE')`,[id,userId,type,name,clean(req.body.insurer,160),clean(req.body.policy_reference,255),currency(req.body.currency),money(req.body.premium_amount,'Premium amount'),freq,money(req.body.insured_amount,'Insured amount'),money(req.body.excess_amount,'Excess amount'),date(req.body.start_date,'Start date'),date(req.body.renewal_date,'Renewal date'),date(req.body.expiry_date,'Expiry date'),clean(req.body.beneficiary_note,500),clean(req.body.coverage_note,1000),clean(req.body.document_name,255),clean(req.body.document_reference,500),reminder]);return res.status(201).json({message:'Policy added to your private protection register.',id});}catch(e){return fail(res,e,'Failed to add policy.');}};
exports.update=async(req,res)=>{try{await ensureSchema();const userId=uid(req),types=new Set(['VEHICLE','HOME_CONTENTS','HEALTH','LIFE','INCOME_PROTECTION','TRAVEL','PET','OTHER']),freqs=new Set(['WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY','OTHER']),statuses=new Set(['ACTIVE','PENDING','EXPIRED','CANCELLED']);const [owned]=await pool.query('SELECT id FROM personal_insurance_policies WHERE id=? AND user_id=? AND status<>\'ARCHIVED\' LIMIT 1',[req.params.id,userId]);if(!owned.length)return res.status(404).json({message:'Policy not found.'});const reminder=Math.max(1,Math.min(365,Number(req.body.reminder_days||30)||30));await pool.query(`UPDATE personal_insurance_policies SET policy_type=?,policy_name=?,insurer=?,policy_reference=COALESCE(NULLIF(?,''),policy_reference),currency=?,premium_amount=?,premium_frequency=?,insured_amount=?,excess_amount=?,start_date=?,renewal_date=?,expiry_date=?,beneficiary_note=?,coverage_note=?,document_name=?,document_reference=?,reminder_days=?,status=? WHERE id=? AND user_id=?`,[enumVal(req.body.policy_type,types,'policy type'),required(req.body.policy_name,'Policy name'),clean(req.body.insurer,160),String(req.body.policy_reference||''),currency(req.body.currency),money(req.body.premium_amount,'Premium amount'),req.body.premium_frequency?enumVal(req.body.premium_frequency,freqs,'premium frequency'):null,money(req.body.insured_amount,'Insured amount'),money(req.body.excess_amount,'Excess amount'),date(req.body.start_date,'Start date'),date(req.body.renewal_date,'Renewal date'),date(req.body.expiry_date,'Expiry date'),clean(req.body.beneficiary_note,500),clean(req.body.coverage_note,1000),clean(req.body.document_name,255),clean(req.body.document_reference,500),reminder,enumVal(req.body.status||'ACTIVE',statuses,'status'),req.params.id,userId]);return res.json({message:'Policy updated.'});}catch(e){return fail(res,e,'Failed to update policy.');}};
exports.archive=async(req,res)=>{try{await ensureSchema();const userId=uid(req);const [r]=await pool.query(`UPDATE personal_insurance_policies SET status='ARCHIVED' WHERE id=? AND user_id=?`,[req.params.id,userId]);if(!r.affectedRows)return res.status(404).json({message:'Policy not found.'});return res.json({message:'Policy archived. Historical record retained.'});}catch(e){return fail(res,e,'Failed to archive policy.');}};
