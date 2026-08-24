const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../config/db');

const focusTables = [
  'users',
  'invoices',
  'invoice_items',
  'invoice_payments',
  'expenses',
  'expense_files',
  'suppliers',
  'supplier_files',
  'customers',
  'audit_logs',
  'company_settings',
  'stock',
  'raw_materials',
  'packaging_items',
  'timesheets'
];

async function main() {
  const [tables] = await pool.query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);

  console.log('Tables:');
  console.log(tables.map((row) => row.TABLE_NAME).join(', '));

  for (const table of focusTables) {
    if (!tables.some((row) => row.TABLE_NAME === table)) continue;
    const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
    console.log(`\n## ${table}`);
    for (const column of columns) {
      console.log(`${column.Field}:${column.Type}:${column.Null}:${column.Key}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
