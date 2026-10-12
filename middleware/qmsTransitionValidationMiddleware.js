const pool = require('../config/db');
const { ensureQmsAdvancedSchema } = require('../services/qmsAdvancedSchema');
const { assertTransitionValidation } = require('../services/qmsValidationService');
const { loadEffectiveDefinition, respondDefinitionNotEffective } = require('../services/qmsDefinitionService');

const CONTROLLED_TRANSITIONS = new Set(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CLOSED']);

function createQmsTransitionValidation(options = {}) {
  const db = options.db || pool;
  const ensureSchema = options.ensureSchema || ensureQmsAdvancedSchema;
  const resolveDefinition = options.resolveDefinition || loadEffectiveDefinition;
  const validateTransition = options.validateTransition || assertTransitionValidation;
  return async function qmsTransitionValidation(req, res, next) {
    try {
      const target = String(req.body?.status || '').trim().toUpperCase();
      if (!CONTROLLED_TRANSITIONS.has(target)) return next();
      await ensureSchema();
      const [[record]] = await db.query(
        'SELECT id, document_id, source_revision, values_json FROM qms_records WHERE id = ? LIMIT 1',
        [req.params.id]
      );
      if (!record) return res.status(404).json({ message: 'Controlled record not found.' });
      const resolved = await resolveDefinition(db, record.document_id, record.source_revision);
      if (!resolved) return respondDefinitionNotEffective(res, record.document_id, record.source_revision);
      const [evidence] = await db.query('SELECT id FROM qms_record_evidence WHERE qms_record_id = ?', [record.id]);
      const values = typeof record.values_json === 'string' ? JSON.parse(record.values_json) : (record.values_json || {});
      const validation = validateTransition({
        targetStatus: target,
        definition: resolved.definition,
        values,
        evidenceByField: evidence.length ? { '*': evidence } : {}
      });
      if (!validation.blockingValid) {
        return res.status(409).json({
          code: 'QMS_BLOCKING_VALIDATION_FAILED',
          message: 'Controlled record cannot progress because mandatory or blocking fields are incomplete.',
          validation
        });
      }
      req.qmsValidation = validation;
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = createQmsTransitionValidation();
module.exports.CONTROLLED_TRANSITIONS = CONTROLLED_TRANSITIONS;
module.exports.createQmsTransitionValidation = createQmsTransitionValidation;
