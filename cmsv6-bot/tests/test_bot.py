import asyncio
import subprocess
import time
from datetime import date, time as dtime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from app import links, parsing, video
from app.cmsv6 import CMSV6, CMSV6Error, RecFile, _file_channels


def test_parse_date_and_time():
    assert parsing.parse_date("19/10/2026") == date(2026, 10, 19)
    assert parsing.parse_date("2026-10-19") == date(2026, 10, 19)
    assert parsing.parse_date("19/10").month == 10
    assert parsing.parse_time("14:05:30") == dtime(14, 5, 30)
    assert parsing.parse_time("8") == dtime(8, 0)
    with pytest.raises(parsing.ParseError):
        parsing.parse_time("25:00")
    with pytest.raises(parsing.ParseError):
        parsing.parse_date("mañana")


def test_parse_channels():
    assert parsing.parse_channels("todos", 4) == [0, 1, 2, 3]
    assert parsing.parse_channels("1,3", 4) == [0, 2]
    with pytest.raises(parsing.ParseError):
        parsing.parse_channels("5", 4)


def test_links_sign_and_expire(monkeypatch):
    monkeypatch.setattr(links.config.__class__, "link_secret", "s", raising=False)
    object.__setattr__(links.config, "link_secret", "s")
    object.__setattr__(links.config, "public_url", "http://1.2.3.4:8088")
    url = links.make_link(Path("ABC_cam1.mp4"))
    _, _, exp, sig, name = url.split("/", 2)[2].split("/")
    assert links.verify(name, int(exp), sig)
    assert not links.verify(name, int(exp), "0" * 32)
    assert not links.verify(name, int(exp), sig, now=int(exp) + 1)
    assert not links.verify("../x", int(exp), sig)


def test_file_channels():
    assert _file_channels({"chn": 2, "chnMask": 0}) == [2]
    assert _file_channels({"chn": 0, "chnMask": 0b101}) == [0, 2]


def test_download_url_fills_session_and_savename():
    cms = CMSV6("http://47.88.25.163:8088", "u", "p")
    cms.jsession = "J9"
    # Formato exacto del ejemplo de la documentación de CMSV6
    f = RecFile("1235", 1, 31044, 32842, "H20100628-083724P2N2P0.264", 23211837, 2,
                "http://192.168.1.10:6604/3/5?DownType=3&jsession=&DevIDNO=1235&FLENGTH=23211837"
                "&FOFFSET=0&MTYPE=1&FPATH=H20100628-083724P2N2P0.264&SAVENAME=")
    url = cms.download_url(f)
    assert url.startswith("http://47.88.25.163:6604/3/5?")
    assert "jsession=J9" in url and "SAVENAME=H20100628-083724P2N2P0.264" in url


def _make_raw(path: Path, seconds: int) -> None:
    # Flujo H.264 crudo (.264), como el que guardan muchos MDVR
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"testsrc=size=1280x720:rate=15:duration={seconds}",
                    "-c:v", "libx264", "-preset", "ultrafast", "-f", "h264", str(path)], check=True)


