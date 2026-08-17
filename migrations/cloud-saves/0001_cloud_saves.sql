PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cloud_users (
  user_id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  global_name TEXT NOT NULL DEFAULT '',
  avatar_hash TEXT NOT NULL DEFAULT '',
  usage_bytes INTEGER NOT NULL DEFAULT 0 CHECK (usage_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_sessions_user
  ON cloud_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sessions_expiry
  ON cloud_sessions(expires_at);

CREATE TABLE IF NOT EXISTS cloud_saves (
  user_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_saves_user_updated
  ON cloud_saves(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cloud_settings (
  user_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('api_settings')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  sync_mode TEXT NOT NULL CHECK (sync_mode IN ('routes_only', 'encrypted_full')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS cloud_quota (
  scope TEXT PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  limit_bytes INTEGER NOT NULL CHECK (limit_bytes > 0),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO cloud_quota (
  scope, used_bytes, reserved_bytes, limit_bytes, updated_at
) VALUES (
  'global', 0, 0, 8000000000, '2026-08-02T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS cloud_upload_reservations (
  reservation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('save', 'api_settings')),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  next_revision INTEGER NOT NULL CHECK (next_revision > 0),
  next_object_key TEXT NOT NULL,
  upload_bytes INTEGER NOT NULL CHECK (upload_bytes > 0),
  user_growth_bytes INTEGER NOT NULL CHECK (user_growth_bytes >= 0),
  user_limit_bytes INTEGER NOT NULL CHECK (user_limit_bytes > 0),
  finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_upload_reservations_expiry
  ON cloud_upload_reservations(expires_at);

CREATE TRIGGER IF NOT EXISTS cloud_upload_reservation_quota_guard
BEFORE INSERT ON cloud_upload_reservations
BEGIN
  SELECT RAISE(ABORT, 'global_quota_exceeded')
  WHERE (
    SELECT used_bytes + reserved_bytes + NEW.upload_bytes > limit_bytes
    FROM cloud_quota
    WHERE scope = 'global'
  );

  SELECT RAISE(ABORT, 'user_quota_exceeded')
  WHERE (
    SELECT usage_bytes + reserved_bytes + NEW.user_growth_bytes > NEW.user_limit_bytes
    FROM cloud_users
    WHERE user_id = NEW.user_id
  );
END;

CREATE TRIGGER IF NOT EXISTS cloud_upload_reservation_added
AFTER INSERT ON cloud_upload_reservations
BEGIN
  UPDATE cloud_quota
  SET reserved_bytes = reserved_bytes + NEW.upload_bytes,
      updated_at = NEW.created_at
  WHERE scope = 'global';

  UPDATE cloud_users
  SET reserved_bytes = reserved_bytes + NEW.user_growth_bytes,
      updated_at = NEW.created_at
  WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS cloud_upload_reservation_removed
AFTER DELETE ON cloud_upload_reservations
BEGIN
  UPDATE cloud_quota
  SET reserved_bytes = MAX(0, reserved_bytes - OLD.upload_bytes),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE scope = 'global';

  UPDATE cloud_users
  SET reserved_bytes = MAX(0, reserved_bytes - OLD.user_growth_bytes),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = OLD.user_id;
END;

CREATE TRIGGER IF NOT EXISTS cloud_upload_reservation_finalize_guard
BEFORE UPDATE OF finalized ON cloud_upload_reservations
WHEN OLD.finalized = 0 AND NEW.finalized = 1
BEGIN
  SELECT RAISE(ABORT, 'cloud_save_conflict')
  WHERE (
    NEW.target_kind = 'save'
    AND NOT EXISTS (
      SELECT 1
      FROM cloud_saves
      WHERE user_id = NEW.user_id
        AND slot_id = NEW.slot_id
        AND revision = NEW.next_revision
        AND object_key = NEW.next_object_key
    )
  ) OR (
    NEW.target_kind = 'api_settings'
    AND NOT EXISTS (
      SELECT 1
      FROM cloud_settings
      WHERE user_id = NEW.user_id
        AND kind = 'api_settings'
        AND revision = NEW.next_revision
        AND object_key = NEW.next_object_key
    )
  );
END;
