const pool = require('../config/db');

function uid(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}

function respondError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function monthDaysUtc() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    elapsed: Math.max(1, now.getUTCDate()),
    total: new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  };
}

function financialYearStart(value) {
  const now = new Date();
  const current = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  if (value === undefined || value === null || value === '') return current;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw Object.assign(new Error('Financial year start must be a four-digit year.'), { statusCode: 400 });
  }
  return parsed;
}

function ensure(map, code) {
  const currency = String(code || 'AUD').toUpperCase();
  if (!map[currency]) {
    map[currency] = {
      currency,
      bank_balance: 0,
      manual_wallet_balance: 0,
      lent_receivable: 0,
      borrowed_liability: 0,
      safety_buffer_target: 0,
      current_month_income: 0,
      current_month_spending: 0,
      previous_month_income: 0,
      previous_month_spending: 0,
      average_monthly_spending_90d: 0,
      bank_transaction_count_90d: 0,
      budget_limit: 0,
      budget_spent: 0,
      known_recurring_outflows_30d: 0
    };
  }
  return map[currency];
}

function statusFor(row) {
  const attention = [];
  const positives = [];
  if (row.borrowed_liability > 0 && row.monthly_net < 0) attention.push('Spending is currently above income while borrowed money remains outstanding.');
  if (row.safety_buffer_target > 0 && row.buffer_progress_percent < 100) attention.push(`Safety buffer is ${row.buffer_progress_percent}% funded.`);
  if (row.runway_months !== null && row.runway_months < 1) attention.push('Visible liquid funds cover less than one average month of spending.');
  if (row.budget_limit > 0 && row.budget_used_percent > 100) attention.push('Current-month tracked budgets are over their combined limit.');
  if (row.spending_change_percent !== null && row.spending_change_percent > 15) attention.push('Spending is materially higher than last month.');

  if (row.monthly_net > 0) positives.push('Income is above spending this month.');
  if (row.safety_buffer_target > 0 && row.buffer_progress_percent >= 100) positives.push('Visible liquid funds meet the safety-buffer target.');
  if (row.borrowed_liability === 0) positives.push('No open borrowed-money balance is recorded in Personal Money.');
  if (row.budget_limit > 0 && row.budget_used_percent <= 100) positives.push('Tracked current-month budgets remain within their combined limit.');

  return {
    label: attention.length ? 'Needs attention' : (positives.length ? 'On track' : 'Not enough data'),
    attention,
    positives
  };
}

function buildTaxReadiness(rows, year) {
  const byCurrency = {};
  const monthly = {};
  const categories = {};
  const reviewItems = [];
  const add = (currency, field, value) => {
    const code = String(currency || 'AUD').toUpperCase();
    if (!byCurrency[code]) byCurrency[code] = { recorded_income: 0, recorded_expenses: 0, cash_in: 0, cash_out: 0 };
    byCurrency[code][field] = round(byCurrency[code][field] + Number(value || 0));
  };
  for (const row of rows) {
    const code = String(row.currency || 'AUD').toUpperCase();
    const amount = Number(row.amount || 0);
    const month = String(row.occurred_at || '').slice(0, 7);
    if (!monthly[code]) monthly[code] = {};
    if (!monthly[code][month]) monthly[code][month] = { income: 0, expenses: 0, cash_in: 0, cash_out: 0 };
    if (row.entry_type === 'INCOME') { add(code, 'recorded_income', amount); monthly[code][month].income = round(monthly[code][month].income + amount); }
    if (row.entry_type === 'EXPENSE') { add(code, 'recorded_expenses', amount); monthly[code][month].expenses = round(monthly[code][month].expenses + amount); }
    if (row.entry_type === 'CASH_IN') { add(code, 'cash_in', amount); monthly[code][month].cash_in = round(monthly[code][month].cash_in + amount); }
    if (row.entry_type === 'CASH_OUT') { add(code, 'cash_out', amount); monthly[code][month].cash_out = round(monthly[code][month].cash_out + amount); }
    if (['EXPENSE', 'CASH_OUT'].includes(row.entry_type)) {
      const category = String(row.category || 'Uncategorised');
      const categoryKey = `${code}::${category}`;
      if (!categories[categoryKey]) categories[categoryKey] = { currency: code, category, count: 0, amount: 0 };
      categories[categoryKey].count += 1;
      categories[categoryKey].amount = round(categories[categoryKey].amount + amount);
      reviewItems.push({ id: row.id, entry_type: row.entry_type, amount, currency: code, category: row.category || null, counterparty: row.counterparty || null, note: row.note || null, occurred_at: row.occurred_at, wallet_name: row.wallet_name });
    }
  }
  return {
    privacy: 'Owner-only PERSONAL Money preparation data. Company finance transactions are not included.',
    jurisdiction_note: 'This preparation view uses an Australian-style 1 July to 30 June financial-year window. It does not calculate tax liability, tax payable, taxable income, or legal deductibility.',
    financial_year: { start_year: year, label: `${year}-${String(year + 1).slice(-2)}`, start_date: `${year}-07-01`, end_date: `${year + 1}-06-30` },
    currency_rule: 'Currencies remain separate. No tax FX conversion or ATO exchange-rate assumption is applied.',
    summary_by_currency: byCurrency,
    monthly_by_currency: monthly,
    categories: Object.values(categories).sort((a, b) => b.amount - a.amount),
    review_items: reviewItems,
    rules: [
      'Recorded INCOME entries are not automatically taxable income.',
      'EXPENSE and CASH_OUT items are review candidates only; category names do not create a deduction.',
      'CASH_IN and CASH_OUT stay separate because they may be transfers, withdrawals, deposits or other cash movements.',
      'Tax review classifications and evidence flags in the interface are local organisational notes only unless later saved through an explicitly approved record-changing feature.'
    ]
  };
}

