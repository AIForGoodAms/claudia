# tests/test_arasaac.py
import httpx
from claudia.indexing import arasaac


def client_for(routes):
    def handler(request):
        body, status = routes[request.url.path]
        if isinstance(body, bytes):
            return httpx.Response(status, content=body)
        return httpx.Response(status, json=body)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_search_returns_pictogram_list():
    routes = {"/v1/pictograms/nl/search/meer": ([{"_id": 2349, "keywords": [
        {"keyword": "meer", "meaning": "een grotere hoeveelheid"}]}], 200)}
    results = arasaac.search("meer", "nl", client=client_for(routes))
    assert results[0]["_id"] == 2349


def test_pictogram_fetches_by_id():
    routes = {"/v1/pictograms/en/2349": ({"_id": 2349, "keywords": [
        {"keyword": "more"}]}, 200)}
    picto = arasaac.pictogram(2349, "en", client=client_for(routes))
    assert picto["keywords"][0]["keyword"] == "more"


def test_extract_terms_pulls_keywords_and_first_meaning():
    picto = {"keywords": [
        {"keyword": "meer"},
        {"keyword": "nog", "meaning": "een grotere hoeveelheid"},
    ]}
    keywords, meaning = arasaac.extract_terms(picto)
    assert keywords == ["meer", "nog"]
    assert meaning == "een grotere hoeveelheid"


def test_extract_terms_meaning_is_none_when_absent():
    keywords, meaning = arasaac.extract_terms({"keywords": [{"keyword": "meer"}]})
    assert keywords == ["meer"] and meaning is None


def test_download_image_writes_bytes(tmp_path):
    routes = {"/pictograms/2349/2349_300.png": (b"\x89PNGdata", 200)}
    dest = tmp_path / "2349.png"
    arasaac.download_image(2349, dest, client=client_for(routes))
    assert dest.read_bytes() == b"\x89PNGdata"
