'use strict';

const mysql = require('mysql2/promise');
const mysqlCore = require('mysql2');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeName(value, label) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new Error(`${label} contains unsafe characters`);
  return value;
}

async function connect({ host, port, user, password, database }) {
  return mysql.createConnection({
    host,
    port: Number(port),
    user,
    password,
    database,
    connectTimeout: 15000
  });
}

async function main() {
  const privateHost = required('DB_PRIVATE_HOST');
  const privatePort = required('DB_PRIVATE_PORT');
  const publicHost = required('DB_PUBLIC_HOST');
  const publicPort = required('DB_PUBLIC_PORT');
  const database = safeName(required('DB_NAME'), 'DB_NAME');
  const adminPassword = required('DB_ADMIN_PASSWORD');
  const appUser = safeName(required('APP_DB_USER'), 'APP_DB_USER');
  const appPassword = required('APP_DB_PASSWORD');
  if (appPassword.length < 24) throw new Error('APP_DB_PASSWORD must be at least 24 characters');

  console.log(`Recovery target private=${privateHost}:${privatePort} public=${publicHost}:${publicPort} database=${database} app_user=${appUser}`);

  const admin = await connect({ host: privateHost, port: privatePort, user: 'root', password: adminPassword, database });
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
    const grantText = grants.map((row) => String(Object.values(row)[0] || '')).join('\n');
    if (/GRANT\s+(?!USAGE).*\s+ON\s+\*\.\*/i.test(grantText) || /WITH\s+GRANT\s+OPTION/i.test(grantText)) {
      throw new Error('Unsafe grant detected after provisioning');
    }
    console.log('Provisioning complete: schema-scoped grants created without GRANT OPTION.');
  } finally {
    await admin.end();
  }

  const verifier = await connect({ host: publicHost, port: publicPort, user: appUser, password: appPassword, database });
  try {
    const [[identity]] = await verifier.query('SELECT CURRENT_USER() AS runtime_user, DATABASE() AS runtime_database');
    const [grants] = await verifier.query('SHOW GRANTS');
    const grantText = grants.map((row) => String(Object.values(row)[0] || '')).join(' | ');
    console.log(`Verified public login runtime_user=${identity.runtime_user} database=${identity.runtime_database}`);
    console.log(`Verified grants=${grantText}`);
  } finally {
    await verifier.end();
  }

  console.log('DB_RECOVERY_OK');
}

main().catch((error) => {
  console.error(`DB_RECOVERY_FAILED code=${error.code || 'ERROR'} message=${error.message}`);
  process.exit(1);
});
