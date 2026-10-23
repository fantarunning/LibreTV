-- Run with a migration identity against the dedicated libretv database (MySQL 8+).
-- Runtime identity needs SELECT, INSERT, UPDATE, DELETE only.
CREATE TABLE IF NOT EXISTS ltv_users (
  id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  account_name VARCHAR(100) NOT NULL UNIQUE,
  sync_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS ltv_devices (
  id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  device_name VARCHAR(120) NOT NULL,
  device_type ENUM('web', 'tv') NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE,
  credential_epoch CHAR(64) CHARACTER SET ascii NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  revoked_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_devices_user (user_id),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES ltv_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS ltv_pairings (
  device_code_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
  user_code CHAR(8) CHARACTER SET ascii NOT NULL UNIQUE,
  device_name VARCHAR(120) NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  authorized_device_id CHAR(36) CHARACTER SET ascii NULL,
  encrypted_token TEXT NULL,
  INDEX idx_pairings_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS ltv_sync_records (
  user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  kind ENUM('history', 'progress', 'skip', 'favorite', 'preferences') NOT NULL,
  doc_key VARCHAR(512) NOT NULL,
  doc_value JSON NULL,
  version BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, kind, doc_key),
  INDEX idx_sync_cursor (user_id, version),
  CONSTRAINT fk_sync_user FOREIGN KEY (user_id) REFERENCES ltv_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS ltv_sync_events (
  user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  event_id VARCHAR(80) CHARACTER SET ascii NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, event_id),
  CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES ltv_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
