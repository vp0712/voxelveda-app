'use strict';

// Explicit manual release only. Google Play Edits is transactional: no uploaded
// bundle or track change becomes a submitted release until one final commit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PACKAGE = 'com.voxelveda.app';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + PACKAGE + '/edits';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/' + PACKAGE + '/edits';

class ReleaseError extends Error {
  constructor(code, message, uncertain = false, status = null) {
    super(message); this.code = code; this.uncertain = uncertain; this.status = status;
  }
}
function requireValue(condition, code, message) { if (!condition) throw new ReleaseError(code, message); }
function version(value) {
  requireValue(/^[1-9][0-9]*$/.test(String(value)), 'INVALID_VERSION', 'A positive existing Play version code is required.');
  const number = Number(value);
  requireValue(Number.isSafeInteger(number) && number <= 2100000000, 'INVALID_VERSION', 'The version code exceeds the Android limit.');
  return number;
}
function configuration(input = {}) {
  const intent = input.intent || 'artifact-only';
  requireValue(['artifact-only', 'draft', 'internal', 'production'].includes(intent), 'INVALID_INTENT', 'Choose an explicit supported release intent.');
  if (intent === 'artifact-only') return { intent };
  requireValue(input.event === 'workflow_dispatch' && input.ref === 'refs/heads/main', 'MANUAL_MAIN_REQUIRED', 'Play writes require an explicit dispatch of the checked main source.');
  requireValue(input.packageId === undefined || input.packageId === PACKAGE, 'PACKAGE_MISMATCH', 'The existing application package cannot change.');
  requireValue(/^[0-9a-f]{40}$/.test(input.sourceCommit || ''), 'SOURCE_REQUIRED', 'The checked source commit is required.');
  requireValue(typeof input.track === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.track), 'TRACK_REQUIRED', 'Specify the exact existing Play track; no track is inferred.');
  requireValue(['draft', 'completed'].includes(input.status), 'INVALID_STATUS', 'Choose draft or completed explicitly.');
  if (intent === 'draft') requireValue(input.status === 'draft', 'INTENT_MISMATCH', 'A draft intent can create only a draft release.');
  if (intent === 'internal') requireValue(input.track === 'internal' && input.status === 'completed', 'INTENT_MISMATCH', 'Internal distribution requires the existing internal track and completed status.');
  if (intent === 'production') requireValue(input.track === 'production' && input.status === 'completed', 'INTENT_MISMATCH', 'Production distribution requires the existing production track and completed status.');
  requireValue(typeof input.versionName === 'string' && input.versionName.length <= 100 && /^[\x20-\x7E]+$/.test(input.versionName), 'INVALID_NAME', 'The approved release name is required.');
  const code = version(input.versionCode), verifiedMax = version(input.verifiedMax);
  requireValue(code > verifiedMax, 'VERSION_NOT_NEW', 'The new version must exceed the owner-verified highest existing Play version.');
  return { ...input, intent, versionCode: code, verifiedMax };
}
function releaseVersions(tracks, bundles, apks) {
  const values = [];
  for (const track of tracks) for (const release of track.releases || []) for (const code of release.versionCodes || []) values.push(version(code));
  for (const item of [...bundles, ...apks]) values.push(version(item.versionCode));
  return values;
}
function trackUpdate(current, config) {
  const releases = current.releases || [];
  requireValue(Array.isArray(releases), 'INVALID_TRACK_RESPONSE', 'The existing track releases could not be read.');
  requireValue(releases.every(release => release.status === 'completed'), 'TRACK_REQUIRES_REVIEW', 'The track has a draft, staged, halted or unknown release. Reconcile it in Play before another release.');
  requireValue(config.status === 'draft' || releases.length <= 1, 'COMPLEX_TRACK_REQUIRES_REVIEW', 'Multiple completed releases require an explicit compatibility review in Play.');
  const next = { name: config.versionName, versionCodes: [String(config.versionCode)], status: config.status };
  // A new draft must preserve the currently available release. A deliberately
  // completed update replaces the single existing completed release as normal.
  return { track: config.track, releases: config.status === 'draft' ? [...releases, next] : [next] };
}
async function fileHash(filename) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

