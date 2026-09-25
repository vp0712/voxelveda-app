'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ruleEngine = require('../services/financeRuleEngine');
const intelligence = require('../controllers/financeIntelligenceController')._test;

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

async function testAutoRuleEngine() {
  const updates = [];
  const matches = [];
  const db = {
    async query(sql) {
      if (sql.includes("FROM finance_category_rules") && sql.includes("application_mode='AUTO_APPLY'")) {
        return [[{
          id: 7,
          merchant_pattern: 'OFFICEWORKS',
          category: 'Office Supplies',
          ownership_scope: 'BUSINESS',
          gst_treatment: 'GST_ON_EXPENSES',
          tags_json: JSON.stringify(['office']),
          application_mode: 'AUTO_APPLY'
        }]];
      }
      if (sql.includes('FROM bank_transactions bt') && sql.includes('bt.import_batch_uid')) {
        return [[
          { id: 11, transaction_date: '2026-09-10', description: 'VISA OFFICEWORKS 123456', merchant_name: 'Officeworks', reference: '', category: null, ownership_scope: 'UNCLASSIFIED', merchant_normalized: null, tags_json: null, gst_treatment: null, account_scope: 'MIXED' },
          { id: 12, transaction_date: '2026-09-10', description: 'Officeworks Cafe', merchant_name: 'Officeworks Cafe', reference: '', category: null, ownership_scope: 'UNCLASSIFIED', merchant_normalized: null, tags_json: null, gst_treatment: null, account_scope: 'MIXED' }
        ]];
      }
      if (sql.includes('FROM accounting_periods')) return [[{ status: 'OPEN', financial_year_status: 'OPEN' }]];
      if (sql.startsWith('UPDATE bank_transactions')) { updates.push({ sql, params: arguments[1] }); return [{ affectedRows: 1 }]; }
      if (sql.includes('INSERT INTO finance_transaction_rule_matches')) { matches.push(arguments[1]); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('UPDATE finance_category_rules')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await ruleEngine.applyAutoRulesToImport(db, { batchUid: 'BANK-TEST', userId: 3 });
  assert.equal(result.matched, 1, 'only exact merchant matches may auto apply');
  assert.equal(result.applied, 1, 'exact safe classification should apply in an open period');
  assert.equal(updates.length, 1, 'fuzzy merchant text must not be auto applied');
  assert.match(updates[0].sql, /category=\?/i);
  assert.doesNotMatch(updates[0].sql, /\b(?:debit|credit|description|reference|reconciliation_status|is_internal_transfer)\s*=/i, 'auto rules must not mutate source money or workflow fields');
  assert.equal(matches.length, 1, 'rule match evidence must be persisted once');
}

async function main() {
  assert.equal(ruleEngine.cleanMerchant('VISA Officeworks 123456'), 'OFFICEWORKS');
  assert.deepEqual(ruleEngine.normalizeTags([' office ', 'office', 'gst']), ['office', 'gst']);
  assert.throws(() => ruleEngine.normalizeRuleMode('UNSAFE'), /Suggest Only or Auto Apply/);

  const changes = intelligence.normalizeBulkChanges({ category: 'Fuel', tags: ['vehicle'], reviewed: true });
  assert.deepEqual(changes, { category: 'Fuel', tags: ['vehicle'], reviewed: true });
  const delta = intelligence.bulkRowChanges({ category: null, tags_json: null, reviewed_at: null }, changes);
  assert.deepEqual(Object.keys(delta), ['category', 'tags', 'reviewed']);
  assert.throws(() => intelligence.normalizeBulkChanges({}), /at least one bulk review change/i);

  await testAutoRuleEngine();

  const migration = read('migrations/20260923_finance_review_rules_v2.sql');
  const routes = read('routes/financeRoutes.js');
  const bulkController = read('controllers/financeIntelligenceController.js');
  const rulesController = read('controllers/financeTransactionIntelligenceController.js');
  const statementController = read('controllers/statementImportController.js');
  const client = read('public/finance-master.js');

  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/i, 'migration must be additive');
  assert.match(migration, /finance_transaction_rule_matches/i);
  assert.match(routes, /transactions\/bulk\/review/);
  assert.match(bulkController, /BULK_REVIEW_ACCESS_MISMATCH/);
  assert.match(bulkController, /BULK_REVIEW_PREVIEW_STALE/);
  assert.match(bulkController, /assertClassificationPeriodsOpen/);
  assert.match(rulesController, /application_mode/);
  assert.match(statementController, /applyAutoRulesToImport/);
  assert.match(bulkController, /resolveTransactionCategory/);
  assert.match(bulkController, /move_whole_transaction/);
  assert.match(bulkController, /DELETE FROM bank_transaction_splits WHERE parent_bank_transaction_id/);
  assert.match(bulkController, /upsertExactAutoCategoryRule/);
  assert.match(bulkController, /MANUAL_CATEGORY_MOVE/);
  assert.equal(typeof ruleEngine.findExactAutoCategoryRule, 'function');
  assert.equal(typeof ruleEngine.upsertExactAutoCategoryRule, 'function');
  assert.equal(typeof ruleEngine.ruleCompatibleWithAccount, 'function');
  assert.equal(ruleEngine.ruleCompatibleWithAccount({ ownership_scope:'BUSINESS', category_scope:'BUSINESS' }, 'BUSINESS'), true);
  assert.equal(ruleEngine.ruleCompatibleWithAccount({ ownership_scope:'BUSINESS', category_scope:'BUSINESS' }, 'PERSONAL'), false);
  assert.match(read('services/financeRuleEngine.js'), /normalizedMatches/);
  assert.match(read('services/financeRuleEngine.js'), /deduplicated_rules/);
  assert.match(rulesController, /applyRuleHistory/);
  assert.match(rulesController, /AUTO_RULE_HISTORY/);
  assert.match(rulesController, /skipped_manual/);
  assert.match(rulesController, /skipped_splits/);
  assert.match(rulesController, /skipped_locked_or_unconfigured/);
  assert.match(rulesController, /FINANCE_RULE_HISTORY_PREVIEW_STALE/);
  assert.match(routes, /rules\/:id\/apply-history/);
  assert.match(client, /function applyLearnedRuleToHistory\(/);
  assert.match(client, /historical exact-merchant match/);


  assert.match(client, /Preview changes/);
  assert.match(client, /Confirm & apply/);
  assert.match(client, /Auto Apply exact matches/);

  console.log('Finance bulk review and Rules 2.0 checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
