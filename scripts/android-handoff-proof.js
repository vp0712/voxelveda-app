'use strict';

// Validate real installed-emulator observations. This never attests a Play
// release, production signing identity, physical handset or recipient mailbox.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const PACKAGE = 'com.voxelveda.app';
const ORIGIN = 'https://app.voxelveda.com';
const REQUIRED = ['cold-entry', 'login-screen', 'login-rejected', 'staff-login', 'background-resume', 'force-close-relaunch', 'profile', 'warm-deep-link', 'legacy-deep-link', 'session-expired', 'mfa-screen', 'mfa-rejected', 'admin-mfa', 'logout', 'network-recovery', 'session-restored', ...['register','forgot-password','reset-password','accept-invite'].map(name=>'recovery-screen-'+name), ...['rfq','invoice','procurement','stock','tasks','attendance'].map(name=>'internal-'+name)];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function filesBelow(directory) {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'Evidence must not contain symbolic links');
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(filename) : [filename];
  });
}
function safeFile(directory, relative, maxBytes) {
  assert.equal(typeof relative, 'string');
  assert(relative.length && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'Evidence references must stay within their checkpoint directory');
  const base = fs.realpathSync(directory), filename = fs.realpathSync(path.join(base, relative));
  assert(filename.startsWith(base + path.sep), 'Evidence cannot escape its checkpoint directory');
  const stat = fs.statSync(filename);
  assert(stat.isFile() && stat.size > 0 && stat.size <= maxBytes, 'Evidence file is empty or oversized');
  return {filename, bytes:fs.readFileSync(filename)};
}
function png(bytes) {
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'A screenshot must contain PNG bytes');
  assert.equal(bytes.subarray(12,16).toString('ascii'), 'IHDR');
  assert(bytes.readUInt32BE(16) >= 320 && bytes.readUInt32BE(20) >= 320, 'A screenshot must show a device-sized viewport');
}
function videoDetails(filename) {
  const details = JSON.parse(execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height:format=duration','-of','json',filename], {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:1024*1024}));
  const stream = details.streams?.[0], seconds = Number(details.format?.duration);
  assert(stream?.codec_name && stream.width >= 320 && stream.height >= 320 && seconds > 0 && seconds <= 185, 'The recording must have a readable, bounded video stream');
  return {codec:stream.codec_name,width:stream.width,height:stream.height,seconds};
}
function validate(root) {
  const directory = fs.realpathSync(root), all = filesBelow(directory);
  const before = JSON.parse(fs.readFileSync(path.join(directory,'artifact-before-upgrade.json')));
  const after = JSON.parse(fs.readFileSync(path.join(directory,'artifact-after-upgrade.json')));
  for (const artifact of [before,after]) {
    assert.equal(artifact.packageId,PACKAGE); assert.equal(artifact.canonicalOrigin,ORIGIN);
    assert.match(artifact.sourceCommit,/^[a-f0-9]{40}$/);
    assert.match(artifact.signingCertificateSha256,/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    assert.match(artifact.classification,/VERIFICATION ONLY/);
  }
  assert.equal(before.sourceCommit,after.sourceCommit);
  assert.equal(before.signingCertificateSha256,after.signingCertificateSha256,'Fixture upgrade must retain its actual test certificate');
  assert(Number.isSafeInteger(before.versionCode) && Number.isSafeInteger(after.versionCode) && after.versionCode > before.versionCode);
  const checkpoints = [];
  for (const filename of all.filter(name=>/^foreground-.*\.jsonl$/.test(path.basename(name)))) {
    let previous = 0;
    for (const line of fs.readFileSync(filename,'utf8').trim().split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      assert.equal(row.schemaVersion,1); assert.equal(row.fixtureOnly,true); assert.equal(row.physicalDevice,false);
      assert.equal(row.foregroundPackage,PACKAGE, row.stage + ': another package was foreground');
      assert.equal(row.externalViewIntentsStubbed,false,'Normal proof must not intercept browser launches');
      assert.equal(row.externalViewIntentCount,0,'Normal navigation attempted an external VIEW');
      assert.equal(row.browserChromeVisible,false);
      assert.match(row.resumedActivity,/^com\.voxelveda\.app\/(?:\.MainActivity|com\.voxelveda\.app\.MainActivity)$/,'Normal navigation must show the actual MainActivity');
      assert.equal(row.safeUrl?.origin,ORIGIN);
      assert.equal(typeof row.safeUrl.path,'string'); assert(/^\/[^?#]*$/.test(row.safeUrl.path),'Only a query-free and fragment-free first-party path is recorded');
      const at = typeof row.timestamp === 'number' ? row.timestamp : Date.parse(row.timestamp);
      assert(Number.isFinite(at) && at >= previous && at > 0,'Checkpoint times must be ordered'); previous = at;
      const artifact = row.stage === 'upgrade-preserved-session' ? after : before;
      for (const key of ['packageId','versionCode','versionName','sourceCommit']) assert.equal(row.native?.[key],artifact[key],key+' must agree with the APK actually analysed');
      assert.equal(row.native.buildType,'verification');
      const screenshot = safeFile(path.dirname(filename),row.screenshot,10*1024*1024); png(screenshot.bytes);
      const hierarchy = safeFile(path.dirname(filename),row.uiHierarchy,2*1024*1024).bytes.toString('utf8');
      assert.match(hierarchy,/<hierarchy/); assert.match(hierarchy,/package="com\.voxelveda\.app"/);
      assert(!/(?:com\.android\.chrome|com\.android\.browser|org\.mozilla\.firefox):id\/(?:url_bar|custom_tabs_toolbar|browser_toolbar|search_box)/.test(hierarchy),'Browser or custom-tab controls were present');
      checkpoints.push({stage:row.stage,foregroundPackage:row.foregroundPackage,resumedActivity:row.resumedActivity,safeUrl:row.safeUrl,screenshotSha256:digest(screenshot.bytes)});
    }
  }
  for (const stage of [...REQUIRED,'upgrade-preserved-session']) assert(checkpoints.some(row=>row.stage===stage),'Missing real installed checkpoint: '+stage);
  const recordingState=JSON.parse(fs.readFileSync(path.join(directory,'recording.json'),'utf8'));
  for (const flag of ['fixtureOnly','boundedClip','startedBeforeInstrumentation','stoppedCleanly','pulled']) assert.equal(recordingState[flag],true,'Recording did not establish '+flag);
  assert.equal(recordingState.physicalDevice,false); assert.equal(recordingState.maximumSeconds,180);
  assert.equal(recordingState.recording,'installed-journey.mp4'); assert.equal(recordingState.testExitCode,0);
  const recording = safeFile(directory,'installed-journey.mp4',64*1024*1024);
  const video = videoDetails(recording.filename);
  return {schemaVersion:1,result:'passed',packageId:PACKAGE,sourceCommit:before.sourceCommit,fixtureOnly:true,physicalDevice:false,playDistributionVerified:false,signatureClassification:'Disposable verification certificate; not the production/Play signing identity',fixtureVersions:{before:{name:before.versionName,code:before.versionCode},after:{name:after.versionName,code:after.versionCode}},normalCheckpointCount:checkpoints.length,checkpoints,recording:{filename:'installed-journey.mp4',sha256:digest(recording.bytes),...video,scope:'Bounded installed-emulator launch/authentication recording; other journeys use individual checkpoint screenshots.'}};
}
module.exports = {validate,videoDetails,REQUIRED};
if (require.main === module) {
  try {
    assert.equal(process.argv.length,3,'Supply the actual collected Android proof directory');
    const result=validate(process.argv[2]);
    fs.writeFileSync(path.join(process.argv[2],'native-handoff-verification.json'),JSON.stringify(result,null,2)+'\n');
    console.log('Installed native handoff proof passed: '+result.normalCheckpointCount+' foreground checkpoints, readable recording, exact fixture APK identity; no Play/physical-device claim.');
  } catch(error) { console.error('Installed handoff evidence failed: '+error.message); process.exitCode=1; }
}
