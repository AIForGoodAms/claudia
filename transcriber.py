import io
import wave
import openrouter
import config
from models import Transcript


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)               # PCM16
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


async def transcribe(pcm: bytes, lang: str, sample_rate: int = 16000) -> Transcript:
    wav_bytes = _pcm_to_wav(pcm, sample_rate)
    text = await openrouter.transcribe(wav_bytes, model=config.MODEL_ASR, language=lang)
    return Transcript(text=text, lang=lang)
