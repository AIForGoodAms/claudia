import pytest
from claudia import persona


def test_load_returns_profile(conn):
    conn.execute("INSERT INTO persona(id, profile, reading_level, updated_at) "
                 "VALUES (1, 'warm, direct', 'simple', '2026-06-21')")
    conn.commit()
    p = persona.load(conn)
    assert p.profile == "warm, direct" and p.reading_level == "simple"


def test_log_and_recent_roundtrip(conn):
    iid = persona.log_interaction(conn, "nl", "audio", "wil je koffie?", asr_model="x")
    ids = persona.save_options(conn, iid, [
        {"rank": 0, "text": "ja graag", "glosses": ["ja"], "symbol_sequence": [1]},
        {"rank": 1, "text": "nee dank je", "glosses": ["nee"], "symbol_sequence": [2]},
    ])
    assert persona.mark_selected(conn, iid, ids[0]) == "ja graag"
    picks = persona.recent(conn, n=5)
    assert picks[0].context_text == "wil je koffie?"
    assert picks[0].selected_text == "ja graag"


def test_mark_selected_unknown_raises(conn):
    iid = persona.log_interaction(conn, "nl", "audio", "x")
    with pytest.raises(KeyError):
        persona.mark_selected(conn, iid, 999)
