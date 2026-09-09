const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { logAudit, stableJsonText } = require('./auditService');
const { hasAnyPermission } = require('./authorizationService');
const { ensureTrashEntitySchema, ensureTrashSchema } = require('./trashSchema');

const RETENTION_DAYS = 15;

const ENTITY_CONFIGS = Object.freeze({
  customer: { table: 'customers', module: 'Customers', displayColumn: 'company_name', uniqueColumns: ['email'], legacyDeleted: true, permissions: ['VIEW_CUSTOMERS'] },
  supplier: { table: 'suppliers', module: 'Suppliers', displayColumn: 'supplier_name', uniqueColumns: ['email'], legacyDeleted: true, permissions: ['VIEW_SUPPLIERS'] },
  meeting: { table: 'meetings', module: 'Meetings', displayColumn: 'title', uniqueColumns: [], legacyDeleted: true, permissions: ['VIEW_MEETINGS'] },
  task: { table: 'tasks', module: 'Tasks', displayColumn: 'title', uniqueColumns: [], legacyDeleted: true, permissions: ['VIEW_OWN_JOBS', 'MANAGE_TEAM_JOBS', 'MANAGE_JOBS'] },
  announcement: { table: 'announcements', module: 'Announcements', displayColumn: 'title', uniqueColumns: [], legacyDeleted: true, permissions: ['VIEW_DASHBOARD'] },
  staff_message: { table: 'staff_messages', module: 'Messages', displayColumn: 'body', uniqueColumns: [], legacyDeleted: true, permissions: ['MANAGE_JOBS'] },
  staff_work_request: { table: 'staff_work_requests', module: 'Workforce', displayColumn: 'title', uniqueColumns: [], legacyDeleted: true, permissions: ['MANAGE_JOBS'] },
  notification: { table: 'notifications', module: 'Notifications', displayColumn: 'title', uniqueColumns: [], legacyDeleted: false }
});

