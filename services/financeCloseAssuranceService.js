'use strict';

const crypto = require('node:crypto');
const { FinanceError } = require('./financeDomain');

function dateText(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function n(value) { return Number(value || 0); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function first(db, sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows[0] || {};
}
async function resolvePeriod(db, periodId) {
  let row;
  if (periodId) {
    row = await first(db,
      `SELECT ap.*,fy.label AS financial_year_label,fy.status AS financial_year_status
         FROM accounting_periods ap JOIN financial_years fy ON fy.id=ap.financial_year_id
        WHERE ap.id=? LIMIT 1`, [Number(periodId)]);
  } else {
    row = await first(db,
      `SELECT ap.*,fy.label AS financial_year_label,fy.status AS financial_year_status
         FROM accounting_periods ap JOIN financial_years fy ON fy.id=ap.financial_year_id
        WHERE CURRENT_DATE BETWEEN ap.start_date AND ap.end_date
        ORDER BY ap.start_date DESC LIMIT 1`);
    if (!row.id) {
      row = await first(db,
        `SELECT ap.*,fy.label AS financial_year_label,fy.status AS financial_year_status
           FROM accounting_periods ap JOIN financial_years fy ON fy.id=ap.financial_year_id
          ORDER BY ap.end_date DESC LIMIT 1`);
    }
  }
  if (!row.id) throw new FinanceError('Accounting period not found.', 404, 'ACCOUNTING_PERIOD_NOT_FOUND');
  return {...row,start_date:dateText(row.start_date),end_date:dateText(row.end_date)};
}
async function invoiceMetrics(db, endDate) {
  try {
    return await first(db,
      `SELECT COUNT(*) AS count,COALESCE(SUM(GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0)),0) AS amount
         FROM invoices i
         LEFT JOIN (SELECT invoice_id,SUM(amount) AS paid_amount FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
        WHERE COALESCE(i.deleted,0)=0
          AND LOWER(COALESCE(i.status,'')) NOT IN ('rejected','void')
          AND DATE(i.created_at)<=?
          AND GREATEST(COALESCE(i.total,0)-COALESCE(p.paid_amount,0),0)>0.009`, [endDate]);
  } catch (error) {
    if (['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code)) return {count:0,amount:0,unavailable:true};
    throw error;
  }
}

async function computePeriodCloseReadiness(db, periodId) {
  const period = await resolvePeriod(db, periodId);
  const range = [period.start_date, period.end_date];

  const [
    draftLedger, unreconciledLedger, missingTax, draftJournals, unbalancedJournals,
    bankUnclassified, ownershipMissing, bankUnreconciled, receiptExceptions,
    cashVariances, cashNotCounted, pendingBills, openAccountant, highIssues, otherIssues,
    bankNoActivity, payables, receivables
  ] = await Promise.all([
    first(db,`SELECT COUNT(*) count FROM finance_transactions WHERE effective_date BETWEEN ? AND ? AND status='DRAFT'`,range),
    first(db,`SELECT COUNT(*) count FROM finance_transactions WHERE effective_date BETWEEN ? AND ? AND status='POSTED' AND reconciliation_status NOT IN ('RECONCILED','IGNORED')`,range),
    first(db,`SELECT COUNT(*) count FROM finance_transactions WHERE effective_date BETWEEN ? AND ? AND status='POSTED' AND tax_code_id IS NULL`,range),
    first(db,`SELECT COUNT(*) count FROM journal_entries WHERE entry_date BETWEEN ? AND ? AND status='DRAFT'`,range),
    first(db,`SELECT COUNT(*) count FROM journal_entries WHERE entry_date BETWEEN ? AND ? AND ABS(COALESCE(total_debit,0)-COALESCE(total_credit,0))>0.009 AND status<>'VOID'`,range),
    first(db,`SELECT COUNT(*) count FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.transaction_date BETWEEN ? AND ? AND ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
        AND bt.reconciliation_status<>'IGNORED'
        AND (COALESCE(bt.category,'')='' OR COALESCE(bt.classification_status,'')<>'CLASSIFIED')`,range),
    first(db,`SELECT COUNT(*) count FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.transaction_date BETWEEN ? AND ? AND ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
        AND COALESCE(bt.ownership_scope,'UNCLASSIFIED')='UNCLASSIFIED' AND bt.reconciliation_status<>'IGNORED'`,range),
    first(db,`SELECT COUNT(*) count FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.transaction_date BETWEEN ? AND ? AND ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
        AND bt.reconciliation_status NOT IN ('RECONCILED','IGNORED')`,range),
    first(db,`SELECT COUNT(*) count FROM finance_receipt_requirements rr
      JOIN bank_transactions bt ON bt.id=rr.bank_transaction_id JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.transaction_date BETWEEN ? AND ? AND ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
        AND rr.status IN ('MISSING','REQUESTED')`,range),
    first(db,`SELECT COUNT(*) count,COALESCE(SUM(ABS(variance_amount)),0) amount FROM finance_cash_counts
      WHERE ownership_scope='BUSINESS' AND DATE(counted_at) BETWEEN ? AND ? AND status='REVIEW_REQUIRED'`,range),
    first(db,`SELECT COUNT(*) count FROM bank_accounts ba
      WHERE ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
        AND (LOWER(COALESCE(ba.account_type,'')) LIKE '%cash%' OR LOWER(COALESCE(ba.nickname,'')) LIKE '%cash%'
             OR LOWER(COALESCE(ba.nickname,'')) LIKE '%petty%' OR LOWER(COALESCE(ba.financial_purpose,'')) LIKE '%cash%')
        AND NOT EXISTS (SELECT 1 FROM finance_cash_counts cc WHERE cc.source_type='BANK_ACCOUNT' AND cc.bank_account_id=ba.id AND DATE(cc.counted_at) BETWEEN ? AND ?)`,range),
    first(db,`SELECT COUNT(*) count,COALESCE(SUM(total_amount-paid_amount),0) amount FROM supplier_bills
      WHERE issue_date BETWEEN ? AND ? AND status IN ('DRAFT','PENDING_APPROVAL')`,range),
    first(db,`SELECT COUNT(*) count FROM accountant_queries WHERE financial_year_id=? AND status<>'RESOLVED'`,[period.financial_year_id]),
    first(db,`SELECT COUNT(*) count FROM finance_issues WHERE financial_year_id=? AND status='OPEN'
      AND UPPER(severity) IN ('BLOCKING_ERROR','BLOCKER','CRITICAL','HIGH')`,[period.financial_year_id]),
    first(db,`SELECT COUNT(*) count FROM finance_issues WHERE financial_year_id=? AND status='OPEN'
      AND UPPER(severity) NOT IN ('BLOCKING_ERROR','BLOCKER','CRITICAL','HIGH')`,[period.financial_year_id]),
    first(db,`SELECT COUNT(*) count FROM bank_accounts ba WHERE ba.status='ACTIVE' AND ba.ownership_scope='BUSINESS'
      AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.bank_account_id=ba.id AND bt.transaction_date BETWEEN ? AND ?)`,range),
    first(db,`SELECT COUNT(*) count,COALESCE(SUM(GREATEST(total_amount-paid_amount,0)),0) amount FROM supplier_bills
      WHERE issue_date<=? AND status NOT IN ('PAID','VOID') AND GREATEST(total_amount-paid_amount,0)>0.009`,[period.end_date]),
    invoiceMetrics(db, period.end_date)
  ]);

  const checks = [
    {id:'DRAFT_LEDGER',title:'Draft finance transactions cleared',severity:'BLOCKER',actual:n(draftLedger.count),pass:n(draftLedger.count)===0,target:0,action_view:'transactions'},
    {id:'LEDGER_RECONCILIATION',title:'Posted accounting transactions reconciled',severity:'BLOCKER',actual:n(unreconciledLedger.count),pass:n(unreconciledLedger.count)===0,target:0,action_view:'reconciliation'},
    {id:'TAX_CODE_COMPLETENESS',title:'Posted transactions have tax treatment',severity:'BLOCKER',actual:n(missingTax.count),pass:n(missingTax.count)===0,target:0,action_view:'taxcontrol'},
    {id:'DRAFT_JOURNALS',title:'Draft journals cleared',severity:'BLOCKER',actual:n(draftJournals.count),pass:n(draftJournals.count)===0,target:0,action_view:'company'},
    {id:'BALANCED_JOURNALS',title:'Journal debits equal credits',severity:'BLOCKER',actual:n(unbalancedJournals.count),pass:n(unbalancedJournals.count)===0,target:0,action_view:'company'},
    {id:'BANK_CLASSIFICATION',title:'Business bank transactions classified',severity:'BLOCKER',actual:n(bankUnclassified.count),pass:n(bankUnclassified.count)===0,target:0,action_view:'review'},
    {id:'BANK_OWNERSHIP',title:'Business bank ownership classified',severity:'BLOCKER',actual:n(ownershipMissing.count),pass:n(ownershipMissing.count)===0,target:0,action_view:'review'},
    {id:'BANK_RECONCILIATION',title:'Business bank transactions reconciled',severity:'BLOCKER',actual:n(bankUnreconciled.count),pass:n(bankUnreconciled.count)===0,target:0,action_view:'reconciliation'},
    {id:'RECEIPT_EVIDENCE',title:'Receipt exceptions resolved',severity:'BLOCKER',actual:n(receiptExceptions.count),pass:n(receiptExceptions.count)===0,target:0,action_view:'receipts'},
    {id:'CASH_VARIANCE',title:'Cash count variances reviewed',severity:'BLOCKER',actual:n(cashVariances.count),pass:n(cashVariances.count)===0,target:0,action_view:'cash',amount:n(cashVariances.amount)},
    {id:'SUPPLIER_APPROVALS',title:'Period supplier drafts/approvals cleared',severity:'BLOCKER',actual:n(pendingBills.count),pass:n(pendingBills.count)===0,target:0,action_view:'company',amount:n(pendingBills.amount)},
    {id:'ACCOUNTANT_QUERIES',title:'Accountant questions resolved',severity:'BLOCKER',actual:n(openAccountant.count),pass:n(openAccountant.count)===0,target:0,action_view:'company'},
    {id:'HIGH_FINANCE_ISSUES',title:'High-severity finance issues resolved',severity:'BLOCKER',actual:n(highIssues.count),pass:n(highIssues.count)===0,target:0,action_view:'review'},
    {id:'CASH_COUNT_COVERAGE',title:'Business cash accounts counted this period',severity:'WARNING',actual:n(cashNotCounted.count),pass:n(cashNotCounted.count)===0,target:0,action_view:'cash'},
    {id:'BANK_ACTIVITY_COVERAGE',title:'Active business bank accounts have period activity',severity:'WARNING',actual:n(bankNoActivity.count),pass:n(bankNoActivity.count)===0,target:0,action_view:'accounts'},
    {id:'OTHER_FINANCE_ISSUES',title:'Other open finance issues reviewed',severity:'WARNING',actual:n(otherIssues.count),pass:n(otherIssues.count)===0,target:0,action_view:'review'}
  ];
  const blockerCount = checks.filter(x=>x.severity==='BLOCKER'&&!x.pass).length;
  const warningCount = checks.filter(x=>x.severity==='WARNING'&&!x.pass).length;
  const evidence = {
    period:{id:period.id,financial_year_id:period.financial_year_id,financial_year_label:period.financial_year_label,period_key:period.period_key,start_date:period.start_date,end_date:period.end_date},
    checks:checks.map(x=>({id:x.id,severity:x.severity,actual:x.actual,pass:x.pass,amount:x.amount||0})),
    informational:{
      open_payables:{count:n(payables.count),amount:n(payables.amount)},
      open_receivables:{count:n(receivables.count),amount:n(receivables.amount),unavailable:Boolean(receivables.unavailable)}
    }
  };
  const fingerprint = hash(JSON.stringify(evidence));
  return {
    period,
    readiness_status:blockerCount===0?'READY_TO_CERTIFY':'NOT_READY',
    blocker_count:blockerCount,
    warning_count:warningCount,
    checks,
    blockers:checks.filter(x=>x.severity==='BLOCKER'&&!x.pass),
    warnings:checks.filter(x=>x.severity==='WARNING'&&!x.pass),
    informational:evidence.informational,
    fingerprint,
    generated_at:new Date().toISOString(),
    rule:'A period is certifiable only when every blocker is clear. Certification fingerprints the measured evidence; a later change invalidates locking until the period is certified again.'
  };
}
module.exports={computePeriodCloseReadiness,resolvePeriod};
