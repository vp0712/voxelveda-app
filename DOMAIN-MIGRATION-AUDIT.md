# Voxel Veda Domain Migration Audit

Audit date: 2026-08-01 (Australia/Sydney)

## Executive summary

Voxel Veda is a CommonJS Node.js and Express application with static HTML/CSS/JavaScript frontends, a MySQL database, JWT bearer authentication, and Capacitor Android/iOS wrappers. Railway remains the correct hosting platform. The application is not yet ready to force traffic to `app.voxelveda.com`: DNS and Railway SSL must first be verified manually.

The current Railway deployment is functional, but public browser URLs, social metadata, generated document links, QR helpers, and Capacitor configuration still contain the Railway hostname. Private HTML shells are also served as public static files and rely on client-side JavaScript redirects, while JWTs are stored in `localStorage`. The migration will add clean routes and server-side page gates without removing bearer-token compatibility used by the existing web and mobile clients.

## Files and areas inspected

- `package.json`, `package-lock.json`
- `server.js`, `app.js`
- `config/db.js`
- `middleware/auth.js`, `middleware/authMiddleware.js`
- `middleware/securityMiddleware.js`
- permission and role middleware
- `routes/*.js` and the mounted API route map
- `controllers/authController.js`
- invoice, material, task, attendance, user, customer, supplier, expense, compliance, and competitor controllers
- `public/login.html`, `public/login.js`
- `public/admin-dashboard.html`, `public/admin-dashboard.js`
- `public/staff-dashboard.html`, `public/staff.js`
- other public HTML pages, QR helper, assets, icons, and manifest
- `capacitor.config.json`
- `.env.example` and environment-variable names (secret values were not copied)
- repository deployment files and Git status

No tracked `Dockerfile`, `railway.json`, or `Procfile` was found. No test, lint, typecheck, or production build script currently exists.

## Framework and runtime

| Area | Current implementation |
|---|---|
| Backend | Node.js, Express 4, CommonJS |
| Frontend | Static HTML, CSS, and browser JavaScript |
| Database | MySQL via `mysql2` pool |
| Authentication | JWT bearer token, fresh user lookup per protected API request |
| Passwords | bcrypt hashes |
| Mobile | Capacitor 8 Android and iOS wrappers loading the hosted web application |
| Deployment | Railway using `npm start` / `node server.js` |
| Default port | 5001 locally; Railway `PORT` is read when present |

## Frontend entry files

- Login: `public/login.html` and `public/login.js`
- Admin: `public/admin-dashboard.html` and `public/admin-dashboard.js`
- Staff: `public/staff-dashboard.html` and `public/staff.js`
- Customer registration: `public/register.html`
- Public RFQ: `public/customer.html`
- Privacy: `public/privacy-policy.html`
- Shift QR terminal: `public/shift-qr.html`
- Invoice preview: `public/invoice-pdf.html`

There is no dedicated public application landing page. `/` currently redirects directly to `/login.html`.

## Backend entry and port handling

- `server.js` loads `.env`, seeds the admin, and starts Express.
- It reads `process.env.PORT`, but retries incrementing ports when busy and does not explicitly bind `0.0.0.0`.
- There is no `/api/health` endpoint.
- Local startup currently fails hard if `.env` cannot be loaded; production environment variables should not require a physical `.env` file.

## Existing route structure

Public APIs:

- `POST /api/auth/login`
- `POST /api/auth/customer-register`
- `POST /api/public/rfq`
- `POST /api/public/ai-lead`
- `GET /api/public/shift-qr`
- `GET /api/qr`

Authenticated APIs are mounted for RFQs, invoices, users, settings, dashboard data, uploads, tasks, stock, customers, materials, meetings, roster, suppliers, expenses, compliance, competitors, access attempts, and attendance. Most use bearer authentication plus section permissions.

Current browser page routes use static `.html` files. Clean `/login`, `/dashboard`, `/admin`, and module aliases do not yet exist.

## Railway and absolute URLs found

The Railway hostname appears in:

- `capacitor.config.json`
- `.env.example`
- `IOS_APP_STORE_HANDOFF.md`
- `controllers/invoiceController.js`
- `controllers/materialController.js`
- `scripts/generate-company-forms.js`
- `scripts/generate-quality-process-sheet.js`
- public page Open Graph and Twitter image metadata
- `public/admin-dashboard.js`
- `public/qr-widget.js`
- `public/invoice-pdf.html`

An untracked root-level `admin-dashboard.html` also contains legacy URLs. It is not the deployed `public/admin-dashboard.html` and will not be staged or overwritten without a separate cleanup decision.

## Environment variables found