class TrashError extends Error {
  constructor(message, code = 'TRASH_ERROR', statusCode = 400, details = null) {
    super(message);
    this.name = 'TrashError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function entityConfig(entityType) {
  const clean = String(entityType || '').trim().toLowerCase();
  const config = ENTITY_CONFIGS[clean];
  if (!config) throw new TrashError('This record type is not eligible for Trash.', 'TRASH_ENTITY_NOT_SUPPORTED', 400);
  return { ...config, entityType: clean };
}

function requestAuditContext(req) {
  return {
    ipAddress: req?.ip || null,
    userAgent: req?.get?.('user-agent') || null,
    requestId: req?.requestId || req?.get?.('x-request-id') || null,
    sessionId: req?.session?.id || null
  };
}

function integrityHash(item) {
  const payload = [
    item.trashUuid,
    item.entityType,
    String(item.entityId),
    item.deletedBy == null ? '' : String(item.deletedBy),
    item.deletedAt instanceof Date ? item.deletedAt.toISOString() : String(item.deletedAt || ''),
    item.purgeAt instanceof Date ? item.purgeAt.toISOString() : String(item.purgeAt || ''),
    item.deleteReason || '',
    item.metadataJson || ''
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normaliseDisplayName(value, entityType, entityId) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return (clean || `${entityType} #${entityId}`).slice(0, 255);
}

function normaliseReason(value) {
  const clean = String(value || '').trim();
  return clean ? clean.slice(0, 2000) : null;
}

function isCriticalSecurityNotification(record) {
  return String(record?.category || '').toUpperCase() === 'SECURITY'
    && String(record?.priority || '').toUpperCase() === 'CRITICAL';
}

function metadataObject(item) {
  try {
    const parsed = JSON.parse(item?.metadata_json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function retentionPolicy(connection, config, record) {
  if (isCriticalSecurityNotification(record)) {
    return { hold: 1, reason: 'Critical security notification retention policy' };
  }
  if (config.entityType === 'supplier') {
    try {
      const [[row]] = await connection.query('SELECT COUNT(*) AS total FROM supplier_bills WHERE supplier_id = ?', [record.id]);
      if (Number(row?.total || 0) > 0) {
        return { hold: 1, reason: 'Supplier is referenced by retained financial records' };
      }
    } catch (error) {
      if (error?.code !== 'ER_NO_SUCH_TABLE') throw error;
    }
  }
  return { hold: 0, reason: null };
}

async function purgeDependentData(connection, item) {
  if (item.entity_type !== 'supplier') return [];
  try {
    const [files] = await connection.query('SELECT file_path FROM supplier_files WHERE supplier_id = ?', [item.entity_id]);
    await connection.query('DELETE FROM supplier_files WHERE supplier_id = ?', [item.entity_id]);
    return files.map((file) => file.file_path).filter(Boolean);
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') throw error;
    return [];
  }
}

async function removeStoredSupplierFiles(filePaths) {
  const supplierUploadRoot = path.resolve(__dirname, '..', 'uploads', 'suppliers');
  for (const storedPath of filePaths) {
    const resolved = path.resolve(__dirname, '..', String(storedPath).replace(/^[/\\]+/, ''));
    if (resolved !== supplierUploadRoot && !resolved.startsWith(`${supplierUploadRoot}${path.sep}`)) continue;
    await fs.promises.unlink(resolved).catch((error) => {
      if (error?.code !== 'ENOENT') console.error(`Supplier attachment cleanup failed for ${resolved}:`, error.message);
    });
  }
}

async function moveToTrash(options) {
  const config = entityConfig(options.entityType);
  const entityId = String(options.entityId || '').trim();
  if (!entityId) throw new TrashError('Record ID is required.', 'TRASH_ENTITY_ID_REQUIRED', 400);

  await ensureTrashSchema();
  if (!await ensureTrashEntitySchema(config.table)) {
    throw new TrashError('The source module is not available.', 'TRASH_SOURCE_NOT_FOUND', 404);
  }

  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  if (ownsConnection) await connection.beginTransaction();

  try {
    const activePredicate = config.legacyDeleted ? 'IFNULL(deleted, 0) = 0' : 'deleted_at IS NULL';
    const [[record]] = await connection.query(
      `SELECT * FROM \`${config.table}\` WHERE id = ? AND ${activePredicate} LIMIT 1 FOR UPDATE`,
      [entityId]
    );
    if (!record) throw new TrashError('Record not found or already in Trash.', 'TRASH_RECORD_NOT_FOUND', 404);

    if (typeof options.authorize === 'function' && !await options.authorize(record, connection)) {
      throw new TrashError('You are not allowed to delete this record.', 'TRASH_SCOPE_DENIED', 403);
    }

    const deletedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const purgeAt = new Date(deletedAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const trashUuid = crypto.randomUUID();
    const retention = await retentionPolicy(connection, config, record);
    const metadata = {
      source_status: record.status || null,
      category: record.category || null,
      priority: record.priority || null,
      owner_user_id: record.user_id || record.assigned_to || null,
      retention_hold_reason: retention.reason,
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {})
    };
    const metadataJson = stableJsonText(metadata);
    const deleteReason = normaliseReason(options.reason);
    const deletion = {
      trashUuid,
      entityType: config.entityType,
      entityId,
      deletedBy: options.actorId || null,
      deletedAt,
      purgeAt,
      deleteReason,
      metadataJson
    };
    const hold = retention.hold;

    await connection.query(
      `UPDATE \`${config.table}\`
       SET ${config.legacyDeleted ? 'deleted = 1,' : ''}
           deleted_at = ?, deleted_by = ?, delete_reason = ?, purge_after = ?
       WHERE id = ? AND ${activePredicate}`,
      [deletedAt, options.actorId || null, deleteReason, purgeAt, entityId]
    );

    await connection.query(
      `INSERT INTO trash_items
       (trash_uuid, entity_type, entity_id, entity_display_name, source_module,
        original_parent_type, original_parent_id, deleted_by, deleted_at, delete_reason,
        purge_at, restore_status, metadata_json, integrity_hash, retention_hold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      [
        trashUuid,
        config.entityType,
        entityId,
        normaliseDisplayName(record[config.displayColumn], config.entityType, entityId),
        config.module,
        options.parentType || null,
        options.parentId ? String(options.parentId) : null,
        options.actorId || null,
        deletedAt,
        deleteReason,
        purgeAt,
        metadataJson,
        integrityHash(deletion),
        hold
      ]
    );

    await logAudit(connection, {
      actorId: options.actorId || null,
      action: 'MOVED_TO_TRASH',
      module: 'Trash',
      recordType: config.entityType,
      recordId: entityId,
      oldValue: { deleted: false, source_module: config.module },
      newValue: { deleted: true, trash_uuid: trashUuid, purge_at: purgeAt, retention_hold: Boolean(hold) },
      metadata: { reason: deleteReason, source_module: config.module },
      ...requestAuditContext(options.req)
    });

    if (ownsConnection) await connection.commit();
    return { trash_uuid: trashUuid, purge_at: purgeAt, retention_hold: Boolean(hold) };
  } catch (error) {
    if (ownsConnection) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

function buildTrashScope(user, organisationWide) {
  if (organisationWide) return { sql: '', params: [] };
  const allowedTypes = Object.entries(ENTITY_CONFIGS)
    .filter(([, config]) => !config.permissions?.length || hasAnyPermission(user, config.permissions))
    .map(([entityType]) => entityType);
  if (!allowedTypes.length) return { sql: ' AND 1 = 0', params: [] };
  const actorId = Number(user?.id || 0);
  const actorScope = hasAnyPermission(user, ['MANAGE_TEAM_JOBS'])
    ? '(ti.deleted_by = ? OR ti.deleted_by IN (SELECT id FROM users WHERE manager_id = ? AND active = 1 AND deleted_at IS NULL))'
    : 'ti.deleted_by = ?';
  return {
    sql: ` AND ${actorScope} AND ti.entity_type IN (${allowedTypes.map(() => '?').join(',')})`,
    params: hasAnyPermission(user, ['MANAGE_TEAM_JOBS'])
      ? [actorId, actorId, ...allowedTypes]
      : [actorId, ...allowedTypes]
  };
}

async function listTrash(options = {}) {
  await ensureTrashSchema();
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(100, Math.max(1, Number(options.limit || 25)));
  const offset = (page - 1) * limit;
  const where = ["ti.restore_status = 'ACTIVE'"];
  const params = [];
  const scope = buildTrashScope(options.user, options.organisationWide);

  if (options.query) {
    where.push('(ti.entity_display_name LIKE ? OR ti.entity_id LIKE ? OR ti.source_module LIKE ?)');
    const term = `%${String(options.query).trim().slice(0, 120)}%`;
    params.push(term, term, term);
  }
  if (options.module) { where.push('ti.source_module = ?'); params.push(String(options.module).slice(0, 100)); }
  if (options.entityType) { where.push('ti.entity_type = ?'); params.push(String(options.entityType).toLowerCase().slice(0, 80)); }
  if (options.deletedBy && options.organisationWide) { where.push('ti.deleted_by = ?'); params.push(Number(options.deletedBy)); }
  if (options.dateFrom) { where.push('ti.deleted_at >= ?'); params.push(String(options.dateFrom).slice(0, 10)); }
  if (options.dateTo) { where.push('ti.deleted_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(String(options.dateTo).slice(0, 10)); }

  const orderBy = {
    deleted_asc: 'ti.deleted_at ASC',
    purge_asc: 'ti.purge_at ASC',
    purge_desc: 'ti.purge_at DESC'
  }[options.sort] || 'ti.deleted_at DESC';
  const whereSql = `${where.join(' AND ')}${scope.sql}`;
  const queryParams = [...params, ...scope.params];
  const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM trash_items ti WHERE ${whereSql}`, queryParams);
  const [items] = await pool.query(
    `SELECT ti.id, ti.trash_uuid, ti.entity_type, ti.entity_id, ti.entity_display_name,
            ti.source_module, ti.original_parent_type, ti.original_parent_id,
            ti.deleted_by, ti.deleted_at, ti.delete_reason, ti.purge_at,
            ti.retention_hold, ti.purge_attempts, ti.purge_error, ti.metadata_json,
            GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), ti.purge_at)) AS remaining_seconds,
            u.name AS deleted_by_name, u.email AS deleted_by_email
     FROM trash_items ti
     LEFT JOIN users u ON u.id = ti.deleted_by
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset]
  );

  const safeItems = items.map((item) => {
    const metadata = metadataObject(item);
    return { ...item, retention_hold_reason: metadata.retention_hold_reason || null, metadata_json: undefined };
  });
  return { items: safeItems, page, limit, total: Number(countRow?.total || 0), pages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit)) };
}

async function getTrashItem(trashId, options = {}, db = pool) {
  await ensureTrashSchema();
  const key = String(trashId || '').trim();
  const idPredicate = /^\d+$/.test(key) ? 'ti.id = ?' : 'ti.trash_uuid = ?';
  const scope = buildTrashScope(options.user, options.organisationWide);
  const [[item]] = await db.query(
    `SELECT ti.*, GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), ti.purge_at)) AS remaining_seconds,
            u.name AS deleted_by_name, u.email AS deleted_by_email
     FROM trash_items ti
     LEFT JOIN users u ON u.id = ti.deleted_by
     WHERE ${idPredicate}${scope.sql} LIMIT 1${options.lock ? ' FOR UPDATE' : ''}`,
    [key, ...scope.params]
  );
  if (!item) throw new TrashError('Trash item not found.', 'TRASH_ITEM_NOT_FOUND', 404);
  return item;
}

async function findActiveTrashItem(entityType, entityId, userId, db = pool) {
  await ensureTrashSchema();
  const [[item]] = await db.query(
    `SELECT * FROM trash_items
     WHERE entity_type = ? AND entity_id = ? AND restore_status = 'ACTIVE' AND deleted_by = ?
     ORDER BY id DESC LIMIT 1`,
    [String(entityType).toLowerCase(), String(entityId), Number(userId)]
  );
  return item || null;
}

function verifyTrashIntegrity(item) {
  const actual = integrityHash({
    trashUuid: item.trash_uuid,
    entityType: item.entity_type,
    entityId: item.entity_id,
    deletedBy: item.deleted_by,
    deletedAt: item.deleted_at,
    purgeAt: item.purge_at,
    deleteReason: item.delete_reason,
    metadataJson: item.metadata_json
  });
  if (actual !== item.integrity_hash) {
    throw new TrashError('Trash integrity verification failed.', 'TRASH_INTEGRITY_FAILED', 409);
  }
}

async function findRestoreConflict(connection, config, record, entityId) {
  for (const column of config.uniqueColumns) {
    const value = record[column];
    if (value == null || String(value).trim() === '') continue;
    const [[conflict]] = await connection.query(
      `SELECT id FROM \`${config.table}\`
       WHERE id <> ? AND IFNULL(deleted, 0) = 0 AND LOWER(\`${column}\`) = LOWER(?) LIMIT 1`,
      [entityId, value]
    );
    if (conflict) return { field: column, conflicting_record_id: conflict.id };
  }
  return null;
}

async function restoreTrashItem(trashId, options = {}) {
  await ensureTrashSchema();
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const item = await getTrashItem(trashId, { user: options.user, organisationWide: options.organisationWide, lock: true }, connection);
    if (item.restore_status !== 'ACTIVE') throw new TrashError('This item is no longer available to restore.', 'TRASH_NOT_ACTIVE', 409);
    if (new Date(item.purge_at).getTime() <= Date.now()) throw new TrashError('The restore period has expired.', 'TRASH_RESTORE_EXPIRED', 410);
    verifyTrashIntegrity(item);

    const config = entityConfig(item.entity_type);
    const [[record]] = await connection.query(`SELECT * FROM \`${config.table}\` WHERE id = ? LIMIT 1 FOR UPDATE`, [item.entity_id]);
    if (!record) throw new TrashError('The source record no longer exists.', 'TRASH_SOURCE_MISSING', 409);
    const conflict = await findRestoreConflict(connection, config, record, item.entity_id);
    if (conflict) throw new TrashError('Restore needs manual resolution because a newer record uses the same identifier.', 'TRASH_RESTORE_CONFLICT', 409, conflict);

    await connection.query(
      `UPDATE \`${config.table}\`
       SET ${config.legacyDeleted ? 'deleted = 0,' : ''}
           deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, purge_after = NULL
       WHERE id = ?`,
      [item.entity_id]
    );
    await connection.query(
      `UPDATE trash_items SET restore_status = 'RESTORED', restored_by = ?, restored_at = NOW(), purge_error = NULL
       WHERE id = ? AND restore_status = 'ACTIVE'`,
      [options.actorId || null, item.id]
    );

    await logAudit(connection, {
      actorId: options.actorId || null,
      action: 'RESTORED_FROM_TRASH',
      module: 'Trash',
      recordType: item.entity_type,
      recordId: item.entity_id,
      oldValue: { deleted: true, trash_uuid: item.trash_uuid },
      newValue: { deleted: false, source_module: item.source_module },
      metadata: { trash_id: item.id },
      ...requestAuditContext(options.req)
    });
    await connection.commit();
    return { restored: true, entity_type: item.entity_type, entity_id: item.entity_id, source_module: item.source_module };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function permanentDeleteTrashItem(trashId, options = {}) {
  if (!options.system && String(options.confirmation || '') !== 'PERMANENTLY DELETE') {
    throw new TrashError('Type PERMANENTLY DELETE to confirm.', 'TRASH_CONFIRMATION_REQUIRED', 400);
  }
  await ensureTrashSchema();
  const connection = await pool.getConnection();
  let storedFilePaths = [];
  await connection.beginTransaction();
  try {
    const item = options.system
      ? await getTrashItem(trashId, { organisationWide: true, lock: true }, connection)
      : await getTrashItem(trashId, { user: options.user, organisationWide: options.organisationWide, lock: true }, connection);
    if (item.restore_status !== 'ACTIVE') throw new TrashError('This item is no longer active in Trash.', 'TRASH_NOT_ACTIVE', 409);
    if (Number(item.retention_hold) === 1) {
      const holdReason = metadataObject(item).retention_hold_reason;
      throw new TrashError(
        holdReason ? `This record cannot be erased: ${holdReason}.` : 'This record is under a retention hold and cannot be permanently erased.',
        'TRASH_RETENTION_HOLD',
        409
      );
    }
    verifyTrashIntegrity(item);
    const config = entityConfig(item.entity_type);
    storedFilePaths = await purgeDependentData(connection, item);
    await connection.query(`DELETE FROM \`${config.table}\` WHERE id = ? AND deleted_at IS NOT NULL`, [item.entity_id]);
    await connection.query(
      `UPDATE trash_items SET restore_status = 'PURGED', purged_at = NOW(), purge_error = NULL WHERE id = ?`,
      [item.id]
    );
    await logAudit(connection, {
      actorId: options.actorId || null,
      action: options.system ? 'TRASH_RETENTION_PURGE' : 'TRASH_PERMANENT_DELETE',
      module: 'Trash',
      recordType: item.entity_type,
      recordId: item.entity_id,
      oldValue: { trash_uuid: item.trash_uuid, integrity_hash: item.integrity_hash },
      newValue: { permanently_deleted: true },
      metadata: { reason: normaliseReason(options.reason), automatic: Boolean(options.system) },
      ...requestAuditContext(options.req)
    });
    await connection.commit();
    await removeStoredSupplierFiles(storedFilePaths);
    return { purged: true, entity_type: item.entity_type, entity_id: item.entity_id };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function recordPurgeFailure(trashId, error) {
  await pool.query(
    `UPDATE trash_items SET purge_attempts = purge_attempts + 1, purge_error = ?
     WHERE id = ? AND restore_status = 'ACTIVE'`,
    [String(error?.message || 'Unknown purge failure').slice(0, 2000), trashId]
  );
}

module.exports = {
  ENTITY_CONFIGS,
  RETENTION_DAYS,
  TrashError,
  findActiveTrashItem,
  getTrashItem,
  listTrash,
  moveToTrash,
  permanentDeleteTrashItem,
  recordPurgeFailure,
  restoreTrashItem
};
