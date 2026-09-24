'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('public/finance-intelligence.html');
const master=read('public/finance-master.js');
const advanced=read('public/finance-advanced-control.js');
const pkg=JSON.parse(read('package.json'));
const suite=read('scripts/finance-production-regression-suite.js');

const masterMatch=html.match(/\/finance-master\.js\?v=(20260924-control-v\d+)/);
const advancedAssetMatch=advanced.match(/VERSION='(20260924-advanced-control-v\d+)'/);
const advancedLoaderMatch=master.match(/\/finance-advanced-control\.js\?v=(20260924-advanced-control-v\d+)/);

assert(masterMatch,'Canonical Finance HTML must declare a versioned master release.');
assert(advancedAssetMatch,'Advanced Finance asset must declare a versioned release.');
assert(advancedLoaderMatch,'Finance Master must load a versioned Advanced Control asset.');
assert.strictEqual(advancedLoaderMatch[1],advancedAssetMatch[1],'Master loader and Advanced Control asset versions must match exactly.');
assert(pkg.scripts?.build==='npm run check && node scripts/finance-production-regression-suite.js','Railway build must run syntax plus the canonical Finance production regression suite.');
assert(suite.includes('"finance-release-consistency-test.js"'),'Production regression suite must include the Finance release consistency guard.');

const scriptsDir=path.join(root,'scripts');
const financeTests=fs.readdirSync(scriptsDir).filter(name=>/^(?:finance|personal-).*test\.js$/.test(name)&&name!=='finance-release-consistency-test.js');
const forbidden=[masterMatch[1],advancedAssetMatch[1]];
const offenders=[];
for(const name of financeTests){
  const content=fs.readFileSync(path.join(scriptsDir,name),'utf8');
  for(const releaseId of forbidden){
    if(content.includes(releaseId))offenders.push(name+' hard-codes '+releaseId);
  }
}
assert.deepStrictEqual(offenders,[],'Finance tests must be release-version-safe. Offenders: '+offenders.join(', '));

const navStart=master.indexOf('const NAV_GROUPS=[');
const navEnd=master.indexOf('];',navStart);
assert(navStart>=0&&navEnd>navStart,'Canonical Finance navigation block is missing.');
const navBlock=master.slice(navStart,navEnd+2);
const navKeys=[...navBlock.matchAll(/\['([a-z0-9]+)','[^']*','[^']+'\]/g)].map(m=>m[1]);
assert.strictEqual(new Set(navKeys).size,navKeys.length,'Canonical Finance navigation must not contain duplicate module keys.');

assert(!/20260924-control-v\d+/.test(read('scripts/finance-master-os-test.js')),'Master regression must use a version-safe matcher, not a concrete control release.');
assert(!/20260924-advanced-control-v\d+/.test(read('scripts/finance-advanced-control-test.js')),'Advanced regression must derive the release id dynamically.');

console.log('FINANCE_RELEASE_CONSISTENCY_OK master='+masterMatch[1]+' advanced='+advancedAssetMatch[1]+' tests='+financeTests.length);
