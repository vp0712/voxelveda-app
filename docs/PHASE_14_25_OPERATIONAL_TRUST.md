# Security Phases 14–25 — Operational Trust

This release extends Voxel Veda from identity and incident controls into operational security. It does not claim certification and does not mark an external control healthy without provider evidence.

## Phase map

| Phase | Control | Implementation |
|---|---|---|
| 14 | Scoped API credentials | Random `vv_pat_` credentials, SHA-256 storage, one-time display, explicit expiry, last-use metadata, immediate revocation and permission-boundary intersection. |
| 15 | Signed webhooks | Source/event allowlists, HMAC-SHA256 signatures over timestamp plus raw body, five-minute replay window, unique event IDs and idempotent receipts. |
| 16 | Data lifecycle | Category-specific archive policies, legal holds and read-only eligibility previews. Destructive execution is deliberately disabled until an archival adapter is reviewed. |
| 17 | Sensitive exports | Thirty-minute requests, step-up verification, a different approver, exact confirmation and optional one-time enforcement on finance/accountant exports. |
| 18 | SSRF defence | HTTPS-only outbound policy, exact hostname allowlist, no embedded credentials/custom ports, DNS resolution checks and private/link-local address rejection. |
| 19 | AI data-loss prevention | Recursive sensitive-field redaction, token/banking-pattern filtering and hard blocking of payment, user deletion, permission, posting and bank-change actions. |
| 20 | Secret lifecycle | Metadata-only secret inventory with owner, version, rotation date and review period. Secret values are never stored or returned. |
| 21 | Backup evidence | Provider reference, timestamps, restore-test date, notes and SHA-256 evidence digest. No backup is shown as verified without an attestation. |
| 22 | Malware quarantine | Uploads become `PENDING_SCAN` only when a provider is configured; otherwise `UNAVAILABLE`. Downloads remain blocked while pending/quarantined. No fake SAFE result exists. |
| 23 | Trusted-device control | Organisation inventory and immediate, reasoned, step-up-protected revocation. Trusted devices do not bypass privileged step-up checks. |
| 24 | Security alert rules | Controlled event sets, threshold/window rules and live evaluation against append-only security events. |
| 25 | Compliance evidence | Immutable-period operational snapshots covering incidents, security events, audit actions and sensitive exports with SHA-256 integrity digests. |

## Authorization and assurance

All management endpoints require newly introduced granular permissions. The role default remains deny. High-risk mutations require a recent Level 3 step-up session; scoped API credentials have no interactive session and therefore cannot perform them. Super-administrator token scopes are still intersected with the token boundary.

## Production variables

- `WEBHOOK_SIGNING_KEY`: at least 32 random bytes; needed only when signed webhooks are enabled.
- `WEBHOOK_SIGNING_KEY_VERSION`: rotation label, default `v1`.
- `OUTBOUND_ALLOWED_HOSTS`: comma-separated exact hostnames. Empty means outbound requests are denied.
- `DUAL_CONTROL_EXPORTS`: set `true` only after at least two authorised approvers and the request/approval workflow have been operationally tested.
- `MALWARE_SCANNER_PROVIDER`: enables the pending-scan queue only. A real result adapter must authenticate scanner results before SAFE status is supported.

## Database

Run `migrations/20260907_operational_trust.sql`. Runtime schema creation is idempotent and creates the same additive tables/columns.

## Known external dependencies

- Redis is still required before using more than one application replica.
- A supported malware scanner and authenticated result callback are still required for automated SAFE decisions.
- Railway/provider backup configuration and a real restore test are required before setting `BACKUP_STATUS_PROVIDER=configured`.
- WebAuthn/passkeys remain unimplemented because the repository does not yet contain an audited WebAuthn verification library and credential ceremony design.
- SMTP network connectivity remains an infrastructure issue, not an application security success.

## Rollout

1. Apply the additive migration or confirm `Operational trust schema ready.` in startup logs.
2. Keep `DUAL_CONTROL_EXPORTS=false` until two-person operational testing is complete.
3. Configure only the external controls actually in use.
4. Run syntax, full tests, dependency audit and production readiness checks.
5. Deploy behind Railway Wait for CI and verify `/api/health` plus startup logs.
