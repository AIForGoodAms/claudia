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


def _card_for(gloss, matches, threshold) -> SymbolCard:
    best = matches[0] if matches else None
    if best is not None and best.score >= threshold:
        return SymbolCard(id=best.symbol_id, label=best.label,
                          image_url=image_url_for(best.image_path),
                          confidence=best.score, as_text=False)
    return SymbolCard(id=(best.symbol_id if best else -1), label=gloss,
                      image_url=None,
                      confidence=(best.score if best else 0.0), as_text=True)


async def to_symbols_batch(conn, gloss_lists, lang, threshold) -> list[list[SymbolCard]]:
    """Resolve symbol cards for several gloss lists in one embedding round-trip.

    Flattens every gloss across the lists into a single batched search, then
    re-splits the cards back into one list per input — so a whole board costs
    one remote call instead of one per gloss.
    """
    flat = [gloss for glosses in gloss_lists for gloss in glosses]
    if not flat:
        return [[] for _ in gloss_lists]
    matches = await symbol_search.search_many(conn, flat, k=1, lang=lang)
    cards = [_card_for(gloss, m, threshold) for gloss, m in zip(flat, matches)]

    out, start = [], 0
    for glosses in gloss_lists:
        out.append(cards[start:start + len(glosses)])
        start += len(glosses)
    return out


async def to_symbols(conn, glosses, lang, threshold) -> list[SymbolCard]:
    return (await to_symbols_batch(conn, [glosses], lang, threshold))[0]


async def glossify(text: str, lang: str) -> list[str]:
    messages = [
        {"role": "system", "content": _GLOSSIFY_SYSTEM},
        {"role": "user", "content": f"Language: {lang}\nText: {text}"},
    ]
    content = await openrouter.chat(messages, model=config.MODEL_LLM,
                                    response_format={"type": "json_object"})
    return json.loads(content)["glosses"]
