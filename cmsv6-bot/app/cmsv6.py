"""Cliente de la API web de CMSV6 (StandardApiAction_*)."""

import asyncio
import ipaddress
import logging
import os
import secrets
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp

log = logging.getLogger(__name__)

LOC_NAMES = {1: "equipo", 2: "servidor de almacenamiento", 4: "servidor de descarga"}


class CMSV6Error(RuntimeError):
    pass


@dataclass
class Vehicle:
    plate: str
    dev_id: str
    channels: int
    channel_names: list[str]
    company: str = ""  # empresa/terminal (pnm)

    def channel_label(self, chn: int) -> str:
        if chn < len(self.channel_names) and self.channel_names[chn]:
            return f"cam{chn + 1} ({self.channel_names[chn]})"
        return f"cam{chn + 1}"


@dataclass
class RecFile:
    dev_id: str
    chn: int  # primer canal del archivo (0 = cámara 1)
    beg: int  # segundos desde las 00:00 del día
    end: int
    path: str
    size: int
    loc: int
    down_url: str
    chns: tuple[int, ...] = ()  # todos los canales que contiene (archivos multicanal)
    task_url: str = ""  # DownTaskUrl: descarga por tramos del equipo al servidor
    segment_only: bool = False  # stream=1: el archivo solo se puede bajar por tramos

    def has_channel(self, chn: int) -> bool:
        return chn in (self.chns or (self.chn,))

    def covers(self, start: int, stop: int) -> bool:
        return self.beg < stop and self.end > start


