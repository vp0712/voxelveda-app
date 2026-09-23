'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'finance-master.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'finance-intelligence.html'), 'utf8');
const guard = fs.readFileSync(path.join(__dirname, '..', 'public', 'finance-bootstrap-guard.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const apiStart = source.indexOf('async function api(');
const apiEnd = source.indexOf('\nfunction notice(', apiStart);
assert(apiStart >= 0 && apiEnd > apiStart, 'Finance API helper must remain testable.');

const apiSource = source.slice(apiStart, apiEnd);
const createApi = (fetchImpl, timeoutMs = 25) => new Function(
  'fetch',
  'AbortController',
  'setTimeout',
  'clearTimeout',
  `const FINANCE_REQUEST_TIMEOUT_MS=${timeoutMs};${apiSource};return api;`
)(fetchImpl, AbortController, setTimeout, clearTimeout);

async function run() {
  const successfulApi = createApi(async () => ({
    ok: true,
    json: async () => ({ ready: true })
  }));
  assert.deepStrictEqual(await successfulApi('/test'), { ready: true }, 'Successful Finance requests must still return JSON.');

  const hangingApi = createApi((_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }), 20);
  const startedAt = Date.now();
  await assert.rejects(
    () => hangingApi('/never-finishes'),
    (error) => error.code === 'FINANCE_REQUEST_TIMEOUT' && error.status === 408,
    'A hanging Finance request must terminate with a visible timeout error.'
  );
  assert(Date.now() - startedAt < 2000, 'The timeout guard must end a hanging request promptly in the regression test.');

  assert.match(source, /const FINANCE_HYDRATION_BATCH_SIZE=5;/, 'Supplementary Finance APIs must use bounded batches.');
  assert.match(source, /const cycle=await loadBase\(\);render\(\);signalFinanceReady\(\);\s*void hydrateSupplementary\(cycle\)/, 'Core Finance must render and clear the startup watchdog before supplementary hydration.');
  assert.match(source, /cycle===loadCycle/, 'Stale Finance loads must be prevented from replacing current filter state.');
  assert.doesNotMatch(source, /Loading finance workspace[^]*await hydrateSupplementary/, 'Initial loading markup must not wait for supplementary services.');
  assert.doesNotMatch(source, /state\.os=os\|\|null/, 'Core bootstrap must not reference the supplementary os variable before it exists.');
  assert.match(source, /renderFinanceFatal\(error/, 'Refresh and startup paths must render a terminal failure state instead of leaving a spinner.');
  assert.match(source, /render\(\);signalFinanceReady\(\)/, 'Successful core render must signal the independent startup watchdog.');
  assert.match(guard, /WATCHDOG_MS=26000/, 'Independent watchdog timeout must remain bounded.');
  assert.match(guard, /#fmContent \.fm-loading/, 'Watchdog must only replace an actually stuck Finance loader.');
  assert.match(guard, /data-finance-hard-retry/, 'Watchdog failure state must provide a hard reload action.');
  assert(html.indexOf('/finance-bootstrap-guard.js') >= 0, 'Finance page must load the independent startup watchdog.');
  assert(html.indexOf('/finance-bootstrap-guard.js') < html.indexOf('/finance-master.js'), 'Startup watchdog must load before the main Finance bundle.');
  assert(appSource.includes("'finance-bootstrap-guard.js'"), 'Finance startup watchdog must be served no-store so hotfixes are not hidden by cache.');
  assert(!html.includes('<script defer src="https://cdn.jsdelivr.net/npm/pdfjs-dist'), 'Third-party PDF.js must never block Finance document startup.');
  assert.match(source, /function loadPdfJs\(\)/, 'PDF.js must be loaded lazily only when a PDF statement is parsed.');
  assert.match(source, /script\.async=true/, 'Lazy PDF.js loading must not join the ordered deferred startup chain.');
  assert.match(source, /PDF parser timed out/, 'Lazy PDF parser download must have its own bounded timeout.');

  console.log('Finance bootstrap resilience regression contract passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

assert.match(source,/function financeRuntimeHealthCard\(\)/,'Setup Centre must surface Finance runtime health.');
assert.match(source,/function retryFinanceResource\(name\)/,'Failed supplementary Finance services must be retryable individually.');
assert.match(source,/path:path\|\|prior\.path\|\|null/,'Finance resource state must retain the exact retry path.');
assert.match(source,/One failed optional service must never leave the entire Finance OS loading forever/,'Runtime health must state the no-permanent-spinner contract.');
assert.match(source,/data-resource-retry/,'Runtime health failure rows must expose per-service retry controls.');
