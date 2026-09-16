const crypto=require('node:crypto');
const pool=require('../config/db');

function uid(req){const v=req.user?.id??req.user?.user_id;if(v===undefined||v===null||v==='')throw Object.assign(new Error('User identity unavailable.'),{statusCode:401});return String(v);}
function fail(res,e,msg){const s=Number(e?.statusCode||500);if(s>=500)console.error(msg,e);return res.status(s).json({message:s>=500?msg:e.message});}
function fyStart(v){const now=new Date(),current=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;const y=v===undefined||v===null||v===''?current:Number(v);if(!Number.isInteger(y)||y<2000||y>2100)throw Object.assign(new Error('Financial year start must be a four-digit year.'),{statusCode:400});return y;}
function clean(v,max=500){const s=String(v??'').trim();return s?s.slice(0,max):null;}
function money(n){return Math.round(Number(n||0)*100)/100;}
function key(c){return String(c||'AUD').toUpperCase();}
function add(map,c,field,value){const k=key(c);if(!map[k])map[k]={recorded_income:0,recorded_expenses:0,cash_in:0,cash_out:0,reviewed_candidate:0,missing_evidence_candidate:0};map[k][field]=money(map[k][field]+Number(value||0));}

exports.getCenter=async(req,res)=>{try{const user=uid(req),year=fyStart(req.query.fy_start),start=`${year}-07-01`,end=`${year+1}-07-01`;
 const [rows]=await pool.query(`SELECT e.id,e.entry_type,e.amount,e.currency,e.category,e.counterparty,e.note,e.occurred_at,w.name wallet_name,
  r.review_status,r.evidence_status,r.note review_note,r.updated_at review_updated_at
  FROM personal_money_entries e
  JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
  LEFT JOIN personal_tax_reviews r ON r.entry_id=e.id AND r.user_id=e.user_id
  WHERE e.user_id=? AND e.occurred_at>=? AND e.occurred_at<?
  ORDER BY e.occurred_at DESC,e.created_at DESC`,[user,start,end]);
 const summary={},monthly={},categories={},queue=[];let reviewed=0,unreviewed=0,missingEvidence=0;
 for(const r of rows){const amount=Number(r.amount||0),c=key(r.currency),month=String(r.occurred_at).slice(0,7);if(!monthly[c])monthly[c]={};if(!monthly[c][month])monthly[c][month]={income:0,expenses:0,cash_in:0,cash_out:0};
  if(r.entry_type==='INCOME'){add(summary,c,'recorded_income',amount);monthly[c][month].income=money(monthly[c][month].income+amount);}
  if(r.entry_type==='EXPENSE'){add(summary,c,'recorded_expenses',amount);monthly[c][month].expenses=money(monthly[c][month].expenses+amount);}
  if(r.entry_type==='CASH_IN'){add(summary,c,'cash_in',amount);monthly[c][month].cash_in=money(monthly[c][month].cash_in+amount);}
  if(r.entry_type==='CASH_OUT'){add(summary,c,'cash_out',amount);monthly[c][month].cash_out=money(monthly[c][month].cash_out+amount);}
  if(['EXPENSE','CASH_OUT'].includes(r.entry_type)){
    const status=r.review_status||'UNREVIEWED',evidence=r.evidence_status||'UNKNOWN';if(status==='UNREVIEWED')unreviewed++;else reviewed++;
    if(status==='CANDIDATE'){add(summary,c,'reviewed_candidate',amount);if(evidence==='MISSING_EVIDENCE'||evidence==='UNKNOWN'){add(summary,c,'missing_evidence_candidate',amount);missingEvidence++;}}
    const cat=String(r.category||'Uncategorised');const ck=`${c}::${cat}`;if(!categories[ck])categories[ck]={currency:c,category:cat,count:0,amount:0,reviewed_candidate:0};categories[ck].count++;categories[ck].amount=money(categories[ck].amount+amount);if(status==='CANDIDATE')categories[ck].reviewed_candidate=money(categories[ck].reviewed_candidate+amount);
    queue.push({id:r.id,entry_type:r.entry_type,amount,currency:c,category:r.category||null,counterparty:r.counterparty||null,note:r.note||null,occurred_at:r.occurred_at,wallet_name:r.wallet_name,review_status:status,evidence_status:evidence,review_note:r.review_note||null,review_updated_at:r.review_updated_at||null});
  }
 }
 const [[range]]=await pool.query(`SELECT MIN(YEAR(occurred_at - INTERVAL 6 MONTH)) min_fy,MAX(YEAR(occurred_at - INTERVAL 6 MONTH)) max_fy FROM personal_money_entries WHERE user_id=?`,[user]);
 return res.json({privacy:'Owner-only personal tax-readiness data. It is separate from Voxel Veda company accounting.',jurisdiction_note:'Financial-year windows use 1 July to 30 June for Australian-style personal preparation. This feature does not calculate tax liability or decide legal deductibility.',financial_year:{start_year:year,label:`${year}-${String(year+1).slice(-2)}`,start_date:start,end_date:`${year+1}-06-30`},available_range:{min_start_year:range?.min_fy?Number(range.min_fy):year,max_start_year:range?.max_fy?Number(range.max_fy):year},currency_rule:'Currencies remain separate. No tax FX conversion or ATO exchange-rate assumption is applied.',summary_by_currency:summary,monthly_by_currency:monthly,categories:Object.values(categories).sort((a,b)=>b.amount-a.amount),review:{total_items:queue.length,reviewed,unreviewed,missing_evidence_candidate:missingEvidence,items:queue},rules:['Recorded income is not automatically taxable income.','A CANDIDATE classification is only a user review flag, not a tax deduction claim.','CASH_IN and CASH_OUT are shown separately because they may be transfers, withdrawals or cash movements rather than income/expenses.','No company transactions are included.']});
 }catch(e){return fail(res,e,'Failed to load personal tax readiness.');}};