@pytest.mark.asyncio
async def test_end_to_end_clip(tmp_path, monkeypatch):
    raw = tmp_path / "seg.264"
    _make_raw(raw, 60)
    calls = []

    async def login(r):
        return web.json_response({"result": 0, "jsession": "J1"})

    async def search(r):
        calls.append(dict(r.query))
        # Dos archivos de 60 s: 14:00:00–14:01:00 y 14:01:00–14:02:00, canal 0
        return web.json_response({"result": 0, "files": [
            {"beg": 50400, "end": 50460, "chn": 0, "file": "/rec/a.264", "len": raw.stat().st_size,
             "loc": 2, "DownUrl": f"http://10.0.0.5:{port}/3/5?FPATH=/rec/a.264"},
            {"beg": 50460, "end": 50520, "chn": 0, "file": "/rec/b.264", "len": raw.stat().st_size,
             "loc": 2, "DownUrl": f"http://10.0.0.5:{port}/3/5?FPATH=/rec/b.264"},
        ]})

    async def download(r):
        assert r.query["jsession"] == "J1"
        return web.FileResponse(raw)

    app = web.Application()
    app.router.add_get("/StandardApiAction_login.action", login)
    app.router.add_get("/StandardApiAction_getVideoFileInfo.action", search)
    app.router.add_get("/3/5", download)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    from app import main
    object.__setattr__(main.config, "data_dir", tmp_path / "data")
    cms = CMSV6(f"http://127.0.0.1:{port}", "u", "p")
    monkeypatch.setattr(main, "cms", cms)

    status = MagicMock(edit_text=AsyncMock())
    v = main.Vehicle(plate="ABC123", dev_id="D1", channels=2, channel_names=["Frente", "Cabina"])
    out = await main.make_clip(v, 0, date(2026, 10, 19), 50430, 50490, status)  # 14:00:30–14:01:30

    dur = await video.probe_duration(out)
    assert 58 <= dur <= 62, dur
    assert out.name == "ABC123_cam1_20260101_140030-140130.mp4".replace("20260101", "20261019")
    assert out.stat().st_size < 2 * raw.stat().st_size
    # CMSV7: en el servidor de almacenamiento se busca por placa
    assert calls[0]["DevIDNO"] == "ABC123" and calls[0]["LOC"] == "2"
    # El DownUrl trae una IP interna (10.0.0.5): debe reemplazarse por la del servidor
    f = RecFile("D1", 0, 0, 60, "/x", 1, 2, "http://10.0.0.5:6611/3/5?a=1")
    assert cms.download_url(f) == "http://127.0.0.1:6611/3/5?a=1&jsession=J1&SAVENAME=x"

    jpg = tmp_path / "f.jpg"
    await video.extract_frame(raw, jpg, 10)
    assert jpg.stat().st_size > 1000
    await cms.close()
    await runner.cleanup()


@pytest.mark.asyncio
async def test_segment_download_from_vehicle(tmp_path, monkeypatch):
    """Grabación solo en el equipo, sin DownUrl (JT/T 1078): se pide por tramos y se baja el MP4."""
    seg = tmp_path / "seg.264"
    _make_raw(seg, 60)
    state = {"polls": 0, "task": None}

    async def login(r):
        return web.json_response({"result": 0, "jsession": "J1"})

    async def search(r):
        if r.query["LOC"] != "1":
            return web.json_response({"result": 0, "files": []})
        assert r.query["DevIDNO"] == "D1"  # en el equipo se busca por número de equipo
        return web.json_response({"result": 0, "files": [{
            "beg": 50400, "end": 52200, "chn": 0, "chnMask": 0, "file": "/rec/x.264",
            "len": 999, "loc": 1, "stream": -1, "DownUrl": "",
            "DownTaskUrl": f"http://10.0.0.5:{port}/StandardApiAction_addDownloadTask.action?jsession=&did=D1"
                           "&fbtm=2026-10-19 14:00:00&fetm=2026-10-19 14:30:00&sbtm=2026-10-19 14:00:00"
                           "&setm=2026-10-19 14:30:00&lab=&fph=/rec/x.264&vtp=0&len=999&chn=0&dtp=1"}]})

    async def add_task(r):
        state["task"] = dict(r.query)
        return web.json_response({"result": 0})

    async def tasks(r):
        state["polls"] += 1
        stu = 2 if state["polls"] < 2 else 4
        return web.json_response({"result": 0, "infos": [{
            "stu": stu, "downUrl": f"http://10.0.0.5:{port}/3/5?DownType=3&jsession=&FPATH=seg.mp4&SAVENAME="}]})

    async def download(r):
        assert r.query["jsession"] == "J1" and r.query["SAVENAME"]
        return web.FileResponse(seg)

    app = web.Application()
    app.router.add_get("/StandardApiAction_login.action", login)
    app.router.add_get("/StandardApiAction_getVideoFileInfo.action", search)
    app.router.add_get("/StandardApiAction_addDownloadTask.action", add_task)
    app.router.add_get("/StandardApiAction_downloadTasklist.action", tasks)
    app.router.add_get("/3/5", download)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    from app import cmsv6 as cmsv6_mod, main
    real_sleep = asyncio.sleep
    monkeypatch.setattr(cmsv6_mod.asyncio, "sleep", lambda s: real_sleep(0))
    object.__setattr__(main.config, "data_dir", tmp_path / "data")
    object.__setattr__(main.config, "search_locations", [2, 1])
    cms = CMSV6(f"http://127.0.0.1:{port}", "u", "p")
    monkeypatch.setattr(main, "cms", cms)

    status = MagicMock(edit_text=AsyncMock())
    v = main.Vehicle(plate="ABC123", dev_id="D1", channels=1, channel_names=[])
    # 14:10:00–14:11:00 de un archivo de 14:00 a 14:30 que está en el vehículo
    out = await main.make_clip(v, 0, date(2026, 10, 19), 51000, 51060, status)

    t = state["task"]
    assert t["fbtm"] == "2026-10-19 14:10:00" and t["fetm"] == "2026-10-19 14:11:00"
    assert t["dtp"] == "2" and t["lab"].startswith("bot") and t["jsession"] == "J1"
    assert t["sbtm"] == "2026-10-19 14:00:00"
    dur = await video.probe_duration(out)
    assert 58 <= dur <= 62, dur
    await cms.close()
    await runner.cleanup()


