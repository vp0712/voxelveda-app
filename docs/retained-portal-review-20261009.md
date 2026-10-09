# Retained account foundation review

The latest scope explicitly removes all Banking and ERP, including RFQs and quotations. The retained foundation contains registration/sign-in, a signed-in account home, the user's own profile, account security and company/privacy/support pages. It invents no replacement business module and does not create a ledger or migrate financial records. The root task has asked for the intended replacement product purpose separately.

## Retained frontend and removal boundary

The account home reads only `/api/auth/me` and uses actual returned name/email. It provides links to `/profile`, `/security` and `/support`, a theme control and sign-out. It has no RFQ form, business summary, financial card, chart, transaction count or other implied capability. Sign-in and MFA lead every existing role to `/dashboard`; permitted return destinations are `/dashboard`, `/profile` and `/security`. Existing identity roles and backend permissions were not modified by this frontend work.

The landing page describes only retained account capabilities. Registration copy now says “Create Account”, with small Privacy Policy, Terms and Support links. Account profile UI no longer displays ERP department/employee fields or counts them toward contact-profile completeness; historical backend fields remain unchanged. The company-wide privacy policy body remains in place because archived records still have confidentiality and retention obligations.

The explicit public-asset review lists are saved in `/workspace/retained-portal-proof/public-retained-whitelist.txt`, `public-delete-candidates.txt` and `public-retirement-review.json`. The superseding whitelist removes customer intake HTML/JS and its unused QR image. Root owns physical deletion. Candidates include old ERP/Banking dashboards, personal-money/report assets, shop-floor/workforce UI, controlled-form templates and unused navigation/chart/QR-widget scripts. This review does not authorize deletion of uploaded statements, report snapshots or database records.

The retained `step-up.js` previously injected controlled forms, a legacy dashboard avatar and four Personal Finance scripts after its security wrapper. Those loaders were removed. The password/MFA wrapper that responds to `STEP_UP_REQUIRED` remains. The Android operational notification bridge and notification permission were removed from native source; ordinary `BridgeActivity`, Internet access and optional camera support remain. The existing Capacitor wrapper points to `https://app.voxelveda.com` with `cleartext: false` and `webDir: public`.

## Access boundary

Source inspection initially found `/workspace.html` and `/security.html` reaching `express.static` without the corresponding page authentication. Root integration added canonical redirects for those and other account/public HTML aliases before static handling. Source reinspection confirmed their order. Runtime release checks must still verify unauthenticated requests to both URL spellings.

## Verification actually performed

`node scripts/retained-workspace-test.js` passed after the account-only revision. It executes actual retained browser scripts in DOM/fetch fixtures and verifies name/email rendering with imported markup as text, missing values, loading failures, retry recovery, timeouts, malformed identity responses, session-expiry redirects, confirmed/failed sign-out, role-independent home selection, retained login return paths, MFA destinations and absence of business workflows in entry pages. No fixture writes to production.

`node scripts/retained-theme-test.js` passed against the latest blue palette, checking light/dark contrast, hidden controls, shared-style injection, theme preferences and unchanged original logo bytes. `node scripts/customer-registration-test.js` passed its feature-gate, privacy/password, normalized identity, hashed password, duplicate protection and restricted account-permission checks. JavaScript syntax checks passed for the updated account home and profile scripts.

The updated local Chromium script is `/tmp/vv-account-foundation-browser.js` (also copied to the former helper path). It uses actual retained assets with local fixture identity/profile/security responses, checks phone portrait/landscape, tablet and desktop layouts, profile/security navigation, refresh, dark mode, page errors and any unexpected API call. It records proof under `/workspace/account-foundation-proof`. Playwright and Chromium are present. This agent has prepared the script; root must report its actual execution outcome.

## Evidence and access limits

- Older screenshots in `/workspace/retained-portal-proof` showing RFQ intake are superseded. They must not be used as proof of the account-only release.
- No authenticated production session was supplied. Source review/local fixtures do not prove authenticated production account/profile/security behavior.
- No real customer update, account creation, email, payment or financial write was performed by this review.
- No historical ledger, saved report, imported statement or user record was queried or modified.
- Native source changes have not been built into an APK, tested on real devices or released to an app store. No iOS build/device test was performed. Browser viewport emulation is not a native-device claim.
- Commit, production build, Railway deployment and live route/asset checks are root release work and must be reported separately with their actual outcomes.
