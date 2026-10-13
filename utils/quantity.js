'use strict';

// Original material registers use DECIMAL(14,3). Integer thousandths keep
// competing receipts and withdrawals accurate without floating-point rounding.
function quantityUnits(value, { signed = false, allowZero = false } = {}) {
  const raw = String(value ?? '').trim();
  const pattern = signed ? /^-?\d+(?:\.\d{1,3})?$/ : /^\d+(?:\.\d{1,3})?$/;
  if (!pattern.test(raw)) return null;
  const units = Math.round(Number(raw) * 1000);
  if (!Number.isSafeInteger(units) || Math.abs(units) >= 100000000000000 || (!allowZero && units === 0)) return null;
  return units;
}

module.exports = { quantityUnits };