@pytest.mark.asyncio
async def test_parse_real_vehicle_list(monkeypatch):
    """Formato real devuelto por el servidor CMSV7 de COF (queryUserVehicle)."""
    cms = CMSV6("http://x:8088", "u", "p")
    sample = {"result": 0, "vehicles": [
        {"id": 685, "nm": "SRRX58", "ic": 6, "pid": 15, "pnm": "CAMILO HENRIQUEZ",
         "dl": [{"id": "010314376127", "pid": 5, "cc": 5, "cn": "CH1,CH2,CH3,CH4,CH5", "md": 361}],
         "chnCount": 5}]}
    monkeypatch.setattr(cms, "call", AsyncMock(return_value=sample))
    v = await cms.find_vehicle("srrx-58")
    assert (v.plate, v.dev_id, v.channels, v.company) == ("SRRX58", "010314376127", 5, "CAMILO HENRIQUEZ")
    assert v.channel_label(4) == "cam5 (CH5)"


@pytest.mark.asyncio
async def test_session_reused_and_refreshed(tmp_path, monkeypatch):
    f = tmp_path / ".jsession"
    f.write_text("OLD")
    cms = CMSV6("http://x:8088", "u", "p", f)
    sent = []

    async def raw(action, params):
        sent.append((action, params.get("jsession")))
        if action.endswith("login.action"):
            return {"result": 0, "jsession": "NEW"}
        return {"result": 5} if params["jsession"] == "OLD" else {"result": 0, "ok": 1}

    monkeypatch.setattr(cms, "_raw", raw)
    assert (await cms.call("StandardApiAction_x.action"))["ok"] == 1
    # Primero reutiliza la guardada, ante «sesión no existe» inicia sesión y la guarda
    assert [a for a, _ in sent] == ["StandardApiAction_x.action",
                                    "StandardApiAction_login.action", "StandardApiAction_x.action"]
    assert f.read_text() == "NEW"


@pytest.mark.asyncio
async def test_single_sign_on_message(monkeypatch):
    cms = CMSV6("http://x:8088", "cof", "p")
    monkeypatch.setattr(cms, "_raw", AsyncMock(return_value={"result": 34}))
    with pytest.raises(Exception, match="inicio de sesión único"):
        await cms.login()


def test_split_mode():
    from app.main import _split_mode
    assert _split_mode(["X", "todos", "hoy", "10:00", "10:02", "juntas"]) == (
        ["X", "todos", "hoy", "10:00", "10:02"], True, False)
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "Separadas"])[1] is False
    assert _split_mode(["X", "1", "hoy", "10:00", "10:02"])[1:] == (False, False)
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "juntas", "rápido"]) == (
        ["X", "1,3", "hoy", "10:00", "10:02"], True, True)


def test_pick_stream_avoids_double_download():
    from app.cmsv6 import _pick_stream
    main_ = RecFile("D", 0, 100, 250, "m1", 900, 1, "", stream_type=0)
    sub_ = RecFile("D", 0, 100, 250, "s1", 200, 1, "", stream_type=1)
    nxt = RecFile("D", 0, 250, 400, "m2", 900, 1, "", stream_type=0)
    assert [f.path for f in _pick_stream([sub_, main_, nxt], False)] == ["m1", "m2"]
    # La liviana solo cubre la mitad del horario → se usa la principal
    assert [f.path for f in _pick_stream([sub_, main_, nxt], True)] == ["m1", "m2"]
    sub2 = RecFile("D", 0, 250, 400, "s2", 200, 1, "", stream_type=1)
    assert [f.path for f in _pick_stream([sub_, main_, nxt, sub2], True)] == ["s1", "s2"]
    # Sin streamtype: dos archivos del mismo tramo → uno solo
    a = RecFile("D", 0, 100, 250, "a", 900, 1, "")
    b = RecFile("D", 0, 101, 249, "b", 300, 1, "")
    assert [f.path for f in _pick_stream([a, b], False)] == ["a"]
    assert [f.path for f in _pick_stream([a, b], True)] == ["b"]


