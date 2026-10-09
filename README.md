# Voxel Veda account app

The existing company site, registration, profile and account security remain on the original deployment. The application uses light neutral backgrounds, white surfaces, deep navy headings, slate text and royal-blue actions, with an accessible dark option. The original Voxel Veda logo is unchanged.

All Banking/Finance and ERP runtime functionality—including RFQs, quotations, invoicing, bank accounts, imports, reports, exports, purchasing, inventory, production and workforce—is retired. Dedicated source, assets, jobs and dependencies are deleted. Old feature URLs return explicit unavailable responses. Existing database records, encrypted snapshots, uploads, identity records and historical migration checksums remain intact; retired records are not accessible through the active app.

## Development and verification

Use Node 22 and a development MySQL database with unique authentication secrets. Run `npm ci`, `npm run check`, `npm test` and `npm run build`. Production build runs the retained security/account/retirement suite; its scanners also verify packaged source without Git metadata. Run disposable database checks only with the explicit local test guard in `scripts/retained-mysql-test.js`. Never commit secrets or user uploads.

## Pages and release

Public pages are `/`, `/login`, `/register`, `/privacy`, `/terms`, `/support` and the static company contact page `/careers`. Authenticated pages are `/dashboard`, `/profile` and `/security`. Historical role entries lead to the same account dashboard without extra grants.

https://app.voxelveda.com remains on the existing Railway app service and authoritative database. Candidates pass normal CI and merge to `main`; merged-main checks pass before the separate `.railway-release` marker triggers deployment. Historical SQL migrations are verified without replaying retired data/schema changes. The shared email worker claims only auth/security/contact messages and leaves retired queued rows untouched.

See [removal scope](docs/FINAL_REMOVAL_SCOPE_20261009.json), [file manifest](docs/APPLICATION_REMOVAL_MANIFEST.json), and [release/rollback notes](docs/APPLICATION_RETIREMENT_20261009.md). The user waived backup verification for this code-only release; no backup is claimed verified and no production records are erased. Recovery restores the previous verified code and pre-deploy configuration through the same CI/marker workflow, without reversing historical migrations or discarding new account changes.
