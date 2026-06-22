"""Option proposal must embed every gloss in one batched call.

Regression: `to_symbols` embedded each gloss with its own remote `/embeddings`
round-trip, so proposing 5 options × several glosses made ~20 sequential network
calls and took ~50s — the WebSocket client gave up before any images arrived.
"""
from claudia import symbol_search
from claudia import translator
from claudia import embedder
from claudia import db


def _add_symbol(conn, label, vector, lang="nl"):
    sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                           image_path=f"media/{label}.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang=lang, label=label,
                   description=f"{label} desc", vector=db.pack_vector(vector),
                   model=embedder.MODEL_TAG)
    return sid


async def test_search_many_resolves_each_query_in_one_embed_call(conn, monkeypatch):
    _add_symbol(conn, "koffie", [1.0, 0.0, 0.0])
    _add_symbol(conn, "thee", [0.0, 1.0, 0.0])

    calls = []

    def fake_embed(texts, kind):
        calls.append(list(texts))
        return [[1.0, 0.0, 0.0] if t.endswith("koffie") else [0.0, 1.0, 0.0]
                for t in texts]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    results = await symbol_search.search_many(conn, ["koffie", "thee"], k=1, lang="nl")

    assert len(calls) == 1                      # one round-trip for both queries
    assert [m[0].label for m in results] == ["koffie", "thee"]


async def test_to_symbols_batch_embeds_all_glosses_once(conn, monkeypatch):
    _add_symbol(conn, "koffie", [1.0, 0.0, 0.0])

    calls = []

    def fake_embed(texts, kind):
        calls.append(list(texts))
        return [[1.0, 0.0, 0.0] for _ in texts]

    monkeypatch.setattr(embedder, "embed", fake_embed)
    gloss_lists = [["ik", "wil", "koffie"], ["nee", "dank"]]
    card_lists = await translator.to_symbols_batch(conn, gloss_lists, lang="nl",
                                                   threshold=0.3)

    assert len(calls) == 1                      # 5 glosses, one embedding call
    assert [len(cards) for cards in card_lists] == [3, 2]