@pytest.mark.asyncio
async def test_mosaic_video_and_photo(tmp_path):
    clips = []
    for i, size in enumerate(["1280x720", "704x576", "640x480", "1280x720", "1280x720"]):
        p = tmp_path / f"c{i}.mp4"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        f"testsrc=size={size}:rate=15:duration=4", "-c:v", "libx264",
                        "-preset", "ultrafast", str(p)], check=True)
        clips.append(p)
    out = await video.mosaic(clips, tmp_path / "m.mp4")  # 5 cámaras → 3x2 con una celda negra
    dims = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height", "-of", "csv=p=0", str(out)],
                          capture_output=True, text=True).stdout.strip()
    assert dims == "1920,720"
    assert 3.5 <= await video.probe_duration(out) <= 4.5

    jpgs = []
    for i, c in enumerate(clips[:2]):
        jpgs.append(await video.extract_frame(c, tmp_path / f"f{i}.jpg", 1))
    img = await video.mosaic(jpgs, tmp_path / "m.jpg", image=True)  # 2 cámaras → 2x1
    dims = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
                           "-of", "csv=p=0", str(img)], capture_output=True, text=True).stdout.strip()
    assert dims == "1280,360"


@pytest.mark.asyncio
async def test_enlinea(monkeypatch):
    from app import main
    vs = [main.Vehicle("SPBS42", "1", 5, []), main.Vehicle("SPBS40", "2", 5, []),
          main.Vehicle("SRRX58", "3", 5, [])]
    monkeypatch.setattr(main.cms, "vehicles", AsyncMock(return_value=vs))
    monkeypatch.setattr(main.cms, "online_devices", AsyncMock(return_value={"1", "3"}))
    object.__setattr__(main.config, "allowed_users", [7])
    msg = MagicMock(reply_text=AsyncMock())
    upd = MagicMock(effective_user=MagicMock(id=7), effective_message=msg)
    await main.cmd_enlinea(upd, MagicMock(args=["spb"]))
    text = msg.reply_text.call_args.args[0]
    assert "1 de 2" in text and "SPBS42" in text and "SPBS40" not in text


