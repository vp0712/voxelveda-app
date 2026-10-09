const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hasPermission } = require('../services/authorizationService');
const retirement = require('../services/applicationRetirement');

async function run() {
  const body = Buffer.from('Fixture enquiry evidence\nOnly retained documents may be read.');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const documents = new Map();
  const grants = new Map();
  const queries = [];
  const storage = [];
  const events = [];
  const transactions = [];
  let schemaChecks = 0;
  let documentSequence = 0;
  function document(module, overrides = {}) {
    const id = `10000000-0000-4000-8000-${String(++documentSequence).padStart(12, '0')}`;
    const row = {
      id, module, record_type: 'evidence', record_id: '42', owner_user_id: 20,
      uploaded_by: 20, original_name: 'enquiry.txt', stored_name: 'enquiry.txt',
      storage_path: 's3://fixture/' + id, mime_type: 'text/plain', size_bytes: body.length,
      content_sha256: sha256, classification: 'CONFIDENTIAL', access_policy: 'MODULE_OR_OWNER',
      scan_status: 'CLEAN', deleted_at: null, ...overrides
    };
    documents.set(id, row);
    return row;
  }
  function grant(row, token, overrides = {}) {
    const item = {
      id: crypto.randomUUID(), document_id: row.id, bound_user_id: 20,
      token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      expires_at: '2099-01-01T00:00:00.000Z', used_at: null, ...overrides
    };
    grants.set(item.token_hash, item);
    return item;
  }
  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params: [...params] });
      if (/SELECT \* FROM secure_documents/.test(sql)) {
        const row = documents.get(params[0]);
        return [[row && (!/deleted_at IS NULL/.test(sql) || !row.deleted_at) ? row : undefined]];
      }
      if (/SELECT \* FROM document_download_grants/.test(sql)) {
        const row = grants.get(params[0]);
        return [[row && row.bound_user_id === params[1] ? row : undefined]];
      }
      if (/UPDATE document_download_grants SET used_at/.test(sql)) {
        const row = [...grants.values()].find((item) => item.id === params[0]);
        if (row && !row.used_at) row.used_at = '2026-10-09T00:00:00.000Z';
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (/INSERT INTO document_download_grants/.test(sql)) {
        grants.set(params[2], { id: params[0], document_id: params[1], token_hash: params[2], bound_user_id: params[3], expires_at: '2099-01-01T00:00:00.000Z', used_at: null });
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO secure_documents/.test(sql)) {
        documents.set(params[0], {
          id: params[0], module: params[1], record_type: params[2], record_id: params[3],
          owner_user_id: params[4], uploaded_by: params[5], original_name: params[6], stored_name: params[7],
          storage_path: params[8], mime_type: params[9], size_bytes: params[10], content_sha256: params[11],
          classification: params[12], access_policy: params[13], scan_status: params[14], deleted_at: null
        });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE secure_documents SET deleted_at/.test(sql)) {
        documents.get(params[0]).deleted_at = '2026-10-09T00:00:00.000Z';
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected document query: ' + sql);
    },
    async getConnection() {
      return {
        query: db.query.bind(db),
        async beginTransaction() { transactions.push('begin'); },
        async rollback() { transactions.push('rollback'); },
        async commit() { transactions.push('commit'); },
        release() { transactions.push('release'); }
      };
    }
  };
  const filename = path.join(__dirname, '..', 'services/documentSecurityService.js');
  const moduleFixture = { exports: {} };
  const dependencies = {
    crypto, path,
    fs: {
      existsSync(file) { storage.push(['exists', file]); return true; },
      promises: {
        async readFile(file) { storage.push(['readFile', file]); return body; },
        async unlink(file) { storage.push(['unlink', file]); }
      },
      createReadStream(file) { storage.push(['stream', file]); return { pipe(res) { res.end(body); return res; } }; }
    },
    '../config/db': db,
    './authorizationService': { hasPermission },
    './securityOperationsSchema': { async ensureSecurityOperationsSchema() { schemaChecks += 1; } },
    './malwareScanService': { currentScanStatus: () => 'CLEAN', async queueDocumentScan() { throw new Error('Clean fixture must not schedule scanning'); } },
    './objectStorageService': {
      async deleteObject(key) { storage.push(['deleteObject', key]); },
      async getObject(key) { storage.push(['getObject', key]); return body; },
      isConfigured: () => true,
      keyFromStorageUri(uri) { storage.push(['keyFromStorageUri', uri]); return String(uri).startsWith('s3://') ? String(uri).slice(5) : null; },
      async putObject(key, bytes) { storage.push(['putObject', key]); assert.deepEqual(bytes, body); },
      storageUri: (key) => 's3://' + key
    },
    './sessionService': { async logSecurityEvent(event) { events.push(event); } },
    './stepUpService': { isStepUpFresh: (session) => session?.fresh === true, stepUpTtlMinutes: () => 5 },
    './applicationRetirement': retirement
  };
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({
    module: moduleFixture, exports: moduleFixture.exports,
    __dirname: path.dirname(filename), Buffer,
    process: { env: { OBJECT_STORAGE_DOCUMENTS_ENABLED: 'true' } },
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error('Unexpected document dependency: ' + name);
      return dependencies[name];
    }
  });
  const service = moduleFixture.exports;
  const owner = { id: 20, role: 'viewer', permissions: [] };
  const other = { id: 21, role: 'viewer', permissions: [] };
  const admin = { id: 99, role: 'super_admin', permissions: ['VIEW_BANKING', 'VIEW_CONFIDENTIAL_FILES', 'VIEW_RFQS'] };
  const request = (user, params, fresh = true) => ({ user, params, body: { ttl_minutes: 5 }, session: { id: 'fixture-session', fresh } });
  const response = () => ({
    statusCode: 200, headers: {}, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.bytes = value; return this; }
  });
  const file = { path: path.join(__dirname, '..', 'uploads', 'fixture-enquiry.txt'), filename: 'fixture-enquiry.txt', originalname: 'enquiry.txt', mimetype: 'text/plain', size: body.length, malwareScan: { status: 'CLEAN' } };

  // Reject registration before schema, SQL, local-file or object-storage access.
  for (const module of ['rfq', 'finance', 'invoice', 'suppliers', 'careers', 'unknown', '', undefined]) {
    await assert.rejects(service.registerDocument({ module, file, recordType: 'evidence', recordId: '42' }), { status: 410, code: 'MODULE_RETIRED' });
  }
  assert.equal(schemaChecks, 0);
  assert.equal(queries.length, 0);
  assert.equal(storage.length, 0);

  const archived = [];
  for (const module of ['rfq', 'finance', 'invoice', 'suppliers', 'careers', 'unknown', '']) {
    const row = document(module, { classification: 'PUBLIC', access_policy: 'AUTHENTICATED' });
    const token = 'archived-' + row.id;
    const oldGrant = grant(row, token);
    archived.push({ row, grant: oldGrant, before: JSON.stringify({ row, grant: oldGrant }) });
    const beforeStorage = storage.length;
    const beforeEvents = events.length;
    const beforeWrites = queries.filter(({ sql }) => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)).length;
    for (const user of [owner, other, admin]) assert.equal((await service.getAuthorisedDocument(user, row.id)).status, 410, 'owner, public classification and legacy privileged permissions must not bypass retirement');
    let res = response();
    await service.sendDocument(request(owner, { id: row.id }), res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.code, 'MODULE_RETIRED');
    res = response();
    await service.createDocumentGrant(request(owner, { id: row.id }), res);
    assert.equal(res.statusCode, 410);
    await assert.rejects(service.readDocumentBodyInternal(row.id), { status: 410, code: 'MODULE_RETIRED' });
    await assert.rejects(service.removeDocumentInternal(row.id), { status: 410, code: 'MODULE_RETIRED' });
    await assert.rejects(service.streamDocument(request(owner, {}), response(), { document: row, storage: 'OBJECT_STORAGE', objectKey: 'archived' }), { status: 410, code: 'MODULE_RETIRED' });
    res = response();
    await service.sendGrantedDocument(request(owner, { token }), res);
    assert.equal(res.statusCode, 410, 'preexisting grants must be denied before consumption');
    assert.equal(oldGrant.used_at, null);
    assert.equal(storage.length, beforeStorage, 'retired bytes and even storage references must not be accessed');
    assert.equal(events.length, beforeEvents);
    assert.equal(queries.filter(({ sql }) => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)).length, beforeWrites);
    assert.deepEqual(transactions.slice(-3), ['begin', 'rollback', 'release']);
  }

  for (const module of ['profile', 'security']) {
    const row = document(module);
    assert.equal((await service.getAuthorisedDocument(owner, row.id)).status, 200);
    assert.equal((await service.getAuthorisedDocument(other, row.id)).status, 403, 'retained private documents must keep owner/permission isolation');
    assert.deepEqual((await service.readDocumentBodyInternal(row.id)).body, body);
    let res = response();
    await service.sendDocument(request(owner, { id: row.id }), res);
    assert.deepEqual(res.bytes, body);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    res = response();
    await service.createDocumentGrant(request(owner, { id: row.id }), res);
    assert.equal(res.statusCode, 201);
    const token = res.body.grant_url.split('/').pop();
    const savedGrant = grants.get(crypto.createHash('sha256').update(token).digest('hex'));
    const oldStorageCount = storage.length;
    const unauthorized = response();
    await service.sendGrantedDocument(request(other, { token }), unauthorized);
    assert.equal(unauthorized.statusCode, 404);
    assert.equal(savedGrant.used_at, null);
    assert.equal(storage.length, oldStorageCount);
    res = response();
    await service.sendGrantedDocument(request(owner, { token }), res);
    assert.deepEqual(res.bytes, body);
    assert(savedGrant.used_at);
    const replay = response();
    await service.sendGrantedDocument(request(owner, { token }), replay);
    assert.equal(replay.statusCode, 404, 'allowed grants must remain single use');
    assert.equal(await service.removeDocumentInternal(row.id), true);
    assert(row.deleted_at, 'permitted retained document removal must still work');
  }

  const restricted = document('security', { classification: 'RESTRICTED', access_policy: 'MODULE_AND_STEP_UP' });
  const restrictedGrant = grant(restricted, 'restricted-fixture');
  let res = response();
  await service.sendGrantedDocument(request(owner, { token: 'restricted-fixture' }, false), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'STEP_UP_REQUIRED');
  assert.equal(restrictedGrant.used_at, null, 'stale security verification must not consume a restricted grant');
  res = response();
  await service.sendGrantedDocument(request(owner, { token: 'restricted-fixture' }), res);
  assert.deepEqual(res.bytes, body);

  const local = document('profile', { storage_path: file.path });
  assert.deepEqual((await service.readDocumentBodyInternal(local.id)).body, body);
  res = response();
  await service.sendDocument(request(owner, { id: local.id }), res);
  assert.deepEqual(res.bytes, body);
  const registered = await service.registerDocument({ module: 'PROFILE', recordType: 'evidence', recordId: '42', ownerUserId: owner.id, uploadedBy: owner.id, file });
  assert.equal(documents.get(registered.id).module, 'profile');
  assert.equal(registered.storage, 'OBJECT_STORAGE');
  assert.equal(registered.content_sha256, sha256);
  for (const item of archived) assert.equal(JSON.stringify({ row: item.row, grant: item.grant }), item.before, 'archived document rows, bytes references and grant state must remain untouched');
  console.log('Retained document boundary tests passed: archived owner/public/admin/grant/internal bypasses denied without storage or mutation; retained private, local/object storage, single-use and step-up flows remain functional.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
