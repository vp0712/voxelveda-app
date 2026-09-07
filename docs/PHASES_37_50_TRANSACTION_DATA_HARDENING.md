# Security Phases 37-50 — Transaction and Data Hardening

Phase 36 segregation enforcement is already deployed. This release consolidates the original banking, payment, payroll, document, API, browser and injection requirements without duplicating earlier controls.

## Implemented controls

- **37 Payment security:** server-calculated 0-100 payment risk score, risk tier, high-value detection, recent supplier-bank change detection, first-payment detection, duplicate detection, velocity detection, expiring approval requests, independent approval and execution-time revalidation.
- **38 Payroll security:** existing encrypted, masked employee banking flow remains permission-gated, step-up protected, independently approved and audited. Bank-change decisions now also enter the security-event outbox.
- **39-42 Document security:** validated classification, explicit access policy, SHA-256 content evidence, path containment, signature/type/size validation, malware states, restricted-download step-up and user-bound single-use download grants. A real scanner is still required before a document can be marked safe.
- **43 API security:** central suppression of internal 5xx details, request IDs, endpoint authorization, rate limits and controlled high-risk errors.
- **44 CSRF:** fixed the empty `Bearer` header bypass, retained strict origin verification, added cross-site Fetch Metadata rejection and strengthened the session cookie to `SameSite=Strict`.
- **45 CORS:** existing explicit production allowlist remains deny-by-default for unknown authenticated origins.
- **46-48 Headers, HTTPS and CSP:** production HTTPS enforcement, existing security headers, and a stricter CSP in report-only mode so incompatible inline code can be measured before enforcement rather than breaking production.
- **49 XSS:** browser-policy violation telemetry, URL/query stripping in telemetry, encoding checks for both workspaces and an automated dangerous-sink audit.
- **50 SQL injection:** automated source audit rejects direct request interpolation or concatenation in SQL; runtime queries remain parameterized and dynamic identifiers remain server-owned.

## Operational truth

- The strict CSP is deliberately report-only until violations are removed. Calling it enforced today would be false.
- Malware status cannot become `SAFE` until a real provider returns an authenticated result.
- Payment risk signals reduce fraud risk but do not replace bank-side verification or human call-back procedures.
- No default financial thresholds or approval rules should be silently changed in production; environment values must be reviewed before deployment.
