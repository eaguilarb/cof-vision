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
    def __init__(self, msg: str, code: int | None = None):
        super().__init__(msg)
        self.code = code  # código «result» de CMSV7, si lo hay


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
    stream_type: int | None = None  # streamtype: 0 = calidad principal, 1 = secundaria (liviana)
    playback_url: str = ""  # PlaybackUrl: reproducción remota (el bus transmite el tramo)

    def has_channel(self, chn: int) -> bool:
        return chn in (self.chns or (self.chn,))

    def covers(self, start: int, stop: int) -> bool:
        return self.beg < stop and self.end > start


class CMSV6:
    def __init__(self, base_url: str, account: str, password: str,
                 session_file: Path | None = None, media_url: str = ""):
        self.base_url = base_url.rstrip("/")
        # Servidor de video (en vivo / reproducción). Si no se configura, se aprende de las
        # URLs de reproducción que entrega la búsqueda de grabaciones.
        self.media_url = media_url.rstrip("/")
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
            raise CMSV6Error(f"{action} devolvió result={result}: {data.get('message', '')}", result)
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
            if not self.media_url and f.get("PlaybackUrl"):
                base, _ = self._fix_url(str(f["PlaybackUrl"]))
                parts = urlsplit(base)
                self.media_url = f"{parts.scheme}://{parts.netloc}"
                log.info("Servidor de video de CMSV7: %s", self.media_url)
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
                stream_type=None if f.get("streamtype") is None else int(f["streamtype"]),
                playback_url=str(f.get("PlaybackUrl") or "").strip(),
            ))
        files.sort(key=lambda x: (x.chn, x.beg))
        return files

    async def find_recordings(self, v: Vehicle, day: date, chn: int, start: int, stop: int,
                              locations: list[int], prefer_sub: bool = False) -> list[RecFile]:
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
                return _pick_stream(hits, prefer_sub)
        if last_err:
            raise last_err
        return []

    def media_bases(self) -> list[str]:
        """Direcciones posibles del servidor de video, de la más probable a la menos."""
        bases = [self.media_url] if self.media_url else []
        for port in (6604, 6603):
            b = f"http://{self.host}:{port}"
            if b not in bases:
                bases.append(b)
        return bases

    def live_flv_url(self, base: str, dev_id: str, chn: int, stream: int = 1) -> str:
        """Video en vivo HTTP-FLV (stream 1 = calidad secundaria, más liviana para 4G)."""
        return f"{base}/3/3?" + urlencode({"AVType": 1, "jsession": self.jsession or "",
                                           "DevIDNO": dev_id, "Channel": chn, "Stream": stream})

    def live_hls_url(self, base: str, dev_id: str, chn: int, stream: int = 1) -> str:
        return f"{base}/hls/1_{dev_id}_{chn}_{stream}.m3u8?" + urlencode(
            {"jsession": self.jsession or ""})

    def playback_stream_url(self, f: RecFile, start: int, stop: int) -> str:
        """Reproducción remota: el bus transmite [start, stop] como un video en vivo."""
        if not f.playback_url:
            raise CMSV6Error("CMSV7 no entregó URL de reproducción para este archivo.")
        # La URL de ejemplo de CMSV7 viene mal armada («jsession=DevIDNO=…»): se corrige
        raw = f.playback_url.replace("jsession=DevIDNO=", "jsession=&DevIDNO=")
        base, q = self._fix_url(raw)
        q.update({"jsession": self.jsession or "", "PLAYBEG": start, "PLAYEND": stop})
        return f"{base}?{urlencode(q)}"

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
                               stall_s: int | None = None, dl_progress=None) -> tuple[Path, int]:
        """Pide a CMSV6 que baje del equipo solo el tramo [start, stop] y luego lo descarga.

        Si ya hay una tarea del mismo tramo (de un pedido anterior, terminada o en curso), se
        reutiliza en vez de pedirla otra vez al bus. Devuelve el archivo y el segundo del día
        en que empieza."""
        if not f.task_url:
            raise CMSV6Error("CMSV6 no ofrece descarga por tramos para este archivo.")
        a, b = max(start, f.beg), min(stop, f.end)
        midnight = datetime(day.year, day.month, day.day)
        fmt = lambda sec: (midnight + timedelta(seconds=sec)).strftime("%Y-%m-%d %H:%M:%S")
        day_range = {"devIdno": f.dev_id, "begintime": fmt(0), "endtime": fmt(86399 + 86400)}

        async def task_list() -> list[dict]:
            data = await self.call("StandardApiAction_downloadTasklist.action", day_range)
            return data.get("infos") or []

        tag = "bot" + secrets.token_hex(4)
        own = None  # (campo, valor) que identifica nuestra tarea en la lista
        task_beg = a
        existing = _matching_task(await task_list(), f, midnight, a, b)
        if existing:
            own = ("id", existing.get("id"))
            task_beg = _task_sec(existing, "fbtm", midnight)
            log.info("Se reutiliza la tarea %s (estado %s)", existing.get("id"), existing.get("stu"))
        else:
            _, query = self._fix_url(f.task_url)
            query.pop("jsession", None)
            query.update({"fbtm": fmt(a), "fetm": fmt(b), "lab": tag, "dtp": 2})
            query.setdefault("sbtm", fmt(f.beg))
            query.setdefault("setm", fmt(f.end))
            try:
                await self.call("StandardApiAction_addDownloadTask.action", query)
                own = ("lab", tag)
                log.info("Tarea de descarga por tramos %s creada (%s – %s)", tag, fmt(a), fmt(b))
            except CMSV6Error as e:
                if e.code != 11:  # 11 = la tarea ya existe
                    raise
                existing = _matching_task(await task_list(), f, midnight, a, b, loose=True)
                if not existing:
                    raise CMSV6Error("Ya hay una descarga en curso de esa grabación en CMSV7. "
                                     "Intenta de nuevo en unos minutos.") from e
                own = ("id", existing.get("id"))
                task_beg = _task_sec(existing, "fbtm", midnight)

        started = time.monotonic()
        deadline = started + timeout_s
        info: dict = existing or {}
        try:
            info = await self._wait_task(f, own, tag, info, task_list, progress, started,
                                         deadline, stall_s)
        except asyncio.CancelledError:
            # /cancelar: se borra la tarea para que el bus deje de enviar
            if own[0] == "lab":
                await asyncio.shield(self._delete_task(f.dev_id, tag))
            raise
        if info.get("stu") != 4:
            raise CMSV6Error("El vehículo tardó demasiado en enviar el video "
                             "(¿está apagado o sin señal?). La tarea sigue en CMSV6; intenta más tarde.")

        url = str(info.get("downUrl") or "").strip()
        if url:
            base, q = self._fix_url(url)
            q["jsession"] = self.jsession or ""
            if not q.get("SAVENAME"):
                q["SAVENAME"] = tag + ".mp4"
            # Recién terminada, CMSV7 a veces entrega el archivo vacío unos segundos: se reintenta
            for attempt in range(4):
                try:
                    await self._download_url(f"{base}?{urlencode(q)}", dest, dl_progress,
                                             int(info.get("len") or 0))
                    return dest, task_beg
                except CMSV6Error as e:
                    log.info("Descarga del tramo terminado, intento %d: %s", attempt + 1, e)
                    await asyncio.sleep(5)
        # Sin enlace (o no responde): el archivo ya está en el servidor de almacenamiento
        for rec in await self.search(v, day, chn=f.chn, loc=2):
            if rec.has_channel(f.chn) and rec.covers(a, b):
                await self.download(rec, dest)
                return dest, rec.beg
        raise CMSV6Error("La descarga terminó pero no encontré el archivo en el servidor.")

    async def ftp_download(self, dev_id: str, chn: int, day: date, start: int, stop: int,
                           dest: Path, progress=None, dl_progress=None, stream: int = 0,
                           timeout_s: int = 1800) -> Path:
        """Método FTP (como en el aplicativo): el bus sube el horario pedido directo al FTP de
        CMSV7 en un solo archivo (AVI) y luego se descarga del servidor.

        Una sola tarea por cámara para todo el horario (no una por archivo de grabación)."""
        end = min(stop, 86399)
        params = {"DevIDNO": dev_id, "CHN": chn,
                  "BEGYEAR": day.year, "BEGMON": day.month, "BEGDAY": day.day, "BEGSEC": start,
                  "ENDYEAR": day.year, "ENDMON": day.month, "ENDDAY": day.day, "ENDSEC": end,
                  "ARM1": 0, "ARM2": 0, "RES": 0, "STREAM": stream, "STORE": 0,
                  "NETMASK": 7}  # WiFi + LAN + 4G
        data = await self.call("StandardApiAction_ftpUpload.action", params)
        seq = data.get("SEQUENCE", data.get("sequence"))
        if seq is None:
            raise CMSV6Error(f"CMSV7 no devolvió número de tarea FTP: {data}")
        log.info("Tarea FTP %s creada (equipo %s, cam%d, %s–%s)", seq, dev_id, chn + 1, start, end)
        started = time.monotonic()
        info: dict = {}
        logged = False
        try:
            while time.monotonic() - started < timeout_s:
                await asyncio.sleep(2)
                data = await self.call("StandardApiAction_queryFtpStatus.action",
                                       {"seq": seq, "devIdno": dev_id})
                info = data.get("info") or {}
                if isinstance(info, list):
                    info = info[0] if info else {}
                st = info.get("status", info.get("taskStatus"))
                if not logged and st == 1:
                    logged = True
                    log.info("Tarea FTP en curso (campos de CMSV7): %s", info)
                if progress:
                    await progress({0: "en pausa", 1: "el bus está subiendo por FTP",
                                    4: "listo"}.get(st, "esperando que el bus responda"),
                                   st, time.monotonic() - started, _task_pct(info))
                if st in (2, 3):
                    log.warning("Tarea FTP %s terminó con estado %s: %s", seq, st, info)
                    raise CMSV6Error("El bus no pudo subir el video por FTP"
                                     + (" (cancelada)" if st == 2 else ""))
                if st == 4 and info.get("downloadUrl"):
                    break
            else:
                await self._ftp_cancel(dev_id, seq)
                raise CMSV6Error("El bus tardó demasiado en subir el video por FTP.")
        except asyncio.CancelledError:
            await asyncio.shield(self._ftp_cancel(dev_id, seq))
            raise
        base, q = self._fix_url(str(info["downloadUrl"]))
        q["jsession"] = self.jsession or ""
        for attempt in range(4):
            try:
                return await self._download_url(f"{base}?{urlencode(q)}", dest, dl_progress,
                                                int(q.get("FLENGTH") or 0))
            except CMSV6Error as e:
                log.info("Descarga del archivo FTP, intento %d: %s", attempt + 1, e)
                await asyncio.sleep(5)
        raise CMSV6Error("El video se subió por FTP pero no se pudo descargar del servidor.")

    async def _ftp_cancel(self, dev_id: str, seq) -> None:
        try:
            await self.call("StandardApiAction_controllDownLoad.action",
                            {"seq": seq, "devIdno": dev_id, "taskType": 2})
            log.info("Tarea FTP %s cancelada", seq)
        except Exception as e:
            log.info("No se pudo cancelar la tarea FTP %s: %s", seq, e)

    async def _delete_task(self, dev_id: str, tag: str) -> None:
        try:
            await self.call("StandardApiAction_delDownloadTasklist.action",
                            {"devIdno": dev_id, "taskTag": tag})
            log.info("Tarea %s cancelada en CMSV7", tag)
        except Exception as e:
            log.info("No se pudo cancelar la tarea %s: %s", tag, e)

    async def _wait_task(self, f, own, tag, info, task_list, progress, started, deadline,
                         stall_s) -> dict:
        first = True
        logged = False
        while info.get("stu") != 4 and time.monotonic() < deadline:
            if not first:
                await asyncio.sleep(3)
            first = False
            infos = await task_list()
            info = (_own_task(infos, own[1]) if own[0] == "lab"
                    else next((i for i in infos if i.get("id") == own[1]), {}))
            stu = info.get("stu")
            if stu == 2 and not logged:
                logged = True
                log.info("Tarea en curso (campos de CMSV7): %s", info)
            if progress:
                # (texto, estado, segundos transcurridos, % informado por CMSV7 o None)
                await progress({1: "esperando que el bus responda", 2: "el bus está enviando",
                                4: "listo"}.get(stu, "esperando que el bus responda"),
                               stu, time.monotonic() - started, _task_pct(info))
            if stu == 3:
                log.warning("Tarea %s fallida: %s", own[1], info)
                raise CMSV6Error(f"El vehículo no pudo enviar el video: {info.get('err') or 'sin detalle'}")
            # stu 1 = en espera: el vehículo aún no empieza a enviar
            if (stall_s is not None and own[0] == "lab" and stu in (None, 1)
                    and time.monotonic() - started > stall_s):
                # Se cancela la tarea para que no compita por el 4G del bus con el plan B
                await self._delete_task(f.dev_id, tag)
                raise CMSV6Error(f"El vehículo no empezó a enviar el tramo en {stall_s} s.")
        return info

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
                    async for chunk in r.content.iter_chunked(1 << 20):
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