@pytest.mark.asyncio
async def test_prefers_partial_download_and_falls_back(tmp_path, monkeypatch):
    """Bus con descarga directa y por tramos: pide solo los minutos; si el bus no responde,
    baja el archivo completo."""
    raw = tmp_path / "full.264"
    _make_raw(raw, 60)
    state = {"tasks": 0, "direct": 0, "stu": 4}

    async def login(r):
        return web.json_response({"result": 0, "jsession": "J1"})

    async def search(r):
        if r.query["LOC"] != "1":
            return web.json_response({"result": 0, "files": []})
        return web.json_response({"result": 0, "files": [{
            "beg": 50400, "end": 54000, "chn": 0, "file": "/rec/h.264", "len": raw.stat().st_size,
            "loc": 1, "stream": -1,
            "DownUrl": f"http://10.0.0.5:{port}/3/5?DownType=3&jsession=&FPATH=/rec/h.264&SAVENAME=",
            "DownTaskUrl": f"http://10.0.0.5:{port}/StandardApiAction_addDownloadTask.action?"
                           "jsession=&did=D1&fph=/rec/h.264&chn=0&dtp=1"}]})

    async def add_task(r):
        state["tasks"] += 1
        return web.json_response({"result": 0})

    async def tasks(r):
        return web.json_response({"result": 0, "infos": [{
            "stu": state["stu"],
            "downUrl": f"http://10.0.0.5:{port}/seg?FPATH=x.mp4&SAVENAME=x.mp4"}]})

    async def seg(r):
        return web.FileResponse(raw)

    async def direct(r):
        state["direct"] += 1
        return web.FileResponse(raw)

    app = web.Application()
    for path, h in [("/StandardApiAction_login.action", login),
                    ("/StandardApiAction_getVideoFileInfo.action", search),
                    ("/StandardApiAction_addDownloadTask.action", add_task),
                    ("/StandardApiAction_downloadTasklist.action", tasks),
                    ("/StandardApiAction_delDownloadTasklist.action", login),
                    ("/seg", seg), ("/3/5", direct)]:
        app.router.add_get(path, h)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]

    from app import cmsv6 as cmsv6_mod, main
    real_sleep = asyncio.sleep
    monkeypatch.setattr(cmsv6_mod.asyncio, "sleep", lambda s: real_sleep(0.01))
    object.__setattr__(main.config, "data_dir", tmp_path / "data")
    object.__setattr__(main.config, "search_locations", [2, 1])
    object.__setattr__(main.config, "segment_stall_s", 0)
    cms = CMSV6(f"http://127.0.0.1:{port}", "u", "p")
    monkeypatch.setattr(main, "cms", cms)
    status = MagicMock(edit_text=AsyncMock())
    v = main.Vehicle(plate="ABC123", dev_id="D1", channels=1, channel_names=[])

    # 1) Archivo de 1 hora, se piden 30 s → por tramos, sin bajar el archivo completo
    stats = {}
    await main.make_clip(v, 0, date(2026, 10, 19), 50410, 50440, status, stats)
    assert stats["metodo"] == "tramos" and state["tasks"] == 1 and state["direct"] == 0
    assert "solo los minutos pedidos" in main._timing(stats)

    # 2) El bus no avanza (stu=1) → se usa la descarga directa
    state["stu"] = 1
    stats = {}
    await main.make_clip(v, 0, date(2026, 10, 19), 50450, 50460, status, stats)
    assert stats["metodo"] == "directa" and state["direct"] == 1
    await cms.close()
    await runner.cleanup()


def test_own_task_ignores_other_tasks():
    from app.cmsv6 import _own_task
    infos = [{"lab": "", "stu": 3, "err": "viejo"}, {"lab": "botabc", "stu": 2}]
    assert _own_task(infos, "botabc")["stu"] == 2
    assert _own_task([{"lab": "otro", "stu": 3}], "botabc") == {}
    assert _own_task([{"stu": 4}], "botabc")["stu"] == 4


def test_matching_task_reuse():
    from datetime import datetime as dt
    from app.cmsv6 import _matching_task, _task_sec
    mid = dt(2026, 10, 20)
    f = RecFile("D", 0, 41400, 41549, "/mnt/rec/x.264", 1, 1, "", task_url="t")
    done = {"id": 7, "chn": 0, "stu": 4, "fph": "/mnt/rec/x.264",
            "fbtmStr": "2026-10-20 11:30:00", "fetmStr": "2026-10-20 11:32:00"}
    other_cam = dict(done, id=8, chn=2)
    failed = dict(done, id=9, stu=3)
    assert _task_sec(done, "fbtm", mid) == 41400
    ms = int(dt(2026, 10, 20, 11, 30).timestamp() * 1000)
    assert _task_sec({"fbtm": ms}, "fbtm", mid) == 41400
    assert _matching_task([failed, other_cam, done], f, mid, 41400, 41520)["id"] == 7
    assert _matching_task([done], f, mid, 41400, 41540) is None          # no cubre
    assert _matching_task([done], f, mid, 41400, 41540, loose=True)["id"] == 7


