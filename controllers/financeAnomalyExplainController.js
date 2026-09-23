'use strict';

const pool=require('../config/db');
const { ensureFinanceSchema }=require('../services/financeSchema');
const { FinanceError }=require('../services/financeDomain');
const privacy=require('../services/financePrivacyService');

function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
function round(v){return Math.round((n(v)+Number.EPSILON)*100)/100}
function iso(value){return String(value||'').slice(0,10)}
function utc(value){const d=new Date(iso(value)+'T00:00:00Z');return Number.isNaN(d.getTime())?null:d}
function addDays(value,days){const d=utc(value);if(!d)return null;d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function changePct(current,previous){return Math.abs(n(previous))<0.0001?null:round(((n(current)-n(previous))/Math.abs(n(previous)))*100)}
function median(values){const xs=values.map(n).filter(x=>x>0).sort((a,b)=>a-b);if(!xs.length)return 0;const m=Math.floor(xs.length/2);return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2}
function key(scope,currency){return String(scope||'UNCLASSIFIED').toUpperCase()+'|'+String(currency||'AUD').toUpperCase()}
function friendlyMerchant(row){return String(row.merchant||row.merchant_name||row.description||'Unknown merchant').trim().slice(0,220)||'Unknown merchant'}
function fail(res,error){
 if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
 console.error('Finance Anomaly & Explainability failed',error);
 return res.status(500).json({message:'Failed to load Finance Anomaly & Explainability.',code:'FINANCE_ANOMALY_EXPLAIN_FAILED'});
}

exports.getCenter=async(req,res)=>{
 try{
  await ensureFinanceSchema();
  const visibility=privacy.visibilitySql('ba',req),visibilityParams=privacy.visibilityParams(req);
  const [todayRows,transactions,categoryRows]=await Promise.all([
    pool.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS today").then(([rows])=>rows),
    pool.query(`SELECT bt.id,DATE_FORMAT(bt.transaction_date,'%Y-%m-%d') AS transaction_date,
        COALESCE(NULLIF(bt.ownership_scope,''),ba.ownership_scope,'UNCLASSIFIED') AS ownership_scope,
        COALESCE(NULLIF(bt.currency,''),ba.currency,'AUD') AS currency,
        bt.debit,bt.credit,bt.category,bt.classification_status,bt.reconciliation_status,bt.is_internal_transfer,
        COALESCE(NULLIF(bt.merchant_normalized,''),NULLIF(bt.merchant_name,''),NULLIF(bt.description,''),'Unknown merchant') AS merchant,
        bt.description,ba.nickname AS account_name
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED'
        AND bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 120 DAY)
        AND ${visibility}
      ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 10000`,visibilityParams).then(([rows])=>rows),
    pool.query(`SELECT bt.id,DATE_FORMAT(bt.transaction_date,'%Y-%m-%d') AS transaction_date,
        COALESCE(NULLIF(bt.ownership_scope,''),ba.ownership_scope,'UNCLASSIFIED') AS ownership_scope,
        COALESCE(NULLIF(bt.currency,''),ba.currency,'AUD') AS currency,
        COALESCE(NULLIF(bs.category,''),NULLIF(bt.category,''),'Uncategorised') AS category,
        CASE WHEN bs.id IS NULL THEN bt.debit ELSE bs.amount END AS amount
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      LEFT JOIN bank_transaction_splits bs ON bs.parent_bank_transaction_id=bt.id
      WHERE bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED' AND bt.is_internal_transfer=0 AND bt.debit>0
        AND bt.transaction_date>=DATE_SUB(CURDATE(),INTERVAL 60 DAY)
        AND ${visibility}
      ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 20000`,visibilityParams).then(([rows])=>rows)
  ]);
  const today=String(todayRows[0]?.today||new Date().toISOString().slice(0,10));
  const currentStart=addDays(today,-29),previousStart=addDays(today,-59),previousEnd=addDays(today,-30);

  const positions=new Map(),merchantMap=new Map(),currentDebitRows=new Map();
  function pos(scope,currency){
    const k=key(scope,currency);
    if(!positions.has(k))positions.set(k,{
      ownership_scope:String(scope||'UNCLASSIFIED').toUpperCase(),currency:String(currency||'AUD').toUpperCase(),
      current_in:0,current_out:0,previous_in:0,previous_out:0,current_transactions:0,previous_transactions:0,
      observed_transactions_120d:0,unclassified_120d:0,unreconciled_120d:0,earliest:null,latest:null
    });
    return positions.get(k);
  }

  for(const row of transactions){
    const scope=String(row.ownership_scope||'UNCLASSIFIED').toUpperCase(),currency=String(row.currency||'AUD').toUpperCase(),k=key(scope,currency);
    const p=pos(scope,currency),day=iso(row.transaction_date),isCurrent=day>=currentStart&&day<=today,isPrevious=day>=previousStart&&day<=previousEnd;
    p.observed_transactions_120d++;
    if(String(row.classification_status||'').toUpperCase()==='UNCLASSIFIED'||!String(row.category||'').trim())p.unclassified_120d++;
    if(String(row.reconciliation_status||'').toUpperCase()==='UNRECONCILED')p.unreconciled_120d++;
    if(!p.earliest||day<p.earliest)p.earliest=day;if(!p.latest||day>p.latest)p.latest=day;
    if(!Number(row.is_internal_transfer)){
      if(isCurrent){p.current_in+=n(row.credit);p.current_out+=n(row.debit);p.current_transactions++}
      if(isPrevious){p.previous_in+=n(row.credit);p.previous_out+=n(row.debit);p.previous_transactions++}
    }
    if(n(row.debit)>0&&!Number(row.is_internal_transfer)&&(isCurrent||isPrevious)){
      const merchant=friendlyMerchant(row),mk=k+'|'+merchant.toLowerCase();
      if(!merchantMap.has(mk))merchantMap.set(mk,{ownership_scope:scope,currency,merchant,current:0,previous:0,current_transaction_ids:[],previous_transaction_ids:[]});
      const m=merchantMap.get(mk);
      if(isCurrent){m.current+=n(row.debit);if(m.current_transaction_ids.length<5)m.current_transaction_ids.push(Number(row.id))}
      if(isPrevious){m.previous+=n(row.debit);if(m.previous_transaction_ids.length<5)m.previous_transaction_ids.push(Number(row.id))}
      if(isCurrent){if(!currentDebitRows.has(k))currentDebitRows.set(k,[]);currentDebitRows.get(k).push(row)}
    }
  }

  const categoryMap=new Map();
  for(const row of categoryRows){
    const day=iso(row.transaction_date),isCurrent=day>=currentStart&&day<=today,isPrevious=day>=previousStart&&day<=previousEnd;
    if(!isCurrent&&!isPrevious)continue;
    const scope=String(row.ownership_scope||'UNCLASSIFIED').toUpperCase(),currency=String(row.currency||'AUD').toUpperCase(),category=String(row.category||'Uncategorised').trim()||'Uncategorised';
    const ck=key(scope,currency)+'|'+category.toLowerCase();
    if(!categoryMap.has(ck))categoryMap.set(ck,{ownership_scope:scope,currency,category,current:0,previous:0,current_transaction_ids:[],previous_transaction_ids:[]});
    const c=categoryMap.get(ck),amt=n(row.amount);
    if(isCurrent){c.current+=amt;if(c.current_transaction_ids.length<5&&!c.current_transaction_ids.includes(Number(row.id)))c.current_transaction_ids.push(Number(row.id))}
    if(isPrevious){c.previous+=amt;if(c.previous_transaction_ids.length<5&&!c.previous_transaction_ids.includes(Number(row.id)))c.previous_transaction_ids.push(Number(row.id))}
  }

  const positionRows=[...positions.values()].map(p=>{
    const earliest=utc(p.earliest),latest=utc(p.latest),coverage=earliest&&latest?Math.floor((latest-earliest)/86400000)+1:0;
    const count=Math.max(1,p.observed_transactions_120d),unclassifiedRatio=p.unclassified_120d/count,unreconciledRatio=p.unreconciled_120d/count;
    let readiness='LOW';
    if(coverage>=90&&unclassifiedRatio<=.05&&unreconciledRatio<=.05)readiness='HIGH';
    else if(coverage>=60&&unclassifiedRatio<=.20&&unreconciledRatio<=.20)readiness='MEDIUM';
    return {
      ownership_scope:p.ownership_scope,currency:p.currency,
      current_30d:{money_in:round(p.current_in),money_out:round(p.current_out),net_cash_flow:round(p.current_in-p.current_out),transaction_count:p.current_transactions},
      previous_30d:{money_in:round(p.previous_in),money_out:round(p.previous_out),net_cash_flow:round(p.previous_in-p.previous_out),transaction_count:p.previous_transactions},
      change:{money_in:round(p.current_in-p.previous_in),money_in_percent:changePct(p.current_in,p.previous_in),money_out:round(p.current_out-p.previous_out),money_out_percent:changePct(p.current_out,p.previous_out),net_cash_flow:round((p.current_in-p.current_out)-(p.previous_in-p.previous_out))},
      analysis_readiness:{level:readiness,observed_days:coverage,transaction_count_120d:p.observed_transactions_120d,unclassified_count:p.unclassified_120d,unreconciled_count:p.unreconciled_120d,unclassified_percent:round(unclassifiedRatio*100),unreconciled_percent:round(unreconciledRatio*100),earliest_date:p.earliest,latest_date:p.latest}
    };
  }).sort((a,b)=>(a.ownership_scope+a.currency).localeCompare(b.ownership_scope+b.currency));

  const positionMap=new Map(positionRows.map(p=>[key(p.ownership_scope,p.currency),p]));
  const categoryShifts=[];
  for(const c of categoryMap.values()){
    const p=positionMap.get(key(c.ownership_scope,c.currency)),currentTotal=n(p?.current_30d?.money_out),previousTotal=n(p?.previous_30d?.money_out),delta=c.current-c.previous;
    const currentShare=currentTotal>0?c.current/currentTotal:0,previousShare=previousTotal>0?c.previous/previousTotal:0;
    let signal=null;
    if(c.previous<=0.005&&c.current>0&&currentShare>=.05)signal='NEW_CATEGORY';
    else if(c.previous>0&&c.current>=c.previous*1.35&&Math.abs(delta)>=currentTotal*.05)signal='CATEGORY_UP';
    else if(c.previous>0&&c.current<=c.previous*.65&&Math.abs(delta)>=previousTotal*.05)signal='CATEGORY_DOWN';
    if(signal)categoryShifts.push({...c,current:round(c.current),previous:round(c.previous),change_amount:round(delta),change_percent:changePct(c.current,c.previous),current_share_percent:round(currentShare*100),previous_share_percent:round(previousShare*100),signal});
  }
  categoryShifts.sort((a,b)=>Math.abs(b.change_amount)-Math.abs(a.change_amount));

  const merchantShifts=[];
  for(const m of merchantMap.values()){
    const p=positionMap.get(key(m.ownership_scope,m.currency)),currentTotal=n(p?.current_30d?.money_out),delta=m.current-m.previous,currentShare=currentTotal>0?m.current/currentTotal:0;
    let signal=null;
    if(m.previous<=0.005&&m.current>0&&currentShare>=.05)signal='NEW_MERCHANT';
    else if(m.previous>0&&m.current>=m.previous*1.5&&Math.abs(delta)>=currentTotal*.05)signal='MERCHANT_SPIKE';
    else if(currentShare>=.35&&m.current>0)signal='MERCHANT_CONCENTRATION';
    if(signal)merchantShifts.push({...m,current:round(m.current),previous:round(m.previous),change_amount:round(delta),change_percent:changePct(m.current,m.previous),current_share_percent:round(currentShare*100),signal});
  }
  merchantShifts.sort((a,b)=>Math.abs(b.change_amount)-Math.abs(a.change_amount));

  const outliers=[];
  for(const [k,rows] of currentDebitRows.entries()){
    if(rows.length<5)continue;
    const med=median(rows.map(r=>r.debit)),p=positionMap.get(k),total=n(p?.current_30d?.money_out),threshold=Math.max(med*3,total*.10);
    if(threshold<=0)continue;
    for(const row of rows){
      const amt=n(row.debit);if(amt+0.005<threshold)continue;
      outliers.push({transaction_id:Number(row.id),ownership_scope:String(row.ownership_scope||'UNCLASSIFIED').toUpperCase(),currency:String(row.currency||'AUD').toUpperCase(),transaction_date:iso(row.transaction_date),merchant:friendlyMerchant(row),account_name:row.account_name||null,amount:round(amt),median_transaction_amount:round(med),threshold_amount:round(threshold),multiple_of_median:med>0?round(amt/med):null});
    }
  }
  outliers.sort((a,b)=>(b.multiple_of_median||0)-(a.multiple_of_median||0));

  const signals=[];
  for(const p of positionRows){
    if(p.previous_30d.money_out>0&&p.current_30d.money_out>=p.previous_30d.money_out*1.25)signals.push({severity:'WATCH',code:'SPEND_UP_30D',ownership_scope:p.ownership_scope,currency:p.currency,message:`30-day money out is ${p.change.money_out_percent===null?'higher':Math.abs(p.change.money_out_percent)+'% higher'} than the prior 30 days.`});
    if(p.change.net_cash_flow<0&&Math.abs(p.change.net_cash_flow)>=Math.max(1,p.current_30d.money_out*.10))signals.push({severity:'WATCH',code:'NET_FLOW_DETERIORATION',ownership_scope:p.ownership_scope,currency:p.currency,message:'30-day net cash flow deteriorated materially versus the prior 30 days.'});
    if(p.analysis_readiness.level==='LOW')signals.push({severity:'REVIEW',code:'LOW_ANALYSIS_READINESS',ownership_scope:p.ownership_scope,currency:p.currency,message:'Anomaly interpretation has low readiness because history coverage or classification/reconciliation quality is limited.'});
  }
  for(const x of merchantShifts.slice(0,10))signals.push({severity:'REVIEW',code:x.signal,ownership_scope:x.ownership_scope,currency:x.currency,message:`${x.merchant}: ${x.signal.replaceAll('_',' ').toLowerCase()}.`,transaction_ids:x.current_transaction_ids});
  for(const x of categoryShifts.slice(0,10))signals.push({severity:'REVIEW',code:x.signal,ownership_scope:x.ownership_scope,currency:x.currency,message:`${x.category}: ${x.signal.replaceAll('_',' ').toLowerCase()}.`,transaction_ids:x.current_transaction_ids});
  for(const x of outliers.slice(0,10))signals.push({severity:'REVIEW',code:'LARGE_TRANSACTION_OUTLIER',ownership_scope:x.ownership_scope,currency:x.currency,message:`${x.merchant}: large debit versus the current 30-day transaction distribution.`,transaction_ids:[x.transaction_id]});

  return res.json({
    generated_at:new Date().toISOString(),
    windows:{current_30d:{from:currentStart,to:today},previous_30d:{from:previousStart,to:previousEnd},history_observation_days:120},
    rules:{
      currency:'Every comparison stays inside the same native currency. No silent FX conversion or cross-currency aggregation is performed.',
      comparison:'Change analysis compares the most recent 30 calendar days with the immediately preceding 30 days using preserved bank-ledger activity.',
      category:'Category shifts use split lines when a transaction has splits; otherwise the current transaction category is used.',
      anomaly:'Merchant/category signals are deterministic share-and-change checks. Large outliers require at least five current-period debit transactions and use the greater of 3x median debit or 10% of current-period spend.',
      readiness:'Analysis readiness is transparent: HIGH requires at least 90 observed days with <=5% unclassified and unreconciled rows; MEDIUM requires 60 days with <=20%; otherwise LOW.',
      mutation:'Anomaly & Explainability is read-only. It never categorises, reconciles, posts, deletes or executes money movement automatically.'
    },
    positions:positionRows,category_shifts:categoryShifts.slice(0,50),merchant_shifts:merchantShifts.slice(0,50),outliers:outliers.slice(0,50),signals:signals.slice(0,100),
    summary:{position_count:positionRows.length,high_readiness_positions:positionRows.filter(x=>x.analysis_readiness.level==='HIGH').length,low_readiness_positions:positionRows.filter(x=>x.analysis_readiness.level==='LOW').length,category_shift_count:categoryShifts.length,merchant_shift_count:merchantShifts.length,outlier_count:outliers.length,signal_count:signals.length}
  });
 }catch(error){return fail(res,error)}
};
