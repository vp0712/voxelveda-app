const crypto = require('node:crypto');
const pool = require('../config/db');

function uid(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}

function money(value, field = 'amount') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999999999999) {
    throw Object.assign(new Error(`${field} must be a positive amount.`), { statusCode: 400 });
  }
  return Math.round(parsed * 10000) / 10000;
}

function signedMoney(value, field = 'amount') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 999999999999) {
    throw Object.assign(new Error(`${field} is invalid.`), { statusCode: 400 });
  }
  return Math.round(parsed * 10000) / 10000;
}

function currency(value, fallback = 'AUD') {
  const result = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw Object.assign(new Error('Currency must be a three-letter code such as AUD, USD or INR.'), { statusCode: 400 });
  return result;
}

function clean(value, max = 200) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function dateTime(value) {
  const input = value ? new Date(value) : new Date();
  if (Number.isNaN(input.getTime())) throw Object.assign(new Error('Date/time is invalid.'), { statusCode: 400 });
  return input.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnly(value, required = false) {
  if (!value && !required) return null;
  const input = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw Object.assign(new Error('Date must use YYYY-MM-DD.'), { statusCode: 400 });
  return input;
}

function monthStart(value) {
  const date = dateOnly(value, true);
  return `${date.slice(0, 7)}-01`;
}

function respondError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
}

async function ownedWallet(connection, userId, walletId, forUpdate = false) {
  const [[wallet]] = await connection.query(
    `SELECT id, user_id, name, currency, balance, active FROM personal_money_wallets
     WHERE id = ? AND user_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [walletId, userId]
  );
  if (!wallet) throw Object.assign(new Error('Wallet not found.'), { statusCode: 404 });
  return wallet;
}

function entryDirection(type) {
  if (['INCOME', 'CASH_IN', 'DEBT_RECEIVED', 'REPAYMENT_RECEIVED'].includes(type)) return 1;
  if (['EXPENSE', 'CASH_OUT', 'DEBT_GIVEN', 'REPAYMENT_PAID'].includes(type)) return -1;
  return 0;
}

exports.getDashboard = async (req, res) => {
  try {
    const userId = uid(req);
    const [wallets] = await pool.query(
      `SELECT id, name, currency, balance, active, created_at, updated_at
       FROM personal_money_wallets WHERE user_id = ? AND active = 1 ORDER BY created_at`, [userId]
    );
    const [debts] = await pool.query(
      `SELECT id, direction, counterparty, principal_amount, outstanding_amount, currency, due_date, status, note, created_at
       FROM personal_money_debts WHERE user_id = ? ORDER BY FIELD(status,'OPEN','PARTIAL','SETTLED'), due_date IS NULL, due_date, created_at DESC LIMIT 100`, [userId]
    );
    const [entries] = await pool.query(
      `SELECT e.id, e.wallet_id, w.name wallet_name, e.entry_type, e.amount, e.currency, e.fx_rate_to_wallet,
              e.wallet_amount, e.category, e.counterparty, e.note, e.occurred_at
       FROM personal_money_entries e JOIN personal_money_wallets w ON w.id=e.wallet_id AND w.user_id=e.user_id
       WHERE e.user_id = ? ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 100`, [userId]
    );
    const [budgets] = await pool.query(
      `SELECT id, month_start, category, currency, limit_amount FROM personal_money_budgets
       WHERE user_id = ? AND month_start >= DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH),'%Y-%m-01')
       ORDER BY month_start DESC, category`, [userId]
    );
    const [[flow]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND entry_type IN ('INCOME','CASH_IN','DEBT_RECEIVED','REPAYMENT_RECEIVED') THEN wallet_amount ELSE 0 END),0) AS money_in_30d,
         COALESCE(SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND entry_type IN ('EXPENSE','CASH_OUT','DEBT_GIVEN','REPAYMENT_PAID') THEN wallet_amount ELSE 0 END),0) AS money_out_30d,
         COALESCE(SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND entry_type IN ('INCOME','CASH_IN') THEN wallet_amount ELSE 0 END),0) AS income_90d,
         COALESCE(SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND entry_type IN ('EXPENSE','CASH_OUT') THEN wallet_amount ELSE 0 END),0) AS spend_90d
       FROM personal_money_entries WHERE user_id = ?`, [userId]
    );
    const [[debtTotals]] = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN direction='BORROWED' AND status <> 'SETTLED' THEN outstanding_amount ELSE 0 END),0) borrowed_open,
        COALESCE(SUM(CASE WHEN direction='LENT' AND status <> 'SETTLED' THEN outstanding_amount ELSE 0 END),0) lent_open,
        COUNT(CASE WHEN status <> 'SETTLED' AND due_date IS NOT NULL AND due_date < CURRENT_DATE THEN 1 END) overdue_count
       FROM personal_money_debts WHERE user_id = ?`, [userId]
    );

    const walletTotals = wallets.reduce((map, row) => {
      map[row.currency] = (map[row.currency] || 0) + Number(row.balance || 0);
      return map;
    }, {});
    const avgDailyNet = (Number(flow.income_90d || 0) - Number(flow.spend_90d || 0)) / 90;
    const dueSoon = debts.filter((row) => row.status !== 'SETTLED' && row.due_date && new Date(row.due_date) <= new Date(Date.now() + 30 * 86400000));

    return res.json({
      privacy: 'Owner-only personal ledger. No company finance user can read another user’s Personal Money Center records.',
      wallets,
      wallet_totals: walletTotals,
      debts,
      entries,
      budgets,
      summary: {
        money_in_30d: Number(flow.money_in_30d || 0),
        money_out_30d: Number(flow.money_out_30d || 0),
        borrowed_open: Number(debtTotals.borrowed_open || 0),
        lent_open: Number(debtTotals.lent_open || 0),
        overdue_debts: Number(debtTotals.overdue_count || 0)
      },
      forecast: {
        method: 'Uses the last 90 days of personal cash income/spending plus debts due in the next 30 days. It is an estimate, not an accounting or investment prediction.',
        average_daily_net: Math.round(avgDailyNet * 100) / 100,
        projected_30_day_operating_change: Math.round(avgDailyNet * 30 * 100) / 100,
        due_within_30_days: dueSoon.map((row) => ({ id: row.id, direction: row.direction, counterparty: row.counterparty, outstanding_amount: Number(row.outstanding_amount), currency: row.currency, due_date: row.due_date }))
      }
    });
  } catch (error) {
    return respondError(res, error, 'Failed to load Personal Money Center.');
  }
};

exports.createWallet = async (req, res) => {
  try {
    const userId = uid(req);
    const name = clean(req.body.name, 120);
    if (!name) throw Object.assign(new Error('Wallet name is required.'), { statusCode: 400 });
    const walletCurrency = currency(req.body.currency);
    const opening = req.body.opening_balance === undefined || req.body.opening_balance === '' ? 0 : signedMoney(req.body.opening_balance, 'Opening balance');
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO personal_money_wallets (id,user_id,name,currency,balance) VALUES (?,?,?,?,?)`,
      [id, userId, name, walletCurrency, opening]
    );
    return res.status(201).json({ message: 'Wallet created.', id });
  } catch (error) {
    return respondError(res, error, 'Failed to create wallet.');
  }
};

