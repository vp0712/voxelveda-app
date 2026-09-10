# ERP Wave 2: Workflow Engine and My Approvals

## Scope

This release adds one controlled approval service for procurement, expenses, finance, suppliers, quality, CAPA, documents, security and HR requests. Admin and staff portals use the same API and database records.

## Controls

- Workflow definitions are versioned. Publishing a new version disables the previous active version and requires step-up authentication.
- Requests are locked during submission and cannot have two active approval instances for the same workflow and business record.
- Review actions lock both the workflow instance and assignment before changing state.
- Requesters cannot approve their own requests unless a definition explicitly enables it.
- A request with no qualified reviewer is blocked for assignment. It is never silently approved.
- Rejections and requests for changes require a reason.
- Controlled workflow records have no destructive delete API.
- Every submit, decision, cancellation, definition change and reassignment is written to the tamper-evident audit chain.
- Assignment and decision notifications link to the universal My Approvals inbox.
- SLA due-soon, breach and escalation events are idempotent and retained in dedicated tables.

## API

- `GET /api/workflows/definitions`
- `POST /api/workflows/definitions`
- `GET /api/workflows/my-approvals`
- `GET /api/workflows/my-requests`
- `POST /api/workflows/instances`
- `GET /api/workflows/instances/:instanceId`
- `POST /api/workflows/instances/:instanceId/action`
- `POST /api/workflows/instances/:instanceId/cancel`
- `POST /api/workflows/instances/:instanceId/reassign`

## Operations

The server starts a five-minute SLA worker by default. `WORKFLOW_SLA_INTERVAL_MS` may increase the interval, but values below one minute are rejected. Production startup logs `Workflow Engine schema ready.` after schema creation and seed verification.
