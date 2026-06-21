from claudia import store


def test_seeds_default_settings(conn):
    assert store.get_setting(conn, "lang") == "nl"
    assert store.get_setting(conn, "match_threshold") == "0.30"


def test_set_setting_overrides(conn):
    store.set_setting(conn, "lang", "en")
    assert store.get_setting(conn, "lang") == "en"


def test_create_schema_is_idempotent(conn):
    store.create_schema(conn)            # second call must not raise or duplicate settings
    rows = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
    assert rows == len(store.config.DEFAULT_SETTINGS)


def test_live_tables_exist(conn):
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"interactions", "options", "persona", "settings"} <= names
