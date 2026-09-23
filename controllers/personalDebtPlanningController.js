'use strict';

const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');

const INTEREST_MODES=new Set(['NONE','REFERENCE_ONLY']);
const FREQUENCIES=new Set(['NONE','WEEKLY','FORTNIGHTLY','MONTHLY','QUARTERLY','YEARLY']);
const FACTOR={NONE:0,WEEKLY:52,FORTNIGHTLY:26,MONTHLY:12,QUARTERLY:4,YEARLY:1};

function uid(req){return privacy.userId(req)}
function clean(value,max=500){const x=String(value??'').trim();return x?x.slice(0,max):null}
function dateOnly(value,label='Date'){const x=String(value||'').trim();if(!x)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(x))throw new FinanceError(`${label} must use YYYY-MM-DD.`,400,'INVALID_DEBT_DATE');return x}
function amount(value,label='Amount'){const n=Number(value||0);if(!Number.isFinite(n)||n<0)throw new FinanceError(`${label} must be a valid non-negative amount.`,400,'INVALID_DEBT_AMOUNT');return Math.round(n*10000)/10000}
function rate(value){const n=Number(value||0);if(!Number.isFinite(n)||n<0||n>100)throw new FinanceError('Annual rate reference must be between 0% and 100%.',400,'INVALID_DEBT_RATE');return Math.round(n*10000)/10000}
function reminder(value){const n=Number(value??14);if(!Number.isInteger(n)||n<0||n>365)throw new FinanceError('Reminder window must be between 0 and 365 days.',400,'INVALID_DEBT_REMINDER');return n}
function audit(req,action,id,oldValue,newValue){return {actorId:uid(req),action,module:'finance',recordType:'personal_money_debt_terms',recordId:String(id),oldValue,newValue,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null}}
function fail(res,error,message){if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});console.error(message,error);return res.status(500).json({message,code:'PERSONAL_DEBT_PLANNER_FAILED'})}
async function debt(db,id,userId,{forUpdate=false}={}){
 const suffix=forUpdate?' FOR UPDATE':'';
 const [[row]]=await db.query(`SELECT * FROM personal_money_debts WHERE id=? AND user_id=? LIMIT 1${suffix}`,[String(id||''),String(userId)]);
 if(!row)throw new FinanceError('Borrowed/lent record not found.',404,'PERSONAL_DEBT_NOT_FOUND');
 return row;
}
function daysFromToday(value){
 if(!value)return null;
 const d=new Date(String(value).slice(0,10)+'T00:00:00Z'),today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
 if(Number.isNaN(d.getTime()))return null;
 return Math.round((d-today)/86400000);
}
function enrich(row){
 const frequency=String(row.repayment_frequency||'NONE').toUpperCase(),annualFactor=FACTOR[frequency]||0;
 const outstanding=Number(row.outstanding_amount||0),scheduled=Number(row.scheduled_payment||0),annualRate=Number(row.annual_interest_rate||0);
 const monthlyEquivalent=annualFactor?scheduled*annualFactor/12:0;
 const rateReference=String(row.interest_mode||'NONE')==='REFERENCE_ONLY'?outstanding*annualRate/100:0;
 const next=row.next_payment_date||row.due_date||null,days=daysFromToday(next);
 return {...row,
  principal_amount:Number(row.principal_amount||0),outstanding_amount:outstanding,scheduled_payment:scheduled,annual_interest_rate:annualRate,
  scheduled_monthly_equivalent:Math.round(monthlyEquivalent*10000)/10000,
  estimated_annual_interest_reference:Math.round(rateReference*10000)/10000,
  next_control_date:next,days_to_next_control:days,
  overdue:Boolean(row.status!=='SETTLED'&&next&&days!==null&&days<0),
  due_within_30_days:Boolean(row.status!=='SETTLED'&&next&&days!==null&&days>=0&&days<=30)
 };
}

