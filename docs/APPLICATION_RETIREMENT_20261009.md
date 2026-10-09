# Account foundation release — 9 October 2026

The latest product instruction removes all Banking, Finance and ERP business workflows, including RFQ and quoting, from Voxel Veda. It supersedes both the earlier Finance repair/extraction request and the intervening customer-RFQ release. This version retains the company information site and existing account, registration, profile, security, user administration and support foundations. It does not introduce a replacement business module while the intended future purpose is being clarified.

**This update is not yet verified live.** The earlier teal/customer-RFQ release passed its candidate checks but its Railway build failed. The currently inspected successful production deployment remains the previous release. Record the final merged commit, release marker, Railway revision and live evidence below only after verification.

## Architecture implemented in this candidate

- `/` provides company information and account/support entry links; `/register` retains permitted account registration. RFQ, quoting, invoice, procurement, inventory, production, workforce and every Banking/Finance business workflow are removed.
- `/dashboard` is the authenticated account home. Its focused controls link to `/profile`, `/security` and `/support`. It contains no quote submission or business-operation form. It uses the existing identity and database; there is no parallel ledger or new transaction store.
- `/profile` and `/security` retain authenticated account and security controls. Session validation, MFA, authorization, audit, retained secure-document boundaries and security administration remain enforced.
- Old role entry points (`/admin`, `/client`, `/portal/:role` and former role dashboard filenames) redirect authenticated users to the account home. Redirects do not grant permissions.
- Retired page/API/asset names return explicit `410 Gone` responses. This includes `/request-quote`, `/customer.html`, `/api/public/rfq` and old financial report links. These responses do not rerun, regenerate or expose archived business records.
- The active startup and application graph contains account/security foundations only. Physically removed files and original checksums are recorded in [APPLICATION_REMOVAL_MANIFEST.json](APPLICATION_REMOVAL_MANIFEST.json). Regression checks require those paths to be absent and all retained imports to resolve.
- The new palette uses deep navy, slate and royal blue, with coordinated light/dark appearances. It replaces the earlier teal choice. Privacy and support remain readable footer links; retired RFQ links are removed.
- The original `public/logo.png` remains byte-identical: SHA-256 `ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312`.

The existing domain is `https://app.voxelveda.com`. No new domain or infrastructure cutover is proposed. These candidate routes must still be checked on that actual domain after a successful deployment.

## Preservation, backups and exports

Code retirement is not database erasure. The application must preserve financial records, accounts, customers, RFQs, quotations, historical reports, imported statements, original files, retired settings and their stable IDs. No business table is dropped, truncated or purged as part of this release.

Historical SQL migrations retain their original bytes/checksums because the existing migration ledger and rollback depend on them. Account-only startup verifies applied/baselined migration checksums and fails closed if an old migration is pending or changed; it does not replay retired business-schema or data SQL. Earlier production baseline logs show 82 migration checks. That evidence is not a backup/export or restore test.

Existing encryption secrets and encrypted records remain in place. Removing a retired key from mandatory readiness checks does not remove the Railway secret, decrypt its records or establish that an export can be restored.

The user subsequently waived backup verification for this code-only release. No backup/export/restore is claimed verified. Railway exposes no backup-status URL and its connector withholds database credentials. Existing data and files remain archived in place, encryption secrets remain unchanged, and code recovery is available from the original production commit and manifest.

Document requests reject retired module classifications, including RFQ, before reading file/object content or consuming an existing grant. Retained document classifications are `profile` and `security`; ordinary ownership/permission checks still apply. Ownership transfer actions affect retained account/security scope only. Archived business-record/document owner IDs remain unchanged.

The shared email queue supports retained account/security/contact messages. RFQ, Finance, ERP and unclassified historic queued rows remain unchanged and unsent. The worker does not submit these to a provider. Shared email/audit schema initialization no longer imports workforce or RFQ implementations. Binary attachment content retains metadata and integrity checking through its serialization boundaries.

## Root causes and issue register

