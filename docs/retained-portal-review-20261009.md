# Retained customer application review

This review follows the latest instruction to remove Banking and ERP. The retained web application contains customer quote intake, registration/sign-in, the signed-in workspace, the user's own profile, account security and company/privacy/support pages. It does not create a second ledger or migrate financial records.

## Source review and removal boundary

The reviewed `app.js` mounts authentication, users, own-profile, limited company settings, document-security and security/readiness routes. The customer intake endpoint is `POST /api/public/rfq`; its six-field request contract remains separate from removed internal RFQ list/approval workflows. Old administration/client/role entry points redirect to `/dashboard`. Banking and ERP routes return an explicit `410 MODULE_RETIRED` response and do not load their implementations.

A source dependency review identified 58 retained public assets and 123 removable public assets. The complete lists and machine-readable findings are saved in `/workspace/retained-portal-proof/public-retained-whitelist.txt`, `public-delete-candidates.txt` and `public-retirement-review.json`. The removable set includes old Banking/ERP dashboards, Finance/personal-money/report assets, quality/shop-floor/workforce UI, recovery/operations diagnostic screens, controlled-form templates and unused navigation/chart/QR-widget scripts. These are source-controlled assets; this review does not authorize deleting uploaded statements, report snapshots or database records.

Retained dependencies include:

- Actual public/account pages and their scripts: `workspace`, `customer`, `login`, `register`, `profile`, `security`, MFA, password recovery and invitations.
- Shared appearance and branding: `workspace-theme`, `workspace.css`, `style.css`, `public-pages.css`, `auth-entry.css`, `global-brand` and the original logo/icon files.
- The account step-up password/MFA wrapper, manifests, service worker, robots/sitemap and public privacy/support/contact assets.
- Existing Capacitor Android/iOS wrappers and branding. Their configured server is `https://app.voxelveda.com`, with `cleartext: false` and `webDir: public`.

The retained `step-up.js` previously injected controlled forms, a legacy dashboard avatar and four Personal Finance scripts after its security wrapper. Those loaders were removed. The wrapper that responds to the server's `STEP_UP_REQUIRED` challenge remains. The Android operational notification bridge and notification permission were removed from native source; ordinary `BridgeActivity`, Internet access and optional camera support remain. `site.webmanifest` now matches the current customer application manifest and palette.

## Access boundary

The initially inspected app protected `/dashboard`, `/profile` and `/security`, and redirected `/profile.html` to the protected canonical route. `/workspace.html` and `/security.html` initially reached `express.static`: their APIs required authentication, but the HTML itself did not. Root integration subsequently added both canonical redirects, along with the remaining account/public HTML aliases, before static handling. Source reinspection confirmed their order. The release runtime checks must still verify unauthenticated requests to both spellings; direct `.html` access must not become an alternative route around page authentication.

## Verification actually performed

`node scripts/retained-workspace-test.js` passed. It executes the actual retained browser scripts in a DOM/fetch fixture and checks identity rendering with imported markup as text, visible account failure/timeout states, disabled intake before identity loads, consent/quantity validation, duplicate submission prevention, confirmed and missing request references, failed sign-out feedback, universal role navigation, retained login return paths and MFA destinations. The intake fixture never writes to production.

`node scripts/retained-theme-test.js` passed after shared-brand integration. It checks light/dark text and control contrast, unchanged original logo bytes, shared stylesheet injection, preserved hidden controls and saved theme preferences. `node --check public/step-up.js` passed after loader removal.

The local Chromium script `/tmp/vv-retained-portal-browser.js` is prepared. It uses actual retained assets with local fixture identity/intake responses, checks phone/tablet/desktop and phone dark mode, validates form/refreshed page behavior and records screenshots. Playwright and Chromium prerequisites are present. This review does not claim that script has run.

## Verification limits

- No authenticated production session was supplied for private workspace/profile/security testing. Source review and local fixtures do not prove authenticated production behavior.
- No real quote, customer update, account creation, email or payment was sent or written as part of this review.
- No historical ledger, saved report, imported statement or user record was queried or modified.
- Android native source changes have not been built into an APK, tested on a real Android device or released to a store. No iOS build/device test was performed. Web viewport emulation is not a Safari/Android/WebView device claim.
- Commit, Railway deployment and live route/asset checks are root release work and must be reported separately with their actual outcomes.
