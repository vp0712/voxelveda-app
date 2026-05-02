const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ .env loading failed:', result.error.message);
} else {
  console.log('✅ .env loaded from:', envPath);
}

console.log("🚀 Server starting...");
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD);
console.log('JWT SECRET LOADED:', !!process.env.JWT_SECRET);
console.log('DB PORT:', process.env.DB_PORT);
const app = require('./app');
require('./utils/seedAdmin')();

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});