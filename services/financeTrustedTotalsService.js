'use strict';

const money = require('../utils/money');

function joins(alias='bt') {
  return `
    LEFT JOIN (
      SELECT refund_bank_transaction_id,
             COALESCE(SUM(linked_amount),0) AS linked_refund_amount
        FROM finance_refund_links
       WHERE status='ACTIVE'
       GROUP BY refund_bank_transaction_id
    ) finance_refund_received ON finance_refund_received.refund_bank_transaction_id=${alias}.id
    LEFT JOIN (
      SELECT payment_bank_transaction_id,
             COALESCE(SUM(amount),0) AS reimbursement_settlement_amount
        FROM finance_reimbursement_payments
       GROUP BY payment_bank_transaction_id
    ) finance_reimbursement_settlement ON finance_reimbursement_settlement.payment_bank_transaction_id=${alias}.id`;
}

function selectExpressions(alias='bt') {
  const transfer=`COALESCE(${alias}.is_internal_transfer,0)=1`;
  const refund=`LEAST(COALESCE(${alias}.credit,0),COALESCE(finance_refund_received.linked_refund_amount,0))`;
  const reimbursement=`LEAST(COALESCE(${alias}.debit,0),COALESCE(finance_reimbursement_settlement.reimbursement_settlement_amount,0))`;
  return {
    cashIn: `CASE WHEN NOT (${transfer}) THEN COALESCE(${alias}.credit,0) ELSE 0 END`,
    cashOut: `CASE WHEN NOT (${transfer}) THEN COALESCE(${alias}.debit,0) ELSE 0 END`,
    transferIn: `CASE WHEN ${transfer} THEN COALESCE(${alias}.credit,0) ELSE 0 END`,
    transferOut: `CASE WHEN ${transfer} THEN COALESCE(${alias}.debit,0) ELSE 0 END`,
    refundOffset: `CASE WHEN NOT (${transfer}) THEN ${refund} ELSE 0 END`,
    reimbursementSettlement: `CASE WHEN NOT (${transfer}) THEN ${reimbursement} ELSE 0 END`,
    income: `CASE WHEN NOT (${transfer}) THEN GREATEST(COALESCE(${alias}.credit,0)-${refund},0) ELSE 0 END`,
    grossExpense: `CASE WHEN NOT (${transfer}) THEN GREATEST(COALESCE(${alias}.debit,0)-${reimbursement},0) ELSE 0 END`,
    netExpense: `CASE WHEN NOT (${transfer}) THEN GREATEST(COALESCE(${alias}.debit,0)-${reimbursement},0)-${refund} ELSE 0 END`
  };
}

function aggregateSelect(alias='bt') {
  const e=selectExpressions(alias);
  return [
    `COALESCE(SUM(${e.cashIn}),0) AS cash_in`,
    `COALESCE(SUM(${e.cashOut}),0) AS cash_out`,
    `COALESCE(SUM(${e.transferIn}),0) AS transfer_in`,
    `COALESCE(SUM(${e.transferOut}),0) AS transfer_out`,
    `COALESCE(SUM(${e.income}),0) AS economic_income`,
    `COALESCE(SUM(${e.grossExpense}),0) AS gross_economic_expense`,
    `COALESCE(SUM(${e.refundOffset}),0) AS refund_offset`,
    `COALESCE(SUM(${e.reimbursementSettlement}),0) AS reimbursement_settlement`,
    `COALESCE(SUM(${e.netExpense}),0) AS net_economic_expense`
  ].join(',\n');
}

function normalize(row={}) {
  const fields=['cash_in','cash_out','transfer_in','transfer_out','economic_income','gross_economic_expense','refund_offset','reimbursement_settlement','net_economic_expense'];
  const out={};
  for(const key of fields) out[key]=money.fromCents(money.toCents(row[key]||0));
  out.net_cash_flow=money.subtract(out.cash_in,out.cash_out);
  out.economic_result=money.subtract(out.economic_income,out.net_economic_expense);
  return out;
}

function summarizeRows(rows=[]) {
  let cashIn=0n,cashOut=0n,transferIn=0n,transferOut=0n,income=0n,grossExpense=0n,refundOffset=0n,reimbursementSettlement=0n;
  for(const row of rows){
    const debit=money.toCents(row.debit||0),credit=money.toCents(row.credit||0);
    const refund=credit < money.toCents(row.linked_refund_amount||0) ? credit : money.toCents(row.linked_refund_amount||0);
    const reimb=debit < money.toCents(row.reimbursement_settlement_amount||0) ? debit : money.toCents(row.reimbursement_settlement_amount||0);
    if(Number(row.is_internal_transfer||0)){
      transferIn+=credit; transferOut+=debit; continue;
    }
    cashIn+=credit; cashOut+=debit; refundOffset+=refund; reimbursementSettlement+=reimb;
    income+=credit-refund; grossExpense+=debit-reimb;
  }
  const netExpense=grossExpense-refundOffset;
  return normalize({
    cash_in:money.fromCents(cashIn),cash_out:money.fromCents(cashOut),
    transfer_in:money.fromCents(transferIn),transfer_out:money.fromCents(transferOut),
    economic_income:money.fromCents(income),gross_economic_expense:money.fromCents(grossExpense),
    refund_offset:money.fromCents(refundOffset),reimbursement_settlement:money.fromCents(reimbursementSettlement),
    net_economic_expense:money.fromCents(netExpense)
  });
}

const POLICY=Object.freeze({
  cash_flow:'Cash in/out excludes confirmed internal transfers but still shows refunds and reimbursement settlements as real cash movements.',
  income:'Linked merchant refund amounts are excluded from economic income.',
  expense:'Linked reimbursement settlement debits are excluded from economic expense because the underlying employee-paid expense is the economic cost.',
  refunds:'Linked refunds reduce economic expense in the period the refund credit occurs.',
  transfers:'Confirmed internal transfers have zero income and zero expense impact.',
  currency:'Currencies are never combined without verified FX evidence.'
});

module.exports={joins,selectExpressions,aggregateSelect,normalize,summarizeRows,POLICY};
