# Original-application release evidence

This release corrects the broad account-only removal. [The restoration matrix](RESTORATION-MATRIX.md) records introduction/removal history and the selective dependency boundary. Banking, the added Finance system and the separate ERP workspace stay unavailable; original operational workflows and independent shared security controls are retained. Existing IDs, historical records, uploaded sources, audit history and encryption keys are preserved.

## Implementation and release states

The inspected repository and production reference on October 12 was `7c556ddf69b43b5ba119a08d04156a052a3859c7`, Railway deployment `e15b0b3a-7c04-4f4e-bcb1-aa2be0dbb3a1`. Restored implementation, passing local fixtures, committed source, CI results, deployment success and recipient verification are separate evidence. This document is included with the candidate; its presence does not certify a production rollout.

The authorised release path is candidate PR → successful repository CI → merge to `main` → successful merged-main checks → a separate `.railway-release` marker. The marker identifies the candidate, merge and checks. Railway deployment metadata and `/api/ready.deployment_sha` identify the actual live release. Production browser evidence is uploaded by `.github/workflows/production-account-verification.yml` for that exact marker commit.

## Weekly staff delivery

The scheduled job selects stable employee IDs from actual attendance for the latest completed local Monday–Sunday week. Completed, consistent worked time or explicitly authorised manual time qualifies. Planned, cancelled, rejected, deleted, duplicate and incomplete entries cannot create a completed timesheet. Overlapping or unproven historical timestamps require review; no 12-hour closure or invented work is applied. Verified new clock records are explicitly UTC with the company timezone recorded.

`users.timesheet_delivery_email` is nullable, validated and audited in profile/staff workflows. It is never backfilled from a login email. Missing/invalid designation blocks delivery with an actionable diagnostic. Exactly one To recipient and no CC/BCC is enforced in the scheduler, persistent queue policy and final transport. Account, recipient and source eligibility are rechecked before sending; completed recipients and PDF versions are immutable.

The default schedule is Monday 07:00 in `Australia/Sydney`, with a bounded two-hour window, configurable through the documented company timezone/schedule settings. Startup registers `weekly_timesheet_email` and publishes `weekly_timesheet_worker` readiness plus resolved configuration/next due time. No automatic historical backfill occurs. Shared leases, generation claims, staff/week uniqueness and versioned queue keys prevent ordinary duplicate delivery. Uncertain acceptance is held for review; corrected sent reports require an authorised audited revision.

Each staff PDF contains only that person's recorded shifts, breaks, job/site references, daily/weekly totals, period/timezone, review status and version. Preview/download returns the exact validated queue bytes. See [the workflow contract](TIMESHEET_WORKFLOW_AND_EMAIL.md) and [PDF/MIME evidence](PDF-DELIVERY-VERIFICATION-20261011.md).

## External verification limits

Production private role sessions require an authorised existing login; public route/authentication checks cannot prove every private workflow. Browser regression uses isolated fixtures and does not impersonate production accounts. Historical unzoned attendance remains review-required until its actual timestamp basis is established through authorised corrections or evidence.

The existing WordPress HTTPS relay requires the prepared parser/filename/privacy receiver contract before document delivery. The secure connector currently has no registered WordPress site, so receiver installation and received-message verification are pending external access. Application PDF generation, queue round trips and local PHP/PHPMailer MIME fixtures cannot prove a received Gmail attachment. Provider acceptance must remain distinct from receipt/opening.

No provider was silently changed and no Railway plan was purchased. Hobby outbound SMTP restrictions are independent of PDF formatting. The actual workspace subscription cannot be confirmed from the currently exposed Railway OAuth metadata. Existing HTTPS relay use does not establish a need for a Pro upgrade. [The receiver package](../deployment/wordpress/README.md) preserves the existing endpoint and company sender configuration.

## Recovery

The prior successful Railway deployment remains the code rollback reference. Additive schema fields/tables preserve old records; rollback must not reverse them, erase audit/queue histories or destroy keys. Restore prior verified code through the permitted release workflow or Railway's existing deployment rollback when responding to a failed rollout. No DNS or hosting change is needed.
