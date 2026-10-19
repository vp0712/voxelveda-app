# Weekly timesheet delivery investigation, 19 October 2026

Reference and initial live source: 129708ab1d8d6d20fc98c3e3b2f20ece5c925fb1.
Railway deployment 5a5ccd14-89a0-4469-8b58-37995919c805 was SUCCESS.

The production worker evaluated 12–18 October at 07:10 through 08:55 Sydney.
One employee outcome was REVIEW_REQUIRED; the saved issue array was omitted from
logs. Later attempts correctly reported the closed window. These logs do not
prove a PDF, queued message, provider acceptance or recipient receipt.

The first diagnostic change adds hourly read-only reconciliation inside the
existing leased worker, including staff IDs, affected attendance IDs, actual
eligibility, designated-address validity (never the address), delivery/PDF/queue
states and explicit unknown recipient verification. It does not alter attendance,
recipients, delivery records, transport or scheduling. Original review evidence
remains intact. Operational logs omit names, addresses and PDF content.

Regression: scripts/weekly-reconciliation-test.js uses isolated fixtures to
exercise no work, missing designated email/delivery, specific review records,
failed/accepted/uncertain outcomes and own/team/denied access. All its SQL is
asserted read-only. No message was sent to a real person for this test.

Further recovery and portal changes, production reconciliation and final
verification are tracked in subsequent commits. This document is not a claim
that any employee has received a timesheet.