exports.getHealthDashboard = async (req, res) => {
  try {
    const userId = uid(req);
    const fyYear = financialYearStart(req.query.fy_start);
    const fyStart = `${fyYear}-07-01`;
    const fyEnd = `${fyYear + 1}-07-01`;
    const [bankBalances, walletBalances, debtRows, bufferRows, bankFlowRows, spend90Rows, budgetRows, recurringRows, taxRows] = await Promise.all([
      pool.query(
        `SELECT currency,COALESCE(SUM(COALESCE(available_balance,current_ledger_balance,0)),0) total
         FROM bank_accounts
         WHERE created_by=? AND ownership_scope='PERSONAL' AND status='ACTIVE'
         GROUP BY currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT currency,COALESCE(SUM(balance),0) total
         FROM personal_money_wallets WHERE user_id=? AND active=1 GROUP BY currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT currency,
           COALESCE(SUM(CASE WHEN direction='BORROWED' AND status<>'SETTLED' THEN outstanding_amount ELSE 0 END),0) borrowed,
           COALESCE(SUM(CASE WHEN direction='LENT' AND status<>'SETTLED' THEN outstanding_amount ELSE 0 END),0) lent
         FROM personal_money_debts WHERE user_id=? GROUP BY currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT currency,reserve_amount FROM personal_money_safety_buffers WHERE user_id=?`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,
           COALESCE(SUM(CASE WHEN bt.transaction_date>=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01') THEN bt.credit ELSE 0 END),0) current_income,
           COALESCE(SUM(CASE WHEN bt.transaction_date>=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01') THEN bt.debit ELSE 0 END),0) current_spending,
           COALESCE(SUM(CASE WHEN bt.transaction_date>=DATE_FORMAT(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH),'%Y-%m-01') AND bt.transaction_date<DATE_FORMAT(CURRENT_DATE,'%Y-%m-01') THEN bt.credit ELSE 0 END),0) previous_income,
           COALESCE(SUM(CASE WHEN bt.transaction_date>=DATE_FORMAT(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH),'%Y-%m-01') AND bt.transaction_date<DATE_FORMAT(CURRENT_DATE,'%Y-%m-01') THEN bt.debit ELSE 0 END),0) previous_spending
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' AND bt.is_internal_transfer=0
           AND bt.transaction_date>=DATE_FORMAT(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH),'%Y-%m-01')
         GROUP BY bt.currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.currency,COUNT(*) transaction_count,COALESCE(SUM(bt.debit),0) spend_90d
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' AND bt.is_internal_transfer=0
           AND bt.debit>0 AND bt.transaction_date>=DATE_SUB(CURRENT_DATE,INTERVAL 90 DAY)
         GROUP BY bt.currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT b.currency,COALESCE(SUM(b.limit_amount),0) limit_total,
           COALESCE(SUM((
             SELECT COALESCE(SUM(e.wallet_amount),0)
             FROM personal_money_entries e
             JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
             WHERE e.user_id=b.user_id AND w.currency=b.currency AND e.category=b.category
               AND e.entry_type IN ('EXPENSE','CASH_OUT')
               AND e.occurred_at>=b.month_start AND e.occurred_at<DATE_ADD(b.month_start,INTERVAL 1 MONTH)
           )),0) spent_total
         FROM personal_money_budgets b
         WHERE b.user_id=? AND b.month_start=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')
         GROUP BY b.currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT currency,COALESCE(SUM(amount),0) due_total
         FROM personal_money_recurring_items
         WHERE user_id=? AND active=1 AND item_type<>'INCOME'
           AND next_due_date>=CURRENT_DATE AND next_due_date<=DATE_ADD(CURRENT_DATE,INTERVAL 30 DAY)
         GROUP BY currency`, [userId]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT e.id,e.entry_type,e.amount,e.currency,e.category,e.counterparty,e.note,e.occurred_at,w.name wallet_name
         FROM personal_money_entries e
         JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
         WHERE e.user_id=? AND e.occurred_at>=? AND e.occurred_at<?
         ORDER BY e.occurred_at DESC,e.created_at DESC`, [userId, fyStart, fyEnd]
      ).then(([rows]) => rows)
    ]);

    const byCurrency = {};
    bankBalances.forEach((r) => { ensure(byCurrency, r.currency).bank_balance = Number(r.total || 0); });
    walletBalances.forEach((r) => { ensure(byCurrency, r.currency).manual_wallet_balance = Number(r.total || 0); });
    debtRows.forEach((r) => { const row=ensure(byCurrency,r.currency); row.borrowed_liability=Number(r.borrowed||0); row.lent_receivable=Number(r.lent||0); });
    bufferRows.forEach((r) => { ensure(byCurrency,r.currency).safety_buffer_target=Number(r.reserve_amount||0); });
    bankFlowRows.forEach((r) => { const row=ensure(byCurrency,r.currency); row.current_month_income=Number(r.current_income||0); row.current_month_spending=Number(r.current_spending||0); row.previous_month_income=Number(r.previous_income||0); row.previous_month_spending=Number(r.previous_spending||0); });
    spend90Rows.forEach((r) => { const row=ensure(byCurrency,r.currency); row.average_monthly_spending_90d=Number(r.spend_90d||0)/3; row.bank_transaction_count_90d=Number(r.transaction_count||0); });
    budgetRows.forEach((r) => { const row=ensure(byCurrency,r.currency); row.budget_limit=Number(r.limit_total||0); row.budget_spent=Number(r.spent_total||0); });
    recurringRows.forEach((r) => { ensure(byCurrency,r.currency).known_recurring_outflows_30d=Number(r.due_total||0); });

    const monthDays = monthDaysUtc();
    Object.values(byCurrency).forEach((row) => {
      row.bank_balance = round(row.bank_balance);
      row.manual_wallet_balance = round(row.manual_wallet_balance);
      row.visible_liquid_funds = round(row.bank_balance + row.manual_wallet_balance);
      row.lent_receivable = round(row.lent_receivable);
      row.borrowed_liability = round(row.borrowed_liability);
      row.net_position_estimate = round(row.visible_liquid_funds + row.lent_receivable - row.borrowed_liability);
      row.current_month_income = round(row.current_month_income);
      row.current_month_spending = round(row.current_month_spending);
      row.monthly_net = round(row.current_month_income - row.current_month_spending);
      row.previous_month_income = round(row.previous_month_income);
      row.previous_month_spending = round(row.previous_month_spending);
      row.savings_rate_percent = row.current_month_income > 0 ? round((row.monthly_net / row.current_month_income) * 100, 1) : null;
      row.spending_change_percent = row.previous_month_spending > 0 ? round(((row.current_month_spending - row.previous_month_spending) / row.previous_month_spending) * 100, 1) : null;
      row.projected_month_end_spending = round((row.current_month_spending / monthDays.elapsed) * monthDays.total);
      row.average_monthly_spending_90d = round(row.average_monthly_spending_90d);
      row.runway_months = row.average_monthly_spending_90d > 0 ? round(row.visible_liquid_funds / row.average_monthly_spending_90d, 1) : null;
      row.safety_buffer_target = round(row.safety_buffer_target);
      row.buffer_progress_percent = row.safety_buffer_target > 0 ? Math.max(0, round((row.visible_liquid_funds / row.safety_buffer_target) * 100, 0)) : null;
      row.known_recurring_outflows_30d = round(row.known_recurring_outflows_30d);
      row.safe_after_buffer_and_known_bills = round(row.visible_liquid_funds - row.safety_buffer_target - row.known_recurring_outflows_30d);
      row.budget_limit = round(row.budget_limit);
      row.budget_spent = round(row.budget_spent);
      row.budget_remaining = round(row.budget_limit - row.budget_spent);
      row.budget_used_percent = row.budget_limit > 0 ? round((row.budget_spent / row.budget_limit) * 100, 1) : null;
      row.debt_payoff_months_if_current_surplus_used = row.borrowed_liability > 0 && row.monthly_net > 0 ? Math.ceil(row.borrowed_liability / row.monthly_net) : null;
      row.health = statusFor(row);
    });

    return res.json({
      privacy: 'Personal Financial Health uses only the signed-in user’s PERSONAL accounts and Personal Money records. Business and mixed accounts are excluded.',
      currency_rule: 'Every currency is shown separately. No exchange rate is assumed and different currencies are never added together.',
      balance_warning: 'Manual wallets are shown separately from bank balances. If a manual wallet mirrors a bank account, it may double-count the same money until you remove or adjust that manual balance.',
      methodology: {
        net_position: 'Personal bank balances + manual wallet balances + money lent to others − money borrowed. This is a visible-money estimate, not a complete net-worth statement; property, investments and other assets are not included unless separately modelled.',
        savings_rate: '(current-month imported bank income − current-month imported bank spending) ÷ current-month imported bank income. Confirmed internal transfers are excluded.',
        runway: 'Visible liquid funds ÷ average imported-bank spending over the last 90 days.',
        velocity: 'Current spending pace projected to month end from the number of days elapsed. It is a pace indicator, not a prediction.',
        debt_projection: 'Illustration only: outstanding borrowed balance ÷ current-month positive cash surplus. It does not assume interest, fees or a required repayment schedule.'
      },
      month_progress: monthDays,
      by_currency: byCurrency,
      tax_readiness: buildTaxReadiness(taxRows, fyYear)
    });
  } catch (error) {
    return respondError(res, error, 'Failed to load Personal Financial Health.');
  }
};
