# tests/test_seed.py
import httpx
import db
from indexing import seed


def fake_embed(texts, kind):
    assert kind == "passage"
    return [[float(len(texts[0]))] * 1024]


def arasaac_client():
    routes = {
        "/v1/pictograms/nl/search/meer": [{"_id": 2349, "keywords": [
            {"keyword": "meer", "meaning": "een grotere hoeveelheid"}]}],
        "/v1/pictograms/en/2349": {"_id": 2349, "keywords": [{"keyword": "more"}]},
    }

    def handler(request):
        path = request.url.path
        if path.endswith("_300.png"):
            return httpx.Response(200, content=b"PNG")
        if path == "/v1/pictograms/nl/search/onbekendwoord":
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json=routes[path])

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_load_words_ignores_comments_and_blanks(tmp_path):
    f = tmp_path / "words.txt"
    f.write_text("# header\n\nik\n  meer  \n", encoding="utf-8")
    assert seed.load_words(f) == ["ik", "meer"]


def test_resolve_returns_none_on_404():
    assert seed.resolve("onbekendwoord", client=arasaac_client()) is None


def test_seed_one_seeds_symbol_image_and_terms(tmp_path):
    conn = db.connect(":memory:")
    db.create_schema(conn)
    status = seed.seed_one(conn, "meer", tmp_path, client=arasaac_client(),
                           embed_fn=fake_embed, now="t0")
    assert status == "seeded"
    assert db.symbol_exists(conn, "2349")
    langs = [r[0] for r in conn.execute(
        "SELECT lang FROM symbol_terms ORDER BY lang")]
    assert langs == ["en", "nl"]
    vlen = conn.execute(
        "SELECT length(vector) FROM symbol_terms LIMIT 1").fetchone()[0]
    assert vlen == 1024 * 4
    assert (tmp_path / "2349.png").read_bytes() == b"PNG"


def test_seed_one_is_idempotent(tmp_path):
    conn = db.connect(":memory:")
    db.create_schema(conn)
    seed.seed_one(conn, "meer", tmp_path, client=arasaac_client(),
                  embed_fn=fake_embed, now="t0")
    status = seed.seed_one(conn, "meer", tmp_path, client=arasaac_client(),
                           embed_fn=fake_embed, now="t0")
    assert status == "skipped"
    count = conn.execute("SELECT COUNT(*) FROM symbol_terms").fetchone()[0]
    assert count == 2  # not 4
