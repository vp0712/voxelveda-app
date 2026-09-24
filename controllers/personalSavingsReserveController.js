'use strict';

const pool=require('../config/db');
const { FinanceError }=require('../services/financeDomain');
const { logAudit }=require('../services/auditService');

const GOAL_TYPES=new Set(['EMERGENCY_FUND','SINKING_FUND','PURCHASE','TRAVEL','INVESTMENT_RESERVE','TAX_RESERVE','OTHER']);
const FUNDING_STRATEGIES=new Set(['MANUAL','WEEKLY_PLAN','FORTNIGHTLY_PLAN','MONTHLY_PLAN']);
const PRIORITIES=new Set(['LOW','MEDIUM','HIGH']);

function uid(req){
  const value=req.user?.id??req.user?.user_id;
  if(value===undefined||value===null||value==='')throw new FinanceError('User identity unavailable.',401,'USER_REQUIRED');
  return String(value);
}
function clean(v,max=700){const x=String(v??'').trim();return x?x.slice(0,max):null}
function amount(v,label='Amount'){
  if(v===undefined||v===null||v==='')return 0;
  const n=Number(v);
  if(!Number.isFinite(n)||n<0)throw new FinanceError(label+' must be a valid non-negative amount.',400,'INVALID_SAVINGS_AMOUNT');
  return Math.round(n*10000)/10000;
}
function integerOrNull(v,min,max,label){
  if(v===undefined||v===null||v==='')return null;
  const n=Number(v);
  if(!Number.isInteger(n)||n<min||n>max)throw new FinanceError(label+' must be between '+min+' and '+max+'.',400,'INVALID_SAVINGS_CONTROL_NUMBER');
  return n;
}
function round(v){return Math.round(Number(v||0)*10000)/10000}
function daysTo(value){
  if(!value)return null;
  const target=new Date(String(value).slice(0,10)+'T00:00:00Z');
  const today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
  if(Number.isNaN(target.getTime()))return null;
  return Math.round((target-today)/86400000);
}
function dateAfterDays(days){
  if(!Number.isFinite(days)||days<0)return null;
  const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()+Math.ceil(days));
  return d.toISOString().slice(0,10);
}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);
  return res.status(500).json({message,code:'PERSONAL_SAVINGS_RESERVE_CONTROL_FAILED'});
}
function audit(req,action,id,oldValue,newValue){
  return {actorId:Number(uid(req))||null,action,module:'finance',recordType:'personal_money_savings_control',recordId:String(id),oldValue,newValue,
    requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
async function goal(db,id,userId,{forUpdate=false}={}){
  const suffix=forUpdate?' FOR UPDATE':'';
  const [[row]]=await db.query(`SELECT * FROM personal_money_savings_goals WHERE id=? AND user_id=? LIMIT 1${suffix}`,[String(id||''),String(userId)]);
  if(!row)throw new FinanceError('Savings goal not found.',404,'SAVINGS_GOAL_NOT_FOUND');
  return row;
}

exports.getCenter=async(req,res)=>{
  try{
    const owner=uid(req);
    const [rows,spendRows]=await Promise.all([
      pool.query(`SELECT g.id,g.name,g.target_amount,g.current_amount,g.currency,g.target_date,g.priority,g.status,g.note,g.created_at,g.updated_at,
          c.goal_type,c.funding_strategy,c.monthly_target,c.protected_floor,c.liquidity_priority,c.contribution_day,c.funding_source_note,c.decision_note,c.reviewed_at,
          COALESCE((SELECT SUM(x.amount) FROM personal_money_goal_contributions x WHERE x.goal_id=g.id AND x.user_id=g.user_id AND x.contributed_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)),0) AS contribution_30d,
          COALESCE((SELECT SUM(x.amount) FROM personal_money_goal_contributions x WHERE x.goal_id=g.id AND x.user_id=g.user_id AND x.contributed_at>=DATE_SUB(NOW(),INTERVAL 90 DAY)),0) AS contribution_90d,
          (SELECT MAX(x.contributed_at) FROM personal_money_goal_contributions x WHERE x.goal_id=g.id AND x.user_id=g.user_id) AS last_contribution_at,
          (SELECT COUNT(*) FROM personal_money_goal_contributions x WHERE x.goal_id=g.id AND x.user_id=g.user_id) AS contribution_count
        FROM personal_money_savings_goals g
        LEFT JOIN personal_money_savings_control c ON c.goal_id=g.id AND c.user_id=g.user_id
        WHERE g.user_id=?
        ORDER BY FIELD(g.status,'ACTIVE','PAUSED','COMPLETED'),FIELD(g.priority,'HIGH','MEDIUM','LOW'),g.target_date IS NULL,g.target_date,g.created_at DESC`,[owner]).then(([x])=>x),
      pool.query(`SELECT w.currency,COALESCE(SUM(e.wallet_amount),0) AS spend_90d
        FROM personal_money_entries e
        JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
        WHERE e.user_id=? AND e.occurred_at>=DATE_SUB(NOW(),INTERVAL 90 DAY) AND e.entry_type IN ('EXPENSE','CASH_OUT')
        GROUP BY w.currency`,[owner]).then(([x])=>x)
    ]);
    const spendByCurrency=Object.fromEntries(spendRows.map(x=>[String(x.currency||'AUD').toUpperCase(),Number(x.spend_90d||0)]));
    const byCurrency={},summary={active:0,paused:0,completed:0,behind:0,overdue:0,emergency_funds:0,emergency_coverage_below_3m:0};
    const goals=rows.map(row=>{
      const currency=String(row.currency||'AUD').toUpperCase(),target=Number(row.target_amount||0),current=Number(row.current_amount||0),remaining=Math.max(0,round(target-current));
      const targetDays=daysTo(row.target_date);
      const requiredMonthly=remaining<=0?0:(targetDays===null?null:(targetDays<=0?null:round(remaining/Math.max(targetDays/30.4375,1/30.4375))));
      const contribution30=Number(row.contribution_30d||0),contribution90=Number(row.contribution_90d||0),recentMonthly=round(contribution90/3);
      const paceMonths=recentMonthly>0?remaining/recentMonthly:null;
      const forecastDate=paceMonths!==null?dateAfterDays(paceMonths*30.4375):null;
      const goalType=String(row.goal_type||'OTHER').toUpperCase(),fundingStrategy=String(row.funding_strategy||'MANUAL').toUpperCase();
      const monthlySpend90=round((spendByCurrency[currency]||0)/3);
      const emergencyCoverage=goalType==='EMERGENCY_FUND'&&monthlySpend90>0?round(current/monthlySpend90):null;
      let paceStatus='NO_TARGET_DATE';
      if(row.status==='COMPLETED'||remaining<=0)paceStatus='COMPLETED';
      else if(row.status==='PAUSED')paceStatus='PAUSED';
      else if(targetDays!==null&&targetDays<0)paceStatus='OVERDUE';
      else if(requiredMonthly===null)paceStatus='NO_TARGET_DATE';
      else if(recentMonthly<=0)paceStatus='NO_RECENT_PACE';
      else if(recentMonthly+0.005>=requiredMonthly)paceStatus='ON_PACE';
      else paceStatus='BEHIND';
      if(row.status==='ACTIVE')summary.active++;
      if(row.status==='PAUSED')summary.paused++;
      if(row.status==='COMPLETED')summary.completed++;
      if(paceStatus==='BEHIND')summary.behind++;
      if(paceStatus==='OVERDUE')summary.overdue++;
      if(goalType==='EMERGENCY_FUND'){
        summary.emergency_funds++;
        if(emergencyCoverage!==null&&emergencyCoverage<3)summary.emergency_coverage_below_3m++;
      }
      byCurrency[currency]||={target:0,current:0,remaining:0,contribution_30d:0,recent_monthly_pace:0,planned_monthly_target:0,active_goals:0};
      const b=byCurrency[currency];b.target+=target;b.current+=current;b.remaining+=remaining;b.contribution_30d+=contribution30;b.recent_monthly_pace+=recentMonthly;b.planned_monthly_target+=Number(row.monthly_target||0);if(row.status==='ACTIVE')b.active_goals++;
      return {...row,target_amount:target,current_amount:current,remaining_amount:remaining,contribution_30d:contribution30,contribution_90d:contribution90,contribution_count:Number(row.contribution_count||0),
        goal_type:goalType,funding_strategy:fundingStrategy,monthly_target:Number(row.monthly_target||0),protected_floor:Number(row.protected_floor||0),liquidity_priority:String(row.liquidity_priority||row.priority||'MEDIUM').toUpperCase(),
        days_to_target:targetDays,required_monthly_to_target:requiredMonthly,recent_monthly_pace:recentMonthly,forecast_completion_date:forecastDate,pace_status:paceStatus,
        average_monthly_spending_90d:monthlySpend90,emergency_coverage_months:emergencyCoverage};
    });
    for(const b of Object.values(byCurrency))for(const key of ['target','current','remaining','contribution_30d','recent_monthly_pace','planned_monthly_target'])b[key]=round(b[key]);
    return res.json({
      privacy:'Owner-only Savings & Reserve Control. Goal planning is not exposed to Company Finance users.',
      movement_rule:'Savings progress and control settings are planning records. Voxel Veda never transfers money into a goal automatically.',
      pace_rule:'Required pace uses remaining target and target date. Recent pace uses recorded goal contributions from the last 90 days and is not a bank-balance movement.',
      emergency_rule:'Emergency-fund coverage uses the goal current amount divided by average Personal Money EXPENSE/CASH_OUT over the last 90 days in the same currency.',
      currency_rule:'Goals and reserve coverage remain separated by native currency.',
      summary,by_currency:byCurrency,goals
    });
  }catch(error){return fail(res,error,'Failed to load Savings & Reserve Control.')}
};

exports.saveControl=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const owner=uid(req);await db.beginTransaction();const g=await goal(db,req.params.id,owner,{forUpdate:true});
    const [[before]]=await db.query('SELECT * FROM personal_money_savings_control WHERE goal_id=? AND user_id=? LIMIT 1 FOR UPDATE',[g.id,owner]);
    const goalType=String(req.body.goal_type||'OTHER').trim().toUpperCase(),fundingStrategy=String(req.body.funding_strategy||'MANUAL').trim().toUpperCase(),liquidityPriority=String(req.body.liquidity_priority||g.priority||'MEDIUM').trim().toUpperCase();
    if(!GOAL_TYPES.has(goalType))throw new FinanceError('Choose a valid reserve/goal type.',400,'INVALID_SAVINGS_GOAL_TYPE');
    if(!FUNDING_STRATEGIES.has(fundingStrategy))throw new FinanceError('Choose a valid funding planning cadence.',400,'INVALID_SAVINGS_FUNDING_STRATEGY');
    if(!PRIORITIES.has(liquidityPriority))throw new FinanceError('Liquidity priority must be Low, Medium or High.',400,'INVALID_SAVINGS_PRIORITY');
    const monthlyTarget=amount(req.body.monthly_target,'Monthly target'),protectedFloor=amount(req.body.protected_floor,'Protected floor');
    if(protectedFloor>Number(g.target_amount)+0.0001)throw new FinanceError('Protected floor cannot exceed the goal target.',400,'SAVINGS_FLOOR_ABOVE_TARGET');
    const contributionDay=integerOrNull(req.body.contribution_day,1,31,'Contribution day');
    const values={goal_type:goalType,funding_strategy:fundingStrategy,monthly_target:monthlyTarget,protected_floor:protectedFloor,liquidity_priority:liquidityPriority,contribution_day:contributionDay,
      funding_source_note:clean(req.body.funding_source_note,500),decision_note:clean(req.body.decision_note,700)};
    await db.query(`INSERT INTO personal_money_savings_control
      (goal_id,user_id,goal_type,funding_strategy,monthly_target,protected_floor,liquidity_priority,contribution_day,funding_source_note,decision_note,reviewed_at,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?)
      ON DUPLICATE KEY UPDATE goal_type=VALUES(goal_type),funding_strategy=VALUES(funding_strategy),monthly_target=VALUES(monthly_target),protected_floor=VALUES(protected_floor),
        liquidity_priority=VALUES(liquidity_priority),contribution_day=VALUES(contribution_day),funding_source_note=VALUES(funding_source_note),decision_note=VALUES(decision_note),reviewed_at=NOW(),updated_by=VALUES(updated_by)`,
      [g.id,owner,values.goal_type,values.funding_strategy,values.monthly_target,values.protected_floor,values.liquidity_priority,values.contribution_day,values.funding_source_note,values.decision_note,Number(owner)||null]);
    await logAudit(db,audit(req,'PERSONAL_SAVINGS_CONTROL_UPDATED',g.id,before||null,{...values,name:g.name,currency:g.currency,target_amount:Number(g.target_amount||0),current_amount:Number(g.current_amount||0)}));
    await db.commit();
    return res.json({message:'Savings & reserve control saved. No money was transferred and goal progress was not changed.',control:values});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save Savings & Reserve Control.');}
  finally{db.release()}
};

exports.getStatement=async(req,res)=>{
  try{
    const owner=uid(req),g=await goal(pool,req.params.id,owner);
    const [[control]]=await pool.query('SELECT * FROM personal_money_savings_control WHERE goal_id=? AND user_id=? LIMIT 1',[g.id,owner]);
    const [contributions]=await pool.query(`SELECT id,amount,contributed_at,note,created_at FROM personal_money_goal_contributions WHERE goal_id=? AND user_id=? ORDER BY contributed_at,created_at`,[g.id,owner]);
    const total=round(contributions.reduce((sum,x)=>sum+Number(x.amount||0),0));
    return res.json({
      statement_rule:'This is an owner-only Voxel Veda savings-progress statement. It is not a bank statement and does not prove money is segregated in a bank account.',
      movement_rule:'Recorded goal contributions update planning progress only; they do not transfer funds automatically.',
      goal:{...g,target_amount:Number(g.target_amount||0),current_amount:Number(g.current_amount||0)},
      control:control?{...control,monthly_target:Number(control.monthly_target||0),protected_floor:Number(control.protected_floor||0)}:null,
      totals:{recorded_contributions:total,current_progress:Number(g.current_amount||0),target_amount:Number(g.target_amount||0),remaining_amount:Math.max(0,round(Number(g.target_amount||0)-Number(g.current_amount||0))),currency:g.currency},
      contributions:contributions.map(x=>({...x,amount:Number(x.amount||0)}))
    });
  }catch(error){return fail(res,error,'Failed to load savings statement.')}
};
