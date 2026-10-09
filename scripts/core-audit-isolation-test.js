const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function isolated(relativePath, dependencies) {
  const filename = path.join(__dirname, '..', relativePath);
  const fixture = { exports: {} };
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({
    module: fixture,
    exports: fixture.exports,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency in core audit test: ${name}`);
      return dependencies[name];
    }
  });
  return fixture.exports;
}

async function run() {
  const queries = [];
  const entries = [];
  let failOnce = true;
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (failOnce) {
        failOnce = false;
        throw Object.assign(new Error('Temporary schema connection failure'), { code: 'ER_CONNECTION_LOST' });
      }
      if (/ALTER TABLE audit_logs ADD/.test(sql)) {
        throw Object.assign(new Error('Existing audit column or index'), { code: /INDEX/.test(sql) ? 'ER_DUP_KEYNAME' : 'ER_DUP_FIELDNAME' });
      }
      if (/SELECT GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/SELECT integrity_hash FROM audit_logs/.test(sql)) return [[entries.length ? { integrity_hash: entries.at(-1)[14] } : undefined]];
      if (/INSERT INTO audit_logs/.test(sql)) entries.push([...params]);
      if (/SELECT IS_NULLABLE/.test(sql)) return [[{ IS_NULLABLE: 'YES' }]];
      return [[]];
    }
  };
  const core = isolated('services/coreAuditSchema.js', { '../config/db': db });
  await assert.rejects(core.ensureCoreAuditSchema(), /Temporary schema connection failure/);
  await Promise.all([core.ensureCoreAuditSchema(), core.ensureCoreAuditSchema()]);
  assert.equal(queries.filter(({ sql }) => /CREATE TABLE IF NOT EXISTS audit_logs/.test(sql)).length, 2, 'retry must recover and concurrent initialization must share one attempt');
  const afterInitialization = queries.length;
  await core.ensureCoreAuditSchema();
  assert.equal(queries.length, afterInitialization);

  const governance = isolated('services/securityGovernanceSchema.js', {
    '../config/db': db,
    './coreAuditSchema': core
  });
  const audit = isolated('services/auditService.js', {
    crypto,
    '../utils/securityRedaction': require('../utils/securityRedaction'),
    './securityGovernanceSchema': governance
  });
  const first = await audit.logAudit(db, {
    actorId: 7, action: 'PROFILE_UPDATED', module: 'profile', recordId: '7',
    newValue: { name: 'Customer Example', password: 'private-secret' },
    requestId: 'request-a', sessionId: 'session-a'
  });
  const second = await audit.logAudit(db, {
    actorId: 7, action: 'SESSION_REVOKED', module: 'security', recordId: 'session-a'
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(entries[0][13], null);
  assert.equal(entries[1][13], first, 'audit chain must remain linked after extraction');
  assert.doesNotMatch(JSON.stringify(entries), /private-secret/, 'sensitive audit values must remain redacted');
  assert.equal(entries[0][9], 'request-a');
  assert.equal(entries[0][10], 'session-a');
  assert.equal(entries[0][11], 'SUCCESS');

  const operations = isolated('services/securityOperationsSchema.js', { '../config/db': db });
  await operations.ensureSecurityOperationsSchema();
  for (const { sql, params } of queries) {
    assert.doesNotMatch(sql, /\b(?:weekly_timesheets|timesheet_versions|timesheet_approvals|payroll_ready|supplier_files|expense_files|compliance_files|bank_transactions|bank_accounts)\b/i, 'retained audit/security setup must not initialize or mutate retired records');
    assert.doesNotMatch(sql, /^\s*(?:DELETE FROM|DROP TABLE|TRUNCATE|UPDATE)\b/i, 'schema extraction must preserve existing records');
    assert.equal(params?.includes('FINANCE_ENCRYPTION_KEY') || false, false, 'retired Banking registry entries must not be recreated');
  }
  console.log('Core audit isolation tests passed: schema retry/idempotence, production audit redaction and hash-chain continuity, and no retired-table initialization or mutation.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
