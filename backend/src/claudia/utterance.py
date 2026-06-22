from claudia.models import Utterance


def compose(text: str, lang: str) -> Utterance:
    return Utterance(text=" ".join(text.split()), lang=lang)
