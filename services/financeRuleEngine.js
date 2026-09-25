'use strict';

const { FinanceError, dateOnly } = require('./financeDomain');

const RULE_MODES = new Set(['SUGGEST_ONLY', 'AUTO_APPLY']);
const GST_TREATMENTS = new Set([
  'REVIEW',
  'GST_ON_EXPENSES',
  'GST_ON_INCOME',
  'GST_FREE',
  'INPUT_TAXED',
  'NO_GST',
  'OUT_OF_SCOPE'
]);

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

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => String(item || '').trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
}

function parseTags(value) {
  if (Array.isArray(value)) return normalizeTags(value);
  if (!value) return [];
  try { return normalizeTags(JSON.parse(value)); } catch { return normalizeTags(value); }
}

function normalizeRuleMode(value) {
  const mode = String(value || 'SUGGEST_ONLY').trim().toUpperCase();
  if (!RULE_MODES.has(mode)) throw new FinanceError('Rule mode must be Suggest Only or Auto Apply.', 400, 'INVALID_FINANCE_RULE_MODE');
  return mode;
}

function normalizeGstTreatment(value, allowNull = true) {
  if (allowNull && (value === null || value === undefined || value === '')) return null;
  const treatment = String(value || '').trim().toUpperCase();
  if (!GST_TREATMENTS.has(treatment)) throw new FinanceError('Choose a supported GST treatment.', 400, 'INVALID_GST_TREATMENT');
  return treatment;
}

function exactRuleMatch(transaction, rule) {
  const transactionMerchant = cleanMerchant(transaction.merchant_name || transaction.description || transaction.reference || '');
  const ruleMerchant = cleanMerchant(rule.merchant_pattern);
  return Boolean(transactionMerchant && ruleMerchant && transactionMerchant === ruleMerchant);
}

function ruleCompatibleWithAccount(rule, accountScope) {
  const account = String(accountScope || '').trim().toUpperCase();
  const ruleScope = String(rule?.ownership_scope || '').trim().toUpperCase();
  const categoryScope = String(rule?.category_scope || '').trim().toUpperCase();
  if (account === 'PERSONAL') {
    if (ruleScope && ruleScope !== 'PERSONAL') return false;
    if (categoryScope && !['PERSONAL','BOTH'].includes(categoryScope)) return false;
  }
  if (account === 'BUSINESS') {
    if (ruleScope && ruleScope !== 'BUSINESS') return false;
    if (categoryScope && !['BUSINESS','BOTH'].includes(categoryScope)) return false;
  }
  if (['MIXED','UNCLASSIFIED'].includes(account) && categoryScope === 'PERSONAL' && ruleScope && ruleScope !== 'PERSONAL') return false;
  if (['MIXED','UNCLASSIFIED'].includes(account) && categoryScope === 'BUSINESS' && ruleScope && ruleScope !== 'BUSINESS') return false;
  return true;
}

async function findExactAutoCategoryRule(db, userId, transaction = {}, preloadedRules = null) {
  const actorId = Number(userId || 0);
  if (!actorId) return null;
  const merchant = cleanMerchant(transaction.merchant_normalized || transaction.merchant_name || transaction.description || transaction.reference || '');
  if (!merchant) return null;
  let rules = Array.isArray(preloadedRules) ? preloadedRules : null;
  if (!rules) {
    [rules] = await db.query(
      `SELECT r.id,r.merchant_pattern,r.category,r.ownership_scope,r.priority,r.application_mode,r.enabled,
              c.scope AS category_scope
         FROM finance_category_rules r
         LEFT JOIN finance_system_categories c
           ON c.name=r.category AND c.active=1 AND c.archived_at IS NULL
          AND ((c.scope IN ('BUSINESS','BOTH') AND c.owner_user_id IS NULL)
            OR (c.scope='PERSONAL' AND c.owner_user_id=r.created_by))
        WHERE r.created_by=? AND r.enabled=1 AND r.application_mode='AUTO_APPLY'
          AND r.category IS NOT NULL AND r.category<>''
        ORDER BY r.priority DESC,r.updated_at DESC,r.id DESC`,
      [actorId]
    );
  }
  return rules.find((rule) => cleanMerchant(rule.merchant_pattern) === merchant
    && ruleCompatibleWithAccount(rule, transaction.account_scope)) || null;
}

