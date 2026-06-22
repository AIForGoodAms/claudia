import logging
import os
from pathlib import Path


def configure_logging(level=logging.INFO):
    """Send `claudia.*` logs to stderr at INFO.

    uvicorn only configures its own loggers, so without this the app's INFO
    lines fall back to the WARNING-level last-resort handler and vanish. We put
    a handler on the `claudia` parent and stop propagation so nothing double-logs
    through the root/uvicorn handlers.
    """
    logger = logging.getLogger("claudia")
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S"))
        logger.addHandler(handler)
    logger.propagate = False


configure_logging()


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
