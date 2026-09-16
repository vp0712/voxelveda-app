'use strict';

const { healthProbe } = require('../services/objectStorageService');

async function main() {
  const required = String(process.env.OBJECT_STORAGE_REQUIRED || '').toLowerCase() === 'true';
  if (!required) {
    console.log('Object storage pre-deploy gate skipped: OBJECT_STORAGE_REQUIRED is not true.');
    return;
  }
  const result = await healthProbe();
  console.log(`Object storage pre-deploy gate passed: provider=${result.provider}.`);
}

main().catch((error) => {
  console.error(`Object storage pre-deploy gate failed: code=${error.code || 'ERROR'} status=${error.status || 'none'} message=${error.message}`);
  process.exit(1);
});
