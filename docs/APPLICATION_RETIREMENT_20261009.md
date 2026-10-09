# Customer application release — 9 October 2026

The latest product instruction removes Banking and ERP from Voxel Veda, including their implementation files, and changes the app theme. It replaces the earlier Finance extraction/report repair request. This release retains a customer workspace, public quote requests, customer registration, profiles and account security. It uses the existing deployment, identity, database and original company logo.

This document describes the implementation and available evidence. **Production release verification is pending at the time this document is written.** A successful local test is not a deployment result. The release operator must record the merged commit, release marker, Railway deployment result, live checks and screenshots below after completing the existing permitted release workflow.

## Architecture actually implemented

- `/` is the customer landing page; `/request-quote` provides public project enquiries; `/register` retains the existing permitted customer registration flow.
- `/dashboard` is the authenticated customer workspace. The workspace contains project quote intake and account links, without Banking, ledger, procurement, workforce, invoicing or operational ERP navigation.
- `/profile` and `/security` retain authenticated account and security controls. Authentication, MFA, session validation, authorization, secure documents and security administration remain enforced on their retained backend routes.
- Old role entry points (`/admin`, `/client`, `/portal/:role` and old role dashboard filenames) redirect authenticated users to `/dashboard`. They do not grant additional permissions.
- Banking and ERP pages, API prefixes and retired asset filenames return an explicit `410 Gone` response. Old report links intentionally report that the module is unavailable. They cannot view or regenerate historical financial reports in the customer application.
- The active application and startup dependency graph contains the retained customer/security runtime only. The removed source files and their original checksums are recorded in [APPLICATION_REMOVAL_MANIFEST.json](APPLICATION_REMOVAL_MANIFEST.json). The regression suite requires those files to be physically absent.
- The new theme uses white, charcoal and teal, with a coordinated dark appearance, consistent form controls and small Customer RFQ / Privacy Policy footer links. The original `public/logo.png` is byte-identical: SHA-256 `ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312`.

The app stays on `https://app.voxelveda.com`. No new service, domain, transaction store or database copy is introduced.

## Records, files and permissions

Runtime removal is not database erasure. This release does not drop, truncate or delete financial records, accounts, customers, historical reports, statement attachments, import history or retired settings. Historical SQL migrations remain because their checksums are part of the existing migration ledger and are required for a recoverable rollback. They are historical schema provenance, not active Banking/ERP routes or business workers. Customer startup verifies applied/baselined checksums only and fails closed if a historical migration is pending or changed; it cannot replay retired schema/data SQL. Baseline deployment logs confirm all 82 migrations were already verified.

Existing encrypted records and the secrets needed to recover them are retained. Removing a retired key from the customer app's mandatory readiness requirements does not remove that secret from Railway or decrypt/change historical records.

Document access rejects retired module classifications before reading stored file/object content. Existing access grants do not bypass module retirement. Retained document modules are `rfq`, `profile` and `security`; their original owner/permission checks continue to apply. Account ownership transfers are limited to retained document classifications and retained security records. Archived Banking/ERP ownership IDs stay unchanged.

The shared email queue remains for retained authentication, security, contact and customer-RFQ messages. Retired and unclassified queued rows remain unchanged and unsent. They are neither retried through a provider nor deleted merely because the product was retired. The retained queue schema is independent of the removed workforce schema. Binary attachment content retains its metadata and integrity checks through serialization.

## Issue register

| Issue | Reproduction / affected module | Severity | Cause | Implemented repair | Verification |
| --- | --- | --- | --- | --- | --- |
| Retired features remained reachable behind menus | Request a Banking/Finance/ERP API or old page URL directly | High | Runtime router imports, static assets and background jobs supported the old product | Remove implementation files and router/job registrations; return explicit `410` compatibility responses | Real Express route fixture; removed-file manifest and reachable-source closure; production checks pending |
| Old role dashboards could reopen operational UI | Navigate old admin/client/staff filenames or `/portal/:role` | High | Separate role entry pages and old client return paths | Authenticated aliases lead to the customer workspace; login/MFA return paths use retained routes | Real page-auth and Express alias fixtures; retained client runtime checks |
| Direct static shell filenames could bypass page navigation | Request `/workspace.html`, `/security.html` or `/profile.html` | Medium | Static filename serving did not pass through the canonical page entry | Canonical aliases lead to protected `/dashboard`, `/security` and `/profile` | Anonymous request redirects and return-path assertions |
| Hidden document routes could expose a retired module | Read an old Finance document as owner or using a pre-existing grant | High | Generic document storage served module-agnostic content | Check retained module allowlist before object/file reads or grant consumption | Retained boundary/document regression tests; no real historical files accessed |
| Startup/email setup depended on workforce and financial workers | Start the app after removing old controllers/services | High | Shared schema initialization and scheduling referenced retired modules | Extract shared audit/email schema; retain security startup; remove Banking/ERP schedulers | Actual bootstrap dependency fixtures, failure/shutdown assertions and runtime import closure |
| Pending retired messages could still send after cutover | Claim a pre-existing Finance/timesheet/unknown email queue row | High | Queue claim was not scoped to retained product modules | Retained module whitelist for enqueue and claim; old rows remain unchanged | In-memory queue regression proves no retired provider calls and preserved rows/content |
| Generic settings/ownership actions still touched archived data | Update bank/tax/report settings or transfer a terminating user's retired records | High | Broad shared settings and ownership targets retained ERP classifications | Limit settings DTO/writes to company/contact fields and transfers to retained modules | Actual route/controller and ownership fixtures prove rejected fields and preserved archived values |
| Public project intake depended on ERP RFQ workflows | Submit the retained public RFQ after removing ERP controllers | High | Public and internal RFQ lifecycle shared a controller | Dedicated validated pending-only public enquiry controller; no internal ERP lifecycle | Controller fixtures cover invalid payloads, parameterized insert, status and database error handling |
| Mixed themes and obsolete styles loaded across retained pages | Open login, registration, public enquiry and workspace | Medium | Old role/advanced styles and broad ERP theme injection | Coordinated customer theme and canonical shared asset versions | Theme/renderer contrast, idempotence and retained-page checks; browser screenshots pending |

