'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { injectGlobalBrand } = require('../services/globalBrandRenderer');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/workspace-theme.css'), 'utf8');

for (const file of ['admin-dashboard.html', 'staff-dashboard.html', 'finance-intelligence.html', 'client-portal.html', 'visitor-portal.html', 'login.html', 'profile.html', 'quality.html', 'shop-floor.html', 'security.html']) {
  const rendered = injectGlobalBrand(fs.readFileSync(path.join(root, 'public', file), 'utf8'));
  assert.match(rendered, /<body[^>]+data-vv-theme="sapphire"/i, `${file} receives the shared theme`);
  assert.match(rendered, /workspace-theme\.css\?v=20261006-unified-sapphire/, `${file} receives the current stylesheet`);
  assert.match(rendered, /<meta name="theme-color" content="#102850">/, `${file} uses the common mobile chrome colour`);
  assert.equal((rendered.match(/name="theme-color"/g) || []).length, 1, `${file} has one theme colour`);
  assert.equal(injectGlobalBrand(rendered), rendered, `${file} injection is idempotent`);
}
const privatePage = '<html><head></head><body class="staff-portal" data-vv-role="hr"><button hidden class="hidden-section permission-finance">Restricted</button><img src="/logo.png"></body></html>';
const rendered = injectGlobalBrand(privatePage);
assert.match(rendered, /class="staff-portal" data-vv-role="hr" data-vv-theme="sapphire"/);
assert.match(rendered, /<button hidden class="hidden-section permission-finance">Restricted<\/button>/);
assert.match(rendered, /<img src="\/logo.png">/);
assert.match(css, /\.sidebar \.sidebar-nav :is\(\.nav-btn, \.nav-sub-btn, \.nav-group-toggle, a\)/, 'navigation overrides outrank legacy button:not(...) rules');
for (const selector of ['.app-shell > .main', '.role-command-panel', '.staff-mission-hero', '.client-card', '.visitor-card', '.public-panel', '.step-up-panel', '.scan', '.metric', '#recordOutput', '.fm-modal', '.fm-drawer', '.fm-mobile-nav button.active', '.home-kpi-card']) {
  assert.ok(css.includes(selector), `shared appearance covers ${selector}`);
}
assert.match(css, /\[hidden\] \{ display: none !important; \}/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /@media print/);

const master = fs.readFileSync(path.join(root, 'public/finance-master.js'), 'utf8');
const helperStart = master.indexOf('function statementNeedsAttention(');
const helperEnd = master.indexOf('function statementFileRow(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const attention = vm.runInNewContext(master.slice(helperStart, helperEnd) + '\nstatementNeedsAttention');
assert.equal(attention({status:'EXTRACTING', current_stage:'OCR REQUIRED'}), true);
assert.equal(attention({status:'EXTRACTING', last_error_summary:'Invalid date'}), true);
assert.equal(attention({status:'QUEUED', job_error_summary:'Worker failed'}), true);
assert.equal(attention({status:'NEEDS_MAPPING'}), true);
assert.equal(attention({status:'EXTRACTING', current_stage:'PARSING'}), false);
assert.equal(attention({status:'IMPORTED', last_error_summary:'Old recovered error'}), false);
assert.equal(attention({status:'PENDING_REVIEW'}), false);
const statementsStart = master.indexOf('function statements(){');
const statementsEnd = master.indexOf('function removedStatementsSection(){', statementsStart);
const folderFixture = [{status:'EXTRACTING',current_stage:'OCR_REQUIRED'}, {status:'EXTRACTING',last_error_summary:'Invalid date'}, {status:'EXTRACTING',current_stage:'PARSING'}, {status:'IMPORTED'}];
const folderHtml = vm.runInNewContext(master.slice(helperStart, helperEnd) + master.slice(statementsStart, statementsEnd) + '\nstatements()', {
  state:{statementBank:'',statementAccount:'',statementQuery:'',statementStatus:'ALL'},
  statementEntries:()=>folderFixture, statementFolderBody:()=>'', removedStatementsSection:()=>'', resourceError:()=>'', esc:String
});
assert.match(folderHtml, /<b>2<\/b> need attention/);
assert.match(folderHtml, /<b>1<\/b> processing/);
assert.match(folderHtml, /<option value="PROCESSING"/);

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
for (const [foreground, background] of [['172e4d', 'ffffff'], ['526c8a', 'ffffff'], ['d0dff5', '102850'], ['d0dff5', '203e70'], ['ffffff', '2463eb'], ['ffffff', '2458ae'], ['214e94', 'edf3ff']]) {
  const pair = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  assert.ok((pair[0] + .05) / (pair[1] + .05) >= 4.5, `${foreground}/${background} meets normal-text contrast`);
}
console.log('FINANCE_WORKSPACE_THEME_TEST_OK: portal injection, scoped coverage, hidden controls and colour-pair contrast');
