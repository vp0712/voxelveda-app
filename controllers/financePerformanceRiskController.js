'use strict';

const pool=require('../config/db');
const { ensureFinanceSchema }=require('../services/financeSchema');
const { FinanceError }=require('../services/financeDomain');
const privacy=require('../services/financePrivacyService');

function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
function round(v){return Math.round((n(v)+Number.EPSILON)*100)/100}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
function fail(res,error){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error('Finance Performance & Stress Control failed',error);
  return res.status(500).json({message:'Failed to load Finance Performance & Stress Control.',code:'FINANCE_PERFORMANCE_RISK_FAILED'});
}
function isoUtcDay(date){return date.toISOString().slice(0,10)}
function utcDate(value){
  const text=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
  const d=new Date(text+'T00:00:00Z');
  return Number.isNaN(d.getTime())?null:d;
}
function monthAnchor(year,month,day){
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(day,last)));
}
function addUtcDays(date,days){const d=new Date(date.getTime());d.setUTCDate(d.getUTCDate()+days);return d}
function budgetWindow(cycle,anchorValue,nowValue=new Date()){
  const anchor=utcDate(anchorValue);
  if(!anchor)throw new FinanceError('Budget anchor date is invalid.',400,'INVALID_BUDGET_ANCHOR');
  const now=new Date(Date.UTC(nowValue.getUTCFullYear(),nowValue.getUTCMonth(),nowValue.getUTCDate()));
  if(cycle==='MONTHLY'){
    const day=anchor.getUTCDate();
    let start=monthAnchor(now.getUTCFullYear(),now.getUTCMonth(),day);
    if(start>now)start=monthAnchor(now.getUTCFullYear(),now.getUTCMonth()-1,day);
    return {start,end:monthAnchor(start.getUTCFullYear(),start.getUTCMonth()+1,day),now};
  }
  const days=cycle==='FORTNIGHTLY'?14:7;
  const diff=Math.floor((now-anchor)/86400000);
  const periods=Math.floor(diff/days);
  const start=addUtcDays(anchor,periods*days);
  return {start,end:addUtcDays(start,days),now};
}
function elapsedFraction(window){
  const total=Math.max(1,(window.end-window.start)/86400000);
  const elapsed=clamp((window.now-window.start)/86400000,0,total);
  return clamp(elapsed/total,0,1);
}
function stressPosition(row){
  const cash=round(row.cash_balance),in90=round(row.inflow_90d),out90=round(row.outflow_90d);
  const dailyIn=in90/90,dailyOut=out90/90;
  const project=(days,inFactor=1,outFactor=1)=>round(cash+((dailyIn*inFactor)-(dailyOut*outFactor))*days);
  const runway=(factor=1)=>dailyOut>0?Math.max(0,Math.floor(Math.max(0,cash)/(dailyOut*factor))):null;
  const combined90=project(90,.8,1.2);
  let level='STABLE';
  if(combined90<0)level='HIGH';
  else if(project(90)<0||(runway(1.2)!==null&&runway(1.2)<90))level='WATCH';
  return {
    ownership_scope:String(row.ownership_scope||'UNCLASSIFIED').toUpperCase(),
    currency:String(row.currency||'AUD').toUpperCase(),
    account_count:Number(row.account_count||0),cash_balance:cash,inflow_90d:in90,outflow_90d:out90,
    average_daily_inflow_90d:round(dailyIn),average_daily_outflow_90d:round(dailyOut),
    average_monthly_inflow_90d:round(dailyIn*30.4375),average_monthly_outflow_90d:round(dailyOut*30.4375),
    net_daily_trend:round(dailyIn-dailyOut),
    runway_no_income_days:runway(1),runway_expense_up_20_days:runway(1.2),
    projections:{
      base_30d:project(30),base_90d:project(90),
      income_down_20_30d:project(30,.8,1),income_down_20_90d:project(90,.8,1),
      expense_up_20_30d:project(30,1,1.2),expense_up_20_90d:project(90,1,1.2),
      combined_downside_30d:project(30,.8,1.2),combined_downside_90d:combined90
    },
    risk_level:level
  };
}

exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const userId=Number(req.user?.id||req.user?.user_id||0);
    if(!userId)throw new FinanceError('User identity unavailable.',401,'USER_REQUIRED');
    const visibility=privacy.visibilitySql('ba',req),visibilityParams=privacy.visibilityParams(req);

    const [accounts,flows,months,quality,budgets]=await Promise.all([
      pool.query(`SELECT ba.ownership_scope,ba.currency,COUNT(*) AS account_count,
          COALESCE(SUM(CASE WHEN ba.available_balance IS NULL THEN ba.current_ledger_balance ELSE ba.available_balance END),0) AS cash_balance
        FROM bank_accounts ba
        WHERE ba.status='ACTIVE' AND ${visibility}
        GROUP BY ba.ownership_scope,ba.currency
        ORDER BY ba.ownership_scope,ba.currency`,visibilityParams).then(([rows])=>rows),
      pool.query(`SELECT ba.ownership_scope,bt.currency,
          COALESCE(SUM(CASE WHEN bt.credit>0 AND bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS inflow_90d,
          COALESCE(SUM(CASE WHEN bt.debit>0 AND bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS outflow_90d
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED'
          AND bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 90 DAY)
          AND ${visibility}
        GROUP BY ba.ownership_scope,bt.currency
        ORDER BY ba.ownership_scope,bt.currency`,visibilityParams).then(([rows])=>rows),
      pool.query(`SELECT ba.ownership_scope,bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m') AS month,
          COALESCE(SUM(CASE WHEN bt.credit>0 AND bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
          COALESCE(SUM(CASE WHEN bt.debit>0 AND bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED'
          AND bt.transaction_date>=DATE_FORMAT(DATE_SUB(CURDATE(),INTERVAL 5 MONTH),'%Y-%m-01')
          AND ${visibility}
        GROUP BY ba.ownership_scope,bt.currency,DATE_FORMAT(bt.transaction_date,'%Y-%m')
        ORDER BY month,ba.ownership_scope,bt.currency`,visibilityParams).then(([rows])=>rows),
      pool.query(`SELECT ba.ownership_scope,bt.currency,
          COUNT(*) AS transaction_count,
          SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' THEN 1 ELSE 0 END) AS unclassified_count,
          SUM(CASE WHEN bt.reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) AS unreconciled_count
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED' AND ${visibility}
        GROUP BY ba.ownership_scope,bt.currency`,visibilityParams).then(([rows])=>rows),
      pool.query(`SELECT id,budget_uid,ownership_scope,category,currency,cycle,cycle_anchor_date,limit_amount,active,updated_at
        FROM finance_bank_budgets WHERE created_by=? AND active=1
        ORDER BY ownership_scope,currency,category`,[userId]).then(([rows])=>rows)
    ]);

    const accountMap=new Map(accounts.map(r=>[String(r.ownership_scope||'UNCLASSIFIED').toUpperCase()+'|'+String(r.currency||'AUD').toUpperCase(),r]));
    const flowMap=new Map(flows.map(r=>[String(r.ownership_scope||'UNCLASSIFIED').toUpperCase()+'|'+String(r.currency||'AUD').toUpperCase(),r]));
    const qualityMap=new Map(quality.map(r=>[String(r.ownership_scope||'UNCLASSIFIED').toUpperCase()+'|'+String(r.currency||'AUD').toUpperCase(),r]));
    const keys=new Set([...accountMap.keys(),...flowMap.keys(),...qualityMap.keys()]);
    const positions=[...keys].sort().map(key=>{
      const a=accountMap.get(key)||{},f=flowMap.get(key)||{},q=qualityMap.get(key)||{};
      const [scope,currency]=key.split('|');
      return {...stressPosition({ownership_scope:scope,currency,account_count:a.account_count,cash_balance:a.cash_balance,inflow_90d:f.inflow_90d,outflow_90d:f.outflow_90d}),
        transaction_count:Number(q.transaction_count||0),unclassified_count:Number(q.unclassified_count||0),unreconciled_count:Number(q.unreconciled_count||0)};
    });

    const budgetItems=[];
    for(const budget of budgets){
      const cycle=String(budget.cycle||'MONTHLY').toUpperCase();
      const window=budgetWindow(cycle,budget.cycle_anchor_date);
      const scope=String(budget.ownership_scope||'PERSONAL').toUpperCase();
      const currency=String(budget.currency||'AUD').toUpperCase();
      const category=String(budget.category||'Unclassified');
      const clauses=[visibility,"bt.archived_at IS NULL","bt.reconciliation_status<>'IGNORED'","bt.is_internal_transfer=0","bt.debit>0","bt.currency=?","bt.transaction_date>=?","bt.transaction_date<?"];
      const params=[...visibilityParams,currency,isoUtcDay(window.start),isoUtcDay(window.end)];
      if(scope!=='ALL'){clauses.push('bt.ownership_scope=?');params.push(scope)}
      const [[spentRow]]=await pool.query(`SELECT COALESCE(SUM(
          CASE WHEN EXISTS(SELECT 1 FROM bank_transaction_splits sx WHERE sx.parent_bank_transaction_id=bt.id)
            THEN COALESCE((SELECT SUM(s.amount) FROM bank_transaction_splits s WHERE s.parent_bank_transaction_id=bt.id AND COALESCE(NULLIF(s.category,''),'Unclassified')=?),0)
            ELSE CASE WHEN COALESCE(NULLIF(bt.category,''),'Unclassified')=? THEN bt.debit ELSE 0 END END),0) AS spent
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ${clauses.join(' AND ')}`,[category,category,...params]);
      const limit=n(budget.limit_amount),spent=round(spentRow.spent),elapsed=elapsedFraction(window);
      const used=limit>0?spent/limit:0,projected=elapsed>0?round(spent/elapsed):spent;
      const status=spent>limit+0.005?'OVER_LIMIT':projected>limit+0.005?'PACE_RISK':'ON_TRACK';
      budgetItems.push({...budget,limit_amount:round(limit),spent_amount:spent,remaining_amount:round(limit-spent),
        used_percent:round(used*100),elapsed_percent:round(elapsed*100),pace_delta_percent:round((used-elapsed)*100),
        projected_period_end_spend:projected,projected_overage:round(Math.max(0,projected-limit)),status,
        period_start:isoUtcDay(window.start),period_end_exclusive:isoUtcDay(window.end)});
    }

    const monthlyTrend=months.map(r=>({ownership_scope:String(r.ownership_scope||'UNCLASSIFIED').toUpperCase(),
      currency:String(r.currency||'AUD').toUpperCase(),month:r.month,money_in:round(r.money_in),money_out:round(r.money_out),
      net_cash_flow:round(n(r.money_in)-n(r.money_out))}));

    const signals=[];
    for(const p of positions){
      if(p.projections.combined_downside_90d<0)signals.push({severity:'HIGH',code:'COMBINED_90D_NEGATIVE',ownership_scope:p.ownership_scope,currency:p.currency,message:'90-day combined downside projection falls below zero using -20% inflow and +20% outflow.'});
      else if(p.projections.base_90d<0)signals.push({severity:'HIGH',code:'BASE_90D_NEGATIVE',ownership_scope:p.ownership_scope,currency:p.currency,message:'90-day base trend projection falls below zero.'});
      if(p.runway_expense_up_20_days!==null&&p.runway_expense_up_20_days<90)signals.push({severity:'WATCH',code:'STRESSED_RUNWAY_LT_90D',ownership_scope:p.ownership_scope,currency:p.currency,message:'No-income runway under +20% expense stress is below 90 days.'});
      if(p.unclassified_count>0||p.unreconciled_count>0)signals.push({severity:'REVIEW',code:'DATA_QUALITY_OPEN',ownership_scope:p.ownership_scope,currency:p.currency,message:`${p.unclassified_count} unclassified and ${p.unreconciled_count} unreconciled transaction(s) remain.`});
    }
    for(const b of budgetItems){
      if(b.status==='OVER_LIMIT')signals.push({severity:'HIGH',code:'BUDGET_OVER_LIMIT',ownership_scope:b.ownership_scope,currency:b.currency,message:`${b.category} is over its ${String(b.cycle).toLowerCase()} budget.`,budget_uid:b.budget_uid});
      else if(b.status==='PACE_RISK')signals.push({severity:'WATCH',code:'BUDGET_PACE_RISK',ownership_scope:b.ownership_scope,currency:b.currency,message:`${b.category} is projected above budget at the current period pace.`,budget_uid:b.budget_uid});
    }

    return res.json({
      rules:{
        currency:'Every performance, budget and stress figure stays in its native currency. No silent FX conversion is performed.',
        cash_scope:'Liquidity stress uses account ownership scope so cash is not invented or allocated out of MIXED/UNCLASSIFIED accounts.',
        projections:'Stress projections extrapolate the last 90 days average bank-ledger inflow/outflow. They are arithmetic scenarios, not predictions or recommendations.',
        budget:'Budget pace compares current spend with elapsed time in the configured weekly, fortnightly or monthly period. Split lines replace parent category amounts.',
        mutation:'Performance & Stress Control is read-only and never posts transactions, changes budgets, executes payments or edits account balances.'
      },
      generated_at:new Date().toISOString(),positions,monthly_trend:monthlyTrend,budgets:budgetItems,signals,
      summary:{position_count:positions.length,budget_count:budgetItems.length,high_signal_count:signals.filter(x=>x.severity==='HIGH').length,
        watch_signal_count:signals.filter(x=>x.severity==='WATCH').length,budgets_over_limit:budgetItems.filter(x=>x.status==='OVER_LIMIT').length,
        budgets_at_pace_risk:budgetItems.filter(x=>x.status==='PACE_RISK').length}
    });
  }catch(error){return fail(res,error)}
};
