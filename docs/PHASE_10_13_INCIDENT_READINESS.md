# Phases 10–13: Incident Response, Security Tests and Production Readiness

## Implemented controls

- Security incidents have a severity, scope, commander, lifecycle and immutable action history.
- Account containment revokes sessions, action tokens, API tokens, trusted devices, TOTP enrollment and recovery codes.
- Controlled recovery requires a separate authorised administrator, recent step-up authentication and a short-lived password-reset link.
- Organisation-wide session revocation is restricted to `SUPER_ADMIN`, requires Level 3 assurance, an active incident, a reason and the exact confirmation phrase.
- Security review reports cover identity, privileged MFA, sessions, failed logins, high-risk actions, incidents and audit activity.
- CSV report exports create a SHA-256 snapshot, security event and audit entry.
- Production startup blocks unsafe secrets, reused keys, wildcard/insecure origins, debug bypasses, public admin registration and missing Railway proxy trust.
- Production startup warns honestly when malware scanning, backup attestation, shared rate limiting or canonical-host enforcement is not configured.
- Installed dependencies are no longer committed in `node_modules`; CI and Railway install the audited lockfile with `npm ci`.

## Deployment requirement

Generate a new random `SHIFT_QR_SIGNING_KEY` with at least 32 bytes. It must be different from `JWT_SECRET`, `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` and `FINANCE_ENCRYPTION_KEY`. Add it to Railway before deploying this release or production startup will fail closed.

Run the additive migration `migrations/20260906_incident_response_readiness.sql`. Runtime schema initialization is idempotent and creates the same tables. No existing business, finance or identity record is deleted or rewritten.

## Honest remaining operational work

- Malware scanning is an integration boundary, not a fake scanner. Configure a real provider before changing upload scan status from `UNAVAILABLE`.
- Backup status remains unverified until Railway/provider backup data is connected and restore tests are documented.
- The current rate limiter is process-local. Configure a Redis-backed shared limiter before running more than one application replica.
- Three moderate Express 4 / `qs` dependency advisories remain without a compatible upstream fix. Request limits and rate limiting reduce exposure; migrate to Express 5 only after endpoint regression testing.
- Keep `FORCE_CANONICAL_HOST=false` until `app.voxelveda.com` DNS and TLS are healthy.
- Hostinger SMTP delivery remains an external operational dependency.
