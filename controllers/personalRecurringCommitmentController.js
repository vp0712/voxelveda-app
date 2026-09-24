'use strict';

const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { logAudit }=require('../services/auditService');

const DECISIONS=new Set(['KEEP','REVIEW','CANCEL_PLANNED']);
const ESSENTIALITY=new Set(['UNKNOWN','ESSENTIAL','DISCRETIONARY']);
const AUTO_RENEW=new Set(['UNKNOWN','YES','NO']);
const FACTOR={WEEKLY:52,FORTNIGHTLY:26,MONTHLY:12,QUARTERLY:4,YEARLY:1};

function uid(req){
  const value=req.user?.id??req.user?.user_id;
  if(value===undefined||value===null||value==='')throw new FinanceError('User identity unavailable.',401,'USER_REQUIRED');
  return String(value);
}
function clean(v,max=500){const x=String(v??'').trim();return x?x.slice(0,max):null}
function dateOnly(v,label='Date'){const x=String(v||'').trim();if(!x)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(x))throw new FinanceError(label+' must use YYYY-MM-DD.',400,'INVALID_COMMITMENT_DATE');return x}
function intRange(v,min,max,label){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new FinanceError(label+' must be between '+min+' and '+max+'.',400,'INVALID_COMMITMENT_NUMBER');return n}
function normalize(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function daysFromToday(v){
  if(!v)return null;
  const d=new Date(String(v).slice(0,10)+'T00:00:00Z'),t=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
  if(Number.isNaN(d.getTime()))return null;
  return Math.round((d-t)/86400000);
}
function minusDays(v,n){
  if(!v)return null;
  const d=new Date(String(v).slice(0,10)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-Number(n||0));return d.toISOString().slice(0,10);
}
function annualized(value,frequency){return Math.round(Number(value||0)*(FACTOR[String(frequency||'').toUpperCase()]||0)*10000)/10000}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'PERSONAL_COMMITMENT_CONTROL_FAILED'});
}
function audit(req,action,id,oldValue,newValue){
  return {actorId:Number(uid(req))||null,action,module:'finance',recordType:'personal_recurring_commitment_control',recordId:String(id),oldValue,newValue,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function bankEvidence(item,transactions){
  const key=normalize(item.counterparty||item.name);
  if(key.length<4)return {match_basis:'NONE',matched_count:0,possible_price_change:false};
  const matched=[];
  for(const tx of transactions){
    if(String(tx.currency||'AUD').toUpperCase()!==String(item.currency||'AUD').toUpperCase())continue;
    const merchant=normalize(tx.merchant_name),description=normalize(tx.description);
    let confidence='';
    if(merchant&&merchant===key)confidence='EXACT_MERCHANT';
    else if(merchant&&key.length>=5&&(merchant.includes(key)||key.includes(merchant)))confidence='MERCHANT_NAME';
    else if(description&&key.length>=6&&description.includes(key))confidence='DESCRIPTION';
    if(confidence)matched.push({...tx,match_confidence:confidence});
  }
  matched.sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))||Number(b.id)-Number(a.id));
  const latest=matched[0]||null,previous=matched[1]||null;
  let possible=false,change=0,percent=null;
  if(latest&&previous){
    change=Math.round((Number(latest.debit||0)-Number(previous.debit||0))*10000)/10000;
    percent=Number(previous.debit||0)>0?Math.round(change/Number(previous.debit)*10000)/100:null;
    possible=Math.abs(change)>0.01&&Math.abs(Number(percent||0))>=2;
  }
  return {
    match_basis:latest?.match_confidence||'NONE',
    latest:latest?{transaction_id:latest.id,date:latest.transaction_date,merchant_name:latest.merchant_name||null,description:latest.description||null,amount:Number(latest.debit||0),currency:latest.currency,match_confidence:latest.match_confidence}:null,
    previous:previous?{transaction_id:previous.id,date:previous.transaction_date,amount:Number(previous.debit||0),currency:previous.currency}:null,
    matched_count:matched.length,
    price_change_amount:change,
    price_change_percent:percent,
    possible_price_change:possible,
    latest_vs_schedule_amount:latest?Math.round((Number(latest.debit||0)-Number(item.amount||0))*10000)/10000:null
  };
}

