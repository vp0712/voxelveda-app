const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  definitionNotEffectivePayload,
  loadEffectiveDefinition
} = require('../services/qmsDefinitionService');
const {
  createQmsTransitionValidation
} = require('../middleware/qmsTransitionValidationMiddleware');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function testDefinitionResolver() {
  let query;
  const db = {
    async query(sql, params) {
      query = { sql, params };
      return [[{
        form_definition_id: 7,
        version_id: 11,
        document_id: 'NCR-01',
        revision: '2.4',
        status: 'EFFECTIVE',
        definition_json: JSON.stringify({ fields: [{ key: 'disposition', required: true }] })
      }]];
    }
  };
  const resolved = await loadEffectiveDefinition(db, ' NCR-01 ', ' 2.4 ', { lock: true });
  assert.deepEqual(query.params, ['NCR-01', '2.4']);
  assert(query.sql.includes('d.active = 1'));
  assert(query.sql.includes("v.status IN ('APPROVED', 'EFFECTIVE')"));
  assert(query.sql.endsWith(' FOR SHARE'));
  assert.equal(resolved.definition.fields[0].key, 'disposition');
  assert.equal(await loadEffectiveDefinition({ query: async () => [[]] }, 'NCR-01', '2.3'), null);
  assert.equal(await loadEffectiveDefinition(db, '', '2.4'), null);
  assert.deepEqual(definitionNotEffectivePayload('NCR-01', '2.3'), {
    code: 'QMS_DEFINITION_NOT_EFFECTIVE',
    message: 'An approved or effective controlled-form definition is required for this exact document and source revision.',
    document_id: 'NCR-01',
    source_revision: '2.3'
  });
}

async function testTransitionMiddleware() {
  const record = {
    id: 42,
    document_id: 'NCR-01',
    source_revision: '2.4',
    values_json: JSON.stringify({ disposition: 'REWORK' })
  };
  const db = {
    async query(sql) {
      if (sql.includes('FROM qms_records')) return [[record]];
      if (sql.includes('FROM qms_record_evidence')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  let nextCalls = 0;
  const missing = createQmsTransitionValidation({
    db,
    ensureSchema: async () => {},
    resolveDefinition: async () => null
  });
  const missingResponse = responseRecorder();
  await missing({ body: { status: 'SUBMITTED' }, params: { id: '42' } }, missingResponse, () => { nextCalls += 1; });
  assert.equal(missingResponse.statusCode, 409);
  assert.equal(missingResponse.body.code, 'QMS_DEFINITION_NOT_EFFECTIVE');
  assert.equal(nextCalls, 0, 'missing definitions must not reach the transition controller');

  let resolverCalls = 0;
  const draft = createQmsTransitionValidation({
    db,
    ensureSchema: async () => {},
    resolveDefinition: async () => { resolverCalls += 1; return null; }
  });
  await draft({ body: { status: 'DRAFT' }, params: { id: '42' } }, responseRecorder(), () => { nextCalls += 1; });
  assert.equal(resolverCalls, 0, 'non-controlled workflow targets do not require the transition gate');

  const valid = createQmsTransitionValidation({
    db,
    ensureSchema: async () => {},
    resolveDefinition: async () => ({ definition: { fields: [] } }),
    validateTransition: () => ({ blockingValid: true, errors: [] })
  });
  const validRequest = { body: { status: 'APPROVED' }, params: { id: '42' } };
  await valid(validRequest, responseRecorder(), () => { nextCalls += 1; });
  assert.equal(validRequest.qmsValidation.blockingValid, true);

  const invalid = createQmsTransitionValidation({
    db,
    ensureSchema: async () => {},
    resolveDefinition: async () => ({ definition: { fields: [] } }),
    validateTransition: () => ({ blockingValid: false, errors: ['required'] })
  });
  const invalidResponse = responseRecorder();
  await invalid({ body: { status: 'CLOSED' }, params: { id: '42' } }, invalidResponse, () => { nextCalls += 1; });
  assert.equal(invalidResponse.statusCode, 409);
  assert.equal(invalidResponse.body.code, 'QMS_BLOCKING_VALIDATION_FAILED');
}

function testAllCreationPathsAreGuarded() {
  const middleware = source('middleware/qmsTransitionValidationMiddleware.js');
  assert(!middleware.includes('if (!version) return next()'));
  assert(middleware.includes('respondDefinitionNotEffective'));

  const activeController = source('controllers/qms/recordController.js');
  assert(activeController.includes('loadEffectiveDefinition(connection,documentId,sourceRevision,{lock:true})'));
  assert(activeController.includes('loadEffectiveDefinition(connection,current.document_id,current.source_revision,{lock:true})'));
  assert(activeController.indexOf('loadEffectiveDefinition(connection,documentId,sourceRevision,{lock:true})') < activeController.indexOf('INSERT INTO qms_records'));

  const operations = source('controllers/qmsOperationsController.js');
  assert(operations.includes('definitionReferences'));
  assert(operations.includes('loadEffectiveDefinition(connection, documentId, sourceRevision, { lock: true })'));

  const legacyController = source('controllers/qmsRecordController.js');
  assert(legacyController.includes('loadEffectiveDefinition(connection, documentId, sourceRevision, { lock: true })'));
  assert(legacyController.indexOf('loadEffectiveDefinition(connection, documentId, sourceRevision, { lock: true })') < legacyController.indexOf('INSERT INTO qms_records'));

  const routes = source('routes/qmsRoutes.js');
  assert(routes.includes("require('../controllers/qms/recordController')"));
  assert(routes.includes('qmsTransitionValidation'));
}

async function run() {
  await testDefinitionResolver();
  await testTransitionMiddleware();
  testAllCreationPathsAreGuarded();
  console.log('Wave B PR3 QMS fail-closed validation tests passed.');
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
