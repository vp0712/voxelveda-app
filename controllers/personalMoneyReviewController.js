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

function dateText(value) {
  return value ? String(value).slice(0, 10) : null;
}

function daysBetween(a, b) {
  const aa = new Date(`${dateText(a)}T00:00:00Z`);
  const bb = new Date(`${dateText(b)}T00:00:00Z`);
  return Math.round((bb - aa) / 86400000);
}

function addFrequency(value, frequency) {
  const d = new Date(`${dateText(value)}T12:00:00Z`);
  if (frequency === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'FORTNIGHTLY') d.setUTCDate(d.getUTCDate() + 14);
  else if (frequency === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (frequency === 'QUARTERLY') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else throw Object.assign(new Error('Recurring frequency is not supported.'), { statusCode: 409 });
  return d.toISOString().slice(0, 10);
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

function merchantScore(expected, actual) {
  const a = normalizeMerchant(expected);
  const b = normalizeMerchant(actual);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b))) return 0.92;
  const aa = new Set(a.split(' ').filter((x) => x.length > 2));
  const bb = new Set(b.split(' ').filter((x) => x.length > 2));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  aa.forEach((token) => { if (bb.has(token)) overlap += 1; });
  return overlap / Math.max(aa.size, bb.size);
}

function dateTolerance(frequency) {
  return ({ WEEKLY: 3, FORTNIGHTLY: 4, MONTHLY: 7, QUARTERLY: 10, YEARLY: 14 })[frequency] || 7;
}

function scoreMatch(recurring, transaction) {
  const actual = recurring.item_type === 'INCOME' ? Number(transaction.credit || 0) : Number(transaction.debit || 0);
  if (!(actual > 0)) return null;
  const expected = Number(recurring.amount || 0);
  if (!(expected > 0)) return null;
  if (String(recurring.currency || '').toUpperCase() !== String(transaction.currency || '').toUpperCase()) return null;

  const merchant = merchantScore(recurring.counterparty || recurring.name, transaction.merchant_name || transaction.description);
  if (merchant < 0.45) return null;

  const deltaDays = Math.abs(daysBetween(recurring.next_due_date, transaction.transaction_date));
  const tolerance = dateTolerance(recurring.frequency);
  if (deltaDays > tolerance) return null;

  const amountDelta = Math.abs(actual - expected);
  const amountPct = expected > 0 ? amountDelta / expected : 1;
  if (amountPct > 0.35 && amountDelta > 5) return null;

  const merchantPoints = merchant * 45;
  const datePoints = Math.max(0, 30 * (1 - deltaDays / (tolerance + 1)));
  const amountPoints = Math.max(0, 25 * (1 - Math.min(1, amountPct / 0.35)));
  const confidence = Math.round(Math.min(99, merchantPoints + datePoints + amountPoints));
  const priceChanged = amountDelta >= 1 && amountPct >= 0.05;

  return {
    confidence,
    actual_amount: Math.round(actual * 100) / 100,
    expected_amount: Math.round(expected * 100) / 100,
    amount_difference: Math.round((actual - expected) * 100) / 100,
    price_change_percent: Math.round(((actual - expected) / expected) * 1000) / 10,
    price_changed: priceChanged,
    days_from_due: daysBetween(recurring.next_due_date, transaction.transaction_date),
    merchant_score: Math.round(merchant * 100)
  };
}

async function sourceData(userId, db = pool) {
  const [recurring] = await db.query(
    `SELECT id,name,item_type,amount,currency,frequency,next_due_date,category,counterparty,last_completed_date
     FROM personal_money_recurring_items
     WHERE user_id=? AND active=1 AND next_due_date IS NOT NULL
     ORDER BY next_due_date,name`, [userId]
  );
  const [transactions] = await db.query(
    `SELECT bt.id,bt.bank_account_id,bt.transaction_date,bt.description,bt.merchant_name,bt.debit,bt.credit,bt.currency,
            ba.nickname account_name,ba.institution
     FROM bank_transactions bt
     JOIN bank_accounts ba ON ba.id=bt.bank_account_id
     WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
       AND bt.is_internal_transfer=0 AND bt.transaction_date>=DATE_SUB(CURRENT_DATE,INTERVAL 60 DAY)
       AND (bt.debit>0 OR bt.credit>0)
     ORDER BY bt.transaction_date DESC,bt.id DESC LIMIT 1000`, [userId]
  );
  const [decisions] = await db.query(
    `SELECT recurring_item_id,bank_transaction_id,decision,match_confidence,amount_updated,decided_at
     FROM personal_money_recurring_matches WHERE user_id=?`, [userId]
  );
  return { recurring, transactions, decisions };
}

