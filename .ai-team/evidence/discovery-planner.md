# Planner discovery evidence

Verified on 22 November 2026 in `/workspace/voxelveda-app`.

- Actual host worker: `/root/vv_planner`.
- Installed role loaded explicitly: [`vv-planner`](../../.codex/agents/vv-planner.toml#L1).
- Instructions read: [`AGENTS.md`](../../AGENTS.md), [`TEAM.md`](../TEAM.md), and the complete [`ROSTER.md`](../ROSTER.md).
- Application source inspected: `75ee8ffc0b46077a2a9de488d566ca8f0bc0f0ab`.
- Working branch: `setup-voxel-veda-ai-team-20261122`.
- Model behavior: the spawn requested no model override; the installed role does not pin a model.
- Ownership: this worker writes only this evidence file. The coordinator owns shared configuration and `WORK.md`.

## Observed discovery boundary

The native collaboration worker actually ran and loaded the installed role file. This host exposes a task name and instructions, without a typed custom-role selector, so this is manual role loading through the available native worker tool. It does not establish automatic Codex custom-role registry discovery.

The coordinator's separate Codex CLI discovery attempt failed before child spawning because its authentication token could not be refreshed. This worker did not perform sign-in or retry provider access. Native CLI automatic discovery therefore remains unverified until that sign-in is restored.

## Actual application entry points

| Area | Observed source and behavior |
| --- | --- |
| Stack | [`package.json`](../../package.json#L28) declares Express/CommonJS, `mysql2`, Chart.js, PDFKit/PDF.js and Capacitor 8.5.2. The browser application uses the existing `public/` HTML/JavaScript pages. [`config/db.js`](../../config/db.js#L1) creates a MySQL promise pool. This is not a React/PostgreSQL application. |
| Direct server startup | [`package.json`](../../package.json#L7) maps `start` to `node server.js`. [`server.js`](../../server.js#L266) validates runtime state, connects to the database, verifies historical migrations, runs retained migrations, initializes schemas/services/workers and finally listens. Starting the server performs real configured database/provider operations, so it was not used as a setup-only test. |
| Railway startup gateway | [`scripts/railway-startup-gateway.js`](../../scripts/railway-startup-gateway.js#L84) serves gateway health and reports application readiness separately. Its backend child starts at line122. Gateway health alone is not backend readiness. |
| Background jobs | [`server.js`](../../server.js#L229) initializes durable background jobs and starts the email queue, weekly timesheet scheduler, workflow SLA scheduler and procurement import worker. [`server.js`](../../server.js#L327) registers workers before opening the application listener. |
| Canonical web origin | [`config/urls.js`](../../config/urls.js#L1) establishes `https://app.voxelveda.com` and rejects an old infrastructure URL as the production application origin. [`app.js`](../../app.js#L35) applies canonical routing before the application routes. |
| Public and authenticated pages | [`app.js`](../../app.js#L53) defines public login, registration, support and recruitment pages. [`app.js`](../../app.js#L65) maps authenticated `/dashboard` to Admin, Client or the existing role-specific staff portal. Own profile/account/security routes remain separate entry points. |
| APIs and retirement boundary | [`app.js`](../../app.js#L109) intercepts retired Banking/added ERP routes. Authenticated retained APIs are mounted at lines120–146. Original invoice/expense permissions named `VIEW_FINANCE` are still used for retained business functions; their name does not make those functions a retired system. |
| Android shell | [`capacitor.config.json`](../../capacitor.config.json#L2) retains `com.voxelveda.app` and the canonical HTTPS origin. [`MainActivity.java`](../../android/app/src/main/java/com/voxelveda/app/MainActivity.java#L39) starts the existing Capacitor bridge/WebView. First-party popup navigation is handled internally at line73; intentional external navigation confirmation is at line254. |

## Existing verification path

1. For this setup, run the package's installation check and verify role/reference integrity. The planner independently read all roster names and matched **84 unique names to 84 installed TOMLs**, including `vv-planner` and `vv-reviewer`.
2. [`package.json`](../../package.json#L10) maps `npm run check` to [`scripts/check-syntax.js`](../../scripts/check-syntax.js#L15). That scanner explicitly visits application directories; it does not treat `.ai-team/ecc-reference` as runtime application code.
3. Run `npm run security:secrets` and inspect any real file/line findings. [`scripts/source-file-inventory.js`](../../scripts/source-file-inventory.js#L6) includes tracked and untracked repository sources, so the imported reference markdown/JavaScript participates in source-based security scans.
4. For subsequent application changes, [`scripts/application-regression-suite.js`](../../scripts/application-regression-suite.js#L7) defines **102 explicit regression scripts**. [`package.json`](../../package.json#L14) combines syntax and regression gates into `npm run build`.
5. [`application-release-ci.yml`](../../.github/workflows/application-release-ci.yml#L31) defines UTC, production-style Australia/Melbourne and packaged-source builds, followed by Chromium/WebKit workflow checks. The real MySQL fresh/upgrade/concurrency fixtures are in [`integrated-repair.yml`](../../.github/workflows/integrated-repair.yml#L9) and its schema matrix at line59. Use disposable development databases for those checks.
6. Follow the existing separate release-marker workflow only for a task authorizing an application release: [`README.md`](../../README.md#L17). This team setup did not change `.railway-release` or initiate a deployment.

## Result and limits

Read-only application inspection completed, with this dedicated report as the only written output. No application, build, database or browser suite was executed by this worker. No dependencies were installed, no Git/provider state was mutated, no production data was accessed, and no email was sent. Recommended commands above are a verification path, not claimed test results.
