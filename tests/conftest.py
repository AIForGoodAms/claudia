import sys
import sqlite3
from pathlib import Path
import pytest

# Repo root on sys.path so `import db`, `import embedder`, `import store`, etc. resolve.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def conn():
    import db        # seeding plan: creates symbols + symbol_terms
    import store     # this plan: creates interactions, options, persona, settings
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    db.create_schema(connection)
    store.create_schema(connection)
    yield connection
    connection.close()
