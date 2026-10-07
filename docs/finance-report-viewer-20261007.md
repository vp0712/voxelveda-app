# Saved Finance reports

Finance remains inside the integrated app. Generate saves an encrypted, immutable report and original-logo snapshot in MySQL before PDF generation. A consistent read uses the existing authorised filter and Trusted Totals services. Reports above 100,000 transactions or 128 MiB fail explicitly without saving a partial report.

The internal `/finance/reports/:reportId/view` page uses session-cookie page authentication, preserves its return URL through login/MFA, checks its owner and current account grants on the server, and renders actual HTML in the shared shell. It paginates transactions and detail sections at 100 rows, with totals covering the complete snapshot. It never needs a PDF plugin. New view URLs use the configured main app origin, not the legacy public PDF delivery origin.

Snapshot HTML, print, CSV, PDF and XLSX downloads keep the existing export permission, step-up and sensitive-export-approval gates. Print/HTML contain every saved row, inline styles and the original embedded logo. Imported text is escaped; spreadsheet text is protected against formula execution. XLSX account statements retain running balances.

PDF generation and full document parsing validate readable pages, identity, expected transaction text and native-currency totals. Only parsed artifacts are persisted as encrypted durable chunks. Renderer failure leaves the HTML report and other downloads available. The JSON response always reports its actual saved ID, view URL, available formats, PDF status and email outcome.

Email includes the saved view link, plain URL, real scope/period/currency/count/totals and truthful attachment wording. Provider acceptance is distinct from recipient receipt. SMTP/official Hostinger API can submit a parsed PDF using the correct MIME fields. Finance messages using a WordPress relay that has no recipient-tested filename contract use truthful web-report bodies with no attachment; the generated PDF remains downloadable. `WORDPRESS_MAIL_RELAY_PDF_FILENAME_VERIFIED=true` is reserved for a relay whose received filename/content have actually been tested. A relay response flag alone does not establish recipient verification.

The inspected direct-send flow did not use the queue. The queue's independent buffer-loss defect is repaired by copying bytes at enqueue time with base64, filename, MIME/disposition, length and SHA-256 metadata, rather than relying on an ephemeral path. Decoding validates those bytes before delivery.

`IMG_3394.png` shows a Gmail `tmp` attachment. The matching report timestamp and HTTP logs identify the September 30–October 6 request, but the original Gmail MIME source and live relay PHP implementation are not accessible through the connected integrations. The app previously could report an error after the relay had already sent the message if a filename acknowledgment was absent. The repair prevents that false failure and avoids the unverified attachment route. It does not claim that a template or provider acceptance proves Gmail received the intended PDF.

Older saved filter definitions can be rerun as new reports. A filter definition or standalone PDF cannot recover the original full historical data snapshot; regenerated reports are explicitly current data.

Verification: `npm test`, `npm run build` (74 Finance checks), parsed-PDF/snapshot/MIME/queue regression, shared-navigation behavior, login-return and Australian local-date checks. The existing isolated MySQL CI also runs the new snapshot migration/chunk/restart/permission check. Production and recipient/device verification must be recorded separately after deployment.
