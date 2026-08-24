const money = require('../utils/money');

const TRANSACTION_STATUSES = new Set(['DRAFT', 'INCOMPLETE', 'READY', 'POSTED', 'RECONCILED', 'LOCKED', 'VOID']);
const FINANCIAL_YEAR_STATUSES = new Set(['OPEN', 'REVIEWING', 'READY_TO_CLOSE', 'LOCKED', 'ARCHIVED']);
const TRANSACTION_TYPES = new Set([
  'SALE', 'CUSTOMER_PAYMENT', 'EXPENSE', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT',
  'PAYROLL', 'REFUND', 'TRANSFER', 'ASSET_PURCHASE', 'OWNER_CONTRIBUTION',
  'OWNER_DRAWING', 'JOURNAL_ADJUSTMENT', 'OTHER'
]);
const TAX_CODES = new Set(['GST_ON_INCOME', 'GST_ON_EXPENSES', 'GST_FREE', 'INPUT_TAXED', 'NO_GST', 'OUT_OF_SCOPE']);

class FinanceError extends Error {
  constructor(message, statusCode = 400, code = 'FINANCE_VALIDATION_ERROR', issues = []) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

function dateOnly(value) {
  let raw = '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    raw = value.toISOString().slice(0, 10);
  } else {
    const text = String(value || '').trim();
    const mysqlDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
    raw = mysqlDate ? mysqlDate[1] : '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return '';
  return raw;
}

function financialYearForDate(value, startMonth = 7, startDay = 1) {
  const raw = dateOnly(value);
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const startYear = month > startMonth || (month === startMonth && day >= startDay) ? year : year - 1;
  const nextStart = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay));
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return {
    label: `FY${startYear}-${String(startYear + 1).slice(-2)}`,
    start: `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`,
    end: nextStart.toISOString().slice(0, 10),
    startYear
  };
}

function basQuarterForDate(value, startMonth = 7) {
  const raw = dateOnly(value);
  if (!raw) return null;
  const month = Number(raw.slice(5, 7));
  const offset = (month - startMonth + 12) % 12;
  return `Q${Math.floor(offset / 3) + 1}`;
}

function issue(severity, code, message, field = null) {
  return { severity, code, message, field };
}

