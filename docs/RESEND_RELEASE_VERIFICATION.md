# Controlled Resend release verification

This is a delivery test, separate from staff scheduling and historical recovery. It creates only two `security` release-fixture queue entries: a complete fictional timesheet in HTML/plain text, and a professional parser-validated PDF report. It never reads or changes employee attendance, registered addresses, invoices, customers or suppliers. The owner authorised only `Viralvekariya782@gmail.com` for these tests.

Before enabling this test, release the tested application code and configure the verified company sender and `RESEND_API_KEY` through Railway's secure Variables control. Never paste the key into chat, a shell command, a repository file or logs. Adding the key alone does not select a new provider.

Set these non-secret application-service variables for one stable test:

```text
EMAIL_PRIMARY_TRANSPORT=resend
VV_RESEND_RELEASE_VERIFY=true
VV_RESEND_RELEASE_TEST_ID=resend-20261112-v1
VV_RESEND_RELEASE_TEST_ISSUED_AT=2026-11-12T12:00:00Z
VV_RELEASE_TEST_RECIPIENT=Viralvekariya782@gmail.com
```

Use the actual release's issue timestamp and preserve it with its test ID. The fictional report covers the completed Australian Monday–Sunday week before that timestamp. Its sample rows are clearly labelled as a fictional release fixture; they are never entered into attendance or payroll tables.

The gated bootstrap hook or the following command, run **inside the authorised application service runtime**, queues the fixtures once:

```sh
node scripts/release-resend-verification.js --queue
```

The existing durable email worker performs delivery. This script does not drain the queue, reset attempts, resend a failed fixture or release an uncertain outcome. Repeated startup or command execution returns the existing stable keys and saved bytes. A changed issue timestamp under an existing test ID is rejected. The ordinary queue retains provider binding, immutable envelope checks, atomic claims and review holds.

Read retained evidence without making a send request:

```sh
node scripts/release-resend-verification.js --evidence
```

The output contains queue IDs, status, attempts, provider message ID and acceptance flags, recipient counts, content hashes and PDF filename/MIME/pages/hash. It omits addresses, message bodies and credentials. `recipient_verified` remains false: `SENT`/a provider message ID proves provider acceptance only.

Check both received messages in the authorised inbox. Record whether the HTML/plain-text report is complete and readable on phone and desktop; open the PDF and verify its `RELEASE-resend-<test ID>` reference. Retain received MIME when available and validate its decoded attachment bytes independently. Do not claim receipt or opening from a provider response. If mailbox access is unavailable, state that limitation.

After recording evidence, disable `VV_RESEND_RELEASE_VERIFY`. Preserve the test ID and queue/provider history. Do not change the test ID merely to bypass a failure or `REVIEW_REQUIRED`: review the actual provider outcome first and obtain explicit authority for any new test revision. None of these fixture operations authorises historical employee backfill.

Local regression coverage: `node scripts/release-resend-verification-test.js`; no real provider or mailbox is contacted by that test.
