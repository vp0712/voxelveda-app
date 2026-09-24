# Finance release process

Production Railway deploys are intentionally triggered only by `/.railway-release`.

## Required workflow

1. Build Finance changes on a `finance-release-*` branch.
2. Run `npm run build` through the Finance Release Candidate CI workflow.
3. Open a pull request to `main`.
4. Merge only after the candidate build gate is green.
5. After merge, update `.railway-release` in one dedicated commit.
6. Railway then performs one production build for the fully validated release.
7. Verify migrations, healthcheck, startup readiness and 5xx logs after deployment.

## Why this exists

Railway previously watched every commit on `main`. During large Finance rebuilds, sequential file/test corrections created separate production builds for intermediate states. Those intermediate builds could fail even when the final combined release was valid.

The marker-only trigger prevents partial commits, test-string fixes and cache-bust changes from creating production deployment noise.

## Release rules

- Never use `.railway-release` in normal feature commits.
- Never push incomplete Finance work directly to `main`.
- Keep `npm run build` as the production static/regression gate.
- Tests should validate behaviour and architecture, not an exact release-number string unless the number itself is the behaviour being tested.
- A failed release candidate stays on its branch; production remains on the last successful deployment.
