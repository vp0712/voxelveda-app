'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const recovery=require('../services/databaseCapacityRecoveryService');

const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const store=fs.readFileSync(path.join(root,'services','backgroundJobStore.js'),'utf8');
const service=fs.readFileSync(path.join(root,'services','backgroundJobService.js'),'utf8');
const recoverySource=fs.readFileSync(path.join(root,'services','databaseCapacityRecoveryService.js'),'utf8');

assert.equal(recovery.isCapacityError({code:'ER_RECORD_FILE_FULL',errno:1114,message:"The table 'x' is full"}),true);
assert.equal(recovery.isCapacityError({code:'ER_DUP_ENTRY',errno:1062,message:'Duplicate'}),false);

const verifyPos=server.indexOf('await verifyDatabaseConnection(pool);');
const recoveryPos=server.indexOf('await recoverDatabaseCapacity();');
const migrationPos=server.indexOf('await runMigrations({ pool });');
assert(verifyPos>=0 && recoveryPos>verifyPos && migrationPos>recoveryPos,
  'database capacity recovery must run after connectivity and before migrations');

assert.match(recoverySource,/TRUNCATE TABLE background_job_runs/);
assert.doesNotMatch(recoverySource,/TRUNCATE TABLE (bank_transactions|financial_transactions|transactions|audit_logs|statement_import_rows)/i);
assert.match(recoverySource,/statement_import_pages/);
assert.match(recoverySource,/s\.status='IMPORTED'/);
assert.match(recoverySource,/DB_CAPACITY_RECOVERY/);
assert.match(recoverySource,/DATABASE_CAPACITY_EXHAUSTED/);

assert.match(store,/Scheduled no-op polls carry no operational evidence worth retaining/);
assert.match(store,/DELETE FROM background_job_runs WHERE run_uuid = \? AND status = 'RUNNING'/);
assert.match(service,/triggerSource: run\.triggerSource/);


const predeploy=fs.readFileSync(path.join(root,'scripts','run-database-capacity-recovery-once.js'),'utf8');
assert.match(predeploy,/recoverDatabaseCapacity\(\{ force: true \}\)/);
assert.match(predeploy,/DB_CAPACITY_PREDEPLOY_BEFORE/);
assert.match(predeploy,/DB_CAPACITY_PREDEPLOY_AFTER/);
assert.match(predeploy,/process\.exit\(0\)/);
assert.doesNotMatch(predeploy,/process\.exit\(1\)/);


assert.match(predeploy,/DB_PROVIDER_IDENTITY/);
assert.match(predeploy,/DB_MYSQL_IDENTITY/);
assert.match(predeploy,/DB_TARGET_TABLES/);
assert.doesNotMatch(predeploy,/DB_PASSWORD/);
assert.doesNotMatch(predeploy,/password:/i);

console.log('DATABASE_CAPACITY_RECOVERY_TEST_OK');
