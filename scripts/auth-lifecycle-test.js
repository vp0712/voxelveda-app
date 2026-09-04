const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const authController = read('controllers/authController.js');
const loginClient = read('public/login.js');
const session = read('utils/session.js');
const email = read('services/securityEmailService.js');
const schema = read('services/securitySchema.js');

assert(!/res\.json\([\s\S]{0,100}token,/.test(authController), 'login must not return bearer token');
assert(!loginClient.includes("localStorage.setItem('token'"), 'client must not persist auth token');
assert(session.includes("ALLOW_LEGACY_QUERY_TOKENS"), 'legacy query token gate missing');
assert(email.includes("#token="), 'security token must use URL fragment');
assert(!email.includes("queueEmail"), 'raw security token must not enter email queue');
assert(schema.includes('auth_action_tokens'), 'action token schema missing');

console.log('Authentication lifecycle tests passed.');
