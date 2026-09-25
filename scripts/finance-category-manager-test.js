'use strict';
const fs=require('node:fs');
const path=require('node:path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function assert(value,message){if(!value)throw new Error(message)}

const migration=read('migrations/20260923_finance_system_categories.sql');
const controller=read('controllers/financeCategoryController.js');
const routes=read('routes/financeRoutes.js');
const client=read('public/finance-master.js');
const archiveMigration=read('migrations/20260923_finance_transaction_archive.sql');

assert(migration.includes('finance_system_categories'),'system category table missing');
['parent_id','scope','owner_user_id','icon','color','gst_default','archived_at'].forEach(t=>assert(migration.includes(t),'category field missing '+t));
assert(controller.includes("const SCOPES=new Set(['PERSONAL','BUSINESS','BOTH'])"),'category scope contract missing');
assert(controller.includes("const GST_DEFAULTS=new Set(['REVIEW'"),'GST review-default contract missing');
assert(controller.includes("values.scope==='PERSONAL'?userId(req):null"),'personal category ownership isolation missing');
assert(controller.includes("scope='PERSONAL' AND \\${alias}.owner_user_id=?") || (controller.includes("alias='c'") && controller.includes("owner_user_id=?")),'personal category visibility isolation missing');
assert(controller.includes('FINANCE_CATEGORY_CREATED'),'category create audit missing');
assert(controller.includes('FINANCE_CATEGORY_ARCHIVED'),'category archive audit missing');
assert(controller.includes('CATEGORY_HAS_ACTIVE_CHILDREN'),'parent/child archive guard missing');

assert(routes.includes("router.get('/categories'"),'category list route missing');
assert(routes.includes("router.post('/categories', requireAnyPermission('EDIT_FINANCE')"),'category write permission missing');
assert(routes.includes("router.post('/categories/:id/archive'"),'category archive route missing');
assert(routes.includes("router.post('/categories/:id/restore'"),'category restore route missing');

assert(client.includes('System Categories'),'category manager UI missing');
assert(client.includes('Original bank category remains immutable source evidence'),'original-vs-system category disclosure missing');
assert(client.includes('openFinanceCategoryForm'),'category create/edit UI missing');
assert(client.includes('openFinanceRuleForm'),'merchant rule edit UI missing');
assert(client.includes('data-category-archive'),'category archive action missing');
assert(client.includes('data-category-restore'),'category restore action missing');
assert(client.includes('openTransactionCategoryMove'),'transaction category move workflow missing');
assert(client.includes('create_category_name'),'inline new-category creation from a transaction is missing');
assert(client.includes('Learn this exact merchant for future transactions'),'merchant-learning control missing');


assert(!archiveMigration.includes('CREATE INDEX IF NOT EXISTS'),'MySQL-incompatible CREATE INDEX IF NOT EXISTS must not remain');
assert(!archiveMigration.includes('ADD COLUMN IF NOT EXISTS'),'MySQL-incompatible ADD COLUMN IF NOT EXISTS must not remain');
assert(archiveMigration.includes('ADD INDEX idx_bank_transactions_archived_at'),'archive index must be created by ALTER TABLE');

console.log('FINANCE_CATEGORY_MANAGER_TEST_OK');