async function upsertExactAutoCategoryRule(db, options = {}) {
  const actorId = Number(options.userId || 0);
  const category = String(options.category || '').trim().slice(0, 120);
  const merchant = cleanMerchant(
    options.merchant_normalized || options.merchant_name || options.description || options.reference || ''
  );
  if (!actorId || !category || !merchant) return { saved: false, rule: null, merchant: merchant || null };

  const ownershipScope = String(options.ownershipScope || '').trim().toUpperCase();
  const scope = ['PERSONAL','BUSINESS','MIXED','UNCLASSIFIED'].includes(ownershipScope) ? ownershipScope : null;
  const [ownedRules] = await db.query(
    `SELECT id,rule_uid,merchant_pattern,category,ownership_scope,application_mode,priority,enabled
       FROM finance_category_rules
      WHERE created_by=?
      ORDER BY priority DESC,updated_at DESC,id DESC FOR UPDATE`,
    [actorId]
  );
  const normalizedMatches = ownedRules.filter((rule) => cleanMerchant(rule.merchant_pattern) === merchant);
  const existing = normalizedMatches[0] || null;
  if (existing) {
    await db.query(
      `UPDATE finance_category_rules
          SET merchant_pattern=?,category=?,ownership_scope=?,priority=500,enabled=1,application_mode='AUTO_APPLY',
              updated_by=?,last_used_at=NOW()
        WHERE id=?`,
      [merchant, category, scope, actorId, existing.id]
    );
    const duplicateIds = normalizedMatches.slice(1).map((rule) => Number(rule.id)).filter(Boolean);
    if (duplicateIds.length) {
      await db.query(
        `UPDATE finance_category_rules SET enabled=0,updated_by=? WHERE id IN (${duplicateIds.map(() => '?').join(',')})`,
        [actorId, ...duplicateIds]
      );
    }
    return {
      saved: true,
      rule: { ...existing, id: existing.id, merchant_pattern: merchant, category, ownership_scope: scope, application_mode: 'AUTO_APPLY' },
      merchant,
      deduplicated_rules: duplicateIds.length
    };
  }

  const ruleUid = `RULE-${Date.now().toString(36).toUpperCase()}-${require('node:crypto').randomBytes(4).toString('hex').toUpperCase()}`;
  const [insert] = await db.query(
    `INSERT INTO finance_category_rules
       (rule_uid,merchant_pattern,category,ownership_scope,priority,enabled,application_mode,created_by,updated_by,last_used_at)
     VALUES (?,?,?,?,500,1,'AUTO_APPLY',?,?,NOW())`,
    [ruleUid, merchant, category, scope, actorId, actorId]
  );
  return { saved: true, rule: { id: insert.insertId, rule_uid: ruleUid, merchant_pattern: merchant, category, ownership_scope: scope, application_mode: 'AUTO_APPLY' }, merchant };
}

async function periodAllowsClassification(db, transactionDate) {
  const effectiveDate = dateOnly(transactionDate);
  if (!effectiveDate) return false;
  const [[period]] = await db.query(
    `SELECT ap.status, fy.status AS financial_year_status
       FROM accounting_periods ap
       JOIN financial_years fy ON fy.id=ap.financial_year_id
      WHERE ? BETWEEN ap.start_date AND ap.end_date
      LIMIT 1`,
    [effectiveDate]
  );
  return Boolean(period && period.status !== 'LOCKED' && !['LOCKED', 'ARCHIVED'].includes(String(period.financial_year_status || '').toUpperCase()));
}

