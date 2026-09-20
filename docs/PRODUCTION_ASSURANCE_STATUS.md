# Production Assurance Status

Last evidence review: 2026-09-21 (Australia/Melbourne)

This document separates **verified production evidence** from **configured but unverified controls**. A configured variable is not treated as operational evidence.

## Current verified evidence

- Production application service: Railway service `voxelveda-app`.
- Latest verified successful production deployment observed during this review: deployment `17ae26f4-9ea1-43e7-ae6f-88a581900de6`, commit `2af4d45a2d45a0cc1fd778a9b98a942ded1b6138`.
- Redis: dedicated Railway service `voxelveda-redis`, image `redis:7-alpine`, password-protected startup command, successful production deployment.
- Malware scanning: dedicated Railway service `voxelveda-malware-scanner`, image `clamav/clamav:stable`, successful production deployment. Application pre-deploy gate reported `provider=clamav` and passed.
- Object storage: application pre-deploy gate reported `provider=railway_s3` and passed.
- Database least privilege: runtime evidence reported a non-root schema-scoped application identity with no GRANT OPTION and no unsafe global grant.
- Banking access hardening: delegated account scope, Update Access repair, statement history controls, Print/Save PDF repair and multi-bank statement warehouse are merged to main.
- Enterprise issue tracking: current unresolved production controls are represented by assigned GitHub issues rather than hidden in prose.
- Audit provenance model: the checked-in 12 September deep audit is retained as a historical baseline; current full-source audit evidence is regenerated as a SHA-bound CI artifact on every main push and again inside each tagged release gate.

## Runtime verification strengthened by the current hardening branch

On every startup the application now:
- marks Redis externally verified only after a live PING/PONG health operation succeeds;
- performs a live malware-scanner provider health operation and records the provider state;
- performs a live object-storage write/read/delete health operation and records the provider state;
- logs redacted provider evidence without credentials.

These changes do not convert a provider failure into a green status.

## Open production controls

| Control | Current evidence | State | Tracking |
| --- | --- | --- | --- |
| Basiq/Open Banking | Provider code and consent/sync architecture exist, but no production API-key variable is visible in Railway and no successful external consent/sync is proven | Blocked on provider credential/evidence | #178 |
| Database backups | Startup warns that backup status is not attested by a configured provider | Unverified | #179 |
| Database TLS | Startup reports TLS is not requested by the active pool. TLS capability probing exists, but enforced trusted TLS is not proven | Unverified | #180 |
| SMTP | Hostinger SMTP connection currently fails at network/socket connection stage on port 465 | Degraded | #181 |
| Redis multi-replica behavior | Real Redis service exists; production app is one replica. Cross-replica shared-counter proof remains required before scaling | Partially verified | #182 |
| Real banking/iPhone E2E | Automated regression coverage exists, but the release gate with real/sanitized statements and a physical iPhone/webview session is not yet recorded | Required before tagged release | #183 |

## Rules for claiming a control verified

A production/provider control can be marked verified only when all applicable items exist:
1. exact deployment SHA;
2. timestamped runtime/provider evidence;
3. success criteria tied to the control;
4. redaction of credentials, tokens and customer financial data;
5. a reproducible verification path;
6. a GitHub issue closed with the evidence when the control was previously open.

## Evidence links

- Basiq verification: https://github.com/vp0712/voxelveda-app/issues/178
- Backup/restore assurance: https://github.com/vp0712/voxelveda-app/issues/179
- Database TLS: https://github.com/vp0712/voxelveda-app/issues/180
- SMTP delivery: https://github.com/vp0712/voxelveda-app/issues/181
- Redis multi-replica test: https://github.com/vp0712/voxelveda-app/issues/182
- Real multi-bank/iPhone E2E: https://github.com/vp0712/voxelveda-app/issues/183


## Product and release backlog transparency

- Public e-commerce storefront implementation is tracked as GitHub issue #186 and is intentionally sequenced after release-critical hardening.
- The first formal tagged release with evidence and rollback reference is tracked as GitHub issue #187.
