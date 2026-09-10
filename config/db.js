const mysql = require('mysql2/promise');
const { buildDatabaseConfig } = require('./databaseConfig');

const databaseConfig = buildDatabaseConfig(process.env);
const pool = mysql.createPool(databaseConfig.options);
pool.databaseConfigSummary = Object.freeze({ ...databaseConfig.summary });

module.exports = pool;
