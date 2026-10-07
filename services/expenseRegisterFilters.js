'use strict';
const { paymentSql } = require('./expensePaymentDomain');
function expenseFilters(input = {}) {
  const clauses=['e.deleted=0'], params=[];
  const {paid,due}=paymentSql();
  const fy=String(input.fy||'').trim();
  if(fy) {
    if(!/^\d{4}$/.test(fy)||Number(fy)<1900||Number(fy)>2200) throw new TypeError('Choose a valid financial year');
    clauses.push('e.expense_date BETWEEN ? AND ?'); params.push(fy+'-07-01',(Number(fy)+1)+'-06-30');
  }
  for(const key of ['from','to']) if(input[key]) {
    const value=String(input[key]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value)))throw new TypeError('Choose valid dates');
    clauses.push('e.expense_date '+(key==='from'?'>=':'<=')+' ?');params.push(value);
  }
  if(input.from&&input.to&&input.from>input.to)throw new TypeError('The start date must precede the end date');
  if(input.search) { clauses.push('(e.supplier_name LIKE ? OR e.category LIKE ? OR e.invoice_no LIKE ? OR e.description LIKE ?)');params.push(...Array(4).fill('%'+String(input.search).trim()+'%')); }
  if(input.category) { clauses.push("COALESCE(NULLIF(TRIM(e.category),''),'Uncategorised')=?");params.push(String(input.category)); }
  if(input.supplier) { clauses.push("COALESCE(NULLIF(TRIM(e.supplier_name),''),'Unassigned supplier')=?");params.push(String(input.supplier)); }
  if(input.id) { if(!/^\d+$/.test(String(input.id)))throw new TypeError('Invalid bill');clauses.push('e.id=?');params.push(Number(input.id)); }
  const status=String(input.status||'').toLowerCase();
  if(status==='paid')clauses.push(`${due}=0`);
  else if(status==='settled')clauses.push(`(${paid})>0`);
  else if(status==='pending')clauses.push(`${due}>0`);
  else if(status==='upcoming')clauses.push(`${due}>0 AND (e.due_date IS NULL OR e.due_date>=CURDATE())`);
  else if(status==='overdue')clauses.push(`${due}>0 AND e.due_date IS NOT NULL AND e.due_date<CURDATE()`);
  else if(status==='partially_paid')clauses.push(`${due}>0 AND (${paid})>0`);
  else if(status)throw new TypeError('Invalid payable status');
  return {where:'WHERE '+clauses.join(' AND '),params};
}
module.exports={expenseFilters};
