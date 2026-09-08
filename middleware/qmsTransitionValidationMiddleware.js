const pool = require('../config/db');
const { ensureQmsAdvancedSchema } = require('../services/qmsAdvancedSchema');
const { assertTransitionValidation } = require('../services/qmsValidationService');

module.exports = async function qmsTransitionValidation(req, res, next) {
  try {
    const target = String(req.body?.status || '').trim().toUpperCase();
    if (!['SUBMITTED','UNDER_REVIEW','APPROVED','CLOSED'].includes(target)) return next();
    await ensureQmsAdvancedSchema();
    const [[record]] = await pool.query('SELECT * FROM qms_records WHERE id=? LIMIT 1', [req.params.id]);
    if (!record) return res.status(404).json({ message: 'Controlled record not found.' });
    const [[version]] = await pool.query(`SELECT v.definition_json FROM qms_form_definitions d
      JOIN qms_form_definition_versions v ON v.form_definition_id=d.id
      WHERE d.document_id=? AND v.revision=? AND v.status IN ('APPROVED','EFFECTIVE') LIMIT 1`, [record.document_id, record.source_revision]);
    if (!version) return next();
    const [evidence] = await pool.query('SELECT id FROM qms_record_evidence WHERE qms_record_id=?', [record.id]);
    const definition = typeof version.definition_json === 'string' ? JSON.parse(version.definition_json) : version.definition_json;
    const values = typeof record.values_json === 'string' ? JSON.parse(record.values_json) : (record.values_json || {});
    const validation = assertTransitionValidation({ targetStatus: target, definition, values, evidenceByField: evidence.length ? { '*': evidence } : {} });
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
