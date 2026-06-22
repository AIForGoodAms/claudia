# embedder.py
from claudia import openrouter

MODEL_ID = "intfloat/multilingual-e5-large"
DIMS = 1024
MODEL_TAG = f"{MODEL_ID}@{DIMS}"


def _prefix(kind):
    if kind not in ("passage", "query"):
        raise ValueError(f"kind must be 'passage' or 'query', got {kind!r}")
    return f"{kind}: "


async def embed(texts, kind):
    inputs = [_prefix(kind) + t for t in texts]
    vectors = await openrouter.embeddings(inputs, MODEL_ID)
    for vector in vectors:
        if len(vector) != DIMS:
            raise ValueError(f"expected {DIMS}-d vector, got {len(vector)}")
    return vectors


def embed_sync(texts, kind):
    """For offline scripts (seeding) that aren't running an event loop."""
    import asyncio
    return asyncio.run(embed(texts, kind))