| Issue | Reproduction / affected module | Severity | Cause | Candidate repair | Evidence / remaining limit |
| --- | --- | --- | --- | --- | --- |
| Removed product remained reachable through direct URLs | Request an old Banking/Finance/ERP page, API or asset | High | Retired router imports, static files and startup jobs outlived navigation changes | Delete source implementations and router/job registrations; return explicit `410` | Real Express fixture and removed-source/import-closure checks; live verification pending |
| RFQ/quoting remained after all ERP business workflows were retired | Open `/request-quote` or POST `/api/public/rfq` | High | Interim customer release intentionally retained public RFQ intake | Remove RFQ controller, form, client code, route and active references; hold old queued RFQ mail | Updated source/route tests; final runtime and live checks pending |
| Old role dashboards reopened operational UI | Open former role dashboard filenames or `/portal/:role` | High | Separate operational role shells and client return paths | Keep authenticated account-home redirects and canonical account return paths | Actual page-auth/Express alias fixture; authenticated production session not supplied |
| Direct shell filenames bypassed canonical page entry | Request `/workspace.html`, `/security.html` or `/profile.html` | Medium | Static filename access differed from page routing | Redirect to the protected canonical account pages | Anonymous login/return-path regression |
| Generic documents and owner transfers could expose/change archived business data | Request old Finance/RFQ document as owner or via an existing grant; terminate/transfer an account | High | Module-agnostic shared content and ownership targets | Restrict read/grant/mutation scope before content reads; preserve archived owner IDs | Retained boundary/document fixtures; no actual historical file content read |
| Foundation startup still depended on removed workers | Start after physical business-source deletion | High | Shared initialization and job scheduling imported workforce/Finance implementations | Extract account/security audit and email schema; retire business jobs | Real bootstrap dependency and failure/shutdown fixtures; retained import closure |
| Retired pending email could send after cutover | Claim an old RFQ/Finance/timesheet/unknown queue row | High | Queue claims were not scoped to the current product | Retained module whitelist for enqueue/claim; preserve old rows | Queue fixture checks provider calls and row/content parity; no real recipient mail sent |
| Generic settings/ownership still touched archived data | Write bank/tax/report settings or transfer retired records | High | Shared broad settings and ownership allowlists | Company/contact-only settings and account/security-only transfer scope | Actual route/controller/ownership fixtures; archived values preserved |
| Railway build failed after local/CI checks passed | Build release-marker commit `9e8fc1928b913a8ea6c440f9396ce9fb33eab4b7` | High | Scanners expected `.git` in the packaged Railway source artifact | Add deterministic actual-file inventory when Git metadata is absent; retain validation and secret checks | Portability fix implemented in candidate; complete build/redeployment still required |
| Retained pages loaded mixed/obsolete theme assets | Open company, login, registration, profile and account-home screens | Medium | Broad role/ERP style injection and old asset versions | One navy/slate/royal-blue contract, canonical shared asset versions and accessible controls | Updated renderer/theme/browser checks required; live screenshots pending |

The failure in Railway deployment `331cf7f9-b772-436c-965d-548680beea0a` occurred during build; it is not a successful customer or account-only release. The previous successful production deployment stayed active. Provider acceptance, healthy local pages or source tests cannot substitute for a successful actual production revision.

This issue register does not claim every original workflow was fully audited or repaired. Business workflows are being removed under the latest instruction. No current production record-count/export parity or whole-app authenticated production audit has been completed without the necessary access and evidence.

## Meaningful tests and their limits

Run the retained-product suites against the final tree; obsolete feature tests are replaced because their product implementation is gone, not disabled to manufacture success.

- `scripts/application-retirement-test.js`: real Express routing without a listening socket, actual HTML renderer/readiness/page-auth middleware, retired pages/APIs/assets and POST entry points, no database/provider side effects for retirement responses, anonymous login return paths, canonical aliases, retained company/account HTML, synthetic authenticated account home/profile/security, physical deletion manifest, retained import closure, removed business jobs and original logo digest.
- `scripts/retained-runtime-test.js`: actual foundation startup/shutdown against strict dependencies, failure before listening, shared queue schema retry/idempotence, retired-message hold, binary attachment integrity and retained capacity-recovery scope.
- `scripts/retained-workspace-test.js`: actual account-home client and login/MFA navigation under deterministic browser fixtures, identity loading/failure/retry, safe profile/security links, logout failure and retained return paths. RFQ submission tests are removed with the workflow.
- `scripts/retained-theme-test.js`: shared renderer/theme behavior and navy/slate/royal-blue contrast, logo/hidden-attribute preservation, stylesheet idempotence, metadata consistency and footer sizing.
- `scripts/core-audit-isolation-test.js` and retained boundary/document tests: schema retry/idempotence, audit redaction/integrity, company-only settings, preserved archived values/owners, and denied retired module reads/grants without content access.
- Scanner/source inventory regressions: Git checkout and packaged-source enumeration, incomplete artifacts, runtime environment files and hardcoded secret rejection. Production build must exercise the packaged-source path.

