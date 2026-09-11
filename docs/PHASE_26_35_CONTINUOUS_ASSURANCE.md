# Security Phases 26–35 — Continuous Assurance

This release adds enforceable governance around privileges, audit integrity, identity reviews and recovery evidence. It does not claim certification or pretend that an unconfigured external provider is operating.

| Phase | Control | Implementation |
|---|---|---|
| 26 | Audit integrity | Ordered SHA-256 checkpoints chain new audit records to the previous seal. Checkpoints are append-only and expose the covered ID range. |
| 27 | Just-in-time privilege | Named permission, beneficiary, business reason, scope and fixed 1–8 hour expiry; a different security administrator approves; server authorization accepts only active, unexpired grants. |
| 28 | Access certification | Time-bound review campaigns and one decision per user with CERTIFY, REVOKE or EXCEPTION outcomes and detailed reasons. |
| 29 | Segregation of duties | Configurable conflicting-permission pairs with severity and audit history. Policies are explicit data, not frontend labels. |
| 30 | Risk exceptions | Named owner, compensating controls, maximum 90-day expiry, separate approval and exact residual-risk confirmation. |
| 31 | Cryptographic lifecycle | Metadata-only key-version registry with ACTIVE, DECRYPT_ONLY and RETIRED states plus SHA-256 fingerprints. Key material is never accepted. |
| 32 | Service identities | Named non-human identities require an accountable human owner, purpose, least-privilege scopes and mandatory expiry. Credentials remain separate scoped tokens. |
| 33 | Security event outbox | Assurance actions create redacted, hash-addressed durable outbox events. Delivery stays pending until a real destination adapter is configured. |
| 34 | Resilience exercises | Evidence-backed recovery exercises record scenario, result, recovery time, findings and integrity digest without claiming provider capability. |
| 35 | Assurance dashboard | Live counts for temporary grants, reviews, exceptions, service identities, queued events and audit seals; external readiness is shown as restricted unless configured. |

## Security properties

- All mutations require `MANAGE_CONTINUOUS_ASSURANCE`, rate limiting and recent Level 3 step-up authentication.
- JIT requester/beneficiary self-approval and risk-exception requester/owner self-approval are denied server-side.
- JIT grants expire automatically and cannot silently become permanent role permissions.
- Security outbox payloads use the existing sensitive-data redaction layer.
- Access-review REVOKE decisions do not mutate permissions automatically; the existing controlled role-change flow must execute the change.

## Database and rollout

Apply `migrations/20260907_continuous_assurance.sql`, or verify `Continuous assurance schema ready.` in production startup logs. Runtime creation is idempotent and additive.

No new variable is mandatory. Optional readiness signals are:

- `RATE_LIMIT_STORE=redis` and `REDIS_URL`: select the shared atomic limiter. Runtime state remains non-operational until the adapter connects and completes a Redis health operation; configuration alone is not provider evidence.
- `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`: reserved readiness metadata only. This release does not claim passkey ceremonies are implemented.
- `SECURITY_EVENT_DESTINATION`: identifies a reviewed destination adapter. Outbox delivery is not attempted without one.

## Remaining work

- Implement and audit WebAuthn ceremonies before enabling passkeys.
- Configure and runtime-verify the implemented Redis-backed atomic limiter before increasing Railway replicas.
- Implement authenticated outbox delivery with retry/dead-letter handling for the selected SIEM destination.
- Schedule audit sealing through a controlled production job and export anchor digests to independent immutable storage.
