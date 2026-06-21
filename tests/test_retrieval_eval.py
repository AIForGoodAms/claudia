import json
from pathlib import Path
import symbol_search
import embedder
import db

FIXTURE = Path(__file__).parent / "fixtures" / "recall_set.json"

_VECTORS = {"koffie": [1.0, 0.0, 0.0], "meer": [0.0, 1.0, 0.0], "coffee": [1.0, 0.0, 0.0]}
_QUERY_VECTORS = {
    "ik wil koffie": [0.95, 0.05, 0.0], "nog een keer": [0.0, 0.98, 0.02],
    "i want coffee": [0.97, 0.0, 0.0],
}


def _seed(conn):
    for label, vec in _VECTORS.items():
        lang = "en" if label == "coffee" else "nl"
        sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                               image_path=f"media/{label}.png", is_core=1, created_at="t0")
        db.insert_term(conn, symbol_id=sid, lang=lang, label=label, description=label,
                       vector=db.pack_vector(vec), model=embedder.MODEL_TAG)


async def test_recall_at_1_is_perfect_on_fixture(conn, monkeypatch):
    _seed(conn)

    def fake_embed(texts, kind):
        return [_QUERY_VECTORS[texts[0]]]

    monkeypatch.setattr(embedder, "embed", fake_embed)

    cases = json.loads(FIXTURE.read_text())
    hits = 0
    for case in cases:
        matches = await symbol_search.search(conn, case["query"], k=1, lang=case["lang"])
        if matches and matches[0].label == case["expected_label"]:
            hits += 1
    assert hits / len(cases) == 1.0          # tighten/extend the fixture as real vectors land
