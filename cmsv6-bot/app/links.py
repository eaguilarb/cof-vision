"""Enlaces de descarga temporales firmados y el servidor web que los atiende."""

import hashlib
import hmac
import logging
import time
from pathlib import Path

from aiohttp import web

from .config import config

log = logging.getLogger(__name__)


def _sign(name: str, expires: int) -> str:
    msg = f"{name}:{expires}".encode()
    return hmac.new(config.link_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]


def make_link(path: Path) -> str | None:
    if not (config.public_url and config.link_secret):
        return None
    expires = int(time.time()) + config.link_hours * 3600
    return f"{config.public_url}/d/{expires}/{_sign(path.name, expires)}/{path.name}"


def verify(name: str, expires: int, sig: str, now: float | None = None) -> bool:
    if not config.link_secret or "/" in name or name.startswith("."):
        return False
    if (now or time.time()) > expires:
        return False
    return hmac.compare_digest(_sign(name, expires), sig)


def files_dir() -> Path:
    d = config.data_dir / "out"
    d.mkdir(parents=True, exist_ok=True)
    return d


async def _handle(request: web.Request) -> web.StreamResponse:
    name = request.match_info["name"]
    try:
        expires = int(request.match_info["expires"])
    except ValueError:
        raise web.HTTPNotFound()
    if not verify(name, expires, request.match_info["sig"]):
        raise web.HTTPForbidden(text="Enlace inválido o vencido.")
    path = files_dir() / name
    if not path.is_file():
        raise web.HTTPNotFound(text="El archivo ya fue eliminado.")
    return web.FileResponse(path, headers={
        "Content-Disposition": f'attachment; filename="{name}"'})


async def start_server() -> web.AppRunner:
    app = web.Application()
    app.router.add_get("/d/{expires}/{sig}/{name}", _handle)
    app.router.add_get("/salud", lambda _: web.Response(text="ok"))
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", config.http_port).start()
    log.info("Servidor de descargas en el puerto %s", config.http_port)
    return runner


def cleanup_old_files() -> int:
    """Borra los archivos generados más antiguos que la vigencia de los enlaces."""
    limit = time.time() - config.link_hours * 3600
    removed = 0
    for sub in ("out", "work"):
        d = config.data_dir / sub
        if not d.exists():
            continue
        for p in d.iterdir():
            if p.is_file() and p.stat().st_mtime < limit:
                p.unlink(missing_ok=True)
                removed += 1
    return removed
