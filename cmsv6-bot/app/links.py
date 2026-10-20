"""Enlaces de descarga temporales firmados y el servidor web que los atiende."""

import base64
import hashlib
import hmac
import html
import logging
import time
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit

import aiohttp
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


# ---------- Video en vivo ----------
# El navegador nunca ve la sesión de CMSV7: el VPS pide el video a CMSV7 y lo reenvía.

LiveSource = Callable[[str, int], Awaitable[str]]  # (equipo, canal) → URL HLS en CMSV7
_live_source: LiveSource | None = None
_http: aiohttp.ClientSession | None = None


def set_live_source(fn: LiveSource) -> None:
    global _live_source
    _live_source = fn


def make_live_link(dev_id: str, plate: str, chns: list[int]) -> str | None:
    if not (config.public_url and config.link_secret):
        return None
    expires = int(time.time()) + config.live_link_minutes * 60
    cams = ",".join(str(c) for c in chns)
    sig = _sign(f"vivo:{dev_id}:{cams}", expires)
    return f"{config.public_url}/vivo/{expires}/{sig}/{dev_id}/{cams}/?p={quote(plate)}"


def _check_live(request: web.Request) -> tuple[str, list[int]]:
    m = request.match_info
    try:
        expires = int(m["expires"])
        chns = [int(c) for c in m["cams"].split(",")]
    except ValueError:
        raise web.HTTPNotFound()
    name = f"vivo:{m['dev']}:{m['cams']}"
    if not config.link_secret or time.time() > expires or not hmac.compare_digest(
            _sign(name, expires), m["sig"]):
        raise web.HTTPForbidden(text="Enlace en vivo inválido o vencido. Pide uno nuevo con /vivo.")
    return m["dev"], chns


def _b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def _unb64(s: str) -> str:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode()


def _rewrite_playlist(text: str, upstream: str, chn: int) -> str:
    """Cambia cada URL de la lista HLS por una URL de este servidor (proxy)."""
    session = dict(parse_qsl(urlsplit(upstream).query)).get("jsession", "")
    out = []
    for line in text.splitlines():
        if line and not line.startswith("#"):
            absolute = urljoin(upstream, line.strip())
            parts = urlsplit(absolute)
            q = dict(parse_qsl(parts.query, keep_blank_values=True))
            if session and "jsession" not in q:
                q["jsession"] = session
            absolute = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), ""))
            line = f"p?c={chn}&u={_b64(absolute)}"
        out.append(line)
    return "\n".join(out) + "\n"


async def _fetch(url: str) -> tuple[int, str, bytes]:
    global _http
    if _http is None or _http.closed:
        _http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
    async with _http.get(url) as r:
        return r.status, r.headers.get("Content-Type", ""), await r.read()


