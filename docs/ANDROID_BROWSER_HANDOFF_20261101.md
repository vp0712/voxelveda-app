# Android Play browser-handoff investigation

Baseline application source and live SHA: `ba7b6790849c02b50b3f51a8db5e12483f03b9aa`. This investigation preserves the current sidebar, charts, original logo, operational modules, records, permissions, staff/timesheet functions and email schedule. Banking and the added ERP remain retired.

## Installed identity and scope

The user confirmed **Android**, installed through **Google Play**, and supplied the listing `https://play.google.com/store/apps/details?id=com.voxelveda.app`. The reported browser destination is `app.voxelveda.com`. The exact installed version/build and foreground browser package have not yet been supplied or obtained from the affected handset. A store listing identifies the package; it does not identify that device's binary, certificate, cached state or native framework.

Current repository Android uses Capacitor 8.5.2 with `BridgeActivity` and an embedded Android WebView. Its bundled origin is canonical HTTPS. `ApplicationWebViewClient` handles first-party and safe legacy navigation before Capacitor's external fallback; login/MFA use relative routes. The remaining production external `ACTION_VIEW` requires an explicit user gesture and native confirmation. No current TWA/Custom Tabs implementation was found. None of these source facts establishes that the Play-installed binary contains this configuration.

History proves an older Railway startup configuration existed before the canonical-origin migration in August. The stock framework's cross-host fallback emits `ACTION_VIEW`, as the separate diagnostic demonstrates. This is a possible older-binary mechanism, not a reproduced cause on the user's installed app. No browser-handoff production patch is selected solely from the website working or a missing App Links association.

## Stronger installed evidence

Previous normal tests observed external intents while stubbing their result. Normal journeys now retain intent observation but **do not suppress external browser launches**. The deliberately browser-opening stock-framework diagnostic has its own local stub and is excluded from normal proof.

Instrumentation records the actual `UiDevice` foreground package, resumed activity parsed from `dumpsys activity activities`, query-free origin/path, installed `PackageInfo` version/code and compiled source, external-intent count, browser-toolbar detection, screenshot and UI hierarchy at each checkpoint. Normal checkpoints must retain `com.voxelveda.app/.MainActivity`. PDF preview records the app's actual `PdfActivity` separately; explicit camera permission and PDF save pickers are labelled OS actions rather than ordinary app navigation.

The normal path covers cold entry, rejected and accepted login, background/resume, profile, warm and legacy deep links, recovery screens, session expiry, MFA rejection/success, logout, network recovery and cookie restoration. Admin register checks cover RFQ, invoice, procurement, stock, task and attendance navigation. These registers use synthetic fixture data/error states and do not establish private production CRUD. A separate real force-stop/relaunch preserves the recorded staff session before other tests run. The existing fixture APK upgrade is still independently checked.

A bounded 180-second `adb screenrecord` begins before the recorded journey launches the activity. Checkpoint screenshots/hierarchies cover the complete journey if it outlasts the clip. Success/failure cleanup stops the capture and retains the original MP4 and recording status. No physical-handset, Play signing or store distribution claim is made from this video.

`scripts/android-handoff-proof.js` independently checks collected rows against the analysed before/after APK identities, rejects another foreground package/activity, browser/custom-tab controls, suppressed or emitted external intents, missing stages, unsafe references/URL query data and inconsistent versions/source. It verifies the genuine device PNGs and readable bounded MP4 via `ffprobe`. Its fixture tests reject malformed/truncated evidence. These verification tools run in the Android CI job, not production startup or the web build.

## Run and interpret the existing workflow

The existing `android-application.yml` workflow builds and installs verification artifacts, runs the recorded journey, force-close/relaunch, remaining annotated groups and fixture upgrade, then validates the collected evidence. Uploaded `native-handoff-verification.json`, foreground JSONL, PNG/XML and `installed-journey.mp4` provide the evidence. Source assertions or workflow presence alone are not a pass; inspect the actual terminal run and artifact.

Fixture versions `0.0.0-verification` code 2 and `0.0.0-upgrade-fixture` code 3 use a disposable test certificate. They must never be installed over the user's Play app, put in production assetlinks, or described as a Play update. Existing accounts/data must not be reset to work around a signature mismatch.

The existing signed-bundle/publishing workflow still needs the original secure upload-key bindings, authorised Play publisher, actual App Signing certificate, verified highest existing Play version code and explicit existing track. See [native release setup](NATIVE_RELEASE_SETUP.md). A website deployment cannot replace bundled native configuration. Do not invent a version, certificate or duplicate app identity, bypass release guards, or automatically resend/update business records.

Before claiming this fixed for the user, identify the affected installed version, reconcile its artifact with the release, publish an appropriately incremented existing-identity update if required, and observe that updated installation staying in-app. Browser fixtures, installed emulators, physical devices and Play processing/distribution remain separate evidence classes.