“Implemented repair” does not claim that every original ERP workflow was audited or repaired. Those workflows are retired by the latest instruction. Production data comparisons and a whole-app authenticated production audit were not performed without an authorized application session.

## Test evidence and limits

Meaningful retained-product checks are provided in the following scripts. The release must run them in the final tree; obsolete feature suites are replaced because their product code has been removed, not suppressed to manufacture a passing Finance release.

- `scripts/application-retirement-test.js`: real Express routing without a listening socket; actual HTML renderer, readiness controller and page-auth middleware; retired pages/APIs/assets; no database/provider side effects for retirement responses; anonymous login return paths; canonical filename aliases; retained public HTML; synthetic authenticated customer workspace and old role aliases; physical source removal, reachable import graph, removed schedulers and original logo hash.
- `scripts/retained-runtime-test.js`: actual retained startup and shutdown behavior against strict dependencies, startup failure before listening, retained queue schema retry/idempotence, retired message hold, binary attachment integrity and retained capacity recovery scope.
- `scripts/retained-workspace-test.js`: real customer workspace and public-RFQ client scripts against deterministic browser fixtures; identity loading/errors, consent/quantity validation, duplicate-submit prevention, confirmation truthfulness, logout failure, login/MFA return navigation.
- `scripts/retained-theme-test.js`: shared renderer/theme behavior, contrast, preserved logo/hidden attributes, stylesheet idempotence and footer sizing.
- `scripts/customer-rfq-intake-test.js`: actual retained public enquiry controller against a strict database fixture, including errors and injection-shaped input.
- `scripts/core-audit-isolation-test.js`: shared audit schema retry/idempotence, retained audit writer redaction/hash behavior and absence of retired-table mutations.
- `scripts/retained-boundaries-test.js`: actual company-only settings route/controller contract and retained-scope ownership transfer; archived fields and owners remain unchanged.

The retirement route test has been run locally and passed with **97 retained startup, pre-deploy and runtime source files**. It uses a synthetic, local-only JWT/session/user fixture; it does not mint or use production credentials. No test sends a real email, submits a real RFQ, changes a customer/financial record, initiates a payment or accesses an inbox.

Fixture tests prove behavior under their stated inputs. They do not prove an authenticated production session, provider delivery, production database record counts, Safari/Android/WebView device execution or live private document access. Record browser/CI/build/live evidence as it is actually completed; do not infer it from a source check.

## Deployment and recoverable rollback

Existing production baseline:

- Repository `vp0712/voxelveda-app`, branch `main`.
- Last inspected baseline commit `80733384e62ce47942f5ad19481973f90aa568e0`.
- Last inspected successful Railway deployment `a7112230-6587-443b-b2ba-08a4d4e7543a`.
- Railway project `e41bb335-4f02-4251-8895-9195dc69726e`, production environment `113e44d2-01a4-4c87-a192-48e15f47dab9`, app service `7dc16dbd-e670-46ae-9053-ef1b06873f71`.

Release through the existing permitted workflow: push the candidate branch, open the pull request, run required checks, merge the reviewed exact head, verify merged `main` checks, then update `.railway-release` in its separate release-marker commit. Railway watches the release marker. Do not put the marker in an unverified candidate or force-push/bypass required checks.

No destructive data migration or infrastructure cutover is required. Shared audit/email schema initialization preserves the existing tables and uses additive, idempotent changes. Historical migrations must retain their original bytes/checksums. Existing volumes, object storage, database and encrypted secrets remain in place.

If rollback is required:

1. Stop advancing the release marker and record the failing deployment/commit and health evidence.
2. Create a rollback branch from current `main`; revert the customer-removal release merge (using the correct merge parent) through a normal pull request, restoring the baseline runtime, dependency lockfile and former feature UI together. Use baseline `80733384e62ce47942f5ad19481973f90aa568e0` and the removal manifest as restoration evidence. Do not reset or force-push `main`.
3. Restore the previous Railway pre-deploy command (including the two recovery migration wrappers) before the rollback deployment. Run the restored code's required checks and confirm compatibility with the unchanged database/attachments and additive shared schema. Do not delete newly accepted customer enquiries or revert data to an old backup merely to roll back code.
4. After the rollback merge and merged checks pass, create the separate `.railway-release` marker commit under the existing workflow. Confirm the actual Railway revision, backend readiness and original authenticated URLs. An emergency rollback to the previously successful deployment must follow the same permitted infrastructure controls.

Prior unfinished Finance report repair work was preserved in a local recovery branch/commit before this product change. It is not part of this customer release and must not be described as deployed.

## Release evidence — fill after verification

| Evidence | Result |
| --- | --- |
| Candidate / merged commit | Pending |
| Required checks and production build | Local production build passed 34 retained checks; final CI pending |
| Release-marker commit | Pending |
| Railway deployment / revision / result | Pending |
| Live domain and backend readiness | Pending |
| Live Banking/ERP retirement responses | Pending |
| Live public pages, logo, registration and RFQ validation | Pending |
| Phone/tablet/desktop screenshots | Pending |
| Authenticated production workspace/profile/security | Requires an authorized application session; fixture coverage does not substitute |

