'use strict';
const { dateOnly } = require('./financeDomain');
function addDay(value, days) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
// Statement intervals are evidence of coverage, unlike transaction min/max dates.
// Never claim completeness outside the supplied statement periods.
function statementCoverage(statements) {
  const intervals = (statements || []).map(row => ({
    from: dateOnly(row.statement_start_date), to: dateOnly(row.statement_end_date)
  })).filter(row => row.from && row.to && row.from <= row.to).sort((a,b) => a.from.localeCompare(b.from));
  const gaps = [];
  let end = null;
  for (const interval of intervals) {
    if (end && interval.from > addDay(end,1)) gaps.push({from:addDay(end,1),to:addDay(interval.from,-1)});
    if (!end || interval.to > end) end = interval.to;
  }
  return {
    statement_intervals: intervals, statement_gaps: gaps,
    coverage_label: !intervals.length ? 'No verified statement periods · continuity unverified'
      : gaps.length ? `${gaps.length} gap${gaps.length === 1 ? '' : 's'} between imported statements`
      : 'Supplied statement periods overlap or adjoin · other dates unverified'
  };
}
function balanceMetadata(account) {
  const connected = !/MANUAL/i.test(String(account.connection_type || '') + ' ' + String(account.connection_status || ''))
    && /^(CONNECTED|ACTIVE)$/i.test(String(account.connection_status || ''))
    && account.last_synced_at && account.available_balance != null;
  return {
    balance_basis: connected ? 'LIVE_AVAILABLE' : 'CALCULATED_LEDGER',
    profile_balance: connected ? account.available_balance : account.current_ledger_balance ?? account.opening_balance ?? '0.00',
    balance_updated_at: connected ? account.last_synced_at : account.updated_at || account.created_at
  };
}
module.exports = { statementCoverage, balanceMetadata };
