import os
from pathlib import Path

OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

MODEL_ASR = "nvidia/parakeet-tdt-0.6b-v3"
# :nitro routes to the highest-throughput provider (Groq/Cerebras). gpt-oss-120b
# there returns the option board in ~0.7s vs ~8s for glm-5.2, with Dutch glosses
# intact — flash-lite was as fast but emitted English glosses, breaking lookup.
MODEL_LLM = os.environ.get("MODEL_LLM", "openai/gpt-oss-120b:nitro")
# Embedding model id/dims live in the seeding plan's embedder.py (MODEL_ID, DIMS).

DB_PATH = Path(os.environ.get("AAC_DB_PATH", "symbols.db"))   # same default as seeding seed.py
MEDIA_DIR = Path(os.environ.get("AAC_MEDIA_DIR", "media"))

DEFAULT_SETTINGS = {
    "lang": "nl",
    "option_count": "5",
    "match_threshold": "0.30",
    "vad_silence_ms": "800",
    "echo_guard_ms": "300",
    "asr_model": MODEL_ASR,
}