exports.getPlanner=async(req,res)=>{
 try{
  const owner=uid(req);
  const [rows]=await pool.query(`SELECT d.id,d.direction,d.counterparty,d.principal_amount,d.outstanding_amount,d.currency,d.due_date,d.status,d.note,d.created_at,d.updated_at,
      t.start_date,t.interest_mode,t.annual_interest_rate,t.repayment_frequency,t.scheduled_payment,t.next_payment_date,t.reminder_days,
      t.contact_reference,t.agreement_reference,t.updated_at AS terms_updated_at,
      COALESCE((SELECT SUM(p.amount) FROM personal_money_debt_payments p WHERE p.debt_id=d.id AND p.user_id=d.user_id),0) AS paid_total,
      (SELECT MAX(p.paid_at) FROM personal_money_debt_payments p WHERE p.debt_id=d.id AND p.user_id=d.user_id) AS last_payment_at,
      (SELECT COUNT(*) FROM personal_money_debt_payments p WHERE p.debt_id=d.id AND p.user_id=d.user_id) AS payment_count
    FROM personal_money_debts d LEFT JOIN personal_money_debt_terms t ON t.debt_id=d.id AND t.user_id=d.user_id
    WHERE d.user_id=? ORDER BY FIELD(d.status,'OPEN','PARTIAL','SETTLED'),COALESCE(t.next_payment_date,d.due_date) IS NULL,COALESCE(t.next_payment_date,d.due_date),d.created_at DESC`,[String(owner)]);
  const debts=rows.map(r=>({...enrich(r),paid_total:Number(r.paid_total||0),payment_count:Number(r.payment_count||0)}));
  const byCurrency={},people={};
  for(const d of debts){
    const c=String(d.currency||'AUD').toUpperCase();
    byCurrency[c]||={borrowed_open:0,lent_open:0,scheduled_monthly_equivalent:0,overdue_count:0,due_30_count:0,open_records:0};
    const s=byCurrency[c];
    if(d.status!=='SETTLED'){
      if(d.direction==='BORROWED')s.borrowed_open+=d.outstanding_amount;else s.lent_open+=d.outstanding_amount;
      s.scheduled_monthly_equivalent+=d.scheduled_monthly_equivalent;s.open_records++;
      if(d.overdue)s.overdue_count++;if(d.due_within_30_days)s.due_30_count++;
    }
    const key=String(d.counterparty||'Unknown')+'|'+c;
    people[key]||={counterparty:d.counterparty||'Unknown',currency:c,borrowed_open:0,lent_open:0,record_count:0,overdue_count:0,next_control_date:null};
    const p=people[key];p.record_count++;
    if(d.status!=='SETTLED'){
      if(d.direction==='BORROWED')p.borrowed_open+=d.outstanding_amount;else p.lent_open+=d.outstanding_amount;
      if(d.overdue)p.overdue_count++;
      if(d.next_control_date&&(!p.next_control_date||String(d.next_control_date)<String(p.next_control_date)))p.next_control_date=d.next_control_date;
    }
  }
  for(const x of Object.values(byCurrency))for(const k of ['borrowed_open','lent_open','scheduled_monthly_equivalent'])x[k]=Math.round(x[k]*10000)/10000;
  for(const x of Object.values(people))for(const k of ['borrowed_open','lent_open'])x[k]=Math.round(x[k]*10000)/10000;
  return res.json({
    privacy:'Owner-only People & Debt Control. Counterparties and repayment terms are not exposed to Company Finance users.',
    balance_rule:'Outstanding principal changes only when an actual repayment is recorded. Planning terms never silently change principal.',
    interest_rule:'REFERENCE_ONLY rates are planning references. Voxel Veda does not accrue, capitalise or post interest automatically.',
    currencies_rule:'Borrowed and lent amounts stay separated by native currency.',
    debts,by_currency:byCurrency,people:Object.values(people).sort((a,b)=>String(a.counterparty).localeCompare(String(b.counterparty)))
  });
 }catch(error){return fail(res,error,'Failed to load People & Debt Control.')}
};

