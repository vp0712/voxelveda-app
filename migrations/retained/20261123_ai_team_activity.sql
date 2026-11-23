CREATE TABLE IF NOT EXISTS ai_team_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source VARCHAR(32) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  title VARCHAR(145) NOT NULL,
  summary VARCHAR(280) NOT NULL,
  reference_label VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_ai_team_event (event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_team_recipients (
  event_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  read_at DATETIME(3) NULL,
  PRIMARY KEY (event_id, user_id),
  KEY ix_ai_team_recipient_feed (user_id, event_id),
  KEY ix_ai_team_recipient_unread (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_team_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  in_app_enabled TINYINT(1) NOT NULL DEFAULT 1,
  push_enabled TINYINT(1) NOT NULL DEFAULT 0,
  push_enabled_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
