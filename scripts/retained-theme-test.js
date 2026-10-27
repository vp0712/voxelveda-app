'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { injectGlobalBrand, WORKSPACE_CSS, BUSINESS_HUB_CSS } = require('../services/globalBrandRenderer');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('public/workspace-theme.css');

// A new palette must retain usable text, status and control contrast in both modes.
function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
const blocks = [css.slice(css.indexOf(':root {'), css.indexOf(':root[data-color-mode')), css.slice(css.indexOf(':root[data-color-mode'), css.indexOf('html {'))];
const base = {};
for (const [index, block] of blocks.entries()) {
  const tokens = { ...base };
  for (const match of block.matchAll(/--([\w-]+):\s*#([a-f\d]{6})/gi)) tokens[match[1]] = match[2];
  if (!index) Object.assign(base, tokens);
  for (const [foreground, background] of [['text-primary','surface'], ['text-secondary','surface'], ['text-secondary','page'], ['text-secondary','surface-muted'], ['on-primary','primary'], ['on-primary','primary-hover'], ['nav-text','nav'], ['success','success-bg'], ['danger','danger-bg'], ['warning','warning-bg']]) {
    assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${index ? 'dark' : 'light'} ${foreground}/${background} must meet normal-text contrast`);
  }
  assert.ok(contrast(tokens['control-border'], tokens.surface) >= 3, 'Form boundaries must be visible against the form surface');
}
assert.equal(base.page.toUpperCase(), 'F7F8FA', 'Default app canvas uses the requested light neutral palette');
assert.equal(base.surface.toUpperCase(), 'FFFFFF', 'Document and account panels stay clean white');
assert.equal(base['text-primary'].toUpperCase(), '152544', 'Headings use deep navy');
assert.equal(base['text-secondary'].toUpperCase(), '526177', 'Secondary body text uses slate');
assert.equal(base.primary.toUpperCase(), '2454D6', 'Primary actions use royal blue');
assert.match(css, /\[hidden\].*display:\s*none\s*!important/, 'Appearance changes must preserve hidden permission controls');

// Brand injection must not multiply stale styles or rewrite permission attributes.
for (const file of ['login.html', 'register.html', 'profile.html', 'privacy-policy.html', 'index.html', 'workspace.html', 'security.html', 'mfa.html']) {
  const rendered = injectGlobalBrand(read('public/' + file));
  assert.ok(rendered.includes('data-vv-theme="navy-blue"'), `${file} uses the requested navy/blue presentation`);
  assert.ok(rendered.includes(`href="${WORKSPACE_CSS}"`), `${file} receives the current palette`);
  assert.equal((rendered.match(/href=["']\/workspace-theme\.css(?:\?[^"']*)?["']/g) || []).length, 1, `${file} has one shared palette`);
  assert.ok(rendered.includes(`href="${BUSINESS_HUB_CSS}"`), `${file} receives the shared Business Hub presentation`);
  assert.equal((rendered.match(/href=["']\/business-hub\.css(?:\?[^"']*)?["']/g) || []).length, 1, `${file} has one shared Business Hub stylesheet`);
  assert.equal(injectGlobalBrand(rendered), rendered, `${file} injection stays idempotent`);
  assert.ok(!rendered.includes('/workspace-shell.js'), `${file} does not load the retired navigation`);
}
// Use the actual retained page renderer across portal families. The shared
// stylesheet must load after page-specific styles, without changing permission
// attributes or introducing another navigation/portal application.
for (const file of ['admin-dashboard.html','staff-dashboard.html','client-portal.html','quality.html','shop-floor.html']) {
  const original = read('public/' + file);
  const rendered = injectGlobalBrand(original);
  const links = [...rendered.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)];
  assert.ok(links.at(-1)[0].includes(BUSINESS_HUB_CSS), `${file} uses the current shared presentation last`);
  assert.equal(injectGlobalBrand(rendered), rendered, `${file} shared presentation is idempotent`);
  assert.deepEqual([...rendered.matchAll(/data-permission="([^"]*)"/g)].map(x=>x[1]), [...original.matchAll(/data-permission="([^"]*)"/g)].map(x=>x[1]), `${file} retains its actual permission controls`);
}
const hubCss = read('public/business-hub.css');
const darkHub = hubCss.slice(hubCss.indexOf(':root[data-color-mode="dark"]'), hubCss.indexOf('body[data-vv-theme'));
const hubTokens = {};
for (const match of darkHub.matchAll(/--([\w-]+):\s*#([a-f\d]{6})/gi)) hubTokens[match[1]]=match[2];
for (const background of ['page','surface','surface-muted']) {
  assert.ok(contrast(hubTokens['text-primary'],hubTokens[background])>=4.5, `Hub dark primary text on ${background}`);
  assert.ok(contrast(hubTokens['text-secondary'],hubTokens[background])>=4.5, `Hub dark supporting text on ${background}`);
}
assert.ok(contrast(hubTokens['control-border'],hubTokens.surface)>=3, 'Hub dark form boundaries remain visible');
assert.ok(contrast('DCEAFF','203B66')>=4.5, 'Selected navigation remains readable');
const hiddenFixture = '<html><head></head><body data-vv-role="viewer"><button hidden class="hidden-section">Restricted</button><img src="/Frame 1.png"></body></html>';
const rendered = injectGlobalBrand(hiddenFixture);
assert.ok(rendered.includes('<button hidden class="hidden-section">Restricted</button>'));
assert.ok(rendered.includes('<img src="/logo.png">'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'public/logo.png'))).digest('hex'), 'ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312', 'The original company artwork remains byte-for-byte unchanged');

// Saved preferences, cross-tab changes and the new browser chrome colour must agree.
const listeners = {};
const documentListeners = {};
const meta = { content:'' };
const toggle = { textContent:'', attributes:{}, hasAttribute(name) { return Object.hasOwn(this.attributes, name); }, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {} };
let stored = 'dark';
const context = {
  localStorage: { getItem() { return stored; }, setItem(key, value) { stored = value; } },
  document: {
    documentElement: { dataset:{} }, querySelector(selector) { return selector.includes('meta') ? meta : null; },
    querySelectorAll() { return [toggle]; }, addEventListener(type, listener) { documentListeners[type] = listener; }
  },
  window: { dispatchEvent() {}, addEventListener(type, listener) { listeners[type] = listener; } },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
};
vm.runInNewContext(read('public/workspace-theme.js'), context);
assert.equal(context.document.documentElement.dataset.colorMode, 'dark');
assert.equal(meta.content, '#101827');
assert.equal(toggle.textContent, 'Light theme');
toggle.setAttribute('data-theme-compact', '');
context.window.VoxelTheme.set('dark');
assert.equal(toggle.textContent, '☀', 'Compact mobile controls retain an accessible theme action');
assert.equal(toggle.attributes['aria-label'], 'Use light theme');
delete toggle.attributes['data-theme-compact'];
context.window.VoxelTheme.set('light');
assert.equal(stored, 'light');
assert.equal(meta.content, '#F7F8FA');
assert.equal(toggle.attributes['aria-label'], 'Use dark theme');
listeners.storage({ key:'voxelveda:color-mode', newValue:'dark' });
assert.equal(context.document.documentElement.dataset.colorMode, 'dark');
for (const name of ['manifest.webmanifest', 'site.webmanifest']) {
  const manifest = JSON.parse(read('public/' + name));
  assert.equal(manifest.background_color, '#' + base.page);
  assert.equal(manifest.theme_color, '#' + base.page);
  assert.ok(!/quote|banking|finance|erp|rfq/i.test(manifest.description));
}
stored = null;
vm.runInNewContext(read('public/workspace-theme.js'), context);
assert.equal(context.document.documentElement.dataset.colorMode, 'light', 'A first visit defaults to the requested light appearance');
context.localStorage.getItem = () => { throw new Error('Browser storage blocked'); };
context.localStorage.setItem = () => { throw new Error('Browser storage blocked'); };
vm.runInNewContext(read('public/workspace-theme.js'), context);
assert.equal(context.document.documentElement.dataset.colorMode, 'light');
context.window.VoxelTheme.set('dark');
assert.equal(context.document.documentElement.dataset.colorMode, 'dark', 'A storage restriction cannot break a theme action');
assert.match(read('public/auth-entry.css'), /font-size:\s*\.75rem/, 'The privacy footer retains its compact size');
assert.match(read('public/auth-entry.css'), /animation:none/, 'Sign in is available immediately instead of being gated by a launch animation');
console.log('RETAINED_THEME_TEST_OK: light/dark contrast, permission-hidden controls, unchanged logo, palette injection and preference state');
