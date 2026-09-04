# Voxel Veda Security Hardening Report

## Phase 1 audit findings

Critical findings included an unsafe default admin bootstrap, 30-day bearer tokens stored in browser storage, authentication tokens accepted from URLs, restart-sensitive in-memory logout revocation, no persistent account lock tracking, six-to-eight-character password rules, and ordinary administrators being able to grant privileged roles. Public customer registration also wrote directly to the internal users table.

High-risk gaps still requiring later phases include MFA/passkeys, step-up authentication, dual control, field encryption, file classification and malware scanning, comprehensive record-level authorization, scoped export/download controls, password history, trusted-device management, and an administrator security dashboard.

## Implemented in Phase 1

- Added persistent, hashed server-side session records bound to JWT `jti` and a per-user session version.
- Reduced default staff sessions to 8 hours and privileged sessions to 2 hours.
- Disabled authentication tokens in query strings; development compatibility requires an explicit flag and is prohibited in production.
- Added persistent failed-login counters and progressive temporary account protection.
- Added generic authentication failure responses and append-only application security events.
- Added account UUID, account state, session version, login/security timestamps, and session schema.
- Added a configurable 14-character password policy with common, contextual, sequence, and repetition checks.
- Revoked sessions after password, role, permission, identity, or activation changes.
- Blocked self-role changes and restricted SUPER_ADMIN management to SUPER_ADMIN.
- Disabled public customer registration by default.
- Removed automatic/default administrator creation. Explicit bootstrap is development-only and rejects weak credentials.
- Added production startup validation for signing secret, wildcard CORS, legacy query tokens, and bootstrap mode.
- Added origin validation for state-changing requests authenticated by cookies.
- Removed controller exception details from modified administrator endpoints.

## Deployment requirements

Before deploying, configure a unique `JWT_SECRET` of at least 32 characters, leave `ENABLE_ADMIN_BOOTSTRAP=false`, leave `ALLOW_LEGACY_QUERY_TOKENS=false`, explicitly decide whether public customer registration is required, and back up the database. The additive schema is created on first authenticated use. Existing sessions will be invalidated once persistent session enforcement is deployed, so staff must sign in again.

## Remaining implementation phases

1. Replace browser-stored bearer tokens with cookie-only sessions and complete password-reset/invitation flows.
2. Add TOTP, recovery codes, WebAuthn/passkeys, assurance levels, and recent step-up verification.
3. Replace legacy role strings with a deny-by-default granular permission registry and record scopes; add IDOR matrices.
4. Add banking/payroll masking, encryption, change history, risk checks, and dual approval.
5. Add classified private-file metadata, controlled downloads, quarantine states, and a real malware-scanner adapter.
6. Add security centre, session/device management, privileged-access reviews, incident workflows, and exportable reports.
7. Add integration security tests, dependency/secret/SAST CI, Railway environment separation, backup/restore evidence, and operational rotation runbooks.

This report records implemented controls and known gaps; it is not a certification or a claim of perfect security.
