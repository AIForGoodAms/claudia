import json
from datetime import datetime, timezone
from models import Persona, Pick


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load(conn) -> Persona:
    row = conn.execute(
        "SELECT profile, reading_level FROM persona ORDER BY id LIMIT 1").fetchone()
    if row is None:
        return Persona(profile="", reading_level=None)
    return Persona(profile=row["profile"], reading_level=row["reading_level"])


def recent(conn, n: int) -> list[Pick]:
    rows = conn.execute(
        "SELECT i.context_text AS ctx, o.text AS sel "
        "FROM interactions i JOIN options o ON o.interaction_id = i.id "
        "WHERE o.was_selected = 1 ORDER BY i.id DESC LIMIT ?", (n,)).fetchall()
    return [Pick(context_text=r["ctx"], selected_text=r["sel"]) for r in rows]


def log_interaction(conn, lang, context_type, context_text,
                    audio_path=None, asr_model=None) -> int:
    cursor = conn.execute(
        "INSERT INTO interactions(ts, lang, context_type, context_text, "
        "context_audio_path, asr_model) VALUES (?, ?, ?, ?, ?, ?)",
        (_now_iso(), lang, context_type, context_text, audio_path, asr_model))
    conn.commit()
    return cursor.lastrowid


def save_options(conn, interaction_id, rows) -> list[int]:
    ids = []
    for row in rows:
        cursor = conn.execute(
            "INSERT INTO options(interaction_id, rank, text, glosses, symbol_sequence) "
            "VALUES (?, ?, ?, ?, ?)",
            (interaction_id, row["rank"], row["text"],
             json.dumps(row["glosses"]), json.dumps(row["symbol_sequence"])))
        ids.append(cursor.lastrowid)
    conn.commit()
    return ids


def mark_selected(conn, interaction_id, option_id) -> str:
    row = conn.execute(
        "SELECT text FROM options WHERE id = ? AND interaction_id = ?",
        (option_id, interaction_id)).fetchone()
    if row is None:
        raise KeyError((interaction_id, option_id))
    conn.execute("UPDATE options SET was_selected = 1 WHERE id = ?", (option_id,))
    conn.commit()
    return row["text"]
