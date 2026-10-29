'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { configuration, publish } = require('./android-play-publish');

const token = 'isolated-test-access-token-never-a-real-credential';
const base = {
  intent: 'internal', track: 'internal', status: 'completed',
  versionCode: '101', versionName: '1.0.101', verifiedMax: '100',
  sourceCommit: 'a'.repeat(40), event: 'workflow_dispatch', ref: 'refs/heads/main'
};
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(bundlePath, change = {}) {
  const calls = [], evidence = [], sha256 = crypto.createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex');
  const tracks = change.tracks || [
    { track: 'internal', releases: [{ name: 'Existing internal release', status: 'completed', versionCodes: ['90'] }] },
    { track: 'production', releases: [{ name: 'Existing production release', status: 'completed', versionCodes: ['99'] }] }
  ];
  const response = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(address, options) {
    const url = new URL(address), route = url.pathname, method = options.method;
    assert.equal(url.hostname, 'androidpublisher.googleapis.com');
    assert(route.includes('/applications/com.voxelveda.app/edits'), 'Every request targets the existing package');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.redirect, 'error', 'The token cannot follow redirects to another origin');
    const call = { method, route, query: url.search, body: null };
    calls.push(call);
    if (typeof options.body === 'string') call.body = JSON.parse(options.body);
    if (method === 'POST' && route.endsWith('/edits')) return response({ id: 'existing-edit-1' });
    if (method === 'GET' && route.endsWith('/tracks')) return response({ tracks });
    if (method === 'GET' && route.endsWith('/bundles')) return response({ bundles: change.bundles || [{ versionCode: 98 }] });
    if (method === 'GET' && route.endsWith('/apks')) return response({ apks: change.apks || [{ versionCode: 97 }] });
    if (method === 'GET' && route.includes('/tracks/')) return response(tracks.find(track => track.track === decodeURIComponent(route.split('/').at(-1))) || {});
    if (method === 'POST' && route.startsWith('/upload/') && route.endsWith('/bundles')) {
      assert(calls.some(item => item.method === 'GET' && item.route.endsWith('/tracks')));
      assert(calls.some(item => item.method === 'GET' && item.route.endsWith('/bundles')));
      assert(calls.some(item => item.method === 'GET' && item.route.endsWith('/apks')), 'All fresh version queries precede upload');
      assert.equal(url.searchParams.get('uploadType'), 'media');
      assert.equal(options.headers['Content-Type'], 'application/octet-stream');
      const chunks = []; for await (const chunk of options.body) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), fs.readFileSync(bundlePath), 'The original signed artifact bytes are uploaded without modification');
      if (change.uploadTimeout) throw new Error('Simulated disconnected request containing ' + token);
      return response({ versionCode: change.uploadVersion || 101, sha256: change.uploadHash || sha256 });
    }
    if (method === 'PUT' && route.includes('/tracks/')) return response(call.body);
    if (method === 'POST' && route.endsWith(':validate')) return change.validateFailure ? response({}, 400) : response({});
    if (method === 'POST' && route.endsWith(':commit')) {
      if (change.commitTimeout) throw new Error('Simulated disconnected commit containing ' + token);
      if (change.commitFailure) return response({}, 403);
      if (change.commitMalformed) return response({ id: 'different-edit' });
      return response({ id: 'existing-edit-1' });
    }
    if (method === 'DELETE') return response({}, 204);
    throw new Error('Unexpected fixture request');
  }
  return {
    calls, evidence,
    dependencies: { accessToken: token, bundlePath, fetchImpl, onEvidence: value => { evidence.push(clone(value)); } },
    uploads: () => calls.filter(item => item.method === 'POST' && item.route.startsWith('/upload/')),
    commits: () => calls.filter(item => item.route.endsWith(':commit')),
    deletes: () => calls.filter(item => item.method === 'DELETE')
  };
}
async function failure(config, test, code) {
  let caught;
  try { await publish(config, test.dependencies); } catch (error) { caught = error; }
  assert(caught, 'The release must fail closed');
  assert.equal(caught.code, code);
  assert(!JSON.stringify(caught.evidence).includes(token), 'No token leaks into durable release evidence');
  assert(!caught.message.includes(token), 'No raw network error leaks a token');
  return caught;
}
async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voxel-play-publisher-test-'));
  const bundle = path.join(directory, 'isolated-upload-fixture.aab');
  // Only a transport fixture, not a signed or distribution-ready bundle. The
  // workflow separately enforces real Gradle signing, source and association.
  fs.writeFileSync(bundle, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('isolated AAB transport bytes')]));
  try {
    assert.equal((await publish({}, { fetchImpl: () => { throw Error('Artifact-only must not use the network'); } })).outcome, 'ARTIFACT_ONLY');
    for (const invalid of [
      { event: 'push' }, { ref: 'refs/heads/unreviewed' }, { packageId: 'other.application' },
      { intent: 'production' }, { intent: 'internal', track: 'production' },
      { intent: 'draft', status: 'completed' }, { track: '' }, { track: '../production' },
      { versionCode: '100' }, { versionCode: '2100000001' }, { verifiedMax: '' },
      { sourceCommit: '' }, { status: 'inProgress' }, { versionName: 'name\ninvalid' }
    ]) assert.throws(() => configuration({ ...base, ...invalid }), 'Explicit intent, source, identity and version are mandatory');

    let test = fixture(bundle);
    const success = await publish(base, test.dependencies);
    assert.equal(success.outcome, 'PROVIDER_COMMIT_ACCEPTED');
    assert.equal(success.observedMaxVersionCode, 99);
    assert.equal(success.providerCommitAccepted, true);
    assert.equal(success.playReviewStatus, 'UNVERIFIED');
    assert.equal(success.storeAvailability, 'UNVERIFIED');
    assert.equal(success.physicalUserDistribution, 'UNVERIFIED');
    assert.equal(test.uploads().length, 1); assert.equal(test.commits().length, 1); assert.equal(test.deletes().length, 0);
    assert(test.evidence.find(item => item.outcome === 'COMMIT_PENDING_RECONCILIATION' && item.commitAttempted), 'Commit intent is saved before the request');
    assert(!JSON.stringify(success).includes(token));

    test = fixture(bundle);
    await publish({ ...base, intent: 'draft', track: 'production', status: 'draft' }, test.dependencies);
    const draft = test.calls.find(item => item.method === 'PUT').body;
    assert.equal(draft.releases.length, 2);
    assert.deepEqual(draft.releases[0], { name: 'Existing production release', status: 'completed', versionCodes: ['99'] }, 'Draft creation preserves the existing available release');
    assert.equal(draft.releases[1].status, 'draft');
    test = fixture(bundle);
    await publish({ ...base, intent: 'production', track: 'production' }, test.dependencies);
    assert.deepEqual(test.calls.find(item => item.method === 'PUT').body.releases.map(item => item.versionCodes), [['101']]);

    for (const change of [{ bundles: [{ versionCode: 101 }] }, { apks: [{ versionCode: 102 }] }, { tracks: [{ track: 'internal', releases: [{ status: 'completed', versionCodes: ['103'] }] }] }]) {
      test = fixture(bundle, change); await failure(base, test, 'VERSION_ALREADY_PRESENT');
      assert.equal(test.uploads().length, 0); assert.equal(test.commits().length, 0); assert.equal(test.deletes().length, 1);
    }
    test = fixture(bundle); await failure({ ...base, intent: 'draft', status: 'draft', track: 'unrecognised-track' }, test, 'TRACK_NOT_FOUND');
    assert.equal(test.uploads().length, 0);
    test = fixture(bundle, { tracks: [{ track: 'internal', releases: [{ status: 'inProgress', versionCodes: ['99'], userFraction: 0.2 }] }] });
    await failure(base, test, 'TRACK_REQUIRES_REVIEW'); assert.equal(test.uploads().length, 0);
    test = fixture(bundle, { uploadHash: '0'.repeat(64) });
    await failure(base, test, 'UPLOADED_HASH_MISMATCH'); assert.equal(test.commits().length, 0); assert.equal(test.deletes().length, 1);
    test = fixture(bundle, { uploadVersion: 102 });
    await failure(base, test, 'UPLOADED_VERSION_MISMATCH'); assert.equal(test.commits().length, 0);
    test = fixture(bundle, { validateFailure: true });
    await failure(base, test, 'PROVIDER_HTTP_REJECTION'); assert.equal(test.commits().length, 0); assert.equal(test.deletes().length, 1);

    test = fixture(bundle, { uploadTimeout: true });
    let uncertain = await failure(base, test, 'PROVIDER_RESPONSE_UNCERTAIN');
    assert.equal(uncertain.evidence.outcome, 'UNCOMMITTED_OUTCOME_UNCERTAIN');
    assert.equal(test.uploads().length, 1); assert.equal(test.commits().length, 0); assert.equal(test.deletes().length, 0);
    for (const change of [{ commitTimeout: true }, { commitMalformed: true }]) {
      test = fixture(bundle, change);
      uncertain = await failure(base, test, change.commitMalformed ? 'COMMIT_RESPONSE_MISMATCH' : 'PROVIDER_RESPONSE_UNCERTAIN');
      assert.equal(uncertain.evidence.outcome, 'COMMIT_OUTCOME_UNCERTAIN');
      assert.equal(uncertain.evidence.requiresManualReconciliation, true);
      assert.equal(test.uploads().length, 1); assert.equal(test.commits().length, 1); assert.equal(test.deletes().length, 0, 'An uncertain final edit is never deleted or retried');
    }
    test = fixture(bundle, { commitFailure: true });
    const rejected = await failure(base, test, 'PROVIDER_HTTP_REJECTION');
    assert.equal(rejected.evidence.outcome, 'COMMIT_REJECTED');
    assert.equal(test.commits().length, 1); assert.equal(test.deletes().length, 0);
    console.log('Android Play publisher fixture tests passed: default-off/manual intent, fixed identity, fresh tracks/bundles/APKs, version guards, original artifact/hash, draft preservation, explicit internal/production status, transactional validation, one commit, uncertain-outcome holds and secret-free evidence. No Play writes or distribution occurred.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
