# embedder.py
import os
import httpx

MODEL_ID = "intfloat/multilingual-e5-large"
DIMS = 1024
MODEL_TAG = f"{MODEL_ID}@{DIMS}"
BASE_URL = "https://openrouter.ai/api/v1"


def _prefix(kind):
    if kind not in ("passage", "query"):
        raise ValueError(f"kind must be 'passage' or 'query', got {kind!r}")
    return f"{kind}: "


def embed(texts, kind, *, client=None):
    inputs = [_prefix(kind) + t for t in texts]
    owns_client = client is None
    if owns_client:
        key = os.environ["OPENROUTER_API_KEY"]
        client = httpx.Client(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {key}"},
            timeout=60,
        )
    try:
        response = client.post("/embeddings", json={"model": MODEL_ID, "input": inputs})
        response.raise_for_status()
        vectors = [row["embedding"] for row in response.json()["data"]]
    finally:
        if owns_client:
            client.close()
    for vector in vectors:
        if len(vector) != DIMS:
            raise ValueError(f"expected {DIMS}-d vector, got {len(vector)}")
    return vectors
