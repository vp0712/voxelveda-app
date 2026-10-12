'use strict';

const permittedColumns = new Map([
  ['sds_versions', 'secure_document_id'],
  ['qms_evidence_index', 'secure_document_id'],
  ['document_revisions', 'secure_document_id'],
  ['qms_record_evidence', 'document_security_id']
]);

async function ensureUuidDocumentReference(db, table) {
  const column = permittedColumns.get(table);
  if (!column) throw new Error('Unsupported original document reference table.');
  const [[metadata]] = await db.query(
    'SELECT DATA_TYPE data_type,CHARACTER_MAXIMUM_LENGTH max_length,IS_NULLABLE is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
    [table, column]
  );
  if (!metadata || metadata.is_nullable !== 'YES') throw new Error(`Original document reference ${table}.${column} has an unsupported schema.`);
  if (['tinyint','smallint','mediumint','int','bigint'].includes(metadata.data_type) || (['char','varchar'].includes(metadata.data_type) && Number(metadata.max_length) < 36)) {
    // Widening keeps legacy numeric references and accepts retained document UUIDs.
    await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} VARCHAR(36) NULL`);
  } else if (!['char','varchar'].includes(metadata.data_type)) {
    throw new Error(`Original document reference ${table}.${column} requires schema review.`);
  }
}

module.exports = { ensureUuidDocumentReference };
