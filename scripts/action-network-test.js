'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let owner='11',calls=0,uncertain=0,releases=[];
const sandbox={Request,Response,AbortController,setTimeout,clearTimeout,localStorage:{getItem(key){return key==='user'?JSON.stringify({id:owner}):'fixture-'+owner;}},document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}},window:{fetch:async()=>{calls++;return new Promise(resolve=>releases.push(resolve));},VoxelDialog:{markUncertain(){uncertain++;}}}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/operations-ui.js'),'utf8'),sandbox);
(async()=>{
 const one=sandbox.window.fetch('/api/record',{method:'POST',body:'{"request_id":"same"}'}),same=sandbox.window.fetch('/api/record',{method:'POST',body:'{"request_id":"same"}'});assert.equal(calls,1);
 owner='22';const other=sandbox.window.fetch('/api/record',{method:'POST',body:'{"request_id":"same"}'});assert.equal(calls,2,'another authenticated account must never inherit the previous account write or response');
 releases[0](Response.json({owner:11}));releases[1](Response.json({owner:22}));assert.deepEqual(await(await one).json(),{owner:11});assert.deepEqual(await(await same).json(),{owner:11});assert.deepEqual(await(await other).json(),{owner:22});
 const before=calls,failed=sandbox.window.fetch('/api/failed',{method:'POST',body:'{}'});releases.at(-1)(Response.json({message:'Not saved or approved'},{status:503}));assert.equal((await failed).status,503);assert.equal(calls,before+1,'uncertain writes must never be automatically retried');assert.equal(uncertain,1);
 const html=sandbox.window.fetch('/api/html',{method:'POST',body:'{}'});releases.at(-1)(new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}));assert.equal((await html).status,502);assert.equal(uncertain,2,'an HTML success response is uncertain, not a committed write or PDF');
 console.log('Action network tests passed: account-scoped in-flight writes, duplicate tap response isolation, uncertain/no automatic retry and HTML response rejection. No business records or transport used.');
})().catch(error=>{console.error(error);process.exitCode=1;});
