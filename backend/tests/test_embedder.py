# tests/test_embedder.py
import pytest
from claudia import embedder
from claudia.embedder import embed, DIMS, MODEL_ID


def _capture(captured, vectors):
    async def fake_embeddings(inputs, model):
        captured["inputs"] = inputs
        captured["model"] = model
        return vectors
    return fake_embeddings


async def test_embed_applies_passage_prefix_and_sends_model(monkeypatch):
    captured = {}
    monkeypatch.setattr(embedder.openrouter, "embeddings",
                        _capture(captured, [[0.1] * DIMS]))

    out = await embed(["meer"], "passage")
    assert captured["inputs"] == ["passage: meer"]
    assert captured["model"] == MODEL_ID
    assert len(out) == 1 and len(out[0]) == DIMS


async def test_embed_applies_query_prefix(monkeypatch):
    captured = {}
    monkeypatch.setattr(embedder.openrouter, "embeddings",
                        _capture(captured, [[0.0] * DIMS]))

    await embed(["water"], "query")
    assert captured["inputs"] == ["query: water"]


async def test_embed_preserves_input_order_for_batches(monkeypatch):
    async def fake_embeddings(inputs, model):
        return [[float(i)] * DIMS for i, _ in enumerate(inputs)]

    monkeypatch.setattr(embedder.openrouter, "embeddings", fake_embeddings)
    out = await embed(["a", "b", "c"], "passage")
    assert [v[0] for v in out] == [0.0, 1.0, 2.0]


async def test_embed_rejects_bad_kind(monkeypatch):
    async def fake_embeddings(inputs, model):
        return []

    monkeypatch.setattr(embedder.openrouter, "embeddings", fake_embeddings)
    with pytest.raises(ValueError):
        await embed(["x"], "document")


async def test_embed_rejects_wrong_dimension(monkeypatch):
    async def fake_embeddings(inputs, model):
        return [[0.0] * 5]

    monkeypatch.setattr(embedder.openrouter, "embeddings", fake_embeddings)
    with pytest.raises(ValueError):
        await embed(["x"], "passage")
