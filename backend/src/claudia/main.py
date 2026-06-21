import os
from pathlib import Path


def load_env(path=Path(".env")):
    """Copy KEY=VALUE lines from .env into the environment.

    A real environment variable always wins, so an exported key overrides
    the file. This must run before claudia.config is imported, because
    config binds OPENROUTER_API_KEY at import time.
    """
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key.strip():
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_env()

from fastapi.staticfiles import StaticFiles  # noqa: E402
from claudia.api import app  # noqa: E402  — load_env must precede config import

FRONTEND_DIR = Path(os.environ.get("CLAUDIA_FRONTEND_DIR", "frontend"))

# Serve the built front-end only when it is present; the API runs without it.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


def run():
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    run()
