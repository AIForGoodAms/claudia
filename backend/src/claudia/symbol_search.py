import numpy as np
from claudia import db
from claudia import embedder
from claudia.models import Match


def _cosine(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    query_norm = query / (np.linalg.norm(query) + 1e-9)
    row_norms = np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9
    return (matrix / row_norms) @ query_norm


async def search_many(conn, texts: list[str], k: int, lang: str) -> list[list[Match]]:
    """Nearest symbols for several queries in one embedding round-trip.

    Each remote embedding call dominates latency, so proposing a board (every
    gloss of every option) embeds all queries together and scans the symbol
    matrix — built once — per query in-process.
    """
    texts = list(texts)
    rows = conn.execute(
        "SELECT t.symbol_id, t.label, s.image_path, t.vector "
        "FROM symbol_terms t JOIN symbols s ON s.id = t.symbol_id "
        "WHERE t.lang = ?", (lang,)).fetchall()
    if not rows or not texts:
        return [[] for _ in texts]

    vectors = await embedder.embed(texts, "query")
    matrix = np.vstack([np.asarray(db.unpack_vector(r["vector"]), dtype=np.float32)
                        for r in rows])

    results = []
    for vector in vectors:
        scores = _cosine(np.asarray(vector, dtype=np.float32), matrix)
        order = np.argsort(scores)[::-1][:k]
        results.append([Match(symbol_id=rows[i]["symbol_id"], label=rows[i]["label"],
                              image_path=rows[i]["image_path"], score=float(scores[i]))
                        for i in order])
    return results


async def search(conn, text: str, k: int, lang: str) -> list[Match]:
    return (await search_many(conn, [text], k, lang))[0]
