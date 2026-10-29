'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readXML } = require('@capacitor/cli/dist/util/xml');

const root = path.resolve(__dirname, '..');
const identity = 'com.voxelveda.app';
const origin = 'https://app.voxelveda.com';
const capacitorVersion = '8.5.2';
// The official capacitor-swift-pm 8.5.2 tag was independently resolved through
// GitHub's git/ref endpoint, rather than copied from the candidate lock file.
const capacitorRevision = '0b6882e9a3288342aacf36348e5a94e4f1dd7b13';
const logoHash = 'ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function options(args) {
  let prepared = false, bundle = null;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--prepared' && !prepared) prepared = true;
    else if (args[index] === '--bundle' && !bundle && args[index + 1] && !args[index + 1].startsWith('--')) bundle = path.resolve(args[++index]);
    else throw new Error('Usage: node scripts/ios-native-contract-test.js [--prepared | --bundle <App.app>]');
  }
  assert(!(prepared && bundle), 'Choose either the prepared source resources or the actual built bundle');
  return { prepared, bundle };
}

function verifyConfiguration(config) {
  assert.equal(config.appId, identity, 'The existing application identity must survive resource generation');
  assert.equal(config.appName, 'Voxel Veda');
  assert.equal(config.webDir, 'native-shell');
  assert.equal(config.server?.url, origin, 'Startup remains on the canonical HTTPS application');
  assert.equal(config.server?.cleartext, false);
  assert.deepEqual(config.server?.allowNavigation, ['app.voxelveda.com'], 'The native allowlist must not include wildcard or unrelated hosts');
  assert.equal(config.loggingBehavior, 'none', 'Native configuration must not log private navigation URLs');
}

async function verifyResources(directory) {
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'capacitor.config.json'), 'utf8'));
  verifyConfiguration(config);
  assert.deepEqual(config.server, json('capacitor.config.json').server, 'The prepared/built startup configuration agrees with the checked-in source');
  const cordova = await readXML(path.join(directory, 'config.xml'));
  assert(cordova.widget, 'The app includes a parser-valid generated Cordova config.xml');
  assert.equal(cordova.widget.$?.xmlns, 'http://www.w3.org/ns/widgets');
  assert(cordova.widget.$?.version, 'The generated Cordova resource has its expected widget metadata');

  const entry = fs.readFileSync(path.join(directory, 'public/index.html'));
  assert.deepEqual(entry, fs.readFileSync(path.join(root, 'native-shell/index.html')), 'The actual bundled fallback/connection page must exactly match the canonical shell');
  const logo = fs.readFileSync(path.join(directory, 'public/logo.png'));
  assert.equal(hash(logo), logoHash, 'The actual bundled logo is the unchanged original');
  assert.deepEqual(logo, fs.readFileSync(path.join(root, 'native-shell/logo.png')));
}

async function run() {
  const selected = options(process.argv.slice(2));
  const config = json('capacitor.config.json');
  verifyConfiguration(config);

  const lock = json('package-lock.json');
  const packageJSON = json('package.json');
  for (const name of ['core', 'ios', 'android', 'cli']) {
    const dependency = '@capacitor/' + name;
    assert.equal(lock.packages['node_modules/' + dependency]?.version, capacitorVersion, dependency + ' must share the native runtime version');
    assert.equal(packageJSON.dependencies?.[dependency] || packageJSON.devDependencies?.[dependency], capacitorVersion);
  }
  const manifest = read('ios/App/CapApp-SPM/Package.swift');
  const exactPackages = [...manifest.matchAll(/\.package\(\s*url:\s*"([^"]+)"\s*,\s*exact:\s*"([^"]+)"\s*\)/g)];
  assert.equal(exactPackages.length, 1, 'The native Swift package declares one exact remote dependency');
  assert.equal(exactPackages[0][1], 'https://github.com/ionic-team/capacitor-swift-pm.git');
  assert.equal(exactPackages[0][2], capacitorVersion, 'SwiftPM and the npm iOS runtime must resolve the same release');
  const resolved = json('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
  assert([2, 3].includes(resolved.version), 'Xcode can consume the checked-in SwiftPM resolved format');
  assert.equal(resolved.pins.length, 1, 'The official Capacitor manifest has no additional remote dependencies');
  const pin = resolved.pins[0];
  assert.equal(pin.identity, 'capacitor-swift-pm');
  assert.equal(pin.kind, 'remoteSourceControl');
  assert.equal(pin.location, 'https://github.com/ionic-team/capacitor-swift-pm.git');
  assert.equal(pin.state.version, capacitorVersion);
  assert.equal(pin.state.revision, capacitorRevision, 'The lock resolves the verified official release tag, not a fabricated revision');
  assert.equal(pin.state.branch, undefined, 'An unpinned moving branch cannot replace the exact dependency');

  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const bundleIdentifiers = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^;"\s]+)"?\s*;/g)].map(match => match[1]);
  assert(bundleIdentifiers.length >= 2, 'Both existing Xcode build configurations retain an explicit bundle identity');
  assert.deepEqual([...new Set(bundleIdentifiers)], [identity], 'No build configuration changes the installed application identity');
  const storyboard = await readXML(path.join(root, 'ios/App/App/Base.lproj/Main.storyboard'));
  const initial = storyboard.document.$.initialViewController;
  const controllers = storyboard.document.scenes.flatMap(scenes => scenes.scene || []).flatMap(scene => scene.objects || []).flatMap(objects => objects.viewController || []);
  const controller = controllers.find(item => item.$?.id === initial);
  assert(controller, 'The actual initial storyboard scene exists');
  assert.equal(controller.$.customClass, 'VoxelVedaViewController', 'The actual launch scene uses the application navigation controller');
  assert.equal(controller.$.customModule, 'App');
  assert.equal(controller.$.customModuleProvider, 'target');
  assert.equal(hash(fs.readFileSync(path.join(root, 'native-shell/logo.png'))), logoHash);
  assert.equal(hash(fs.readFileSync(path.join(root, 'public/logo.png'))), logoHash);

  if (selected.prepared) await verifyResources(path.join(root, 'ios/App/App'));
  if (selected.bundle) {
    assert(fs.statSync(selected.bundle).isDirectory(), 'The requested built application bundle exists');
    await verifyResources(selected.bundle);
    // A real Xcode build commonly emits a binary plist. Ask the platform parser
    // for its decoded metadata instead of treating it as source XML/text.
    const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(selected.bundle, 'Info.plist')], { encoding: 'utf8' }));
    assert.equal(info.CFBundleIdentifier, identity, 'The built application, not only its source settings, has the existing bundle identity');
    for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
      assert.equal(typeof info[key], 'string', 'The built app records ' + key);
      assert(info[key].trim() && !info[key].includes('$('), 'The built ' + key + ' was resolved by Xcode');
    }
    assert.equal(info.CFBundlePackageType, 'APPL');
    console.log('Verified unsigned simulator bundle metadata: ' + identity + ' version ' + info.CFBundleShortVersionString + ' (' + info.CFBundleVersion + '). This is not signing, installed-device, TestFlight or App Store distribution evidence.');
  }
  console.log('iOS native contract passed: existing identity, canonical startup, official pinned Capacitor ' + capacitorVersion + ', actual launch storyboard and unchanged logo' + (selected.prepared || selected.bundle ? ', parser-valid generated resources and exact bundled shell bytes.' : '. Run --prepared after cap sync and --bundle after the actual Xcode build to verify generated artifacts.'));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
