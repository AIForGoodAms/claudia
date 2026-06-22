from claudia.utterance import compose


def test_compose_returns_text_and_lang():
    out = compose("ik wil koffie", "nl")
    assert out.text == "ik wil koffie" and out.lang == "nl"


def test_compose_collapses_whitespace():
    assert compose("  ik   wil  koffie ", "nl").text == "ik wil koffie"
