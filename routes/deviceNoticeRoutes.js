'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const { publicReadiness } = require('../services/runtimeState');
const service = require('../services/deviceNoticeService');
const { configured } = require('../services/devicePushTransport');
const { normalizeDestination, platforms, releaseRecord, verifyProducer, updateApplies, sha } = require('../services/deviceNoticePolicy');

const router = express.Router();
const endpoint = handler => (req,res,next) => Promise.resolve(handler(req,res)).catch(error => {
  if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({message:'This push destination already belongs to a different installation.'});
  next(error);
});
const state = device => ({ release_opt_in: Boolean(device?.release_opt_in), registered: Boolean(device?.destination_hash),
  destination_revision: device?.destination_hash || null, team_linked: Boolean(device?.owner_id),
  keep_team_after_logout: Boolean(device?.retain_after_logout) });
const validVersion = value => typeof value === 'string' && /^\d{1,10}(\.\d{1,5}){0,3}$/.test(value);
const pushAvailable = platform => process.env.DEVICE_PUSH_WORKER_ENABLED === 'true' && configured(platform);

router.use((_req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
router.get('/configuration', endpoint(async (req,res) => {
  const platform = req.query.platform;
  if (!platforms.includes(platform)) return res.status(400).json({message:'Select a supported platform.'});
  const latest = await service.latestRelease(platform);
  const applicable = latest && (platform === 'web' || !validVersion(req.query.installed_version) ||
    updateApplies(platform, req.query.installed_version, latest.version));
  res.json({ push_available: pushAvailable(platform), vapid_public_key: platform === 'web' && pushAvailable(platform) ? process.env.DEVICE_PUSH_VAPID_PUBLIC_KEY : null,
    latest_release: applicable ? { ...latest, platform } : null });
}));
router.use('/installation', (req,res,next) => {
  req.deviceKey = service.deviceKey(req);
  if (!req.deviceKey) return res.status(400).json({message:'Installation key is required.'});
  return next();
});
router.get('/installation', endpoint(async (req,res) => res.json(state(await service.findDevice(req.deviceKey)))));
router.put('/installation', endpoint(async (req,res) => {
  const { platform, destination, release_opt_in: optIn, installed_version: version } = req.body || {};
  const normalized = destination === null ? null : normalizeDestination(platform, destination);
  if (!platforms.includes(platform) || !normalized || (optIn !== undefined && optIn !== true) ||
    (platform !== 'web' && !validVersion(version))) {
    return res.status(422).json({message:'Device push registration is invalid.'});
  }
  if (normalized && !pushAvailable(platform)) return res.status(503).json({message:'Push delivery is not configured for this platform.'});
  const device = await service.saveDevice(req.deviceKey, { platform, destination: normalized, releaseOptIn: optIn,
    installedVersion: platform === 'web' ? null : version });
  if (!device) return res.status(409).json({message:'This installation uses another platform.'});
  return res.json(state(device));
}));
router.patch('/installation/destination', endpoint(async (req,res) => {
  const { platform = 'web', destination, previous_endpoint: oldEndpoint, revision, installed_version: version } = req.body || {};
  const expected = platform === 'web' && typeof oldEndpoint === 'string' && oldEndpoint.length <= 1800 ? sha('web:' + oldEndpoint) : revision;
  const normalized = destination === null ? null : normalizeDestination(platform, destination);
  if (!platforms.includes(platform) || !/^[a-f0-9]{64}$/.test(expected || '') ||
    (destination !== null && !normalized) || (platform !== 'web' && !validVersion(version))) {
    return res.status(422).json({message:'Push rotation requires a valid registration and its current revision.'});
  }
  if (normalized && !pushAvailable(platform)) return res.status(503).json({message:'Push delivery is not configured for this platform.'});
  const updated = normalized ? await service.rotateDestination(req.deviceKey, expected,
    { platform, destination:normalized, installedVersion:platform === 'web' ? null : version }) :
    await service.disableDestination(req.deviceKey, expected, platform);
  return res.status(updated ? 200 : 409).json(state(await service.findDevice(req.deviceKey)));
}));
router.delete('/installation/releases', endpoint(async (req,res) => {
  await service.optOutOfReleases(req.deviceKey);
  return res.json(state(await service.findDevice(req.deviceKey)));
}));
router.delete('/installation/team', endpoint(async (req,res) => {
  await service.unlinkDevice(req.deviceKey);
  res.json(state(await service.findDevice(req.deviceKey)));
}));
function browserSession(req,res,next) {
  if (!req.session?.id || req.authType === 'api_token' || req.securityContext?.impersonation || req.securityContext?.breakGlass) {
    return res.status(403).json({message:'Use your own signed-in browser session.'});
  }
  next();
}
router.post('/installation/account', auth, browserSession, endpoint(async (req,res) => {
  await service.reconcileBinding(req.deviceKey, req.user.id);
  const eligible = service.activeAuthorization(req);
  if (eligible) await service.reattachBinding(req.deviceKey, req.user.id, req.session.id);
  else await service.unlinkDevice(req.deviceKey);
  res.json({ eligible, ...state(await service.findDevice(req.deviceKey)) });
}));
router.put('/installation/team', auth, browserSession, endpoint(async (req,res) => {
  await service.reconcileBinding(req.deviceKey, req.user.id);
  if (!service.activeAuthorization(req)) return res.status(403).json({message:'An authorised AI Team account is required.'});
  if (typeof req.body?.keep_after_logout !== 'boolean') return res.status(422).json({message:'Confirm this device’s logout preference.'});
  if (!(await service.bindDevice(req.deviceKey, req, req.body.keep_after_logout))) {
    return res.status(409).json({message:'Enable notifications on this device first.'});
  }
  res.json(state(await service.findDevice(req.deviceKey)));
}));
router.post('/verified-release', endpoint(async (req,res) => {
  if (!verifyProducer(process.env.DEVICE_RELEASE_WEBHOOK_SECRET, req.get('x-vv-release-time'), req.get('x-vv-release-signature'), req.rawBody)) {
    return res.status(403).json({message:'Release producer could not be verified.'});
  }
  const { platform, version, proof } = req.body || {};
  const release = releaseRecord(platform, version, process.env.DEVICE_PUSH_APPLE_STORE_ID);
  const expectedProof = { web: 'production-readiness', android: 'play-production-completed', ios: 'app-store-lookup' };
  if (!release || proof !== expectedProof[platform]) return res.status(422).json({message:'Verified platform release is required.'});
  if (platform === 'web') {
    const ready = publicReadiness();
    if (!ready.ready || ready.deployment_sha !== version) return res.status(409).json({message:'The release is not serving production traffic.'});
  } else {
    const latest = await service.latestRelease(platform);
    if (latest && !updateApplies(platform, latest.version, version)) return res.json({ recorded: false });
  }
  res.json({ recorded: await service.recordRelease(release) });
}));

module.exports = router;
