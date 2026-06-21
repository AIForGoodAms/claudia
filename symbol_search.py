import asyncio
import numpy as np
import db
import embedder
from models import Match


def _cosine(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    query_norm = query / (np.linalg.norm(query) + 1e-9)
    row_norms = np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9
    return (matrix / row_norms) @ query_norm


async def search(conn, text: str, k: int, lang: str) -> list[Match]:
    rows = conn.execute(
        "SELECT t.symbol_id, t.label, s.image_path, t.vector "
        "FROM symbol_terms t JOIN symbols s ON s.id = t.symbol_id "
        "WHERE t.lang = ?", (lang,)).fetchall()
    if not rows:
        return []

    # embedder.embed is synchronous (seeding plan); keep the event loop free.
    vectors = await asyncio.to_thread(embedder.embed, [text], "query")
    query_vec = np.asarray(vectors[0], dtype=np.float32)
    matrix = np.vstack([np.asarray(db.unpack_vector(r["vector"]), dtype=np.float32)
                        for r in rows])
    scores = _cosine(query_vec, matrix)

    order = np.argsort(scores)[::-1][:k]
    return [Match(symbol_id=rows[i]["symbol_id"], label=rows[i]["label"],
                  image_path=rows[i]["image_path"], score=float(scores[i]))
            for i in order]
