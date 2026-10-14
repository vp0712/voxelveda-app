# Attendance gate and portal repair — 14 October 2026

Baseline: repository main and Railway production both ran `235cc208e1425f0c9cdedc1e210c7725526a0b01`, deployment `d60d0abd-575b-4eb1-97fe-f4a0fd19bc42`. Existing staff attendance, private avatars, notifications, procurement and weekly delivery repairs were retained. Banking/Finance OS and the separate added ERP portal remain retired; original invoices, expense and commercial workflows remain.

## What was actually reproduced

Production QR image bytes rendered in Chromium decoded with jsQR at phone, tablet and desktop sizes. Payload length was 203 bytes, its content was a raw `VVATT1` signature token, and it was **not a URL**. An ordinary camera therefore cannot navigate into an attendance application route. Phone rendering scaled a 1024px image to 240.390625px. Density alone is not established as the cause of the user's physical-camera failure.

Source tracing also confirmed: the terminal had no centre-logo rendering; it changed the visible image URL before completion; its countdown decremented a local counter and stopped at zero without hiding expired codes; its token issuance and terminal were publicly accessible; and the staff fallback decoder depended on an external CDN despite a local locked jsQR asset. An actual loader failure was reproduced with the camera open: no attendance request was submitted, and explicit retry recovered. This establishes that failure path, not that it caused the original reported incident.

No authorised production staff identity or physical iPhone/Android camera was supplied. The original private-device failure cannot be attributed to authentication, permissions, workplace matching or persistence without that evidence. No real employee attendance was created.

## Implemented behavior

The displayed QR is now a 104-byte canonical HTTPS URL (`/a?t=…`). Its compact `VVATT2` site token retains a full SHA-256 HMAC, server-bound site digest and the existing 20-second rotation / bounded 20–40-second validity. It contains no employee data or signing secrets. It is stateless and shared: two authorised staff can derive separately account/action/session-bound proofs from one code. Existing durable per-user request receipts, locking, reconciliation and explicit action confirmation remain authoritative. Older site/action tokens remain supported for compatibility.

The canonical camera URL is a protected GET that validates the token and redirects to the existing portal. Login preserves a validated return path. The staff portal clears the URL intent, refreshes its identity/state, **revalidates** through authenticated POST, and requests explicit confirmation. GET never records attendance. A code that expires during login is rejected and requires a current scan.

Each QR PNG is rendered from integer modules with four-module quiet zone, dark navy on white, H correction and the unchanged original logo composited at the centre on a conservative white plate. Every rotation includes the logo in the image bytes. The next image is fetched and decoded before swapping; screen sizing uses whole module multiples. The countdown uses server time/expiration, resumes on visibility/network changes, and hides expired images with “Code expired—reconnecting”.

Gate display and issuance now require `EDIT_ATTENDANCE` or a site-bound, signed, 12-hour display-only kiosk cookie. Admin can create a kiosk link inside Gate settings. Opening it on a separate kiosk exchanges the capability for an HttpOnly cookie and removes it from the address bar. It cannot authenticate a user, expose a directory, or write attendance. No administrator session is copied to the kiosk.

Public home has Log in and Sign up plus Privacy/Terms. Registration still creates only the original viewer/customer account; employee access remains an administrator invitation. Existing role grants are unchanged. Staff home retains real profile/name, local time, actual sessions/breaks/timeline/tasks and optional checkout notes. Manager/supervisor home links open permitted team attendance history; HR/production/sales home actions use existing grants and sections. Admin gets compact operational actions and expandable advanced tools. Client adds the shared private avatar/notification centre and lists existing own records only where its existing permission grants allow access; it does not invent order/quotation capabilities. Theme controls move into profile menus.

## Verification