function buildInbox(recurring, transactions, decisions) {
  const decidedPairs = new Map(decisions.map((d) => [`${d.recurring_item_id}:${d.bank_transaction_id}`, d]));
  const confirmedTransactions = new Set(decisions.filter((d) => d.decision === 'CONFIRMED').map((d) => String(d.bank_transaction_id)));
  const matches = [];

  recurring.forEach((item) => {
    const candidates = transactions
      .filter((tx) => !confirmedTransactions.has(String(tx.id)))
      .map((tx) => ({ tx, score: scoreMatch(item, tx) }))
      .filter(({ tx, score }) => score && score.confidence >= 70 && !decidedPairs.has(`${item.id}:${tx.id}`))
      .sort((a, b) => b.score.confidence - a.score.confidence || Math.abs(a.score.days_from_due) - Math.abs(b.score.days_from_due));
    if (!candidates.length) return;
    const best = candidates[0];
    matches.push({
      recurring_item_id: item.id,
      recurring_name: item.name,
      item_type: item.item_type,
      frequency: item.frequency,
      expected_due_date: dateText(item.next_due_date),
      expected_amount: best.score.expected_amount,
      currency: item.currency,
      bank_transaction_id: best.tx.id,
      transaction_date: dateText(best.tx.transaction_date),
      actual_amount: best.score.actual_amount,
      merchant: best.tx.merchant_name || best.tx.description || 'Bank transaction',
      account_name: best.tx.account_name,
      institution: best.tx.institution,
      confidence: best.score.confidence,
      days_from_due: best.score.days_from_due,
      price_changed: best.score.price_changed,
      amount_difference: best.score.amount_difference,
      price_change_percent: best.score.price_change_percent,
      explanation: `This ${item.item_type === 'INCOME' ? 'deposit' : 'payment'} closely matches ${item.name} by merchant, currency, amount and expected date. Review it before confirming.`
    });
  });

  const today = new Date().toISOString().slice(0, 10);
  const stillDue = recurring.filter((item) => dateText(item.next_due_date) <= today && !matches.some((m) => m.recurring_item_id === item.id)).map((item) => ({
    recurring_item_id:item.id,name:item.name,item_type:item.item_type,amount:Number(item.amount),currency:item.currency,due_date:dateText(item.next_due_date),frequency:item.frequency,
    explanation:'No high-confidence personal bank transaction has been matched to this due item yet.'
  }));

  const recent = transactions.slice(0, 500);
  const duplicates = [];
  const seen = new Set();
  for (let i = 0; i < recent.length; i += 1) {
    for (let j = i + 1; j < recent.length; j += 1) {
      const a = recent[i], b = recent[j];
      if (a.bank_account_id !== b.bank_account_id || a.currency !== b.currency) continue;
      if (Math.abs(daysBetween(a.transaction_date, b.transaction_date)) > 1) continue;
      const aAmount = Number(a.debit || a.credit || 0), bAmount = Number(b.debit || b.credit || 0);
      if (Math.abs(aAmount - bAmount) > 0.01) continue;
      if (merchantScore(a.merchant_name || a.description, b.merchant_name || b.description) < 0.9) continue;
      const key = [a.id,b.id].sort((x,y)=>x-y).join(':');
      if (seen.has(key)) continue; seen.add(key);
      duplicates.push({
        transaction_ids:[a.id,b.id],transaction_date:dateText(a.transaction_date),other_date:dateText(b.transaction_date),amount:Math.round(aAmount*100)/100,currency:a.currency,
        merchant:a.merchant_name || a.description || b.merchant_name || b.description || 'Similar transactions',account_name:a.account_name,
        explanation:'These two personal transactions look very similar in merchant, amount and date. They are only flagged for review; nothing is deleted automatically.'
      });
      if (duplicates.length >= 20) break;
    }
    if (duplicates.length >= 20) break;
  }

  return { matches:matches.sort((a,b)=>b.confidence-a.confidence), still_due:stillDue, duplicate_candidates:duplicates };
}

exports.getReviewInbox = async (req,res) => {
  try {
    const userId=uid(req);
    const { recurring,transactions,decisions }=await sourceData(userId);
    const inbox=buildInbox(recurring,transactions,decisions);
    return res.json({
      explanation:'Smart Review Inbox suggests matches only from your personal bank transactions. Nothing is marked paid, deleted or posted to company accounting until you explicitly confirm an action.',
      summary:{ likely_paid:inbox.matches.length, still_due:inbox.still_due.length, duplicate_looking:inbox.duplicate_candidates.length, price_changes:inbox.matches.filter((m)=>m.price_changed).length },
      ...inbox
    });
  } catch(error){ return respondError(res,error,'Failed to load Smart Review Inbox.'); }
};

