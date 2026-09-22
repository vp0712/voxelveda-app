'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const expect=(src,token,msg)=>assert(src.includes(token),msg+' (missing: '+token+')');

const routes=read('routes/financeRoutes.js');
const privacy=read('middleware/financePrivacyMiddleware.js');
const controller=read('controllers/financeSearchController.js');
const ui=read('public/finance-master.js');

expect(routes,'router.use(financePrivacy.resolveBankingAccessScope);','Finance router must resolve banking access scope globally');
assert(routes.indexOf('router.use(financePrivacy.resolveBankingAccessScope);')<routes.indexOf("router.get('/search'"),'Banking access scope must resolve before search routes');
expect(routes,"router.get('/search', requireAnyPermission('VIEW_BANKING')",'Global Finance search permission missing');
expect(routes,"router.get('/company-summary', requireAnyPermission('VIEW_BUSINESS_BANKING')",'Company Finance summary must require business banking permission');
expect(privacy,'privacy.requestAccountVisible(row, req)','Account list privacy filter must honor explicit request-scoped grants');

expect(controller,"privacy.visibilitySql('ba',req)",'Search must use Finance account visibility SQL');
expect(controller,'canViewBusiness(req)','Search/company summary must gate company-wide data');
expect(controller,'finance_system_categories','Global search must include Finance categories');
expect(controller,'statement_import_files','Global search must include statement metadata');
expect(controller,'secure_documents','Global search must include private receipt metadata through visible transactions');
expect(controller,'supplier_bills','Global search/company summary must reuse supplier bill records');
expect(controller,'money.toCents','Company monetary totals must use decimal-safe money utilities');
expect(controller,"receivables:{status:'NOT_CONFIGURED'",'Unsupported receivables must be labelled rather than invented');

expect(ui,"loadResource('companySummary',API+'/company-summary')",'Master Finance UI must load the permission-scoped company summary');
expect(ui,'async function globalFinanceSearch(input)','Grouped global Finance search UI missing');
expect(ui,"section('Transactions'",'Transaction search group missing');
expect(ui,"section('Accounts'",'Account search group missing');
expect(ui,"section('Statements'",'Statement search group missing');
expect(ui,"section('Receipts'",'Receipt search group missing');
expect(ui,"section('Categories'",'Category search group missing');
expect(ui,"section('Supplier Bills'",'Supplier bill search group missing');
expect(ui,"globalFinanceSearch(q.slice(7).trim())",'Command palette search must use global Finance search');
expect(ui,'Supplier Payables','Company Finance supplier payables surface missing');
expect(ui,'Accountant Queries','Company Finance accountant query surface missing');
expect(ui,'No dedicated receivables workflow','Company Finance must not fabricate receivables');

console.log('FINANCE_GLOBAL_SEARCH_COMPANY_SECURITY_TEST_OK');
