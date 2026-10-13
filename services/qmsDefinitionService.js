const EFFECTIVE_DEFINITION_STATUSES = Object.freeze(['APPROVED', 'EFFECTIVE']);

function definitionNotEffectivePayload(documentId, sourceRevision) {
  return {
    code: 'QMS_DEFINITION_NOT_EFFECTIVE',
    message: 'An approved or effective controlled-form definition is required for this exact document and source revision.',
    document_id: String(documentId || ''),
    source_revision: String(sourceRevision || '')
  };
}

function respondDefinitionNotEffective(res, documentId, sourceRevision) {
  return res.status(409).json(definitionNotEffectivePayload(documentId, sourceRevision));
}

async function loadEffectiveDefinition(db, documentId, sourceRevision, options = {}) {
  const normalizedDocumentId = String(documentId || '').trim();
  const normalizedRevision = String(sourceRevision || '').trim();
  if (!normalizedDocumentId || !normalizedRevision) return null;
  const lockClause = options.lock === true ? ' FOR SHARE' : '';
  const [[row]] = await db.query(
    `SELECT d.id AS form_definition_id, d.document_id, v.id AS version_id,
            v.revision, v.status, v.definition_json
     FROM qms_form_definitions d
     JOIN qms_form_definition_versions v ON v.form_definition_id = d.id
     WHERE d.document_id = ? AND d.active = 1 AND v.revision = ?
       AND v.status IN ('APPROVED', 'EFFECTIVE')
     LIMIT 1${lockClause}`,
    [normalizedDocumentId, normalizedRevision]
  );
  if (!row) return null;
  const definition = typeof row.definition_json === 'string'
    ? JSON.parse(row.definition_json)
    : row.definition_json;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    const error = new Error('The controlled-form definition is invalid.');
    error.code = 'QMS_DEFINITION_INVALID';
    throw error;
  }
  return {
    formDefinitionId: Number(row.form_definition_id),
    versionId: Number(row.version_id),
    documentId: row.document_id,
    revision: row.revision,
    status: row.status,
    definition
  };
}

module.exports = {
  EFFECTIVE_DEFINITION_STATUSES,
  definitionNotEffectivePayload,
  loadEffectiveDefinition,
  respondDefinitionNotEffective
};
