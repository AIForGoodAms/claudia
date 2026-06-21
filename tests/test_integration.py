import pytest
from fastapi.testclient import TestClient
import api
import transcriber
import option_generator
import translator
from models import Transcript, Candidate, SymbolCard

WINDOW = b"\x10\x00" * 512     # one 512-sample "speech" window
QUIET = b"\x00\x00" * 512      # one 512-sample "silence" window


class FakeVad:
    """Deterministic stand-in for Silero: WINDOW = speech, QUIET = silence."""

    def __init__(self):
        self._in_speech = False

    def __call__(self, window):
        is_speech = window == WINDOW
        if is_speech and not self._in_speech:
            self._in_speech = True
            return {"start": 0}
        if not is_speech and self._in_speech:
            self._in_speech = False
            return {"end": 0}
        return None

    def reset(self):
        self._in_speech = False


@pytest.fixture
def client(conn, monkeypatch):
    monkeypatch.setattr(api, "_open_conn", lambda: conn)
    monkeypatch.setattr(api, "SileroVad", lambda **kwargs: FakeVad())   # no torch in CI

    async def fake_transcribe(pcm, lang, sample_rate=16000):
        return Transcript(text="wil je koffie?", lang=lang)

    async def fake_generate(context, persona, history, n, lang):
        return [Candidate(text="ja graag", glosses=["ja"])]

    async def fake_to_symbols(connection, glosses, lang, threshold):
        return [SymbolCard(id=1, label=g, image_url=f"/media/{g}.png",
                           confidence=0.9) for g in glosses]

    monkeypatch.setattr(transcriber, "transcribe", fake_transcribe)
    monkeypatch.setattr(option_generator, "generate", fake_generate)
    monkeypatch.setattr(translator, "to_symbols", fake_to_symbols)
    return TestClient(api.app)


def test_audio_stream_yields_options(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_bytes(WINDOW)             # speech start
        websocket.send_bytes(QUIET)              # silence → endpoint → propose + release
        event = websocket.receive_json()
    assert event["type"] == "utterance"
    assert event["transcript"] == "wil je koffie?"
    assert event["options"][0]["text"] == "ja graag"


def test_queue_releases_next_only_after_selection(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)
        first = websocket.receive_json()
        assert first["type"] == "utterance"

        # A second utterance arrives while the first is still unselected: it is queued.
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)

        # Selecting the first speaks it AND releases the queued second.
        websocket.send_json({"type": "select",
                             "interaction_id": first["interaction_id"],
                             "option_id": first["options"][0]["option_id"]})
        spoken = websocket.receive_json()
        assert spoken["type"] == "speak" and spoken["text"] == "ja graag"
        second = websocket.receive_json()
        assert second["type"] == "utterance"


def test_mute_marker_suppresses_options(client):
    with client.websocket_connect("/expressive/listen") as websocket:
        websocket.send_json({"type": "mute"})
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)   # dropped while muted
        websocket.send_json({"type": "unmute"})
        websocket.send_bytes(WINDOW); websocket.send_bytes(QUIET)   # heard
        event = websocket.receive_json()
    assert event["transcript"] == "wil je koffie?"
