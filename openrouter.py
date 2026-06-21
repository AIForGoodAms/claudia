import httpx
import config


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.OPENROUTER_BASE_URL,
        headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}"},
        timeout=60.0,
    )


async def chat(messages, model, temperature=0.7, response_format=None) -> str:
    payload = {"model": model, "messages": messages, "temperature": temperature}
    if response_format is not None:
        payload["response_format"] = response_format
    async with _make_client() as client:
        response = await client.post("/chat/completions", json=payload)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


async def transcribe(wav_bytes, model, language=None) -> str:
    files = {"file": ("utterance.wav", wav_bytes, "audio/wav")}
    form = {"model": model}
    if language is not None:
        form["language"] = language
    async with _make_client() as client:
        response = await client.post("/audio/transcriptions", data=form, files=files)
        response.raise_for_status()
        return response.json()["text"]
