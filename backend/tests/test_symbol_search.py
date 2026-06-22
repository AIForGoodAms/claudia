from claudia import symbol_search
from claudia import embedder
from claudia import db


def _add_symbol(conn, label, vector, lang="nl"):
    sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                           image_path=f"media/{label}.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang=lang, label=label,
                   description=f"{label} desc", vector=db.pack_vector(vector),
                   model=embedder.MODEL_TAG)
    return sid


async def test_search_returns_nearest_symbol(conn, monkeypatch):
    _add_symbol(conn, "koffie", [1.0, 0.0, 0.0])
    _add_symbol(conn, "thee", [0.0, 1.0, 0.0])

    def fake_embed(texts, kind):              # sync, matches seeding embedder
        assert kind == "query"
        return [[0.9, 0.1, 0.0]]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    matches = await symbol_search.search(conn, "koffie alstublieft", k=1, lang="nl")
    assert len(matches) == 1
    assert matches[0].label == "koffie" and matches[0].score > 0.9


async def test_search_respects_language_filter(conn, monkeypatch):
    _add_symbol(conn, "koffie", [1.0, 0.0, 0.0], lang="nl")
    _add_symbol(conn, "coffee", [1.0, 0.0, 0.0], lang="en")

    def fake_embed(texts, kind):
        return [[1.0, 0.0, 0.0]]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    matches = await symbol_search.search(conn, "coffee", k=5, lang="en")
    assert [m.label for m in matches] == ["coffee"]
