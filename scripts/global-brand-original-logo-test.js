'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { injectGlobalBrand, CANONICAL_LOGO } = require('../services/globalBrandRenderer');

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
assert.match(once, /\/global-brand\.css\?v=20260917/);
assert.match(once, /\/global-brand\.js\?v=20260917/);
assert.match(once, /id="vvGlobalBrandLoader"/);
assert.match(once, /id="vvGlobalBrandPresence"/);
assert.match(once, /class="vv-brand-loader-logo" src="\/logo\.png"/);
assert.match(once, /Preparing your workspace/);
assert.doesNotMatch(once, /id="vvGlobalBrandLoader" class="is-visible"/, 'Loader must not flash before the delayed client decision');
assert.doesNotMatch(once, /voxel-veda-logo\.png/);
assert.equal((twice.match(/id="vvGlobalBrandLoader"/g) || []).length, 1, 'Loader must be injected once');
assert.equal((twice.match(/global-brand\.css/g) || []).length, 1, 'Brand CSS must be injected once');
assert.equal((twice.match(/global-brand\.js/g) || []).length, 1, 'Brand JS must be injected once');

const css = read('public/global-brand.css');
assert.match(css, /\.vv-brand-loader-logo\{[^}]*filter:none!important/i, 'Original logo must not receive visual filters');
assert.match(css, /\.vv-brand-loader-logo\{[^}]*animation:none!important/i, 'Original logo artwork itself must not animate');
assert.match(css, /\.vv-brand-loader-ring\{[^}]*animation:vvBrandSpin/i, 'Loading motion must live outside the logo artwork');
assert.match(css, /\.vv-brand-loader-logo\{[^}]*width:62%/i, 'Logo must fit safely inside the circular loader without clipping');

const client = read('public/global-brand.js');
assert.match(client, /15000/, 'Loader must include a fail-safe timeout');
assert.match(client, /VoxelVedaBrandLoader|pageshow/);
assert.match(client, /addEventListener\('offline'/);
assert.match(client, /addEventListener\('online'/);
assert.match(client, /voxelveda:network-restored/);
assert.doesNotMatch(client, /location\.reload\s*\(/, 'Network reconnect must never hard reload the app');
assert.doesNotMatch(client, /window\.fetch\s*=/, 'Background fetches must not trigger the full-screen brand loader');
assert.doesNotMatch(client, /XMLHttpRequest\.prototype\.send\s*=/, 'Background XHR must not trigger the full-screen brand loader');

const app = read('app.js');
assert.match(app, /injectGlobalBrand/);
assert.match(app, /global-brand\.css/);
assert.match(app, /global-brand\.js/);
assert.match(app, /sendPage\('401\.html',401\)/);
assert.match(app, /sendPage\('500\.html',500\)/);
assert.match(app, /sendPage\('maintenance\.html',503\)/);
assert.match(app, /sendPage\('404\.html',404\)\(req,res\)/);

const admin = read('services/adminPageRenderer.js');
assert.match(admin, /injectGlobalBrand\(injectRecoveryDrillCenter/);

console.log('Global original-logo branding and network-stability checks passed.');
