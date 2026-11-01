#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p "$VV_ANDROID_PROOF_DIR"
node scripts/android-fixture-server.js > "$VV_ANDROID_PROOF_DIR/fixture-server.log" 2>&1 &
VV_ANDROID_FIXTURE_PID=$!
VV_ANDROID_RECORDING_CLIENT_PID=''
VV_ANDROID_RECORDING_DEVICE_PID=''
VV_ANDROID_RECORDING_STARTED=''
stop_journey_recording() {
  local journey_status=${1:-1}
  if [[ -z "$VV_ANDROID_RECORDING_CLIENT_PID" ]]; then return 0; fi
  local clean=true pulled=false
  if [[ "$VV_ANDROID_RECORDING_DEVICE_PID" =~ ^[0-9]+$ ]]; then
    adb shell kill -2 "$VV_ANDROID_RECORDING_DEVICE_PID" >/dev/null 2>&1 || true
    for attempt in $(seq 1 25); do
      if ! adb shell kill -0 "$VV_ANDROID_RECORDING_DEVICE_PID" >/dev/null 2>&1; then break; fi
      sleep 0.2
    done
    if adb shell kill -0 "$VV_ANDROID_RECORDING_DEVICE_PID" >/dev/null 2>&1; then
      clean=false
      adb shell kill -9 "$VV_ANDROID_RECORDING_DEVICE_PID" >/dev/null 2>&1 || true
    fi
  else clean=false; fi
  if kill -0 "$VV_ANDROID_RECORDING_CLIENT_PID" >/dev/null 2>&1; then
    for attempt in $(seq 1 20); do
      if ! kill -0 "$VV_ANDROID_RECORDING_CLIENT_PID" >/dev/null 2>&1; then break; fi
      sleep 0.1
    done
    if kill -0 "$VV_ANDROID_RECORDING_CLIENT_PID" >/dev/null 2>&1; then kill "$VV_ANDROID_RECORDING_CLIENT_PID" >/dev/null 2>&1 || true; fi
  fi
  wait "$VV_ANDROID_RECORDING_CLIENT_PID" >/dev/null 2>&1 || true
  if adb pull /sdcard/vv-installed-journey.mp4 "$VV_ANDROID_PROOF_DIR/installed-journey.mp4" >/dev/null 2>&1; then pulled=true; fi
  python3 - "$VV_ANDROID_PROOF_DIR/recording.json" "$VV_ANDROID_RECORDING_STARTED" "$journey_status" "$clean" "$pulled" <<'PYRECORD'
import datetime,json,pathlib,sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'schemaVersion':1,'fixtureOnly':True,'physicalDevice':False,'test':'installedJourney','recording':'installed-journey.mp4','maximumSeconds':180,'boundedClip':True,'startedBeforeInstrumentation':True,'startedAt':sys.argv[2],'stoppedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'testExitCode':int(sys.argv[3]),'stoppedCleanly':sys.argv[4]=='true','pulled':sys.argv[5]=='true','credentials':'Synthetic fixture only; password and TOTP controls masked. No production account or Play signing identity.'},indent=2)+'\n')
PYRECORD
  VV_ANDROID_RECORDING_CLIENT_PID=''
  VV_ANDROID_RECORDING_DEVICE_PID=''
  [[ "$clean" == true && "$pulled" == true && -s "$VV_ANDROID_PROOF_DIR/installed-journey.mp4" ]]
}
start_journey_recording() {
  local existing
  existing=$(adb shell pidof screenrecord 2>/dev/null | tr -d '\r' || true)
  if [[ -n "$existing" ]]; then echo 'Another emulator recording is active; refusing to stop an unrelated process.' >&2; return 1; fi
  adb shell rm -f /sdcard/vv-installed-journey.mp4
  VV_ANDROID_RECORDING_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  adb shell screenrecord --size 720x1280 --bit-rate 1500000 --time-limit 180 /sdcard/vv-installed-journey.mp4 > "$VV_ANDROID_PROOF_DIR/recording-device.log" 2>&1 &
  VV_ANDROID_RECORDING_CLIENT_PID=$!
  for attempt in $(seq 1 30); do
    VV_ANDROID_RECORDING_DEVICE_PID=$(adb shell pidof screenrecord 2>/dev/null | tr -d '\r' || true)
    if [[ "$VV_ANDROID_RECORDING_DEVICE_PID" =~ ^[0-9]+$ ]]; then return 0; fi
    sleep 0.1
  done
  echo 'The bounded Android recording could not start.' >&2
  return 1
}
collect_android_proof() {
  VV_ANDROID_EXIT_STATUS=$?
  stop_journey_recording "$VV_ANDROID_EXIT_STATUS" || true
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
# Isolate the known unrelated launcher ANR on this disposable headless emulator.
# App/SystemUI/permission/document activities and application ANR dialogs remain enabled.
adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME > "$VV_ANDROID_PROOF_DIR/launcher-observed.txt"
VV_ANDROID_LAUNCHER=$(tail -1 "$VV_ANDROID_PROOF_DIR/launcher-observed.txt" | cut -d/ -f1 | tr -d '\r')
if [[ "$VV_ANDROID_LAUNCHER" == com.android.launcher3 || "$VV_ANDROID_LAUNCHER" == com.google.android.apps.nexuslauncher ]]; then
  adb shell pm disable-user --user 0 "$VV_ANDROID_LAUNCHER" >> "$VV_ANDROID_PROOF_DIR/launcher-observed.txt"
  adb shell am force-stop "$VV_ANDROID_LAUNCHER"
fi
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell settings put secure show_ime_with_hard_keyboard 1
adb install -r android/app/build/outputs/apk/verification/app-verification.apk
adb install -r android/app/build/outputs/apk/androidTest/verification/app-verification-androidTest.apk
# Record only the synthetic normal launch/auth/navigation journey, starting
# before ActivityScenario launches the app. The OS capture is bounded to 180s;
# checkpoint screenshots/hierarchies cover the complete test independently.
adb shell am force-stop com.voxelveda.app
start_journey_recording
set +e
adb shell am instrument -w -r -e fixture_port "$VV_ANDROID_FIXTURE_PORT" -e class com.voxelveda.app.AndroidJourneyTest#installedJourney com.voxelveda.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$VV_ANDROID_PROOF_DIR/installed-journey.txt"
VV_ANDROID_JOURNEY_PIPESTATUS=("${PIPESTATUS[@]}")
set -e
VV_ANDROID_JOURNEY_STATUS=0
if [[ "${VV_ANDROID_JOURNEY_PIPESTATUS[0]}" -ne 0 || "${VV_ANDROID_JOURNEY_PIPESTATUS[1]}" -ne 0 ]] || ! grep -Eq '^OK \(1 test\)' "$VV_ANDROID_PROOF_DIR/installed-journey.txt"; then VV_ANDROID_JOURNEY_STATUS=1; fi
stop_journey_recording "$VV_ANDROID_JOURNEY_STATUS"
if [[ "$VV_ANDROID_JOURNEY_STATUS" -ne 0 ]]; then exit "$VV_ANDROID_JOURNEY_STATUS"; fi
# Reopen the exact same installed artifact after a real process force-stop. Do
# not clear app data, cookies or the fixture server's persisted session map.
adb shell am force-stop com.voxelveda.app
adb shell am instrument -w -r -e fixture_port "$VV_ANDROID_FIXTURE_PORT" -e restart_only true -e class com.voxelveda.app.AndroidJourneyTest#installedJourney com.voxelveda.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$VV_ANDROID_PROOF_DIR/restart-journey.txt"
if ! grep -Eq '^OK \(1 test\)' "$VV_ANDROID_PROOF_DIR/restart-journey.txt"; then exit 1; fi
# Derive the remaining annotated methods, so adding a regression cannot silently
# leave it out when the recorded journey runs in its own instrumentation process.
VV_ANDROID_OTHER_TESTS=$(python3 - "$VV_ANDROID_PROOF_DIR/suite-selection.json" <<'PYSELECT'
import json,pathlib,re,sys
source=pathlib.Path('android/app/src/androidTest/java/com/voxelveda/app/AndroidJourneyTest.java').read_text()
methods=re.findall(r'@Test\s+public\s+void\s+([A-Za-z0-9_]+)\(',source)
assert 'installedJourney' in methods and 'stockFrameworkExternalFallbackDiagnostic' in methods
assert len(methods)==len(set(methods)) and len(methods)>=10
remaining=[m for m in methods if m!='installedJourney']
pathlib.Path(sys.argv[1]).write_text(json.dumps({'recorded':['installedJourney'],'remaining':remaining,'allAnnotatedMethods':methods,'fixtureOnly':True},indent=2)+'\n')
print(','.join('com.voxelveda.app.AndroidJourneyTest#'+method for method in remaining))
PYSELECT
)
adb shell am instrument -w -r -e fixture_port "$VV_ANDROID_FIXTURE_PORT" -e class "$VV_ANDROID_OTHER_TESTS" com.voxelveda.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$VV_ANDROID_PROOF_DIR/remaining-journeys.txt"
if ! grep -Eq '^OK \([1-9][0-9]* tests?\)' "$VV_ANDROID_PROOF_DIR/remaining-journeys.txt"; then exit 1; fi
adb shell am force-stop com.voxelveda.app
ANDROID_VERSION_CODE=3 ANDROID_VERSION_NAME=0.0.0-upgrade-fixture android/gradlew -p android --no-daemon :app:assembleVerification
node scripts/android-artifact-metadata.js android/app/build/outputs/apk/verification/app-verification.apk "$VV_ANDROID_PROOF_DIR/artifact-after-upgrade.json"
node -e 'const fs=require("fs"),p=process.env.VV_ANDROID_PROOF_DIR,a=JSON.parse(fs.readFileSync(p+"/artifact-before-upgrade.json")),b=JSON.parse(fs.readFileSync(p+"/artifact-after-upgrade.json"));if(a.packageId!==b.packageId||a.signingCertificateSha256!==b.signingCertificateSha256||b.versionCode<=a.versionCode)throw Error("Upgrade identity/version continuity failed")'
adb install -r android/app/build/outputs/apk/verification/app-verification.apk
adb shell am instrument -w -r -e fixture_port "$VV_ANDROID_FIXTURE_PORT" -e upgrade_only true -e class com.voxelveda.app.AndroidJourneyTest#installedJourney com.voxelveda.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$VV_ANDROID_PROOF_DIR/upgrade-journey.txt"
if ! grep -Eq '^OK \([1-9][0-9]* tests?\)' "$VV_ANDROID_PROOF_DIR/upgrade-journey.txt"; then exit 1; fi
adb shell pm get-app-links com.voxelveda.app > "$VV_ANDROID_PROOF_DIR/app-links-observed.txt"
adb shell dumpsys package com.voxelveda.app | grep -E 'versionCode|versionName|targetSdk|signatures' > "$VV_ANDROID_PROOF_DIR/installed-package.txt"
