'use strict';

const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { logAudit }=require('../services/auditService');

const REVIEW_STATES=new Set(['UNREVIEWED','CANDIDATE','NOT_CLAIMING','ASK_ACCOUNTANT']);
const EVIDENCE_STATES=new Set(['UNKNOWN','HAS_EVIDENCE','MISSING_EVIDENCE']);

function uid(req){
  const value=req.user?.id??req.user?.user_id;
  if(value===undefined||value===null||value==='')throw new FinanceError('User identity unavailable.',401,'USER_REQUIRED');
  return String(value);
}
function clean(v,max=1000){const x=String(v??'').trim();return x?x.slice(0,max):null}
function fyStart(value){
  if(value!==undefined&&value!==null&&value!==''){
    const n=Number(value);if(!Number.isInteger(n)||n<2000||n>2200)throw new FinanceError('Financial-year start must be a four-digit year.',400,'INVALID_FINANCIAL_YEAR');
    return n;
  }
  const d=new Date(),year=d.getUTCFullYear(),month=d.getUTCMonth()+1;
  return month>=7?year:year-1;
}
function round(v){return Math.round(Number(v||0)*100)/100}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'PERSONAL_TAX_CONTROL_FAILED'});
}
function audit(req,action,id,oldValue,newValue){
  return {actorId:Number(uid(req))||null,action,module:'finance',recordType:'personal_tax_review_control',recordId:String(id),oldValue,newValue,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}

exports.getCenter=async(req,res)=>{
  try{
    const owner=uid(req),year=fyStart(req.query.fy_start),start=`${year}-07-01`,end=`${year+1}-07-01`;
    const [rows]=await pool.query(`SELECT e.id,e.entry_type,e.amount,e.currency,e.category,e.counterparty,e.note,e.occurred_at,w.name AS wallet_name,
        c.review_status,c.evidence_status,c.review_note,c.accountant_question,c.reviewed_at,c.updated_at AS control_updated_at
      FROM personal_money_entries e
      JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
      LEFT JOIN personal_tax_review_control c ON c.entry_id=e.id AND c.user_id=e.user_id
      WHERE e.user_id=? AND e.occurred_at>=? AND e.occurred_at<?
      ORDER BY e.occurred_at DESC,e.created_at DESC`,[owner,start,end]);

    const summaryByCurrency={},categoryMap={},counts={total_entries:rows.length,review_candidates:0,unreviewed:0,candidate:0,not_claiming:0,ask_accountant:0,has_evidence:0,missing_evidence:0,unknown_evidence:0};
    const reviewItems=[];
    for(const row of rows){
      const c=String(row.currency||'AUD').toUpperCase(),amount=Number(row.amount||0),type=String(row.entry_type||'').toUpperCase();
      summaryByCurrency[c]||={recorded_income:0,recorded_expenses:0,cash_in:0,cash_out:0};
      if(type==='INCOME')summaryByCurrency[c].recorded_income+=amount;
      if(type==='EXPENSE')summaryByCurrency[c].recorded_expenses+=amount;
      if(type==='CASH_IN')summaryByCurrency[c].cash_in+=amount;
      if(type==='CASH_OUT')summaryByCurrency[c].cash_out+=amount;
      if(!['EXPENSE','CASH_OUT'].includes(type))continue;
      counts.review_candidates++;
      const reviewStatus=String(row.review_status||'UNREVIEWED').toUpperCase(),evidenceStatus=String(row.evidence_status||'UNKNOWN').toUpperCase();
      if(reviewStatus==='UNREVIEWED')counts.unreviewed++;
      if(reviewStatus==='CANDIDATE')counts.candidate++;
      if(reviewStatus==='NOT_CLAIMING')counts.not_claiming++;
      if(reviewStatus==='ASK_ACCOUNTANT')counts.ask_accountant++;
      if(evidenceStatus==='HAS_EVIDENCE')counts.has_evidence++;
      if(evidenceStatus==='MISSING_EVIDENCE')counts.missing_evidence++;
      if(evidenceStatus==='UNKNOWN')counts.unknown_evidence++;
      const key=c+'::'+String(row.category||'Uncategorised');
      categoryMap[key]||={currency:c,category:row.category||'Uncategorised',count:0,amount:0};
      categoryMap[key].count++;categoryMap[key].amount+=amount;
      reviewItems.push({...row,amount,review_status:reviewStatus,evidence_status:evidenceStatus});
    }
    for(const x of Object.values(summaryByCurrency))for(const k of Object.keys(x))x[k]=round(x[k]);
    for(const x of Object.values(categoryMap))x.amount=round(x.amount);
    const questions=reviewItems.filter(x=>x.review_status==='ASK_ACCOUNTANT').map(x=>({entry_id:x.id,occurred_at:x.occurred_at,category:x.category,counterparty:x.counterparty,amount:x.amount,currency:x.currency,question:x.accountant_question||x.review_note||'Review requested with accountant.'}));
    return res.json({
      privacy:'Owner-only PERSONAL Money tax-preparation control. Company finance transactions are not included.',
      financial_year:{start_year:year,label:`${year}-${String(year+1).slice(-2)}`,start_date:start,end_date:`${year+1}-06-30`},
      jurisdiction_note:'This uses an Australian-style 1 July to 30 June preparation window. It does not calculate taxable income, tax payable, tax liability or legal deductibility.',
      currency_rule:'Currencies remain separate. No ATO or other tax FX rate is assumed.',
      review_rule:'Review status and evidence flags are organisational preparation records only. They do not create a deduction or tax treatment.',
      summary_by_currency:summaryByCurrency,
      counts,
      categories:Object.values(categoryMap).sort((a,b)=>b.amount-a.amount),
      review_items:reviewItems,
      accountant_questions:questions
    });
  }catch(error){return fail(res,error,'Failed to load Personal Tax & Evidence Control.')}
};

exports.saveReview=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const owner=uid(req);await db.beginTransaction();
    const [[entry]]=await db.query(`SELECT e.id,e.entry_type,e.amount,e.currency,e.category,e.counterparty,e.occurred_at
      FROM personal_money_entries e WHERE e.id=? AND e.user_id=? LIMIT 1 FOR UPDATE`,[String(req.params.entryId||''),owner]);
    if(!entry)throw new FinanceError('Personal Money entry not found.',404,'PERSONAL_TAX_ENTRY_NOT_FOUND');
    if(!['EXPENSE','CASH_OUT'].includes(String(entry.entry_type).toUpperCase()))throw new FinanceError('Only Personal expense/cash-out review candidates can be classified here.',400,'PERSONAL_TAX_REVIEW_SCOPE');
    const reviewStatus=String(req.body.review_status||'UNREVIEWED').trim().toUpperCase(),evidenceStatus=String(req.body.evidence_status||'UNKNOWN').trim().toUpperCase();
    if(!REVIEW_STATES.has(reviewStatus))throw new FinanceError('Choose Unreviewed, Candidate, Not Claiming or Ask Accountant.',400,'INVALID_TAX_REVIEW_STATUS');
    if(!EVIDENCE_STATES.has(evidenceStatus))throw new FinanceError('Choose Unknown, Has Evidence or Missing Evidence.',400,'INVALID_TAX_EVIDENCE_STATUS');
    const reviewNote=clean(req.body.review_note,1000),question=reviewStatus==='ASK_ACCOUNTANT'?clean(req.body.accountant_question,1000):clean(req.body.accountant_question,1000);
    if(reviewStatus==='ASK_ACCOUNTANT'&&!question)throw new FinanceError('Enter the question you want to ask the accountant.',400,'ACCOUNTANT_QUESTION_REQUIRED');
    const [[before]]=await db.query('SELECT * FROM personal_tax_review_control WHERE entry_id=? AND user_id=? LIMIT 1 FOR UPDATE',[entry.id,owner]);
    await db.query(`INSERT INTO personal_tax_review_control
      (entry_id,user_id,review_status,evidence_status,review_note,accountant_question,reviewed_at,updated_by)
      VALUES (?,?,?,?,?,?,NOW(),?)
      ON DUPLICATE KEY UPDATE review_status=VALUES(review_status),evidence_status=VALUES(evidence_status),review_note=VALUES(review_note),
        accountant_question=VALUES(accountant_question),reviewed_at=NOW(),updated_by=VALUES(updated_by)`,
      [entry.id,owner,reviewStatus,evidenceStatus,reviewNote,question,Number(owner)||null]);
    await logAudit(db,audit(req,'PERSONAL_TAX_REVIEW_UPDATED',entry.id,before||null,{review_status:reviewStatus,evidence_status:evidenceStatus,review_note:reviewNote,accountant_question:question,currency:entry.currency,amount:Number(entry.amount||0)}));
    await db.commit();
    return res.json({message:'Tax-preparation review saved. No tax treatment, deduction, journal or filing was created.',review_status:reviewStatus,evidence_status:evidenceStatus});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save Personal Tax review.');}
  finally{db.release()}
};
