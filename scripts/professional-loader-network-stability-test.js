'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('public/global-brand.css');
const js = read('public/global-brand.js');
const renderer = read('services/globalBrandRenderer.js');

assert.match(css, /\.vv-brand-loader-logo\{[^}]*width:62%/i);
assert.match(css, /\.vv-brand-loader-logo-wrap\{[^}]*border-radius:50%/i);
assert.match(css, /\.vv-brand-loader-ring\{[^}]*animation:vvBrandSpin/i);
assert.match(renderer, /Preparing your workspace/);
assert.doesNotMatch(renderer, /vvGlobalBrandLoader" class="is-visible"/);
assert.doesNotMatch(js, /location\.reload\s*\(/);
assert.doesNotMatch(js, /window\.fetch\s*=/);
assert.doesNotMatch(js, /XMLHttpRequest\.prototype\.send\s*=/);
assert.match(js, /voxelveda:network-restored/);
assert.match(js, /INITIAL_DELAY_MS = 260/);
assert.match(js, /MIN_VISIBLE_MS = 700/);

console.log('Professional loader and network stability checks passed.');
