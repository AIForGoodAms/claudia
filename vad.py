import numpy as np


class SileroVad:
    """Streaming voice-activity detector backed by silero-vad's VADIterator.

    Call with exactly one 512-sample (1024-byte) PCM16 window at 16 kHz — the
    window size silero requires. Returns {"start": idx} / {"end": idx} on a
    speech boundary, else None. `min_silence_ms` is silero's own endpointing
    threshold, so the pause that ends an utterance is its decision, not ours.
    """

    def __init__(self, sample_rate: int = 16000, threshold: float = 0.5,
                 min_silence_ms: int = 800):
        from silero_vad import load_silero_vad, VADIterator
        self._iterator = VADIterator(
            load_silero_vad(), threshold=threshold,
            sampling_rate=sample_rate, min_silence_duration_ms=min_silence_ms)

    def __call__(self, window: bytes):
        import torch
        samples = np.frombuffer(window, dtype=np.int16).astype(np.float32) / 32768.0
        return self._iterator(torch.from_numpy(samples))

    def reset(self) -> None:
        self._iterator.reset_states()
