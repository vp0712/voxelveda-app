ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS step_up_verified_at DATETIME NULL;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS step_up_method VARCHAR(40) NULL;