def _pick_stream(files: list[RecFile], prefer_sub: bool) -> list[RecFile]:
    """Muchos equipos graban cada cámara dos veces (calidad principal y secundaria).
    Se usa una sola: si no, se bajaría el mismo minuto dos veces."""
    types = {f.stream_type for f in files}
    if len(types) > 1:
        want = 1 if prefer_sub else 0
        dur = lambda fs: sum(f.end - f.beg for f in fs)
        chosen = [f for f in files if f.stream_type == want]
        others = [f for f in files if f.stream_type != want]
        # Solo si esa calidad cubre el horario; si no, se usa la otra
        files = chosen if dur(chosen) >= 0.9 * dur(others) else others
    kept: list[RecFile] = []
    for f in sorted(files, key=lambda x: x.beg):
        prev = kept[-1] if kept else None
        overlap = (min(prev.end, f.end) - max(prev.beg, f.beg)) if prev else 0
        if prev and overlap > 0.5 * min(prev.end - prev.beg, f.end - f.beg):
            # Dos archivos del mismo tramo: el más liviano si se pidió rapidez, si no el mejor
            better = (f.size < prev.size) if prefer_sub else (f.size > prev.size)
            if better:
                kept[-1] = f
            continue
        kept.append(f)
    return kept


def _task_pct(info: dict) -> int | None:
    """Avance de una tarea de descarga, si CMSV7 lo informa (el campo cambia según versión)."""
    for k in ("percent", "per", "progress", "pct", "rate", "downRate"):
        try:
            v = float(info[k])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= v <= 1 and k in ("rate", "downRate") and isinstance(info[k], float):
            v *= 100
        if 0 <= v <= 100:
            return int(v)
    total = info.get("len") or 0
    for k in ("dlen", "downLen", "curLen", "curlen", "downSize", "dsize"):
        try:
            done = float(info[k])
        except (KeyError, TypeError, ValueError):
            continue
        if total:
            return max(0, min(100, int(done * 100 / float(total))))
    return None


