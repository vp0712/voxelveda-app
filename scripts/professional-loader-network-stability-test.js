'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('public/global-brand.css');
const js = read('public/global-brand.js');
const renderer = read('services/globalBrandRenderer.js');

assert.match(css, /\.vv-brand-loader-logo\{[^}]*width:100%/i);
assert.match(css, /\.vv-brand-loader-logo-stage\{[^}]*overflow:hidden/i);
assert.match(css, /\.vv-brand-orbit-ring-one\{[^}]*animation:vvBrandOrbitOne/i);
assert.match(css, /\.vv-brand-scan-line\{[^}]*animation:vvBrandScan/i);
assert.match(renderer, /Preparing your workspace|Loading securely/);
assert.match(renderer, /vv-brand-loader-pill/);
assert.doesNotMatch(renderer, /vvGlobalBrandLoader" class="is-visible"/);
assert.doesNotMatch(js, /location\.reload\s*\(/);
assert.match(js, /window\.fetch = function voxelVedaTrackedFetch/);
assert.match(js, /NativeXHR\.prototype\.send/);
assert.match(js, /voxelveda:network-restored/);
assert.match(js, /API_DELAY_MS = 520/);
assert.match(js, /MIN_VISIBLE_MS = 520/);
assert.match(js, /FAIL_SAFE_MS = 30000/);
assert.match(js, /api\\\/health\|api\\\/ready|api\\\/health/);
assert.match(js, /notifications/);
assert.match(js, /if \(!navigator\.onLine\)/);
assert.match(js, /if \(verb === 'GET'\)/, 'ordinary GET requests must have explicit quiet-loader handling');
assert.match(js, /statement-reviews\\\/\[\^\/\]\+\\\/report|reports\\\/spending/, 'only long report-style GETs may use the full-screen loader');
assert.match(js, /wasOffline = !navigator\.onLine/, 'network restore must track a genuine offline transition');
assert.match(js, /offlineDuration >= 1500/, 'network restore should ignore brief connectivity flaps');
assert.match(js, /2200/, 'network restore should wait for stable connectivity before emitting restoration');
assert.doesNotMatch(js, /Back online\. Updating in the background/, 'network recovery should not imply an automatic reload');
assert.doesNotMatch(js, /window\.location\.reload|location\.reload/, 'network recovery must never hard-refresh the page');

console.log('Professional loader and network stability checks passed.');
