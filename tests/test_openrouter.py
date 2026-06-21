import json
import httpx
import openrouter


def _client_with(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler),
                             base_url="https://openrouter.ai/api/v1")


async def test_chat_returns_message_content(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/chat/completions")
        assert json.loads(request.content)["model"] == "z-ai/glm-5.2"
        return httpx.Response(200, json={"choices": [{"message": {"content": "hallo"}}]})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.chat([{"role": "user", "content": "hi"}], model="z-ai/glm-5.2")
    assert out == "hallo"


async def test_transcribe_returns_text(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/audio/transcriptions")
        return httpx.Response(200, json={"text": "goedemorgen"})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.transcribe(b"RIFF....", model="nvidia/parakeet-tdt-0.6b-v3")
    assert out == "goedemorgen"
