'use strict';
const assert=require('node:assert/strict');
const {renderCheck,renderFrame}=require('../services/workspaceLayoutCheck');
function response(){const headers={'Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'",'Content-Security-Policy-Report-Only':"frame-ancestors 'none'",'X-Frame-Options':'DENY'};return {headers,statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},get(key){return headers[key];},set(key,value){headers[key]=value;return this;},type(){return this;},send(body){this.body=body;return this;}};}
const denied=response();renderCheck({user:{id:1,role:'staff',permissions:['VIEW_BANKING']}},denied);assert.equal(denied.statusCode,403);assert.equal(denied.headers['X-Frame-Options'],'DENY');
const unknown=response();renderFrame({user:{id:1,role:'admin'},params:{module:'unrecognised'}},unknown);assert.equal(unknown.statusCode,404);assert.equal(unknown.headers['X-Frame-Options'],'DENY');
const frame=response();renderFrame({user:{id:1,role:'admin'},params:{module:'finance'}},frame);
assert.equal(frame.headers['X-Frame-Options'],'SAMEORIGIN');assert.match(frame.headers['Content-Security-Policy'],/frame-ancestors 'self'/);assert.match(frame.body,/data-vv-layout-check="frame"/);assert.match(frame.body,/id="primarySidebar"/);assert.match(frame.body,/finance-master.js/);
const parent=response();renderCheck({user:{id:1,role:'admin'}},parent);assert.equal(parent.headers['X-Frame-Options'],'DENY');assert.match(parent.body,/200% emulation/);
console.log('Protected layout check passed: real app renderer, denied non-administrators, allowlisted modules, same-origin diagnostic frames only.');