@pytest.mark.asyncio
async def test_segment_task_already_exists(monkeypatch, tmp_path):
    """Código 11 (la tarea ya existe): se espera la existente en vez de fallar."""
    cms = CMSV6("http://x:8088", "u", "p")
    cms.jsession = "J"
    f = RecFile("D", 0, 41400, 41549, "/r/x.264", 1, 1, "", task_url="http://x/add?did=D")
    calls = {"list": 0}
    task = {"id": 5, "chn": 0, "fph": "/r/x.264", "stu": 2,
            "fbtmStr": "2026-10-20 11:30:00", "fetmStr": "2026-10-20 11:32:00",
            "downUrl": "http://x:6611/3/5?FPATH=a&SAVENAME="}

    async def call(action, params=None):
        if "addDownloadTask" in action:
            raise CMSV6Error("ya existe", 11)
        if "downloadTasklist" in action:
            calls["list"] += 1
            # La primera consulta (antes de crear) aún no la muestra; luego aparece y termina
            if calls["list"] == 1:
                return {"infos": []}
            return {"infos": [dict(task, stu=4 if calls["list"] > 2 else 2)]}
        raise AssertionError(action)

    got = {}

    async def dl(url, dest, progress=None, total=0):
        got["url"] = url
        dest.write_bytes(b"x")
        return dest

    from app import cmsv6 as m
    real_sleep = asyncio.sleep
    monkeypatch.setattr(m.asyncio, "sleep", lambda s: real_sleep(0))
    monkeypatch.setattr(cms, "call", call)
    monkeypatch.setattr(cms, "_download_url", dl)
    v = m.Vehicle("SPBF25", "D", 5, [])
    path, beg = await cms.segment_download(v, f, date(2026, 10, 20), 41400, 41520, tmp_path / "s")
    assert beg == 41400 and "jsession=J" in got["url"]


def test_task_pct():
    from app.cmsv6 import _task_pct
    assert _task_pct({"stu": 2}) is None
    assert _task_pct({"percent": 40}) == 40
    assert _task_pct({"len": 200, "dlen": 50}) == 25


@pytest.mark.asyncio
async def test_live_clip_and_proxy(tmp_path, monkeypatch):
    import socket
    # Fuente en vivo simulada: FLV por HTTP y una lista HLS con 2 segmentos
    flv = tmp_path / "live.flv"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=640x360:rate=15:duration=8", "-c:v", "libx264", "-preset",
                    "ultrafast", "-f", "flv", str(flv)], check=True)
    seg = tmp_path / "seg0.ts"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(flv), "-t", "2", "-c", "copy",
                    "-f", "mpegts", str(seg)], check=True)

    async def flv_h(r):
        assert r.query["jsession"] == "J" and r.query["DevIDNO"] == "D1"
        return web.FileResponse(flv)

    async def m3u8_h(r):
        assert r.query["jsession"] == "J"
        return web.Response(text="#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nseg0.ts\n",
                            content_type="application/vnd.apple.mpegurl")

    async def ts_h(r):
        assert r.query.get("jsession") == "J"
        return web.FileResponse(seg, headers={"Content-Type": "video/mp2t"})

    up = web.Application()
    up.router.add_get("/3/3", flv_h)
    up.router.add_get("/hls/1_D1_0_1.m3u8", m3u8_h)
    up.router.add_get("/hls/seg0.ts", ts_h)
    r1 = web.AppRunner(up)
    await r1.setup()
    s1 = web.TCPSite(r1, "127.0.0.1", 0)
    await s1.start()
    port = s1._server.sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"

    cms = CMSV6("http://127.0.0.1:8088", "u", "p", media_url=base)
    cms.jsession = "J"
    out = await video.record_live(cms.live_flv_url(base, "D1", 0), tmp_path / "v.mp4", 4)
    assert 3 <= await video.probe_duration(out) <= 5.5

    # Proxy: el navegador nunca ve la sesión
    from app import links
    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        free = sk.getsockname()[1]
    object.__setattr__(links.config, "http_port", free)
    object.__setattr__(links.config, "public_url", f"http://127.0.0.1:{free}")
    object.__setattr__(links.config, "link_secret", "s")

    async def source(dev, chn):
        return cms.live_hls_url(base, dev, chn)
    links.set_live_source(source)
    r2 = await links.start_server()
    link = links.make_live_link("D1", "SPBS42", [0])
    import aiohttp
    async with aiohttp.ClientSession() as http:
        page = await (await http.get(link)).text()
        assert "SPBS42" in page and "0.m3u8" in page and "J" not in page.split("<script")[0]
        root = link.split("?")[0]
        pl = await (await http.get(root + "0.m3u8")).text()
        assert "jsession" not in pl and "p?c=0&u=" in pl
        seg_url = root + [l for l in pl.splitlines() if l.startswith("p?")][0]
        rs = await http.get(seg_url)
        assert rs.status == 200 and len(await rs.read()) == seg.stat().st_size
        # Enlace alterado → prohibido
        bad = link.replace("/D1/", "/D2/")
        assert (await http.get(bad)).status == 403
    await r2.cleanup()
    await r1.cleanup()
