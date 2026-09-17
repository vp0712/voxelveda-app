# Recovery Drill Evidence Ledger

## Purpose
The Recovery Drill Evidence Ledger records what actually happened during an isolated recovery test. It is evidence governance, not a restore engine.

## Operator workflow
1. Create a drill and identify the responsible operator/role.
2. Record the exact backup/snapshot identifier and its successful creation time.
3. Record the isolated recovery environment. Never use the production database as the drill target.
4. Record drill start, restore completion and validation completion times.
5. Record the restore result and complete the critical integrity checks.
6. Add at least two evidence references such as a provider job ID, ticket, screenshot, validation report or controlled document reference.
7. Record findings and the next planned drill date.
8. Finalize the drill with a decision note. Finalized records are immutable.

## Measurements
- Observed RPO is calculated as the elapsed time from the selected backup timestamp to the drill start timestamp.
- Observed RTO is calculated as the elapsed time from drill start through completed validation.
- A technically successful restore can still miss the configured RPO or RTO objective. The system reports that separately as `PASS_OBJECTIVES_MISSED` rather than hiding the miss.

## Evidence boundary
A ledger record proves only that an authorized operator recorded and finalized an internal drill with the required evidence fields. It does not independently prove that Railway/provider backup scheduling is enabled, that provider telemetry is genuine, or that every backup is recoverable. External backup assurance remains a separate control.

## Safety boundary
The ledger has no endpoint, button or workflow that restores the production database or moves production data. Production restoration remains an externally controlled incident-recovery procedure.
