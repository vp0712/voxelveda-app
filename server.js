const path = require('path');
const dotenv = require('dotenv');

/* ================= LOAD ENV ================= */

const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ .env loading failed:', result.error.message);
  process.exit(1);
}

console.log('✅ .env loaded from:', envPath);
console.log('🚀 Server starting...');

console.log('Environment loaded. Database and JWT configuration present.');

/* ================= LOAD APP ================= */

const app = require('./app');

/* ================= SEED ADMIN ================= */

try {
  require('./utils/seedAdmin')();
} catch (err) {
  console.error('⚠️ Admin seed failed:', err.message);
}

/* ================= SERVER ================= */

const DEFAULT_PORT = 5001;
let PORT = process.env.PORT || DEFAULT_PORT;

/* Try next port if busy */
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`🌐 Open: http://localhost:${port}/login.html`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });

  /* Graceful shutdown */
  process.on('SIGINT', () => {
    console.log('\n🛑 Server shutting down...');
    server.close(() => {
      console.log('✅ Server closed cleanly');
      process.exit(0);
    });
  });
}

startServer(PORT);
