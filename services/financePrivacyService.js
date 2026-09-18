'use strict';

const { FinanceError } = require('./financeDomain');
const { hasPermission } = require('./authorizationService');

const BUSINESS_SCOPE = 'BUSINESS';

function userId(reqOrUser) {
  const value = reqOrUser?.user?.id ?? reqOrUser?.id ?? reqOrUser;
  const id = Number(value || 0);
  if (!id) throw new FinanceError('Authenticated finance owner could not be resolved.', 401, 'FINANCE_OWNER_REQUIRED');
  return id;
}

function accountVisible(account, ownerId) {
  if (!account) return false;
  const scope = String(account.ownership_scope || 'UNCLASSIFIED').toUpperCase();
  return scope === BUSINESS_SCOPE || Number(account.created_by || 0) === Number(ownerId || 0);
}

function bankingScope(reqOrUser) {
  const scope = reqOrUser?.bankingAccessScope;
  return scope && typeof scope === 'object' ? scope : null;
}

function visibilitySql(alias = 'ba', reqOrUser = null) {
  const scope = bankingScope(reqOrUser);
  if (!scope || scope.is_admin || (!scope.has_explicit_grants && scope.can_view_all_business)) {
    return `(${alias}.ownership_scope = 'BUSINESS' OR ${alias}.created_by = ?)`;
  }
  const ids = Array.isArray(scope.allowed_business_account_ids)
    ? scope.allowed_business_account_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (!ids.length) return `(${alias}.created_by = ? AND ${alias}.ownership_scope <> 'BUSINESS')`;
  return `((${alias}.created_by = ? AND ${alias}.ownership_scope <> 'BUSINESS') OR (${alias}.ownership_scope = 'BUSINESS' AND ${alias}.id IN (${ids.map(()=>'?').join(',')})))`;
}

function visibilityParams(reqOrUser) {
  const scope = bankingScope(reqOrUser);
  if (!scope || scope.is_admin || (!scope.has_explicit_grants && scope.can_view_all_business)) {
    return [userId(reqOrUser)];
  }
  const ids = Array.isArray(scope.allowed_business_account_ids)
    ? scope.allowed_business_account_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  return [userId(reqOrUser), ...ids];
}

function requestAccountVisible(account, reqOrUser) {
  if (!account) return false;
  const scope = bankingScope(reqOrUser);
  if (!scope) return accountVisible(account, userId(reqOrUser));
  const ownership = String(account.ownership_scope || 'UNCLASSIFIED').toUpperCase();
  if (ownership !== BUSINESS_SCOPE) return Number(account.created_by || 0) === userId(reqOrUser);
  if (scope.is_admin || (!scope.has_explicit_grants && scope.can_view_all_business)) return true;
  return Array.isArray(scope.allowed_business_account_ids)
    && scope.allowed_business_account_ids.map(Number).includes(Number(account.id));
}

async function assertAccountAccess(db, accountId, reqOrUser, options = {}) {
  const id = Number(accountId || 0);
  if (!id) throw new FinanceError('Financial account is required.', 400, 'BANK_ACCOUNT_REQUIRED');
  const suffix = options.forUpdate ? ' FOR UPDATE' : '';
  const [[account]] = await db.query(`SELECT * FROM bank_accounts WHERE id = ?${suffix}`, [id]);
  if (!account || !requestAccountVisible(account, reqOrUser)) {
    // Return 404 rather than 403 so private account existence is not disclosed.
    throw new FinanceError('Financial account not found.', 404, 'BANK_ACCOUNT_NOT_FOUND');
  }
  return account;
}

async function assertBankTransactionAccess(db, transactionId, reqOrUser, options = {}) {
  const id = Number(transactionId || 0);
  if (!id) throw new FinanceError('Bank transaction is required.', 400, 'BANK_TRANSACTION_REQUIRED');
  const suffix = options.forUpdate ? ' FOR UPDATE' : '';
  const [[row]] = await db.query(
    `SELECT bt.*, ba.id AS bank_account_id, ba.ownership_scope AS account_scope, ba.created_by AS account_created_by
       FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE bt.id = ?${suffix}`,
    [id]
  );
  if (!row || !requestAccountVisible({ id: row.bank_account_id, ownership_scope: row.account_scope, created_by: row.account_created_by }, reqOrUser)) {
    throw new FinanceError('Bank transaction not found.', 404, 'BANK_TRANSACTION_NOT_FOUND');
  }
  return row;
}

async function assertInsightAccess(db, insightId, reqOrUser, options = {}) {
  const id = Number(insightId || 0);
  if (!id) throw new FinanceError('Finance insight is required.', 400, 'FINANCE_INSIGHT_REQUIRED');
  const suffix = options.forUpdate ? ' FOR UPDATE' : '';
  const [[row]] = await db.query(
    `SELECT fi.id, fi.bank_transaction_id, ba.id AS bank_account_id, ba.ownership_scope AS account_scope, ba.created_by AS account_created_by
       FROM finance_transaction_insights fi
       JOIN bank_transactions bt ON bt.id = fi.bank_transaction_id
       JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE fi.id = ?${suffix}`,
    [id]
  );
  if (!row || !requestAccountVisible({ id: row.bank_account_id, ownership_scope: row.account_scope, created_by: row.account_created_by }, reqOrUser)) {
    throw new FinanceError('Finance insight not found.', 404, 'FINANCE_INSIGHT_NOT_FOUND');
  }
  return row;
}

async function accountIdForStatementSession(db, uid) {
  const [[session]] = await db.query('SELECT bank_account_id FROM statement_import_sessions WHERE import_uid = ?', [String(uid || '')]);
  return session?.bank_account_id || null;
}

module.exports = {
  BUSINESS_SCOPE,
  accountVisible,
  requestAccountVisible,
  visibilitySql,
  visibilityParams,
  userId,
  assertAccountAccess,
  assertBankTransactionAccess,
  assertInsightAccess,
  accountIdForStatementSession
};