function validateTransaction(input, options = {}) {
  const issues = [];
  const status = String(input.status || 'DRAFT').toUpperCase();
  const type = String(input.type || '').toUpperCase();
  const effectiveDate = dateOnly(input.effective_date);
  const taxCode = String(input.tax_code || '').toUpperCase();

  if (!TRANSACTION_TYPES.has(type)) issues.push(issue('BLOCKING_ERROR', 'TYPE_REQUIRED', 'Select a valid transaction type.', 'type'));
  if (!effectiveDate) issues.push(issue('BLOCKING_ERROR', 'DATE_REQUIRED', 'A valid effective date is required.', 'effective_date'));
  if (!String(input.description || '').trim()) issues.push(issue('BLOCKING_ERROR', 'DESCRIPTION_REQUIRED', 'Description is required.', 'description'));
  if (!input.debit_account_id) issues.push(issue('BLOCKING_ERROR', 'DEBIT_ACCOUNT_REQUIRED', 'Debit account is required.', 'debit_account_id'));
  if (!input.credit_account_id) issues.push(issue('BLOCKING_ERROR', 'CREDIT_ACCOUNT_REQUIRED', 'Credit account is required.', 'credit_account_id'));
  if (input.debit_account_id && String(input.debit_account_id) === String(input.credit_account_id)) {
    issues.push(issue('BLOCKING_ERROR', 'ACCOUNTS_MUST_DIFFER', 'Debit and credit accounts must be different.', 'credit_account_id'));
  }

  let net = '0.00';
  let gst = '0.00';
  let gross = '0.00';
  try {
    net = money.fromCents(money.toCents(input.net_amount));
    gst = money.fromCents(money.toCents(input.gst_amount));
    gross = money.fromCents(money.toCents(input.gross_amount));
    if (money.toCents(gross) <= 0n) issues.push(issue('BLOCKING_ERROR', 'AMOUNT_REQUIRED', 'Gross amount must be greater than zero.', 'gross_amount'));
    if (!money.equals(money.add(net, gst), gross, 1n)) {
      issues.push(issue('BLOCKING_ERROR', 'TOTAL_MISMATCH', 'Gross amount must equal net amount plus GST.', 'gross_amount'));
    }
  } catch {
    issues.push(issue('BLOCKING_ERROR', 'INVALID_AMOUNT', 'Enter valid monetary amounts.', 'gross_amount'));
  }

  if (!TAX_CODES.has(taxCode)) {
    issues.push(issue('BLOCKING_ERROR', 'TAX_CODE_REQUIRED', 'GST treatment is required.', 'tax_code'));
  } else if (['GST_FREE', 'INPUT_TAXED', 'NO_GST', 'OUT_OF_SCOPE'].includes(taxCode) && money.toCents(gst) !== 0n) {
    issues.push(issue('BLOCKING_ERROR', 'GST_NOT_ALLOWED', 'GST cannot be entered for this tax treatment.', 'gst_amount'));
  } else if (['GST_ON_INCOME', 'GST_ON_EXPENSES'].includes(taxCode) && !input.tax_override) {
    const expected = options.amountsIncludeGst
      ? money.gstFromGross(gross, options.gstRate || '10')
      : money.percentageOf(net, options.gstRate || '10');
    if (!money.equals(expected, gst, 1n)) {
      issues.push(issue('BLOCKING_ERROR', 'GST_MISMATCH', `GST calculation appears incorrect. Expected $${expected}.`, 'gst_amount'));
    }
  }

  if (input.tax_override && !String(input.tax_override_reason || '').trim()) {
    issues.push(issue('BLOCKING_ERROR', 'GST_OVERRIDE_REASON', 'A reason is required for a GST override.', 'tax_override_reason'));
  }
  if (['EXPENSE', 'SUPPLIER_BILL', 'ASSET_PURCHASE'].includes(type) && !input.supplier_id && !String(input.party_name || '').trim()) {
    issues.push(issue('BLOCKING_ERROR', 'SUPPLIER_REQUIRED', 'Supplier is required for this transaction.', 'party_name'));
  }
  if (['SALE', 'CUSTOMER_PAYMENT'].includes(type) && !input.customer_id && !String(input.party_name || '').trim()) {
    issues.push(issue('BLOCKING_ERROR', 'CUSTOMER_REQUIRED', 'Customer is required for this transaction.', 'party_name'));
  }
  if (['EXPENSE', 'SUPPLIER_BILL', 'ASSET_PURCHASE'].includes(type) && !input.document_count) {
    issues.push(issue('WARNING', 'RECEIPT_MISSING', 'Receipt or supplier document has not been attached.', 'document'));
  }
  if (!TRANSACTION_STATUSES.has(status)) issues.push(issue('BLOCKING_ERROR', 'INVALID_STATUS', 'Transaction status is invalid.', 'status'));

  return { issues, net, gst, gross, status, type, effectiveDate, taxCode };
}

function validateJournal(lines = []) {
  const issues = [];
  if (!Array.isArray(lines) || lines.length < 2) {
    issues.push(issue('BLOCKING_ERROR', 'JOURNAL_LINES_REQUIRED', 'At least two journal lines are required.', 'lines'));
    return { issues, totalDebit: '0.00', totalCredit: '0.00', difference: '0.00' };
  }

  let debits = 0n;
  let credits = 0n;
  lines.forEach((line, index) => {
    if (!line.account_id) issues.push(issue('BLOCKING_ERROR', 'ACCOUNT_REQUIRED', `Account is required on line ${index + 1}.`, `lines.${index}.account_id`));
    const debit = money.toCents(line.debit || 0);
    const credit = money.toCents(line.credit || 0);
    if (debit < 0n || credit < 0n || (debit === 0n && credit === 0n) || (debit > 0n && credit > 0n)) {
      issues.push(issue('BLOCKING_ERROR', 'INVALID_JOURNAL_LINE', `Line ${index + 1} must contain either a positive debit or a positive credit.`, `lines.${index}`));
    }
    debits += debit;
    credits += credit;
  });
  const difference = debits - credits;
  if (difference !== 0n) {
    issues.push(issue('BLOCKING_ERROR', 'UNBALANCED_JOURNAL', `Debits and credits do not balance. Difference: $${money.fromCents(difference < 0n ? -difference : difference)}.`, 'lines'));
  }
  return {
    issues,
    totalDebit: money.fromCents(debits),
    totalCredit: money.fromCents(credits),
    difference: money.fromCents(difference)
  };
}

function blockingIssues(issues = []) {
  return issues.filter((entry) => entry.severity === 'BLOCKING_ERROR');
}

module.exports = {
  FinanceError,
  TRANSACTION_STATUSES,
  FINANCIAL_YEAR_STATUSES,
  TRANSACTION_TYPES,
  TAX_CODES,
  dateOnly,
  financialYearForDate,
  basQuarterForDate,
  validateTransaction,
  validateJournal,
  blockingIssues
};
