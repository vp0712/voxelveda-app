'use strict';

const money = require('../utils/money');

/**
 * Canonical bank-ledger cash aggregation.
 *
 * Cash-flow totals stay at the source bank-transaction level:
 * - ignored transactions are expected to be excluded by the caller's WHERE clause;
 * - confirmed internal transfers remain visible movement but are excluded from money-in/out;
 * - linked refunds are cash inflow, but are exposed separately so callers never present them as ordinary revenue;
 * - currencies are always grouped independently.
 */
async function cashTotalsByCurrency(db, whereSql, params) {
  const [rows] = await db.query(
    `SELECT bt.currency,
            COUNT(*) AS source_transaction_count,
            SUM(CASE WHEN bt.is_internal_transfer=1 THEN 1 ELSE 0 END) AS transfer_transaction_count,
            COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END),0) AS money_in,
            COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END),0) AS money_out,
            COALESCE(SUM(CASE WHEN bt.is_internal_transfer=0
              THEN LEAST(COALESCE(bt.credit,0),COALESCE(rf.linked_refund_amount,0)) ELSE 0 END),0) AS linked_refund_inflow,
            COALESCE(SUM(CASE WHEN bt.is_internal_transfer=1 THEN GREATEST(COALESCE(bt.debit,0),COALESCE(bt.credit,0)) ELSE 0 END),0) AS transfer_movement
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       LEFT JOIN (
         SELECT refund_bank_transaction_id,SUM(linked_amount) AS linked_refund_amount
           FROM finance_refund_links
          WHERE status='ACTIVE'
          GROUP BY refund_bank_transaction_id
       ) rf ON rf.refund_bank_transaction_id=bt.id
      WHERE ${whereSql}
      GROUP BY bt.currency
      ORDER BY bt.currency`,
    params
  );
  return rows.map((row) => {
    const moneyIn = money.fromCents(money.toCents(row.money_in || 0));
    const moneyOut = money.fromCents(money.toCents(row.money_out || 0));
    const refunds = money.fromCents(money.toCents(row.linked_refund_inflow || 0));
    return {
      currency: String(row.currency || 'AUD').toUpperCase(),
      source_transaction_count: Number(row.source_transaction_count || 0),
      transfer_transaction_count: Number(row.transfer_transaction_count || 0),
      money_in: moneyIn,
      money_out: moneyOut,
      ordinary_money_in: money.fromCents(money.toCents(moneyIn) - money.toCents(refunds)),
      linked_refund_inflow: refunds,
      net_cash_flow: money.fromCents(money.toCents(moneyIn) - money.toCents(moneyOut)),
      net_economic_expense: money.fromCents(money.toCents(moneyOut) - money.toCents(refunds)),
      transfer_movement: money.fromCents(money.toCents(row.transfer_movement || 0))
    };
  });
}

/**
 * Category allocation over the canonical bank transaction.
 * A split parent contributes child amounts instead of also contributing its parent debit,
 * preventing parent + child double counting.
 */
async function categorySpendByCurrency(db, whereSql, params, limit = 120) {
  const [rows] = await db.query(
    `SELECT bt.currency,
            COALESCE(NULLIF(s.category,''),NULLIF(bt.category,''),'Unclassified') AS category,
            COUNT(DISTINCT bt.id) AS source_transaction_count,
            COUNT(s.id) AS split_line_count,
            COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN s.amount ELSE bt.debit END),0) AS spent
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       LEFT JOIN bank_transaction_splits s ON s.parent_bank_transaction_id=bt.id
      WHERE bt.debit>0 AND bt.is_internal_transfer=0 AND ${whereSql}
      GROUP BY bt.currency,COALESCE(NULLIF(s.category,''),NULLIF(bt.category,''),'Unclassified')
      ORDER BY bt.currency,spent DESC
      LIMIT ?`,
    [...params, Math.max(1, Math.min(500, Number(limit) || 120))]
  );
  return rows.map((row) => ({
    currency: String(row.currency || 'AUD').toUpperCase(),
    category: row.category,
    source_transaction_count: Number(row.source_transaction_count || 0),
    split_line_count: Number(row.split_line_count || 0),
    spent: money.fromCents(money.toCents(row.spent || 0))
  }));
}

function singleCurrencySummary(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    return {
      consolidated_available: false,
      mixed_currencies: Array.isArray(rows) && rows.length > 1,
      message: Array.isArray(rows) && rows.length > 1
        ? 'Mixed currencies — consolidated total unavailable until verified FX rates are available.'
        : 'No financial activity exists for the selected filters.'
    };
  }
  return { consolidated_available: true, mixed_currencies: false, ...rows[0] };
}

module.exports = { cashTotalsByCurrency, categorySpendByCurrency, singleCurrencySummary };
