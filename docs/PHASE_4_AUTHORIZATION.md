# Phase 4 — Granular and record-level authorization

Phase 4 replaces broad role bypasses with a server-side, deny-by-default permission engine. Role names now supply reviewed permission templates, while explicit user grants are normalized through the same catalog. Unknown roles and unknown permissions grant nothing.

## Implemented controls

- Canonical permission catalog covering finance, banking, payroll, users, jobs, attendance, timesheets, suppliers, inventory, meetings, compliance and exports.
- High-risk permission classification for banking, payroll, exports, tax overrides, user administration and security administration.
- Server-side route enforcement; `admin` and `super_admin` no longer bypass permission middleware.
- Legacy permission translation to preserve existing authorised access during migration.
- Finance actions split into view, edit, post, void, banking, bank-detail and export permissions.
- Permission-based page authorization for the operations workspace.
- User updates use an explicit field whitelist and reject unsupported scope fields.
- Users cannot change their own role, permissions or account state through user-management APIs.
- Only super administrators can grant explicit high-risk permissions or manage another super administrator.
- Every role/permission change records old and new values in append-only audit logs and revokes the target user's sessions.
- Department, manager and constrained access-scope fields added to user identity records.
- Managers and supervisors can access only tasks assigned to their direct reports; organisation-wide task control remains separately permissioned.
- Timesheet list, detail, approval, rejection and amendment enforce own, direct-team or all-record scope server-side.
- Payroll-ready timesheets require payroll-view permission.
- Invoice files and uploaded RFQ, supplier, expense and compliance files now require their matching module permission before the authenticated file server will return them.

## Database migration

`migrations/20260905_authorization_foundation.sql` adds nullable `department`, `manager_id` and JSON `access_scope` fields. Runtime schema initialization also creates the non-unique manager lookup index idempotently.

## Compatibility and boundaries

Existing lowercase permissions are translated to canonical grants. No existing business record is deleted or rewritten. Phase 5 will add recent step-up verification to high-risk permission and role changes; Phase 4 establishes the permissions those checks will protect.