| Check | Evidence / result |
|---|---|
| Locked install, syntax and build | `npm run build`; 71 mandatory regression checks pass |
| Production startup policy | Full build also passes with production HTTPS, required malware scanner and selected S3 storage |
| QR across rotation | 60 rotations × 4 real jsQR decoded rendered sizes = 240 checks; 57 modules, 104-byte URL |
| Branded image on screen | Gate browser decodes actual image screenshots at portrait/landscape phone, tablet/desktop, light/dark; five distinct refresh payloads |
| Rotation/reconnection | Prior image remains visible while next is delayed; outage/clock advancement hides expired code; reconnect restores decodable branded image |
| Validation | Invalid/tampered/expired/wrong-site codes rejected; account/action/session-bound proof tests retained; shared code works for two employees |
| Complete scanner path | Actual branded image → emulated video stream → real local jsQR → authenticated signature validation → confirmation → one fixture receipt → refreshed WORKING state |
| Camera recovery | Denial, missing camera, unsupported media, loader failure/retry, native-detector failure/fallback and track cleanup covered by browser suite |
| Login intent | Real page-auth safe return tested; valid and expired portal intents revalidated; GET/intent handling writes zero attendance events |
| Attendance integrity | Retained SQL/receipt/transaction tests cover duplicate/concurrent actions, breaks, overnight/DST, rounding, locked periods, correction audit and note idempotency; disposable MySQL is also required in CI |
| Notes / summary | Save/Skip, independent session note and uncertain-response reconciliation retained; note failure does not undo checkout or complete production jobs |
| Roles | Real gate endpoint rejects anonymous/non-edit roles; staff/manager/supervisor/HR/production/sales home browser matrix; retained authorisation matrix and client/admin workflow browser checks |
| Avatar / notifications | Persisted private photo, replacement/cache/account boundaries, counts, recipient read state, destination validation, overlay/focus checks retained |
| Procurement / weekly PDFs | Existing regression suite and responsive workflows retained; worked-only designated email, no CC/BCC/fallback, genuine PDFs and delivery deduplication unchanged |
| Security checks | Dependency audit: zero vulnerabilities; secret scan and audit provenance pass |

Evidence: [decoder results](evidence/attendance-20261014/decoder-results.json), [gate browser results](evidence/attendance-20261014/gate-browser-results.json), [staff browser results](evidence/attendance-20261014/staff-mobile-proof.json). All private browser accounts/data are explicitly synthetic fixtures. Public baseline screenshots use actual production response bytes fetched through CA-verified curl and replayed into Chromium because Chromium did not trust the environment proxy certificate; no TLS verification bypass was used.

| Surface | Before | After |
|---|---|---|
| Gate | [Phone](evidence/attendance-20261014/before-live-gate-phone.png) | [Phone](evidence/attendance-20261014/after-gate-phone-light.png), [dark](evidence/attendance-20261014/after-gate-phone-dark.png), [tablet](evidence/attendance-20261014/after-gate-tablet-light.png) |
| Public entry | [Phone](evidence/attendance-20261014/before-live-entry-phone.png) | [Phone](evidence/attendance-20261014/after-entry-phone.png) |
| Staff | [Current-release fixture](evidence/attendance-20261014/before-staff-home-phone.png) | [Home](evidence/attendance-20261014/after-staff-home-phone.png), [checkout sheet](evidence/attendance-20261014/after-clock-out-notes-phone.png) |
| Admin | [Phone fixture](evidence/attendance-20261014/before-admin-phone.png) | [Phone fixture](evidence/attendance-20261014/after-admin-phone.png) |
| Client | [Phone fixture](evidence/attendance-20261014/before-client-phone.png) | [Phone fixture](evidence/attendance-20261014/after-client-phone.png) |

## Limits and outstanding checks

Native rear-camera focus/exposure, Safari/Android browser camera behavior and installed WebView permissions remain untested on physical devices. An authorised production test account/site is needed to verify the live private attendance journey, saved profile photo and notifications without touching real employee records. The screenshot files named in the request were not present in the available workspace; their written interaction guidance and current production baseline were used.

Existing relay delivery failures are unchanged. UI/QR success does not establish email delivery, recipient receipt or opening of a delivered PDF. No provider, SMTP/DNS or production data mutation was performed by the verification fixtures.

Release follows the existing candidate PR → all required CI → merged-main CI → dedicated `.railway-release` commit. Exact candidate, merge, deployment and anonymous live verification evidence is recorded in that release marker and the deployment verification artifact. This document does not assert completion of the unavailable physical-device/private-live checks.