async function publish(input, dependencies = {}) {
  const config = configuration(input);
  if (config.intent === 'artifact-only') return { packageId: PACKAGE, outcome: 'ARTIFACT_ONLY', externalWrites: false };
  const accessToken = dependencies.accessToken;
  requireValue(typeof accessToken === 'string' && accessToken.length > 0, 'PUBLISHER_ACCESS_REQUIRED', 'The existing service-account access token is required.');
  const bundlePath = dependencies.bundlePath;
  requireValue(typeof bundlePath === 'string' && fs.statSync(bundlePath).isFile(), 'BUNDLE_REQUIRED', 'The existing-identity signed bundle is required.');
  const handle = fs.openSync(bundlePath, 'r');
  const magic = Buffer.alloc(4);
  try { fs.readSync(handle, magic, 0, 4, 0); } finally { fs.closeSync(handle); }
  requireValue(magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'INVALID_BUNDLE', 'The signed bundle is not an Android ZIP bundle.');
  const sha256 = await fileHash(bundlePath);
  const evidence = {
    schemaVersion: 1, packageId: PACKAGE, sourceCommit: config.sourceCommit,
    versionCode: config.versionCode, versionName: config.versionName,
    intent: config.intent, track: config.track, releaseStatus: config.status,
    artifact: { filename: path.basename(bundlePath), sha256 },
    startedAt: new Date().toISOString(), outcome: 'PREFLIGHT', editId: null,
    commitAttempted: false, providerCommitAccepted: false,
    requiresManualReconciliation: false, playReviewStatus: 'UNVERIFIED',
    storeAvailability: 'UNVERIFIED', physicalUserDistribution: 'UNVERIFIED', steps: []
  };
  const save = async (stage, details = {}) => {
    Object.assign(evidence, details);
    evidence.steps.push({ stage, at: new Date().toISOString() });
    if (dependencies.onEvidence) await dependencies.onEvidence(evidence);
  };
  const fetchImpl = dependencies.fetchImpl || fetch;
  async function request(method, url, body) {
    const headers = { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' };
    const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(dependencies.timeoutMs || 180000) };
    if (body !== undefined) {
      if (typeof body.pipe === 'function') {
        headers['Content-Type'] = 'application/octet-stream'; options.body = body; options.duplex = 'half';
      } else { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    }
    let response;
    try { response = await fetchImpl(url, options); }
    catch (_) { throw new ReleaseError('PROVIDER_RESPONSE_UNCERTAIN', 'No reliable provider response was received; do not repeat the mutation.', true); }
    if (!response.ok) throw new ReleaseError('PROVIDER_HTTP_REJECTION', 'The provider rejected the request with HTTP ' + response.status + '.', response.status >= 500 || [408, 429].includes(response.status), response.status);
    if (response.status === 204) return {};
    try {
      const value = JSON.parse(await response.text());
      requireValue(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PROVIDER_RESPONSE', 'The provider returned an unexpected response.');
      return value;
    } catch (_) { throw new ReleaseError('PROVIDER_RESPONSE_UNCERTAIN', 'The provider response could not be verified; reconcile before retrying.', true, response.status); }
  }
  let editUrl = null;
  try {
    await save('CREATE_EDIT_PENDING');
    const edit = await request('POST', API, {});
    requireValue(typeof edit.id === 'string' && /^[A-Za-z0-9_-]+$/.test(edit.id), 'INVALID_EDIT_ID', 'The provider edit identity was not verified.');
    editUrl = API + '/' + encodeURIComponent(edit.id);
    await save('EDIT_OPEN', { editId: edit.id });
    const tracks = await request('GET', editUrl + '/tracks');
    const bundles = await request('GET', editUrl + '/bundles');
    const apks = await request('GET', editUrl + '/apks');
    requireValue(Array.isArray(tracks.tracks) && Array.isArray(bundles.bundles || []) && Array.isArray(apks.apks || []), 'INVALID_VERSION_RESPONSE', 'The existing tracks and uploaded versions could not be verified.');
    requireValue(tracks.tracks.some(track => track.track === config.track), 'TRACK_NOT_FOUND', 'The requested existing track was not found; this workflow cannot create a track.');
    const current = await request('GET', editUrl + '/tracks/' + encodeURIComponent(config.track));
    requireValue(current.track === config.track, 'TRACK_MISMATCH', 'The provider returned a different track.');
    const observed = releaseVersions([...tracks.tracks, current], bundles.bundles || [], apks.apks || []);
    const observedMax = observed.reduce((maximum, code) => Math.max(maximum, code), 0);
    await save('VERSIONS_VERIFIED', { observedMaxVersionCode: observedMax, ownerVerifiedMaxVersionCode: config.verifiedMax });
    requireValue(config.versionCode > observedMax, 'VERSION_ALREADY_PRESENT', 'The version is not greater than the freshly observed Play versions. Reconcile any earlier upload or commit.');
    const update = trackUpdate(current, config);
    await save('UPLOAD_PENDING', { outcome: 'UPLOAD_PENDING' });
    const uploaded = await request('POST', UPLOAD + '/' + encodeURIComponent(edit.id) + '/bundles?uploadType=media', fs.createReadStream(bundlePath));
    requireValue(version(uploaded.versionCode) === config.versionCode, 'UPLOADED_VERSION_MISMATCH', 'The provider-reported uploaded bundle version does not match the checked release.');
    requireValue(typeof uploaded.sha256 === 'string' && uploaded.sha256.toLowerCase() === sha256, 'UPLOADED_HASH_MISMATCH', 'The provider-reported uploaded bundle hash does not match the signed artifact.');
    await save('UPLOAD_VERIFIED', { uploadedVersionCode: config.versionCode, uploadedSha256: uploaded.sha256.toLowerCase() });
    const changed = await request('PUT', editUrl + '/tracks/' + encodeURIComponent(config.track), update);
    requireValue(changed.track === config.track && (changed.releases || []).some(release => release.status === config.status && release.versionCodes?.map(String).includes(String(config.versionCode))), 'TRACK_UPDATE_MISMATCH', 'The provider did not confirm the intended track/version/status.');
    await save('TRACK_UPDATED');
    await request('POST', editUrl + ':validate');
    await save('COMMIT_PENDING', { outcome: 'COMMIT_PENDING_RECONCILIATION', commitAttempted: true });
    const committed = await request('POST', editUrl + ':commit');
    requireValue(committed.id === edit.id, 'COMMIT_RESPONSE_MISMATCH', 'The final commit identity was not verified.');
    await save('COMMIT_ACCEPTED', { outcome: 'PROVIDER_COMMIT_ACCEPTED', providerCommitAccepted: true, completedAt: new Date().toISOString() });
    return evidence;
  } catch (error) {
    const uncertain = Boolean(error.uncertain || (evidence.commitAttempted && error.code !== 'PROVIDER_HTTP_REJECTION'));
    const failedAt = evidence.steps.at(-1)?.stage || 'PREFLIGHT';
    await save('STOPPED', {
      outcome: evidence.providerCommitAccepted ? 'PROVIDER_COMMIT_ACCEPTED_EVIDENCE_FAILURE' : evidence.commitAttempted ? (uncertain ? 'COMMIT_OUTCOME_UNCERTAIN' : 'COMMIT_REJECTED') : (uncertain ? 'UNCOMMITTED_OUTCOME_UNCERTAIN' : 'REJECTED_BEFORE_COMMIT'),
      requiresManualReconciliation: uncertain, failureCode: error.code || 'UNEXPECTED_FAILURE', failureHttpStatus: error.status || null, failedAt
    });
    // Never delete or repeat an edit after a commit attempt. An uncertain
    // upload/update remains available for read-only reconciliation, not retry.
    if (editUrl && !evidence.commitAttempted && !uncertain) {
      try { await request('DELETE', editUrl); await save('UNCOMMITTED_EDIT_DISCARDED'); }
      catch (_) { await save('EDIT_CLEANUP_UNVERIFIED', { requiresManualReconciliation: true }); }
    }
    error.evidence = evidence;
    throw error;
  }
}

async function cli() {
  const args = process.argv.slice(2);
  requireValue(args.length === 4 && args[0] === '--bundle' && args[2] === '--evidence', 'INVALID_ARGUMENTS', 'Use --bundle <signed.aab> --evidence <result.json>.');
  const evidencePath = path.resolve(args[3]);
  requireValue(!fs.existsSync(evidencePath), 'PRIOR_ATTEMPT_REQUIRES_REVIEW', 'A prior release result exists; reconcile it instead of overwriting or retrying.');
  const result = await publish({
    intent: process.env.PLAY_RELEASE_INTENT, track: process.env.PLAY_TRACK, status: process.env.PLAY_RELEASE_STATUS,
    versionCode: process.env.ANDROID_VERSION_CODE, versionName: process.env.ANDROID_VERSION_NAME,
    verifiedMax: process.env.ANDROID_PLAY_MAX_VERSION_CODE, sourceCommit: process.env.ANDROID_SOURCE_COMMIT,
    event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF
  }, {
    accessToken: process.env.PLAY_ACCESS_TOKEN, bundlePath: path.resolve(args[1]),
    onEvidence(value) {
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      const temporary = evidencePath + '.pending';
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, evidencePath);
    }
  });
  console.log(JSON.stringify({ packageId: PACKAGE, versionCode: result.versionCode, track: result.track, status: result.releaseStatus, outcome: result.outcome, providerCommitAccepted: result.providerCommitAccepted, playReviewStatus: result.playReviewStatus, storeAvailability: result.storeAvailability, physicalUserDistribution: result.physicalUserDistribution }));
}
module.exports = { PACKAGE, ReleaseError, configuration, releaseVersions, trackUpdate, publish };
if (require.main === module) cli().catch(error => { console.error('Play release stopped: ' + (error.code || 'UNEXPECTED_FAILURE') + '. Inspect the protected release result; do not automatically repeat an uncertain attempt.'); process.exitCode = 1; });
