'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'finance-master.js'), 'utf8');
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
  assert.match(source, /const cycle=await loadBase\(\);render\(\);\s*void hydrateSupplementary\(cycle\)/, 'Core Finance must render before supplementary hydration.');
  assert.match(source, /cycle===loadCycle/, 'Stale Finance loads must be prevented from replacing current filter state.');
  assert.doesNotMatch(source, /Loading finance workspace[^]*await hydrateSupplementary/, 'Initial loading markup must not wait for supplementary services.');

  console.log('Finance bootstrap resilience regression contract passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
