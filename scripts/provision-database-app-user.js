'use strict';

const mysql = require('mysql2/promise');
const mysqlCore = require('mysql2');
const { buildDatabaseConfig } = require('../config/databaseConfig');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeAccountName(value) {
  if (!/^[A-Za-z0-9_]{3,32}$/.test(value)) throw new Error('DB_APP_USER must contain only letters, numbers and underscores');
  return value;
}

async function main() {
  if (process.env.DB_PROVISION_APP_USER !== 'true') {
    console.log('Database app-user provisioning disabled; nothing to do.');
    return;
  }

  const config = buildDatabaseConfig(process.env);
  const database = String(config.options.database || '');
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('Database name is not safe for provisioning');
  const appUser = safeAccountName(required('DB_APP_USER'));
  const appPassword = required('DB_APP_PASSWORD');
  if (appPassword.length < 24) throw new Error('DB_APP_PASSWORD must be at least 24 characters');

  const admin = await mysql.createConnection({ ...config.options, connectionLimit: undefined, queueLimit: undefined, waitForConnections: undefined });
  try {
    const userLiteral = mysqlCore.escape(appUser);
    const passwordLiteral = mysqlCore.escape(appPassword);
    const dbIdentifier = mysqlCore.escapeId(database);
    await admin.query(`CREATE USER IF NOT EXISTS ${userLiteral}@'%' IDENTIFIED BY ${passwordLiteral}`);
    await admin.query(`ALTER USER ${userLiteral}@'%' IDENTIFIED BY ${passwordLiteral}`);
    await admin.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${userLiteral}@'%'`).catch((error) => {
      if (error.code !== 'ER_NONEXISTING_GRANT') throw error;
    });
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES, CREATE VIEW, SHOW VIEW, TRIGGER, EXECUTE ON ${dbIdentifier}.* TO ${userLiteral}@'%'`
    );
    await admin.query('FLUSH PRIVILEGES');
    const [grants] = await admin.query(`SHOW GRANTS FOR ${userLiteral}@'%'`);
    const grantText = grants.map((row) => Object.values(row)[0]).join('\n');
    if (/ ON \*\.\*/i.test(grantText) || /GRANT OPTION/i.test(grantText)) throw new Error('Provisioned account received unsafe global privileges');
    console.log(`Database application user ${appUser} provisioned with schema-scoped privileges only.`);
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(`Database app-user provisioning failed: ${error.code || error.message}`);
  process.exit(1);
});
