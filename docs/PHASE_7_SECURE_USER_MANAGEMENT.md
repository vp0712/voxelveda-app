# Phase 7 — Secure user management

Phase 7 separates identity preservation from access termination and adds controlled administrator security workflows.

## Controls

- Immutable user UUID plus a stable employee number (`VV-000001` format for legacy records).
- Explicit account states: invited, active, password reset required, MFA setup required, locked, suspended, disabled and terminated.
- No hard-delete route in normal user management. Termination preserves historical ownership and audit links.
- Mandatory reason and recent Level 3 authentication for account-state changes, session revocation, invitation revocation, compromised-account response and privileged access review.
- A user cannot modify their own role, permission grants, account state, or approve their own privileged-access review.
- Only a super administrator can grant `SUPER_ADMIN` or direct high-risk permission overrides.
- Permission-difference preview shows access added and removed before a role change, with high-risk additions marked.
- Compromised-account response locks the account and revokes sessions, action tokens, API tokens, trusted devices, TOTP enrollment and recovery codes.
- Termination revokes active credentials without anonymising or deleting the identity record.
- Privileged access reviews store reviewer, role/permission snapshot, decision, reason and review time.

## Additive database changes

Run `migrations/20260906_secure_user_management.sql`. Runtime schema creation is idempotent and creates the same structures. The migration does not delete or rewrite historical business records.

## Operational rule

After marking an account compromised, an authorised administrator must complete identity recovery, issue a password reset, and require MFA re-enrolment before restoring access.
