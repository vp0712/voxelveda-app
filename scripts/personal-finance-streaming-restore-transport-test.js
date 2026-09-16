const fs=require('fs');
const assert=require('assert');
const transport=fs.readFileSync('controllers/personalFinanceRestoreTransportController.js','utf8');
const restore=fs.readFileSync('controllers/personalFinanceCanonicalRestoreController.js','utf8');
const routes=fs.readFileSync('routes/financeRoutes.js','utf8');
const migration=fs.readFileSync('migrations/20260916_personal_finance_restore_stream_transport.sql','utf8');
const ui=fs.readFileSync('public/personal-finance-transaction-safe-restore-executor.js','utf8');

for(const table of ['personal_finance_restore_uploads','personal_finance_restore_upload_chunks'])assert(migration.includes(table),`Streaming restore migration must create ${table}.`);
assert(migration.includes('MEDIUMBLOB')&&migration.includes('chunk_sha256')&&migration.includes('transport_sha256'),'Transport persistence must retain bounded chunks and integrity hashes.');
for(const bound of ['MAX_TOTAL_BYTES=50*1024*1024','MAX_CHUNKS=512','MAX_CHUNK_BYTES=256*1024','UPLOAD_MINUTES=30'])assert(transport.includes(bound),`Transport must enforce ${bound}.`);
assert(transport.includes("WHERE id=? AND user_id=?")&&transport.includes("DELETE FROM personal_finance_restore_uploads WHERE id=? AND user_id=?"),'Upload sessions must remain owner-scoped.');
assert(transport.includes("status='EXPIRED'")&&transport.includes('purgeExpired'),'Expired temporary uploads must be rejected/cleaned.');
assert(transport.includes("sha(data)!==declared")&&transport.includes("sha(full)!==up.transport_sha256"),'Each chunk and the reassembled transport must be SHA-256 verified.');
assert(transport.includes("chunks.length!==Number(up.total_chunks)")&&transport.includes("Number(c.chunk_index)!==i"),'Finalize must reject incomplete or gapped uploads.');
assert(transport.includes("up.status!=='VERIFIED'")&&transport.includes('loadVerifiedPackage'),'Restore proxy must accept only verified upload sessions.');
assert(transport.includes("req.body={...(req.body||{}),backup}")&&transport.includes("restore[handlerName](req,res)"),'Large transport must reuse the existing canonical restore controller rather than duplicate restore logic.');

for(const route of [
  "router.post('/personal-money/canonical-restore-upload', requireAnyPermission('VIEW_BANKING'), requireStepUp('PREVIEW_PERSONAL_FINANCE_RESTORE')",
  "router.get('/personal-money/canonical-restore-upload/:id', requireAnyPermission('VIEW_BANKING')",
  "router.put('/personal-money/canonical-restore-upload/:id/chunks/:index', requireAnyPermission('VIEW_BANKING')",
  "router.post('/personal-money/canonical-restore-upload/:id/finalize', requireAnyPermission('VIEW_BANKING')",
  "router.post('/personal-money/canonical-restore-upload/:id/dry-run', requireAnyPermission('VIEW_BANKING'), requireStepUp('PREVIEW_PERSONAL_FINANCE_RESTORE')",
  "router.post('/personal-money/canonical-restore-upload/:id/execute', requireAnyPermission('EDIT_FINANCE'), requireStepUp('RESTORE_PERSONAL_FINANCE')"
])assert(routes.includes(route),`Missing protected streaming restore route: ${route}`);
assert(routes.includes("router.post('/personal-money/canonical-restore/dry-run'")&&routes.includes("router.post('/personal-money/canonical-restore/execute'"),'Small canonical restore path must remain available.');

for(const mark of ['DIRECT_LIMIT=600*1024','CLIENT_CHUNK=192*1024','sessionStorage','received_indexes','data_b64','Chunked resumable transport','Large backup detected'])assert(ui.includes(mark),`Restore UI must support ${mark}.`);
assert(ui.includes('backupText=await decrypt(box,pass)')&&!ui.includes('backup_password')&&!ui.includes('password:pass'),'Backup password must remain local to the browser.');
assert(ui.includes("await uploadApi(`/${encodeURIComponent(uploadId)}/finalize`")&&ui.includes("await uploadApi(`/${encodeURIComponent(id)}/dry-run`"),'Large backup must finalize server integrity before dry-run.');
assert(ui.includes("await uploadApi(`/${encodeURIComponent(uploadId)}/execute`"),'Large execution must reference the verified upload rather than resend the full package.');

assert(restore.includes('RESTORE_CHECKPOINT_HASH_MISMATCH')&&restore.includes('hash(canonicalCheckpoint)!==cp.checkpoint_sha256'),'Rollback must verify the persisted checkpoint hash before restoring it.');
assert(restore.includes("DATASET_ORDER.includes(cp.dataset_name)")&&restore.includes('RESTORE_CHECKPOINT_DATASET_MISMATCH'),'Rollback must reject checkpoint datasets outside the canonical dependency contract.');
assert(restore.includes('checkpoint_hash_verified:true'),'Rollback audit metadata must record checkpoint integrity verification.');
assert(!transport.includes("ownership_scope='BUSINESS'")&&!transport.includes("ownership_scope='MIXED'"),'Streaming transport must not introduce company finance scope.');
console.log('Personal Finance Streaming Restore Transport & Fidelity regression checks passed.');
