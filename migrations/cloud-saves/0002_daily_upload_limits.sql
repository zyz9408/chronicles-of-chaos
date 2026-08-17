ALTER TABLE cloud_upload_reservations
  ADD COLUMN upload_day TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS cloud_daily_usage (
  day TEXT PRIMARY KEY,
  upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count >= 0),
  upload_limit INTEGER NOT NULL CHECK (upload_limit > 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_user_daily_usage (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count >= 0),
  upload_limit INTEGER NOT NULL CHECK (upload_limit > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);

CREATE TRIGGER IF NOT EXISTS cloud_upload_reservation_daily_guard
BEFORE INSERT ON cloud_upload_reservations
BEGIN
  SELECT RAISE(ABORT, 'daily_upload_limit_exceeded')
  WHERE (
    SELECT upload_count + 1 > upload_limit
    FROM cloud_daily_usage
    WHERE day = NEW.upload_day
  );

  SELECT RAISE(ABORT, 'user_daily_upload_limit_exceeded')
  WHERE (
    SELECT upload_count + 1 > upload_limit
    FROM cloud_user_daily_usage
    WHERE day = NEW.upload_day AND user_id = NEW.user_id
  );
END;

CREATE TRIGGER IF NOT EXISTS cloud_upload_reservation_daily_counted
AFTER INSERT ON cloud_upload_reservations
BEGIN
  UPDATE cloud_daily_usage
  SET upload_count = upload_count + 1,
      updated_at = NEW.created_at
  WHERE day = NEW.upload_day;

  UPDATE cloud_user_daily_usage
  SET upload_count = upload_count + 1,
      updated_at = NEW.created_at
  WHERE day = NEW.upload_day AND user_id = NEW.user_id;
END;
