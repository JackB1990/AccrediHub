CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  default_weeks INTEGER,
  updated_at TEXT
);
INSERT INTO profile (id) VALUES (1);

-- Small key/value store (password hash, session version).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
