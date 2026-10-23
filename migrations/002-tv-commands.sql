CREATE TABLE IF NOT EXISTS ltv_tv_commands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii NOT NULL,
  device_id CHAR(36) CHARACTER SET ascii NOT NULL,
  action ENUM('play', 'pause', 'resume', 'seek') NOT NULL,
  payload JSON NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_commands_device (user_id, device_id, id),
  INDEX idx_commands_expiry (expires_at),
  CONSTRAINT fk_commands_user FOREIGN KEY (user_id) REFERENCES ltv_users(id),
  CONSTRAINT fk_commands_device FOREIGN KEY (device_id) REFERENCES ltv_devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