Current names include `PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN`, DB connection fields, CORS/rate-limit settings, and SMTP settings. The current local `.env` only contains database, JWT, and port variable names. Secret values were not printed or copied.

Missing migration variables include `APP_URL`, `PUBLIC_APP_URL`, `PUBLIC_WEBSITE_URL`, `ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, `TRUST_PROXY`, `FORCE_CANONICAL_HOST`, `DATABASE_URL`, `EMAIL_FROM`, and `SUPPORT_EMAIL`.

## SEO and PWA findings

- `public/site.webmanifest` exists but starts at `/customer.html`, has the old product name/description, and does not mark an icon maskable.
- No service worker was found.
- No `robots.txt` was found.
- No sitemap was found.
- Public pages lack custom-domain canonical URLs and structured data.
- Private pages lack consistent `noindex` metadata and response headers.
- Social metadata points to the Railway hostname.

## Security risks found

1. Private HTML shells are served by public static middleware before any server-side page authorization.
2. JWTs are stored in browser `localStorage`; this increases impact if script injection occurs.
3. `middleware/auth.js` accepts a JWT in the URL query string for legacy PDF access, which can leak through history and logs.
4. Logout only clears browser storage; stateless tokens are not currently revoked server-side.
5. CORS allows every origin when no allow-list is configured.
6. Security headers do not yet include a Content Security Policy or Cross-Origin-Opener-Policy.
7. Authentication routes have rate limiting, but there is no durable account lockout/progressive delay.
8. There is no secure forgot/reset password token workflow.
9. No server-side audit log specifically records login/logout/session revocation.
10. Static uploads and invoices are exposed by path and rely on unguessable names rather than per-file authorization.
11. Admin and staff authorization in the page shell is mainly client-side; API permissions provide the stronger control.
12. Some read routes are mounted behind input permissions, which may unintentionally block read-only staff.

## Required changes

- Add centralized domain/URL configuration.
- Add a Railway-safe health endpoint and explicit `0.0.0.0` binding.
- Add a public landing page and clean public/private routes.
- Add temporary legacy redirects before static middleware.
- Add server-side cookie-backed page protection while preserving existing bearer clients.
- Add logout token revocation and safe `returnTo` handling.
- Tighten production CORS and add compatible security headers.
- Add a disabled-by-default canonical-host redirect feature flag.
- Remove Railway URLs from deployed frontend metadata, navigation, QR links, email/document links, and Capacitor configuration.
- Add robots rules, public-only sitemap, canonical metadata, structured data, and private-page `noindex` headers.
- Update the manifest and add a non-sensitive service worker.
- Add public support, terms, password-help, and branded error pages.
- Create the migration, Railway, Google Search, security, route, and deployment documentation.

## Tracked files planned for modification

- `app.js`
- `server.js`
- `middleware/auth.js`
- `middleware/securityMiddleware.js`
- `routes/authRoutes.js`
- `controllers/authController.js`
- URL-producing invoice/material controllers and form-generation scripts
- `.env.example`
- `capacitor.config.json`
- `IOS_APP_STORE_HANDOFF.md`
- `public/login.html`, `public/login.js`
- `public/admin-dashboard.html`, `public/admin-dashboard.js`
- `public/staff-dashboard.html`, `public/staff.js`
- other deployed public HTML metadata and clean-route links
- `public/qr-widget.js`
- `public/site.webmanifest`

## Files planned for creation

- `config/urls.js`
- `utils/session.js`
- `utils/tokenRevocation.js`
- `middleware/pageAuth.js`
- `public/index.html`
- `public/public-pages.css`
- `public/terms.html`
- `public/support.html`
- `public/forgot-password.html`
- `public/reset-password.html`
- branded 401/403/404/429/500/maintenance pages
- `public/robots.txt`
- `public/sitemap.xml`
- `public/manifest.webmanifest`
- `public/service-worker.js`
- `CUSTOM-DOMAIN-SETUP.md`
- `GOOGLE-SEARCH-SETUP.md`
- `SECURITY-CHECKLIST.md`
- `DEPLOYMENT-CHECKLIST.md`
- `ROUTE-MIGRATION.md`
- `README.md`

## Migration safeguards

- The existing Railway-generated domain remains available during validation.
- `FORCE_CANONICAL_HOST` remains `false` until DNS, SSL, login, APIs, uploads, and mobile clients pass checks.
- Legacy bearer authentication remains supported during the cookie transition.
- Legacy `.html` URLs use temporary redirects initially.
- DNS targets will only be copied from Railway; this project will not invent DNS values.
- Existing business API and database schemas will not be replaced during this migration.
- The Git commit immediately before this migration is the rollback point for tracked files.
