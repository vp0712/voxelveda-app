# Backup & Restore Assurance

This control answers a harder question than “are backups enabled?”: **can Voxel Veda prove that a recent backup exists and that a recent restore drill succeeded?**

## States

- `ready` — provider is healthy, the latest successful backup is inside the configured freshness window, and a successful restore drill is recent.
- `degraded` — backups appear usable, but restore evidence is missing or stale. This needs attention but is separated from an immediate backup failure.
- `blocked` — provider telemetry is unavailable/invalid, the backup is stale/missing, transport is insecure in production, or the latest restore drill explicitly failed.

## Provider response contract

`BACKUP_STATUS_URL` must return JSON similar to:

```json
{
  "status": "healthy",
  "latest_backup_at": "2026-09-17T04:00:00.000Z",
  "latest_restore_test_at": "2026-09-01T02:30:00.000Z",
  "latest_restore_test_result": "success"
}
```

Accepted healthy `status` values are `ok`, `healthy`, and `ready`. Timestamps must be ISO-8601 values. The token is sent only as a Bearer credential and is never included in the verifier result.

## Railway / production variables

Configure these as Railway environment variables/secrets, not source-controlled secrets:

```text
BACKUP_ASSURANCE_REQUIRED=false
BACKUP_STATUS_URL=
BACKUP_STATUS_TOKEN=
BACKUP_STATUS_TIMEOUT_MS=5000
BACKUP_MAX_AGE_HOURS=26
RESTORE_TEST_MAX_AGE_DAYS=90
```

Keep `BACKUP_ASSURANCE_REQUIRED=false` until a real provider endpoint has been connected and verified. After the endpoint returns valid live evidence, set it to `true`. In production, the provider URL must use HTTPS.

## Run the checks

```bash
node scripts/backup-restore-assurance-test.js
node scripts/check-backup-restore-assurance.js
```

The live check exits non-zero when recovery is blocked. When `BACKUP_ASSURANCE_REQUIRED=true`, any non-ready state exits non-zero so it can be used as a deployment/release gate.

## Operational runbook

1. Confirm scheduled database backups are enabled at the infrastructure/provider layer.
2. Connect a status endpoint that reports the timestamp of the latest successful backup.
3. Perform a restore into an isolated non-production database; never overwrite production to prove restore capability.
4. Validate application-level integrity after restore (schema, representative records, critical encrypted fields, and authentication/finance workflows).
5. Record the successful restore-test timestamp/result in the status provider.
6. Run the verifier and only then enable `BACKUP_ASSURANCE_REQUIRED=true`.
7. Repeat restore drills before `RESTORE_TEST_MAX_AGE_DAYS` expires and investigate any `degraded` or `blocked` result.

## Important boundary

This verifier validates telemetry and recovery evidence. It does **not** create backups itself and it must not be treated as proof until the backing provider and an actual isolated restore drill have been independently verified.
