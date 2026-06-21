import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS interactions (
  id                 INTEGER PRIMARY KEY,
  ts                 TEXT NOT NULL,
  lang               TEXT NOT NULL,
  context_type       TEXT NOT NULL,
  context_text       TEXT NOT NULL,
  context_audio_path TEXT,
  asr_model          TEXT
);
CREATE TABLE IF NOT EXISTS options (
  id              INTEGER PRIMARY KEY,
  interaction_id  INTEGER NOT NULL REFERENCES interactions(id),
  rank            INTEGER NOT NULL,
  text            TEXT NOT NULL,
  glosses         TEXT NOT NULL,
  symbol_sequence TEXT NOT NULL,
  was_selected    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS persona (
  id            INTEGER PRIMARY KEY,
  profile       TEXT NOT NULL,
  reading_level TEXT,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def create_schema(conn) -> None:
    conn.executescript(SCHEMA)
    for key, value in config.DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def get_setting(conn, key: str) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is not None:
        return row["value"] if hasattr(row, "keys") else row[0]
    return config.DEFAULT_SETTINGS[key]


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    conn.commit()
