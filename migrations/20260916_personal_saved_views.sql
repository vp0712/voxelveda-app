CREATE TABLE IF NOT EXISTS personal_finance_saved_views (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(120) NOT NULL,
  query_text VARCHAR(180) NOT NULL,
  pinned TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  last_opened_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_personal_finance_saved_views_user (user_id, pinned, sort_order, updated_at),
  UNIQUE KEY uniq_personal_finance_saved_view_name (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