exports.getCenter=async(req,res)=>{
  try{
    const owner=uid(req);
    const [rows,transactions]=await Promise.all([
      pool.query(`SELECT r.id,r.name,r.item_type,r.amount,r.currency,r.frequency,r.next_due_date,r.category,r.counterparty,r.reminder_days,r.active,r.last_completed_date,r.note,r.created_at,r.updated_at,
          m.essentiality,m.lifecycle_decision,m.auto_renew,m.renewal_date,m.contract_end_date,m.cancellation_notice_days,m.cancellation_reference,m.decision_note,m.reviewed_at,m.updated_at AS control_updated_at
        FROM personal_money_recurring_items r
        LEFT JOIN personal_money_recurring_control m ON m.recurring_id=r.id AND m.user_id=r.user_id
        WHERE r.user_id=? ORDER BY r.active DESC,r.next_due_date,r.name`,[owner]).then(([x])=>x),
      pool.query(`SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.currency
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
          AND bt.debit>0 AND bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 370 DAY) AND bt.archived_at IS NULL
        ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 1500`,[Number(owner)||0]).then(([x])=>x)
    ]);
    const byCurrency={},summary={active:0,subscriptions:0,review:0,cancel_planned:0,renewal_30:0,cancellation_deadline_30:0,possible_price_change:0};
    const items=rows.map(row=>{
      const annual=String(row.item_type).toUpperCase()==='INCOME'?0:annualized(row.amount,row.frequency);
      const decision=String(row.lifecycle_decision||'KEEP').toUpperCase();
      const essentiality=String(row.essentiality||'UNKNOWN').toUpperCase();
      const autoRenew=String(row.auto_renew||'UNKNOWN').toUpperCase();
      const notice=Number(row.cancellation_notice_days??0);
      const cancellationDeadline=row.renewal_date?minusDays(row.renewal_date,notice):null;
      const renewalDays=daysFromToday(row.renewal_date),deadlineDays=daysFromToday(cancellationDeadline);
      const evidence=String(row.item_type).toUpperCase()==='INCOME'?{match_basis:'NONE',matched_count:0,possible_price_change:false}:bankEvidence(row,transactions);
      let controlStatus='CLEAR';
      if(decision==='CANCEL_PLANNED'&&deadlineDays!==null&&deadlineDays<0)controlStatus='HIGH';
      else if(decision==='REVIEW'||evidence.possible_price_change||(deadlineDays!==null&&deadlineDays>=0&&deadlineDays<=30)||(renewalDays!==null&&renewalDays>=0&&renewalDays<=30))controlStatus='WATCH';
      if(Number(row.active)){summary.active++;if(row.item_type==='SUBSCRIPTION')summary.subscriptions++}
      if(decision==='REVIEW')summary.review++;
      if(decision==='CANCEL_PLANNED')summary.cancel_planned++;
      if(renewalDays!==null&&renewalDays>=0&&renewalDays<=30)summary.renewal_30++;
      if(deadlineDays!==null&&deadlineDays>=0&&deadlineDays<=30)summary.cancellation_deadline_30++;
      if(evidence.possible_price_change)summary.possible_price_change++;
      const c=String(row.currency||'AUD').toUpperCase();
      if(Number(row.active)&&row.item_type!=='INCOME'){
        byCurrency[c]||={annual_commitment:0,monthly_equivalent:0,active_outgoing:0,subscriptions:0};
        byCurrency[c].annual_commitment+=annual;byCurrency[c].monthly_equivalent+=annual/12;byCurrency[c].active_outgoing++;
        if(row.item_type==='SUBSCRIPTION')byCurrency[c].subscriptions++;
      }
      return {...row,amount:Number(row.amount||0),annualized_cost:annual,essentiality,lifecycle_decision:decision,auto_renew:autoRenew,cancellation_notice_days:notice,cancellation_deadline:cancellationDeadline,days_to_renewal:renewalDays,days_to_cancellation_deadline:deadlineDays,control_status:controlStatus,bank_evidence:evidence};
    });
    for(const x of Object.values(byCurrency)){x.annual_commitment=Math.round(x.annual_commitment*10000)/10000;x.monthly_equivalent=Math.round(x.monthly_equivalent*10000)/10000}
    return res.json({
      rule:'Commitment Control organises recurring obligations and decisions. It never pays, renews or cancels a service automatically.',
      bank_evidence_rule:'Recent bank charges are heuristic evidence suggestions only. They never overwrite the saved recurring amount or create a transaction.',
      currency_rule:'Commitment totals stay separated by native currency.',
      summary,by_currency:byCurrency,items
    });
  }catch(error){return fail(res,error,'Failed to load recurring Commitment Control.')}
};