class CMSV6:
    def __init__(self, base_url: str, account: str, password: str,
                 session_file: Path | None = None):
        self.base_url = base_url.rstrip("/")
        # La sesión se guarda en disco: con «inicio de sesión único» activado, CMSV7 rechaza
        # un segundo login (código 34) mientras la sesión anterior siga viva, p. ej. tras reiniciar.
        self.session_file = session_file
        self.host = urlsplit(self.base_url).hostname or ""
        self.account = account
        self.password = password
        self.jsession: str | None = None
        self._lock = asyncio.Lock()
        self._session: aiohttp.ClientSession | None = None
        self._vehicles: tuple[float, list[Vehicle]] | None = None

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60))
        return self._session

    async def close(self) -> None:
        if self._session:
            await self._session.close()

    async def login(self, force: bool = False) -> None:
        async with self._lock:
            if not force and self.session_file and self.session_file.exists():
                saved = self.session_file.read_text().strip()
                if saved:
                    self.jsession = saved
                    return
            data = await self._raw("StandardApiAction_login.action",
                                   {"account": self.account, "password": self.password})
            result = data.get("result")
            if result == 34:
                raise CMSV6Error(
                    f"El usuario «{self.account}» tiene «inicio de sesión único» y ya está "
                    "conectado en otro lugar (aplicativo o navegador). Cierra esa sesión o usa "
                    "un usuario exclusivo para el bot.")
            if result != 0 or not data.get("jsession"):
                raise CMSV6Error(f"Login rechazado por CMSV6 (result={result}). "
                                 "Revisa CMSV6_USER y CMSV6_PASSWORD.")
            self.jsession = data["jsession"]
            if self.session_file:
                self.session_file.parent.mkdir(parents=True, exist_ok=True)
                self.session_file.write_text(self.jsession)
                self.session_file.chmod(0o600)
            log.info("Sesión CMSV6 iniciada")

    async def _raw(self, action: str, params: dict) -> dict:
        http = await self._http()
        url = f"{self.base_url}/{action}?{urlencode(params)}"
        try:
            async with http.get(url) as r:
                r.raise_for_status()
                return await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            raise CMSV6Error(f"No se pudo contactar a CMSV6 ({self.base_url}): {e}") from e

    async def call(self, action: str, params: dict | None = None) -> dict:
        """Llama a la API; si la sesión expiró, vuelve a iniciar sesión una vez."""
        if not self.jsession:
            await self.login()
        for attempt in (1, 2):
            data = await self._raw(action, {**(params or {}), "jsession": self.jsession})
            result = data.get("result")
            if result == 0:
                return data
            # 5 = la sesión no existe (vence a las 4 h sin uso)
            if attempt == 1 and result == 5:
                await self.login(force=True)
                continue
            if result == 32:
                raise CMSV6Error("El vehículo no está en línea (apagado o sin señal), así que no se "
                                 "puede consultar su grabador. Intenta cuando esté encendido.")
            raise CMSV6Error(f"{action} devolvió result={result}: {data.get('message', '')}")
        raise AssertionError("unreachable")

    async def vehicles(self) -> list[Vehicle]:
        # Con flotas grandes (más de 1000 vehículos) la lista pesa; se guarda 10 minutos
        if self._vehicles and time.monotonic() - self._vehicles[0] < 600:
            return self._vehicles[1]
        data = await self.call("StandardApiAction_queryUserVehicle.action")
        out = []
        for v in data.get("vehicles") or []:
            for d in v.get("dl") or []:
                names = [n.strip() for n in str(d.get("cn") or "").split(",")]
                out.append(Vehicle(plate=str(v.get("nm", "")), dev_id=str(d.get("id", "")),
                                   channels=int(d.get("cc") or len(names) or 1),
                                   channel_names=names, company=str(v.get("pnm") or "")))
        self._vehicles = (time.monotonic(), out)
        return out

    async def online_devices(self) -> set[str]:
        """Números de equipo de todos los vehículos de la cuenta que están en línea ahora."""
        data = await self.call("StandardApiAction_getDeviceOlStatus.action", {"status": 1})
        return {str(o.get("did")) for o in data.get("onlines") or [] if o.get("online") == 1}

    async def online_status(self, dev_ids: list[str]) -> dict[str, bool]:
        if not dev_ids:
            return {}
        try:
            data = await self.call("StandardApiAction_getDeviceOlStatus.action",
                                   {"devIdno": ",".join(dev_ids)})
        except CMSV6Error as e:
            log.warning("No se pudo leer el estado en línea: %s", e)
            return {}
        return {str(o.get("did")): o.get("online") == 1 for o in data.get("onlines") or []}

    async def find_vehicle(self, query: str) -> Vehicle:
        q = query.strip().upper().replace("-", "").replace(" ", "")
        vs = await self.vehicles()
        exact = [v for v in vs if v.plate.upper().replace("-", "").replace(" ", "") == q
                 or v.dev_id.upper() == q]
        if exact:
            return exact[0]
        partial = [v for v in vs if q in v.plate.upper().replace("-", "").replace(" ", "")]
        if len(partial) == 1:
            return partial[0]
        if partial:
            raise CMSV6Error("Hay varios vehículos que coinciden: "
                             + ", ".join(v.plate for v in partial[:10]))
        raise CMSV6Error(f"No encontré el vehículo «{query}». Usa /vehiculos para ver la lista.")

    async def search(self, v: Vehicle, day: date, chn: int = -1, loc: int = 2) -> list[RecFile]:
        """Busca grabaciones. En el servidor (LOC 2/4) CMSV7 identifica por placa; en el equipo, por número."""
        ids = [v.dev_id] if loc == 1 else list(dict.fromkeys([v.plate, v.dev_id]))
        for ident in ids:
            files = await self._search(ident, v.dev_id, day, chn, loc)
            if files:
                return files
        return []

    async def _search(self, ident: str, dev_id: str, day: date, chn: int, loc: int) -> list[RecFile]:
        params = {
            "DevIDNO": ident, "LOC": loc, "CHN": chn,
            "YEAR": day.year, "MON": day.month, "DAY": day.day,
            "RECTYPE": -1, "FILEATTR": 2, "BEG": 0, "END": 86399,
            "ARM1": 0, "ARM2": 0, "RES": 0, "STREAM": -1, "STORE": 0,
        }
        data = await self.call("StandardApiAction_getVideoFileInfo.action", params)
        files = []
        for f in data.get("files") or []:
            # beg/end en segundos desde las 00:00; end puede pasar de 86400 si cruza el día
            f_beg, f_end = int(f.get("beg") or 0), int(f.get("end") or 0)
            if f_end <= f_beg:
                f_end = 86400
            chns = _file_channels(f)
            files.append(RecFile(
                dev_id=dev_id,
                chn=chns[0], chns=tuple(chns),
                beg=f_beg, end=f_end,
                path=str(f.get("file", "")),
                size=int(f.get("len") or 0),
                loc=int(f.get("loc") or loc),
                down_url=str(f.get("DownUrl") or f.get("downUrl") or "").strip(),
                task_url=str(f.get("DownTaskUrl") or "").strip(),
                segment_only=f.get("stream") == 1,
            ))
        files.sort(key=lambda x: (x.chn, x.beg))
        return files

    async def find_recordings(self, v: Vehicle, day: date, chn: int, start: int, stop: int,
                              locations: list[int]) -> list[RecFile]:
        """Busca en cada ubicación (servidor primero) y devuelve la primera que tenga datos."""
        last_err: Exception | None = None
        for loc in locations:
            try:
                files = await self.search(v, day, chn=chn, loc=loc)
            except CMSV6Error as e:
                last_err = e
                continue
            hits = [f for f in files if f.has_channel(chn) and f.covers(start, stop)]
            if hits:
                return hits
        if last_err:
            raise last_err
        return []

    def _fix_url(self, url: str) -> tuple[str, dict]:
        """Separa la URL y, si apunta a una IP interna del servidor, la cambia por la pública."""
        url = url.strip()
        if url.startswith("/"):
            url = f"http://{self.host}:6611{url}"
        parts = urlsplit(url)
        netloc = parts.netloc
        if _is_internal(parts.hostname or ""):
            netloc = f"{self.host}:{parts.port}" if parts.port else self.host
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        return urlunsplit((parts.scheme or "http", netloc, parts.path, "", "")), query

    def download_url(self, f: RecFile) -> str:
        """URL de descarga directa (DownUrl). La API la devuelve con jsession y SAVENAME vacíos."""
        if f.down_url:
            base, query = self._fix_url(f.down_url)
        elif f.path and f.loc != 1:
            base = f"http://{self.host}:6611/3/5"
            query = {"DownType": 3, "DevIDNO": f.dev_id, "FLENGTH": f.size, "FOFFSET": 0,
                     "MTYPE": 1, "FPATH": f.path}
        else:
            raise CMSV6Error("Este archivo no tiene descarga directa.")
        query["jsession"] = self.jsession or ""
        if not query.get("SAVENAME"):
            query["SAVENAME"] = os.path.basename(f.path.replace("\\", "/")) or "video"
        return f"{base}?{urlencode(query)}"

    async def segment_download(self, v: Vehicle, f: RecFile, day: date, start: int, stop: int,
                               dest: Path, progress=None, timeout_s: int = 1200,
                               stall_s: int | None = None) -> tuple[Path, int]:
        """Pide a CMSV6 que baje del equipo solo el tramo [start, stop] y luego lo descarga.

        Devuelve el archivo y el segundo del día en que empieza."""
        if not f.task_url:
            raise CMSV6Error("CMSV6 no ofrece descarga por tramos para este archivo.")
        a, b = max(start, f.beg), min(stop, f.end)
        midnight = datetime(day.year, day.month, day.day)
        fmt = lambda sec: (midnight + timedelta(seconds=sec)).strftime("%Y-%m-%d %H:%M:%S")
        tag = "bot" + secrets.token_hex(4)
        _, query = self._fix_url(f.task_url)
        query.pop("jsession", None)
        query.update({"fbtm": fmt(a), "fetm": fmt(b), "lab": tag, "dtp": 2})
        query.setdefault("sbtm", fmt(f.beg))
        query.setdefault("setm", fmt(f.end))
        await self.call("StandardApiAction_addDownloadTask.action", query)
        log.info("Tarea de descarga por tramos %s creada (%s – %s)", tag, fmt(a), fmt(b))

        started = time.monotonic()
        deadline = started + timeout_s
        info: dict = {}
        while time.monotonic() < deadline:
            await asyncio.sleep(3)
            data = await self.call("StandardApiAction_downloadTasklist.action", {
                "taskTag": tag, "begintime": fmt(0), "endtime": fmt(86399 + 86400)})
            infos = data.get("infos") or []
            info = infos[0] if infos else {}
            stu = info.get("stu")
            if progress:
                await progress({1: "en espera", 2: "descargando del vehículo",
                                4: "listo"}.get(stu, "en espera"))
            if stu == 3:
                raise CMSV6Error(f"El vehículo no pudo enviar el video: {info.get('err') or 'sin detalle'}")
            if stu == 4:
                break
            # stu 1 = en espera: el vehículo aún no empieza a enviar
            if stall_s is not None and stu in (None, 1) and time.monotonic() - started > stall_s:
                # Se cancela la tarea para que no compita por el 4G del bus con el plan B
                try:
                    await self.call("StandardApiAction_delDownloadTasklist.action",
                                    {"devIdno": f.dev_id, "taskTag": tag})
                except CMSV6Error as e:
                    log.info("No se pudo cancelar la tarea %s: %s", tag, e)
                raise CMSV6Error(f"El vehículo no empezó a enviar el tramo en {stall_s} s.")
        else:
            raise CMSV6Error("El vehículo tardó demasiado en enviar el video "
                             "(¿está apagado o sin señal?). La tarea sigue en CMSV6; intenta más tarde.")

        url = str(info.get("downUrl") or "").strip()
        if url:
            base, q = self._fix_url(url)
            q["jsession"] = self.jsession or ""
            if not q.get("SAVENAME"):
                q["SAVENAME"] = tag + ".mp4"
            await self._download_url(f"{base}?{urlencode(q)}", dest)
            return dest, a
        # Sin enlace en la tarea: el archivo ya está en el servidor de almacenamiento
        for rec in await self.search(v, day, chn=f.chn, loc=2):
            if rec.has_channel(f.chn) and rec.covers(a, b):
                await self.download(rec, dest)
                return dest, rec.beg
        raise CMSV6Error("La descarga terminó pero no encontré el archivo en el servidor.")

    async def download(self, f: RecFile, dest: Path, progress=None) -> Path:
        if not self.jsession:
            await self.login()
        return await self._download_url(self.download_url(f), dest, progress, f.size)

    async def _download_url(self, url: str, dest: Path, progress=None, total: int = 0) -> Path:
        log.info("Descargando %s", url.split("jsession=")[0])
        http = await self._http()
        tmp = dest.with_suffix(dest.suffix + ".part")
        timeout = aiohttp.ClientTimeout(total=None, sock_read=120)
        try:
            async with http.get(url, timeout=timeout) as r:
                r.raise_for_status()
                total = total or int(r.headers.get("Content-Length") or 0)
                done, t0, last = 0, time.monotonic(), 0.0
                with tmp.open("wb") as fh:
                    async for chunk in r.content.iter_chunked(1 << 16):
                        fh.write(chunk)
                        done += len(chunk)
                        now = time.monotonic()
                        if progress and now - last >= 5:
                            last = now
                            await progress(done, total, done / max(now - t0, 0.001))
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            tmp.unlink(missing_ok=True)
            raise CMSV6Error(f"Falló la descarga del archivo de grabación: {e}") from e
        if tmp.stat().st_size < 1024:
            body = tmp.read_bytes()[:300]
            tmp.unlink()
            raise CMSV6Error(f"CMSV6 devolvió un archivo vacío o un error: {body!r}")
        tmp.rename(dest)
        return dest


def _is_internal(host: str) -> bool:
    if host in ("", "localhost"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False  # es un dominio: se respeta
    return ip.is_private or ip.is_loopback or ip.is_unspecified


def _file_channels(f: dict) -> list[int]:
    """Según la documentación: primero se revisa chnMask (bit 0 = cámara 1); si es 0, se usa chn."""
    mask = int(f.get("chnMask") or 0)
    if mask:
        return [i for i in range(32) if mask & (1 << i)]
    return [max(0, int(f.get("chn") or 0))]
