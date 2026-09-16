const crypto = require('node:crypto');
const pool = require('../config/db');

function uid(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}

function respondError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
}

function currency(value) {
  const code = String(value || 'AUD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw Object.assign(new Error('Currency must be a three-letter code such as AUD, USD or INR.'), { statusCode: 400 });
  return code;
}

function positiveAmount(value, field = 'Amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999) throw Object.assign(new Error(`${field} is invalid.`), { statusCode: 400 });
  return Math.round(n * 10000) / 10000;
}

function clean(value, max = 255) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function normalizeMerchant(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\b(POS|EFTPOS|VISA|MASTERCARD|DEBIT|CREDIT|PURCHASE|PAYMENT|CARD|ONLINE|DIRECT DEBIT|DD)\b/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function frequencyForDays(days) {
  if (days >= 5 && days <= 9) return 'WEEKLY';
  if (days >= 11 && days <= 17) return 'FORTNIGHTLY';
  if (days >= 24 && days <= 38) return 'MONTHLY';
  if (days >= 70 && days <= 110) return 'QUARTERLY';
  if (days >= 330 && days <= 400) return 'YEARLY';
  return null;
}

function addDays(value, days) {
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(1, Math.round(days)));
  return d.toISOString().slice(0, 10);
}

function addFrequency(value, frequency) {
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (frequency === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'FORTNIGHTLY') d.setUTCDate(d.getUTCDate() + 14);
  else if (frequency === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (frequency === 'QUARTERLY') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const aa = new Date(`${String(a).slice(0, 10)}T00:00:00Z`);
  const bb = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
  return Math.round((bb - aa) / 86400000);
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function suggestionKey(accountId, merchantKey, code, frequency) {
  return crypto.createHash('sha256').update(`${accountId}|${merchantKey}|${code}|${frequency}`).digest('hex');
}

async function detectRecurring(userId) {
  const [rows] = await pool.query(
    `SELECT bt.id,bt.bank_account_id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.credit,bt.currency,
            ba.nickname account_name,ba.institution
     FROM bank_transactions bt
     JOIN bank_accounts ba ON ba.id=bt.bank_account_id
     WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
       AND bt.is_internal_transfer=0 AND bt.transaction_date>=DATE_SUB(CURRENT_DATE,INTERVAL 13 MONTH)
       AND (bt.debit>0 OR bt.credit>0)
     ORDER BY bt.transaction_date,bt.id`, [userId]
  );

  const groups = new Map();
  rows.forEach((row) => {
    const merchantKey = normalizeMerchant(row.merchant_name || row.description);
    if (!merchantKey || merchantKey.length < 3) return;
    const direction = Number(row.debit || 0) > 0 ? 'OUT' : 'IN';
    const code = String(row.currency || 'AUD').toUpperCase();
    const key = `${row.bank_account_id}|${merchantKey}|${code}|${direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, merchantKey, direction, amount: direction === 'OUT' ? Number(row.debit || 0) : Number(row.credit || 0) });
  });

  const suggestions = [];
  for (const items of groups.values()) {
    if (items.length < 3) continue;
    const intervals = [];
    for (let i = 1; i < items.length; i += 1) {
      const gap = daysBetween(items[i - 1].transaction_date, items[i].transaction_date);
      if (gap > 0) intervals.push(gap);
    }
    if (intervals.length < 2) continue;
    const medianDays = median(intervals);
    const frequency = frequencyForDays(medianDays);
    if (!frequency) continue;
    const intervalDeviation = median(intervals.map((v) => Math.abs(v - medianDays)));
    const intervalTolerance = Math.max(3, medianDays * 0.2);
    if (intervalDeviation > intervalTolerance) continue;

    const amounts = items.map((x) => x.amount).filter((x) => x > 0);
    const typical = median(amounts);
    if (!(typical > 0)) continue;
    const amountDeviation = median(amounts.map((v) => Math.abs(v - typical))) / typical;
    const confidence = Math.max(55, Math.min(98, Math.round(95 - intervalDeviation / Math.max(1, medianDays) * 80 - amountDeviation * 60)));
    if (confidence < 60) continue;

    const last = items[items.length - 1];
    const priorAmounts = amounts.slice(0, -1);
    const priorTypical = priorAmounts.length ? median(priorAmounts) : typical;
    const changePct = priorTypical > 0 ? (last.amount - priorTypical) / priorTypical * 100 : 0;
    const priceChanged = items[0].direction === 'OUT' && priorAmounts.length >= 2 && Math.abs(last.amount - priorTypical) >= 1 && Math.abs(changePct) >= 5;
    const sourceKey = suggestionKey(last.bank_account_id, last.merchantKey, last.currency, frequency);
    const nextDue = addDays(last.transaction_date, medianDays);
    suggestions.push({
      suggestion_key: sourceKey,
      bank_account_id: last.bank_account_id,
      account_name: last.account_name,
      institution: last.institution,
      merchant_key: last.merchantKey,
      display_name: String(last.merchant_name || last.description || last.merchantKey).slice(0, 160),
      direction: last.direction,
      item_type: last.direction === 'IN' ? 'INCOME' : 'SUBSCRIPTION',
      currency: last.currency,
      frequency,
      occurrences: items.length,
      median_interval_days: Math.round(medianDays * 10) / 10,
      typical_amount: Math.round(typical * 100) / 100,
      latest_amount: Math.round(last.amount * 100) / 100,
      previous_typical_amount: Math.round(priorTypical * 100) / 100,
      price_change_percent: Math.round(changePct * 10) / 10,
      price_changed: priceChanged,
      last_seen_date: String(last.transaction_date).slice(0, 10),
      next_expected_date: nextDue,
      confidence,
      explanation: `${items.length} similar ${last.direction === 'OUT' ? 'payments' : 'deposits'} appeared about every ${Math.round(medianDays)} days.`,
      source_transaction_ids: items.slice(-6).map((x) => x.id)
    });
  }

  const [existing] = await pool.query(
    `SELECT id,name,currency,frequency,detected_source_key,counterparty FROM personal_money_recurring_items WHERE user_id=? AND active=1`, [userId]
  );
  const detectedKeys = new Set(existing.map((x) => x.detected_source_key).filter(Boolean));
  return suggestions
    .map((s) => {
      const normalizedName = normalizeMerchant(s.display_name);
      const possible = existing.find((x) => x.currency === s.currency && x.frequency === s.frequency && (normalizeMerchant(x.counterparty) === s.merchant_key || normalizeMerchant(x.name) === normalizedName));
      return { ...s, already_added: detectedKeys.has(s.suggestion_key) || Boolean(possible), matched_recurring_id: possible?.id || null };
    })
    .sort((a, b) => Number(b.price_changed) - Number(a.price_changed) || b.confidence - a.confidence || b.occurrences - a.occurrences);
}

async function buildCalendar(userId, days = 60) {
  const horizon = Math.min(120, Math.max(14, Number(days || 60)));
  const end = new Date(); end.setUTCDate(end.getUTCDate() + horizon);
  const endText = end.toISOString().slice(0, 10);
  const [recurring] = await pool.query(
    `SELECT id,name,item_type,amount,currency,frequency,next_due_date,category,counterparty
     FROM personal_money_recurring_items WHERE user_id=? AND active=1 AND next_due_date<=?`, [userId, endText]
  );
  const [debts] = await pool.query(
    `SELECT id,direction,counterparty,outstanding_amount,currency,due_date,status FROM personal_money_debts
     WHERE user_id=? AND status<>'SETTLED' AND due_date IS NOT NULL AND due_date<=?`, [userId, endText]
  );
  const today = todayText();
  const events = [];
  recurring.forEach((row) => {
    let date = String(row.next_due_date).slice(0, 10);
    let guard = 0;
    while (date <= endText && guard < 30) {
      if (date >= today) events.push({ id:`recurring:${row.id}:${date}`, source:'RECURRING', date, title:row.name, direction:row.item_type==='INCOME'?'IN':'OUT', amount:Number(row.amount), currency:row.currency, category:row.category, counterparty:row.counterparty, certainty:'KNOWN' });
      date = addFrequency(date, row.frequency); guard += 1;
    }
  });
  debts.forEach((row) => {
    const date = String(row.due_date).slice(0, 10);
    if (date >= today) events.push({ id:`debt:${row.id}`, source:'DEBT', date, title:row.direction==='BORROWED'?`Debt payment: ${row.counterparty}`:`Expected repayment: ${row.counterparty}`, direction:row.direction==='BORROWED'?'OUT':'IN', amount:Number(row.outstanding_amount), currency:row.currency, certainty:row.direction==='BORROWED'?'KNOWN':'EXPECTED' });
  });
  return events.sort((a,b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction));
}

async function planningSnapshot(userId) {
  const [bankRows] = await pool.query(
    `SELECT currency,COALESCE(SUM(COALESCE(available_balance,current_ledger_balance,0)),0) total
     FROM bank_accounts WHERE created_by=? AND ownership_scope='PERSONAL' AND status='ACTIVE' GROUP BY currency`, [userId]
  );
  const [walletRows] = await pool.query(
    `SELECT currency,COALESCE(SUM(balance),0) total FROM personal_money_wallets WHERE user_id=? AND active=1 GROUP BY currency`, [userId]
  );
  const [buffers] = await pool.query(`SELECT currency,reserve_amount,note FROM personal_money_safety_buffers WHERE user_id=?`, [userId]);
  const calendar = await buildCalendar(userId, 30);
  const byCurrency = {};
  const ensure = (code) => { if (!byCurrency[code]) byCurrency[code] = { bank_funds:0,manual_wallets:0,known_outflows_30d:0,expected_inflows_30d:0,safety_buffer:0,safe_to_spend:0 }; return byCurrency[code]; };
  bankRows.forEach((r) => { ensure(r.currency).bank_funds = Number(r.total || 0); });
  walletRows.forEach((r) => { ensure(r.currency).manual_wallets = Number(r.total || 0); });
  buffers.forEach((r) => { ensure(r.currency).safety_buffer = Number(r.reserve_amount || 0); ensure(r.currency).buffer_note = r.note || null; });
  calendar.forEach((e) => { const row=ensure(e.currency); if(e.direction==='OUT') row.known_outflows_30d += Number(e.amount||0); else row.expected_inflows_30d += Number(e.amount||0); });
  Object.values(byCurrency).forEach((row) => {
    row.visible_funds = Math.round((row.bank_funds + row.manual_wallets) * 100) / 100;
    row.known_outflows_30d = Math.round(row.known_outflows_30d * 100) / 100;
    row.expected_inflows_30d = Math.round(row.expected_inflows_30d * 100) / 100;
    row.safe_to_spend = Math.round((row.visible_funds - row.known_outflows_30d - row.safety_buffer) * 100) / 100;
  });
  return { by_currency:byCurrency, calendar };
}

async function spendingTrends(userId) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(bt.transaction_date,'%Y-%m') month_key,bt.currency,ROUND(SUM(bt.debit),2) spent
     FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
     WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' AND bt.is_internal_transfer=0
       AND bt.debit>0 AND bt.transaction_date>=DATE_FORMAT(DATE_SUB(CURRENT_DATE,INTERVAL 5 MONTH),'%Y-%m-01')
     GROUP BY DATE_FORMAT(bt.transaction_date,'%Y-%m'),bt.currency ORDER BY month_key,bt.currency`, [userId]
  );
  return rows.map((r) => ({ month:r.month_key,currency:r.currency,spent:Number(r.spent||0) }));
}

exports.getSmartCenter = async (req,res) => {
  try {
    const userId=uid(req);
    const [suggestions,planning,trends] = await Promise.all([detectRecurring(userId),planningSnapshot(userId),spendingTrends(userId)]);
    return res.json({
      explanation:'Smart Money looks for patterns and plans ahead, but every detected recurring item stays a suggestion until you approve it.',
      safe_to_spend_explanation:'Safe to spend = visible personal bank balances + manual wallets − known 30-day outflows − your safety buffer. Expected income is shown separately and is not counted as available money.',
      duplicate_balance_warning:'If a manual wallet mirrors money already held in a bank account, do not count it twice. Keep manual wallets for physical cash or balances not represented by the connected/imported bank account.',
      recurring_suggestions:suggestions,
      price_change_alerts:suggestions.filter((s)=>s.price_changed && !s.already_added),
      cashflow_calendar:planning.calendar,
      safe_to_spend_by_currency:planning.by_currency,
      spending_trends:trends
    });
  } catch(error){ return respondError(res,error,'Failed to load Smart Money planning.'); }
};

exports.applyRecurringSuggestion = async (req,res) => {
  try {
    const userId=uid(req); const key=String(req.params.key||'').trim().toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(key)) throw Object.assign(new Error('Suggestion key is invalid.'),{statusCode:400});
    const suggestions=await detectRecurring(userId); const suggestion=suggestions.find((s)=>s.suggestion_key===key);
    if(!suggestion) throw Object.assign(new Error('This recurring suggestion is no longer available. Run detection again.'),{statusCode:404});
    if(suggestion.already_added) throw Object.assign(new Error('This pattern is already tracked as a recurring item.'),{statusCode:409});
    const id=crypto.randomUUID();
    await pool.query(
      `INSERT INTO personal_money_recurring_items
       (id,user_id,name,item_type,amount,currency,frequency,next_due_date,category,counterparty,reminder_days,note,detected_source_key,detected_from_bank_account_id,detection_confidence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,userId,suggestion.display_name,suggestion.item_type,suggestion.latest_amount,suggestion.currency,suggestion.frequency,suggestion.next_expected_date,null,suggestion.display_name,3,
       `Detected from ${suggestion.occurrences} personal bank transactions. Review future dates and amounts; no payment is automated.`,suggestion.suggestion_key,suggestion.bank_account_id,suggestion.confidence]
    );
    return res.status(201).json({message:'Recurring reminder created from the detected pattern. No payment or accounting entry was created.',id});
  } catch(error){ return respondError(res,error,'Failed to create recurring reminder from suggestion.'); }
};

exports.saveSafetyBuffer = async (req,res) => {
  try {
    const userId=uid(req); const code=currency(req.body.currency); const reserve=positiveAmount(req.body.reserve_amount,'Safety buffer'); const note=clean(req.body.note,255);
    await pool.query(
      `INSERT INTO personal_money_safety_buffers (user_id,currency,reserve_amount,note) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE reserve_amount=VALUES(reserve_amount),note=VALUES(note),updated_at=CURRENT_TIMESTAMP`,
      [userId,code,reserve,note]
    );
    return res.json({message:`${code} safety buffer saved. Safe-to-spend estimates will keep this amount aside.`});
  } catch(error){ return respondError(res,error,'Failed to save safety buffer.'); }
};
