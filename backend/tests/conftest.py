import sqlite3
import pytest


@pytest.fixture
def conn():
    from claudia import db  # seeding plan: creates symbols + symbol_terms
    from claudia import store  # this plan: creates interactions, options, persona, settings
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    db.create_schema(connection)
    store.create_schema(connection)
    yield connection
    connection.close()
