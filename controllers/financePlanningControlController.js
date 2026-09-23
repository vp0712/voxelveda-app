'use strict';

const crypto=require('node:crypto');
const pool=require('../config/db');
const { ensureFinanceSchema }=require('../services/financeSchema');
const { FinanceError }=require('../services/financeDomain');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');

const SCOPES=new Set(['PERSONAL','BUSINESS']);
const DIRECTIONS=new Set(['INCOME','EXPENSE']);

function owner(req){return privacy.userId(req)}
function clean(v,max=500){const x=String(v??'').trim();return x?x.slice(0,max):null}
function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
function round(v){return Math.round((n(v)+Number.EPSILON)*10000)/10000}
function money(v,label='Amount'){const x=Number(v);if(!Number.isFinite(x)||x<0)throw new FinanceError(`${label} must be a valid non-negative amount.`,400,'INVALID_PLAN_AMOUNT');return round(x)}
function currency(v){const x=String(v||'AUD').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(x))throw new FinanceError('Currency must be a 3-letter code.',400,'INVALID_PLAN_CURRENCY');return x}
function monthStart(v,label='Month'){
  const raw=String(v||'').trim(),m=raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if(!m||Number(m[2])<1||Number(m[2])>12)throw new FinanceError(`${label} must use YYYY-MM.`,400,'INVALID_PLAN_MONTH');
  return `${m[1]}-${m[2]}-01`;
}
function addMonths(value,count){const d=new Date(String(value).slice(0,10)+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(count||0));return d.toISOString().slice(0,10)}
function monthKey(value){return String(value||'').slice(0,7)+'-01'}
function currentMonth(){const d=new Date();return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`}
function elapsedMonthFraction(month){
  const now=new Date(),key=currentMonth();
  if(month<key)return 1;if(month>key)return 0;
  const days=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate();
  return Math.min(1,Math.max(0,now.getUTCDate()/days));
}
function fullBusinessAccess(req){
  const s=req.bankingAccessScope;
  return Boolean(s&&(s.is_admin||(!s.has_explicit_grants&&s.can_view_all_business)));
}
function assertScopeAccess(req,scope){
  if(scope==='BUSINESS'&&!fullBusinessAccess(req))throw new FinanceError('Full Company Finance visibility is required for a business operating plan.',403,'BUSINESS_PLAN_FULL_ACCESS_REQUIRED');
}
function audit(req,action,id,oldValue,newValue){
  return {actorId:owner(req),action,module:'finance',recordType:'finance_operating_plan',recordId:String(id),oldValue,newValue,
    requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function fail(res,error,message='Finance Planning Control failed.'){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_PLANNING_CONTROL_FAILED'});
}
async function getPlan(db,uid,req,{forUpdate=false}={}){
  const suffix=forUpdate?' FOR UPDATE':'';
  const [[row]]=await db.query(`SELECT * FROM finance_operating_plans WHERE plan_uid=? LIMIT 1${suffix}`,[String(uid||'')]);
  if(!row)throw new FinanceError('Operating plan not found.',404,'FINANCE_PLAN_NOT_FOUND');
  if(String(row.ownership_scope).toUpperCase()==='BUSINESS'){
    if(!fullBusinessAccess(req))throw new FinanceError('Operating plan not found.',404,'FINANCE_PLAN_NOT_FOUND');
  }else if(Number(row.created_by||0)!==owner(req))throw new FinanceError('Operating plan not found.',404,'FINANCE_PLAN_NOT_FOUND');
  return row;
}
function planMonthInside(plan,value){
  const m=monthStart(value),end=addMonths(plan.start_month,plan.months_count);
  return m>=String(plan.start_month).slice(0,10)&&m<end?m:null;
}
function lineKey(month,direction,category){return month+'|'+direction+'|'+String(category||'Uncategorised')}
function addTo(map,key,amount){map.set(key,round((map.get(key)||0)+n(amount)))}

async function actualEvidence(plan,req){
  const start=String(plan.start_month).slice(0,10),end=addMonths(start,plan.months_count),userId=owner(req);
  const scope=String(plan.ownership_scope).toUpperCase(),cur=String(plan.currency).toUpperCase();
  const scopeSql=scope==='BUSINESS'?"ba.ownership_scope='BUSINESS'":"ba.ownership_scope='PERSONAL' AND ba.created_by=?";
  const params=scope==='BUSINESS'?[cur,start,end]:[userId,cur,start,end];

  const [transactions]=await pool.query(
    `SELECT bt.id,bt.transaction_date,bt.debit,bt.credit,bt.currency,COALESCE(NULLIF(bt.category,''),'Uncategorised') AS category
       FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE ${scopeSql} AND bt.currency=? AND bt.transaction_date>=? AND bt.transaction_date<?
        AND bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED' AND bt.is_internal_transfer=0
      ORDER BY bt.transaction_date,bt.id`,params
  );
  const [splits]=await pool.query(
    `SELECT s.parent_bank_transaction_id,COALESCE(NULLIF(s.category,''),'Uncategorised') AS category,s.amount
       FROM bank_transaction_splits s
       JOIN bank_transactions bt ON bt.id=s.parent_bank_transaction_id
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE ${scopeSql} AND bt.currency=? AND bt.transaction_date>=? AND bt.transaction_date<?
        AND bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED' AND bt.is_internal_transfer=0 AND bt.debit>0
      ORDER BY s.parent_bank_transaction_id,s.id`,params
  );

  const splitMap=new Map();
  for(const s of splits){const id=Number(s.parent_bank_transaction_id);if(!splitMap.has(id))splitMap.set(id,[]);splitMap.get(id).push({category:s.category,amount:n(s.amount)})}
  const actualByLine=new Map(),actualByMonth=new Map();let splitVarianceCount=0;
  for(const tx of transactions){
    const month=monthKey(tx.transaction_date),debit=n(tx.debit),credit=n(tx.credit);
    if(!actualByMonth.has(month))actualByMonth.set(month,{income:0,expense:0,transaction_count:0});
    const mm=actualByMonth.get(month);mm.transaction_count++;
    if(credit>0){mm.income=round(mm.income+credit);addTo(actualByLine,lineKey(month,'INCOME',tx.category),credit)}
    if(debit>0){
      mm.expense=round(mm.expense+debit);
      const ss=splitMap.get(Number(tx.id))||[];
      if(ss.length){
        const splitTotal=round(ss.reduce((sum,x)=>sum+n(x.amount),0));
        if(Math.abs(splitTotal-debit)>0.01)splitVarianceCount++;
        for(const s of ss)addTo(actualByLine,lineKey(month,'EXPENSE',s.category),s.amount);
      }else addTo(actualByLine,lineKey(month,'EXPENSE',tx.category),debit);
    }
  }
  return {actualByLine,actualByMonth,transaction_count:transactions.length,split_variance_count:splitVarianceCount};
}

async function analysePlan(plan,req){
  const [lines]=await pool.query(
    `SELECT id,month_start,direction,category,planned_amount,note,created_at,updated_at
       FROM finance_operating_plan_lines WHERE plan_id=? ORDER BY month_start,direction,category`,[plan.id]
  );
  const evidence=await actualEvidence(plan,req),plannedByLine=new Map(),plannedByMonth=new Map();
  for(const line of lines){
    const month=monthKey(line.month_start),direction=String(line.direction).toUpperCase(),amount=n(line.planned_amount);
    addTo(plannedByLine,lineKey(month,direction,line.category),amount);
    if(!plannedByMonth.has(month))plannedByMonth.set(month,{income:0,expense:0});
    const field=direction==='INCOME'?'income':'expense';
    plannedByMonth.get(month)[field]=round(plannedByMonth.get(month)[field]+amount);
  }

  const months=[],start=String(plan.start_month).slice(0,10),nowMonth=currentMonth();
  let accuracyNumerator=0,accuracyDenominator=0;
  for(let i=0;i<Number(plan.months_count||12);i++){
    const month=addMonths(start,i),planned=plannedByMonth.get(month)||{income:0,expense:0},actual=evidence.actualByMonth.get(month)||{income:0,expense:0,transaction_count:0};
    const elapsed=elapsedMonthFraction(month),past=month<nowMonth,future=month>nowMonth;
    const forecastIncome=past?actual.income:future?planned.income:round(actual.income+planned.income*(1-elapsed));
    const forecastExpense=past?actual.expense:future?planned.expense:round(actual.expense+planned.expense*(1-elapsed));
    if(past&&(planned.income+planned.expense)>0){
      accuracyNumerator+=Math.abs(actual.income-planned.income)+Math.abs(actual.expense-planned.expense);
      accuracyDenominator+=Math.abs(planned.income)+Math.abs(planned.expense);
    }
    months.push({
      month,elapsed_percent:round(elapsed*100),planned_income:round(planned.income),planned_expense:round(planned.expense),
      planned_net:round(planned.income-planned.expense),actual_income:round(actual.income),actual_expense:round(actual.expense),
      actual_net:round(actual.income-actual.expense),income_variance:round(actual.income-planned.income),
      expense_variance:round(actual.expense-planned.expense),forecast_income:forecastIncome,forecast_expense:forecastExpense,
      forecast_net:round(forecastIncome-forecastExpense),transaction_count:Number(actual.transaction_count||0),
      period_state:past?'COMPLETED':future?'FUTURE':'CURRENT'
    });
  }

  const categoryKeys=new Set([...plannedByLine.keys(),...evidence.actualByLine.keys()]),categoryMap=new Map();
  for(const key of categoryKeys){
    const [month,direction,...rest]=key.split('|'),category=rest.join('|'),actual=evidence.actualByLine.get(key)||0,planned=plannedByLine.get(key)||0;
    const elapsed=elapsedMonthFraction(month),bucket=direction+'|'+category;
    if(!categoryMap.has(bucket))categoryMap.set(bucket,{direction,category,planned_total:0,planned_to_date:0,actual_to_date:0});
    const row=categoryMap.get(bucket);
    row.planned_total=round(row.planned_total+planned);
    row.planned_to_date=round(row.planned_to_date+planned*elapsed);
    if(month<=nowMonth)row.actual_to_date=round(row.actual_to_date+actual);
  }
  const categoryVariance=[...categoryMap.values()].map(r=>({...r,variance_to_date:round(r.actual_to_date-r.planned_to_date)}))
    .sort((a,b)=>Math.abs(b.variance_to_date)-Math.abs(a.variance_to_date));

  const sums=months.reduce((a,m)=>{for(const k of ['planned_income','planned_expense','actual_income','actual_expense','forecast_income','forecast_expense'])a[k]+=n(m[k]);return a},
    {planned_income:0,planned_expense:0,actual_income:0,actual_expense:0,forecast_income:0,forecast_expense:0});
  Object.keys(sums).forEach(k=>sums[k]=round(sums[k]));
  const completedAccuracy=accuracyDenominator>0?round(Math.max(0,100-(accuracyNumerator/accuracyDenominator*100))):null;

  const signals=[];
  for(const r of categoryVariance){
    if(r.direction==='EXPENSE'&&r.planned_to_date>0&&r.actual_to_date>r.planned_to_date*1.1)
      signals.push({severity:'WATCH',code:'EXPENSE_ABOVE_PLAN',category:r.category,currency:plan.currency,message:`${r.category} actual expense is more than 10% above elapsed plan.`});
    if(r.direction==='INCOME'&&r.planned_to_date>0&&r.actual_to_date<r.planned_to_date*.9)
      signals.push({severity:'REVIEW',code:'INCOME_BELOW_PLAN',category:r.category,currency:plan.currency,message:`${r.category} actual income is more than 10% below elapsed plan.`});
  }
  if(evidence.split_variance_count>0)signals.push({severity:'REVIEW',code:'SPLIT_INTEGRITY_VARIANCE',currency:plan.currency,message:`${evidence.split_variance_count} split transaction(s) do not equal the parent debit and need data-quality review.`});

  let rollingStart=months.findIndex(m=>m.month>=nowMonth);if(rollingStart<0)rollingStart=Math.max(0,months.length-12);
  return {
    lines:lines.map(x=>({...x,planned_amount:n(x.planned_amount)})),
    months,rolling_12_month:months.slice(rollingStart,rollingStart+12),category_variance:categoryVariance.slice(0,100),signals,
    summary:{
      currency:plan.currency,planned_income_total:sums.planned_income,planned_expense_total:sums.planned_expense,
      planned_net_total:round(sums.planned_income-sums.planned_expense),actual_income_in_horizon:sums.actual_income,
      actual_expense_in_horizon:sums.actual_expense,forecast_income_total:sums.forecast_income,
      forecast_expense_total:sums.forecast_expense,forecast_net_total:round(sums.forecast_income-sums.forecast_expense),
      completed_plan_accuracy_percent:completedAccuracy,source_transaction_count:evidence.transaction_count,
      split_integrity_variance_count:evidence.split_variance_count
    }
  };
}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const userId=owner(req),business=fullBusinessAccess(req);
    const [plans]=await pool.query(
      `SELECT p.*,(SELECT COUNT(*) FROM finance_operating_plan_lines l WHERE l.plan_id=p.id) AS line_count
         FROM finance_operating_plans p
        WHERE (p.ownership_scope='PERSONAL' AND p.created_by=?) ${business?"OR p.ownership_scope='BUSINESS'":""}
        ORDER BY FIELD(p.status,'ACTIVE','DRAFT','SUPERSEDED','ARCHIVED'),p.updated_at DESC,p.id DESC`,[userId]
    );
    let selected=req.query.plan_uid?plans.find(p=>String(p.plan_uid)===String(req.query.plan_uid))||null:null;
    if(!selected)selected=plans.find(p=>p.status==='ACTIVE')||plans.find(p=>p.status==='DRAFT')||plans[0]||null;
    const analysis=selected?await analysePlan(selected,req):null;
    return res.json({
      rules:{
        ledger:'FP&A reads canonical bank transactions for actuals and never posts or rewrites transaction history.',
        versioning:'Only DRAFT plan lines are editable. Activating a plan supersedes the previous active plan for the same scope and currency; future changes require a cloned version.',
        currency:'Every plan has one native currency. Plans and actuals are never silently combined across currencies.',
        scope:'Personal plans use only the owner’s PERSONAL bank accounts. Business plans require full Company Finance visibility.',
        forecast:'Rolling forecast uses actual completed months, actual-to-date plus remaining planned amount for the current month, and planned values for future months.'
      },
      plans:plans.map(p=>({...p,months_count:Number(p.months_count),version_no:Number(p.version_no),line_count:Number(p.line_count||0)})),
      selected_plan:selected?{...selected,months_count:Number(selected.months_count),version_no:Number(selected.version_no),line_count:Number(selected.line_count||0)}:null,
      analysis
    });
  }catch(error){return fail(res,error)}
};

exports.createPlan=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const userId=owner(req),scope=String(req.body.ownership_scope||'PERSONAL').trim().toUpperCase();
    if(!SCOPES.has(scope))throw new FinanceError('Plan scope must be Personal or Business.',400,'INVALID_PLAN_SCOPE');
    assertScopeAccess(req,scope);
    const name=clean(req.body.plan_name,180);if(!name)throw new FinanceError('Plan name is required.',400,'PLAN_NAME_REQUIRED');
    const start=monthStart(req.body.start_month),months=Number(req.body.months_count||12);
    if(!Number.isInteger(months)||months<1||months>24)throw new FinanceError('Plan horizon must be between 1 and 24 months.',400,'INVALID_PLAN_HORIZON');
    const cur=currency(req.body.currency),uid=crypto.randomUUID();
    await db.query(`INSERT INTO finance_operating_plans
      (plan_uid,created_by,plan_name,ownership_scope,currency,start_month,months_count,status,notes,version_no)
      VALUES (?,?,?,?,?,?,?,'DRAFT',?,1)`,[uid,userId,name,scope,cur,start,months,clean(req.body.notes,1000)]);
    await logAudit(db,audit(req,'FINANCE_PLAN_CREATED',uid,null,{plan_name:name,ownership_scope:scope,currency:cur,start_month:start,months_count:months,status:'DRAFT'}));
    await db.commit();return res.status(201).json({message:'Draft operating plan created.',plan_uid:uid});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to create operating plan.')}finally{db.release()}
};

exports.clonePlan=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const source=await getPlan(db,req.params.uid,req,{forUpdate:true}),userId=owner(req),uid=crypto.randomUUID();
    const [[ver]]=await db.query(`SELECT COALESCE(MAX(version_no),0) AS max_version FROM finance_operating_plans
      WHERE ownership_scope=? AND currency=? AND plan_name=?`,[source.ownership_scope,source.currency,source.plan_name]);
    const version=Number(ver.max_version||0)+1;
    await db.query(`INSERT INTO finance_operating_plans
      (plan_uid,created_by,plan_name,ownership_scope,currency,start_month,months_count,status,notes,version_no,supersedes_plan_uid)
      VALUES (?,?,?,?,?,?,?,'DRAFT',?,?,?)`,
      [uid,userId,source.plan_name,source.ownership_scope,source.currency,source.start_month,source.months_count,source.notes,version,source.plan_uid]);
    const [[created]]=await db.query('SELECT id FROM finance_operating_plans WHERE plan_uid=?',[uid]);
    await db.query(`INSERT INTO finance_operating_plan_lines (plan_id,month_start,direction,category,planned_amount,note)
      SELECT ?,month_start,direction,category,planned_amount,note FROM finance_operating_plan_lines WHERE plan_id=?`,[created.id,source.id]);
    await logAudit(db,audit(req,'FINANCE_PLAN_CLONED',uid,{source_plan_uid:source.plan_uid},{version_no:version,status:'DRAFT'}));
    await db.commit();return res.status(201).json({message:'New draft plan version created with the previous plan lines copied.',plan_uid:uid,version_no:version});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to clone operating plan.')}finally{db.release()}
};

exports.saveLine=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const plan=await getPlan(db,req.params.uid,req,{forUpdate:true});
    if(plan.status!=='DRAFT')throw new FinanceError('Only a DRAFT plan can be edited. Clone this plan to create a new version.',409,'FINANCE_PLAN_IMMUTABLE');
    const month=planMonthInside(plan,req.body.month_start);if(!month)throw new FinanceError('Plan line month must fall inside the plan horizon.',400,'PLAN_LINE_OUTSIDE_HORIZON');
    const direction=String(req.body.direction||'').trim().toUpperCase();if(!DIRECTIONS.has(direction))throw new FinanceError('Direction must be Income or Expense.',400,'INVALID_PLAN_DIRECTION');
    const category=clean(req.body.category,120);if(!category)throw new FinanceError('Category is required.',400,'PLAN_CATEGORY_REQUIRED');
    const value=money(req.body.planned_amount,'Planned amount');
    const [[before]]=await db.query(`SELECT * FROM finance_operating_plan_lines WHERE plan_id=? AND month_start=? AND direction=? AND category=? LIMIT 1 FOR UPDATE`,
      [plan.id,month,direction,category]);
    await db.query(`INSERT INTO finance_operating_plan_lines (plan_id,month_start,direction,category,planned_amount,note)
      VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE planned_amount=VALUES(planned_amount),note=VALUES(note),updated_at=CURRENT_TIMESTAMP`,
      [plan.id,month,direction,category,value,clean(req.body.note,300)]);
    await logAudit(db,audit(req,'FINANCE_PLAN_LINE_SAVED',plan.plan_uid,before||null,{month_start:month,direction,category,planned_amount:value}));
    await db.commit();return res.json({message:'Draft plan line saved. No ledger transaction was changed.'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save plan line.')}finally{db.release()}
};

exports.deleteLine=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const plan=await getPlan(db,req.params.uid,req,{forUpdate:true});
    if(plan.status!=='DRAFT')throw new FinanceError('Only a DRAFT plan can be edited.',409,'FINANCE_PLAN_IMMUTABLE');
    const [[line]]=await db.query('SELECT * FROM finance_operating_plan_lines WHERE id=? AND plan_id=? LIMIT 1 FOR UPDATE',[Number(req.params.lineId||0),plan.id]);
    if(!line)throw new FinanceError('Plan line not found.',404,'PLAN_LINE_NOT_FOUND');
    await db.query('DELETE FROM finance_operating_plan_lines WHERE id=? AND plan_id=?',[line.id,plan.id]);
    await logAudit(db,audit(req,'FINANCE_PLAN_LINE_REMOVED',plan.plan_uid,line,null));
    await db.commit();return res.json({message:'Draft plan line removed. Actual finance history was not affected.'});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to remove plan line.')}finally{db.release()}
};

exports.setStatus=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();await db.beginTransaction();
    const plan=await getPlan(db,req.params.uid,req,{forUpdate:true}),status=String(req.body.status||'').trim().toUpperCase();
    if(!['ACTIVE','ARCHIVED'].includes(status))throw new FinanceError('Plan status must be Active or Archived.',400,'INVALID_PLAN_STATUS');
    if(plan.status==='SUPERSEDED')throw new FinanceError('A superseded plan is immutable. Clone it instead.',409,'FINANCE_PLAN_SUPERSEDED');
    if(status==='ACTIVE'){
      const [[cnt]]=await db.query('SELECT COUNT(*) AS count FROM finance_operating_plan_lines WHERE plan_id=?',[plan.id]);
      if(Number(cnt.count||0)===0)throw new FinanceError('Add at least one plan line before activation.',409,'FINANCE_PLAN_EMPTY');
      await db.query(`UPDATE finance_operating_plans SET status='SUPERSEDED'
        WHERE id<>? AND ownership_scope=? AND currency=? AND status='ACTIVE'`,[plan.id,plan.ownership_scope,plan.currency]);
    }
    await db.query('UPDATE finance_operating_plans SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,plan.id]);
    await logAudit(db,audit(req,'FINANCE_PLAN_STATUS_CHANGED',plan.plan_uid,{status:plan.status},{status}));
    await db.commit();return res.json({message:status==='ACTIVE'?'Operating plan activated. Previous active plan for this scope/currency was retained as Superseded.':'Operating plan archived.',status});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to change plan status.')}finally{db.release()}
};
