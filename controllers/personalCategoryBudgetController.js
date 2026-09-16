const crypto = require('node:crypto');
const pool = require('../config/db');
const { logAudit } = require('../services/auditService');

function userId(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}
function clean(v,max=100){const s=String(v||'').trim();return s?s.slice(0,max):null;}
function currency(v){const s=String(v||'AUD').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(s))throw Object.assign(new Error('Currency must use a three-letter code such as AUD.'),{statusCode:400});return s;}
function positive(v,label='Monthly limit'){const n=Number(v);if(!Number.isFinite(n)||n<=0||n>999999999999)throw Object.assign(new Error(`${label} must be a positive amount.`),{statusCode:400});return Math.round(n*10000)/10000;}
function respondError(res,e,fallback){const s=Number(e?.statusCode||500);if(s>=500)console.error(fallback,e);return res.status(s).json({message:s>=500?fallback:e.message});}
function audit(req, values){return {actorId:req.user?.id,ipAddress:req.ip,userAgent:req.get('user-agent'),...values};}
function round(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100;}
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function monthShift(base,n){return new Date(base.getFullYear(),base.getMonth()+n,1);}

async function loadTransactions(uid,startDate){
  const [rows]=await pool.query(`SELECT bt.id, DATE_FORMAT(bt.transaction_date,'%Y-%m-%d') transaction_date,
      DATE_FORMAT(bt.transaction_date,'%Y-%m') month_key, bt.debit, bt.category confirmed_category,
      bt.description, bt.merchant_name, ba.currency,
      fi.suggested_category
    FROM bank_transactions bt
    JOIN bank_accounts ba ON ba.id=bt.bank_account_id
    LEFT JOIN finance_transaction_insights fi ON fi.id=(
      SELECT fi2.id FROM finance_transaction_insights fi2
      WHERE fi2.bank_transaction_id=bt.id AND fi2.status<>'DISMISSED'
      ORDER BY fi2.generated_at DESC, fi2.id DESC LIMIT 1)
    WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
      AND bt.is_internal_transfer=0 AND bt.debit>0 AND bt.transaction_date>=?
    ORDER BY bt.transaction_date DESC, bt.id DESC`,[uid,startDate]);
  return rows.map(r=>({...r,display_category:clean(r.confirmed_category)||clean(r.suggested_category)||'Uncategorised'}));
}

exports.getCenter=async(req,res)=>{
  try{
    const uid=userId(req), now=new Date();
    const currentMonth=monthKey(now), start=monthShift(now,-3), startDate=`${monthKey(start)}-01`;
    const [budgets,tx]=await Promise.all([
      pool.query(`SELECT id,category,currency,monthly_limit,active,note,created_at,updated_at
        FROM personal_spending_category_budgets WHERE user_id=? AND active=1 ORDER BY currency,category`,[uid]).then(([r])=>r),
      loadTransactions(uid,startDate)
    ]);
    const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const day=Math.max(1,now.getDate()), daysRemaining=Math.max(1,daysInMonth-day+1);
    const previousMonths=[-1,-2,-3].map(n=>monthKey(monthShift(now,n)));
    const grouped={};
    for(const r of tx){const c=String(r.currency||'AUD').toUpperCase(),cat=r.display_category,key=`${c}\u0000${cat}`;if(!grouped[key])grouped[key]={};grouped[key][r.month_key]=(grouped[key][r.month_key]||0)+Number(r.debit||0);}
    const items=budgets.map(b=>{
      const key=`${String(b.currency).toUpperCase()}\u0000${b.category}`, byMonth=grouped[key]||{};
      const spent=Number(byMonth[currentMonth]||0), limit=Number(b.monthly_limit||0), remaining=limit-spent, used=limit>0?(spent/limit)*100:0;
      const avg3=previousMonths.reduce((s,m)=>s+Number(byMonth[m]||0),0)/3;
      const projected=day>0?(spent/day)*daysInMonth:spent;
      let level='OK';if(used>=100)level='OVER';else if(used>=90)level='CRITICAL';else if(used>=70)level='WATCH';
      return {...b,monthly_limit:round(limit),spent_amount:round(spent),remaining_amount:round(remaining),used_percent:Math.round(used*10)/10,
        alert_level:level,daily_safe_spend:round(Math.max(0,remaining)/daysRemaining),days_remaining:daysRemaining,
        average_previous_3_months:round(avg3),difference_vs_average:round(spent-avg3),projected_month_end:round(projected),
        projected_over_budget:projected>limit};
    });
    const suggestions=[];
    const existing=new Set(budgets.map(b=>`${String(b.currency).toUpperCase()}\u0000${b.category}`));
    for(const [key,byMonth] of Object.entries(grouped)){
      if(existing.has(key))continue;const [cur,cat]=key.split('\u0000');if(cat==='Uncategorised')continue;
      const avg=previousMonths.reduce((s,m)=>s+Number(byMonth[m]||0),0)/3;if(avg<=0)continue;
      suggestions.push({currency:cur,category:cat,average_previous_3_months:round(avg),suggested_limit:round(Math.ceil(avg*1.1/10)*10)});
    }
    suggestions.sort((a,b)=>b.average_previous_3_months-a.average_previous_3_months);
    return res.json({month:currentMonth,days_in_month:daysInMonth,days_remaining:daysRemaining,budgets:items,suggestions:suggestions.slice(0,20),
      thresholds:{watch:70,critical:90,over:100},
      note:'Category budgets are advisory. Spending uses PERSONAL imported bank transactions and confirmed/suggested categories; no payment is blocked or moved.'});
  }catch(e){return respondError(res,e,'Failed to load category budgets.');}
};

exports.saveBudget=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const uid=userId(req), category=clean(req.body.category,100), cur=currency(req.body.currency), limit=positive(req.body.monthly_limit), note=clean(req.body.note,255);
    if(!category)throw Object.assign(new Error('Category is required.'),{statusCode:400});
    await db.beginTransaction();
    const id=crypto.randomUUID();
    await db.query(`INSERT INTO personal_spending_category_budgets (id,user_id,category,currency,monthly_limit,active,note)
      VALUES (?,?,?,?,?,1,?) ON DUPLICATE KEY UPDATE monthly_limit=VALUES(monthly_limit),active=1,note=VALUES(note),updated_at=CURRENT_TIMESTAMP`,
      [id,uid,category,cur,limit,note]);
    await logAudit(db,audit(req,{action:'PERSONAL_CATEGORY_BUDGET_SAVED',module:'personal_money',recordType:'category_budget',recordId:`${cur}:${category}`,newValue:{category,currency:cur,monthly_limit:limit}}));
    await db.commit();
    return res.status(201).json({message:'Category budget saved. This does not block spending or move money.'});
  }catch(e){await db.rollback().catch(()=>{});return respondError(res,e,'Failed to save category budget.');}finally{db.release();}
};

exports.archiveBudget=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const uid=userId(req);await db.beginTransaction();
    const [result]=await db.query(`UPDATE personal_spending_category_budgets SET active=0 WHERE id=? AND user_id=? AND active=1`,[req.params.id,uid]);
    if(!result.affectedRows)throw Object.assign(new Error('Category budget not found.'),{statusCode:404});
    await logAudit(db,audit(req,{action:'PERSONAL_CATEGORY_BUDGET_ARCHIVED',module:'personal_money',recordType:'category_budget',recordId:req.params.id}));
    await db.commit();return res.json({message:'Category budget archived.'});
  }catch(e){await db.rollback().catch(()=>{});return respondError(res,e,'Failed to archive category budget.');}finally{db.release();}
};
