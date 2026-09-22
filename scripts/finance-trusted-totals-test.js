'use strict';

const assert = require('node:assert/strict');
const { cashTotalsByCurrency, categorySpendByCurrency, singleCurrencySummary } = require('../services/financeTrustedTotals');

async function run() {
  let cashSql = '';
  const cashDb = {
    async query(sql) {
      cashSql = sql;
      return [[{
        currency: 'AUD',
        source_transaction_count: 5,
        transfer_transaction_count: 2,
        money_in: '1200.00',
        money_out: '500.00',
        linked_refund_inflow: '200.00',
        transfer_movement: '1000.00',
        cash_out: '40.00',
        cash_in: '0.00',
        unclassified: 2
      }]];
    }
  };
  const totals = await cashTotalsByCurrency(cashDb, "bt.transaction_date>='2026-08-01'", []);
  assert.equal(totals.length, 1);
  assert.deepEqual(totals[0], {
    currency: 'AUD',
    source_transaction_count: 5,
    transfer_transaction_count: 2,
    money_in: '1200.00',
    money_out: '500.00',
    ordinary_money_in: '1000.00',
    linked_refund_inflow: '200.00',
    net_cash_flow: '700.00',
    net_economic_expense: '300.00',
    transfer_movement: '1000.00',
    cash_out: '40.00',
    cash_in: '0.00',
    unclassified: 2
  });
  assert.match(cashSql, /bt\.is_internal_transfer=0/, 'cash totals must exclude confirmed transfers from money-in/out');
  assert.match(cashSql, /finance_refund_links/, 'cash totals must identify linked refunds');
  assert.match(cashSql, /status='ACTIVE'/, 'only active refund links may change refund totals');

  let categorySql = '';
  const categoryDb = {
    async query(sql) {
      categorySql = sql;
      return [[
        { currency: 'AUD', category: 'Groceries', source_transaction_count: 1, split_line_count: 1, spent: '300.00' },
        { currency: 'AUD', category: 'Business Supplies', source_transaction_count: 1, split_line_count: 1, spent: '150.00' },
        { currency: 'AUD', category: 'Personal Supplies', source_transaction_count: 1, split_line_count: 1, spent: '50.00' }
      ]];
    }
  };
  const categories = await categorySpendByCurrency(categoryDb, '1=1', [], 50);
  assert.equal(categories.reduce((sum, row) => sum + Number(row.spent), 0), 500);
  assert.match(categorySql, /LEFT JOIN bank_transaction_splits/, 'category totals must consume split rows');
  assert.match(categorySql, /CASE WHEN s\.id IS NOT NULL THEN s\.amount ELSE bt\.debit END/, 'split children must replace parent category amount rather than double count it');
  assert.match(categorySql, /bt\.is_internal_transfer=0/, 'transfer movement must not consume expense categories');

  assert.equal(singleCurrencySummary(totals).consolidated_available, true);
  const mixed = singleCurrencySummary([totals[0], { ...totals[0], currency: 'USD' }]);
  assert.equal(mixed.consolidated_available, false);
  assert.equal(mixed.mixed_currencies, true);
  assert.match(mixed.message, /Mixed currencies/);

  console.log('Finance trusted totals math and SQL policy checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
