import json
from claudia import openrouter
from claudia import config
from claudia.models import Candidate, Persona, Pick

_SYSTEM = (
    "You generate first-person replies for a non-speaking AAC user. "
    "Reply only as her. Return JSON: "
    '{"options": [{"text": <natural sentence>, "glosses": [<core content words>]}]}. '
    "Glosses are telegraphic core words in the SAME language as text, for symbol lookup."
)


def _user_prompt(context, persona, history, n, lang) -> str:
    lines = [f"Language: {lang}", f"Her persona: {persona.profile}"]
    if persona.reading_level:
        lines.append(f"Reading level: {persona.reading_level}")
    if history:
        lines.append("Recent picks (context -> her reply):")
        lines += [f"- {p.context_text} -> {p.selected_text}" for p in history]
    lines.append(f"Someone just said to her: {context}")
    lines.append(f"Give {n} distinct replies in her voice.")
    return "\n".join(lines)


async def generate(context, persona, history, n, lang) -> list[Candidate]:
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _user_prompt(context, persona, history, n, lang)},
    ]
    content = await openrouter.chat(
        messages, model=config.MODEL_LLM, response_format={"type": "json_object"})
    options = json.loads(content)["options"]
    return [Candidate(text=o["text"], glosses=o["glosses"]) for o in options][:n]
