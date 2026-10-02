'use strict';

const pool = require('../config/db');
const {
  databaseFootprint,
  recoverDatabaseCapacity
} = require('../services/databaseCapacityRecoveryService');

async function main() {
  console.log('DB_CAPACITY_PREDEPLOY_START');
  let before = null;
  try {
    before = await databaseFootprint();
    console.log('DB_CAPACITY_PREDEPLOY_BEFORE', JSON.stringify(before));
  } catch (error) {
    console.warn('DB_CAPACITY_PREDEPLOY_BEFORE_FAILED', error.code || error.errno || error.message);
  }

  try {
    const result = await recoverDatabaseCapacity({ force: true });
    console.log('DB_CAPACITY_PREDEPLOY_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('DB_CAPACITY_PREDEPLOY_RECOVERY_INCOMPLETE', JSON.stringify({
      code: error.code || null,
      errno: error.errno || null,
      message: String(error.message || '').slice(0, 300),
      details: error.details || null
    }));
    // Do not turn a capacity-diagnostic/recovery pass into a failed deployment.
    // The old production instance remains available and runtime health will show
    // whether provider-level storage must be increased.
  }

  try {
    const after = await databaseFootprint();
    console.log('DB_CAPACITY_PREDEPLOY_AFTER', JSON.stringify(after));
  } catch (error) {
    console.warn('DB_CAPACITY_PREDEPLOY_AFTER_FAILED', error.code || error.errno || error.message);
  }
}

main()
  .catch((error) => {
    console.error('DB_CAPACITY_PREDEPLOY_UNEXPECTED', error.code || error.message);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
