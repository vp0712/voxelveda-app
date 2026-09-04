const assert = require('assert');
const { validatePassword } = require('../services/passwordPolicy');

assert.equal(validatePassword('password123', {}).valid, false);
assert.equal(validatePassword('VoxelVeda-Admin-2026!', {}).valid, false);
assert.equal(validatePassword('correct horse battery staple 92', {}).valid, true);
assert.equal(validatePassword('aaaaaaaaaaaaaaaaaaaa', {}).valid, false);
assert.equal(validatePassword('Short7!', {}).valid, false);

console.log('Security foundation tests passed.');
