# Finance email transport inspection — 8 October 2026

The production inspection baseline advanced to deployment `888d18ea-3bd2-4260-aea7-b4bf7d5f86be`, commit `abe61230fd3f3c05586a416196795867b5acaa3c`, before this repair. The original screenshot incident was traced against deployment `f076c4f4-ec16-444f-926f-86f92bc53563` and commit `966196d6d7c804921b037cb73ca7fa8ea47d40d0`.

## Incident correlation

`FIN-1791374381048-B23ABB` encodes 7 October 2026, 11:59:41.048 UTC. Historical Railway proxy logs show `/api/finance/reports/builder/email-pdf` returning 403 at 11:59:22.817 and its retry returning 503 at 11:59:48.458, after 8,436 ms. The caller's request body is not included in these logs; the September 30–October 6 period comes from the supplied evidence.

Historical startup logs identify the configured primary transport as WordPress `wp_mail` over `https_relay` at `voxelveda.com/wp-json/voxel-veda/v1/mail-relay`, and explicitly say the SMTP probe was skipped. The request's DNS lookup for `voxelveda.com` occurs at 11:59:41.156–.187. Network-flow logs record HTTPS egress to its resolved address, port 443, at 11:59:41.188–.458. No SMTP egress appears in the inspected 11:59:20–12:00:00 interval. This identifies the actual app-to-provider transport used for the incident. The recorded 6,906,593 transport bytes include encrypted connection traffic and are **not** the decoded attachment byte length.

The original controller built a buffer, provided a `.pdf` filename, `application/pdf` and attachment disposition, and called `sendMail` directly. It did not use `queueEmail`. The HTTPS JSON contract included the intended filename under `filename`, `name` and `original_filename`, and base64 bytes under `content`, `data` and `content_base64`. At that revision the service could throw `PDF_ATTACHMENT_RELAY_FILENAME_UNSAFE` after the relay had already replied `sent: true`, when its filename acknowledgment was absent. The controller also treated a provider filename claim as verified recipient delivery. Those are confirmed logic defects; the original 503 is consistent with the post-send exception, but logs do not retain the exact exception or relay response.

The older queue independently filtered out every buffer-backed attachment and kept only paths. This was a real queue defect, but it was not on the inspected direct-send path. Current main already snapshots path/buffer bytes into durable base64 data with length/hash metadata. This update additionally uses one binary decoder for queue and relay paths, preserving JSON Buffers, typed-array offsets, ArrayBuffers and supported text encodings. Missing or unsupported attachment content fails explicitly instead of being silently omitted or stringified into incorrect bytes. Relay payloads include length and SHA-256 metadata for future boundary tracing.

## Recipient and relay limitations

`IMG_3394.png` was named by the user but was not supplied as an accessible file in this task. Its described Gmail `tmp` filename is the recipient evidence, not an inspected raw message source. No Gmail connection is available. The connected Hostinger mailbox `info@voxelveda.com` was inspected read-only: its Sent folder has four messages, newest 21 September, and no matching report; the most recent 100 Inbox messages also contain no matching Finance report. This does not provide the recipient Gmail MIME.

The WordPress connector reports no credentials for `https://voxelveda.com`. The repository has no relay PHP implementation. Therefore temporary-file naming inside the live relay, the original received MIME filename, decoded PDF bytes, and attachment open behavior cannot be established from the available access. A relay using an unnamed temporary path is consistent with the described `tmp` filename, but remains an unproven cause. No email was sent during this inspection.

Finance continues to omit PDF attachments on the unverified relay path and sends truthful saved-report link wording. A relay acknowledgment alone cannot enable this path; the existing `WORDPRESS_MAIL_RELAY_PDF_FILENAME_VERIFIED` setting is reserved for actual recipient-tested filename/content behavior. The generated, parsed PDF remains available through the authenticated snapshot download.

## Regression evidence

Executed `node scripts/finance-email-transport-binary-test.js`, `node scripts/finance-report-snapshot-test.js` and `node scripts/finance-email-pdf-delivery-test.js`, all successfully. The new test checks exact bytes through Buffer/JSON Buffer/typed-array/ArrayBuffer/encoded-text boundaries, queue reload after deleting the source temporary file, relay omission when verification is absent, and locally generated MIME. It decodes the MIME PDF part and parses a readable page containing the expected report identity, transaction and amount. This fixture verifies the application encoding and MIME boundary; it does not claim recipient receipt. The snapshot regression separately parses multi-page/empty reports, validates expected records/totals, and confirms forced renderer failure leaves the viewer and truthful email body available.

Deployment, authenticated live viewer/download tests, screenshots and any native-device tests are recorded separately by the release owner.
