import transcriber
import openrouter
from models import Transcript


async def test_transcribe_wraps_pcm_as_wav_and_returns_transcript(monkeypatch):
    seen = {}

    async def fake_transcribe(wav_bytes, model, language=None):
        seen["wav"] = wav_bytes
        seen["language"] = language
        return "goedemorgen"

    monkeypatch.setattr(openrouter, "transcribe", fake_transcribe)
    out = await transcriber.transcribe(b"\x00\x00" * 320, lang="nl")
    assert isinstance(out, Transcript)
    assert out.text == "goedemorgen" and out.lang == "nl"
    assert seen["wav"][:4] == b"RIFF" and seen["wav"][8:12] == b"WAVE"
    assert seen["language"] == "nl"
