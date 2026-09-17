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
assert.match(source, /path: '\/api\/ready'/, 'Gateway must verify real application readiness');
assert.match(source, /spawn\(process\.execPath/, 'Gateway must launch the existing server.js process');
assert.match(source, /PORT: String\(INTERNAL_PORT\)/, 'Child must not compete for Railway public port');
assert.match(source, /if \(backendReady\) return proxyRequest/, 'Traffic must proxy only after the real app is ready');
assert.match(source, /<img src="\/logo\.png" alt="Voxel Veda">/, 'Warmup screen must use the canonical original logo');
assert.match(source, /filter:none!important/, 'Warmup logo must not be visually filtered');
assert.match(source, /animation:none!important/, 'Warmup logo itself must not animate');
assert.match(source, /Retry-After': '3'/, 'Startup responses must provide a bounded retry hint');
assert.match(source, /process\.on\('SIGTERM'/, 'Gateway must forward graceful Railway shutdown');

const logo = fs.readFileSync(path.join(root, 'public', 'logo.png'));
assert.ok(logo.length > 1000, 'Canonical logo asset must exist and be non-empty');

console.log('Railway startup gateway checks passed.');
