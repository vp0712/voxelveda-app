'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const audits=[];
let failAudit=false,commits=0,rollbacks=0,jobStatus='PLANNING',conflict=false,commissioned=1;
const queries=[];
const stored={campaign:null,job:null,operations:[]};
let snapshot;
const db={
  async beginTransaction(){snapshot=structuredClone(stored);},
  async commit(){commits++;},async rollback(){Object.assign(stored,snapshot);rollbacks++;},release(){},
  async query(sql,params=[]){
    queries.push({sql,params});
    if(sql.startsWith('SELECT id FROM customers'))return [[params[0]===99?null:{id:params[0]}]];
    if(sql.startsWith('SELECT id FROM rfqs'))return [[{id:params[0]}]];
    if(sql.startsWith('INSERT INTO erp_campaigns')) { stored.campaign={id:1,name:params[0],revision:1};return [{insertId:1}]; }
    if(sql.startsWith('SELECT * FROM erp_campaigns'))return [[stored.campaign]];
    if(sql.startsWith('UPDATE erp_campaigns')){stored.campaign={...stored.campaign,name:params[0],revision:params[10]};return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO manufacturing_jobs')){stored.job={id:2,job_no:params[0],status:'PLANNING'};return [{insertId:2}];}
    if(sql.startsWith('SELECT id,status FROM manufacturing_jobs'))return [[{id:2,status:jobStatus}]];
    if(sql.startsWith('SELECT id,status,commissioned'))return [[{id:3,status:'READY',commissioned,critical_safety_issue:0}]];
    if(sql.startsWith('SELECT o.id FROM job_operations'))return [[conflict?{id:7}:null]];
    if(sql.startsWith('SELECT COALESCE(MAX(operation_no)'))return [[{next_no:10}]];
    if(sql.startsWith('INSERT INTO job_operations')){stored.operations.push(params);return [{insertId:4}];}
    throw new Error('Unhandled SQL: '+sql);
  }
};
const pool={getConnection:async()=>db,query:async()=>{throw new Error('Unconfigured workspace read');}};
function mock(relative,exports){const p=require.resolve(path.join(__dirname,relative));require.cache[p]={id:p,filename:p,loaded:true,exports};}
mock('../config/db',pool);
mock('../services/auditService',{logAudit:async(_db,event)=>{if(failAudit)throw new Error('Audit storage failed');audits.push(event);}});
const service=require('../services/erpWorkspaceService');
const user={id:9,role:'custom',permissions:['VIEW_CUSTOMERS','EDIT_CUSTOMERS','VIEW_RFQS','VIEW_QMS','MANAGE_JOBS']};
const campaign={name:'Engineering outreach',channel:'EMAIL',objective:'Introduce prototyping services',start_date:'2026-10-10',end_date:'2026-10-20',currency:'AUD',planned_budget:'250.50',customer_id:5,rfq_id:6};
const req=body=>({user,body,ip:'127.0.0.1',get:()=> 'test-agent',requestId:'erp-regression'});
async function run(){
  assert.throws(()=>service.normalizeCampaign({...campaign,planned_budget:'-1'}));
  assert.throws(()=>service.normalizeCampaign({...campaign,planned_budget:'250.501'}));
  assert.throws(()=>service.normalizeCampaign({...campaign,start_date:'2026-02-30'}));
  assert.throws(()=>service.normalizeCampaign({...campaign,end_date:'2026-10-01'}));
  assert.throws(()=>service.normalizeCampaign({...campaign,customer_id:'Infinity'}));
  assert.throws(()=>service.normalizeCampaign({...campaign,status:'PAY'}));
  assert.throws(()=>service.utcTime('2026-10-08T08:00:00+11:00'));
  assert.throws(()=>service.utcTime('2026-02-30T08:00:00Z'));
  assert.equal(service.utcTime('2026-10-08T08:00:00.000Z'),'2026-10-08 08:00:00');
  const saved=await service.saveCampaign(pool,req(campaign));
  assert.equal(saved.revision,1);assert.equal(saved.planned_budget,'250.50');assert.equal(commits,1);
  assert.equal(audits.at(-1).action,'ERP_CAMPAIGN_CREATED');
  assert.equal(queries.find(q=>q.sql.startsWith('INSERT INTO erp_campaigns')).params.length,12);
  await service.saveCampaign(pool,req({...campaign,revision:1,name:'Updated plan'}),1);
  assert.equal(stored.campaign.revision,2);
  await assert.rejects(()=>service.saveCampaign(pool,req({...campaign,revision:1}),1),e=>e.statusCode===409);
  assert.equal(stored.campaign.name,'Updated plan');
  await assert.rejects(()=>service.saveCampaign(pool,req({...campaign,customer_id:99})),e=>e.statusCode===404);
  await assert.rejects(()=>service.saveCampaign(pool,{...req(campaign),user:{id:9,role:'custom',permissions:['VIEW_CUSTOMERS']}}),e=>e.statusCode===403);
  failAudit=true;const before=structuredClone(stored);
  await assert.rejects(()=>service.saveCampaign(pool,req({...campaign,revision:2,name:'Must roll back'}),1));
  assert.deepEqual(stored,before);failAudit=false;
  const job=await service.createJob(pool,req({part_no:'BRACKET-01',part_description:'Prototype bracket',quantity:'3',sector:'DEFENCE',rfq_id:6}));
  assert.equal(job.status,'PLANNING');
  const jobInsert=queries.find(q=>q.sql.startsWith('INSERT INTO manufacturing_jobs'));
  assert.match(jobInsert.sql,/'PLANNING'/);assert.deepEqual(jobInsert.params.slice(-3),[1,1,9]);
  const operation={operation_name:'Print prototype',machine_id:3,planned_start:'2026-10-08T08:00:00.000Z',planned_end:'2026-10-08T09:00:00.000Z'};
  const planned=await service.scheduleOperation(pool,req(operation),2);assert.equal(planned.status,'PLANNED');
  assert.equal(stored.operations.length,1);
  const reservation=queries.find(q=>q.sql.startsWith('SELECT o.id FROM job_operations'));
  assert.match(reservation.sql,/planned_start<\? AND o.planned_end>\?/);
  assert.match(reservation.sql,/planned_start IS NULL OR o.planned_end IS NULL/);
  assert.match(reservation.sql,/FOR UPDATE/);
  const machineLock=queries.findIndex(q=>q.sql.startsWith('SELECT id,status,commissioned'));
  assert.match(queries[machineLock].sql,/FOR UPDATE/);assert(machineLock<queries.indexOf(reservation));
  conflict=true;await assert.rejects(()=>service.scheduleOperation(pool,req(operation),2),e=>e.code==='ERP_MACHINE_CONFLICT');conflict=false;
  commissioned=0;await assert.rejects(()=>service.scheduleOperation(pool,req(operation),2),e=>e.code==='ERP_MACHINE_UNAVAILABLE');commissioned=1;
  jobStatus='QUALITY_HOLD';await assert.rejects(()=>service.scheduleOperation(pool,req(operation),2),e=>e.statusCode===409);jobStatus='PLANNING';
  await assert.rejects(()=>service.scheduleOperation(pool,req({...operation,planned_end:operation.planned_start}),2));
  failAudit=true;await assert.rejects(()=>service.scheduleOperation(pool,req(operation),2));failAudit=false;
  assert.equal(stored.operations.length,1);assert(rollbacks>=7);
  const readQueries=[];
  const readPool={async query(options){assert.equal(options.timeout,5000);readQueries.push(options.sql);if(options.sql.includes('stock_batches'))throw new Error('Missing register');return [[{status:'pending',count:2}]];}};
  const restricted=await service.workspace(readPool,{id:4,role:'custom',permissions:['VIEW_RFQS','VIEW_INVENTORY']});
  assert.deepEqual(restricted.modules.map(m=>m.key),['sales','inventory']);
  assert.equal(restricted.data.inventory,null);assert.equal(restricted.checks.find(c=>c.key==='inventory').status,'UNAVAILABLE');
  assert(!readQueries.some(q=>/invoices|users|campaigns|bank_|manufacturing/.test(q)));
  assert(!restricted.capabilities.production_edit);assert(!restricted.capabilities.campaign_edit);
  const procurement=await service.workspace({async query(options){
    assert.match(options.sql,/COUNT\(i\.id\) AS line_count/,'Delivery line count must not use the reserved MySQL LINES keyword as a bare alias');
    assert.match(options.sql,/i\.quantity-i\.received_quantity/);
    return [[{id:5,po_number:'PO-5',line_count:2,outstanding_units:'4.000',status:'PART_RECEIVED'}]];
  }},{id:4,role:'custom',permissions:['VIEW_PROCUREMENT']});
  assert.equal(procurement.data.supply[0].line_count,2);assert.equal(procurement.data.supply[0].outstanding_units,'4.000');
  assert.deepEqual(procurement.checks,[{key:'supply',status:'READY'}]);
  const bounded=await service.workspace(readPool,{id:4,role:'custom',permissions:['VIEW_RFQS','VIEW_INVENTORY'],permission_boundary:['VIEW_RFQS']});
  assert.deepEqual(bounded.modules.map(m=>m.key),['sales']);
  const empty=await service.workspace(readPool,{id:1,role:'staff',permissions:[],permission_boundary:['VIEW_OWN_JOBS']});
  assert.deepEqual(empty.modules,[]);assert.deepEqual(empty.data,{});
  const router=require('../routes/erpWorkspaceRoutes');
  const campaignRoute=router.stack.find(l=>l.route?.path==='/campaigns').route;
  const res={status(n){this.statusCode=n;return this;},json(d){this.payload=d;return this;}};
  let passed=false;
  campaignRoute.stack[0].handle({user:{role:'custom',permissions:[]}},res,()=>passed=true);
  assert.equal(res.statusCode,403);assert(!passed);
  campaignRoute.stack[1].handle({user:{role:'custom',permissions:['VIEW_CUSTOMERS']}},res,()=>passed=true);
  assert.equal(res.statusCode,403);assert(!passed);
  campaignRoute.stack[2].handle({body:{...campaign,created_by:999}},res,()=>passed=true);assert.equal(res.statusCode,400);assert(!passed);
  const jobRoute=router.stack.find(l=>l.route?.path==='/work-orders').route;
  jobRoute.stack[2].handle({body:{part_no:'P',part_description:'Part',quantity:1,status:'FINAL_RELEASE'}},res,()=>passed=true);assert.equal(res.statusCode,400);assert(!passed);
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',addEventListener(){},dataset:{},replaceChildren(){}});return elements.get(id);};
  const payload={modules:[{key:'marketing',title:'Marketing',hint:'Plans'},{key:'planning',title:'Planning',hint:'Work orders'}],data:{campaigns:[{id:1,name:'<img src=x onerror=alert(1)>',objective:'Safe plan',channel:'EMAIL',status:'DRAFT',currency:'AUD',planned_budget:'250.50',revision:2}],production:null,schedule:[],machines:[]},checks:[{key:'production',status:'UNAVAILABLE'}],capabilities:{campaign_edit:true,production_edit:false},generated_at:'2026-10-06T04:00:00Z'};
  const context={document:{getElementById:el,querySelectorAll:()=>[]},window:{},fetch:async()=>({ok:true,json:async()=>payload}),AbortSignal:{timeout:()=>null},URLSearchParams,Date,canAccessAdminSection:()=>false,hasCurrentPermission:()=>false};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/erp-workspace.js'),'utf8'),context);
  await context.window.VoxelERP.load();await context.window.VoxelERP.open('marketing');
  assert.match(el('erpContent').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert(!el('erpContent').innerHTML.includes('<img src=x'));
  await context.window.VoxelERP.open('planning');assert.match(el('erpContent').innerHTML,/Register unavailable/);assert(!el('erpContent').innerHTML.includes('New work order'));
  const html=fs.readFileSync(path.join(__dirname,'../public/admin-dashboard.html'),'utf8');assert.match(html,/id="erpSection"/);assert.match(html,/erp-workspace\.js\?v=/);
  const ui=fs.readFileSync(path.join(__dirname,'../public/erp-workspace.js'),'utf8');assert.match(ui,/form\.dataset\.busy==='true'/);assert.match(ui,/payload\.revision=Number/);assert.match(ui,/\/shop-floor\?type=job&id=/);
  const css=fs.readFileSync(path.join(__dirname,'../public/erp-workspace.css'),'utf8');
  assert.match(css,/#erpSection \.erp-section-head h2\{color:var\(--erp-ink\)!important\}/,'ERP headings must override inherited dark-shell text on their light panels');
  const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261006_erp_campaign_register.sql'),'utf8');assert.match(migration,/revision INT UNSIGNED/);assert(!/DROP TABLE|TRUNCATE/i.test(migration));
  console.log('ERP_WORKSPACE_OK: permissions, unavailable data, audited campaign lifecycle, revision conflicts, planning-only jobs, UTC schedules, machine conflict locks and safe UI rendering.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
