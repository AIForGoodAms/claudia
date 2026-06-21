from claudia.audio_stream import Segmenter

WINDOW = b"\x10\x00" * 512            # one 512-sample (1024-byte) window of "speech"


class ScriptedVad:
    """Replays a fixed list of VADIterator events, one per 512-sample window."""

    def __init__(self, events):
        self._events = list(events)
        self._index = 0

    def __call__(self, window: bytes):
        event = self._events[self._index] if self._index < len(self._events) else None
        self._index += 1
        return event

    def reset(self):
        pass                                  # no rewind: mirrors silero's stateless reset


def test_emits_segment_on_speech_end():
    seg = Segmenter(ScriptedVad([{"start": 0}, None, {"end": 1536}]))
    assert seg.feed(WINDOW) is None           # speech start
    assert seg.feed(WINDOW) is None           # mid-speech
    out = seg.feed(WINDOW)                     # speech end → emit
    assert out is not None
    assert out.pcm == WINDOW * 3             # the windows from start through end


def test_ignores_audio_before_speech_start():
    seg = Segmenter(ScriptedVad([None, None, {"start": 1024}]))
    assert seg.feed(WINDOW) is None
    assert seg.feed(WINDOW) is None
    assert seg.feed(WINDOW) is None           # speech just started; nothing emitted yet


def test_rechunks_a_multi_window_frame():
    seg = Segmenter(ScriptedVad([{"start": 0}, {"end": 1024}]))
    out = seg.feed(WINDOW + WINDOW)           # one feed carrying two 512-sample windows
    assert out is not None and out.pcm == WINDOW * 2


def test_reset_discards_buffered_speech():
    seg = Segmenter(ScriptedVad([{"start": 0}, None, {"end": 1024}]))
    seg.feed(WINDOW)                          # start, buffering
    seg.feed(WINDOW)                          # still buffering
    seg.reset()                               # clears the buffer + in-speech state
    assert seg.feed(WINDOW) is None           # the now-stray "end" is ignored
