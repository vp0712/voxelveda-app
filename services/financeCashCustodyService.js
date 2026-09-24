'use strict';

function remaining(row){
  return Math.max(0,Math.round((Number(row?.issued_amount||0)-Number(row?.returned_amount||0)-Number(row?.cleared_expense_amount||0))*10000)/10000);
}
function displayStatus(row){
  if(String(row?.status||'').toUpperCase()==='CANCELLED')return 'CANCELLED';
  const left=remaining(row);
  if(left<=0.0001)return 'CLOSED';
  if(row?.due_at&&new Date(row.due_at).getTime()<Date.now())return 'OVERDUE';
  if(Number(row?.active_event_count||0)>0)return 'PARTIAL';
  return 'OPEN';
}
async function metrics(db,caseId){
  const [[row]]=await db.query(
    "SELECT c.id,c.issued_amount,c.due_at,c.status,"+
    "COALESCE((SELECT SUM(e.amount) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type='RETURN' AND e.reversed_at IS NULL),0) AS returned_amount,"+
    "COALESCE((SELECT SUM(e.amount) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type='EXPENSE_CLEARANCE' AND e.reversed_at IS NULL),0) AS cleared_expense_amount,"+
    "COALESCE((SELECT COUNT(*) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type IN ('RETURN','EXPENSE_CLEARANCE') AND e.reversed_at IS NULL),0) AS active_event_count "+
    "FROM finance_cash_custody_cases c WHERE c.id=? LIMIT 1",
    [caseId]
  );
  if(!row)return null;
  return {...row,outstanding_amount:remaining(row),display_status:displayStatus(row)};
}
async function outstandingForSource(db,{sourceType,bankAccountId=null,walletId=null}){
  const type=String(sourceType||'').toUpperCase();
  const field=type==='BANK_ACCOUNT'?'bank_account_id':'personal_wallet_id';
  const value=type==='BANK_ACCOUNT'?bankAccountId:walletId;
  if(value===null||value===undefined||value==='')return 0;
  const [[row]]=await db.query(
    "SELECT COALESCE(SUM(GREATEST(c.issued_amount-"+
    "COALESCE((SELECT SUM(e.amount) FROM finance_cash_custody_events e WHERE e.custody_id=c.id AND e.event_type IN ('RETURN','EXPENSE_CLEARANCE') AND e.reversed_at IS NULL),0),0)),0) AS outstanding "+
    "FROM finance_cash_custody_cases c WHERE c.status<>'CANCELLED' AND c."+field+"=?",
    [value]
  );
  return Math.round(Number(row?.outstanding||0)*10000)/10000;
}
async function refreshStatus(db,caseId,actorId){
  const row=await metrics(db,caseId);
  if(!row)return null;
  if(String(row.status||'').toUpperCase()==='CANCELLED')return row;
  let status='OPEN';
  if(row.outstanding_amount<=0.0001)status='CLOSED';
  else if(row.due_at&&new Date(row.due_at).getTime()<Date.now())status='OVERDUE';
  else if(Number(row.active_event_count||0)>0)status='PARTIAL';
  await db.query("UPDATE finance_cash_custody_cases SET status=?,closed_by=?,closed_at=? WHERE id=?",
    [status,status==='CLOSED'?actorId:null,status==='CLOSED'?new Date():null,caseId]);
  return {...row,status,display_status:status};
}
module.exports={remaining,displayStatus,metrics,outstandingForSource,refreshStatus};
