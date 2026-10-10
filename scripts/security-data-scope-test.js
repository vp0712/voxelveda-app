'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scope = require('../services/securityDataScope');

function isolated(file, dependencies) {
  const filename = path.join(__dirname, '..', file);
  const module = { exports: {} };
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({
    module, exports: module.exports, Date, Number, Math, process,
    require(name) {
      assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    }
  });
  return module.exports;
}

async function run() {
  assert.throws(() => scope.retainedEventScope('se; DELETE'), /Invalid security scope alias/);
  for (const name of ['BANK_DETAILS_CHANGED', 'PAYMENT_APPROVED', 'SENSITIVE_EXPORT']) {
    assert(!scope.RETAINED_EVENT_TYPES.includes(name));
    assert(!scope.RETAINED_HIGH_RISK_EVENTS.includes(name));
  }
  for (const name of ['finance', 'banking', 'rfq', 'invoice', 'payroll', 'inventory']) {
    assert(!scope.RETAINED_AUDIT_MODULES.includes(name));
  }
  const eventScope = scope.retainedEventScope('se');
  assert.match(eventScope.sql, /JSON_EXTRACT\(se.metadata_json, '\$\.module'\)/);
  assert.match(eventScope.sql, /JSON_EXTRACT\(se.metadata_json, '\$\.scope'\)/);
  assert.equal((eventScope.sql.match(/\?/g) || []).length, eventScope.params.length);
  const fixtures = {
    audit: [{ id: 4, module: 'profile' }, { id: 3, module: 'finance' }, { id: 2, module: 'rfq' }, { id: 1, module: 'security' }],
    events: [{ id: 5, event_type: 'LOGIN_SUCCESS', metadata_json: {} }, { id: 4, event_type: 'BANK_DETAILS_CHANGED', metadata_json: {} }, { id: 3, event_type: 'SENSITIVE_DOCUMENT_VIEWED', metadata_json: { module: 'finance' } }, { id: 2, event_type: 'SECURITY_REPORT_EXPORTED', metadata_json: { export_type: 'SECURITY_REPORT' } }, { id: 1, event_type: 'LOGIN_FAILURE', metadata_json: { scope: 'RFQ' } }]
  };
  const initialFixtures = JSON.stringify(fixtures);
  const queries = [];
  const db = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (/FROM (?:audit_logs al|security_events se)/.test(sql)) {
      const audit = /audit_logs al/.test(sql);
      const boundary = audit ? scope.retainedAuditScope('al') : scope.retainedEventScope('se');
      assert(sql.includes(boundary.sql), 'listing and count must enforce the same server scope before pagination');
      assert.deepEqual(Array.from(params).slice(0, boundary.params.length), boundary.params);
      let records = fixtures[audit ? 'audit' : 'events'].filter((row) => audit
        ? scope.RETAINED_AUDIT_MODULES.includes(row.module)
        : scope.RETAINED_EVENT_TYPES.includes(row.event_type) && !['finance', 'RFQ'].includes(row.metadata_json.module || row.metadata_json.scope));
      if (/al.module = \?|se.event_type = \?/.test(sql)) records = records.filter((row) => (audit ? row.module : row.event_type) === params[boundary.params.length]);
      return /COUNT\(\*\)/.test(sql) ? [[{ total: records.length }]] : [records.slice(params.at(-1), params.at(-1) + params.at(-2))];
    }
    assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/i, 'read-only security views must not rewrite archived data');
    if (/FROM secure_documents/.test(sql)) assert.match(sql, /LOWER\(module\) IN \('profile','security'\)/);
    if (/FROM audit_logs/.test(sql)) assert(sql.includes(scope.retainedAuditScope().sql));
    if (/FROM security_events/.test(sql)) assert(sql.includes(scope.retainedEventScope().sql));
    if (/GROUP BY event_type/.test(sql)) return [[{ event_type: 'LOGIN_SUCCESS', result: 'SUCCESS', count: 1 }]];
    if (/GROUP BY action, module/.test(sql)) return [[{ action: 'PROFILE_UPDATED', module: 'profile', count: 1 }]];
    if (/GROUP BY severity, status/.test(sql)) return [[{ severity: 'LOW', status: 'OPEN', count: 1 }]];
    if (/SUM\(mfa_enabled/.test(sql)) return [[{ total: 2, enabled: 2, mfa_enabled: 2 }]];
    return [[{ count: 1 }]];
  } };
  const ensure = async () => {};
  const controller = isolated('controllers/securityDashboardController.js', {
    '../config/db': db,
    '../services/securitySchema': { ensureSecuritySchema: ensure },
    '../services/securityOperationsSchema': { ensureSecurityOperationsSchema: ensure },
    '../services/coreAuditSchema': { ensureCoreAuditSchema: ensure },
    '../services/operationalTrustSchema': { ensureOperationalTrustSchema: ensure },
    '../services/securityGovernanceSchema': { ensureSecurityGovernanceSchema: ensure },
    '../utils/securityRedaction': { redactSensitive: (value) => value },
    '../services/runtimeState': { CONTROL_STATES: { OPERATIONAL: 'OPERATIONAL', EXTERNALLY_VERIFIED: 'VERIFIED' }, controlSnapshot: () => ({ malware_scanner: { state: 'OPERATIONAL' } }) },
    '../services/securityDataScope': scope
  });
  async function call(handler, query) {
    let output;
    await handler({ query }, { json(value) { output = value; } }, (error) => { throw error; });
    assert(output);
    return output;
  }
  for (const [handler, key] of [[controller.audit, 'logs'], [controller.events, 'events']]) {
    const first = await call(handler, { page: '1', limit: '10' });
    assert.equal(first.total, 2);
    assert.equal(first[key].length, 2);
    const next = await call(handler, { page: '2', limit: '10' });
    assert.equal(next.total, 2, 'pagination must count only visible retained entries');
    assert.equal(next[key].length, 0);
  }
  const retiredAudit = await call(controller.audit, { module: 'finance' });
  const retiredEvents = await call(controller.events, { event_type: 'BANK_DETAILS_CHANGED' });
  assert.equal(retiredAudit.total, 0);
  assert.equal(retiredAudit.logs.length, 0);
  assert.equal(retiredEvents.total, 0);
  assert.equal(retiredEvents.events.length, 0);
  const dashboard = await call(controller.dashboard, {});
  assert.equal(dashboard.metrics.active_users, 1);
  assert.equal(dashboard.metrics.mfa_coverage, 100);
  assert.equal(dashboard.metrics.high_risk_actions_24h, 1, 'all parallel query results must be retained');
  const reportService = isolated('services/securityReportService.js', {
    crypto: require('node:crypto'), '../config/db': db,
    './securityOperationsSchema': { ensureSecurityOperationsSchema: ensure }, './securityDataScope': scope
  });
  const report = await reportService.buildSecurityReport({ start: new Date('2026-10-01'), end: new Date('2026-10-08') });
  assert.equal(report.identity.privileged_users, 2);
  assert.equal(report.security_events[0].event_type, 'LOGIN_SUCCESS');
  assert.equal(report.audit_summary[0].module, 'profile');
  assert.equal(report.risk.high_risk_actions, 1);
  assert.equal(JSON.stringify(fixtures), initialFixtures, 'archived fixtures and audit chain must remain unchanged');
  console.log('Security data scope tests passed: retained-only audit/event pagination, document counts, dashboard/report query aggregation, and archive immutability.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