async function applyAutoRulesToImport(db, options = {}) {
  const batchUid = String(options.batchUid || '').trim();
  const userId = Number(options.userId || 0);
  if (!batchUid || !userId) return { matched: 0, applied: 0, skipped_period: 0, changes: [] };

  const [rules] = await db.query(
    `SELECT id, merchant_pattern, category, ownership_scope, gst_treatment, tags_json, application_mode
       FROM finance_category_rules
      WHERE created_by=? AND enabled=1 AND application_mode='AUTO_APPLY'
      ORDER BY priority DESC, updated_at DESC, id DESC`,
    [userId]
  );
  if (!rules.length) return { matched: 0, applied: 0, skipped_period: 0, changes: [] };

  const [transactions] = await db.query(
    `SELECT bt.id,bt.transaction_date,bt.description,bt.merchant_name,bt.reference,bt.category,
            bt.ownership_scope,bt.merchant_normalized,bt.tags_json,bt.gst_treatment,
            ba.ownership_scope AS account_scope
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.import_batch_uid=?
      ORDER BY bt.id`,
    [batchUid]
  );

  const result = { matched: 0, applied: 0, skipped_period: 0, changes: [] };
  const periodCache = new Map();
  for (const transaction of transactions) {
    const rule = rules.find((candidate) => exactRuleMatch(transaction, candidate));
    if (!rule) continue;
    result.matched += 1;
    const day = dateOnly(transaction.transaction_date) || '';
    if (!periodCache.has(day)) periodCache.set(day, await periodAllowsClassification(db, day));
    const periodOpen = periodCache.get(day);
    const oldValue = {
      category: transaction.category,
      ownership_scope: transaction.ownership_scope,
      merchant_normalized: transaction.merchant_normalized,
      tags: parseTags(transaction.tags_json),
      gst_treatment: transaction.gst_treatment
    };
    const next = { ...oldValue };
    const accountScope = String(transaction.account_scope || '').toUpperCase();
    const ruleScope = String(rule.ownership_scope || '').toUpperCase();
    const accountCompatible = !ruleScope || ['MIXED', 'UNCLASSIFIED'].includes(accountScope) || accountScope === ruleScope;
    if (accountCompatible) {
      if (rule.category) next.category = rule.category;
      if (ruleScope && ['MIXED', 'UNCLASSIFIED'].includes(accountScope)
        && ['MIXED', 'UNCLASSIFIED'].includes(String(next.ownership_scope || '').toUpperCase())) next.ownership_scope = ruleScope;
      if (!next.merchant_normalized) next.merchant_normalized = cleanMerchant(transaction.merchant_name || transaction.description || transaction.reference || '');
      if ((!next.gst_treatment || next.gst_treatment === 'REVIEW') && rule.gst_treatment) next.gst_treatment = rule.gst_treatment;
      next.tags = normalizeTags([...next.tags, ...parseTags(rule.tags_json)]);
    }
    const changed = JSON.stringify(oldValue) !== JSON.stringify(next);
    let status = 'SUGGESTED';
    if (changed && periodOpen) {
      await db.query(
        `UPDATE bank_transactions
            SET category=?, classification_status=IF(? IS NULL OR ?='',classification_status,'CLASSIFIED'),
                ownership_scope=?, merchant_normalized=?, tags_json=?, gst_treatment=?
          WHERE id=?`,
        [next.category, next.category, next.category, next.ownership_scope, next.merchant_normalized,
          next.tags.length ? JSON.stringify(next.tags) : null, next.gst_treatment, transaction.id]
      );
      result.applied += 1;
      status = 'APPLIED';
      result.changes.push({ transaction_id: transaction.id, rule_id: rule.id, old_value: oldValue, new_value: next });
    } else if (changed) {
      result.skipped_period += 1;
    }
    await db.query(
      `INSERT INTO finance_transaction_rule_matches
       (finance_category_rule_id,bank_transaction_id,match_kind,status,matched_at,applied_at,applied_by)
       VALUES (?,?,'EXACT',?,NOW(),IF(?='APPLIED',NOW(),NULL),IF(?='APPLIED',?,NULL))
       ON DUPLICATE KEY UPDATE match_kind='EXACT',status=IF(status='APPLIED','APPLIED',VALUES(status)),
         matched_at=NOW(),applied_at=COALESCE(applied_at,VALUES(applied_at)),applied_by=COALESCE(applied_by,VALUES(applied_by))`,
      [rule.id, transaction.id, status, status, status, userId]
    );
    await db.query('UPDATE finance_category_rules SET last_used_at=NOW() WHERE id=?', [rule.id]);
  }
  return result;
}

module.exports = {
  RULE_MODES,
  GST_TREATMENTS,
  cleanMerchant,
  normalizeTags,
  parseTags,
  normalizeRuleMode,
  normalizeGstTreatment,
  exactRuleMatch,
  ruleCompatibleWithAccount,
  findExactAutoCategoryRule,
  upsertExactAutoCategoryRule,
  applyAutoRulesToImport
};
