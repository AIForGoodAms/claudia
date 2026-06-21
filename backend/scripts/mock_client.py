"""Stream a WAV file to the /expressive/listen websocket and print what comes back.

Usage:
    python scripts/mock_client.py she-wants-coffee.wav
    python scripts/mock_client.py clip.wav --url ws://localhost:8000/expressive/listen
    python scripts/mock_client.py clip.wav --auto-select   # pick option 0 to close the loop

The server expects PCM16, mono, 16 kHz — exactly what `wave` gives us for such a
file. Anything else is rejected up front rather than streamed as garbage.
"""

import argparse
import asyncio
import json
import wave

import websockets

SAMPLE_RATE = 16000
WINDOW_BYTES = 512 * 2          # silero-vad's 512-sample window, PCM16 (matches the server)
SECONDS_PER_WINDOW = 512 / SAMPLE_RATE
TRAILING_SILENCE_SEC = 1.2      # must exceed the server's vad_silence_ms (default 800) to endpoint
REPLY_TIMEOUT_SEC = 120         # the first reply after a cold server start loads the embedder; give it room


def read_pcm(path: str) -> bytes:
    with wave.open(path, "rb") as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise SystemExit(
                f"{path}: need 16 kHz mono PCM16, got "
                f"{wav.getframerate()} Hz / {wav.getnchannels()} ch / {wav.getsampwidth() * 8}-bit"
            )
        return wav.readframes(wav.getnframes())


async def print_replies(ws, *, auto_select: bool, done: asyncio.Event) -> None:
    async for raw in ws:
        message = json.loads(raw)
        print(f"<- {message}")
        if auto_select and message.get("type") == "utterance":
            choice = {"type": "select",
                      "interaction_id": message["interaction_id"],
                      "option_id": message["options"][0]["option_id"]}
            print(f"-> {choice}")
            await ws.send(json.dumps(choice))
        # An utterance (or the speak that follows a selection) means the round trip closed.
        if message.get("type") == "speak" or (message.get("type") == "utterance" and not auto_select):
            done.set()


async def stream(path: str, url: str, *, realtime: bool, auto_select: bool) -> None:
    pcm = read_pcm(path)
    silence = b"\x00\x00" * 512
    trailing_windows = round(TRAILING_SILENCE_SEC / SECONDS_PER_WINDOW)
    async with websockets.connect(url) as ws:
        done = asyncio.Event()
        replies = asyncio.create_task(print_replies(ws, auto_select=auto_select, done=done))
        for start in range(0, len(pcm), WINDOW_BYTES):
            await ws.send(pcm[start:start + WINDOW_BYTES])
            if realtime:
                await asyncio.sleep(SECONDS_PER_WINDOW)
        for _ in range(trailing_windows):       # enough silence for the server to endpoint the segment
            await ws.send(silence)
        try:
            await asyncio.wait_for(done.wait(), timeout=REPLY_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            print(f"(no reply within {REPLY_TIMEOUT_SEC}s — VAD may not have detected speech)")
        replies.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock audio client for /expressive/listen")
    parser.add_argument("wav", help="16 kHz mono PCM16 WAV file to stream")
    parser.add_argument("--url", default="ws://localhost:8000/expressive/listen")
    parser.add_argument("--realtime", action="store_true",
                        help="pace frames at wall-clock speed instead of blasting them")
    parser.add_argument("--auto-select", action="store_true",
                        help="auto-pick the first option to exercise the full loop")
    args = parser.parse_args()
    asyncio.run(stream(args.wav, args.url, realtime=args.realtime, auto_select=args.auto_select))


if __name__ == "__main__":
    main()
