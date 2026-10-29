# Configure the existing Voxel Veda Android release

These steps enable the existing `com.voxelveda.app` release workflow. They do not create a new app, upload key or signing identity. A repository administrator needs the existing upload-key owner's help and access to the existing app in Google Play Console.

Do not send keystores, passwords, service-account JSON or access tokens through chat, issues, pull requests or workflow inputs. Enter secrets only in GitHub's secure secret settings. Public certificate fingerprints, version codes and track names are safe to share.

## 1. Add the five existing secrets

Open [Voxel Veda repository secrets](https://github.com/vp0712/voxelveda-app/settings/secrets/actions), then **New repository secret**. Add these exact names:

| Secret name | Existing value to enter |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Base64 contents of the existing upload keystore, prepared locally below. |
| `ANDROID_KEYSTORE_PASSWORD` | Its existing keystore password. |
| `ANDROID_KEY_ALIAS` | The existing upload-key alias inside that keystore. |
| `ANDROID_KEY_PASSWORD` | That existing key's password. Do not assume it equals the keystore password. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | The complete JSON key for the existing approved Google Play publisher service account. |

An organisation secret is also usable if its repository access includes `vp0712/voxelveda-app`. The workflow reads these repository/organisation bindings; adding them only to a GitHub environment without wiring that environment into the job will not expose them to this workflow.

### Prepare base64 without printing it

On a trusted computer with Python 3, replace the two example paths with your existing keystore and an output file in a private local folder. The output must not already exist. This writes the sensitive encoded value to a file, never to the terminal:

```sh
python3 - "/absolute/path/existing-upload-key.jks" "/absolute/private/path/voxel-upload-key.base64" <<'PY'
import base64
import os
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
encoded = base64.b64encode(source.read_bytes())
descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "wb") as output:
    output.write(encoded)
PY
```

Open that local output file in a trusted editor, copy its entire contents into the GitHub secret's **Secret** field and save it. Close the editor and remove the temporary base64 copy after setup. Keep the original keystore in its existing protected backup. Base64 is an encoding, not encryption. On Windows, use the same Python code with private Windows file paths and ensure the destination folder is restricted to the key owner.

If the existing keystore, alias or passwords are unavailable, contact the existing signing-key owner. Do not generate a substitute keystore: that would not establish an installed-user upgrade identity.

### Bind the existing publisher

Use the existing service account and approved Google Cloud project. The Android Publisher API must be enabled, and that service-account email must have access to the **existing Voxel Veda app** in Play Console's **Users and permissions**. Grant only the release rights needed for the intended track: testing-track release rights for internal testing, and production-release rights only for an intended production release.

Enter the existing JSON key directly as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Do not convert it to base64, commit it or place it in a workflow input. If its owner cannot provide an existing approved credential through this secure setup, report that exact missing publisher binding; do not create an unrelated publisher or replace the app identity.

## 2. Verify both public certificates

In Play Console, select the existing app whose package is **`com.voxelveda.app`**, then open **App integrity / App signing** (the menu may appear under **Test and release → Setup**). Record both SHA-256 fingerprints:

| Certificate | Purpose | Where the workflow uses it |
| --- | --- | --- |
| **Upload key certificate** | Verifies the existing key that signs the AAB uploaded to Google. | `upload_certificate_sha256`; checked against the configured keystore. |
| **App signing key certificate** | Google signs the APKs actually installed from Play with this identity. | `app_signing_sha256`; must match the live Android App Links association. |

They can be different. Do not use the upload certificate, a debug/emulator certificate or an invented fingerprint as the production App Signing identity.

The upload-key owner can inspect its public certificate locally with:

```sh
keytool -list -v -keystore "/absolute/path/existing-upload-key.jks" -alias "existing-upload-alias"
```

Enter the password at the interactive prompt, not in the command. Compare the displayed SHA-256 with Play Console's **upload key certificate**.

The application infrastructure's existing `ANDROID_APP_SIGNING_SHA256` configuration must contain the verified **App signing** fingerprint. Its protected infrastructure administrator should configure it through the existing secure workflow. Then verify that [assetlinks.json](https://app.voxelveda.com/.well-known/assetlinks.json) returns HTTP 200 and associates `com.voxelveda.app` with that certificate. The workflow fails closed while the association is absent or wrong. Changing this public certificate configuration does not require changing DNS or buying a plan.

## 3. Record existing Play versions and the intended track

In the same app's **App bundle explorer / All app versions** and release-track screens, inspect existing AAB/APK version codes, including testing, production and draft releases. Record the highest existing code. Check the exact intended API track identifier and its current release state; common standard identifiers are `internal` and `production`, but this workflow never guesses or creates a track.

Choose a new `version_code` strictly above the verified highest code, no greater than `2100000000`. Choose the approved user-facing `version_name`. Test fixture versions such as `0.0.0-verification` and disposable emulator signing certificates are not production release facts.

Before any optional upload, the helper independently queries the existing app's current tracks, bundles and APKs. The new code must exceed both that fresh observed maximum and the owner-verified maximum. An existing draft, staged/halted rollout or complex target track requires reconciliation in Play rather than automatic replacement.

## 4. Run the existing workflow

Open [Prepare or explicitly publish existing-identity Android bundle](https://github.com/vp0712/voxelveda-app/actions/workflows/android-signed-bundle.yml), choose **Run workflow**, and select branch **main**. The checked source must have passed `application-release`, `mysql-regression`, `android-installed`, `current-preservation` and `Security checks and tests`. A marker-only web release resolves back to its recorded checked source.

| Workflow input | Value |
| --- | --- |
| `version_code` | The new integer code above every existing Play code. |
| `version_name` | The approved release name. |
| `verified_play_max_code` | The highest existing Play code just checked by the owner. |
| `upload_certificate_sha256` | Existing upload certificate's colon-separated SHA-256. |
| `app_signing_sha256` | Actual Play App Signing certificate's colon-separated SHA-256. |
| `play_intent` | `artifact-only` by default; select another intent only for an actual Play submission. |
| `play_track` | Exact existing track for a submission; leave blank for artifact-only. |
| `play_release_status` | `draft` or `completed`, consistent with the intent below. |

Supported combinations:

| Intent | Track | Status | Actual effect |
| --- | --- | --- | --- |
| `artifact-only` | Blank | Default `draft` is unused. | Builds and retains the signed AAB; no Google authentication, Play upload or publication. |
| `draft` | Explicit existing track | `draft` | Uploads and commits a new draft while preserving its currently completed release. It does not make the draft available to users. |
| `internal` | `internal` | `completed` | Uploads and submits an internal-track release, subject to Play processing and configured tester eligibility. |
| `production` | `production` | `completed` | Explicitly submits the production release. This helper does not implement a staged-percentage rollout. Review/processing can still prevent immediate store availability. |

Publishing is manual-only, uses the existing signing identity and runs one transactional Play edit. A main revision superseded while the bundle was building is refused before publishing. The workflow serialises releases and will not rerun a publishing attempt automatically. No additional typed approval phrase is required.

## 5. Inspect results before retrying or announcing delivery

The signed artifact is named `existing-app-signed-bundle-<version_code>-<commit>`. A publishing attempt also retains `existing-app-play-result-<version_code>-<run_id>-<attempt>`, containing the package, source SHA, version, track, original artifact hash, observed versions, edit identity and outcome. It contains no credential or PDF/business-report contents.

An uploaded bundle is not a committed release. `PROVIDER_COMMIT_ACCEPTED` means Google accepted the edit; Play review, store availability and physical-user distribution remain separately **UNVERIFIED** until checked. In Play Console, record the actual version/track, review or availability state and tester access. Then install/update through the actual authorised track and verify the package/version on the device.

For `COMMIT_OUTCOME_UNCERTAIN`, an upload/response uncertainty or an unverified cleanup, inspect the recorded edit, existing bundle and track state read-only before deciding any recovery action. Do not rerun the failed job or automatically upload/commit again: Google may already have accepted the request. A controlled fresh dispatch is appropriate only after the previous outcome has been reconciled.

Finally test actual installed cold start, login/resume, internal navigation, Back/unsaved values, QR camera permission and PDF preview/save/share. Record physical-device evidence separately from browser emulation and installed-emulator tests. A web deployment or successful signed bundle never proves users received a native update.

## iOS is a separate existing release

The source also retains the existing iOS bundle identity `com.voxelveda.app`. The iOS source/simulator workflow and Xcode Cloud archive are separate from Android publishing. Use the already authorised App Store Connect/Xcode Cloud app and managed signing; do not substitute an Apple Team ID or signing identity. Record the actual build, TestFlight group/track and availability through that existing account before claiming an iOS update was distributed. See [native navigation evidence](NATIVE_NAVIGATION_20261029.md) for the implementation and testing boundaries.
