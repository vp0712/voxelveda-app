'use strict';
// Contract tests only; actual visibility, interaction and layout are browser-verified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const window = {};
let start;
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/action-icons.js'), 'utf8'), {
  window, document: { readyState: 'loading', addEventListener(name, handler) { assert.equal(name, 'DOMContentLoaded'); start = handler; } },
  Object, WeakMap, Map, Set, String, encodeURIComponent
});
assert.equal(typeof start, 'function');
const icons = window.VoxelActionIcons;
for (const [label, expected] of [['View invoice', 'view'], ['PDF', 'pdf'], ['Download PDF', 'pdf'], ['Email', 'email'], ['Edit', 'edit'], ['Archive', 'archive'], ['Delete', 'delete'], ['Record payment', 'payment']]) assert.equal(icons.infer(label), expected, label);
for (const label of ['Save', 'Cancel', 'OK', 'Clock out', 'Check in', 'Staff name']) {
  assert.equal(icons.infer(label), null, 'Unmarked form decisions and primary attendance actions retain their label');
}
assert(Object.isFrozen(icons) && Object.isFrozen(icons.names));
const publicDir = path.join(root, 'public');
let registered = 0;
for (const filename of fs.readdirSync(publicDir).filter(name => /\.(?:js|html)$/.test(name))) {
  const content = fs.readFileSync(path.join(publicDir, filename), 'utf8');
  for (const [, name] of content.matchAll(/data-vv-action-icon=["']([a-z-]+)["']/g)) {
    assert(icons.names.includes(name), `${filename}: unknown action icon ${name}`); registered++;
  }
}
for (const filename of ['admin-dashboard.js','invoice-detail.js','staff.js','staff-home.js','weekly-delivery.js','workflow-ui.js','procurement-ui.js','quality.js','client-portal.js','expense-payments.js','shop-floor.js','attendance-display-admin.js','work-categories-admin.js']) {
  assert(/data-vv-action-icon|dataset\.vvActionIcon/.test(fs.readFileSync(path.join(publicDir,filename),'utf8')), filename + ' retains its explicit original-module action mappings');
}
const { injectGlobalBrand } = require('../services/globalBrandRenderer');
const form = '<form><label for="name">Staff name</label><input id="name"><button type="submit">Save</button><button type="button">Cancel</button></form>';
const markup = '<html><head></head><body>' + form + '</body></html>';
const first = injectGlobalBrand(markup), second = injectGlobalBrand(first);
for (const html of [first, second]) {
  assert.equal((html.match(/src="\/action-icons\.js\?/g) || []).length, 1);
  assert.equal((html.match(/href="\/action-icons\.css\?/g) || []).length, 1);
  assert(html.includes(form), 'Shared presentation must not rewrite form labels or decisions');
}
console.log(`Compact action contracts passed: ${registered} explicit semantic mappings, stable accessible decisions and idempotent shared assets. Browser proof validates actual visibility and actions.`);
