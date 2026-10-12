const { hasPermission } = require('../services/authorizationService');
const {
  TrashError,
  getTrashItem,
  listTrash,
  permanentDeleteTrashItem,
  restoreTrashItem
} = require('../services/trashService');

function organisationWide(req) {
  return hasPermission(req.user, 'MANAGE_TRASH');
}

function respondError(res, error) {
  if (error instanceof TrashError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code, details: error.details || undefined });
  }
  console.error('TRASH API ERROR:', error);
  return res.status(500).json({ message: 'Trash operation failed', code: 'TRASH_INTERNAL_ERROR' });
}

exports.list = async (req, res) => {
  try {
    const result = await listTrash({
      user: req.user,
      organisationWide: organisationWide(req),
      query: req.query.q,
      module: req.query.module,
      entityType: req.query.entity_type,
      deletedBy: req.query.deleted_by,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      sort: req.query.sort,
      page: req.query.page,
      limit: req.query.limit
    });
    return res.json(result);
  } catch (error) {
    return respondError(res, error);
  }
};

exports.detail = async (req, res) => {
  try {
    const item = await getTrashItem(req.params.trashId, { user: req.user, organisationWide: organisationWide(req) });
    return res.json({ item });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.restore = async (req, res) => {
  try {
    const result = await restoreTrashItem(req.params.trashId, {
      user: req.user,
      organisationWide: organisationWide(req),
      actorId: req.user.id,
      req
    });
    return res.json({ message: 'Record restored successfully', ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.permanentDelete = async (req, res) => {
  try {
    const result = await permanentDeleteTrashItem(req.params.trashId, {
      user: req.user,
      organisationWide: true,
      actorId: req.user.id,
      confirmation: req.body.confirmation,
      reason: req.body.reason,
      req
    });
    return res.json({ message: 'Record permanently deleted', ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

function parseIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 100);
}

exports.bulkRestore = async (req, res) => {
  const ids = parseIds(req.body.trash_ids);
  if (!ids.length) return res.status(400).json({ message: 'Select at least one Trash item' });
  const restored = [];
  const failed = [];
  for (const trashId of ids) {
    try {
      restored.push(await restoreTrashItem(trashId, {
        user: req.user,
        organisationWide: organisationWide(req),
        actorId: req.user.id,
        req
      }));
    } catch (error) {
      failed.push({ trash_id: trashId, code: error.code || 'TRASH_ERROR', message: error.message });
    }
  }
  return res.status(failed.length ? 207 : 200).json({ message: `${restored.length} item(s) restored`, restored, failed });
};

exports.bulkDelete = async (req, res) => {
  const ids = parseIds(req.body.trash_ids);
  if (!ids.length) return res.status(400).json({ message: 'Select at least one Trash item' });
  if (String(req.body.confirmation || '') !== 'PERMANENTLY DELETE') {
    return res.status(400).json({ message: 'Type PERMANENTLY DELETE to confirm', code: 'TRASH_CONFIRMATION_REQUIRED' });
  }
  const purged = [];
  const failed = [];
  for (const trashId of ids) {
    try {
      purged.push(await permanentDeleteTrashItem(trashId, {
        user: req.user,
        organisationWide: true,
        actorId: req.user.id,
        confirmation: req.body.confirmation,
        reason: req.body.reason,
        req
      }));
    } catch (error) {
      failed.push({ trash_id: trashId, code: error.code || 'TRASH_ERROR', message: error.message });
    }
  }
  return res.status(failed.length ? 207 : 200).json({ message: `${purged.length} item(s) permanently deleted`, purged, failed });
};