exports.saveControl=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const owner=uid(req);await db.beginTransaction();
    const [[item]]=await db.query('SELECT id,user_id,name,item_type,amount,currency,frequency,active FROM personal_money_recurring_items WHERE id=? AND user_id=? LIMIT 1 FOR UPDATE',[String(req.params.id||''),owner]);
    if(!item)throw new FinanceError('Recurring item not found.',404,'RECURRING_ITEM_NOT_FOUND');
    const [[before]]=await db.query('SELECT * FROM personal_money_recurring_control WHERE recurring_id=? AND user_id=? LIMIT 1 FOR UPDATE',[item.id,owner]);
    const decision=String(req.body.lifecycle_decision||'KEEP').trim().toUpperCase();
    const essentiality=String(req.body.essentiality||'UNKNOWN').trim().toUpperCase();
    const autoRenew=String(req.body.auto_renew||'UNKNOWN').trim().toUpperCase();
    if(!DECISIONS.has(decision))throw new FinanceError('Choose Keep, Review or Cancel Planned.',400,'INVALID_COMMITMENT_DECISION');
    if(!ESSENTIALITY.has(essentiality))throw new FinanceError('Choose Essential, Discretionary or Unknown.',400,'INVALID_COMMITMENT_ESSENTIALITY');
    if(!AUTO_RENEW.has(autoRenew))throw new FinanceError('Auto-renew must be Yes, No or Unknown.',400,'INVALID_COMMITMENT_AUTO_RENEW');
    const renewal=dateOnly(req.body.renewal_date,'Renewal date');
    const end=dateOnly(req.body.contract_end_date,'Contract end date');
    const notice=intRange(req.body.cancellation_notice_days??0,0,365,'Cancellation notice');
    const values={essentiality,lifecycle_decision:decision,auto_renew:autoRenew,renewal_date:renewal,contract_end_date:end,cancellation_notice_days:notice,cancellation_reference:clean(req.body.cancellation_reference,500),decision_note:clean(req.body.decision_note,700)};
    await db.query(`INSERT INTO personal_money_recurring_control
      (recurring_id,user_id,essentiality,lifecycle_decision,auto_renew,renewal_date,contract_end_date,cancellation_notice_days,cancellation_reference,decision_note,reviewed_at,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?)
      ON DUPLICATE KEY UPDATE essentiality=VALUES(essentiality),lifecycle_decision=VALUES(lifecycle_decision),auto_renew=VALUES(auto_renew),
        renewal_date=VALUES(renewal_date),contract_end_date=VALUES(contract_end_date),cancellation_notice_days=VALUES(cancellation_notice_days),
        cancellation_reference=VALUES(cancellation_reference),decision_note=VALUES(decision_note),reviewed_at=NOW(),updated_by=VALUES(updated_by)`,
      [item.id,owner,values.essentiality,values.lifecycle_decision,values.auto_renew,values.renewal_date,values.contract_end_date,values.cancellation_notice_days,values.cancellation_reference,values.decision_note,Number(owner)||null]);
    await logAudit(db,audit(req,'PERSONAL_RECURRING_CONTROL_UPDATED',item.id,before||null,{...values,name:item.name,currency:item.currency,scheduled_amount:Number(item.amount||0)}));
    await db.commit();
    return res.json({message:'Recurring commitment control saved. No service was paid, renewed, cancelled or repriced.',control:values});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save recurring commitment control.');}
  finally{db.release()}
};
