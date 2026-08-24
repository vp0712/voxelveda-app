function normalizeDecimal(value) {
  const raw = String(value ?? '').trim().replace(/[$,\s]/g, '');
  if (!raw) return '0';
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new TypeError('Invalid monetary value');
  }
  return raw;
}

function toCents(value) {
  const normalized = normalizeDecimal(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const padded = `${fraction}00`;
  const roundDigit = Number(padded[2] || 0);
  let cents = (BigInt(whole || 0) * 100n) + BigInt(padded.slice(0, 2));
  if (roundDigit >= 5) cents += 1n;
  return negative ? -cents : cents;
}

function fromCents(value) {
  const cents = typeof value === 'bigint' ? value : BigInt(value || 0);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function add(...values) {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0n));
}

function subtract(left, right) {
  return fromCents(toCents(left) - toCents(right));
}

function gstFromGross(gross, rate = '10') {
  const grossCents = toCents(gross);
  const rateBasisPoints = BigInt(Math.round(Number(normalizeDecimal(rate)) * 100));
  if (rateBasisPoints <= 0n) return '0.00';
  const denominator = 10000n + rateBasisPoints;
  const netCents = (grossCents * 10000n + (denominator / 2n)) / denominator;
  return fromCents(grossCents - netCents);
}

function percentageOf(net, rate = '10') {
  const netCents = toCents(net);
  const rateBasisPoints = BigInt(Math.round(Number(normalizeDecimal(rate)) * 100));
  const scaled = netCents * rateBasisPoints;
  const rounded = scaled >= 0n ? scaled + 5000n : scaled - 5000n;
  return fromCents(rounded / 10000n);
}

function equals(left, right, toleranceCents = 0n) {
  const difference = toCents(left) - toCents(right);
  return (difference < 0n ? -difference : difference) <= toleranceCents;
}

function multiplyQuantity(unitPrice, quantity) {
  const raw = String(quantity ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw new TypeError('Invalid quantity');
  const [whole = '0', fraction = ''] = raw.split('.');
  const thousandths = (BigInt(whole) * 1000n) + BigInt(`${fraction}000`.slice(0, 3));
  if (thousandths <= 0n) throw new TypeError('Quantity must be greater than zero');
  const product = toCents(unitPrice) * thousandths;
  return fromCents((product + 500n) / 1000n);
}

module.exports = {
  normalizeDecimal,
  toCents,
  fromCents,
  add,
  subtract,
  gstFromGross,
  percentageOf,
  equals,
  multiplyQuantity
};
