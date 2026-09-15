'use strict';

const pool = require('../config/db');
const { FinanceError } = require('../services/financeDomain');
const privacy = require('../services/financePrivacyService');

function fail(res, error) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
  console.error('Finance privacy guard failed:', error);
  return res.status(500).json({ message: 'Finance privacy check failed.', code: 'FINANCE_PRIVACY_ERROR' });
}

function accountParam(name = 'id') {
  return async (req, res, next) => {
    try { await privacy.assertAccountAccess(pool, req.params[name], req); return next(); }
    catch (error) { return fail(res, error); }
  };
}

function accountBody(name = 'id') {
  return async (req, res, next) => {
    try {
      const id = Number(req.body?.[name] || 0);
      if (id) await privacy.assertAccountAccess(pool, id, req);
      return next();
    } catch (error) { return fail(res, error); }
  };
}

function bankTransactionParam(name = 'id') {
  return async (req, res, next) => {
    try { await privacy.assertBankTransactionAccess(pool, req.params[name], req); return next(); }
    catch (error) { return fail(res, error); }
  };
}

function insightParam(name = 'id') {
  return async (req, res, next) => {
    try { await privacy.assertInsightAccess(pool, req.params[name], req); return next(); }
    catch (error) { return fail(res, error); }
  };
}

function statementUid(name = 'uid') {
  return async (req, res, next) => {
    try {
      const accountId = await privacy.accountIdForStatementSession(pool, req.params[name]);
      if (!accountId) throw new FinanceError('Statement review session not found.', 404, 'STATEMENT_REVIEW_NOT_FOUND');
      await privacy.assertAccountAccess(pool, accountId, req);
      return next();
    } catch (error) { return fail(res, error); }
  };
}

function filterAccountList(req, res, next) {
  const original = res.json.bind(res);
  res.json = (payload) => {
    if (payload && Array.isArray(payload.bank_accounts)) {
      const owner = privacy.userId(req);
      payload = { ...payload, bank_accounts: payload.bank_accounts.filter((row) => privacy.accountVisible(row, owner)) };
    }
    return original(payload);
  };
  next();
}

async function filterStatementList(req, res, next) {
  try {
    const [rows] = await pool.query(`SELECT id FROM bank_accounts ba WHERE ${privacy.visibilitySql('ba')}`, privacy.visibilityParams(req));
    const allowed = new Set(rows.map((row) => Number(row.id)));
    const original = res.json.bind(res);
    res.json = (payload) => {
      if (payload && Array.isArray(payload.sessions)) {
        payload = { ...payload, sessions: payload.sessions.filter((session) => allowed.has(Number(session.bank_account_id))) };
      }
      return original(payload);
    };
    return next();
  } catch (error) { return fail(res, error); }
}

module.exports = { accountParam, accountBody, bankTransactionParam, insightParam, statementUid, filterAccountList, filterStatementList };