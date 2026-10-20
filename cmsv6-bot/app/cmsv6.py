"""Cliente de la API web de CMSV6 (StandardApiAction_*)."""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import date
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

    def has_channel(self, chn: int) -> bool:
        return chn in (self.chns or (self.chn,))

    def covers(self, start: int, stop: int) -> bool:
        return self.beg < stop and self.end > start


class CMSV6:
    def __init__(self, base_url: str, account: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.host = urlsplit(self.base_url).hostname or ""
        self.account = account
        self.password = password
        self.jsession: str | None = None
        self._lock = asyncio.Lock()
        self._session: aiohttp.ClientSession | None = None

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60))
        return self._session

    async def close(self) -> None:
        if self._session:
            await self._session.close()

    async def login(self) -> None:
        async with self._lock:
            data = await self._raw("StandardApiAction_login.action",
                                   {"account": self.account, "password": self.password})
            if data.get("result") != 0 or not data.get("jsession"):
                raise CMSV6Error(f"Login rechazado por CMSV6 (result={data.get('result')}). "
                                 "Revisa CMSV6_USER y CMSV6_PASSWORD.")
            self.jsession = data["jsession"]
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
            # 4/5 = sesión expirada o inexistente
            if attempt == 1 and result in (4, 5):
                await self.login()
                continue
            raise CMSV6Error(f"{action} devolvió result={result}: {data.get('message', '')}")
        raise AssertionError("unreachable")

    async def vehicles(self) -> list[Vehicle]:
        data = await self.call("StandardApiAction_queryUserVehicle.action")
        out = []
        for v in data.get("vehicles") or []:
            for d in v.get("dl") or []:
                names = [n.strip() for n in str(d.get("cn") or "").split(",")]
                out.append(Vehicle(plate=str(v.get("nm", "")), dev_id=str(d.get("id", "")),
                                   channels=int(d.get("cc") or len(names) or 1),
                                   channel_names=names))
        return out

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

    async def search(self, dev_id: str, day: date, chn: int = -1, loc: int = 2,
                     beg: int = 0, end: int = 86399) -> list[RecFile]:
        params = {
            "DevIDNO": dev_id, "LOC": loc, "CHN": chn,
            "YEAR": day.year, "MON": day.month, "DAY": day.day,
            "RECTYPE": -1, "FILEATTR": 2, "BEG": beg, "END": end,
            "ARM1": 0, "ARM2": 0, "RES": 0, "STREAM": -1, "STORE": 0,
        }
        data = await self.call("StandardApiAction_getVideoFileInfo.action", params)
        files = []
        for f in data.get("files") or []:
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
                down_url=str(f.get("DownUrl") or f.get("downUrl") or ""),
            ))
        files.sort(key=lambda x: (x.chn, x.beg))
        return files

    async def find_recordings(self, dev_id: str, day: date, chn: int, start: int, stop: int,
                              locations: list[int]) -> list[RecFile]:
        """Busca en cada ubicación (servidor primero) y devuelve la primera que tenga datos."""
        last_err: Exception | None = None
        for loc in locations:
            try:
                files = await self.search(dev_id, day, chn=chn, loc=loc)
            except CMSV6Error as e:
                last_err = e
                continue
            hits = [f for f in files if f.has_channel(chn) and f.covers(start, stop)]
            if hits:
                return hits
        if last_err:
            raise last_err
        return []

    def download_url(self, f: RecFile) -> str:
        """URL de descarga directa (DownUrl). La API la devuelve con jsession y SAVENAME vacíos."""
        if f.down_url:
            url = f.down_url
            if url.startswith("/"):
                url = f"http://{self.host}:6611{url}"
            parts = urlsplit(url)
        else:
            if f.loc != 1 and not f.path:
                raise CMSV6Error("CMSV6 no entregó enlace de descarga para este archivo "
                                 "(equipos JT/T 1078 solo permiten descarga por tareas).")
            parts = urlsplit(f"http://{self.host}:6611/3/5?" + urlencode({
                "DownType": 3, "DevIDNO": f.dev_id, "FLENGTH": f.size, "FOFFSET": 0,
                "MTYPE": 1, "FPATH": f.path}))
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["jsession"] = self.jsession or ""
        if not query.get("SAVENAME"):
            query["SAVENAME"] = os.path.basename(f.path.replace("\\", "/")) or "video"
        # CMSV6 suele devolver su IP interna; la reemplazamos por la pública
        netloc = f"{self.host}:{parts.port}" if parts.port else self.host
        return urlunsplit((parts.scheme or "http", netloc, parts.path, urlencode(query), ""))

    async def download(self, f: RecFile, dest: Path) -> Path:
        if not self.jsession:
            await self.login()
        url = self.download_url(f)
        log.info("Descargando %s", url)
        http = await self._http()
        tmp = dest.with_suffix(dest.suffix + ".part")
        timeout = aiohttp.ClientTimeout(total=None, sock_read=120)
        try:
            async with http.get(url, timeout=timeout) as r:
                r.raise_for_status()
                with tmp.open("wb") as fh:
                    async for chunk in r.content.iter_chunked(1 << 16):
                        fh.write(chunk)
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            tmp.unlink(missing_ok=True)
            raise CMSV6Error(f"Falló la descarga del archivo de grabación: {e}") from e
        if tmp.stat().st_size < 1024:
            body = tmp.read_bytes()[:300]
            tmp.unlink()
            raise CMSV6Error(f"CMSV6 devolvió un archivo vacío o un error: {body!r}")
        tmp.rename(dest)
        return dest


def _file_channels(f: dict) -> list[int]:
    """Según la documentación: primero se revisa chnMask (bit 0 = cámara 1); si es 0, se usa chn."""
    mask = int(f.get("chnMask") or 0)
    if mask:
        return [i for i in range(32) if mask & (1 << i)]
    return [max(0, int(f.get("chn") or 0))]
