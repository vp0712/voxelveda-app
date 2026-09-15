## Finance statement review release

This release adds staged statement ingestion and row-level review before bank transactions are committed.

Key controls:
- SHA-256 file duplicate detection
- transaction row duplicate detection
- malformed amount/date rejection
- review queue and row inclusion controls
- atomic commit to bank transactions + import audit records
- step-up authentication required for commit/reject
- conservative PDF handling; ambiguous debit/credit direction is blocked
