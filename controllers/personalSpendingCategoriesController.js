const pool = require('../config/db');
const { FinanceError } = require('../services/financeDomain');

function fail(res, error, message) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
  console.error(`${message}:`, error);
  return res.status(500).json({ message, code: 'PERSONAL_SPENDING_CATEGORIES_ERROR' });
}

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousMonthKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return monthKey(d);
}

function startDateForMonths(months) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

exports.getBreakdown = async (req, res) => {
  try {
    const userId = String(req.user?.id || '').trim();
    if (!userId) throw new FinanceError('Authentication is required.', 401, 'AUTH_REQUIRED');
    const months = Math.min(12, Math.max(2, Number.parseInt(req.query.months, 10) || 6));
    const startDate = startDateForMonths(months);
    const [rows] = await pool.query(
      `SELECT bt.id,
              DATE_FORMAT(bt.transaction_date, '%Y-%m-%d') AS transaction_date,
              DATE_FORMAT(bt.transaction_date, '%Y-%m') AS month_key,
              bt.description, bt.merchant_name, bt.reference, bt.debit,
              bt.category AS confirmed_category,
              ba.id AS bank_account_id, ba.nickname AS account_name, ba.currency,
              fi.id AS insight_id, fi.suggested_category,
              fi.category_confidence, fi.explanation,
              CASE
                WHEN NULLIF(TRIM(bt.category), '') IS NOT NULL THEN bt.category
                WHEN NULLIF(TRIM(fi.suggested_category), '') IS NOT NULL THEN fi.suggested_category
                ELSE 'Uncategorised'
              END AS display_category,
              CASE
                WHEN NULLIF(TRIM(bt.category), '') IS NOT NULL THEN 'CONFIRMED'
                WHEN NULLIF(TRIM(fi.suggested_category), '') IS NOT NULL THEN 'SUGGESTED'
                ELSE 'UNCATEGORISED'
              END AS category_source
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id = bt.bank_account_id
         LEFT JOIN finance_transaction_insights fi
           ON fi.id = (
             SELECT fi2.id
               FROM finance_transaction_insights fi2
              WHERE fi2.bank_transaction_id = bt.id
                AND fi2.status <> 'DISMISSED'
              ORDER BY fi2.generated_at DESC, fi2.id DESC
              LIMIT 1
           )
        WHERE ba.created_by = ?
          AND ba.ownership_scope = 'PERSONAL'
          AND bt.ownership_scope = 'PERSONAL'
          AND bt.is_internal_transfer = 0
          AND bt.debit > 0
          AND bt.transaction_date >= ?
        ORDER BY bt.transaction_date DESC, bt.id DESC`,
      [userId, startDate]
    );

    const currentMonth = monthKey();
    const previousMonth = previousMonthKey();
    const byCurrency = {};
    for (const row of rows) {
      const currency = String(row.currency || 'AUD').toUpperCase();
      if (!byCurrency[currency]) byCurrency[currency] = {
        currency,
        total_spending: 0,
        current_month_spending: 0,
        previous_month_spending: 0,
        categories: {},
        months: {},
        merchants: {},
        confirmed_count: 0,
        suggested_count: 0,
        uncategorised_count: 0
      };
      const bucket = byCurrency[currency];
      const amount = Number(row.debit || 0);
      const category = String(row.display_category || 'Uncategorised');
      const merchant = String(row.merchant_name || row.description || 'Unknown merchant').trim().slice(0, 120) || 'Unknown merchant';
      bucket.total_spending += amount;
      if (row.month_key === currentMonth) bucket.current_month_spending += amount;
      if (row.month_key === previousMonth) bucket.previous_month_spending += amount;
      bucket.categories[category] = (bucket.categories[category] || 0) + amount;
      bucket.months[row.month_key] = bucket.months[row.month_key] || {};
      bucket.months[row.month_key][category] = (bucket.months[row.month_key][category] || 0) + amount;
      bucket.merchants[merchant] = (bucket.merchants[merchant] || 0) + amount;
      if (row.category_source === 'CONFIRMED') bucket.confirmed_count += 1;
      else if (row.category_source === 'SUGGESTED') bucket.suggested_count += 1;
      else bucket.uncategorised_count += 1;
    }

    const currencySummaries = Object.values(byCurrency).map((bucket) => {
      const categories = Object.entries(bucket.categories)
        .map(([category, amount]) => ({ category, amount: roundMoney(amount), share_percent: bucket.total_spending > 0 ? Math.round((amount / bucket.total_spending) * 1000) / 10 : 0 }))
        .sort((a, b) => b.amount - a.amount);
      const topMerchants = Object.entries(bucket.merchants)
        .map(([merchant, amount]) => ({ merchant, amount: roundMoney(amount) }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);
      const monthly = Object.entries(bucket.months)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, categoryMap]) => ({
          month,
          total: roundMoney(Object.values(categoryMap).reduce((sum, value) => sum + Number(value || 0), 0)),
          categories: Object.entries(categoryMap).map(([category, amount]) => ({ category, amount: roundMoney(amount) })).sort((a, b) => b.amount - a.amount)
        }));
      const previous = Number(bucket.previous_month_spending || 0);
      const current = Number(bucket.current_month_spending || 0);
      return {
        currency: bucket.currency,
        total_spending: roundMoney(bucket.total_spending),
        current_month_spending: roundMoney(current),
        previous_month_spending: roundMoney(previous),
        month_change_percent: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
        confirmed_count: bucket.confirmed_count,
        suggested_count: bucket.suggested_count,
        uncategorised_count: bucket.uncategorised_count,
        categories,
        top_merchants: topMerchants,
        monthly
      };
    }).sort((a, b) => a.currency.localeCompare(b.currency));

    const review = rows
      .filter((row) => row.category_source !== 'CONFIRMED')
      .slice(0, 80)
      .map((row) => ({
        transaction_id: row.id,
        insight_id: row.insight_id || null,
        date: row.transaction_date,
        merchant: row.merchant_name || row.description || 'Transaction',
        description: row.description || '',
        amount: roundMoney(row.debit),
        currency: String(row.currency || 'AUD').toUpperCase(),
        account_name: row.account_name,
        suggested_category: row.suggested_category || null,
        confidence: row.category_confidence === null ? null : Number(row.category_confidence),
        source: row.category_source,
        explanation: row.explanation || null
      }));

    return res.json({
      months,
      start_date: startDate,
      current_month: currentMonth,
      previous_month: previousMonth,
      by_currency: currencySummaries,
      review,
      note: 'Suggested categories are used for this spending view only. Imported transactions are not changed until you explicitly review and apply a suggestion.'
    });
  } catch (error) {
    return fail(res, error, 'Failed to load personal spending categories');
  }
};
