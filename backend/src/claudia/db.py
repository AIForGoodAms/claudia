import sqlite3
import struct

SCHEMA = """
CREATE TABLE IF NOT EXISTS symbols (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,
  external_id  TEXT UNIQUE,
  image_path   TEXT NOT NULL,
  is_core      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS symbol_terms (
  symbol_id            INTEGER NOT NULL REFERENCES symbols(id),
  lang                 TEXT NOT NULL,
  label                TEXT NOT NULL,
  description          TEXT NOT NULL,
  enriched_description TEXT,
  vector               BLOB NOT NULL,
  model                TEXT NOT NULL,
  PRIMARY KEY (symbol_id, lang)
);
"""


def connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def create_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def pack_vector(vec):
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_vector(blob):
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def symbol_exists(conn, external_id):
    row = conn.execute(
        "SELECT 1 FROM symbols WHERE external_id = ?", (external_id,)).fetchone()
    return row is not None


def insert_symbol(conn, *, source, external_id, image_path, is_core, created_at):
    cursor = conn.execute(
        "INSERT INTO symbols (source, external_id, image_path, is_core, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (source, external_id, image_path, is_core, created_at),
    )
    return cursor.lastrowid


def insert_term(conn, *, symbol_id, lang, label, description, vector, model):
    conn.execute(
        "INSERT INTO symbol_terms "
        "(symbol_id, lang, label, description, vector, model) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (symbol_id, lang, label, description, vector, model),
    )
