# Phase 5 — Step-up authentication

Phase 5 adds recent re-authentication for high-risk operations. Permission checks still run first. Passing step-up does not grant a permission the user does not already hold.

## Assurance levels

- Level 1: password-authenticated session.
- Level 2: password plus MFA at login.
- Level 3: current password plus a fresh TOTP verification in the current session.

Level 3 lasts 15 minutes by default and is evaluated from the database on every protected request. Set `STEP_UP_TTL_MINUTES` to a value from 1 to 60 to change the window.

## Protected operations

- User creation, access changes, administrator password resets, invitation reissue, and termination.
- Finance/system settings changes.
- Posting or voiding transactions, manual journals, and accounting-period changes.
- Supplier payments, bank imports, reconciliation, and bank-detail changes.
- Financial/accountant exports.
- Invoice approval/payment/void/delete actions and expense payment void/delete actions.

## Verification flow

1. The server validates authentication and the required granular permission.
2. If recent Level 3 assurance is absent, the server returns `STEP_UP_REQUIRED`.
3. The UI displays a security-review dialog.
4. The user submits their current password and a new six-digit TOTP code.
5. The server verifies both factors, prevents TOTP replay, raises only the current session to Level 3, and writes a security event.
6. The original request is retried once.

No password, TOTP code, MFA secret, or session token is stored in browser storage or audit metadata.

## Database migration

`migrations/20260905_step_up_authentication.sql` adds nullable `step_up_verified_at` and `step_up_method` fields to `auth_sessions`. Runtime schema initialization is idempotent.

## Production follow-up

- Enable Railway **Wait for CI** so future automatic production deployments cannot start before GitHub Actions succeeds.
- `app.voxelveda.com` is still marked **Waiting for DNS update** in Railway and must be corrected at the authoritative DNS provider.
- The SMTP connection timeout is infrastructure/configuration, not an application exception. Verify Railway can reach the configured SMTP host/port and prefer submission port 587 with `SMTP_SECURE=false` if the mailbox provider supports it.
