-- Current original-register schema only. Historical migration files remain
-- checksum-verified and are never replayed. Existing columns, values, IDs,
-- attachments and audit records are preserved. Missing legacy fields remain
-- unknown (NULL); no historical owner, date, status or note is invented.

CREATE TABLE IF NOT EXISTS competitors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_name VARCHAR(180) NOT NULL,
      category VARCHAR(160) NULL,
      country VARCHAR(120) NULL,
      city VARCHAR(140) NULL,
      website TEXT NULL,
      capabilities TEXT NULL,
      materials TEXT NULL,
      target_market TEXT NULL,
      strength TEXT NULL,
      source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
      source_url TEXT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='category'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `category` VARCHAR(160) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='country'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `country` VARCHAR(120) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='city'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `city` VARCHAR(140) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='website'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `website` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='capabilities'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `capabilities` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='materials'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `materials` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='target_market'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `target_market` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='strength'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `strength` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='source_type'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `source_type` VARCHAR(80) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='source_url'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `source_url` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='notes'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `notes` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='created_by'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `created_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='updated_by'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `updated_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `created_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='updated_at'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='competitors' AND column_name='deleted'),
  'SELECT 1', 'ALTER TABLE `competitors` ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS access_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      user_name VARCHAR(255) NULL,
      user_email VARCHAR(255) NULL,
      section VARCHAR(120) NOT NULL,
      action VARCHAR(120) NOT NULL,
      method VARCHAR(20) NOT NULL,
      path VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_access_attempts_created_at (created_at),
      INDEX idx_access_attempts_user_id (user_id)
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='access_attempts' AND column_name='user_id'),
  'SELECT 1', 'ALTER TABLE `access_attempts` ADD COLUMN `user_id` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='access_attempts' AND column_name='user_name'),
  'SELECT 1', 'ALTER TABLE `access_attempts` ADD COLUMN `user_name` VARCHAR(255) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='access_attempts' AND column_name='user_email'),
  'SELECT 1', 'ALTER TABLE `access_attempts` ADD COLUMN `user_email` VARCHAR(255) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='access_attempts' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `access_attempts` ADD COLUMN `created_at` TIMESTAMP NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_name VARCHAR(180) NOT NULL,
      contact_name VARCHAR(180) NULL,
      email VARCHAR(180) NULL,
      phone VARCHAR(80) NULL,
      address TEXT NULL,
      notes TEXT NULL,
      file_link TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='contact_name'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `contact_name` VARCHAR(180) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='email'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `email` VARCHAR(180) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='phone'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `phone` VARCHAR(80) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='address'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `address` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='notes'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `notes` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='file_link'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `file_link` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='created_by'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `created_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='updated_by'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `updated_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `created_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='updated_at'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='customers' AND column_name='deleted'),
  'SELECT 1', 'ALTER TABLE `customers` ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS meetings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      meeting_type VARCHAR(80) NOT NULL DEFAULT 'internal',
      organisation VARCHAR(255) NULL,
      contact_person VARCHAR(255) NULL,
      contact_details VARCHAR(255) NULL,
      location_type VARCHAR(80) NOT NULL DEFAULT 'site',
      location_details TEXT NULL,
      meeting_date DATE NOT NULL,
      meeting_time TIME NOT NULL,
      agenda TEXT NULL,
      required_preparation TEXT NULL,
      assigned_user_ids TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'scheduled',
      created_by INT NULL,
      updated_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_meeting_date (meeting_date),
      INDEX idx_meeting_status (status),
      INDEX idx_meeting_deleted (deleted)
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='meeting_type'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `meeting_type` VARCHAR(80) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='organisation'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `organisation` VARCHAR(255) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='contact_person'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `contact_person` VARCHAR(255) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='contact_details'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `contact_details` VARCHAR(255) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='location_type'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `location_type` VARCHAR(80) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='location_details'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `location_details` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='agenda'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `agenda` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='required_preparation'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `required_preparation` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='assigned_user_ids'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `assigned_user_ids` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='status'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `status` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='created_by'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `created_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='updated_by'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `updated_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='deleted'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `created_at` TIMESTAMP NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='meetings' AND column_name='updated_at'),
  'SELECT 1', 'ALTER TABLE `meetings` ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(120) PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='app_settings' AND column_name='setting_value'),
  'SELECT 1', 'ALTER TABLE `app_settings` ADD COLUMN `setting_value` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='app_settings' AND column_name='updated_at'),
  'SELECT 1', 'ALTER TABLE `app_settings` ADD COLUMN `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      priority VARCHAR(40) NOT NULL DEFAULT 'normal',
      starts_at DATE NOT NULL,
      expires_at DATE NOT NULL,
      audience_type VARCHAR(40) NOT NULL DEFAULT 'selected',
      target_user_ids TEXT NULL,
      created_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='priority'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `priority` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='audience_type'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `audience_type` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='target_user_ids'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `target_user_ids` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='created_by'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `created_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='deleted'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `created_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='announcements' AND column_name='updated_at'),
  'SELECT 1', 'ALTER TABLE `announcements` ADD COLUMN `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS staff_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      priority VARCHAR(40) NOT NULL DEFAULT 'Normal',
      body TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Open',
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by INT NULL,
      INDEX idx_staff_messages_user (user_id),
      INDEX idx_staff_messages_status (status),
      INDEX idx_staff_messages_deleted (deleted)
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='user_id'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `user_id` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='priority'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `priority` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='body'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `body` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='status'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `status` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='deleted'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `created_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='reviewed_at'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `reviewed_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_messages' AND column_name='reviewed_by'),
  'SELECT 1', 'ALTER TABLE `staff_messages` ADD COLUMN `reviewed_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

CREATE TABLE IF NOT EXISTS staff_work_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      request_type VARCHAR(40) NOT NULL,
      title VARCHAR(180) NOT NULL,
      body TEXT NULL,
      payload LONGTEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Open',
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by INT NULL,
      INDEX idx_staff_work_requests_user (user_id),
      INDEX idx_staff_work_requests_type (request_type),
      INDEX idx_staff_work_requests_status (status),
      INDEX idx_staff_work_requests_deleted (deleted)
    ) ENGINE=InnoDB;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='user_id'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `user_id` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='request_type'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `request_type` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='title'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `title` VARCHAR(180) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='body'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `body` TEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='payload'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `payload` LONGTEXT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='status'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `status` VARCHAR(40) NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='deleted'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='created_at'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `created_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='reviewed_at'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `reviewed_at` DATETIME NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;

SET @vv_original_schema_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='staff_work_requests' AND column_name='reviewed_by'),
  'SELECT 1', 'ALTER TABLE `staff_work_requests` ADD COLUMN `reviewed_by` INT NULL DEFAULT NULL');
PREPARE vv_original_schema_stmt FROM @vv_original_schema_sql;
EXECUTE vv_original_schema_stmt;
DEALLOCATE PREPARE vv_original_schema_stmt;