async def _live_playlist(request: web.Request) -> web.Response:
    dev, chns = _check_live(request)
    chn = int(request.match_info["chn"])
    if chn not in chns or _live_source is None:
        raise web.HTTPNotFound()
    upstream = await _live_source(dev, chn)
    status, _, body = await _fetch(upstream)
    if status != 200:
        raise web.HTTPServiceUnavailable(text="El bus aún no envía video")
    return web.Response(text=_rewrite_playlist(body.decode(errors="replace"), upstream, chn),
                        content_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-cache"})


async def _live_proxy(request: web.Request) -> web.Response:
    """Segmentos (y listas anidadas) del video en vivo: /vivo/.../p?c=canal&u=URL."""
    dev, chns = _check_live(request)
    if not request.query.get("c", "").isdigit():
        raise web.HTTPNotFound()
    chn = int(request.query["c"])
    if chn not in chns or _live_source is None:
        raise web.HTTPNotFound()
    try:
        url = _unb64(request.query.get("u", ""))
    except Exception:
        raise web.HTTPBadRequest()
    # Solo se reenvía al mismo servidor de video y a su carpeta HLS (no es un proxy abierto)
    upstream = urlsplit(await _live_source(dev, chn))
    folder = upstream.path.rsplit("/", 1)[0] + "/"
    target = urlsplit(url)
    if target.netloc != upstream.netloc or not target.path.startswith(folder) or ".." in target.path:
        raise web.HTTPForbidden()
    status, ctype, body = await _fetch(url)
    if status != 200:
        raise web.HTTPServiceUnavailable()
    if "mpegurl" in ctype.lower() or urlsplit(url).path.endswith(".m3u8"):
        return web.Response(text=_rewrite_playlist(body.decode(errors="replace"), url, chn),
                            content_type="application/vnd.apple.mpegurl",
                            headers={"Cache-Control": "no-cache"})
    return web.Response(body=body, content_type=ctype.split(";")[0] or "video/mp2t")


LIVE_PAGE = """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>En vivo · {plate}</title>
<style>
 body{{margin:0;background:#111;color:#eee;font-family:-apple-system,system-ui,sans-serif}}
 header{{padding:10px 14px;font-weight:600}} header small{{color:#aaa;font-weight:400}}
 .grid{{display:grid;gap:6px;padding:6px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}}
 figure{{margin:0;position:relative;background:#000;aspect-ratio:16/9}}
 video{{width:100%;height:100%;object-fit:contain;background:#000}}
 figcaption{{position:absolute;top:6px;left:8px;background:#0008;padding:2px 6px;border-radius:4px;font-size:13px}}
 .st{{position:absolute;bottom:6px;left:8px;font-size:12px;color:#ccc}}
</style></head><body>
<header>🔴 En vivo · {plate} <small>· el enlace vence {vence}</small></header>
<div class="grid">{cams}</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
<script>
document.querySelectorAll("video").forEach(function (v) {{
  var src = v.dataset.src, st = v.parentNode.querySelector(".st");
  function retry() {{ st.textContent = "Conectando con el bus…"; setTimeout(start, 3000); }}
  function start() {{
    if (window.Hls && Hls.isSupported()) {{
      var h = new Hls({{manifestLoadingMaxRetry: 30, manifestLoadingRetryDelay: 2000,
                       levelLoadingMaxRetry: 30, liveSyncDurationCount: 2}});
      h.loadSource(src); h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, function () {{ st.textContent = ""; v.play().catch(function(){{}}); }});
      h.on(Hls.Events.ERROR, function (_, d) {{ if (d.fatal) {{ h.destroy(); retry(); }} }});
    }} else {{
      v.src = src; v.onerror = retry;
      v.onplaying = function () {{ st.textContent = ""; }};
      v.play().catch(function(){{}});
    }}
  }}
  start();
}});
</script></body></html>"""


async def _live_page(request: web.Request) -> web.Response:
    _, chns = _check_live(request)
    plate = html.escape(request.query.get("p", ""))
    cams = "".join(
        f'<figure><video data-src="{c}.m3u8" muted playsinline autoplay controls></video>'
        f'<figcaption>Cámara {c + 1}</figcaption><span class="st">Conectando con el bus…</span>'
        f'</figure>' for c in chns)
    vence = time.strftime("%H:%M", time.localtime(int(request.match_info["expires"])))
    return web.Response(text=LIVE_PAGE.format(plate=plate, cams=cams, vence=vence),
                        content_type="text/html")


async def _health(_: web.Request) -> web.Response:
    return web.Response(text="ok")


async def start_server() -> web.AppRunner:
    app = web.Application()
    app.router.add_get("/d/{expires}/{sig}/{name}", _handle)
    live = "/vivo/{expires}/{sig}/{dev}/{cams}"
    app.router.add_get(live + "/", _live_page)
    app.router.add_get(live + "/{chn:\\d+}.m3u8", _live_playlist)
    app.router.add_get(live + "/p", _live_proxy)
    app.router.add_get("/salud", _health)
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
