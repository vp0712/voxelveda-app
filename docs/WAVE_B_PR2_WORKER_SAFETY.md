# Wave B PR 2: Distributed Worker Safety

## Scope

This release moves the four singleton recurring jobs onto one MySQL-backed coordination framework:

- Trash retention purge
- workflow SLA notification and escalation
- queued email delivery
- completed-week timesheet preparation and email queueing

The domain handlers retain their existing transaction and idempotency behavior. Timer ownership is no longer treated as evidence that a process owns a job.

## Lease and run model

`background_job_leases` is the cross-replica ownership authority. Acquisition and expired-lease takeover are transactional. A random token binds heartbeat and release to the current owner, and completion requires a final successful ownership renewal. A crashed process does not need cleanup: its lease becomes eligible for takeover after expiry.

Every acquired run is recorded in `background_job_runs` with its deployment SHA, trigger, attempt, counts, and terminal state. Failures use bounded, redacted summaries. Retry timing uses exponential backoff and is durable in the database. Exhausted attempts create an open dead letter.

Manual dead-letter retry requires `MANAGE_BACKGROUND_JOBS`, a fresh step-up session, a reason, and an immutable audit event. If dispatch cannot acquire the job lease, the dead letter returns to `OPEN` instead of becoming stranded in `RETRYING`. The API never returns lease tokens or owner identities.

## Operations API

- `GET /api/security/workers`
- `GET /api/security/workers/dead-letters`
- `POST /api/security/workers/dead-letters/:id/retry`

## Assurance boundary

The implementation and shared-lease behavior are tested with two simulated replicas and with the real MySQL migration/store path. Two-replica provider behavior is not externally verified until Railway is deliberately scaled and runtime evidence proves only one lease holder executed each job. Production must remain at one replica while the Redis rate limiter is process-local.
