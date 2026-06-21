import math
import db


def fresh():
    conn = db.connect(":memory:")
    db.create_schema(conn)
    return conn


def test_schema_creates_both_tables():
    conn = fresh()
    names = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"symbols", "symbol_terms"} <= names


def test_create_schema_is_idempotent():
    conn = fresh()
    db.create_schema(conn)  # second call must not raise


def test_vector_roundtrip_is_float32_stable():
    vec = [0.0, 1.5, -2.25, 3.125]
    blob = db.pack_vector(vec)
    assert len(blob) == len(vec) * 4
    out = db.unpack_vector(blob)
    assert all(math.isclose(a, b, rel_tol=1e-6) for a, b in zip(vec, out))


def test_insert_symbol_then_exists():
    conn = fresh()
    sid = db.insert_symbol(conn, source="arasaac", external_id="2349",
                           image_path="media/2349.png", is_core=1, created_at="t0")
    assert isinstance(sid, int)
    assert db.symbol_exists(conn, "2349") is True
    assert db.symbol_exists(conn, "9999") is False


def test_duplicate_external_id_is_rejected():
    conn = fresh()
    db.insert_symbol(conn, source="arasaac", external_id="2349",
                     image_path="media/2349.png", is_core=1, created_at="t0")
    import sqlite3
    try:
        db.insert_symbol(conn, source="arasaac", external_id="2349",
                         image_path="media/2349.png", is_core=1, created_at="t0")
        assert False, "expected IntegrityError"
    except sqlite3.IntegrityError:
        pass


def test_insert_term_persists_row():
    conn = fresh()
    sid = db.insert_symbol(conn, source="arasaac", external_id="2349",
                           image_path="media/2349.png", is_core=1, created_at="t0")
    db.insert_term(conn, symbol_id=sid, lang="nl", label="meer",
                   description="meer, nog", vector=db.pack_vector([0.0] * 4),
                   model="intfloat/multilingual-e5-large@1024")
    row = conn.execute(
        "SELECT label, description, model FROM symbol_terms "
        "WHERE symbol_id=? AND lang='nl'", (sid,)).fetchone()
    assert row == ("meer", "meer, nog", "intfloat/multilingual-e5-large@1024")
