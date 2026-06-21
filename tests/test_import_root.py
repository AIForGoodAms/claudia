import sys
from pathlib import Path


def test_repo_root_on_syspath():
    root = str(Path(__file__).resolve().parent.parent)
    assert root in sys.path


def test_indexing_is_a_package():
    import indexing  # noqa: F401
