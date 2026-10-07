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
for(const file of ['public/style.css','public/advanced-theme.css']){
 const legacy=fs.readFileSync(file,'utf8');
 for(const match of legacy.matchAll(/\.sidebar(?:\.vv-sidebar|\.is-open)?\s*\{([^{}]*)\}/g))assert.doesNotMatch(match[1],/(?:overflow|z-index|transform|pointer-events|height)\s*:/,'Shared sidebar layout must not have a competing legacy owner: '+file);
}
const finance=fs.readFileSync('public/finance-master.js','utf8');
assert.match(finance,/!requested\.has\('period'\).*state\.period=pref\.default_period/,'An account/category deep link retains its explicit period');
console.log('WORKSPACE_NAVIGATION_OK: one open/close state, bounded scroll region, focus/rotation/Back recovery, no double binding, 44px controls and deep-link preference precedence.');
