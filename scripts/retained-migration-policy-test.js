'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runMigrations,discoverMigrations}=require('../services/migrationRunner');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vv-archived-migrations-'));
 try{
  fs.writeFileSync(path.join(dir,'20260101_archived_fixture.sql'),'UPDATE finance_fixture SET amount=999;\n');
  const migration=discoverMigrations(dir)[0];
  for(const status of ['APPLIED','BASELINED','FAILED','RUNNING',null]){
   const queries=[];let released=false;
   const conn={query:async(sql)=>{const normalized=sql.replace(/\s+/g,' ').trim();queries.push(normalized);
    if(normalized.startsWith('SELECT GET_LOCK'))return [[{acquired:1}]];
    if(normalized.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'))return [[]];
    if(normalized.startsWith('SELECT migration_id, checksum_sha256'))return [status?[{migration_id:migration.migration_id,checksum_sha256:migration.checksum_sha256,status}]:[]];
    if(normalized.startsWith('SELECT migration_id FROM schema_migrations'))return [[{migration_id:migration.migration_id}]];
    if(normalized.startsWith('SELECT RELEASE_LOCK'))return [[{released:1}]];
    throw new Error('Unexpected SQL: '+normalized);
   },release(){released=true}};
   const operation=runMigrations({pool:{getConnection:async()=>conn},migrationsDir:dir,verifyOnly:true});
   if(['APPLIED','BASELINED'].includes(status)){const result=await operation;assert.equal(result.applied,0);assert.equal(result.baselined,0);assert.equal(result.skipped,1)}
   else await assert.rejects(operation,{code:'HISTORICAL_MIGRATION_UNAPPLIED'});
   assert.equal(released,true);assert.ok(queries.some(q=>q.startsWith('SELECT RELEASE_LOCK')));
   assert.ok(!queries.some(q=>/^(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(q)),status+' must not execute archived SQL or change migration ledger');
  }
  const conn={query:async(sql)=>{if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:1}]];if(sql.includes('CREATE TABLE'))return [[]];if(sql.startsWith('SELECT migration_id, checksum_sha256'))return [[{status:'APPLIED',checksum_sha256:'different'}]];if(sql.startsWith('SELECT RELEASE_LOCK'))return [[]];throw new Error(sql)},release(){}};
  await assert.rejects(runMigrations({pool:{getConnection:async()=>conn},migrationsDir:dir,verifyOnly:true}),{code:'MIGRATION_CHECKSUM_MISMATCH'});
  assert.match(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),/runMigrations\(\{ pool, verifyOnly: true \}\)/);
  console.log('Historical migration policy passed: applied/baselined checksums verified; pending/failed/running and changed migrations fail closed without executing retired SQL.');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
