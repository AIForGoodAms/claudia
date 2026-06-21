# indexing/arasaac.py
from pathlib import Path

BASE_URL = "https://api.arasaac.org/v1"
IMAGE_URL = "https://static.arasaac.org/pictograms/{id}/{id}_300.png"


def search(text, lang, *, client):
    response = client.get(f"{BASE_URL}/pictograms/{lang}/search/{text}")
    response.raise_for_status()
    return response.json()


def pictogram(picto_id, lang, *, client):
    response = client.get(f"{BASE_URL}/pictograms/{lang}/{picto_id}")
    response.raise_for_status()
    return response.json()


def extract_terms(picto):
    keywords = [k["keyword"] for k in picto.get("keywords", []) if k.get("keyword")]
    meaning = next(
        (k["meaning"] for k in picto.get("keywords", []) if k.get("meaning")), None)
    return keywords, meaning


def download_image(picto_id, dest, *, client):
    response = client.get(IMAGE_URL.format(id=picto_id))
    response.raise_for_status()
    Path(dest).write_bytes(response.content)
