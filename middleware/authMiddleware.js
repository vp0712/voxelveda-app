// Backwards-compatible import for older route modules. Keep a single
// authentication implementation so cookie sessions, revocation, account
// state checks and session-version checks cannot drift apart.
module.exports = require('./auth');
