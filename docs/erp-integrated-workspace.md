# Integrated ERP workspace — 6 October 2026

The existing `/admin` application now opens an integrated ERP workspace. Existing records, backend services, Finance OS and role permissions are reused. No disconnected ERP or Finance instance is introduced.

## Department coverage

| Department | Integration |
| --- | --- |
| Sales & CRM | Live RFQ status totals; original customer, quote and invoice registers |
| Marketing | New persisted campaign plans, customer/RFQ references, date windows, budget currency, cancellation and revision-checked edits |
| Procurement | Existing requisition, supplier RFQ, purchase-order, receiving, inspection and bill-match workflow |
| Production Planning | New planning-stage intake into `manufacturing_jobs`; operations into `job_operations`; UTC machine reservations with conflict checks |
| Manufacturing & Quality | Existing QMS, shop-floor operations, machine/operator gates, inspections and controlled release |
| Inventory | Existing batch, stock-in/out, raw-material and packaging registers |
| Supply Chain | Open purchase-order/delivery overview using the same procurement records |
| People & HR | Existing staff, roster, attendance, timesheet and company-form workflows |
| Finance & Accounting | Company invoice status counts and existing accounting/Finance OS entry points; no personal-bank aggregation |
| Approvals & Controls | Existing user-specific approval inbox and controlled forms |

## Controls and limits

- Authenticated `/api/erp/workspace` only queries registers permitted to the user. An unavailable register produces `null` and an explicit status, not an invented zero.
- Department availability and write capabilities are checked server-side. Existing permission boundaries remain effective; no new grants are assigned to users.
- New writes and their audit events commit atomically. Campaign edits require the previously observed revision; cancelled plans remain recoverable through editing and audit history.
- Campaign budgets are plans, not payments or journal entries. Saving a campaign does not publish advertising or send messages.
- New manufacturing jobs start in `PLANNING`. Regulated sectors are flagged for further review. Intake and schedule reservation do not authorise production start, packing or quality release.
- Machine reservations lock the machine, block overlapping/unscheduled active operations and reject unavailable/uncommissioned machines. Shop-floor start continues to require the original machine and operator checks.
- Lists show at most 100 recent/open records. Any metric based on these lists is labelled as a loaded-view metric. Full histories remain in their original registers.
- Existing statement import issues are not silently approved by this ERP release. They remain in Finance OS for source verification and review.

## Not yet a complete enterprise suite

This release provides a coherent ERP entry point and concrete missing Marketing/Planning capabilities. It does not claim a finished BOM/MRP demand engine, automatic sales-order-to-manufacturing conversion, campaign attribution/ROI, automatic dispatch/carrier integration or end-to-end financial reconciliation. Those require separate workflow designs and verification, not more menu labels.

## Verification

`scripts/erp-workspace-test.js` exercises filtered permissions, permission boundaries, unknown register data, campaign validation and optimistic concurrency, audit rollback, planning-only job creation, UTC schedule validation, machine conflict locking and escaped UI rendering. It is included in the production regression build gate.