The updated retirement fixture passed after RFQ deletion, checking 95 retained runtime sources and the full removal manifest. Full production build, disposable MySQL and actual browser checks are required on the final candidate in CI. The local managed shell prevents child-process execution (EPERM), so a local npm build was blocked rather than reported as passed.

All test identities are synthetic and local only. No test mints a production credential, sends a real email, creates a real account/RFQ, changes a customer/financial record, initiates a payment or accesses an inbox. Fixture coverage does not prove a private authenticated production session, actual backup/export integrity, provider delivery, production record counts or execution on a real Safari/Android/WebView device. Report those limits explicitly.

## Release workflow and rollback

Inspected production baseline:

- Repository `vp0712/voxelveda-app`, production branch `main`.
- Successful baseline commit `80733384e62ce47942f5ad19481973f90aa568e0`, Railway deployment `a7112230-6587-443b-b2ba-08a4d4e7543a`.
- Failed attempted release-marker commit `9e8fc1928b913a8ea6c440f9396ce9fb33eab4b7`, Railway deployment `331cf7f9-b772-436c-965d-548680beea0a`.
- Railway project `e41bb335-4f02-4251-8895-9195dc69726e`, production environment `113e44d2-01a4-4c87-a192-48e15f47dab9`, app service `7dc16dbd-e670-46ae-9053-ef1b06873f71`.

Refresh repository/deployment state before releasing. Push the final candidate branch, open a pull request, run required checks, merge the exact reviewed head, verify merged `main` checks and then make the separate `.railway-release` marker commit. Railway watches the marker. Do not bundle the marker with an unverified candidate, force-push or bypass checks. An earlier passing candidate does not validate later RFQ removal, palette changes or scanner fixes.

No destructive data migration is authorized for this release. Shared schema changes are additive/idempotent; historical migrations, existing storage, database and encryption secrets stay in place. The user waived backup verification for this release. Keep archived data in place and verify code rollback and actual deployment; no backup/export/restore proof is claimed.

If code rollback is needed:

1. Stop advancing the marker and record the failing revision and actual health/build/runtime evidence.
2. Create a rollback branch from current `main`. Revert the relevant release merges through normal pull requests, restoring the compatible baseline runtime, dependency lockfile, former UI and required checks together. Use baseline `80733384e62ce47942f5ad19481973f90aa568e0` and the removal manifest as source restoration evidence; do not reset or force-push `main`.
3. Restore the prior Railway pre-deploy command, including its two recovery migration wrappers, when returning to that baseline. Verify compatibility with unchanged database records, original files and additive shared schema. Do not replace production data with an old backup merely to undo source changes.
4. After rollback checks and merged checks pass, create the separate release marker under the existing workflow. Verify the actual Railway revision/backend readiness and restored authenticated entry paths. Emergency rollback to the last successful deployment must follow the permitted infrastructure controls.

The archived unfinished Finance report repair is source recovery only. It is not part of the current product, not deployed, and not evidence of a production database backup.

## Release evidence — update only from actual results

| Evidence | Current result |
| --- | --- |
| Latest candidate / merged commit | Pending account-only changes |
| Required checks and production build | Previous candidate/main checks passed; Railway build then failed. Latest account-only/packaged-source checks pending |
| Latest release-marker commit | Pending |
| Railway deployment / live revision / result | Latest attempted teal release failed build; previous successful production remains active |
| Verified backup/export/restore evidence | User waived verification; no backup/restore claim |
| Live domain and backend readiness | Pending latest-release checks |
| Live Banking/Finance/ERP/RFQ retirement responses | Pending latest-release checks |
| Live company, registration/account pages and logo | Pending latest-release checks |
| Phone/tablet/desktop screenshots | Pending latest palette/account-only checks |
| Authenticated production account/profile/security | Requires an authorized application session; fixture tests do not substitute |
