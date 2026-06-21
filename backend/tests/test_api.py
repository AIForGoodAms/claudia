import pytest
from fastapi.testclient import TestClient
from claudia import api
from claudia import option_generator
from claudia import translator
from claudia.models import Candidate, SymbolCard


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(api, "_open_conn", lambda: conn)   # share the in-memory DB

    async def fake_generate(context, persona, history, n, lang):
        return [Candidate(text="ja graag", glosses=["ja"]),
                Candidate(text="nee", glosses=["nee"])]

    async def fake_to_symbols(connection, glosses, lang, threshold):
        return [SymbolCard(id=1, label=g, image_url=f"/media/{g}.png",
                           confidence=0.9, as_text=False) for g in glosses]

    monkeypatch.setattr(option_generator, "generate", fake_generate)
    monkeypatch.setattr(translator, "to_symbols", fake_to_symbols)
    return TestClient(api.app)


def test_options_then_select_speaks(client):
    res = client.post("/expressive/options", json={"text": "wil je koffie?", "lang": "nl"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["options"]) == 2
    assert body["options"][0]["text"] == "ja graag"
    assert body["options"][0]["symbols"][0]["image_url"] == "/media/ja.png"

    chosen = body["options"][0]
    sel = client.post("/expressive/select", json={
        "interaction_id": body["interaction_id"], "option_id": chosen["option_id"]})
    assert sel.status_code == 200
    assert sel.json() == {"text": "ja graag", "lang": "nl"}


def test_select_unknown_returns_404(client):
    res = client.post("/expressive/select",
                      json={"interaction_id": 999, "option_id": 999})
    assert res.status_code == 404


def test_options_fall_back_to_defaults_when_no_symbols(conn, monkeypatch):
    from claudia import db, embedder
    sid = db.insert_symbol(conn, source="arasaac", external_id="dont-understand",
                           image_path="media/help.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang="nl", label="ik begrijp het niet",
                   description="uitleg", vector=db.pack_vector([0.0] * embedder.DIMS),
                   model=embedder.MODEL_TAG)
    monkeypatch.setattr(api, "_open_conn", lambda: conn)

    async def fake_generate(context, persona, history, n, lang):
        return [Candidate(text="iets", glosses=["onbekend"])]

    async def fake_to_symbols(connection, glosses, lang, threshold):    # nothing matches
        return [SymbolCard(id=-1, label=g, image_url=None, confidence=0.0, as_text=True)
                for g in glosses]

    monkeypatch.setattr(option_generator, "generate", fake_generate)
    monkeypatch.setattr(translator, "to_symbols", fake_to_symbols)
    res = TestClient(api.app).post("/expressive/options", json={"text": "?", "lang": "nl"})
    body = res.json()
    assert body["options"][0]["text"] == "ik begrijp het niet"
    assert body["options"][0]["symbols"][0]["as_text"] is False
