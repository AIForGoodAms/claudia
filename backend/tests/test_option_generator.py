import json
from claudia import option_generator
from claudia import openrouter
from claudia.models import Persona, Pick


async def test_generate_parses_candidates(monkeypatch):
    captured = {}

    async def fake_chat(messages, model, temperature=0.7, response_format=None):
        captured["messages"] = messages
        captured["model"] = model
        return json.dumps({"options": [
            {"text": "ja graag", "glosses": ["ja", "graag"]},
            {"text": "nee dank je", "glosses": ["nee", "dank"]},
        ]})

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    out = await option_generator.generate(
        context="wil je koffie?",
        persona=Persona(profile="warm, direct"),
        history=[Pick(context_text="hoe gaat het?", selected_text="goed")],
        n=2, lang="nl")

    assert captured["model"] == "z-ai/glm-5.2"
    assert [c.text for c in out] == ["ja graag", "nee dank je"]
    assert out[0].glosses == ["ja", "graag"]
    prompt = " ".join(m["content"] for m in captured["messages"])
    assert "warm, direct" in prompt and "wil je koffie?" in prompt and "goed" in prompt


async def test_generate_tolerates_markdown_fenced_json(monkeypatch):
    # glm-5.2 sometimes wraps its reply in a ```json fence despite json_object mode.
    async def fenced_chat(messages, model, temperature=0.7, response_format=None):
        return '```json\n{"options": [{"text": "ja", "glosses": ["ja"]}]}\n```'

    monkeypatch.setattr(openrouter, "chat", fenced_chat)
    out = await option_generator.generate(
        context="wil je koffie?", persona=Persona(profile="warm"), history=[], n=1, lang="nl")
    assert [c.text for c in out] == ["ja"]
