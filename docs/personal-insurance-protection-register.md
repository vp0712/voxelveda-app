# Personal Insurance & Protection Register

This feature reuses the existing owner-private Asset Protection Center instead of creating a duplicate insurance database.

## Policy records
- stored as `personal_asset_lifecycle_items` with `item_type=INSURANCE`
- policy/provider/reference, premium, currency, renewal date/frequency and reminder days use existing protected fields
- structured insurance-only metadata (policy type, insured amount, excess, beneficiary/protected-person note and coverage note) is stored inside the existing private note field using the `INSURANCE_META:` prefix
- policies may be linked to an existing personal asset

## Policy documents
- stored as existing `personal_asset_documents` records with `document_type=POLICY`
- only HTTPS document references are accepted by the existing backend
- references remain owner-private and are not made public

## Integrity and safety
- no missing policy record is interpreted as proof of missing insurance
- policy references are masked in the insurance-specific UI
- currencies are displayed separately and never aggregated through assumed FX
- annual premium equivalents are illustrations based only on recorded premium and recurrence
- the app does not verify policy adequacy, exclusions, claims eligibility or insurer status
- the app does not buy, renew or cancel insurance and does not submit claims or move money
- create/complete/archive actions occur only after an explicit user action
