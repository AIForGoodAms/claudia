# indexing/seed.py
import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

import db
import embedder
from indexing import arasaac, describe


def load_words(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def resolve(word, *, client):
    try:
        results = arasaac.search(word, "nl", client=client)
    except httpx.HTTPStatusError:
        return None
    if not results:
        return None
    picto = results[0]
    picto_id = picto["_id"]
    nl_keywords, nl_meaning = arasaac.extract_terms(picto)
    if not nl_keywords:
        return None
    english = arasaac.pictogram(picto_id, "en", client=client)
    en_keywords, en_meaning = arasaac.extract_terms(english)
    return {"id": picto_id, "nl": (nl_keywords, nl_meaning),
            "en": (en_keywords, en_meaning)}


def seed_one(conn, word, media_dir, *, client, embed_fn, now):
    resolved = resolve(word, client=client)
    if resolved is None:
        return "unresolved"
    external_id = str(resolved["id"])
    if db.symbol_exists(conn, external_id):
        return "skipped"
    image_path = str(Path(media_dir) / f"{external_id}.png")
    arasaac.download_image(resolved["id"], image_path, client=client)
    symbol_id = db.insert_symbol(
        conn, source="arasaac", external_id=external_id,
        image_path=image_path, is_core=1, created_at=now)
    for lang in ("nl", "en"):
        keywords, meaning = resolved[lang]
        if not keywords:
            continue
        description = describe.compose(keywords, meaning)
        vector = embed_fn([description], "passage")[0]
        db.insert_term(
            conn, symbol_id=symbol_id, lang=lang, label=keywords[0],
            description=description, vector=db.pack_vector(vector),
            model=embedder.MODEL_TAG)
    conn.commit()
    return "seeded"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Seed ARASAAC symbols into SQLite.")
    parser.add_argument("--db-path", default=os.environ.get("DB_PATH", "symbols.db"))
    parser.add_argument("--media-dir", default="media")
    parser.add_argument("--words-path", default="indexing/core_words.txt")
    parser.add_argument("--unresolved-path", default="indexing/unresolved.txt")
    args = parser.parse_args(argv)

    conn = db.connect(args.db_path)
    db.create_schema(conn)
    Path(args.media_dir).mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    counts = {"seeded": 0, "skipped": 0, "unresolved": 0}
    unresolved = []
    with httpx.Client(timeout=60) as client:
        for word in load_words(args.words_path):
            status = seed_one(conn, word, args.media_dir, client=client,
                              embed_fn=embedder.embed, now=now)
            counts[status] += 1
            if status == "unresolved":
                unresolved.append(word)

    if unresolved:
        Path(args.unresolved_path).write_text(
            "\n".join(unresolved) + "\n", encoding="utf-8")
    print(counts)


if __name__ == "__main__":
    main()
