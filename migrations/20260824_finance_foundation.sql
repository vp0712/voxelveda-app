-- Voxel Veda Finance Foundation
-- Additive migration. It creates new accounting tables and does not rewrite legacy invoices or expenses.
-- The same idempotent schema is maintained by services/financeSchema.js during deployment.

-- Apply through the application startup migration or run services/financeSchema.js from the app environment.
-- Existing expense/category records remain unchanged and require explicit mapping review.
