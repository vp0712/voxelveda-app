# Voxel Veda Operations Platform

Voxel Veda is a Node.js and Express operations platform for RFQs, invoices, customers, suppliers, inventory, workforce, attendance, rostering, expenses and controlled company records.

## Local development

1. Copy `.env.example` to `.env` and provide the database, JWT and email values.
2. Install dependencies with `npm install`.
3. Run `npm run check` and `npm test`.
4. Start the server with `npm run dev` and open `http://localhost:5001/`.

Do not commit `.env`, credentials, signing keys, uploaded customer documents or database exports.

## Production routes

- Public: `/`, `/request-quote`, `/privacy`, `/terms`, `/support`
- Authentication: `/login`, `/register`, `/forgot-password`, `/reset-password`
- Protected: `/admin`, `/dashboard`, `/invoice/view`
- Liveness: `/api/health`
- Readiness: `/api/ready`
- Restricted readiness detail: `/api/security/readiness`

The intended public origin is `https://app.voxelveda.com`. Keep `FORCE_CANONICAL_HOST=false` until Railway confirms the custom domain and SSL are active.

## Deployment

See `CUSTOM-DOMAIN-SETUP.md`, `DEPLOYMENT-CHECKLIST.md`, and `docs/ENTERPRISE_DEEP_AUDIT.md`. Railway remains the application host; the custom domain changes the public address, not the hosting provider.

Production startup is fail-closed. The process validates configuration, verifies MySQL, runs checksummed migrations under an advisory lock, initializes critical schemas, services, and workers, and only then binds the HTTP port. Do not replace `/api/ready` with a static environment-variable check.

For databases created before the migration ledger, the runner records pre-Wave-A files as `BASELINED` only when all six established core tables are present and no immutable migration history exists. Fresh databases execute every migration, later migrations always execute normally, and both `APPLIED` and `BASELINED` checksums are immutable on subsequent runs. Run `npm run test:enterprise-wave-a:mysql-legacy` against a disposable-capable local MySQL instance to rehearse this adoption path.
