# Wave B PR 1 Platform Guards

## Scope

This change adds audit provenance, a memory/Redis rate-limit abstraction, endpoint-specific public policies, bounded public request contracts, RFQ/AI submission dedupe, a bot-challenge adapter interface, and shared password-policy enforcement. It does not implement worker leases, CSP removal, QMS remediation, or later ERP phases.

## Rate-limit operation

- `RATE_LIMIT_STORE=memory` is for development or one production replica only. Production readiness reports it as degraded and records a warning.
- `RATE_LIMIT_STORE=redis` requires `REDIS_URL`. Startup connects and performs `PING` before reporting the limiter operational.
- Production requires `RATE_LIMIT_FAILURE_POLICY=deny`. Redis initialization failure stops startup; a runtime counter failure marks readiness failed and returns HTTP 503 rather than allowing an unprotected request.
- Non-production may use `RATE_LIMIT_FAILURE_POLICY=memory`, which changes runtime state to degraded if Redis fails.
- Redis keys use `RATE_LIMIT_NAMESPACE` plus SHA-256 opaque identities. Counter increments and TTL assignment occur in one Lua operation.

No live Redis provider is verified by this PR. Do not increase Railway beyond one replica while production uses memory mode.

## Endpoint policies

| Policy | Default window | Default maximum |
| --- | ---: | ---: |
| Normal API | 15 minutes | 900 |
| Login | 15 minutes | 10 |
| MFA | 15 minutes | 12 |
| Step-up | 15 minutes | 10 |
| Password reset | 1 hour | 6 |
| Invitation | 15 minutes | 10 |
| Customer registration | 1 hour | 5 |
| Public RFQ | 1 hour | 10 |
| AI lead | 1 hour | 10 |
| Shift QR | 1 minute | 120 |
| QR generation | 1 minute | 60 |
| CoC verification | 1 minute | 120 |

Every value has an explicit environment override in `.env.example`.

## Public writes

RFQ and AI lead requests are validated before controller work and acquire a unique database receipt. Clients may send `Idempotency-Key` with 8 to 128 safe characters. Reuse with the same payload replays the completed response; reuse with different data returns HTTP 409. Without an explicit key, the service derives an opaque key from endpoint, client IP, and normalized payload. Bot challenge tokens are excluded from payload identity.

`BOT_CHALLENGE_PROVIDER` and `BOT_CHALLENGE_REQUIRED_ENDPOINTS` select a registered adapter. The default `none` provider is optional. If an endpoint is configured as required without an available adapter, the request fails with HTTP 503. This interface does not claim CAPTCHA provider verification.

## Database and rollback

Migration `20260911_wave_b1_public_submission_dedupe.sql` is additive. Application rollback does not require dropping the table. Retain the table during rollback so in-flight idempotency receipts remain available; any later removal requires a separately reviewed retention migration.

## Required release evidence

Run `npm run check`, `npm test`, `npm run security:audit`, `npm run audit:inventory:check`, and `npm run test:enterprise-wave-a:mysql-legacy`. Merge only after Security CI is green. Production verification must record the merged deployment SHA, startup migration result, `/api/health`, `/api/ready`, protected readiness behavior, and runtime logs. Redis remains unverified until an actual provider health operation is observed.
