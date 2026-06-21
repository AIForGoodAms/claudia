from models import Segment

WINDOW_SAMPLES = 512                          # the window size silero-vad needs at 16 kHz
WINDOW_BYTES = WINDOW_SAMPLES * 2             # PCM16: 2 bytes per sample


class Segmenter:
    """Buffers the speech between silero-vad's start and end events.

    Rechunks the incoming byte stream into fixed 512-sample windows, feeds each
    to `vad`, and accumulates windows from a `start` event through its `end`
    event into one Segment. The speech/silence decision and endpointing live in
    silero; this only does the buffering.
    """

    def __init__(self, vad, sample_rate=16000):
        self._vad = vad
        self._sample_rate = sample_rate
        self._pending = b""
        self._speech: list[bytes] = []
        self._in_speech = False

    def feed(self, frame: bytes) -> Segment | None:
        self._pending += frame
        segment = None
        while len(self._pending) >= WINDOW_BYTES:
            window = self._pending[:WINDOW_BYTES]
            self._pending = self._pending[WINDOW_BYTES:]
            event = self._vad(window)
            if event and "start" in event:
                self._in_speech = True
                self._speech = [window]
            elif event and "end" in event and self._in_speech:
                self._speech.append(window)
                segment = Segment(pcm=b"".join(self._speech), sample_rate=self._sample_rate)
                self._in_speech = False
                self._speech = []
            elif self._in_speech:
                self._speech.append(window)
        return segment

    def reset(self) -> None:
        self._pending = b""
        self._speech = []
        self._in_speech = False
        if hasattr(self._vad, "reset"):
            self._vad.reset()
