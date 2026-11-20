-- JUP LIFE filament shelf (Cloudflare D1)
CREATE TABLE IF NOT EXISTS filaments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  hex        TEXT NOT NULL DEFAULT '',
  used_in    TEXT NOT NULL DEFAULT '',
  grp        TEXT NOT NULL DEFAULT 'Other',
  sort       INTEGER NOT NULL DEFAULT 99,
  clear      INTEGER NOT NULL DEFAULT 0,
  full       INTEGER,            -- sealed spools on the shelf; NULL = not counted
  partial_g  REAL,               -- grams left on open spools; NULL = not counted
  material   TEXT NOT NULL DEFAULT '',
  brand      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id       TEXT PRIMARY KEY,
  supplier TEXT NOT NULL,
  what     TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  price    REAL NOT NULL,          -- $ per spool
  size_g   REAL NOT NULL DEFAULT 1000,
  min_qty  INTEGER,
  expires  TEXT,                   -- YYYY-MM-DD
  link     TEXT NOT NULL DEFAULT '',
  notes    TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v REAL NOT NULL
);

-- every gram taken off the shelf by a print, from the page or an automation
CREATE TABLE IF NOT EXISTS usage_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filament_id TEXT NOT NULL,
  grams       REAL NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS usage_by_filament ON usage_log (filament_id, at);

INSERT OR IGNORE INTO settings (k, v) VALUES ('spoolG', 1000), ('lowSpools', 1), ('targetSpools', 3);
