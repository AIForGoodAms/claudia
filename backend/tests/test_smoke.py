# tests/test_smoke.py
import os
import httpx
import pytest
from claudia import db
from claudia import embedder
from claudia.indexing import seed

LIVE = os.environ.get("OPENROUTER_API_KEY")


@pytest.mark.skipif(not LIVE, reason="set OPENROUTER_API_KEY to run the live smoke test")
def test_live_seed_two_words(tmp_path):
    conn = db.connect(":memory:")
    db.create_schema(conn)
    with httpx.Client(timeout=60) as client:
        for word in ("water", "eten"):
            status = seed.seed_one(conn, word, tmp_path, client=client,
                                   embed_fn=embedder.embed, now="t0")
            assert status == "seeded"
    rows = conn.execute(
        "SELECT length(vector) FROM symbol_terms").fetchall()
    assert rows and all(length == embedder.DIMS * 4 for (length,) in rows)
