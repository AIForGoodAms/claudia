import translator
import symbol_search
import openrouter
from models import Match


async def test_to_symbols_picks_best_above_threshold(conn, monkeypatch):
    async def fake_search(connection, text, k, lang):
        return [Match(symbol_id=7, label=text, image_path=f"media/{text}.png", score=0.8)]

    monkeypatch.setattr(symbol_search, "search", fake_search)
    cards = await translator.to_symbols(conn, ["koffie"], lang="nl", threshold=0.3)
    assert cards[0].id == 7 and cards[0].as_text is False
    assert cards[0].image_url == "/media/koffie.png"


async def test_to_symbols_below_threshold_renders_text(conn, monkeypatch):
    async def fake_search(connection, text, k, lang):
        return [Match(symbol_id=7, label="koffie", image_path="media/koffie.png", score=0.1)]

    monkeypatch.setattr(symbol_search, "search", fake_search)
    cards = await translator.to_symbols(conn, ["koffie"], lang="nl", threshold=0.3)
    assert cards[0].as_text is True and cards[0].image_url is None
    assert cards[0].label == "koffie"


async def test_glossify_returns_core_words(monkeypatch):
    async def fake_chat(messages, model, temperature=0.7, response_format=None):
        return '{"glosses": ["ik", "wil", "koffie"]}'

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    assert await translator.glossify("ik wil graag koffie", "nl") == ["ik", "wil", "koffie"]


def _add_core(conn, label, image_path="help.png", lang="nl"):
    import db, embedder
    sid = db.insert_symbol(conn, source="arasaac", external_id=label,
                           image_path=f"media/{image_path}", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang=lang, label=label, description=label,
                   vector=db.pack_vector([0.0] * embedder.DIMS), model=embedder.MODEL_TAG)


def test_core_symbols_returns_seeded_core(conn):
    _add_core(conn, "help")
    cards = translator.core_symbols(conn, "nl")
    assert [c.label for c in cards] == ["help"]
    assert cards[0].image_url == "/media/help.png" and cards[0].as_text is False


def test_default_symbol_options_use_core_when_present(conn):
    _add_core(conn, "ik begrijp het niet")
    texts, card_lists = translator.default_symbol_options(conn, "nl")
    assert texts == ["ik begrijp het niet"]
    assert card_lists[0][0].as_text is False


def test_default_symbol_options_fall_back_to_dont_understand(conn):
    texts, card_lists = translator.default_symbol_options(conn, "nl")   # empty dictionary
    assert texts == ["Ik begrijp het niet, leg het uit"]
    assert card_lists[0][0].as_text is True and card_lists[0][0].image_url is None
