# Voxel Veda customer app

The application provides a focused customer workspace, RFQ intake, registration, profile and account security. The original company logo is retained, with a white, charcoal and teal theme and an accessible dark option.

Banking and ERP runtime code, pages and scheduled jobs have been removed. Their existing database records, document bytes, identity permissions and historical migration checksums remain intact. Old module links return a deliberate unavailable page; archived financial documents and queued module emails remain inaccessible and unsent.

## Development

Use Node 22, copy `.env.example` to `.env`, configure a development MySQL database and unique authentication secrets, then run `npm ci`, `npm run check`, `npm test` and `npm run build`. Start with `npm run dev`. Never commit credentials or uploaded documents. Database integration checks require an explicitly disposable test database; see `scripts/retained-mysql-test.js`.

## Routes

Public routes are `/`, `/request-quote`, `/register`, `/login`, `/privacy`, `/terms` and `/support`. Authenticated account pages are `/dashboard`, `/profile` and `/security`. Existing role entries redirect to the common workspace while retaining existing identity and permission checks. `/api/health` reports liveness; `/api/ready` checks application readiness.

## Release and recovery

Production remains on Railway at https://app.voxelveda.com. Keep the existing service, database and domain. Candidate changes must pass normal CI, merge to `main`, and pass the main-branch checks before a separate `.railway-release` update triggers deployment. The release marker must not change in candidate pull requests.

Production starts only after configuration, database, migration, security and service checks pass. Historical migrations are deliberately preserved and checksummed. The retained email worker claims only authentication, security, contact and customer-RFQ messages.

See [the removal manifest](docs/APPLICATION_REMOVAL_MANIFEST.json) and [release and rollback notes](docs/APPLICATION_RETIREMENT_20261009.md). Rolling back means restoring the previous verified code and pre-deploy configuration through the same CI and release-marker workflow; no database deletion or reverse migration is required.
