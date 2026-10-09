'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {listSourceFiles}=require('./source-file-inventory');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vv-source-artifact-'));
try{
 fs.mkdirSync(path.join(directory,'scripts'));
 for(const name of ['app.js','server.js'])fs.writeFileSync(path.join(directory,name),'// artifact fixture\n');
 fs.writeFileSync(path.join(directory,'package.json'),'{}');
 fs.mkdirSync(path.join(directory,'node_modules'));
 fs.writeFileSync(path.join(directory,'node_modules','dependency.js'),'ignored installed dependency');
 for(const name of ['source-file-inventory.js','secret-scan.js','security-source-test.js'])fs.copyFileSync(path.join(__dirname,name),path.join(directory,'scripts',name));
 const files=listSourceFiles(directory);
 assert.ok(files.includes('app.js'));assert.ok(!files.some(name=>name.startsWith('node_modules/')));
 const scan=name=>spawnSync(process.execPath,[path.join(directory,'scripts',name)],{encoding:'utf8'});
 assert.equal(scan('secret-scan.js').status,0,'Clean packaged source must be scanned without Git metadata');
 assert.equal(scan('security-source-test.js').status,0,'Source boundary checks must execute without Git metadata');
 const secret='synthetic-fixture-'+cryptoRandom();
 fs.writeFileSync(path.join(directory,'app.js'),'JWT_'+'SECRET'+'='+secret+'\n');
 const rejected=scan('secret-scan.js');assert.equal(rejected.status,1);assert.match(rejected.stderr,/hardcoded-jwt_secret/);assert.ok(!rejected.stderr.includes(secret),'Failure must identify location, never print secret values');
 fs.writeFileSync(path.join(directory,'app.js'),'// clean\n');
 fs.writeFileSync(path.join(directory,'.env'),'runtime fixture');
 assert.equal(scan('security-source-test.js').status,1,'Accidentally packaged runtime env files must fail the gate');
 fs.unlinkSync(path.join(directory,'.env'));fs.unlinkSync(path.join(directory,'server.js'));
 assert.throws(()=>listSourceFiles(directory),/incomplete/);
 console.log('Packaged source inventory tests passed: no Git dependency, no skipped scanners, hardcoded secret and packaged-env rejection, redacted failures and incomplete artifact rejection.');
}finally{fs.rmSync(directory,{recursive:true,force:true})}
function cryptoRandom(){return require('node:crypto').randomBytes(24).toString('hex')}
