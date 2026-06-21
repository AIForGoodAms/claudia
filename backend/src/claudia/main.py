import os
from pathlib import Path

from fastapi.staticfiles import StaticFiles
from claudia.api import app

FRONTEND_DIR = Path(os.environ.get("CLAUDIA_FRONTEND_DIR", "frontend"))

# Serve the built front-end only when it is present; the API runs without it.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


def run():
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    run()
