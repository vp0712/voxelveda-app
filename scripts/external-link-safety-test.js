'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { externalHttpUrl } = require('../utils/externalHttpUrl');

function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function controller(file, db) {
  const fixture = { exports: {} }, filename = path.join(__dirname, '..', file);
  const dependencies = { '../config/db': db, '../services/originalRegisterSchema': { assertOriginalRegisterSchema: async () => {} }, '../utils/externalHttpUrl': { externalHttpUrl }, '../services/documentPdfService': {}, '../services/sessionService': {}, '../services/documentSecurityService': {}, fs: require('node:fs'), path: require('node:path') };
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({ module: fixture, exports: fixture.exports, process: { env: {} }, console: { error() {} },
    require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error('Unexpected link fixture dependency: ' + name); } });
  return fixture.exports;
}
async function run() {
  assert.equal(externalHttpUrl('', 'website'), '');
  assert.equal(externalHttpUrl(' https://Example.com/report?q=confirmed ', 'website'), 'https://example.com/report?q=confirmed');
  assert.equal(externalHttpUrl('http://example.invalid/reference', 'official_link'), 'http://example.invalid/reference');
  for (const value of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','vbscript:msgbox(1)','file:///etc/passwd','//example.com/reference','https://user:secret@example.com/','https://example.com/\r\nLocation:javascript:alert(1)', [], 'https://example.com/'+'x'.repeat(2048)]) {
    assert.throws(() => externalHttpUrl(value, 'official_link'), error => error.statusCode === 400 && Boolean(error.fields.official_link));
  }
  const queries = [], db = { async query(sql, params) { queries.push({ sql, params }); return [{ insertId: 12, affectedRows: 1 }]; } };
  const competitor = controller('controllers/competitorController.js', db), compliance = controller('controllers/complianceController.js', db);
  for (const [handler, field, body] of [
    [competitor.saveCompetitor, 'website', { company_name: 'Verified competitor', website: 'javascript:alert(1)' }],
    [competitor.saveCompetitor, 'source_url', { company_name: 'Verified competitor', source_url: 'data:text/html,unsafe' }],
    [compliance.saveComplianceEntry, 'official_link', { category: 'Original compliance', title: 'Verified guidance', official_link: 'javascript:alert(1)' }]
  ]) {
    const res = response(); await handler({ body, user: { id: 99 } }, res); assert.equal(res.statusCode, 400); assert(res.body.fields[field]);
  }
  assert.equal(queries.length, 0, 'invalid executable links must be rejected before schema initialization or writes');
  let res = response(); const injectionText = "https://example.invalid/');window.__storedXss=1;//";
  await competitor.saveCompetitor({ body: { company_name: '<untrusted title>', website: injectionText, source_url: 'https://example.invalid/source' }, user: { id: 99 } }, res);
  assert.equal(res.statusCode, 200);
  const insert = queries.find(query => /INSERT INTO competitors/.test(query.sql)); assert(insert); assert(!insert.sql.includes(injectionText), 'link text must stay in SQL parameters');
  assert.equal(insert.params[4], externalHttpUrl(injectionText, 'website'));
  res = response(); await compliance.saveComplianceEntry({ body: { category: 'Original compliance', title: 'Verified guidance', official_link: 'https://example.invalid/guidance' }, user: { id: 99 } }, res); assert.equal(res.statusCode, 200);
  console.log('External business link safety tests passed: executable protocols/credentials blocked, field-specific validation, original HTTP(S) links retained as parameterized data.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
