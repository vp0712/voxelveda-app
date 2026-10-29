# Native navigation repair, 29 October 2026

Source baseline: `4c01274945edcf15cf0394076602a8df4c00e884`. The existing Android and iOS identity remains `com.voxelveda.app`. Current sidebar, home charts, original logo, accounts, permissions, records and retained operational services are unchanged by these native edits.

## Confirmed source boundaries

Android is Capacitor 8.5.2 / `BridgeActivity` / Android WebView. Current source already starts at `https://app.voxelveda.com` and uses the exact-host application WebView client. Historical binaries can still contain the old Railway origin. The real Capacitor cross-host fallback creates `ACTION_VIEW`, so changing the website cannot replace an old installed binary. The affected device's actual OS, version, installation source and signing identity still require identification; no inference from the latest website is valid.

A further Android popup defect was present: the native new-window callback marked the initial `about:blank` document as a handled external destination. A delayed `window.open()` destination was then discarded. The repair treats only empty/about:blank placeholders as temporary, non-privileged windows, routes the subsequent exact first-party/legacy destination into the main WebView and cleans idle windows after 25 seconds. Popup subframes cannot navigate the main application. External destinations still require an intentional gesture and native confirmation.

The iOS storyboard previously used stock `CAPBridgeViewController`. In the locked Capacitor framework, `WebViewDelegationHandler.createWebViewWith` calls `UIApplication.shared.open` for every popup URL, including a first-party destination. The application now registers a navigation policy plugin from its storyboard controller before the initial load. Canonical first-party new-window requests load in the same WKWebView, preserving same-origin request bodies and the existing WebKit cookie store. Only safe legacy GET navigation is rewritten; legacy writes are blocked without forwarding credentials or replaying them. External links need an explicit link activation and confirmation, rather than automatically opening Safari during ordinary redirects.

An initial blank iOS popup has a separate content controller without the Capacitor bridge, cannot execute content JavaScript, and expires after 25 seconds if never assigned. The forwarding WKUIDelegate retains Capacitor's existing dialogs, media and file-picker methods. Trusted cold/warm application URLs are forwarded by AppDelegate to the same controller while retaining ApplicationDelegateProxy callbacks. No cookie cloning, TLS bypass, authentication relaxation or third-party OAuth provider was introduced.

## Repaired iOS source-build failures

The baseline Xcode Cloud check `122910308754` reported that automatic dependency resolution was disabled and the required workspace `Package.resolved` was missing. SwiftPM also declared Capacitor 8.3.1 while the locked npm iOS/runtime tooling was 8.5.2. The source now pins the official 8.5.2 tag revision `0b6882e9a3288342aacf36348e5a94e4f1dd7b13` in Xcode's resolved file. That revision was independently read from Ionic's official Git tag, not fabricated from an upload key or substituted identity. The upstream package has no other remote dependencies and verifies its binary framework checksums through SwiftPM.

The project references `App/capacitor.config.json`, `App/config.xml` and `App/public`, but those generated resources were missing from the baseline checkout. The Xcode Cloud post-clone hook now uses the locked CLI to synchronise the small existing native shell and canonical configuration before the build. It does not copy old portals or credentials into the bundle. Automatic Apple signing configuration, bundle identifier and version settings are retained.

## Verification and limits

Local checks passed the actual Java navigation policy's origin/legacy/placeholder behavior, managed native Back regression, iOS source/pin/storyboard contract and shell-script syntax. A disposable source copy ran the actual Capacitor `copy ios`, then verified generated config/XML, exact shell bytes and original-logo SHA-256; repository-generated assets were not modified.

The added Android installed instrumentation case physically taps a fixture button, opens a real Chromium blank popup and assigns delayed canonical and legacy routes. It requires the same installed WebView/session and zero external browser intents. Existing installed tests retain actual auth/MFA, cold start, blank-page recovery, Back/unsaved forms, network recovery, QR/camera, PDF preview/save and fixture APK upgrade coverage. These are synthetic accounts and test-signed fixtures, not a Play rollout or physical-phone proof.

The new macOS iOS gate runs the actual Foundation URL policy, prepares native resources, compiles the actual unsigned simulator application and verifies its built bundle/config/identity. Linux has no Swift/Xcode, so Swift/UIKit compilation and iOS bundle checks must pass that gate before claiming source-build verification. The gate does not establish an installed iOS interaction, TestFlight upload, App Store distribution or the behavior of the affected phone. Actual iOS camera/file/download/share and physical-device flows remain distinct verification requirements.

Production Android tasks require the existing upload key, actual Play App Signing fingerprint, verified maximum version code, intended track and Publisher access. Default Android source versions and verification codes 2/3 are not production release versions. iOS source version 1.0/build 1 likewise does not establish the current TestFlight/App Store version. No signing identity, release number or store update is invented by this repair.
