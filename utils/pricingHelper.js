const pool = require('../config/db');

const GST_RATE = 0.10;

async function calculatePrice(rfq) {
  const [rules] = await pool.query(
    'SELECT * FROM pricing_rules WHERE material = ? AND is_active = 1 LIMIT 1',
    [rfq.material]
  );

  if (!rules.length) {
    throw new Error(`No active pricing rule found for material: ${rfq.material}`);
  }

  const rule = rules[0];
  const qty = Math.max(Number(rfq.quantity || 0), Number(rule.min_order_qty || 1));
  const basePrice = Number(rule.base_price || 0);
  const unitPrice = Number(rule.per_unit_price || 0);

  const subtotal = +(basePrice + (qty * unitPrice)).toFixed(2);
  const gst = +(subtotal * GST_RATE).toFixed(2);
  const total = +(subtotal + gst).toFixed(2);

  return {
    qty,
    unitPrice,
    subtotal,
    gst,
    total
  };
}

module.exports = { calculatePrice, GST_RATE };