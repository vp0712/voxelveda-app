'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
function fixture({failure=false}={}){
 const calls=[],state={schema:0,commits:0,rollbacks:0,releases:0};
 const connection={async query(sql,args=[]){calls.push({sql,args});if(failure&&sql.startsWith('SELECT'))throw new Error('Synthetic source failure');if(sql.startsWith('SELECT COUNT'))return [[{total:650,active:520,offer_hired:130}]];if(sql.startsWith('SELECT a.id'))return [[{id:651,full_name:'Synthetic candidate',status:'NEW'}]];return [{}];},async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){state.commits++;},async rollback(){state.rollbacks++;},release(){state.releases++;}};
 const pool={async getConnection(){calls.push({sql:'CONNECTION'});return connection;}};
 const file=path.join(__dirname,'../controllers/careersController.js'),module={exports:{}},realRequire=createRequire(file);
 new vm.Script(fs.readFileSync(file,'utf8'),{filename:file}).runInNewContext({module,exports:module.exports,process,Buffer,console,require(name){if(name==='../config/db')return pool;if(name==='../services/careersSchema')return{async ensureCareersSchema(){state.schema++;}};if(name==='../services/documentSecurityService')return{};if(name==='../services/emailQueue')return{};if(name==='../services/auditService')return{};return realRequire(name);}});
 return{controller:module.exports,calls,state};
}
const actor={id:91,role:'synthetic-reviewer',permissions:['VIEW_STAFF_HR']};
async function list(f,query={},user=actor){const res={json(body){this.body=body;return this;}};await f.controller.listApplications({user,query},res);return res.body;}
(async()=>{
 const denied=fixture();for(const user of [null,{id:0,role:'admin'},{id:92,role:'synthetic-reviewer',permissions:[]}])await assert.rejects(list(denied,{},user),error=>[401,403].includes(error.status));
 assert.equal(denied.calls.length,0);assert.equal(denied.state.schema,0,'Denied requests do not inspect recruitment schema/source');
 for(const query of [{page:'0'},{page:'1.5'},{page:['1','2']},{page_size:101},{status:'INVENTED'},{sort:'created_at;DROP TABLE users'},{direction:'SIDEWAYS'},{search:['one','two']},{search:'a'.repeat(161)},{unknown:'value'}]){const invalid=fixture();await assert.rejects(list(invalid,query),error=>error.status===400);assert.equal(invalid.calls.length,0);assert.equal(invalid.state.schema,0);}
 const valid=fixture(),data=await list(valid,{search:'100%_!',department:'Synthetic team',status:'new',sort:'full_name',direction:'asc',page:'2',page_size:'25'});
 assert.equal(data.total,650);assert.equal(data.pages,26);assert.equal(data.page,2);assert.equal(data.page_size,25);assert.equal(data.summary.active,520);assert.equal(data.summary.offer_hired,130);assert.equal(data.applications[0].id,651);
 assert.match(valid.calls[1].sql,/REPEATABLE READ, READ ONLY/);const select=valid.calls.find(x=>x.sql.startsWith('SELECT a.id'));assert.match(select.sql,/ORDER BY a\.full_name asc,a\.id asc LIMIT \? OFFSET \?/);assert.deepEqual(Array.from(select.args.slice(-2)),[25,25]);assert(select.args.includes('%100!%!_!!%'),'Search treats %, _ and ! as literal text');assert(!select.sql.includes('100%_!'),'Search remains bound data');assert.equal(valid.state.commits,1);assert.equal(valid.state.releases,1);
 const beyond=await list(fixture(),{page:'1000'});assert.equal(beyond.page,26,'A stale last page resolves to the final matching page');
 const broken=fixture({failure:true});await assert.rejects(list(broken),/Synthetic source failure/);assert.equal(broken.state.rollbacks,1);assert.equal(broken.state.releases,1);
 console.log('Careers register tests passed: explicit authority, validated bound filters/sort/pages, literal search, full-selection totals, stable pagination and read-only snapshot cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
