'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { injectGlobalBrand } = require('../services/globalBrandRenderer');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/workspace-theme.css'), 'utf8');

for (const file of ['admin-dashboard.html', 'staff-dashboard.html', 'finance-intelligence.html', 'client-portal.html', 'visitor-portal.html', 'login.html', 'profile.html', 'quality.html', 'shop-floor.html', 'security.html']) {
  const rendered = injectGlobalBrand(fs.readFileSync(path.join(root, 'public', file), 'utf8'));
  assert.match(rendered, /<body[^>]+data-vv-theme="sapphire"/i, `${file} receives the shared theme`);
  assert.match(rendered, /workspace-theme\.css\?v=20261007-readable-integrated/, `${file} receives the current stylesheet`);
  assert.match(rendered, /<meta name="theme-color" content="#F4F7FB">/, `${file} uses the common mobile chrome colour`);
  assert.equal((rendered.match(/name="theme-color"/g) || []).length, 1, `${file} has one theme colour`);
  assert.equal(injectGlobalBrand(rendered), rendered, `${file} injection is idempotent`);
}
const privatePage = '<html><head></head><body class="staff-portal" data-vv-role="hr"><button hidden class="hidden-section permission-finance">Restricted</button><img src="/logo.png"></body></html>';
const rendered = injectGlobalBrand(privatePage);
assert.match(rendered, /class="staff-portal" data-vv-role="hr" data-vv-theme="sapphire"/);
assert.match(rendered, /<button hidden class="hidden-section permission-finance">Restricted<\/button>/);
assert.match(rendered, /<img src="\/logo.png">/);
assert.match(css,/\.sidebar input/, 'The common sidebar owns form contrast');
assert.match(css,/\[hidden\].*display:\s*none\s*!important/, 'Theme cannot expose hidden permission controls');
for(const file of ['style.css','role-portal.css','finance-master.css','quality.css','shop-floor.css','step-up.css']){
 const consumer=fs.readFileSync(path.join(root,'public',file),'utf8');
 assert.match(consumer,/var\(--(?:text-primary|surface|primary|vv-text)/,file+' consumes semantic tokens');
}
assert.match(css,/data-color-mode="dark"/, 'Both supported modes have authoritative tokens');
assert.match(css,/env\(safe-area-inset-bottom/, 'Content reserves the shared mobile navigation height');
assert.match(css,/\.vv-primary-nav/, 'Finance and ERP share one mobile primary bar');
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /@media print/);

const master = fs.readFileSync(path.join(root, 'public/finance-master.js'), 'utf8');
const helperStart = master.indexOf('function statementNeedsAttention(');
const helperEnd = master.indexOf('function statementFileRow(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const attention = vm.runInNewContext(master.slice(helperStart, helperEnd) + '\nstatementNeedsAttention');
assert.equal(attention({status:'EXTRACTING', current_stage:'OCR REQUIRED'}), true);
assert.equal(attention({status:'EXTRACTING', last_error_summary:'Invalid date'}), true);
assert.equal(attention({status:'QUEUED', job_error_summary:'Worker failed'}), true);
assert.equal(attention({status:'NEEDS_MAPPING'}), true);
assert.equal(attention({status:'EXTRACTING', current_stage:'PARSING'}), false);
assert.equal(attention({status:'IMPORTED', last_error_summary:'Old recovered error'}), false);
assert.equal(attention({status:'PENDING_REVIEW'}), false);
const statementsStart = master.indexOf('function statements(){');
const statementsEnd = master.indexOf('function removedStatementsSection(){', statementsStart);
const folderFixture = [{status:'EXTRACTING',current_stage:'OCR_REQUIRED'}, {status:'EXTRACTING',last_error_summary:'Invalid date'}, {status:'EXTRACTING',current_stage:'PARSING'}, {status:'IMPORTED'}];
const folderHtml = vm.runInNewContext(master.slice(helperStart, helperEnd) + master.slice(statementsStart, statementsEnd) + '\nstatements()', {
  state:{statementBank:'',statementAccount:'',statementQuery:'',statementStatus:'ALL'},
  statementEntries:()=>folderFixture, statementFolderBody:()=>'', removedStatementsSection:()=>'', resourceError:()=>'', esc:String
});
assert.match(folderHtml, /<b>2<\/b> need attention/);
assert.match(folderHtml, /<b>1<\/b> processing/);
assert.match(folderHtml, /<option value="PROCESSING"/);

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
const blocks=[css.slice(css.indexOf(':root {'),css.indexOf(':root[data-color-mode')),css.slice(css.indexOf(':root[data-color-mode'),css.indexOf('html {'))];
const base={};
for(const [index,block] of blocks.entries()){
 const mode={...base};for(const match of block.matchAll(/--([\w-]+):\s*#([a-f\d]{6})/gi))mode[match[1]]=match[2];
 if(index===0)Object.assign(base,mode);
 for(const [fg,bg] of [['text-primary','surface'],['text-secondary','surface'],['text-secondary','page'],['text-secondary','surface-muted'],['on-primary','primary'],['nav-text','nav'],['success','success-bg'],['danger','danger-bg'],['warning','warning-bg']]){
  const pair=[luminance(mode[fg]),luminance(mode[bg])].sort((a,b)=>b-a);
  assert.ok((pair[0]+.05)/(pair[1]+.05)>=4.5,`${index?'dark':'light'} ${fg}/${bg} must meet actual normal-text contrast`);
 }
 for(const fg of ['control-border','series-0','series-1','series-2','series-3','series-4','series-5']){
  const pair=[luminance(mode[fg]),luminance(mode.surface)].sort((a,b)=>b-a);assert.ok((pair[0]+.05)/(pair[1]+.05)>=3,fg+' must remain an identifiable graphic/control');
 }
}
console.log('FINANCE_WORKSPACE_THEME_TEST_OK: portal injection, scoped coverage, hidden controls and colour-pair contrast');
