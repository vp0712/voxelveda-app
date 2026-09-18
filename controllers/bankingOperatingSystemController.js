const crypto = require('node:crypto');
const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const { hasPermission } = require('../services/authorizationService');
const { providerOptions, selectedProvider, environment, liveSyncEnabled } = require('../services/openBankingProviderService');

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
function clean(value, max = 255) { return String(value == null ? '' : value).trim().slice(0, max); }
function money(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function scope(value) { return String(value || 'BUSINESS').toUpperCase() === 'PERSONAL' ? 'PERSONAL' : 'BUSINESS'; }
function currency(value) { const v = clean(value || 'AUD', 3).toUpperCase(); return /^[A-Z]{3}$/.test(v) ? v : 'AUD'; }
function isBankAdmin(req) {
  return ['super_admin','admin','finance_admin'].includes(String(req.user?.role || '').toLowerCase())
    || hasPermission(req.user, 'EDIT_BANK_DETAILS') || hasPermission(req.user, 'MANAGE_ROLES');
}
function canApprove(req) { return hasPermission(req.user, 'APPROVE_PAYMENT'); }
function audit(req, values) {
  return { actorId:req.user?.id, ipAddress:req.ip, userAgent:req.get('user-agent'), module:'banking_os', ...values };
}
function fail(res, error, fallback) {
  console.error(fallback, error);
  return res.status(error.statusCode || 500).json({ message:error.statusCode ? error.message : fallback, code:error.code || 'BANKING_OS_ERROR' });
}
function httpError(message, statusCode=400, code='BANKING_OS_INVALID') {
  return Object.assign(new Error(message), { statusCode, code });
}

async function accountAccessRows(userId) {
  const [rows] = await pool.query('SELECT * FROM banking_user_account_access WHERE user_id=?', [userId]);
  return rows;
}
async function visibleAccounts(req) {
  const [accounts] = await pool.query(
    `SELECT id,nickname,institution,account_number_masked,currency,ownership_scope,account_type,connection_type,connection_status,
            current_ledger_balance,available_balance,last_synced_at,created_by
       FROM bank_accounts WHERE status='ACTIVE' ORDER BY ownership_scope,nickname`
  );
  const grants = await accountAccessRows(req.user.id);
  const byId = new Map(grants.map((g) => [Number(g.bank_account_id), g]));
  return accounts.filter((account) => {
    if (String(account.ownership_scope).toUpperCase() === 'PERSONAL') return Number(account.created_by) === Number(req.user.id);
    if (isBankAdmin(req) || hasPermission(req.user, 'VIEW_BUSINESS_BANKING')) return true;
    return Number(byId.get(Number(account.id))?.can_view || 0) === 1;
  }).map((account) => ({ ...account, user_access: byId.get(Number(account.id)) || null }));
}
async function assertAccountVisible(req, accountId, action='view') {
  if (!accountId) return null;
  const accounts = await visibleAccounts(req);
  const account = accounts.find((item) => Number(item.id) === Number(accountId));
  if (!account) throw httpError('You do not have access to that banking account.', 403, 'BANK_ACCOUNT_ACCESS_DENIED');
  if (action === 'prepare' && !isBankAdmin(req) && !hasPermission(req.user, 'EDIT_FINANCE')) {
    if (Number(account.user_access?.can_prepare_payments || 0) !== 1) throw httpError('Payment preparation access is required for this account.', 403, 'PAYMENT_PREPARE_DENIED');
  }
  if (action === 'approve' && !isBankAdmin(req) && !canApprove(req) && Number(account.user_access?.can_approve_payments || 0) !== 1) {
    throw httpError('Payment approval access is required for this account.', 403, 'PAYMENT_APPROVAL_DENIED');
  }
  return account;
}
function capabilities() {
  const selected = selectedProvider() || 'BASIQ';
  const option = providerOptions().find((p) => p.key === selected);
  return {
    open_banking: {
      provider:selected,
      environment:environment(),
      configured:Boolean(option?.configured),
      live_sync_enabled:liveSyncEnabled(),
      accounts:true,
      balances:true,
      transactions:true,
      consent:true
    },
    payment_rails: {
      external_transfer:false,
      payid:false,
      bpay:false,
      international_transfer:false,
      card_issuing:false,
      virtual_cards:false,
      card_freeze:false,
      cash_deposit:false,
      reason:'Current provider integration is read/sync focused. These controls stay capability-gated until a verified write/payment/card provider is connected.'
    },
    platform_owned: {
      payment_workflow:true,
      approvals:true,
      scheduled_obligations:true,
      beneficiaries:true,
      money_spaces:true,
      budgets:true,
      account_level_user_access:true,
      finance_intelligence:true,
      audit_history:true
    }
  };
}

exports.getDashboard = async (req, res) => {
  try {
    const accounts = await visibleAccounts(req);
    const businessVisible = isBankAdmin(req) || hasPermission(req.user, 'VIEW_BUSINESS_BANKING');
    const [spaces] = await pool.query(
      `SELECT * FROM banking_money_spaces
        WHERE status='ACTIVE' AND ((ownership_scope='PERSONAL' AND created_by=?) OR (ownership_scope='BUSINESS' AND ?=1))
        ORDER BY ownership_scope,name`,
      [req.user.id, businessVisible ? 1 : 0]
    );
    const [beneficiaries] = await pool.query(
      `SELECT id,beneficiary_uid,created_by,ownership_scope,name,nickname,bank_name,bsb_masked,account_masked,payid_masked,currency,trusted,status,created_at
         FROM banking_beneficiaries
        WHERE status='ACTIVE' AND ((ownership_scope='PERSONAL' AND created_by=?) OR (ownership_scope='BUSINESS' AND ?=1))
        ORDER BY trusted DESC,name`,
      [req.user.id, businessVisible ? 1 : 0]
    );
    const paymentWhere = businessVisible
      ? "(ownership_scope='BUSINESS' OR created_by=?)"
      : 'created_by=?';
    const [payments] = await pool.query(
      `SELECT p.*,u.name AS created_by_name
         FROM banking_payment_requests p LEFT JOIN users u ON u.id=p.created_by
        WHERE ${paymentWhere}
        ORDER BY FIELD(p.status,'PENDING_APPROVAL','READY_FOR_EXECUTION','SCHEDULED','DRAFT','APPROVED','COMPLETED','REJECTED','CANCELLED'),COALESCE(p.due_date,'9999-12-31'),p.created_at DESC
        LIMIT 150`,
      [req.user.id]
    );
    const [[prefs]] = await pool.query('SELECT * FROM banking_alert_preferences WHERE user_id=? LIMIT 1', [req.user.id]);
    const pendingApproval = payments.filter((p) => p.status === 'PENDING_APPROVAL' && Number(p.created_by) !== Number(req.user.id));
    const upcoming = payments.filter((p) => ['PENDING_APPROVAL','APPROVED','READY_FOR_EXECUTION','SCHEDULED'].includes(p.status));
    const upcomingByCurrency = {};
    for (const p of upcoming) upcomingByCurrency[p.currency] = money((upcomingByCurrency[p.currency] || 0) + Number(p.amount || 0));
    const spaceGapByCurrency = {};
    for (const s of spaces) {
      const gap = Math.max(0, Number(s.target_amount || 0) - Number(s.allocated_amount || 0));
      spaceGapByCurrency[s.currency] = money((spaceGapByCurrency[s.currency] || 0) + gap);
    }
    return res.json({
      capabilities:capabilities(),
      access:{
        role:req.user.role,
        can_manage_team:isBankAdmin(req),
        can_prepare:hasPermission(req.user,'EDIT_FINANCE') || isBankAdmin(req),
        can_approve:canApprove(req) || isBankAdmin(req),
        can_manage_bank:isBankAdmin(req)
      },
      accounts, spaces, beneficiaries, payments,
      alerts:prefs || {
        low_balance_threshold:null, large_transaction_threshold:null,
        notify_budget:1, notify_payments:1, notify_bank_sync:1, notify_unusual_activity:1
      },
      operating_intelligence:{
        pending_approvals:pendingApproval.length,
        drafts:payments.filter((p)=>p.status==='DRAFT').length,
        ready_for_execution:payments.filter((p)=>p.status==='READY_FOR_EXECUTION').length,
        upcoming_obligations_by_currency:upcomingByCurrency,
        money_space_funding_gap_by_currency:spaceGapByCurrency,
        overdue:payments.filter((p)=>p.due_date && p.due_date < new Date().toISOString().slice(0,10) && !['COMPLETED','REJECTED','CANCELLED'].includes(p.status)).length
      }
    });
  } catch (error) { return fail(res,error,'Failed to load Banking OS'); }
};

exports.createSpace = async (req,res) => {
  try {
    const name=clean(req.body.name,120); if(!name) throw httpError('Space name is required.');
    const ownershipScope=scope(req.body.ownership_scope);
    if(ownershipScope==='BUSINESS' && !hasPermission(req.user,'EDIT_FINANCE') && !isBankAdmin(req)) throw httpError('Business finance edit access is required.',403);
    const target=req.body.target_amount == null || req.body.target_amount === '' ? null : money(req.body.target_amount);
    const allocated=money(req.body.allocated_amount);
    const reserve=money(req.body.minimum_reserve);
    if(allocated<0 || reserve<0 || (target!=null && target<0)) throw httpError('Amounts cannot be negative.');
    const spaceUid=uid('SPACE');
    await pool.query(
      `INSERT INTO banking_money_spaces
       (space_uid,created_by,ownership_scope,name,purpose,currency,target_amount,allocated_amount,minimum_reserve)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [spaceUid,req.user.id,ownershipScope,name,clean(req.body.purpose,255)||null,currency(req.body.currency),target,allocated,reserve]
    );
    await logAudit(pool,audit(req,{action:'BANKING_SPACE_CREATED',recordType:'banking_money_space',recordId:spaceUid,newValue:{name,ownership_scope:ownershipScope,target_amount:target,allocated_amount:allocated}}));
    return res.status(201).json({message:'Money Space created.',space_uid:spaceUid});
  } catch(error){return fail(res,error,'Failed to create Money Space');}
};

exports.updateSpace = async (req,res) => {
  try {
    const uidValue=clean(req.params.uid,80);
    const [[existing]]=await pool.query('SELECT * FROM banking_money_spaces WHERE space_uid=? AND status=\'ACTIVE\' LIMIT 1',[uidValue]);
    if(!existing) throw httpError('Money Space not found.',404);
    if(existing.ownership_scope==='PERSONAL' && Number(existing.created_by)!==Number(req.user.id)) throw httpError('You cannot change another user\'s personal Space.',403);
    if(existing.ownership_scope==='BUSINESS' && !hasPermission(req.user,'EDIT_FINANCE') && !isBankAdmin(req)) throw httpError('Business finance edit access is required.',403);
    const next={
      name:clean(req.body.name || existing.name,120),
      purpose:req.body.purpose===undefined?existing.purpose:(clean(req.body.purpose,255)||null),
      target:req.body.target_amount===undefined?existing.target_amount:(req.body.target_amount===''?null:money(req.body.target_amount)),
      allocated:req.body.allocated_amount===undefined?existing.allocated_amount:money(req.body.allocated_amount),
      reserve:req.body.minimum_reserve===undefined?existing.minimum_reserve:money(req.body.minimum_reserve)
    };
    if(Number(next.allocated)<0||Number(next.reserve)<0||(next.target!=null&&Number(next.target)<0)) throw httpError('Amounts cannot be negative.');
    await pool.query('UPDATE banking_money_spaces SET name=?,purpose=?,target_amount=?,allocated_amount=?,minimum_reserve=?,updated_at=NOW() WHERE id=?',[next.name,next.purpose,next.target,next.allocated,next.reserve,existing.id]);
    await logAudit(pool,audit(req,{action:'BANKING_SPACE_UPDATED',recordType:'banking_money_space',recordId:uidValue,oldValue:existing,newValue:next}));
    return res.json({message:'Money Space updated.'});
  } catch(error){return fail(res,error,'Failed to update Money Space');}
};

exports.createBeneficiary = async (req,res) => {
  try {
    const name=clean(req.body.name,180); if(!name) throw httpError('Beneficiary name is required.');
    const ownershipScope=scope(req.body.ownership_scope);
    if(ownershipScope==='BUSINESS' && !hasPermission(req.user,'EDIT_FINANCE') && !isBankAdmin(req)) throw httpError('Business finance edit access is required.',403);
    const beneficiaryUid=uid('BEN');
    await pool.query(
      `INSERT INTO banking_beneficiaries
       (beneficiary_uid,created_by,ownership_scope,name,nickname,bank_name,bsb_masked,account_masked,payid_masked,currency,trusted)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [beneficiaryUid,req.user.id,ownershipScope,name,clean(req.body.nickname,120)||null,clean(req.body.bank_name,180)||null,
       clean(req.body.bsb_masked,32)||null,clean(req.body.account_masked,64)||null,clean(req.body.payid_masked,180)||null,currency(req.body.currency),req.body.trusted?1:0]
    );
    await logAudit(pool,audit(req,{action:'BANKING_BENEFICIARY_CREATED',recordType:'banking_beneficiary',recordId:beneficiaryUid,newValue:{name,ownership_scope:ownershipScope,trusted:Boolean(req.body.trusted)}}));
    return res.status(201).json({message:'Beneficiary saved.',beneficiary_uid:beneficiaryUid});
  }catch(error){return fail(res,error,'Failed to save beneficiary');}
};

exports.createPayment = async (req,res) => {
  try {
    const amount=money(req.body.amount); if(amount<=0) throw httpError('Payment amount must be greater than zero.');
    const ownershipScope=scope(req.body.ownership_scope);
    if(ownershipScope==='BUSINESS' && !hasPermission(req.user,'EDIT_FINANCE') && !isBankAdmin(req)) throw httpError('Business finance edit access is required.',403);
    const accountId=Number(req.body.bank_account_id||0)||null;
    if(accountId) await assertAccountVisible(req,accountId,'prepare');
    const payee=clean(req.body.payee_name,180); if(!payee) throw httpError('Payee is required.');
    const paymentType=clean(req.body.payment_type||'EXTERNAL',32).toUpperCase();
    const validTypes=new Set(['EXTERNAL','INTERNAL','BILL','PAYROLL','REIMBURSEMENT','REQUEST_MONEY']);
    if(!validTypes.has(paymentType)) throw httpError('Unsupported payment type.');
    const schedule=clean(req.body.schedule_type||'ONCE',32).toUpperCase();
    const validSchedules=new Set(['ONCE','WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','YEARLY']);
    if(!validSchedules.has(schedule)) throw httpError('Unsupported schedule.');
    const threshold=Number(process.env.HIGH_RISK_PAYMENT_THRESHOLD||5000);
    const required=ownershipScope==='BUSINESS' && amount>=threshold ? 2 : 1;
    const paymentUid=uid('PAY');
    await pool.query(
      `INSERT INTO banking_payment_requests
       (payment_uid,created_by,bank_account_id,beneficiary_id,ownership_scope,payment_type,payee_name,reference_text,amount,currency,due_date,schedule_type,status,required_approvals,provider_capability_required)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT',?,?)`,
      [paymentUid,req.user.id,accountId,Number(req.body.beneficiary_id||0)||null,ownershipScope,paymentType,payee,clean(req.body.reference_text,180)||null,
       amount,currency(req.body.currency),clean(req.body.due_date,10)||null,schedule,required,paymentType==='INTERNAL'?null:'PAYMENT_INITIATION']
    );
    await logAudit(pool,audit(req,{action:'BANKING_PAYMENT_DRAFT_CREATED',recordType:'banking_payment',recordId:paymentUid,newValue:{payee,amount,ownership_scope:ownershipScope,payment_type:paymentType,required_approvals:required}}));
    return res.status(201).json({message:'Payment draft created. No money has moved.',payment_uid:paymentUid,required_approvals:required});
  }catch(error){return fail(res,error,'Failed to create payment draft');}
};

exports.submitPayment = async (req,res) => {
  try {
    const uidValue=clean(req.params.uid,80);
    const [[payment]]=await pool.query('SELECT * FROM banking_payment_requests WHERE payment_uid=? LIMIT 1',[uidValue]);
    if(!payment) throw httpError('Payment not found.',404);
    if(Number(payment.created_by)!==Number(req.user.id) && !isBankAdmin(req)) throw httpError('Only the preparer or banking administrator can submit this payment.',403);
    if(payment.status!=='DRAFT') throw httpError('Only draft payments can be submitted.',409);
    await pool.query("UPDATE banking_payment_requests SET status='PENDING_APPROVAL',submitted_at=NOW(),updated_at=NOW() WHERE id=?",[payment.id]);
    await logAudit(pool,audit(req,{action:'BANKING_PAYMENT_SUBMITTED',recordType:'banking_payment',recordId:uidValue,oldValue:{status:'DRAFT'},newValue:{status:'PENDING_APPROVAL'}}));
    return res.json({message:'Payment submitted for approval. No money has moved.'});
  }catch(error){return fail(res,error,'Failed to submit payment');}
};

exports.decidePayment = async (req,res) => {
  let db;
  try {
    const decision=clean(req.body.decision,16).toUpperCase();
    if(!['APPROVE','REJECT'].includes(decision)) throw httpError('Decision must be APPROVE or REJECT.');
    if(!canApprove(req) && !isBankAdmin(req)) throw httpError('Payment approval permission is required.',403);
    db=await pool.getConnection(); await db.beginTransaction();
    const [[payment]]=await db.query('SELECT * FROM banking_payment_requests WHERE payment_uid=? FOR UPDATE',[clean(req.params.uid,80)]);
    if(!payment) throw httpError('Payment not found.',404);
    if(payment.status!=='PENDING_APPROVAL') throw httpError('Payment is not awaiting approval.',409);
    if(Number(payment.created_by)===Number(req.user.id)) throw httpError('Separation of duties prevents approving a payment you prepared.',403,'SELF_APPROVAL_BLOCKED');
    if(payment.bank_account_id) await assertAccountVisible(req,payment.bank_account_id,'approve');
    await db.query(
      `INSERT INTO banking_payment_approvals (payment_id,approver_user_id,decision,note)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE decision=VALUES(decision),note=VALUES(note),created_at=NOW()`,
      [payment.id,req.user.id,decision,clean(req.body.note,500)||null]
    );
    if(decision==='REJECT'){
      await db.query("UPDATE banking_payment_requests SET status='REJECTED',updated_at=NOW() WHERE id=?",[payment.id]);
    } else {
      const [[count]]=await db.query("SELECT COUNT(*) AS total FROM banking_payment_approvals WHERE payment_id=? AND decision='APPROVE'",[payment.id]);
      const approved=Number(count.total||0);
      const final=approved>=Number(payment.required_approvals||1);
      await db.query(
        `UPDATE banking_payment_requests
            SET approved_count=?,status=?,approved_at=CASE WHEN ? THEN NOW() ELSE approved_at END,updated_at=NOW()
          WHERE id=?`,
        [approved,final?'READY_FOR_EXECUTION':'PENDING_APPROVAL',final?1:0,payment.id]
      );
    }
    await logAudit(db,audit(req,{action:`BANKING_PAYMENT_${decision}`,recordType:'banking_payment',recordId:payment.payment_uid,newValue:{decision,note:clean(req.body.note,500)||null}}));
    await db.commit();
    return res.json({message:decision==='REJECT'?'Payment rejected.':'Approval recorded. Payment execution remains capability-gated; no money has moved.'});
  }catch(error){if(db)await db.rollback();return fail(res,error,'Failed to record payment decision');}
  finally{db?.release();}
};

exports.getTeam = async (req,res) => {
  try {
    if(!isBankAdmin(req)) return res.json({can_manage:false,users:[],grants:[]});
    const [users]=await pool.query(
      `SELECT id,name,email,role,department,active,account_status
         FROM users WHERE deleted_at IS NULL AND active=1 ORDER BY name,email`
    );
    const [grants]=await pool.query(
      `SELECT a.*,u.name AS user_name,u.email,ba.nickname AS account_name,ba.ownership_scope
         FROM banking_user_account_access a
         JOIN users u ON u.id=a.user_id
         JOIN bank_accounts ba ON ba.id=a.bank_account_id
        ORDER BY u.name,ba.nickname`
    );
    return res.json({can_manage:true,users,grants});
  }catch(error){return fail(res,error,'Failed to load banking team access');}
};

exports.saveTeamAccess = async (req,res) => {
  try {
    if(!isBankAdmin(req)) throw httpError('Banking access management permission is required.',403);
    const userId=Number(req.params.userId); const accountId=Number(req.body.bank_account_id);
    if(!userId||!accountId) throw httpError('User and bank account are required.');
    if(Number(userId)===Number(req.user.id)) throw httpError('Use another authorised administrator to change your own banking access.',403);
    const level=clean(req.body.access_level||'VIEW',16).toUpperCase();
    const levels={VIEW:[1,0,0,0],PREPARE:[1,1,0,0],APPROVE:[1,0,1,0],MANAGE:[1,1,1,1]};
    if(!levels[level]) throw httpError('Choose VIEW, PREPARE, APPROVE or MANAGE.');
    const [[user]]=await pool.query('SELECT id,name,email FROM users WHERE id=? AND active=1 AND deleted_at IS NULL LIMIT 1',[userId]);
    if(!user) throw httpError('Active user not found.',404);
    const [[account]]=await pool.query("SELECT id,nickname,ownership_scope FROM bank_accounts WHERE id=? AND status='ACTIVE' LIMIT 1",[accountId]);
    if(!account||String(account.ownership_scope).toUpperCase()==='PERSONAL') throw httpError('Only business bank accounts can be delegated.',400);
    const [view,prepare,approve,manage]=levels[level];
    await pool.query(
      `INSERT INTO banking_user_account_access
       (user_id,bank_account_id,access_level,can_view,can_prepare_payments,can_approve_payments,can_manage,created_by)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE access_level=VALUES(access_level),can_view=VALUES(can_view),can_prepare_payments=VALUES(can_prepare_payments),
       can_approve_payments=VALUES(can_approve_payments),can_manage=VALUES(can_manage),updated_at=NOW()`,
      [userId,accountId,level,view,prepare,approve,manage,req.user.id]
    );
    await logAudit(pool,audit(req,{action:'BANKING_USER_ACCESS_CHANGED',recordType:'banking_user_access',recordId:`${userId}:${accountId}`,newValue:{user_id:userId,account_id:accountId,access_level:level}}));
    return res.json({message:`${user.name || user.email} banking access set to ${level}.`});
  }catch(error){return fail(res,error,'Failed to save banking team access');}
};

exports.saveAlerts = async (req,res) => {
  try {
    const low=req.body.low_balance_threshold===''||req.body.low_balance_threshold==null?null:money(req.body.low_balance_threshold);
    const large=req.body.large_transaction_threshold===''||req.body.large_transaction_threshold==null?null:money(req.body.large_transaction_threshold);
    if((low!=null&&low<0)||(large!=null&&large<0)) throw httpError('Alert thresholds cannot be negative.');
    await pool.query(
      `INSERT INTO banking_alert_preferences
       (user_id,low_balance_threshold,large_transaction_threshold,notify_budget,notify_payments,notify_bank_sync,notify_unusual_activity)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE low_balance_threshold=VALUES(low_balance_threshold),large_transaction_threshold=VALUES(large_transaction_threshold),
       notify_budget=VALUES(notify_budget),notify_payments=VALUES(notify_payments),notify_bank_sync=VALUES(notify_bank_sync),
       notify_unusual_activity=VALUES(notify_unusual_activity),updated_at=NOW()`,
      [req.user.id,low,large,req.body.notify_budget!==false?1:0,req.body.notify_payments!==false?1:0,req.body.notify_bank_sync!==false?1:0,req.body.notify_unusual_activity!==false?1:0]
    );
    return res.json({message:'Banking alert preferences saved.'});
  }catch(error){return fail(res,error,'Failed to save banking alerts');}
};

exports.capabilities = async (req,res) => res.json(capabilities());