exports.confirmMatch = async (req,res) => {
  const db=await pool.getConnection();
  try {
    const userId=uid(req); const recurringId=String(req.params.recurringId||''); const transactionId=Number(req.params.transactionId||0);
    if(!recurringId || !transactionId) throw Object.assign(new Error('Match identifiers are invalid.'),{statusCode:400});
    await db.beginTransaction();
    const [[item]]=await db.query(`SELECT * FROM personal_money_recurring_items WHERE id=? AND user_id=? AND active=1 FOR UPDATE`,[recurringId,userId]);
    if(!item) throw Object.assign(new Error('Recurring item not found.'),{statusCode:404});
    const [[tx]]=await db.query(
      `SELECT bt.*,ba.created_by,ba.ownership_scope account_scope FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       WHERE bt.id=? AND ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' AND bt.is_internal_transfer=0 FOR UPDATE`,[transactionId,userId]
    );
    if(!tx) throw Object.assign(new Error('Personal bank transaction not found.'),{statusCode:404});
    const score=scoreMatch(item,tx);
    if(!score || score.confidence<70) throw Object.assign(new Error('This transaction no longer meets the safe matching threshold. Refresh the Review Inbox.'),{statusCode:409});
    const [[used]]=await db.query(`SELECT id FROM personal_money_recurring_matches WHERE user_id=? AND bank_transaction_id=? AND decision='CONFIRMED' LIMIT 1 FOR UPDATE`,[userId,transactionId]);
    if(used) throw Object.assign(new Error('This bank transaction has already been confirmed against another recurring item.'),{statusCode:409});
    const updateAmount=Boolean(req.body?.update_amount);
    await db.query(
      `INSERT INTO personal_money_recurring_matches
       (user_id,recurring_item_id,bank_transaction_id,decision,match_confidence,expected_amount,actual_amount,expected_due_date,transaction_date,amount_updated)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE decision='CONFIRMED',match_confidence=VALUES(match_confidence),expected_amount=VALUES(expected_amount),actual_amount=VALUES(actual_amount),expected_due_date=VALUES(expected_due_date),transaction_date=VALUES(transaction_date),amount_updated=VALUES(amount_updated),decided_at=CURRENT_TIMESTAMP`,
      [userId,item.id,tx.id,'CONFIRMED',score.confidence,score.expected_amount,score.actual_amount,dateText(item.next_due_date),dateText(tx.transaction_date),updateAmount?1:0]
    );
    let next=addFrequency(item.next_due_date,item.frequency);
    while(next<=dateText(tx.transaction_date)) next=addFrequency(next,item.frequency);
    await db.query(`UPDATE personal_money_recurring_items SET last_completed_date=?,next_due_date=?${updateAmount?',amount=?':''} WHERE id=? AND user_id=?`,
      updateAmount?[dateText(tx.transaction_date),next,score.actual_amount,item.id,userId]:[dateText(tx.transaction_date),next,item.id,userId]);
    await db.commit();
    return res.json({message:updateAmount?`Confirmed as paid/received and future amount updated to ${score.actual_amount.toFixed(2)} ${item.currency}. No company accounting entry was created.`:'Confirmed as paid/received and the next due date was advanced. The future amount was not changed.',next_due_date:next,amount_updated:updateAmount});
  } catch(error){ await db.rollback(); return respondError(res,error,'Failed to confirm recurring match.'); }
  finally { db.release(); }
};

exports.dismissMatch = async (req,res) => {
  try {
    const userId=uid(req); const recurringId=String(req.params.recurringId||''); const transactionId=Number(req.params.transactionId||0);
    const [[item]]=await pool.query(`SELECT id,amount,next_due_date FROM personal_money_recurring_items WHERE id=? AND user_id=? AND active=1 LIMIT 1`,[recurringId,userId]);
    const [[tx]]=await pool.query(`SELECT bt.id,bt.transaction_date,bt.debit,bt.credit,bt.currency FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id WHERE bt.id=? AND ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' LIMIT 1`,[transactionId,userId]);
    if(!item||!tx) throw Object.assign(new Error('Review item not found.'),{statusCode:404});
    const actual=Number(tx.debit||tx.credit||0);
    await pool.query(
      `INSERT INTO personal_money_recurring_matches
       (user_id,recurring_item_id,bank_transaction_id,decision,match_confidence,expected_amount,actual_amount,expected_due_date,transaction_date,amount_updated)
       VALUES (?,?,?,?,?,?,?,?,?,0)
       ON DUPLICATE KEY UPDATE decision='DISMISSED',decided_at=CURRENT_TIMESTAMP`,
      [userId,item.id,tx.id,'DISMISSED',0,Number(item.amount||0),actual,dateText(item.next_due_date),dateText(tx.transaction_date)]
    );
    return res.json({message:'Match suggestion dismissed. The bill/reminder and bank transaction were not changed.'});
  } catch(error){ return respondError(res,error,'Failed to dismiss review suggestion.'); }
};
