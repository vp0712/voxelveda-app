'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'railway-startup-gateway.js'), 'utf8');

assert.match(source, /PUBLIC_PORT = Number\(process\.env\.PORT \|\| 8080\)/, 'Gateway must bind Railway public PORT');
assert.match(source, /INTERNAL_APP_PORT \|\| 8081/, 'Real app must use a separate internal port');
assert.match(source, /pathname === '\/api\/health'/, 'Gateway must expose immediate liveness');
assert.match(source, /backendFailed \? 503 : 200/, 'Liveness must fail closed after backend failure');
assert.match(source, /path: '\/api\/health'/, 'Gateway backend probe must use the HTTPS-exempt liveness endpoint');
assert.doesNotMatch(source, /path: '\/api\/ready'.*timeout:/s, 'Gateway must not probe /api/ready over internal plaintext HTTP');
assert.match(source, /spawn\(process\.execPath/, 'Gateway must launch the existing server.js process');
assert.match(source, /PORT: String\(INTERNAL_PORT\)/, 'Child must not compete for Railway public port');
assert.match(source, /if \(backendReady\) return proxyRequest/, 'Traffic must proxy only after the real app is reachable');
assert.match(source, /<img src="\/logo\.png" alt="Voxel Veda">/, 'Warmup screen must use the canonical original logo');
assert.match(source, /filter:none!important/, 'Warmup logo must not be visually filtered');
assert.match(source, /animation:none!important/, 'Warmup logo itself must not animate');
assert.doesNotMatch(source, /location\.reload\(/, 'Warmup page must not hard-reload on a timer');
assert.match(source, /backend_ready===true/, 'Warmup page must transition only after backend readiness is confirmed');
assert.match(source, /location\.replace\(location\.href\)/, 'Warmup page may navigate once after backend becomes ready');
assert.match(source, /process\.on\('SIGTERM'/, 'Gateway must forward graceful Railway shutdown');

const logo = fs.readFileSync(path.join(root, 'public', 'logo.png'));
assert.ok(logo.length > 1000, 'Canonical logo asset must exist and be non-empty');

console.log('Railway startup gateway checks passed.');

// Inspect the actual returned warmup document, then execute its retry/navigation
// script with controlled responses. No backend process or network is started.
const vm = require('node:vm');
const functionStart = source.indexOf('function warmupHtml()');
const functionEnd = source.indexOf('\nfunction serveLogo', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart);
const warmup = vm.runInNewContext(source.slice(functionStart, functionEnd) + '\nwarmupHtml()');
const mainStyle = warmup.match(/html,body\{([^}]+)\}/)[1];
const messageStyle = warmup.match(/\.txt\{([^}]+)\}/)[1];
const colour = (style, field) => {
  const match = style.match(new RegExp('(?:^|;)' + field + ':#([a-f0-9]{6})(?:;|$)', 'i'));
  assert.ok(match, `Warmup ${field} has an explicit six-digit colour`);
  return match[1];
};
function brightness(hex) {
  const c = hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
const background = colour(mainStyle, 'background');
for (const foreground of [colour(mainStyle, 'color'), colour(messageStyle, 'color')]) {
  const pair = [brightness(foreground), brightness(background)].sort((a,b)=>b-a);
  assert.ok((pair[0]+.05)/(pair[1]+.05) >= 4.5, 'Warmup headings and message meet normal-text contrast');
}
assert.match(warmup, /<meta name="theme-color" content="#F7F8FA">/);
assert.equal(background.toUpperCase(), 'F7F8FA');
const inlineScript = warmup.match(/<script>([\s\S]*?)<\/script>/)[1];
(async () => {
  const timers = [];
  const navigations = [];
  let readiness = false;
  const runtime = {
    fetch:async () => ({ json:async () => ({ backend_ready:readiness }) }),
    location:{ href:'https://app.voxelveda.com/profile', replace(value) { navigations.push(value); } },
    setTimeout(callback, delay) { timers.push({ callback, delay }); }
  };
  vm.runInNewContext(inlineScript, runtime);
  assert.equal(timers[0].delay, 700);
  await timers.shift().callback();
  assert.equal(navigations.length, 0, 'Warmup cannot navigate while the backend is unavailable');
  assert.equal(timers[0].delay, 1200);
  readiness = true;
  await timers.shift().callback();
  assert.deepEqual(navigations, ['https://app.voxelveda.com/profile'], 'Readiness returns to the same requested page exactly once');
  assert.equal(timers.length, 0, 'A ready backend ends polling');
  console.log('Gateway document contrast and controlled readiness navigation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
