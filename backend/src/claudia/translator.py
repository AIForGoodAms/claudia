import json
from pathlib import PurePath
from claudia import symbol_search
from claudia import openrouter
from claudia import config
from claudia.models import SymbolCard

_GLOSSIFY_SYSTEM = (
    "Break the text into telegraphic core content words (glosses) for AAC symbol "
    'lookup, same language. Return JSON: {"glosses": [<words>]}.'
)

# Guaranteed phrase she can always say, even before any core symbols are seeded.
_FALLBACK_TEXT = {
    "nl": "Ik begrijp het niet, leg het uit",
    "en": "I don't understand, please explain",
}


def image_url_for(image_path: str) -> str:
    return "/media/" + PurePath(image_path).name


def core_symbols(conn, lang: str) -> list[SymbolCard]:
    rows = conn.execute(
        "SELECT t.symbol_id, t.label, s.image_path "
        "FROM symbol_terms t JOIN symbols s ON s.id = t.symbol_id "
        "WHERE s.is_core = 1 AND t.lang = ? ORDER BY t.symbol_id", (lang,)).fetchall()
    return [SymbolCard(id=row["symbol_id"], label=row["label"],
                       image_url=image_url_for(row["image_path"]),
                       confidence=1.0, as_text=False) for row in rows]


def default_symbol_options(conn, lang: str):
    """Fallback board when no proposed option matched any symbol.

    Each core symbol becomes its own one-symbol option. If the dictionary has no
    core symbols yet, fall back to a single text option so she can always say she
    does not understand.
    """
    cards = core_symbols(conn, lang)
    if cards:
        return [card.label for card in cards], [[card] for card in cards]
    text = _FALLBACK_TEXT.get(lang, _FALLBACK_TEXT["en"])
    return [text], [[SymbolCard(id=-1, label=text, image_url=None,
                                confidence=0.0, as_text=True)]]


async def to_symbols(conn, glosses, lang, threshold) -> list[SymbolCard]:
    cards = []
    for gloss in glosses:
        matches = await symbol_search.search(conn, gloss, k=1, lang=lang)
        best = matches[0] if matches else None
        if best is not None and best.score >= threshold:
            cards.append(SymbolCard(id=best.symbol_id, label=best.label,
                                    image_url=image_url_for(best.image_path),
                                    confidence=best.score, as_text=False))
        else:
            cards.append(SymbolCard(id=(best.symbol_id if best else -1), label=gloss,
                                    image_url=None,
                                    confidence=(best.score if best else 0.0),
                                    as_text=True))
    return cards


async def glossify(text: str, lang: str) -> list[str]:
    messages = [
        {"role": "system", "content": _GLOSSIFY_SYSTEM},
        {"role": "user", "content": f"Language: {lang}\nText: {text}"},
    ]
    content = await openrouter.chat(messages, model=config.MODEL_LLM,
                                    response_format={"type": "json_object"})
    return json.loads(content)["glosses"]
