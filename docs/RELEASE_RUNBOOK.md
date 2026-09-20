# Release and Rollback Runbook

## Purpose

Use this process for every production release of Voxel Veda. Feature work is not considered released merely because a PR merged.

## Release prerequisites

1. Freeze unrelated feature changes while the release candidate is being verified.
2. Confirm all required PR checks are green:
   - Security CI
   - Final System Consolidation
   - Advanced Australian Banking Platform when banking code changed
   - Bank Account Lifecycle when bank-account lifecycle code changed
   - loader/network and other domain-specific workflows when applicable
3. Confirm `npm run audit:inventory:check` passes against the refreshed enterprise inventory.
4. Review all open issues whose title begins with `[Production]` or `[Release Gate]`.
5. Complete issue #183 for releases that materially change Finance/Banking, import, permissions, deletion/restoration or mobile/PDF behavior.
6. Confirm no P0/P1 defect remains open.
7. Record the intended release SHA.

## Tagged release

Use a semantic tag such as `v2026.09.1` or a conventional semantic version.

Pushing a `v*` tag triggers `.github/workflows/release-readiness.yml`, which:
- installs locked dependencies;
- runs syntax/static checks;
- runs the complete regression suite;
- runs the production dependency audit;
- verifies enterprise-audit provenance;
- creates a release-evidence artifact;
- publishes a GitHub Release only when all gates pass.

A failed release workflow means the tag is **not** production evidence.

## Production validation

After Railway deploys the target main SHA:

1. Confirm Railway deployment status is `SUCCESS`.
2. Confirm startup reaches `Server ready`.
3. Confirm `/api/health` and `/api/ready` behave as expected.
4. Review runtime provider evidence for Redis, malware scanning, object storage, database identity/TLS, backup assurance and SMTP.
5. For Banking changes, verify:
   - Banking workspace loads;
   - one statement import/review path;
   - account visibility boundaries;
   - report/PDF path;
   - remove/restore behavior.
6. Add production evidence to the release record or relevant GitHub issue.

## Rollback decision

Rollback when any of these are true:
- authentication or authorization is broken;
- data from another user/account is exposed;
- banking totals/history are corrupted;
- destructive actions operate outside the selected scope;
- startup/readiness loops or repeated 5xx errors make the app unusable;
- a critical provider dependency fails closed in a way that prevents safe operation.

## Rollback procedure

1. Stop feature work and identify the last known-good production deployment SHA.
2. Prefer an application rollback/revert over database rollback. Migrations are designed to be additive; do not manually drop columns/tables to match older code.
3. Revert the offending GitHub merge commit or redeploy the last known-good application SHA through the approved deployment path.
4. Do not bypass Security CI or readiness gates to accelerate rollback.
5. Verify:
   - Railway deployment `SUCCESS`;
   - health/readiness;
   - authentication;
   - database connectivity;
   - Banking/Finance access boundaries when affected.
6. Record the rollback SHA, trigger, timestamps and validation evidence in a GitHub issue.
7. Create a follow-up corrective-action issue before resuming feature work.

## Database incident rule

If the incident involves database integrity rather than application code:
- stop writes when necessary;
- do not restore over production blindly;
- use issue #179's isolated-restore procedure;
- compare the candidate restore against expected migration/schema integrity;
- obtain explicit approval before replacing production data.

## Secrets

Never paste production passwords, API keys, bank credentials, SMTP passwords, database URLs or object-storage secrets into release notes, issues or CI artifacts.