exports.createEntry = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const userId = uid(req);
    const type = String(req.body.entry_type || '').trim().toUpperCase();
    const allowed = new Set(['INCOME','EXPENSE','CASH_IN','CASH_OUT','DEBT_RECEIVED','DEBT_GIVEN','REPAYMENT_RECEIVED','REPAYMENT_PAID','ADJUSTMENT']);
    if (!allowed.has(type)) throw Object.assign(new Error('Choose a valid money movement type.'), { statusCode: 400 });
    const amount = type === 'ADJUSTMENT' ? signedMoney(req.body.amount) : money(req.body.amount);
    const entryCurrency = currency(req.body.currency);
    const rate = req.body.fx_rate_to_wallet === undefined || req.body.fx_rate_to_wallet === '' ? 1 : money(req.body.fx_rate_to_wallet, 'FX rate');
    const walletAmount = Math.round(amount * rate * 10000) / 10000;
    const id = crypto.randomUUID();

    await connection.beginTransaction();
    const wallet = await ownedWallet(connection, userId, req.body.wallet_id, true);
    const direction = type === 'ADJUSTMENT' ? 1 : entryDirection(type);
    const delta = type === 'ADJUSTMENT' ? walletAmount : direction * walletAmount;
    await connection.query(
      `INSERT INTO personal_money_entries
       (id,user_id,wallet_id,entry_type,amount,currency,fx_rate_to_wallet,wallet_amount,category,counterparty,note,occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,userId,wallet.id,type,amount,entryCurrency,rate,walletAmount,clean(req.body.category,100),clean(req.body.counterparty,160),clean(req.body.note,500),dateTime(req.body.occurred_at)]
    );
    await connection.query(`UPDATE personal_money_wallets SET balance = balance + ? WHERE id = ? AND user_id = ?`, [delta, wallet.id, userId]);
    await connection.commit();
    return res.status(201).json({ message: 'Money movement recorded.', id, wallet_delta: delta, wallet_currency: wallet.currency });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return respondError(res, error, 'Failed to record money movement.');
  } finally {
    connection.release();
  }
};

exports.createDebt = async (req, res) => {
  try {
    const userId = uid(req);
    const direction = String(req.body.direction || '').trim().toUpperCase();
    if (!['BORROWED','LENT'].includes(direction)) throw Object.assign(new Error('Choose Borrowed or Lent.'), { statusCode: 400 });
    const counterparty = clean(req.body.counterparty, 160);
    if (!counterparty) throw Object.assign(new Error('Person or organisation name is required.'), { statusCode: 400 });
    const principal = money(req.body.principal_amount, 'Principal amount');
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO personal_money_debts
       (id,user_id,direction,counterparty,principal_amount,outstanding_amount,currency,due_date,note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id,userId,direction,counterparty,principal,principal,currency(req.body.currency),dateOnly(req.body.due_date),clean(req.body.note,500)]
    );
    return res.status(201).json({ message: direction === 'BORROWED' ? 'Borrowed money recorded.' : 'Lent money recorded.', id });
  } catch (error) {
    return respondError(res, error, 'Failed to save borrowed/lent money.');
  }
};

exports.recordDebtPayment = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const userId = uid(req);
    const amount = money(req.body.amount);
    await connection.beginTransaction();
    const [[debt]] = await connection.query(
      `SELECT * FROM personal_money_debts WHERE id=? AND user_id=? LIMIT 1 FOR UPDATE`, [req.params.id, userId]
    );
    if (!debt) throw Object.assign(new Error('Borrowed/lent record not found.'), { statusCode: 404 });
    if (debt.status === 'SETTLED') throw Object.assign(new Error('This item is already settled.'), { statusCode: 409 });
    if (amount > Number(debt.outstanding_amount) + 0.0001) throw Object.assign(new Error('Payment cannot exceed the outstanding amount.'), { statusCode: 400 });

    let wallet = null;
    let walletDelta = 0;
    if (req.body.wallet_id) {
      wallet = await ownedWallet(connection, userId, req.body.wallet_id, true);
      if (wallet.currency !== debt.currency) throw Object.assign(new Error('For debt repayments, choose a wallet using the same currency as the debt.'), { statusCode: 400 });
      walletDelta = debt.direction === 'BORROWED' ? -amount : amount;
      await connection.query(`UPDATE personal_money_wallets SET balance=balance+? WHERE id=? AND user_id=?`, [walletDelta, wallet.id, userId]);
    }

    const paymentId = crypto.randomUUID();
    await connection.query(
      `INSERT INTO personal_money_debt_payments (id,user_id,debt_id,wallet_id,amount,currency,paid_at,note)
       VALUES (?,?,?,?,?,?,?,?)`,
      [paymentId,userId,debt.id,wallet?.id || null,amount,debt.currency,dateTime(req.body.paid_at),clean(req.body.note,500)]
    );
    const outstanding = Math.max(0, Math.round((Number(debt.outstanding_amount) - amount) * 10000) / 10000);
    const status = outstanding <= 0.0001 ? 'SETTLED' : 'PARTIAL';
    await connection.query(`UPDATE personal_money_debts SET outstanding_amount=?, status=? WHERE id=? AND user_id=?`, [outstanding,status,debt.id,userId]);
    await connection.commit();
    return res.json({ message: status === 'SETTLED' ? 'Debt settled.' : 'Repayment recorded.', outstanding_amount: outstanding, status, wallet_delta: walletDelta });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return respondError(res, error, 'Failed to record repayment.');
  } finally {
    connection.release();
  }
};

exports.saveBudget = async (req, res) => {
  try {
    const userId = uid(req);
    const category = clean(req.body.category, 100);
    if (!category) throw Object.assign(new Error('Budget category is required.'), { statusCode: 400 });
    const month = monthStart(req.body.month_start);
    const budgetCurrency = currency(req.body.currency);
    const limit = money(req.body.limit_amount, 'Budget limit');
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO personal_money_budgets (id,user_id,month_start,category,currency,limit_amount)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE limit_amount=VALUES(limit_amount), updated_at=CURRENT_TIMESTAMP`,
      [id,userId,month,category,budgetCurrency,limit]
    );
    return res.json({ message: 'Budget saved.' });
  } catch (error) {
    return respondError(res, error, 'Failed to save budget.');
  }
};