exports.saveTerms=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  const owner=uid(req);await db.beginTransaction();const d=await debt(db,req.params.id,owner,{forUpdate:true});
  const [[before]]=await db.query('SELECT * FROM personal_money_debt_terms WHERE debt_id=? AND user_id=? LIMIT 1 FOR UPDATE',[d.id,String(owner)]);
  const interestMode=String(req.body.interest_mode||'NONE').trim().toUpperCase(),frequency=String(req.body.repayment_frequency||'NONE').trim().toUpperCase();
  if(!INTEREST_MODES.has(interestMode))throw new FinanceError('Interest mode must be None or Reference Only.',400,'INVALID_DEBT_INTEREST_MODE');
  if(!FREQUENCIES.has(frequency))throw new FinanceError('Choose a valid repayment frequency.',400,'INVALID_DEBT_REPAYMENT_FREQUENCY');
  const annualRate=interestMode==='NONE'?0:rate(req.body.annual_interest_rate),scheduled=frequency==='NONE'?0:amount(req.body.scheduled_payment,'Scheduled payment');
  if(frequency!=='NONE'&&scheduled<=0)throw new FinanceError('Enter the planned repayment amount for this frequency.',400,'DEBT_SCHEDULE_AMOUNT_REQUIRED');
  const next=frequency==='NONE'?null:dateOnly(req.body.next_payment_date,'Next payment date');
  if(frequency!=='NONE'&&!next)throw new FinanceError('Enter the next planned repayment date.',400,'DEBT_NEXT_PAYMENT_REQUIRED');
  const values={
    start_date:dateOnly(req.body.start_date,'Start date'),interest_mode:interestMode,annual_interest_rate:annualRate,repayment_frequency:frequency,
    scheduled_payment:scheduled,next_payment_date:next,reminder_days:reminder(req.body.reminder_days),
    contact_reference:clean(req.body.contact_reference,240),agreement_reference:clean(req.body.agreement_reference,500)
  };
  await db.query(`INSERT INTO personal_money_debt_terms
    (debt_id,user_id,start_date,interest_mode,annual_interest_rate,repayment_frequency,scheduled_payment,next_payment_date,reminder_days,contact_reference,agreement_reference)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE start_date=VALUES(start_date),interest_mode=VALUES(interest_mode),annual_interest_rate=VALUES(annual_interest_rate),
      repayment_frequency=VALUES(repayment_frequency),scheduled_payment=VALUES(scheduled_payment),next_payment_date=VALUES(next_payment_date),
      reminder_days=VALUES(reminder_days),contact_reference=VALUES(contact_reference),agreement_reference=VALUES(agreement_reference)`,
    [d.id,String(owner),values.start_date,values.interest_mode,values.annual_interest_rate,values.repayment_frequency,values.scheduled_payment,values.next_payment_date,values.reminder_days,values.contact_reference,values.agreement_reference]);
  await logAudit(db,audit(req,'PERSONAL_DEBT_TERMS_UPDATED',d.id,before||null,{...values,currency:d.currency,counterparty:d.counterparty}));
  await db.commit();return res.json({message:'Debt planning terms saved. Outstanding principal and payment history were not changed.',terms:values});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save debt planning terms.');}finally{db.release()}
};

exports.getStatement=async(req,res)=>{
 try{
  const owner=uid(req),d=await debt(pool,req.params.id,owner);
  const [[terms]]=await pool.query('SELECT * FROM personal_money_debt_terms WHERE debt_id=? AND user_id=? LIMIT 1',[d.id,String(owner)]);
  const [payments]=await pool.query(`SELECT p.id,p.wallet_id,p.amount,p.currency,p.paid_at,p.note,w.name AS wallet_name
    FROM personal_money_debt_payments p LEFT JOIN personal_money_wallets w ON w.id=p.wallet_id AND w.user_id=p.user_id
    WHERE p.debt_id=? AND p.user_id=? ORDER BY p.paid_at,p.created_at`,[d.id,String(owner)]);
  const paid=payments.reduce((sum,p)=>sum+Number(p.amount||0),0),row=enrich({...d,...(terms||{})});
  return res.json({
    statement_rule:'This is a Voxel Veda owner-only debt ledger statement, not a bank or lender statement.',
    interest_rule:'Rate references are not accrued or posted automatically.',
    debt:row,terms:terms||null,
    totals:{principal:Number(d.principal_amount||0),actual_repayments:Math.round(paid*10000)/10000,outstanding_principal:Number(d.outstanding_amount||0),currency:d.currency},
    payments:payments.map(p=>({...p,amount:Number(p.amount||0)}))
  });
 }catch(error){return fail(res,error,'Failed to load debt statement.')}
};
