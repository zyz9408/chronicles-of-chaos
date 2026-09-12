CREATE TABLE cloud_object_cleanup (
  object_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX cloud_object_cleanup_user ON cloud_object_cleanup(user_id);

CREATE TRIGGER cloud_save_deleted AFTER DELETE ON cloud_saves BEGIN
  INSERT OR IGNORE INTO cloud_object_cleanup(object_key,user_id) VALUES(OLD.object_key,OLD.user_id);
  UPDATE cloud_users SET usage_bytes=MAX(0,usage_bytes-OLD.size_bytes) WHERE user_id=OLD.user_id;
  UPDATE cloud_quota SET used_bytes=MAX(0,used_bytes-OLD.size_bytes) WHERE scope='global';
END;
CREATE TRIGGER cloud_settings_deleted AFTER DELETE ON cloud_settings BEGIN
  INSERT OR IGNORE INTO cloud_object_cleanup(object_key,user_id) VALUES(OLD.object_key,OLD.user_id);
  UPDATE cloud_users SET usage_bytes=MAX(0,usage_bytes-OLD.size_bytes) WHERE user_id=OLD.user_id;
  UPDATE cloud_quota SET used_bytes=MAX(0,used_bytes-OLD.size_bytes) WHERE scope='global';
END;
CREATE TRIGGER cloud_save_replaced AFTER UPDATE OF object_key ON cloud_saves WHEN OLD.object_key<>NEW.object_key BEGIN
  INSERT OR IGNORE INTO cloud_object_cleanup(object_key,user_id) VALUES(OLD.object_key,OLD.user_id);
END;
CREATE TRIGGER cloud_settings_replaced AFTER UPDATE OF object_key ON cloud_settings WHEN OLD.object_key<>NEW.object_key BEGIN
  INSERT OR IGNORE INTO cloud_object_cleanup(object_key,user_id) VALUES(OLD.object_key,OLD.user_id);
END;

ALTER TABLE cloud_upload_reservations ADD COLUMN slot_limit INTEGER NOT NULL DEFAULT 5;
CREATE TRIGGER cloud_slot_reservation_guard BEFORE INSERT ON cloud_upload_reservations
WHEN NEW.target_kind='save' AND NEW.expected_revision=0 BEGIN
  SELECT RAISE(ABORT,'slot_limit_exceeded') WHERE
    (SELECT COUNT(*) FROM cloud_saves WHERE user_id=NEW.user_id) +
    (SELECT COUNT(*) FROM cloud_upload_reservations WHERE user_id=NEW.user_id AND target_kind='save' AND expected_revision=0)
    >= NEW.slot_limit;
END;

CREATE TRIGGER cloud_uncommitted_upload_removed AFTER DELETE ON cloud_upload_reservations
WHEN OLD.finalized=0 BEGIN
  INSERT OR IGNORE INTO cloud_object_cleanup(object_key,user_id)
  SELECT OLD.next_object_key,OLD.user_id
  WHERE NOT EXISTS(SELECT 1 FROM cloud_saves WHERE object_key=OLD.next_object_key)
    AND NOT EXISTS(SELECT 1 FROM cloud_settings WHERE object_key=OLD.next_object_key);
END;
