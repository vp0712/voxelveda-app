'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
// Uses real production chart functions/markup/assets, isolated fixture data only.
const root=path.resolve(__dirname,'..');
const output=process.env.CHART_PROOF_DIR || '/tmp/voxelveda-chart-proof';
const baseline=process.env.CHART_BASELINE_DIR;
const baselineCommit=process.env.CHART_BASELINE_COMMIT || '63709fbd3c24fbe6f4c7ea1eefd6ec61e1d4c8f9';
const exactCurrentFrames=process.env.CHART_REQUIRE_EXACT_FRAMES==='true'||baselineCommit==='4c01274945edcf15cf0394076602a8df4c00e884';
assert.match(baselineCommit,/^[a-f0-9]{40}$/,'Chart proof must identify the exact archived baseline commit');
assert(baseline && fs.existsSync(path.join(baseline,'admin-dashboard.html')),'CHART_BASELINE_DIR must contain the exact archived production public assets');
const current=path.join(root,'public');
fs.mkdirSync(output,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function functions(dir){
 const source=fs.readFileSync(path.join(dir,'admin-dashboard.js'),'utf8');
 const names=['renderCharts','renderSupplierPayables','renderSupplierCategoryFlows','renderExpenseCharts','formatMoney','escapeHtml','isMobileShellViewport','toggleMobileMenu'];
 return names.map(name=>{const start=source.indexOf('function '+name+'(');assert(start>=0);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?source.length:end);}).join('\n');
}
const fixture={
 dashboard:{rfqs:{total_rfqs:16,statuses:[{status:'pending',count:7},{status:'approved',count:5},{status:'closed',count:4}]},invoices:{statuses:[{status:'draft',count:3},{status:'sent',count:8},{status:'paid',count:5}]},finance:{financial_year:'2026–27',currency:'AUD',basis:'Issued invoices and recorded bills',revenue:17300,expenses:9800,net_result:7500,months:[{month_key:'2026-07',revenue:6000,expenses:3500},{month_key:'2026-08',revenue:4800,expenses:2800},{month_key:'2026-09',revenue:6500,expenses:3500}]}},
 payables:{financial_year:'2026–27',pending_value:2400,paid_value:7400,overdue_value:700,supplier_count:5,pending_count:3,next_payment:{balance_due:900},categories:[{category:'Materials',paid_value:4200,pending_value:1400,bill_count:4},{category:'Packaging',paid_value:1600,pending_value:800,bill_count:3},{category:'Operating supplies',paid_value:1600,pending_value:200,bill_count:2}],upcoming:[],suppliers:[]},
 expenses:{financial_year:'2026–27',total_expense:9800,categories:[{category:'Materials',total_amount:5600},{category:'Packaging',total_amount:2400},{category:'Operating supplies',total_amount:1800}],months:[{month:'2026-07',total_amount:3500},{month:'2026-08',total_amount:2800},{month:'2026-09',total_amount:3500}]}
};
function document(dir,phase){
 let html=fs.readFileSync(path.join(dir,'admin-dashboard.html'),'utf8');
 html=require(path.join(dir,'..','services','globalBrandRenderer.js')).injectGlobalBrand(html);
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,tag=>/src="\/(?:vendor\/chart\.umd|workspace-charts|workspace-theme|workspace-overlays|business-hub-shell)\.js/.test(tag)?tag:'');
 html=html.replace(/((?:src|href)=")\//g,'$1/'+phase+'/');
 const init=`<script src="/${phase}/fixture-functions.js"></script><script>
 document.querySelectorAll('.page-section').forEach(el=>{if(el.id!=='dashboardSection'&&el.id!=='expenseSection')el.remove();});
 const home=document.getElementById('dashboardSection'),expense=document.getElementById('expenseSection');
 const chartGrid=home.querySelector('.chart-grid'),supplier=home.querySelector('.supplier-intelligence-card'),expenseGrid=expense.querySelector('.expense-chart-grid');
 home.replaceChildren();const intro=document.createElement('div');intro.className='admin-home-heading';intro.innerHTML='<p class="panel-kicker">Voxel Veda</p><h1>Operations charts</h1><p>Deterministic isolated chart-preservation fixture; no production business records.</p>';home.append(intro,chartGrid,supplier,expenseGrid);expense.remove();
 document.getElementById('adminInfo').textContent='Chart verification fixture';document.getElementById('profileNameLabel').textContent='Fixture';
 window.__chartOpens=[];window.openRecordRegister=(kind,filters)=>window.__chartOpens.push({kind,filters});window.openFinancialResult=month=>window.__chartOpens.push({kind:'financial-result',month});window.setText=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};window.renderSupplierUpcoming=window.renderSupplierExposure=window.closeNotificationPanel=()=>{};window.dashboardStatsCache={finance:{financial_year:'2026–27'}};window.registerFilters={expenses:{fy:'2026',search:'fixture'}};
 const fixture=${JSON.stringify(fixture)};renderCharts(fixture.dashboard);renderSupplierPayables(fixture.payables);renderExpenseCharts(fixture.expenses);window.__chartProofReady=true;
 </script>`;
 return html.replace('</body>',init+'</body>');
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid'),pieces=url.pathname.split('/').filter(Boolean),phase=pieces.shift();
 if(!['before','after'].includes(phase)){res.writeHead(404).end();return;}
 const dir=phase==='before'?baseline:current,rel=decodeURIComponent(pieces.join('/'));
 if(!rel){res.setHeader('Content-Type','text/html');res.end(document(dir,phase));return;}
 if(rel==='fixture-functions.js'){res.setHeader('Content-Type','application/javascript');res.end(functions(dir));return;}
 const target=rel==='vendor/chart.umd.js'?path.join(root,'node_modules/chart.js/dist/chart.umd.js'):path.resolve(dir,rel);if(!(target.startsWith(dir+path.sep)||target===path.join(root,'node_modules/chart.js/dist/chart.umd.js'))||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
 const ext=path.extname(target);res.setHeader('Content-Type',({'.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'})[ext]||'application/octet-stream');res.end(fs.readFileSync(target));
});
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function collect(page){return page.evaluate(()=>[...document.querySelectorAll('canvas')].filter(c=>Chart.getChart(c)).map(canvas=>{
 const c=Chart.getChart(canvas),rect=canvas.getBoundingClientRect();
 return {id:canvas.id,type:c.config.type,indexAxis:c.options.indexAxis,labels:c.data.labels,datasets:c.data.datasets.map(d=>({label:d.label,type:d.type||c.config.type,data:d.data})),legend:{display:c.options.plugins.legend.display,position:c.options.plugins.legend.position},tooltip:c.data.datasets.map(d=>c.options.plugins.tooltip.callbacks.label({dataset:d,raw:d.data[0]})),scales:Object.fromEntries(Object.entries(c.scales).map(([k,s])=>[k,{type:s.type,min:s.min,max:s.max,beginAtZero:s.options.beginAtZero,labels:s.ticks.map(t=>t.label)}])),size:{width:rect.width,height:rect.height},accessibleRows:[...canvas.closest('.card').querySelectorAll('.vv-chart-data button')].map(b=>b.textContent)};
}));}
async function recovery(page,width,height){
 const original=await collect(page),events=[];
 const assertRestored=(actual,message)=>{
  assert.deepEqual(actual.map(({size,...chart})=>chart),original.map(({size,...chart})=>chart),message+' data, labels, scales and actions');
  // Browser transforms may report 269.999969 instead of 270 CSS pixels after
  // restoration. Permit only measurement noise, not a changed chart frame.
  for(let i=0;i<original.length;i++)for(const dimension of ['width','height'])assert(Math.abs(actual[i].size[dimension]-original[i].size[dimension])<0.001,message+' exact settled frame '+original[i].id+' '+dimension);
 };
 const ready=async()=>{
  await settle(page);
  await page.waitForFunction(()=>[...document.querySelectorAll('canvas')].filter(c=>Chart.getChart(c)).every(canvas=>{
   const chart=Chart.getChart(canvas),rect=canvas.getBoundingClientRect();return rect.width>0&&rect.height>0&&chart.height>0&&Math.abs(chart.width-rect.width)<=1;
  }));
 };
 await page.setViewportSize({width:height,height:width});await ready();
 assert.equal((await collect(page)).length,6,'Rotation retains all six current charts');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Rotated chart layout fits');
 await page.setViewportSize({width,height});await ready();
 assertRestored(await collect(page),'Returning from rotation restores charts');events.push('rotation-and-return');
 if(width<1024){
  await page.evaluate(()=>toggleMobileMenu(true));
  await page.waitForFunction(()=>Boolean(document.activeElement?.closest('.sidebar')));
  await ready();
  assert.equal(await page.evaluate(()=>document.body.classList.contains('mobile-menu-open')),true,'Actual retained menu function opens the overlay');
  assertRestored(await collect(page),'Opening the existing drawer preserves chart frames');
  await page.evaluate(()=>toggleMobileMenu(false));await ready();
  assert.equal(await page.evaluate(()=>document.body.classList.contains('mobile-menu-open')),false);
  assertRestored(await collect(page),'Closing the existing drawer preserves charts');events.push('retained-drawer-open-and-close');
 }
 // Internal navigation hides the same panel; it must not change the selection
 // or reconstruct different report data on restoration.
 await page.evaluate(()=>document.getElementById('dashboardSection').hidden=true);
 assert.equal(await page.locator('#rfqChart').isVisible(),false,'Navigation-away hides the chart panel');
 await page.evaluate(()=>{document.getElementById('dashboardSection').hidden=false;requestAnimationFrame(()=>VoxelCharts.resize());});await ready();
 assertRestored(await collect(page),'Hidden-panel restoration retains charts');events.push('hidden-panel-and-return');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await ready();
 assertRestored(await collect(page),'Retained page-restoration handler preserves charts');events.push('persisted-page-restore-handler');
 await page.reload();await page.waitForFunction(()=>window.__chartProofReady);await ready();
 assertRestored(await collect(page),'A real refresh restores the same fixture selection');events.push('refresh');
 return events;
}
async function interactions(page){
 const out=[];
 for(const id of await page.locator('canvas').evaluateAll(nodes=>nodes.filter(c=>Chart.getChart(c)).map(c=>c.id))){
  const locator=page.locator('#'+id);await locator.scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.__chartOpens=[]);
  const point=await locator.evaluate(canvas=>{const chart=Chart.getChart(canvas),element=chart.getDatasetMeta(0).data[0],rect=canvas.getBoundingClientRect(),p=element.getCenterPoint();return {x:rect.x+p.x,y:rect.y+p.y};});
  await page.mouse.click(point.x,point.y);await settle(page);
  const chartClick=await page.evaluate(()=>window.__chartOpens.splice(0));assert.equal(chartClick.length,1,'Physical chart hit opens exactly one original register target '+id);
  const card=locator.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
  const details=card.locator('.vv-chart-details');if(await details.count())await details.evaluate(el=>el.open=true);
  await card.locator('.vv-chart-data button').first().click();
  const rowClick=await page.evaluate(()=>window.__chartOpens.splice(0));assert.equal(rowClick.length,1,'Accessible value opens one original register target '+id);
  let legend=null;
  if(id==='financeChart'){
   await locator.scrollIntoViewIfNeeded();await settle(page);
   const legendPoint=await locator.evaluate(canvas=>{const c=Chart.getChart(canvas),h=c.legend.legendHitBoxes[0],r=canvas.getBoundingClientRect();return{x:r.x+h.left+h.width/2,y:r.y+h.top+h.height/2}});
   await page.mouse.click(legendPoint.x,legendPoint.y);await settle(page);assert.equal(await locator.evaluate(c=>Chart.getChart(c).isDatasetVisible(0)),false,'Legend temporarily toggles revenue series');
   await page.mouse.click(legendPoint.x,legendPoint.y);await settle(page);assert.equal(await locator.evaluate(c=>Chart.getChart(c).isDatasetVisible(0)),true,'Legend restores original revenue series');legend='revenue toggle and restore';
  }
  out.push({id,chartClick,rowClick,legend});
 }
 await page.locator('[data-payable-category]').first().click();
 const flowClick=await page.evaluate(()=>window.__chartOpens.splice(0));assert.equal(flowClick.length,1,'Supplier category flow keeps its category-filter action');out.push({id:'supplierCategoryFlows',click:flowClick});
 return out;
}

(async()=>{
 let browser,activePage,activeCase;const results=[];
 try{
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 const phases=process.env.CHART_PHASE==='before'?['before']:['before','after'];
 for(const width of [320,360,390,430,768,1024,1440])for(const mode of ['light','dark'])for(const phase of phases){
  const context=await browser.newContext({viewport:{width,height:width>=768?1000:844},timezoneId:'UTC'});await context.addInitScript(mode=>localStorage.setItem('voxelveda:color-mode',mode),mode);
  const page=await context.newPage(),errors=[];activePage=page;activeCase={phase,width,mode};page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&/\.(?:js|css)(?:\?|$)/.test(r.url()))errors.push('Asset '+r.status()+' '+r.url());});
  await page.goto(`http://127.0.0.1:${server.address().port}/${phase}/`);await page.waitForFunction(()=>window.__chartProofReady);assert.deepEqual(errors,[],'Required chart/browser assets loaded successfully');await page.waitForFunction(()=>typeof Chart==='function'&&Chart.getChart(document.getElementById('rfqChart'))?.width>0);await settle(page);
  const charts=await collect(page),actions=await interactions(page),supplierFlows=await page.locator('#supplierCategoryFlows .supplier-flow-row').evaluateAll(nodes=>nodes.map(n=>({category:n.dataset.payableCategory,text:n.textContent,percent:n.querySelector('[role=img]').getAttribute('aria-label'),width:n.querySelector('.supplier-flow-fill').style.width}))),layout=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.equal(charts.length,6,'All six existing retained charts render');assert.deepEqual(errors,[],'No fixture page errors');assert(layout.scrollWidth<=width+1,`${phase} ${width}/${mode} no horizontal overflow`);
  for(const c of charts){assert(c.size.width>0&&c.size.height>0,'Visible chart '+c.id);assert(c.size.width<=width+1,'Chart fits '+c.id);}
  await page.evaluate(()=>scrollTo(0,0));await settle(page);
  const viewportScreenshot=[390,1440].includes(width)?`${phase}-${width}-${mode}-viewport.png`:null;if(viewportScreenshot)await page.screenshot({path:path.join(output,viewportScreenshot),animations:'disabled'});
  const filename=`${phase}-${width}-${mode}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true,animations:'disabled'});
  const recoveryEvents=[390,1440].includes(width)?await recovery(page,width,width>=768?1000:844):[];
  results.push({phase,width,mode,layout,charts,supplierFlows,actions,recovery:recoveryEvents,screenshot:filename,viewport_screenshot:viewportScreenshot});await context.close();
 }
 if(phases.length===2)for(const before of results.filter(r=>r.phase==='before')){
  const after=results.find(r=>r.phase==='after'&&r.width===before.width&&r.mode===before.mode);assert.deepEqual(after.actions,before.actions,'Preserve chart and accessible-row click targets');assert.deepEqual(after.supplierFlows,before.supplierFlows,'Preserve supplier flow grouping, values and settled proportions');assert.deepEqual(after.recovery,before.recovery,'Preserve chart recovery after rotation, drawer changes, hidden-panel/page restoration and refresh');
  assert.deepEqual(after.charts.map(({size,...c})=>c),before.charts.map(({size,...c})=>c),'Preserve all chart data, order, scales, units, legend, tooltip and rows');
  for(let i=0;i<before.charts.length;i++){assert.equal(after.charts[i].size.height,before.charts[i].size.height,'Preserve chart frame height '+before.charts[i].id);const ratio=after.charts[i].size.width/before.charts[i].size.width;assert(ratio>0.75&&ratio<1.25,'Only modest responsive width change '+before.charts[i].id);if(exactCurrentFrames)assert(Math.abs(after.charts[i].size.width-before.charts[i].size.width)<0.001,'Preserve current approved chart frame width '+before.charts[i].id);}
 }
 const sourceFiles=['controllers/dashboardController.js','controllers/expenseController.js'];
 const calculation_sources=Object.fromEntries(sourceFiles.map(file=>[file,{before:hash(fs.readFileSync(path.join(baseline,'..',file))),after:hash(fs.readFileSync(path.join(root,file)))}]));
 for(const [file,pair] of Object.entries(calculation_sources))assert.equal(pair.before,pair.after,'Server chart source and aggregation unchanged '+file);
 const proof={calculation_sources,scope:'Isolated current production chart functions, markup and shared browser assets; deterministic synthetic records; no private live account data; rotation, actual retained drawer function, hidden-panel navigation, persisted pageshow handler and real refresh. Physical-device or actual background-tab restoration is not established by these browser fixtures.',baseline:baselineCommit,exact_current_frames:exactCurrentFrames,fixture_sha256:hash(JSON.stringify(fixture)),function_source:{before:hash(functions(baseline)),after:hash(functions(current))},renderer:{before:hash(fs.readFileSync(path.join(baseline,'workspace-charts.js'))),after:hash(fs.readFileSync(path.join(current,'workspace-charts.js')))},results};
 assert.equal(proof.function_source.after,proof.function_source.before,'Original chart calculations and actions unchanged');assert.equal(proof.renderer.after,proof.renderer.before,'Original shared chart renderer unchanged');
 fs.writeFileSync(path.join(output,phases.length===1?'before-verification.json':'verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({pass:true,phase:process.env.CHART_PHASE||'comparison',cases:results.length,charts:6,output}));
 }catch(error){if(activePage&&!activePage.isClosed()){await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({case:activeCase,error:error.message,completed_cases:results.length},null,2));}throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
