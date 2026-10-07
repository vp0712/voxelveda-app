'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/workspace-shell.js','utf8');
function element(){
 const classes=new Set(),attributes={};
 return {isConnected:true,classList:{contains:name=>classes.has(name),toggle(name,on){on?classes.add(name):classes.delete(name);}},setAttribute(name,value){attributes[name]=value;},getAttribute:name=>attributes[name],focus(){this.focused=(this.focused||0)+1;},hidden:false};
}
const body=element(),html=element(),sidebar=element(),backdrop=element(),opener=element(),close=element(),toggle=element();
const compact={matches:true};
sidebar.querySelector=()=>close;
const document={body,documentElement:html,activeElement:opener,getElementById:id=>id==='primarySidebar'?sidebar:null,querySelector:()=>backdrop,querySelectorAll:()=>[toggle]};
const window={matchMedia:()=>compact};
// Exercise the shipped menu controller, not an independently reimplemented model.
vm.runInNewContext(source.slice(0,source.indexOf("  document.addEventListener('DOMContentLoaded'"))+ '\n})();',{window,document});
window.VoxelWorkspaceMenu.set(true);
for(const e of [body,html])assert.equal(e.classList.contains('mobile-menu-open'),true);
assert.equal(body.classList.contains('vv-scroll-locked'),true);
assert.equal(sidebar.classList.contains('is-open'),true);
assert.equal(sidebar.getAttribute('aria-hidden'),'false');
assert.equal(toggle.getAttribute('aria-expanded'),'true');
assert.equal(backdrop.hidden,false);assert.equal(backdrop.classList.contains('is-open'),true);assert.equal(close.focused,1);
window.VoxelWorkspaceMenu.set(true);assert.equal(close.focused,1,'Repeated opens do not reset navigation focus');
window.VoxelWorkspaceMenu.set(false);
for(const e of [body,html])assert.equal(e.classList.contains('mobile-menu-open'),false);
assert.equal(body.classList.contains('vv-scroll-locked'),false);
assert.equal(sidebar.classList.contains('is-open'),false);assert.equal(sidebar.getAttribute('aria-hidden'),'true');
assert.equal(backdrop.hidden,true);assert.equal(backdrop.classList.contains('is-open'),false);
assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(opener.focused,1);
compact.matches=false;window.VoxelWorkspaceMenu.set(true);
assert.equal(body.classList.contains('vv-scroll-locked'),false,'Desktop navigation never locks page scrolling');
assert.equal(sidebar.getAttribute('aria-hidden'),'false','Desktop sidebar remains accessible after rotation');
assert.match(source,/compact\.addEventListener\('change'/);
assert.match(source,/window\.addEventListener\('pageshow'/);
assert.match(source,/button\.dataset\.mobileMenuBound === 'true'/,'Menu controls are not double-bound by ERP and Finance');
const css=fs.readFileSync('public/workspace-theme.css','utf8');
assert.match(css,/\.sidebar\s*\{[^}]*display:flex;[^}]*flex-direction:column;[^}]*height:100dvh/s);
assert.match(css,/\.sidebar \.sidebar-nav\s*\{[^}]*flex:1 1 0;[^}]*min-height:0;[^}]*overflow-y:auto/s);
assert.match(css,/\.sidebar\.is-open\s*\{[^}]*pointer-events:auto/s);
assert.match(css,/font-family:var\(--font-body\)/);
assert.match(css,/\.sidebar \.nav-btn[^}]*min-height:44px/s);
assert.match(css,/\.topbar-title\s*\{[^}]*flex:1 1 180px/,'Header actions may wrap without squeezing the page title');
assert.match(css,/\.topbar-title :is\(h2,p\)[^}]*white-space:normal; overflow-wrap:anywhere/,'Long page titles remain readable on phones');
for(const file of ['public/style.css','public/advanced-theme.css']){
 const legacy=fs.readFileSync(file,'utf8');
 for(const match of legacy.matchAll(/\.sidebar(?:\.vv-sidebar|\.is-open)?\s*\{([^{}]*)\}/g))assert.doesNotMatch(match[1],/(?:overflow|z-index|transform|pointer-events|height)\s*:/,'Shared sidebar layout must not have a competing legacy owner: '+file);
 for(const match of legacy.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
  const selector=match[1].replace(/\/\*[\s\S]*?\*\//g,'').trim(),declarations=match[2];
  if(/^(?:\.topbar-title(?: [hp][12]?)?|\.topbar > div:first-child(?: [hp][12]?)?|\.topbar [hp][12]?)$/.test(selector))assert.doesNotMatch(declarations,/(?:overflow\s*:\s*hidden|white-space\s*:\s*nowrap|text-overflow\s*:\s*ellipsis|max-width\s*:|display\s*:\s*none)/,'Legacy title clipping must not return: '+selector);
  if(selector==='.shell-brand')assert.doesNotMatch(declarations,/(?:background|display|grid-template-columns)\s*:/,'Sidebar branding inherits its dark shared surface, never a white card');
  if(/^\.(?:home-command-copy|staff-mission-copy) (?:h1|p)$/.test(selector)&&/\bcolor\s*:/.test(declarations))assert.match(declarations,/color\s*:\s*var\(--hero-text\)/,'A dark hero uses its paired foreground: '+selector);
 }
}
const finance=fs.readFileSync('public/finance-master.js','utf8');
assert.match(finance,/!requested\.has\('period'\).*state\.period=pref\.default_period/,'An account/category deep link retains its explicit period');
const preferenceFunction=finance.slice(finance.indexOf('function applyFinancePreferenceDefaults('),finance.indexOf('async function loadBase('));
assert.match(finance,/const initialFinanceQuery=new URLSearchParams\(location.search\)/,'Requested filters are captured before canonical history adds defaults');
const pref={default_workspace:'PERSONAL',default_period:'last7',default_account_id:7};
function preferenceCase(query,initial={scope:'ALL',period:'month',account:''}){
 const state={...initial},requested=new URLSearchParams(query);
 vm.runInNewContext(preferenceFunction+'\napplyFinancePreferenceDefaults(pref,requested);',{state,pref,requested});return state;
}
assert.deepEqual(preferenceCase(''),{scope:'PERSONAL',period:'last7',account:'7'},'Absent navigation filters retain saved preferences');
assert.deepEqual(preferenceCase('scope=BUSINESS&period=all&account_id=12',{scope:'BUSINESS',period:'all',account:'12'}),{scope:'BUSINESS',period:'all',account:'12'},'Explicit account, period and workspace win over saved defaults');
assert.equal(preferenceCase('account_id=12',{scope:'ALL',period:'month',account:'12'}).scope,'ALL','An account deep link is not narrowed to a conflicting saved workspace');
async function checkDownloads(){
 const downloadSource=finance.slice(finance.indexOf('async function downloadFinanceFile('),finance.indexOf('function openAccountStatementForm('));
 let calls=[],verifications=0,clicks=0,popups=0;
 const responses=[new Response(JSON.stringify({code:'STEP_UP_REQUIRED'}),{status:403,headers:{'Content-Type':'application/json'}}),new Response('%PDF-1.7\nfixture',{headers:{'Content-Type':'application/pdf'}})];
 const context={financeDownloadsInFlight:new Set(),fetch:async(url,options)=>{calls.push({url,options});return responses.shift();},financeAuthError:()=>null,requestFinanceStepUp:async()=>verifications++,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},document:{createElement:()=>({click(){clicks++},remove(){}}),body:{appendChild(){}}},setTimeout:()=>0,showFinancePopup:()=>popups++};
 vm.runInNewContext(downloadSource+'\nthis.download=downloadFinanceFile;',context);
 const url='/api/finance/reports/builder.pdf?account_ids=12&currency=AUD';
 await context.download(url,'Voxel-Veda-Report.pdf');
 assert.equal(verifications,1);assert.equal(calls.length,2);assert(calls.every(x=>x.url===url&&x.options.credentials==='same-origin'),'Verification retry preserves the exact filtered export');
 assert.equal(clicks,1);assert.equal(popups,1);assert.equal(context.financeDownloadsInFlight.size,0);
 responses.push(new Response('{"message":"Not a PDF"}',{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(()=>context.download(url,'report.pdf'),/valid PDF file/);assert.equal(clicks,1,'An error payload cannot become a downloaded PDF');
 responses.push(new Response('not a pdf',{headers:{'Content-Type':'application/pdf'}}));
 await assert.rejects(()=>context.download(url,'report.pdf'),/PDF response is invalid/);
 responses.push(new Response(JSON.stringify({code:'EXPORT_APPROVAL_REQUIRED',message:'Independent export approval is required'}),{status:403,headers:{'Content-Type':'application/json'}}));
 await assert.rejects(()=>context.download(url,'report.pdf'),/Independent export approval/);assert.equal(verifications,1,'Independent approval is never bypassed by another verification retry');
 context.financeDownloadsInFlight.add(url);await assert.rejects(()=>context.download(url,'report.pdf'),/already being prepared/);
 assert.match(finance,/reportPdf'\)\.onclick[\s\S]*?runFinanceDownload/,'Report PDF remains in the app and uses the secured handler');
 console.log('WORKSPACE_NAVIGATION_OK: shared menu state/scroll/focus/rotation/Back, 44px controls, explicit filters and saved defaults; secure export retry, exact filters, MIME/signature validation, approval boundary and duplicate protection.');
}
checkDownloads().catch(error=>{console.error(error);process.exitCode=1});
