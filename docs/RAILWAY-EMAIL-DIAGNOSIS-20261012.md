# Railway and document-email diagnosis — October 12, 2026

The application already uses an HTTPS WordPress mail relay. A Railway plan upgrade does not repair malformed PDFs, lost attachment bytes, or recipient-visible temporary filenames. Direct outbound SMTP policy and the document/MIME defects are separate issues.

## Observed production reference

Read-only Railway inspection identified project `e41bb335-4f02-4251-8895-9195dc69726e`, application service `7dc16dbd-e670-46ae-9053-ef1b06873f71`, and production environment `113e44d2-01a4-4c87-a192-48e15f47dab9`. The observed successful deployment reference was `e15b0b3a-7c04-4f4e-bcb1-aa2be0dbb3a1`, source commit `7c556ddf69b43b5ba119a08d04156a052a3859c7`. This identifies the inspected production release, not the restored candidate or proof of a later rollout.

The bounded October 10 application log reported a healthy existing HTTPS relay at `https://voxelveda.com/wp-json/voxel-veda/v1/mail-relay`. A healthy transport log confirms connectivity at that time; it does not prove that the receiver implements the candidate PDF/privacy contract or that any recipient received and opened an attachment.

The connected Railway OAuth tools do not expose authoritative workspace billing/subscription details. The actual workspace plan remains unverified. A service memory limit, including an 8 GB allocation, is not evidence of a billing tier. No plan purchase, variable change, deployment, DNS change, key rotation, or mail-provider switch was performed as part of this diagnosis.

## Railway SMTP policy and cost

[Railway's current outbound-networking policy](https://docs.railway.com/networking/outbound-networking) restricts outbound SMTP for Trial, Free and Hobby workspaces and allows it on Pro and above. If this workspace is Hobby and direct SMTP from the Railway container is required, Pro is the relevant plan change; Railway requires the service to be redeployed after upgrading. Changing the SMTP port does not establish permission to bypass that policy. [Railway's billing documentation](https://docs.railway.com/pricing/understanding-your-bill) lists a US$5/month Hobby and US$20/month Pro minimum usage commitment: usage is included up to that amount, with additional usage charged separately. This policy and public pricing do not establish the actual account's subscription or future invoice.

An existing HTTPS relay sends from the WordPress host's mail transport rather than opening an SMTP connection from the Railway application. Its document receiver can therefore be repaired while keeping the existing endpoint, company sender and provider. The observed relay setup does not establish a need to buy Pro. The final repair must preserve the existing configured sender and credentials; secrets are absent from this document.

## Application and receiver defects

The inspected older application accepted header-only PDF checks and non-PDF attachments, streamed downloads before validating their content, truncated invoice/statement source rows, sent directly without a durable request/version, and lost buffer-backed queue attachments by retaining upload paths. These application defects can produce unusable documents regardless of the transport or Railway plan.

The candidate generates genuine PDFs, parses every page-bearing artifact, verifies source identity/totals, preserves complete rows, and stores exact attachment bytes, length, SHA-256 and intended `.pdf` filename in the persistent queue. Unsupported historical Word/CAD/archive sources retain their original record and bytes and return an explicit conversion error. Successful single-use grants consume access only after source integrity and PDF conversion pass. Queue claims, document bookkeeping and weekly source/version records are checked with disposable MySQL fixtures; these fixtures use synthetic staff and a mocked mail transport.

A WordPress receiver that passes only a `wp_tempnam()` file path to PHPMailer can expose a TMP attachment filename. That is a possible receiver mechanism, not a confirmed historical production root cause: the live receiver source and original received MIME were unavailable. The concrete [receiver package](../deployment/wordpress/README.md) validates PDF pages and hashes, then uses `addStringAttachment` with the intended `.pdf` filename, `application/pdf` and attachment disposition. It preserves the existing `/mail-relay` endpoint and creates no attachment temporary files.

Weekly PDFs contain one employee's actual eligible worked attendance. A separately designated address is required; login email is never used as fallback. Exactly one To and empty CC/BCC are enforced before queueing and final transport. Staff activity, designated recipient, source hash and period/version are rechecked under locks. Unknown transport outcomes hold the queue, current delivery and historical version for review while preserving any known provider acceptance; they do not automatically resend.

## Verification still required externally

The WordPress connector currently has no registered site, so the prepared receiver has not been installed or inspected live through that connector. Installing it on the existing authorised hosting, checking its authenticated PDF/privacy capabilities, and validating a controlled received message remain external access steps. The repair does not silently switch providers to work around an incompatible receiver.

The authorised release procedure distinguishes candidate source, repository CI, merged-main CI, a release marker, Railway deployment success, and the live readiness SHA. Local PDF/parser/MIME and disposable MySQL results do not prove that the candidate has deployed. Provider acceptance remains separate from receipt verification. The authorised inbox must show the intended filename and MIME type, decoded bytes matching the queued hash, a parseable PDF, and the expected opened content before recipient verification can be recorded.

See [PDF and MIME verification](PDF-DELIVERY-VERIFICATION-20261011.md), [weekly timesheet rules](TIMESHEET_WORKFLOW_AND_EMAIL.md), and [release evidence](ORIGINAL-APPLICATION-RELEASE-20261012.md) for the candidate boundaries and evidence.