def _task_sec(info: dict, field: str, midnight: datetime) -> int:
    """Hora de una tarea (fbtm/fetm) en segundos desde la medianoche del día pedido.

    CMSV7 la entrega como texto («fbtmStr») o como milisegundos desde 1970."""
    txt = info.get(field + "Str")
    if txt:
        try:
            return int((datetime.strptime(str(txt), "%Y-%m-%d %H:%M:%S") - midnight).total_seconds())
        except ValueError:
            pass
    raw = info.get(field)
    try:
        n = int(raw)
    except (TypeError, ValueError):
        try:
            return int((datetime.strptime(str(raw), "%Y-%m-%d %H:%M:%S") - midnight).total_seconds())
        except ValueError:
            return -1
    if n > 10**11:
        n //= 1000
    if n > 10**8:
        return int((datetime.fromtimestamp(n) - midnight).total_seconds())
    return n


def _matching_task(infos: list[dict], f: RecFile, midnight: datetime, a: int, b: int,
                   loose: bool = False) -> dict | None:
    """Tarea ya existente del mismo archivo y cámara que cubra [a, b] (o, con loose, que se
    superponga). Se prefiere una ya terminada."""
    name = os.path.basename(f.path.replace("\\", "/"))
    found = []
    for i in infos:
        if i.get("stu") == 3 or int(i.get("chn", -1)) != f.chn:
            continue
        fph = os.path.basename(str(i.get("fph") or "").replace("\\", "/"))
        if name and fph and fph != name:
            continue
        tb, te = _task_sec(i, "fbtm", midnight), _task_sec(i, "fetm", midnight)
        if tb < 0 or te < 0:
            continue
        if (tb <= a + 1 and te >= b - 1) or (loose and tb < b and te > a):
            found.append(i)
    found.sort(key=lambda i: i.get("stu") != 4)
    return found[0] if found else None


def _own_task(infos: list[dict], tag: str) -> dict:
    """La lista de tareas puede traer tareas de otros pedidos (o ignorar el filtro):
    se usa solo la que lleva nuestra etiqueta."""
    mine = [i for i in infos if str(i.get("lab") or "") == tag]
    if mine:
        return mine[0]
    if infos and all("lab" not in i for i in infos) and len(infos) == 1:
        return infos[0]  # el servidor no informa etiquetas: si hay una sola, es la nuestra
    return {}


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
