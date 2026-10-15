#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p "$VV_ANDROID_PROOF_DIR"
node scripts/android-fixture-server.js > "$VV_ANDROID_PROOF_DIR/fixture-server.log" 2>&1 &
VV_ANDROID_FIXTURE_PID=$!
collect_android_proof() {
  VV_ANDROID_EXIT_STATUS=$?
  adb pull /sdcard/Android/data/com.voxelveda.app/files/android-proof "$VV_ANDROID_PROOF_DIR/installed-proof" >/dev/null 2>&1 || true
  adb exec-out screencap -p > "$VV_ANDROID_PROOF_DIR/final-screen.png" 2>/dev/null || true
  adb logcat -d -s AndroidRuntime AndroidFixture > "$VV_ANDROID_PROOF_DIR/native-errors.log" 2>/dev/null || true
  kill "$VV_ANDROID_FIXTURE_PID" 2>/dev/null || true
  exit "$VV_ANDROID_EXIT_STATUS"
}
trap collect_android_proof EXIT
for attempt in $(seq 1 40); do
  if [[ -f /tmp/vv-android-fixture.json ]]; then break; fi
  sleep 1
done
VV_ANDROID_FIXTURE_PORT=$(node -p "JSON.parse(require('fs').readFileSync('/tmp/vv-android-fixture.json')).port")
adb install -r android/app/build/outputs/apk/verification/app-verification.apk
adb install -r android/app/build/outputs/apk/androidTest/verification/app-verification-androidTest.apk
adb shell am instrument -w -r -e fixture_port "$VV_ANDROID_FIXTURE_PORT" -e class com.voxelveda.app.AndroidJourneyTest com.voxelveda.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$VV_ANDROID_PROOF_DIR/installed-journey.txt"
if ! grep -Eq '^OK \([1-9][0-9]* tests?\)' "$VV_ANDROID_PROOF_DIR/installed-journey.txt"; then exit 1; fi
adb shell am force-stop com.voxelveda.app
ANDROID_VERSION_CODE=3 ANDROID_VERSION_NAME=0.0.0-upgrade-fixture android/gradlew -p android --no-daemon :app:assembleVerification
node scripts/android-artifact-metadata.js android/app/build/outputs/apk/verification/app-verification.apk "$VV_ANDROID_PROOF_DIR/artifact-after-upgrade.json"
node -e 'const fs=require("fs"),p=process.env.VV_ANDROID_PROOF_DIR,a=JSON.parse(fs.readFileSync(p+"/artifact-before-upgrade.json")),b=JSON.parse(fs.readFileSync(p+"/artifact-after-upgrade.json"));if(a.packageId!==b.packageId||a.signingCertificateSha256!==b.signingCertificateSha256||b.versionCode<=a.versionCode)throw Error("Upgrade identity/version continuity failed")'
adb install -r android/app/build/outputs/apk/verification/app-verification.apk
adb shell am instrument -w -r -e fixture_port "$VV_ANDROID_FIXTURE_PORT" -e upgrade_only true -e class com.voxelveda.app.AndroidJourneyTest#installedJourney com.voxelveda.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$VV_ANDROID_PROOF_DIR/upgrade-journey.txt"
if ! grep -Eq '^OK \([1-9][0-9]* tests?\)' "$VV_ANDROID_PROOF_DIR/upgrade-journey.txt"; then exit 1; fi
adb shell pm get-app-links com.voxelveda.app > "$VV_ANDROID_PROOF_DIR/app-links-observed.txt"
adb pull /sdcard/Android/data/com.voxelveda.app/files/android-proof "$VV_ANDROID_PROOF_DIR/installed-proof"
adb shell dumpsys package com.voxelveda.app | grep -E 'versionCode|versionName|targetSdk|signatures' > "$VV_ANDROID_PROOF_DIR/installed-package.txt"
