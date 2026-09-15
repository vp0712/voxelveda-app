const crypto = require('node:crypto');
const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const { FinanceError } = require('../services/financeDomain');

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function audit(req, values) {
  return { actorId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent'), ...values };
}

function fail(res, error, message) {
  if (error instanceof FinanceError) return res.status(error.statusCode || 400).json({ message: error.message, code: error.code });
  console.error(`${message}:`, error);
  return res.status(500).json({ message, code: 'FINANCE_TRANSACTION_INTELLIGENCE_ERROR' });
}

function cleanMerchant(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\b(VISA|MASTERCARD|DEBIT|CREDIT|PURCHASE|PAYMENT|EFTPOS|CARD|POS|TRANSFER|OSKO|PAYID|DIRECT DEBIT|BPAY)\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^A-Z0-9&.' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

const CATEGORY_RULES = [
  ['Fuel & Vehicle', /(SHELL|BP |AMPOL|CALTEX|UNITED PETROLEUM|7-ELEVEN|MOBIL|PETROL|FUEL)/i],
  ['Groceries', /(COLES|WOOLWORTHS|ALDI|IGA |COSTCO)/i],
  ['Eating Out', /(MCDONALD|KFC|SUBWAY|UBER EATS|MENULOG|DOORDASH|RESTAURANT|CAFE|COFFEE)/i],
  ['Software & Subscriptions', /(ADOBE|MICROSOFT|GOOGLE|APPLE.COM|OPENAI|CHATGPT|CANVA|AUTODESK|GITHUB|DROPBOX|NOTION|ZOOM)/i],
  ['Website & Hosting', /(HOSTINGER|CLOUDFLARE|RAILWAY|VERCEL|NETLIFY|DOMAIN|HOSTING)/i],
  ['Shipping & Courier', /(AUSTRALIA POST|AUSPOST|DHL|FEDEX|UPS |TNT |COURIER|SENDLE)/i],
  ['Materials & Manufacturing', /(BUNNINGS|TOTAL TOOLS|SYDNEY TOOLS|RS COMPONENTS|ELEMENT14|JAYCAR|FILAMENT|RESIN|MATERIAL)/i],
  ['Advertising & Marketing', /(META|FACEBOOK|INSTAGRAM|GOOGLE ADS|TIKTOK|LINKEDIN ADS)/i],
  ['Phone & Internet', /(TELSTRA|OPTUS|VODAFONE|TPG|AUSSIE BROADBAND|NBN)/i],
  ['Insurance', /(AAMI|ALLIANZ|BINGLE|NRMA|RACV|INSURANCE)/i],
  ['Professional Fees', /(ACCOUNTING|ACCOUNTANT|LAWYER|LEGAL|ASIC|ATO|BOOKKEEP)/i],
  ['Bank Fees & Interest', /(BANK FEE|ACCOUNT FEE|CARD FEE|INTEREST CHARGE|OVERDRAWN FEE)/i],
  ['Travel', /(QANTAS|VIRGIN AUSTRALIA|JETSTAR|AIRBNB|BOOKING.COM|EXPEDIA|HOTEL|FLIGHT)/i]
];

function categorySuggestion(text) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(text)) return { category, confidence: 0.9 };
  }
  return { category: null, confidence: 0 };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayDiff(a, b) {
  return Math.round(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function recurringFrequency(dates) {
  if (dates.length < 3) return null;
  const sorted = [...dates].sort();
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(dayDiff(sorted[i], sorted[i - 1]));
  const med = median(gaps);
  if (med >= 6 && med <= 8) return 'WEEKLY';
  if (med >= 12 && med <= 16) return 'FORTNIGHTLY';
  if (med >= 25 && med <= 35) return 'MONTHLY';
  if (med >= 80 && med <= 100) return 'QUARTERLY';
  if (med >= 350 && med <= 380) return 'ANNUAL';
  return null;
}

exports.runAnalysis = async (req, res) => {
  let db;
  try {
    const scope = String(req.body.scope || 'ALL').toUpperCase();
    const params = [];
    const where = scope === 'ALL' ? '' : 'WHERE bt.ownership_scope=?';
    if (scope !== 'ALL') params.push(scope);
    const [transactions] = await pool.query(
      `SELECT bt.id, bt.bank_account_id, bt.transaction_date, bt.description, bt.merchant_name, bt.reference,
              bt.debit, bt.credit, bt.category, bt.ownership_scope, bt.is_internal_transfer,
              ba.nickname AS account_name, ba.ownership_scope AS account_scope
       FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       ${where} ORDER BY bt.transaction_date ASC, bt.id ASC`, params
    );
    if (!transactions.length) return res.json({ message: 'No bank transactions are available to analyse yet.', analysed: 0 });

    const merchantGroups = new Map();
    for (const tx of transactions) {
      tx.merchant_clean = cleanMerchant(tx.merchant_name || tx.description || tx.reference || '');
      const key = tx.merchant_clean || `TX-${tx.id}`;
      if (!merchantGroups.has(key)) merchantGroups.set(key, []);
      merchantGroups.get(key).push(tx);
    }

    const transferPairs = new Map();
    const transferCandidates = transactions.filter((tx) => Number(tx.debit || 0) > 0 || Number(tx.credit || 0) > 0);
    for (let i = 0; i < transferCandidates.length; i += 1) {
      const a = transferCandidates[i];
      const aAmount = Number(a.debit || 0) || Number(a.credit || 0);
      const aDirection = Number(a.debit || 0) > 0 ? 'OUT' : 'IN';
      for (let j = i + 1; j < transferCandidates.length; j += 1) {
        const b = transferCandidates[j];
        if (a.bank_account_id === b.bank_account_id) continue;
        const bAmount = Number(b.debit || 0) || Number(b.credit || 0);
        const bDirection = Number(b.debit || 0) > 0 ? 'OUT' : 'IN';
        if (aDirection === bDirection) continue;
        if (Math.abs(aAmount - bAmount) > 0.01) continue;
        if (dayDiff(a.transaction_date, b.transaction_date) > 3) continue;
        const pairUid = uid('XFER');
        transferPairs.set(a.id, pairUid);
        transferPairs.set(b.id, pairUid);
        break;
      }
    }

    db = await pool.getConnection();
    await db.beginTransaction();
    let generated = 0;
    let recurringCount = 0;
    let transferCount = 0;
    let anomalyCount = 0;

    for (const tx of transactions) {
      const group = merchantGroups.get(tx.merchant_clean || `TX-${tx.id}`) || [tx];
      const text = `${tx.merchant_clean} ${tx.description || ''}`;
      const category = categorySuggestion(text);
      const recurring = recurringFrequency(group.map((item) => item.transaction_date));
      if (recurring) recurringCount += 1;
      const transferUid = transferPairs.get(tx.id) || null;
      if (transferUid) transferCount += 1;
      const amounts = group.map((item) => Number(item.debit || 0) || Number(item.credit || 0));
      const med = median(amounts);
      const amount = Number(tx.debit || 0) || Number(tx.credit || 0);
      const anomaly = med > 0 && group.length >= 3 && amount > med * 2.5 && amount - med > 50;
      if (anomaly) anomalyCount += 1;
      const accountScope = String(tx.account_scope || tx.ownership_scope || 'UNCLASSIFIED').toUpperCase();
      let suggestedScope = accountScope;
      let scopeConfidence = accountScope === 'UNCLASSIFIED' ? 0.35 : 0.95;
      if (accountScope === 'MIXED' || accountScope === 'UNCLASSIFIED') {
        const businessPattern = /(HOSTINGER|RAILWAY|ADOBE|AUTODESK|BUNNINGS|TOTAL TOOLS|COURIER|SHIPPING|FILAMENT|RESIN|MATERIAL|SUPPLIER)/i;
        if (businessPattern.test(text)) {
          suggestedScope = 'BUSINESS';
          scopeConfidence = 0.82;
        }
      }
      const explanationParts = [];
      if (category.category) explanationParts.push(`Likely ${category.category} based on merchant/description.`);
      if (recurring) explanationParts.push(`Pattern looks ${recurring.toLowerCase()} across ${group.length} similar transactions.`);
      if (transferUid) explanationParts.push('Possible transfer between your own accounts because an equal opposite transaction appears within 3 days.');
      if (anomaly) explanationParts.push(`Amount is much higher than this merchant's typical amount (${med.toFixed(2)}).`);
      if (!explanationParts.length) explanationParts.push('No strong automatic pattern was found; keep this transaction for manual review.');

      await db.query(
        `INSERT INTO finance_transaction_insights
         (insight_uid, bank_transaction_id, merchant_normalized, suggested_category, category_confidence,
          suggested_scope, scope_confidence, recurring_frequency, recurring_confidence, transfer_candidate_uid,
          anomaly_score, anomaly_reason, explanation, status, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())
         ON DUPLICATE KEY UPDATE merchant_normalized=VALUES(merchant_normalized), suggested_category=VALUES(suggested_category),
          category_confidence=VALUES(category_confidence), suggested_scope=VALUES(suggested_scope), scope_confidence=VALUES(scope_confidence),
          recurring_frequency=VALUES(recurring_frequency), recurring_confidence=VALUES(recurring_confidence),
          transfer_candidate_uid=VALUES(transfer_candidate_uid), anomaly_score=VALUES(anomaly_score), anomaly_reason=VALUES(anomaly_reason),
          explanation=VALUES(explanation), status=IF(status='APPLIED','APPLIED','PENDING'), generated_at=NOW()`,
        [uid('INSIGHT'), tx.id, tx.merchant_clean || null, category.category, category.confidence * 100,
          suggestedScope, scopeConfidence * 100, recurring, recurring ? 88 : null, transferUid,
          anomaly ? 90 : 0, anomaly ? `Unusually high amount compared with merchant median ${med.toFixed(2)}` : null,
          explanationParts.join(' ')]
      );
      generated += 1;
    }

    await logAudit(db, audit(req, { action: 'FINANCE_INTELLIGENCE_ANALYSED', module: 'finance_intelligence', recordType: 'transaction_intelligence', recordId: scope, newValue: { analysed: generated, recurring: recurringCount, transfer_candidates: transferCount, anomalies: anomalyCount } }));
    await db.commit();
    return res.json({ message: `Analysed ${generated} transactions. Suggestions are review-only until you apply them.`, analysed: generated, recurring: recurringCount, transfer_candidates: transferCount, anomalies: anomalyCount });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to analyse transactions');
  } finally {
    if (db) db.release();
  }
};

exports.getInsights = async (req, res) => {
  try {
    const scope = String(req.query.scope || 'ALL').toUpperCase();
    const params = [];
    let where = "WHERE fi.status <> 'DISMISSED'";
    if (scope !== 'ALL') { where += ' AND bt.ownership_scope=?'; params.push(scope); }
    const [rows] = await pool.query(
      `SELECT fi.*, bt.transaction_date, bt.description, bt.merchant_name, bt.debit, bt.credit, bt.category AS current_category,
              bt.ownership_scope AS current_scope, bt.is_internal_transfer, ba.nickname AS account_name, ba.currency
       FROM finance_transaction_insights fi
       JOIN bank_transactions bt ON bt.id=fi.bank_transaction_id
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
       ${where}
       ORDER BY (fi.anomaly_score >= 70) DESC, (fi.transfer_candidate_uid IS NOT NULL) DESC,
                (fi.recurring_frequency IS NOT NULL) DESC, fi.generated_at DESC LIMIT 300`, params
    );
    const summary = rows.reduce((acc, row) => {
      if (row.status === 'PENDING') acc.pending += 1;
      if (row.suggested_category && row.suggested_category !== row.current_category) acc.category_suggestions += 1;
      if (row.suggested_scope && row.suggested_scope !== row.current_scope) acc.scope_suggestions += 1;
      if (row.recurring_frequency) acc.recurring += 1;
      if (row.transfer_candidate_uid) acc.transfer_candidates += 1;
      if (Number(row.anomaly_score || 0) >= 70) acc.anomalies += 1;
      return acc;
    }, { pending: 0, category_suggestions: 0, scope_suggestions: 0, recurring: 0, transfer_candidates: 0, anomalies: 0 });
    return res.json({ summary, insights: rows });
  } catch (error) { return fail(res, error, 'Failed to load transaction intelligence'); }
};

exports.applyInsight = async (req, res) => {
  let db;
  try {
    const id = Number(req.params.id || 0);
    db = await pool.getConnection();
    await db.beginTransaction();
    const [[insight]] = await db.query(
      `SELECT fi.*, bt.category AS current_category, bt.ownership_scope AS current_scope, bt.is_internal_transfer,
              bt.bank_account_id, bt.description
       FROM finance_transaction_insights fi JOIN bank_transactions bt ON bt.id=fi.bank_transaction_id
       WHERE fi.id=? FOR UPDATE`, [id]
    );
    if (!insight) throw new FinanceError('Finance insight not found.', 404, 'FINANCE_INSIGHT_NOT_FOUND');
    const applyCategory = req.body.apply_category !== false && insight.suggested_category;
    const applyScope = req.body.apply_scope === true && insight.suggested_scope;
    const applyTransfer = req.body.apply_transfer === true && insight.transfer_candidate_uid;
    await db.query(
      `UPDATE bank_transactions SET category=IF(?, ?, category), classification_status=IF(?, 'CLASSIFIED', classification_status),
       ownership_scope=IF(?, ?, ownership_scope), is_internal_transfer=IF(?, 1, is_internal_transfer) WHERE id=?`,
      [Boolean(applyCategory), insight.suggested_category, Boolean(applyCategory), Boolean(applyScope), insight.suggested_scope, Boolean(applyTransfer), insight.bank_transaction_id]
    );
    if (applyTransfer) {
      await db.query(
        `UPDATE bank_transactions bt JOIN finance_transaction_insights fi ON fi.bank_transaction_id=bt.id
         SET bt.is_internal_transfer=1 WHERE fi.transfer_candidate_uid=?`, [insight.transfer_candidate_uid]
      );
      await db.query(`UPDATE finance_transaction_insights SET status='APPLIED', reviewed_at=NOW(), reviewed_by=? WHERE transfer_candidate_uid=?`, [req.user.id, insight.transfer_candidate_uid]);
    } else {
      await db.query(`UPDATE finance_transaction_insights SET status='APPLIED', reviewed_at=NOW(), reviewed_by=? WHERE id=?`, [req.user.id, id]);
    }
    if (req.body.remember_rule && insight.merchant_normalized && (applyCategory || applyScope)) {
      await db.query(
        `INSERT INTO finance_category_rules (rule_uid, merchant_pattern, category, ownership_scope, created_by)
         VALUES (?, ?, ?, ?, ?)`, [uid('RULE'), insight.merchant_normalized, applyCategory ? insight.suggested_category : null, applyScope ? insight.suggested_scope : null, req.user.id]
      );
    }
    await logAudit(db, audit(req, { action: 'FINANCE_INSIGHT_APPLIED', module: 'finance_intelligence', recordType: 'bank_transaction', recordId: insight.bank_transaction_id, oldValue: { category: insight.current_category, ownership_scope: insight.current_scope, is_internal_transfer: insight.is_internal_transfer }, newValue: { category: applyCategory ? insight.suggested_category : insight.current_category, ownership_scope: applyScope ? insight.suggested_scope : insight.current_scope, is_internal_transfer: applyTransfer ? 1 : insight.is_internal_transfer } }));
    await db.commit();
    return res.json({ message: 'Finance suggestion applied. Dashboard totals will now use the updated classification.' });
  } catch (error) {
    if (db) await db.rollback();
    return fail(res, error, 'Failed to apply finance insight');
  } finally {
    if (db) db.release();
  }
};

exports.dismissInsight = async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const [result] = await pool.query(`UPDATE finance_transaction_insights SET status='DISMISSED', reviewed_at=NOW(), reviewed_by=? WHERE id=?`, [req.user.id, id]);
    if (!result.affectedRows) throw new FinanceError('Finance insight not found.', 404, 'FINANCE_INSIGHT_NOT_FOUND');
    await logAudit(pool, audit(req, { action: 'FINANCE_INSIGHT_DISMISSED', module: 'finance_intelligence', recordType: 'finance_transaction_insight', recordId: id }));
    return res.json({ message: 'Suggestion dismissed.' });
  } catch (error) { return fail(res, error, 'Failed to dismiss finance insight'); }
};
