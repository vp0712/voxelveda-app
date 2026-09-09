const assert = require('node:assert/strict');
const path = require('node:path');

const records = {
  customers: new Map(),
  suppliers: new Map(),
  notifications: new Map()
};
const trashItems = [];
const audits = [];
const supplierBillOwners = new Set();
const supplierFileOwners = new Set();
const lockedTrashReads = [];

function sourceTable(sql) {
  const match = sql.match(/`(customers|suppliers|notifications)`/);
  return match?.[1] || null;
}

function activeRecord(table, id) {
  const record = records[table].get(String(id));
  if (!record) return null;
  if (table === 'notifications') return record.deleted_at == null ? record : null;
  return Number(record.deleted || 0) === 0 ? record : null;
}

const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    const table = sourceTable(compact);

    if (/^SELECT \* FROM `(customers|suppliers|notifications)` WHERE id = \? AND/.test(compact)) {
      return [[activeRecord(table, params[0])]];
    }
    if (/^UPDATE `(customers|suppliers|notifications)` SET/.test(compact) && /deleted_at = \?/.test(compact)) {
      const record = records[table].get(String(params[4]));
      if (record) {
        if (table !== 'notifications') record.deleted = 1;
        [record.deleted_at, record.deleted_by, record.delete_reason, record.purge_after] = params.slice(0, 4);
      }
      return [{ affectedRows: record ? 1 : 0 }];
    }
    if (/^INSERT INTO trash_items/.test(compact)) {
      const [trashUuid, entityType, entityId, entityDisplayName, module, parentType, parentId, deletedBy, deletedAt, deleteReason, purgeAt, metadataJson, integrityHash, retentionHold] = params;
      trashItems.push({
        id: trashItems.length + 1,
        trash_uuid: trashUuid,
        entity_type: entityType,
        entity_id: String(entityId),
        entity_display_name: entityDisplayName,
        source_module: module,
        original_parent_type: parentType,
        original_parent_id: parentId,
        deleted_by: deletedBy,
        deleted_at: deletedAt,
        delete_reason: deleteReason,
        purge_at: purgeAt,
        restore_status: 'ACTIVE',
        metadata_json: metadataJson,
        integrity_hash: integrityHash,
        retention_hold: retentionHold,
        purge_attempts: 0,
        purge_error: null
      });
      return [{ insertId: trashItems.length }];
    }
    if (/^SELECT COUNT\(\*\) AS total FROM supplier_bills/.test(compact)) {
      return [[{ total: supplierBillOwners.has(String(params[0])) ? 1 : 0 }]];
    }
    if (/^SELECT ti\.\*/.test(compact) && /FROM trash_items ti/.test(compact)) {
      lockedTrashReads.push(/FOR UPDATE$/.test(compact));
      const item = trashItems.find((entry) => String(entry.id) === String(params[0]) || entry.trash_uuid === String(params[0]));
      return [[item]];
    }
    if (/^SELECT \* FROM `(customers|suppliers|notifications)` WHERE id = \? LIMIT 1 FOR UPDATE/.test(compact)) {
      return [[records[table].get(String(params[0])) || null]];
    }
    if (/^SELECT id FROM `customers`/.test(compact)) {
      const [entityId, value] = params;
      const conflict = [...records.customers.values()].find((record) => String(record.id) !== String(entityId)
        && Number(record.deleted || 0) === 0
        && String(record.email || '').toLowerCase() === String(value || '').toLowerCase());
      return [[conflict ? { id: conflict.id } : null]];
    }
    if (/^UPDATE `(customers|suppliers|notifications)` SET/.test(compact) && /deleted_at = NULL/.test(compact)) {
      const record = records[table].get(String(params[0]));
      if (record) Object.assign(record, { deleted: 0, deleted_at: null, deleted_by: null, delete_reason: null, purge_after: null });
      return [{ affectedRows: record ? 1 : 0 }];
    }
    if (/^UPDATE trash_items SET restore_status = 'RESTORED'/.test(compact)) {
      const item = trashItems.find((entry) => Number(entry.id) === Number(params[1]));
      if (item) Object.assign(item, { restore_status: 'RESTORED', restored_by: params[0], restored_at: new Date(), purge_error: null });
      return [{ affectedRows: item ? 1 : 0 }];
    }
    if (/^SELECT file_path FROM supplier_files/.test(compact)) {
      return [supplierFileOwners.has(String(params[0])) ? [{ file_path: '/uploads/suppliers/missing-lifecycle-test-file.pdf' }] : []];
    }
    if (/^DELETE FROM supplier_files/.test(compact)) {
      return [{ affectedRows: supplierFileOwners.delete(String(params[0])) ? 1 : 0 }];
    }
    if (/^DELETE FROM `(customers|suppliers|notifications)`/.test(compact)) {
      const deleted = records[table].delete(String(params[0]));
      return [{ affectedRows: deleted ? 1 : 0 }];
    }
    if (/^UPDATE trash_items SET restore_status = 'PURGED'/.test(compact)) {
      const item = trashItems.find((entry) => Number(entry.id) === Number(params[0]));
      if (item) Object.assign(item, { restore_status: 'PURGED', purged_at: new Date(), purge_error: null });
      return [{ affectedRows: item ? 1 : 0 }];
    }
    throw new Error(`Unhandled lifecycle-test query: ${compact}`);
  }
};

