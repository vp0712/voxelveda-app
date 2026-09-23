'use strict';

const privacy = require('./financePrivacyService');
const { FinanceError, dateOnly } = require('./financeDomain');

const SCOPES = new Set(['ALL', 'PERSONAL', 'BUSINESS', 'MIXED', 'UNCLASSIFIED']);

function parseDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = dateOnly(value);
  if (!parsed) throw new FinanceError(`${label} must be a valid date.`, 400, 'INVALID_REPORT_DATE');
  return parsed;
}

function parseAccountIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map(Number).filter(Number.isInteger).filter((id) => id > 0))].slice(0, 50);
}

function buildCoreBankTransactionFilter(req, input = {}, options = {}) {
  const scope = String(input.scope || 'ALL').trim().toUpperCase();
  if (!SCOPES.has(scope)) throw new FinanceError('Finance scope must be All, Personal, Business, Mixed or Unclassified.', 400, 'INVALID_REPORT_SCOPE');
  const from = parseDate(input.from, 'From date');
  const to = parseDate(input.to, 'To date');
  if (from && to && from > to) throw new FinanceError('From date cannot be after To date.', 400, 'INVALID_REPORT_RANGE');

  const accountIds = parseAccountIds(input.account_ids ?? input.account_id);
  const currency = String(input.currency || '').trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new FinanceError('Currency must be a 3-letter code.', 400, 'INVALID_REPORT_CURRENCY');

  const clauses = [privacy.visibilitySql('ba', req)];
  const params = [...privacy.visibilityParams(req)];
  if (!options.includeIgnored) clauses.push("bt.reconciliation_status<>'IGNORED'");
  if (scope !== 'ALL') { clauses.push('bt.ownership_scope=?'); params.push(scope); }
  if (accountIds.length) {
    clauses.push(`bt.bank_account_id IN (${accountIds.map(() => '?').join(',')})`);
    params.push(...accountIds);
  }
  if (from) { clauses.push('bt.transaction_date>=?'); params.push(from); }
  if (to) { clauses.push('bt.transaction_date<=?'); params.push(to); }
  if (currency) { clauses.push('bt.currency=?'); params.push(currency); }
  if (options.statementUid) { clauses.push('bt.statement_import_uid=?'); params.push(String(options.statementUid).slice(0, 80)); }

  return {
    scope,
    from,
    to,
    currency: currency || null,
    account_ids: accountIds,
    account_id: accountIds.length === 1 ? accountIds[0] : null,
    clauses,
    params,
    where: clauses.join(' AND ')
  };
}

module.exports = { buildCoreBankTransactionFilter, parseAccountIds, parseDate, SCOPES };
