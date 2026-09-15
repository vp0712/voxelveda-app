'use strict';

const fs = require('node:fs');
const assert = require('node:assert');

const runtime = fs.readFileSync('services/databaseRuntimeService.js', 'utf8');
const provisioner = fs.readFileSync('scripts/provision-database-app-user.js', 'utf8');
const rateLimit = fs.readFileSync('services/rateLimitService.js', 'utf8');

assert(runtime.includes('SELECT CURRENT_USER() AS current_user'), 'Database runtime must inspect the actual MySQL identity.');
assert(runtime.includes("SHOW GRANTS"), 'Database runtime must inspect active grants.');
assert(runtime.includes("rootIdentity"), 'Database runtime must reject root-like identities.');
assert(runtime.includes('unsafeGlobalGrant'), 'Database runtime must reject unsafe global grants.');
assert(runtime.includes('hasGrantOption'), 'Database runtime must reject GRANT OPTION.');
assert(provisioner.includes('REVOKE ALL PRIVILEGES, GRANT OPTION'), 'Provisioner must clear prior privileges before granting app privileges.');
assert(provisioner.includes('GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES, CREATE VIEW, SHOW VIEW, TRIGGER, EXECUTE'), 'Provisioner must use explicit schema-scoped privileges.');
assert(!provisioner.includes('GRANT ALL PRIVILEGES ON *.*'), 'Provisioner must never grant global all privileges.');
assert(rateLimit.includes("RATE_LIMIT_FAILURE_POLICY") && rateLimit.includes("RATE_LIMIT_STORE_UNAVAILABLE"), 'Redis rate limiter must retain fail-closed production behavior.');

console.log('Production infrastructure hardening regression test passed.');
