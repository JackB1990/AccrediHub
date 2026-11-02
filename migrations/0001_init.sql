-- AccrediHub schema (SQLite). Timestamps are ISO-8601 UTC strings, dates are YYYY-MM-DD.

CREATE TABLE artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bio TEXT,
  photo_url TEXT,
  location TEXT,
  year_formed INTEGER,
  year_split INTEGER,
  is_ai_artist INTEGER NOT NULL DEFAULT 0,
  is_profile_complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_artists_name_lower ON artists (lower(name));

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  album_name TEXT,
  album_art_url TEXT,
  release_date TEXT,
  navidrome_song_id TEXT,
  navidrome_album_id TEXT,
  navidrome_checked_at TEXT,
  navidrome_only INTEGER NOT NULL DEFAULT 0,
  track_number INTEGER,
  disc_number INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tracks_artist_id ON tracks(artist_id);
CREATE INDEX idx_tracks_release_date ON tracks(release_date);
CREATE INDEX idx_tracks_title_lower ON tracks (lower(title));
CREATE INDEX idx_tracks_navidrome_checked_at ON tracks (navidrome_checked_at);
CREATE INDEX idx_tracks_navidrome_only ON tracks (navidrome_only);
CREATE INDEX idx_tracks_navidrome_song_id ON tracks (navidrome_song_id);

CREATE TABLE tour_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  venue TEXT,
  city TEXT,
  ticket_url TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','applied','awaiting','approved','denied')),
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tour_dates_artist_id ON tour_dates(artist_id);
CREATE INDEX idx_tour_dates_event_date ON tour_dates(event_date);

-- Single-user app: user_id columns default to the one admin account.
CREATE TABLE favourites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'admin',
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, track_id)
);

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'admin',
  name TEXT NOT NULL,
  show_date TEXT,
  theme TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'admin',
  position INTEGER NOT NULL DEFAULT 0,
  item_type TEXT NOT NULL DEFAULT 'track',
  track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  note_title TEXT,
  note_body TEXT,
  category TEXT,
  artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_playlist_items_playlist_id ON playlist_items(playlist_id);

CREATE TABLE play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'admin',
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_play_history_track_id ON play_history(track_id);

CREATE TABLE tour_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'admin',
  tour_date_id INTEGER NOT NULL REFERENCES tour_dates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, tour_date_id)
);
CREATE INDEX idx_tour_attendance_tour_date_id ON tour_attendance(tour_date_id);

-- Song themes ("what the song is about"): a reusable vocabulary + join table.
CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_themes_name_lower ON themes (lower(name));

CREATE TABLE track_themes (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (track_id, theme_id)
);
CREATE INDEX idx_track_themes_theme_id ON track_themes(theme_id);

-- Local cache of the whole Navidrome library, used for matching.
CREATE TABLE navidrome_library (
  song_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  artist_id TEXT,
  album_id TEXT,
  cover_art TEXT,
  track_number INTEGER,
  disc_number INTEGER,
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_navidrome_library_title ON navidrome_library (lower(title));

CREATE TABLE navidrome_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phase TEXT NOT NULL DEFAULT 'idle',
  artist_ids TEXT,
  artist_cursor INTEGER NOT NULL DEFAULT 0,
  run_started_at TEXT,
  last_completed_at TEXT,
  last_result TEXT
);
INSERT INTO navidrome_sync_state (id) VALUES (1);

CREATE TABLE tour_discovery_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phase TEXT NOT NULL DEFAULT 'idle',
  artist_ids TEXT,
  artist_cursor INTEGER NOT NULL DEFAULT 0,
  found_so_far INTEGER NOT NULL DEFAULT 0,
  run_started_at TEXT,
  last_completed_at TEXT,
  last_result TEXT
);
INSERT INTO tour_discovery_state (id) VALUES (1);

-- PR agencies / contacts.
CREATE TABLE pr_agencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_pr_agencies_company_lower ON pr_agencies (lower(company));

CREATE TABLE pr_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES pr_agencies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_pr_contacts_agency_id ON pr_contacts(agency_id);
CREATE UNIQUE INDEX idx_pr_contacts_agency_name_lower ON pr_contacts (agency_id, lower(name));

CREATE TABLE artist_pr_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  agency_id INTEGER NOT NULL REFERENCES pr_agencies(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES pr_contacts(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_artist_pr_contacts_artist_id ON artist_pr_contacts(artist_id);
CREATE INDEX idx_artist_pr_contacts_agency_id ON artist_pr_contacts(agency_id);
