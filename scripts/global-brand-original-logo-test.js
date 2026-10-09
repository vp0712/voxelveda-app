'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { injectGlobalBrand, CANONICAL_LOGO, BRAND_CSS, BRAND_JS } = require('../services/globalBrandRenderer');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

assert.equal(CANONICAL_LOGO, '/logo.png', 'Canonical brand source must stay /logo.png');

const original = fs.readFileSync(path.join(root, 'public', 'logo.png'));
for (const alias of ['voxel-veda-logo.png', 'Frame 1.png', 'og-image.png']) {
  assert.deepEqual(fs.readFileSync(path.join(root, 'public', alias)), original, `${alias} must remain byte-identical to logo.png`);
}

const sample = '<!doctype html><html><head><title>x</title></head><body><img src="/voxel-veda-logo.png"><main>OK</main></body></html>';
const once = injectGlobalBrand(sample);
const twice = injectGlobalBrand(once);
assert(once.includes(BRAND_CSS), 'Every rendered page receives the current brand stylesheet');
assert(once.includes(BRAND_JS), 'Every rendered page receives the current brand controller');
assert.match(once, /id="vvGlobalBrandLoader"/);
assert.match(once, /id="vvGlobalBrandPresence"/);
assert.match(once, /class="vv-brand-loader-logo" src="\/logo\.png"/);
assert.match(once, /vv-brand-orbit-ring-one/);
assert.match(once, /vv-brand-loader-pill/);
assert.doesNotMatch(once, /id="vvGlobalBrandLoader" class="is-visible"/, 'Loader visibility must remain a client runtime decision');
assert.doesNotMatch(once, /voxel-veda-logo\.png/);
assert.equal((twice.match(/id="vvGlobalBrandLoader"/g) || []).length, 1, 'Loader must be injected once');
assert.equal((twice.match(/global-brand\.css/g) || []).length, 1, 'Brand CSS must be injected once');
assert.equal((twice.match(/global-brand\.js/g) || []).length, 1, 'Brand JS must be injected once');

const css = read('public/global-brand.css');
assert.match(css, /#vvGlobalBrandPresence\s*\{\s*display:\s*none\s*!important;/, 'The duplicate corner badge must never obscure primary navigation');
assert.match(css, /\.vv-brand-loader-logo\s*\{[^}]*filter:\s*none\s*!important/i, 'Original logo must not receive visual filters');
assert.match(css, /\.vv-brand-loader-logo\s*\{[^}]*animation:\s*none\s*!important/i, 'Original logo artwork itself must not animate');
assert.match(css, /\.vv-brand-loader-dot\s*\{[^}]*animation:\s*vvBrandPulse/i, 'Loading feedback must animate independently of the logo');
assert.match(css, /prefers-reduced-motion:\s*reduce/, 'Loading feedback must respect reduced motion');
assert.match(css, /--vv-brand-overlay-bg:/i, 'Loader background must follow an explicit theme token');

const client = read('public/global-brand.js');
assert.match(client, /FAIL_SAFE_MS = 30000/, 'Loader must include a fail-safe timeout');
assert.match(client, /API_DELAY_MS = 520/, 'Slow API loading must be delayed to avoid flashing on fast requests');
assert.match(client, /VoxelVedaBrandLoader|pageshow/);
assert.match(client, /addEventListener\('offline'/);
assert.match(client, /addEventListener\('online'/);
assert.match(client, /voxelveda:network-restored/);
assert.match(client, /window\.fetch = function voxelVedaTrackedFetch/, 'Slow foreground fetches must use the common brand loader');
assert.match(client, /NativeXHR\.prototype\.send/, 'Slow foreground XHR must use the common brand loader');
assert.match(client, /api\\\/health\|api\\\/ready|api\\\/health/, 'Health/readiness polling must remain excluded from blocking loader work');
assert.match(client, /notifications/, 'Background notification traffic must remain excluded from blocking loader work');
assert.doesNotMatch(client, /location\.reload\s*\(/, 'Network reconnect must never hard reload the app');

const app = read('app.js');
assert.match(app, /injectGlobalBrand/);
assert.match(app, /global-brand\.css/);
assert.match(app, /global-brand\.js/);
assert.match(app, /for\(const status of \[401,403,404,429,500\]\)/, 'All error statuses must use the shared renderer');
assert.match(app, /sendPage\(status\+'\.html',status\)/);
assert.match(app, /sendPage\('maintenance\.html',503\)/);
assert.match(app, /sendPage\('404\.html',404\)\(req,res\)/);
assert.match(app, /sendPage\('workspace\.html'\)/, 'Retained customer workspace must use the shared page branding');

console.log('Global original-logo branding and network-stability checks passed.');
