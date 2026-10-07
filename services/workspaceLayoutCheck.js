'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hasPermission}=require('./authorizationService');
const {injectGlobalBrand}=require('./globalBrandRenderer');
const {renderAdminPage}=require('./adminPageRenderer');
const {renderFinancePage}=require('./workspaceShellRenderer');
function authorised(req,res){
  if(hasPermission(req.user,'MANAGE_USERS'))return true;
  res.status(403).json({message:'Layout diagnostics require workspace administration.'});return false;
}
function renderCheck(req,res){
  if(!authorised(req,res))return;
  const html=fs.readFileSync(path.join(__dirname,'../public/workspace-layout-check.html'),'utf8');
  return res.type('html').set('Cache-Control','private, no-store').send(injectGlobalBrand(html));
}
function renderFrame(req,res){
  if(!authorised(req,res))return;
  if(!['admin','finance'].includes(req.params.module))return res.status(404).json({message:'Unknown layout module.'});
  // Only these authenticated diagnostic copies allow same-origin framing.
  // Normal ERP/Finance routes retain DENY and frame-ancestors 'none'.
  res.set('X-Frame-Options','SAMEORIGIN');
  for(const header of ['Content-Security-Policy','Content-Security-Policy-Report-Only']){
    const value=res.get(header);if(value)res.set(header,value.replace("frame-ancestors 'none'","frame-ancestors 'self'"));
  }
  const send=res.send.bind(res);
  res.send=html=>send(typeof html==='string'?html.replace(/<body([^>]*)>/i,'<body$1 data-vv-layout-check="frame">').replace('</body>','<script src="/workspace-layout-check.js?v=20261007-sidebar-recovery" defer></script></body>'):html);
  return req.params.module==='admin'?renderAdminPage(req,res):renderFinancePage(req,res);
}
module.exports={renderCheck,renderFrame};
