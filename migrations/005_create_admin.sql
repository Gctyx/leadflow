-- Admin auth (users, sessions, oauth identities, audit log)
-- Strong constraints, UUIDs, and indexes for lookups

CREATE TABLE IF NOT EXISTS admin_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARBINARY(255) NOT NULL,
  mfa_totp_secret VARBINARY(255) NULL,
  mfa_totp_iv VARBINARY(12) NULL,
  roles JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT NOW(6),
  updated_at DATETIME(6) NOT NULL DEFAULT NOW(6),
  last_login_at DATETIME(6) NULL,
  CHECK (JSON_VALID(roles))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_oauth_identities (
  id CHAR(36) NOT NULL PRIMARY KEY,
  admin_id CHAR(36) NOT NULL,
  provider ENUM('google','microsoft','github') NOT NULL,
  subject VARCHAR(255) NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT NOW(6),
  UNIQUE KEY uq_provider_sub (provider, subject),
  CONSTRAINT fk_admin_oauth_identity_user FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  admin_id CHAR(36) NOT NULL,
  refresh_token_hash VARBINARY(255) NOT NULL,
  user_agent VARCHAR(300) NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT NOW(6),
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  last_used_at DATETIME(6) NULL,
  rotated_from CHAR(36) NULL,
  INDEX idx_admin_sessions_admin_expires (admin_id, expires_at),
  CONSTRAINT fk_admin_session_user FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  admin_id CHAR(36) NULL,
  action VARCHAR(64) NOT NULL,
  resource VARCHAR(128) NULL,
  success BOOLEAN NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(300) NULL,
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT NOW(6),
  INDEX idx_admin_audit_created (created_at),
  CHECK (metadata IS NULL OR JSON_VALID(metadata)),
  CONSTRAINT fk_admin_audit_user FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
