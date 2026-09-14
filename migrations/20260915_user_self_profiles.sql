CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INT NOT NULL,
  mobile_number VARCHAR(30) NULL,
  profile_photo MEDIUMBLOB NULL,
  profile_photo_mime VARCHAR(50) NULL,
  profile_photo_size INT UNSIGNED NULL,
  profile_photo_updated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  INDEX idx_user_profiles_updated_at (updated_at)
) ENGINE=InnoDB;
