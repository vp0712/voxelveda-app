const crypto=require('node:crypto');
const QRCode=require('qrcode');
const pool=require('../config/db');
const {ensureEmployeeIdentitySchema}=require('../services/employeeIdentitySchema');
const {ensureUserLifecycleSchema}=require('../services/userLifecycleService');
const {logAudit}=require('../services/auditService');

function statusOf(card){
  if(!card) return 'NOT_ISSUED';
  const state=card.status ?? card.card_status;
  if(state!=='ACTIVE') return state || 'NOT_ISSUED';
  if(card.expires_at && new Date(card.expires_at).getTime()<Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}
async function userById(id){
  const [[u]]=await pool.query(`SELECT id,name,email,role,department,employee_number,active,account_status
    FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1`,[id]);
  return u;
}
exports.list=async(req,res)=>{
  try{
    await Promise.all([ensureEmployeeIdentitySchema(),ensureUserLifecycleSchema()]);
    const [activeUsers]=await pool.query(\`SELECT id FROM users WHERE deleted_at IS NULL AND active=1 AND UPPER(COALESCE(account_status,'ACTIVE')) NOT IN ('TERMINATED','SUSPENDED','DISABLED')\`);
    for(const u of activeUsers){
      await pool.query(\`INSERT IGNORE INTO employee_id_cards(user_id,card_uuid,verification_token,status,created_by) VALUES(?,?,?,'ACTIVE',?)\`,[u.id,crypto.randomUUID(),crypto.randomBytes(32).toString('hex'),req.user.id]);
    }
    const [rows]=await pool.query(\`SELECT u.id user_id,u.name,u.email,u.role,u.department,u.employee_number,u.active,u.account_status,
      c.card_uuid,c.status card_status,c.issued_at,c.expires_at,c.revoked_at
      FROM users u LEFT JOIN employee_id_cards c ON c.user_id=u.id
      WHERE u.deleted_at IS NULL ORDER BY u.name`);
    res.json({employees:rows.map(r=>({...r,effective_card_status:statusOf(r.card_uuid?r:null)}))});
  }catch(e){res.status(500).json({message:'Unable to load employee identities',request_id:req.requestId||null})}
};
exports.issue=async(req,res)=>{
  try{
    await Promise.all([ensureEmployeeIdentitySchema(),ensureUserLifecycleSchema()]);
    const user=await userById(req.params.id);
    if(!user) return res.status(404).json({message:'Employee not found'});
    const cardUuid=crypto.randomUUID(), token=crypto.randomBytes(32).toString('hex');
    const expires=req.body?.expires_at?new Date(req.body.expires_at):null;
    if(expires && Number.isNaN(expires.getTime())) return res.status(400).json({message:'Invalid expiry date'});
    await pool.query(`INSERT INTO employee_id_cards(user_id,card_uuid,verification_token,status,expires_at,created_by)
      VALUES(?,?,?,'ACTIVE',?,?) ON DUPLICATE KEY UPDATE card_uuid=VALUES(card_uuid),verification_token=VALUES(verification_token),
      status='ACTIVE',issued_at=CURRENT_TIMESTAMP,expires_at=VALUES(expires_at),revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL,created_by=VALUES(created_by)`,
      [user.id,cardUuid,token,expires,req.user.id]);
    await logAudit({actorId:req.user.id,action:'EMPLOYEE_ID_ISSUED',module:'workforce',recordType:'user',recordId:String(user.id),newValue:{employee_number:user.employee_number,expires_at:expires},req});
    res.json({message:'Employee ID issued',employee_number:user.employee_number,card_uuid:cardUuid,verification_url:`${req.protocol}://${req.get('host')}/employee/verify/${token}`});
  }catch(e){res.status(500).json({message:'Unable to issue employee ID',request_id:req.requestId||null})}
};
exports.revoke=async(req,res)=>{
  try{
    await ensureEmployeeIdentitySchema();
    const reason=String(req.body?.reason||'').trim();
    if(!reason) return res.status(400).json({message:'Revocation reason is required'});
    const [result]=await pool.query(`UPDATE employee_id_cards SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP,revoked_by=?,revoke_reason=? WHERE user_id=? AND status='ACTIVE'`,[req.user.id,reason.slice(0,500),req.params.id]);
    if(!result.affectedRows) return res.status(404).json({message:'Active employee ID not found'});
    await logAudit({actorId:req.user.id,action:'EMPLOYEE_ID_REVOKED',module:'workforce',recordType:'user',recordId:String(req.params.id),newValue:{reason},req});
    res.json({message:'Employee ID revoked'});
  }catch(e){res.status(500).json({message:'Unable to revoke employee ID',request_id:req.requestId||null})}
};
exports.card=async(req,res)=>{
  try{
    await Promise.all([ensureEmployeeIdentitySchema(),ensureUserLifecycleSchema()]);
    const [[row]]=await pool.query(`SELECT u.id user_id,u.name,u.email,u.role,u.department,u.employee_number,u.active,u.account_status,
      c.card_uuid,c.verification_token,c.status card_status,c.issued_at,c.expires_at,c.revoked_at
      FROM users u LEFT JOIN employee_id_cards c ON c.user_id=u.id WHERE u.id=? AND u.deleted_at IS NULL LIMIT 1`,[req.params.id]);
    if(!row) return res.status(404).json({message:'Employee not found'});
    const verificationUrl=row.verification_token?`${req.protocol}://${req.get('host')}/employee/verify/${row.verification_token}`:null;
    const qr=verificationUrl?await QRCode.toDataURL(verificationUrl,{errorCorrectionLevel:'H',margin:2,width:360}):null;
    res.json({employee:{name:row.name,email:row.email,role:row.role,department:row.department,employee_number:row.employee_number},
      card:{card_uuid:row.card_uuid,status:statusOf(row.card_uuid?row:null),issued_at:row.issued_at,expires_at:row.expires_at,verification_url:verificationUrl,qr_data_url:qr}});
  }catch(e){res.status(500).json({message:'Unable to load employee ID',request_id:req.requestId||null})}
};
exports.verify=async(req,res)=>{
  try{
    await Promise.all([ensureEmployeeIdentitySchema(),ensureUserLifecycleSchema()]);
    const [[row]]=await pool.query(`SELECT u.name,u.role,u.department,u.employee_number,u.active,u.account_status,c.status card_status,c.issued_at,c.expires_at
      FROM employee_id_cards c JOIN users u ON u.id=c.user_id WHERE c.verification_token=? AND u.deleted_at IS NULL LIMIT 1`,[req.params.token]);
    if(!row) return res.status(404).json({verified:false,status:'NOT_FOUND'});
    const effective=statusOf(row), active=effective==='ACTIVE' && Number(row.active)===1 && !['TERMINATED','SUSPENDED','DISABLED'].includes(String(row.account_status||'').toUpperCase());
    res.setHeader('Cache-Control','no-store');
    res.json({verified:active,status:active?'ACTIVE':effective,employee:{name:row.name,role:row.role,department:row.department,employee_number:row.employee_number},issued_at:row.issued_at,expires_at:row.expires_at});
  }catch(e){res.status(500).json({verified:false,status:'UNAVAILABLE'})}
};
