# tests/test_embedder.py
import json
import httpx
import pytest
from embedder import embed, DIMS, MODEL_ID


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")


def test_embed_applies_passage_prefix_and_sends_model():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"embedding": [0.1] * DIMS}]})

    out = embed(["meer"], "passage", client=_client(handler))
    assert captured["body"]["input"] == ["passage: meer"]
    assert captured["body"]["model"] == MODEL_ID
    assert len(out) == 1 and len(out[0]) == DIMS


def test_embed_applies_query_prefix():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"embedding": [0.0] * DIMS}]})

    embed(["water"], "query", client=_client(handler))
    assert captured["body"]["input"] == ["query: water"]


def test_embed_preserves_input_order_for_batches():
    def handler(request):
        body = json.loads(request.content)
        data = [{"embedding": [float(i)] * DIMS} for i, _ in enumerate(body["input"])]
        return httpx.Response(200, json={"data": data})

    out = embed(["a", "b", "c"], "passage", client=_client(handler))
    assert [v[0] for v in out] == [0.0, 1.0, 2.0]


def test_embed_rejects_bad_kind():
    with pytest.raises(ValueError):
        embed(["x"], "document", client=_client(lambda r: httpx.Response(200, json={"data": []})))


def test_embed_rejects_wrong_dimension():
    def handler(request):
        return httpx.Response(200, json={"data": [{"embedding": [0.0] * 5}]})

    with pytest.raises(ValueError):
        embed(["x"], "passage", client=_client(handler))
