# Phases 51–70 — Identity Governance and Data Protection

This release strengthens existing controls; it does not claim certification or perfect security.

## Implemented controls

| Phase | Control | Enforcement |
|---|---|---|
| 51–52 | Mass-assignment and validation defence | Explicit body contracts reject unknown, missing and prototype-pollution properties on sensitive write routes. Settings use a server-side allowlist and typed validation. |
| 53–55 | Secret management boundaries | Tracked-source secret scan; logs redact secret material; settings APIs never accept or return runtime credentials. |
| 56 | Database least privilege | Production readiness reports root identities and missing TLS evidence. Provider-backed attestations record posture without storing credentials or SQL grants. |
| 57–58 | Sensitive-field protection | Existing AES-256-GCM finance/MFA encryption and hashed tokens are registered with key names and protection methods. Keys remain outside the database. |
| 59 | Log safety | Structured security logger and recursive redaction cover credentials, tokens, ciphertext and banking data. |
| 60–62 | Audit integrity and detail | New audit records include request, session, result and redacted metadata. A serialized SHA-256 predecessor chain makes tampering detectable at application level. |
| 63–65 | Security visibility | Security Centre shows live governance readiness, audit-chain coverage, emergency access, delegated support and stale-account metrics. Existing profile security retains MFA, password and sessions. |
| 66–67 | Privileged/stale reviews | Existing privileged-access reviews are complemented by configurable 60/90-day stale-account signals. No account is automatically terminated. |
| 68 | Termination accountability | Termination blocks when active owned records lack a destination, transfers supported ownership in the same transaction, then revokes credentials and records the event. |
| 69 | Break-glass access | No backdoor account. Emergency permission grants require a separate requester, beneficiary and approving super administrator, active MFA, a linked incident, step-up authentication and a maximum 60-minute expiry. Finance/payroll permissions are excluded. |
| 70 | Support impersonation | Super-admin only, step-up protected, target cannot be a super administrator, maximum 15 minutes, bound to the actor session, read-only and blocked from finance, security, users, settings, email and integrations. Start/end are audited. |

## Operational boundaries

- Database identity and transport status are not marked verified until real provider evidence is recorded.
- The audit hash chain is tamper-evident at application level; an external immutable log sink remains recommended for stronger non-repudiation.
- Impersonation context tokens are displayed once and stored only as SHA-256 hashes.
- Break-glass access never bypasses MFA, session validity, record scope, finance segregation or step-up controls.
- Existing encrypted values are not re-encrypted by this additive migration.
- The dependency audit reports three moderate `qs` denial-of-service advisories with no upstream fix in the current Express 4 line. The application mitigates exposure by using simple query parsing and non-extended form parsing; migration to a tested framework release containing a fixed dependency remains recommended.

## Deployment

Apply `migrations/20260908_phase_51_70_identity_governance.sql` once after the CI build succeeds. The runtime schema initializer is idempotent and provides safe compatibility during rolling deployment. No new production secret is required.

After deployment, a super administrator should record the real Railway/MySQL least-privilege and TLS evidence in the Security Centre. Do not paste credentials, connection strings or grant statements into the attestation.
