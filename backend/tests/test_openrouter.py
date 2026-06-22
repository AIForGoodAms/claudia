import base64
import json
import httpx
from claudia import openrouter


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


async def test_embeddings_posts_input_and_returns_vectors_in_order(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/embeddings")
        body = json.loads(request.content)
        assert body["model"] == "intfloat/multilingual-e5-large"
        assert body["input"] == ["passage: a", "passage: b"]
        return httpx.Response(200, json={"data": [
            {"embedding": [0.0]}, {"embedding": [1.0]}]})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.embeddings(
        ["passage: a", "passage: b"], model="intfloat/multilingual-e5-large")
    assert out == [[0.0], [1.0]]


async def test_transcribe_posts_base64_json_and_returns_text(monkeypatch):
    def handler(request):
        assert request.url.path.endswith("/audio/transcriptions")
        body = json.loads(request.content)              # JSON body, not multipart
        assert body["model"] == "nvidia/parakeet-tdt-0.6b-v3"
        assert base64.b64decode(body["input_audio"]["data"]) == b"RIFF...."
        assert body["input_audio"]["format"] == "wav"
        assert body["language"] == "nl"
        return httpx.Response(200, json={"text": "goedemorgen"})

    monkeypatch.setattr(openrouter, "_make_client", lambda: _client_with(handler))
    out = await openrouter.transcribe(
        b"RIFF....", model="nvidia/parakeet-tdt-0.6b-v3", language="nl")
    assert out == "goedemorgen"