const pool = { getConnection: async () => connection };

function mockModule(relativePath, exports) {
  const filename = require.resolve(path.join(__dirname, relativePath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule('../config/db', pool);
mockModule('../services/auditService', {
  stableJsonText: (value) => JSON.stringify(value),
  logAudit: async (_db, event) => audits.push(event)
});
mockModule('../services/authorizationService', { hasAnyPermission: () => true });
mockModule('../services/trashSchema', {
  ensureTrashSchema: async () => true,
  ensureTrashEntitySchema: async () => true
});

const {
  RETENTION_DAYS,
  moveToTrash,
  permanentDeleteTrashItem,
  restoreTrashItem
} = require('../services/trashService');

async function expectTrashError(work, code) {
  await assert.rejects(work, (error) => error?.code === code);
}

async function run() {
  assert.equal(RETENTION_DAYS, 15);
  records.customers.set('1', { id: 1, company_name: 'Lifecycle Customer', email: 'lifecycle@example.com', deleted: 0 });

  const moved = await moveToTrash({ entityType: 'customer', entityId: 1, actorId: 42, reason: 'Lifecycle test' });
  assert.equal(records.customers.get('1').deleted, 1);
  assert.equal(Math.round((new Date(moved.purge_at).getTime() - Date.now()) / 86400000), 15);
  assert.equal(audits.at(-1).action, 'MOVED_TO_TRASH');

  await restoreTrashItem(1, { actorId: 42, organisationWide: true });
  assert.equal(lockedTrashReads.at(-1), true);
  assert.equal(records.customers.get('1').deleted, 0);
  assert.equal(trashItems[0].restore_status, 'RESTORED');
  assert.equal(audits.at(-1).action, 'RESTORED_FROM_TRASH');

  await moveToTrash({ entityType: 'customer', entityId: 1, actorId: 42, reason: 'Permanent cleanup test' });
  await expectTrashError(() => permanentDeleteTrashItem(2, { actorId: 42, organisationWide: true }), 'TRASH_CONFIRMATION_REQUIRED');
  await permanentDeleteTrashItem(2, { actorId: 42, organisationWide: true, confirmation: 'PERMANENTLY DELETE' });
  assert.equal(lockedTrashReads.at(-1), true);
  assert.equal(records.customers.has('1'), false);
  assert.equal(trashItems[1].restore_status, 'PURGED');
  assert.equal(audits.at(-1).action, 'TRASH_PERMANENT_DELETE');

  records.customers.set('3', { id: 3, company_name: 'Original Customer', email: 'conflict@example.com', deleted: 0 });
  await moveToTrash({ entityType: 'customer', entityId: 3, actorId: 42, reason: 'Conflict test' });
  records.customers.set('4', { id: 4, company_name: 'Replacement Customer', email: 'conflict@example.com', deleted: 0 });
  await expectTrashError(() => restoreTrashItem(3, { actorId: 42, organisationWide: true }), 'TRASH_RESTORE_CONFLICT');
  assert.equal(records.customers.get('3').deleted, 1);

  records.notifications.set('9', { id: 9, title: 'Critical sign-in alert', category: 'SECURITY', priority: 'CRITICAL', deleted_at: null });
  const held = await moveToTrash({ entityType: 'notification', entityId: 9, actorId: 42, reason: 'Security hold test' });
  assert.equal(held.retention_hold, true);
  await expectTrashError(
    () => permanentDeleteTrashItem(4, { actorId: 42, organisationWide: true, confirmation: 'PERMANENTLY DELETE' }),
    'TRASH_RETENTION_HOLD'
  );
  assert.equal(records.notifications.has('9'), true);

  records.suppliers.set('5', { id: 5, supplier_name: 'Financial Supplier', email: 'finance@example.com', deleted: 0 });
  supplierBillOwners.add('5');
  const protectedSupplier = await moveToTrash({ entityType: 'supplier', entityId: 5, actorId: 42, reason: 'Supplier retention test' });
  assert.equal(protectedSupplier.retention_hold, true);
  await expectTrashError(
    () => permanentDeleteTrashItem(5, { actorId: 42, organisationWide: true, confirmation: 'PERMANENTLY DELETE' }),
    'TRASH_RETENTION_HOLD'
  );

  records.suppliers.set('6', { id: 6, supplier_name: 'Temporary Supplier', email: 'temporary@example.com', deleted: 0 });
  supplierFileOwners.add('6');
  await moveToTrash({ entityType: 'supplier', entityId: 6, actorId: 42, reason: 'Supplier purge test' });
  await permanentDeleteTrashItem(6, { actorId: 42, organisationWide: true, confirmation: 'PERMANENTLY DELETE' });
  assert.equal(records.suppliers.has('6'), false);
  assert.equal(supplierFileOwners.has('6'), false);

  console.log('ERP Wave 1 Trash lifecycle test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
