# Phase 8 and 9 security hardening

Implemented controls:

- Sensitive upload storage is no longer exposed through `/uploads`.
- New RFQ documents use UUID metadata and permission-checked downloads.
- Supplier, expense, and compliance APIs omit file blobs and storage paths.
- Uploads are restricted by extension, MIME declaration, size, and file signature.
- File classification and honest scan status are stored; `UNAVAILABLE` never means safe.
- Audit and security-event metadata is centrally redacted before storage.
- Security APIs use server-side `MANAGE_SECURITY` / `VIEW_AUDIT_LOG` checks and rate limits.
- The Security Centre reports live identity, MFA, login, session, privileged-user, audit, and issue data.
- The readiness score is a transparent operational indicator, not certification.

## Additive migration

Apply `migrations/20260906_file_api_audit_security.sql`. The application also idempotently ensures the same schema at startup.

## Remaining operational work

- Connect a real malware-scanning provider before treating uploaded files as scanned.
- Remove CSP inline-script/style allowances by moving legacy inline handlers and styles into static assets.
- Review current npm advisories. Current findings include vulnerable transitive Capacitor CLI tooling plus advisories without patched versions in the installed Express, MySQL2, and Nodemailer lines. Do not perform untested major upgrades directly in production.
- Configure explicit `ALLOWED_ORIGINS` in Railway even though secure production defaults exist.
- Add durable distributed rate limiting before horizontally scaling beyond one application instance.
