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

function localDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error('Local date must use YYYY-MM-DD.'), { statusCode: 400 });
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) throw Object.assign(new Error('Local date is invalid.'), { statusCode: 400 });
  return text;
}

function round(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }

exports.getDailyBriefing = async (req, res) => {
  try {
    const userId = uid(req);
    const date = localDate(req.query.date);
    const [summaryRows, transactionRows] = await Promise.all([
      pool.query(
        `SELECT bt.currency,
          COALESCE(SUM(CASE WHEN bt.transaction_date=? THEN bt.debit ELSE 0 END),0) today_spending,
          COALESCE(SUM(CASE WHEN bt.transaction_date=? THEN bt.credit ELSE 0 END),0) today_income,
          SUM(CASE WHEN bt.transaction_date=? THEN 1 ELSE 0 END) today_count,
          COALESCE(SUM(CASE WHEN bt.transaction_date=DATE_SUB(?,INTERVAL 1 DAY) THEN bt.debit ELSE 0 END),0) yesterday_spending,
          COALESCE(SUM(CASE WHEN bt.transaction_date=DATE_SUB(?,INTERVAL 1 DAY) THEN bt.credit ELSE 0 END),0) yesterday_income,
          SUM(CASE WHEN bt.transaction_date=DATE_SUB(?,INTERVAL 1 DAY) THEN 1 ELSE 0 END) yesterday_count
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
           AND bt.is_internal_transfer=0
           AND bt.transaction_date IN (?,DATE_SUB(?,INTERVAL 1 DAY))
         GROUP BY bt.currency`,
        [date,date,date,date,date,date,userId,date,date]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.credit,bt.currency,
                ba.nickname account_name,ba.institution
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
         WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
           AND bt.is_internal_transfer=0 AND bt.transaction_date IN (?,DATE_SUB(?,INTERVAL 1 DAY))
         ORDER BY bt.transaction_date DESC,GREATEST(COALESCE(bt.debit,0),COALESCE(bt.credit,0)) DESC,bt.id DESC
         LIMIT 20`, [userId,date,date]
      ).then(([rows]) => rows)
    ]);

    const byCurrency = {};
    summaryRows.forEach((row) => {
      const code = String(row.currency || 'AUD').toUpperCase();
      const todaySpending = round(row.today_spending);
      const yesterdaySpending = round(row.yesterday_spending);
      const todayIncome = round(row.today_income);
      const yesterdayIncome = round(row.yesterday_income);
      byCurrency[code] = {
        currency: code,
        today_spending: todaySpending,
        today_income: todayIncome,
        today_count: Number(row.today_count || 0),
        yesterday_spending: yesterdaySpending,
        yesterday_income: yesterdayIncome,
        yesterday_count: Number(row.yesterday_count || 0),
        spending_change_amount: round(todaySpending - yesterdaySpending),
        income_change_amount: round(todayIncome - yesterdayIncome),
        spending_change_percent: yesterdaySpending > 0 ? Math.round(((todaySpending - yesterdaySpending) / yesterdaySpending) * 1000) / 10 : null
      };
    });

    const transactions = transactionRows.map((row) => ({
      id: row.id,
      date: String(row.transaction_date).slice(0, 10),
      description: String(row.merchant_name || row.description || 'Transaction').slice(0, 180),
      amount: round(Number(row.debit || 0) > 0 ? row.debit : row.credit),
      direction: Number(row.debit || 0) > 0 ? 'OUT' : 'IN',
      currency: String(row.currency || 'AUD').toUpperCase(),
      account_name: row.account_name || row.institution || 'Personal account'
    }));

    return res.json({
      date,
      comparison_date_note: 'Today is a partial-day view. Yesterday is a completed calendar day, so compare directionally rather than treating the periods as equal.',
      privacy: 'Only the signed-in user’s PERSONAL accounts are included. Business/mixed accounts and confirmed internal transfers are excluded.',
      currency_rule: 'Currencies remain separate. No exchange rate or combined total is calculated.',
      by_currency: byCurrency,
      transactions
    });
  } catch (error) {
    return respondError(res, error, 'Failed to load Daily Money Briefing.');
  }
};