exports.saveReview=async(req,res)=>{try{const user=uid(req),year=fyStart(req.body.fy_start),statuses=new Set(['CANDIDATE','NOT_CLAIMING','ASK_ACCOUNTANT']),evidenceSet=new Set(['HAS_EVIDENCE','MISSING_EVIDENCE','NOT_REQUIRED','UNKNOWN']),status=String(req.body.review_status||'').toUpperCase(),evidence=String(req.body.evidence_status||'UNKNOWN').toUpperCase();if(!statuses.has(status))throw Object.assign(new Error('Choose Candidate, Not claiming, or Ask accountant.'),{statusCode:400});if(!evidenceSet.has(evidence))throw Object.assign(new Error('Choose a valid evidence status.'),{statusCode:400});const start=`${year}-07-01`,end=`${year+1}-07-01`;
 const [[entry]]=await pool.query(`SELECT id,entry_type FROM personal_money_entries WHERE id=? AND user_id=? AND occurred_at>=? AND occurred_at<? LIMIT 1`,[req.params.entryId,user,start,end]);if(!entry)return res.status(404).json({message:'Personal transaction not found in this financial year.'});if(!['EXPENSE','CASH_OUT'].includes(entry.entry_type))return res.status(400).json({message:'Only personal spending items can be classified in the tax review queue.'});
 const id=crypto.randomUUID();await pool.query(`INSERT INTO personal_tax_reviews (id,user_id,entry_id,financial_year_start,review_status,evidence_status,note) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE financial_year_start=VALUES(financial_year_start),review_status=VALUES(review_status),evidence_status=VALUES(evidence_status),note=VALUES(note),updated_at=CURRENT_TIMESTAMP`,[id,user,entry.id,year,status,evidence,clean(req.body.note)]);return res.json({message:'Personal tax review saved. This does not create a tax deduction claim.'});
 }catch(e){return fail(res,e,'Failed to save personal tax review.');}};
