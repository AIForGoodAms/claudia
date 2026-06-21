# tests/test_core_words.py
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent / "indexing" / "core_words.txt"


def entries():
    lines = CORE.read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def test_has_a_substantial_list():
    assert len(entries()) >= 50


def test_no_duplicate_entries():
    items = entries()
    assert len(items) == len(set(items))


def test_includes_single_core_words():
    items = set(entries())
    assert {"ik", "willen", "meer", "niet", "stop"} <= items


def test_includes_self_introduction_phrases():
    items = set(entries())
    assert {"mijn naam is", "ik ben blij je te ontmoeten", "ik woon in"} <= items
