from indexing.describe import compose


def test_keywords_and_meaning():
    assert compose(["meer", "nog", "extra"], "een grotere hoeveelheid") == \
        "meer, nog, extra — een grotere hoeveelheid"


def test_keywords_only_when_no_meaning():
    assert compose(["meer", "nog"], None) == "meer, nog"


def test_blank_meaning_degrades_to_keywords_only():
    assert compose(["meer"], "   ") == "meer"


def test_blank_keywords_are_dropped():
    assert compose(["meer", "", "  ", "extra"], None) == "meer, extra"
