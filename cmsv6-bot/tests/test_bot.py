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
        ["X", "todos", "hoy", "10:00", "10:02"], True, False, None)
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "Separadas"])[1] is False
    assert _split_mode(["X", "1", "hoy", "10:00", "10:02"])[1:] == (False, False, None)
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "juntas", "rápido"]) == (
        ["X", "1,3", "hoy", "10:00", "10:02"], True, True, None)
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "juntas", "audio3"])[1:] == (
        True, False, 2)
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "audio:1", "juntas"])[3] == 0
    assert _split_mode(["X", "1,3", "hoy", "10:00", "10:02", "juntas", "sinaudio"])[3] == -1


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
    assert "el bus subió el tramo" in main._timing(stats)

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
        # Se envía a velocidad de «en vivo» (8 s de video en ~8 s)
        assert r.query["jsession"] == "J" and r.query["DevIDNO"] == "D1"
        resp = web.StreamResponse(headers={"Content-Type": "video/x-flv"})
        await resp.prepare(r)
        data = flv.read_bytes()
        step = max(1, len(data) // 80)
        try:
            for i in range(0, len(data), step):
                await resp.write(data[i:i + step])
                await asyncio.sleep(0.1)
        except (ConnectionResetError, Exception):
            pass
        return resp

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
    # Al menos los segundos pedidos (puede traer un poco más del arranque)
    assert 3.5 <= await video.probe_duration(out) <= 7.5

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


@pytest.mark.asyncio
async def test_snapshot_live(tmp_path):
    src = tmp_path / "live.flv"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=640x360:rate=15:duration=4", "-c:v", "libx264", "-preset",
                    "ultrafast", "-f", "flv", str(src)], check=True)
    out = await video.snapshot_live(str(src), tmp_path / "f.jpg")
    assert out.stat().st_size > 1024



@pytest.mark.asyncio
async def test_tracker_message():
    from app import main
    msg = MagicMock(edit_text=AsyncMock())
    t = main.Tracker(msg, "🎥 SPBG22 · cámaras 1, 3 juntas")
    c1, c3 = t.cam(0, "cam1"), t.cam(2, "cam3")
    await c1.set("📡 el bus está enviando", 40, 90)
    await c3.set("✅ lista", 100, 0)
    await t.render(force=True)
    t.stop()
    text = msg.edit_text.call_args.args[0]
    assert "70%" in text and "faltan 30%" in text and "~1:" in text
    assert "• cam1: 40%" in text and "• cam3: 100%" in text


@pytest.mark.asyncio
async def test_cancelar_stops_request_and_bus_task(monkeypatch, tmp_path):
    """/cancelar detiene el pedido, borra la tarea en CMSV7 y marca el mensaje como cancelado."""
    from app import main
    from app import cmsv6 as m
    object.__setattr__(main.config, "allowed_users", [7])
    object.__setattr__(main.config, "data_dir", tmp_path)
    object.__setattr__(main.config, "download_method", "tramos")
    deleted = []

    async def call(action, params=None):
        if "downloadTasklist" in action:
            return {"infos": [{"lab": "x", "stu": 2}]}  # nunca termina
        if "delDownloadTasklist" in action:
            deleted.append(params["taskTag"])
        return {"result": 0}

    real_sleep = asyncio.sleep
    monkeypatch.setattr(m.asyncio, "sleep", lambda s: real_sleep(0.01))
    monkeypatch.setattr(main.cms, "call", call)
    f = RecFile("D1", 0, 50400, 50600, "/r/x.264", 1, 1, "", task_url="http://x/add?did=D1")
    monkeypatch.setattr(main.cms, "find_recordings", AsyncMock(return_value=[f]))
    monkeypatch.setattr(main.cms, "find_vehicle",
                        AsyncMock(return_value=main.Vehicle("SPBG22", "D1", 5, [])))
    status = MagicMock(edit_text=AsyncMock(), chat_id=55)
    msg = MagicMock(reply_text=AsyncMock(return_value=status))
    chat = MagicMock(id=55)
    upd = MagicMock(effective_user=MagicMock(id=7), effective_message=msg, effective_chat=chat)

    job = asyncio.create_task(main.cmd_video(upd, MagicMock(args=["SPBG22", "1", "hoy", "14:00", "14:01"])))
    for _ in range(50):
        await real_sleep(0.02)
        if main._trackers.get(55):
            break
    await main.cmd_cancelar(upd, MagicMock(args=[]))
    await job
    assert job.done() and not job.cancelled() or job.cancelled()
    assert deleted and deleted[0].startswith("bot")
    texts = [c.args[0] for c in status.edit_text.call_args_list]
    assert any("Cancelado" in t for t in texts)
    assert "Se detuvieron 1" in msg.reply_text.call_args.args[0]


def test_playback_stream_url_fixes_cmsv7_format():
    cms = CMSV6("http://47.88.25.163:8088", "u", "p")
    cms.jsession = "J"
    f = RecFile("D1", 0, 31044, 32842, "H.264", 1, 1, "", playback_url=(
        "http://10.0.0.2:6604/3/5?DownType=5&&jsession=DevIDNO=D1&FILELOC=1&FILESVR=0"
        "&FILECHN=0&FILEBEG=31044&FILEEND=32842&PLAYIFRM=0&PLAYFILE=H.264"
        "&PLAYBEG=31044&PLAYEND=32842&PLAYCHN=0"))
    url = cms.playback_stream_url(f, 31100, 31160)
    assert url.startswith("http://47.88.25.163:6604/3/5?")
    assert "DevIDNO=D1" in url and "jsession=J" in url
    assert "PLAYBEG=31100" in url and "PLAYEND=31160" in url


@pytest.mark.asyncio
async def test_adaptive_prefers_playback_and_falls_back(tmp_path, monkeypatch):
    """Con reproducción remota disponible se usa primero; si falla, sigue con otro método
    y recuerda el fallo para los próximos pedidos."""
    flv = tmp_path / "pb.flv"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=640x360:rate=15:duration=20", "-c:v", "libx264", "-preset",
                    "ultrafast", "-f", "flv", str(flv)], check=True)
    raw = tmp_path / "full.264"
    _make_raw(raw, 60)
    state = {"pb_ok": True, "pb": 0, "tasks": 0}

    async def login(r):
        return web.json_response({"result": 0, "jsession": "J1"})

    async def search(r):
        if r.query["LOC"] != "1":
            return web.json_response({"result": 0, "files": []})
        return web.json_response({"result": 0, "files": [{
            "beg": 50400, "end": 54000, "chn": 0, "file": "/rec/h.264", "len": 10, "loc": 1,
            "DownUrl": "",
            "PlaybackUrl": f"http://10.0.0.5:{port}/3/5?DownType=5&&jsession=DevIDNO=D1&FILELOC=1"
                           "&FILECHN=0&PLAYFILE=/rec/h.264&PLAYBEG=50400&PLAYEND=54000&PLAYCHN=0",
            "DownTaskUrl": f"http://10.0.0.5:{port}/StandardApiAction_addDownloadTask.action?"
                           "jsession=&did=D1&fph=/rec/h.264&chn=0&dtp=1"}]})

    async def playback(r):
        state["pb"] += 1
        assert r.query["jsession"] == "J1" and r.query["PLAYBEG"] == "50410"
        if not state["pb_ok"]:
            return web.Response(body=b"not a video" * 200)
        return web.FileResponse(flv)

    async def add_task(r):
        state["tasks"] += 1
        return web.json_response({"result": 0})

    async def tasks(r):
        return web.json_response({"result": 0, "infos": [{
            "stu": 4, "downUrl": f"http://10.0.0.5:{port}/seg?FPATH=x&SAVENAME=x.mp4"}]})

    async def seg(r):
        return web.FileResponse(raw)

    app = web.Application()
    for path, h in [("/StandardApiAction_login.action", login),
                    ("/StandardApiAction_getVideoFileInfo.action", search),
                    ("/StandardApiAction_addDownloadTask.action", add_task),
                    ("/StandardApiAction_downloadTasklist.action", tasks),
                    ("/3/5", playback), ("/seg", seg)]:
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
    (tmp_path / "data").mkdir()
    object.__setattr__(main.config, "search_locations", [2, 1])
    object.__setattr__(main.config, "download_method", "auto")
    cms = CMSV6(f"http://127.0.0.1:{port}", "u", "p")
    monkeypatch.setattr(main, "cms", cms)
    status = MagicMock(edit_text=AsyncMock())
    v = main.Vehicle(plate="ABC123", dev_id="D1", channels=1, channel_names=[])

    stats = {}
    out = await main.make_clip(v, 0, date(2026, 10, 19), 50410, 50420, status, stats)
    assert stats["metodo"] == "reproduccion" and state["tasks"] == 0
    assert 9 <= await video.probe_duration(out) <= 11
    assert main._method_info("reproduccion")["vel"] > 0

    # La reproducción deja de funcionar → se usa la descarga por tramos y se recuerda
    state["pb_ok"] = False
    stats = {}
    await main.make_clip(v, 0, date(2026, 10, 19), 50430, 50440, status, stats)
    assert stats["metodo"] == "tramos" and state["tasks"] == 1
    assert "fallo" in main._method_info("reproduccion")
    rec = RecFile("D1", 0, 50400, 54000, "/r", 1, 1, "", task_url="t", playback_url="p")
    assert main._choose_methods(rec, 50450, 50460)[0] == "tramos"
    await cms.close()
    await runner.cleanup()


@pytest.mark.asyncio
async def test_ftp_method_one_task_for_whole_range(tmp_path, monkeypatch):
    """FTP (como en el aplicativo): una sola subida por cámara para todo el horario, aunque
    la grabación esté repartida en varios archivos del bus."""
    avi = tmp_path / "up.avi"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=640x360:rate=15:duration=300", "-c:v", "mpeg4", "-q:v", "8",
                    str(avi)], check=True)
    state = {"ftp": [], "polls": 0}

    async def login(r):
        return web.json_response({"result": 0, "jsession": "J1"})

    async def search(r):
        if r.query["LOC"] != "1":
            return web.json_response({"result": 0, "files": []})
        files = [{"beg": b, "end": b + 150, "chn": 2, "file": f"/r/{b}.264", "len": 10, "loc": 1,
                  "DownTaskUrl": "http://x/add"} for b in (50400, 50550, 50700)]
        return web.json_response({"result": 0, "files": files})

    async def ftp_up(r):
        state["ftp"].append(dict(r.query))
        return web.json_response({"result": 0, "SEQUENCE": 77})

    async def ftp_status(r):
        assert r.query["seq"] == "77"
        state["polls"] += 1
        st = 1 if state["polls"] < 2 else 4
        return web.json_response({"result": 0, "info": {
            "status": st, "downloadUrl": f"http://10.0.0.9:{port}/3/5?DownType=3&FPATH=CH1.avi"
                                         f"&FLENGTH={avi.stat().st_size}&SAVENAME=CH1.avi"}})

    async def dl(r):
        assert r.query["jsession"] == "J1"
        return web.FileResponse(avi)

    app = web.Application()
    for path, h in [("/StandardApiAction_login.action", login),
                    ("/StandardApiAction_getVideoFileInfo.action", search),
                    ("/StandardApiAction_ftpUpload.action", ftp_up),
                    ("/StandardApiAction_queryFtpStatus.action", ftp_status),
                    ("/3/5", dl)]:
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
    (tmp_path / "data").mkdir()
    object.__setattr__(main.config, "search_locations", [2, 1])
    object.__setattr__(main.config, "download_method", "auto")
    cms = CMSV6(f"http://127.0.0.1:{port}", "u", "p")
    monkeypatch.setattr(main, "cms", cms)
    status = MagicMock(edit_text=AsyncMock())
    v = main.Vehicle(plate="SPBG22", dev_id="D1", channels=5, channel_names=[])

    stats = {}
    # 14:00:20–14:05:00 abarca 3 archivos del bus → una sola tarea FTP
    out = await main.make_clip(v, 2, date(2026, 10, 20), 50420, 50700, status, stats)
    assert stats["metodo"] == "ftp" and len(state["ftp"]) == 1
    q = state["ftp"][0]
    assert (q["DevIDNO"], q["CHN"], q["BEGSEC"], q["ENDSEC"]) == ("D1", "2", "50420", "50700")
    assert 278 <= await video.probe_duration(out) <= 282
    assert main._method_info("ftp")["vel"] > 0
    await cms.close()
    await runner.cleanup()


@pytest.mark.asyncio
async def test_remux_h264_avi_is_instant(tmp_path):
    import time as _t
    avi = tmp_path / "ch1.avi"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=1280x720:rate=15:duration=120", "-c:v", "libx264", "-preset",
                    "ultrafast", str(avi)], check=True)
    t = _t.monotonic()
    assert await video.remux(avi, tmp_path / "out.mp4", 120)
    assert _t.monotonic() - t < 5
    assert 119 <= await video.probe_duration(tmp_path / "out.mp4") <= 121
    mpeg4 = tmp_path / "m4.avi"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=320x240:rate=15:duration=2", "-c:v", "mpeg4", str(mpeg4)], check=True)
    assert not await video.remux(mpeg4, tmp_path / "x.mp4", 2)  # no es H.264: se comprime


@pytest.mark.asyncio
async def test_mosaic_audio_choice(tmp_path):
    """El mosaico lleva el audio de la cámara elegida; un video solo conserva el suyo."""
    clips = []
    for i, freq in enumerate((300, 1200)):
        p = tmp_path / f"c{i}.mp4"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc=size=320x240:rate=15:duration=3", "-f", "lavfi", "-i",
                        f"sine=frequency={freq}:duration=3", "-c:v", "libx264", "-preset",
                        "ultrafast", "-c:a", "aac", "-shortest", str(p)], check=True)
        clips.append(p)
    silent = tmp_path / "s.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=320x240:rate=15:duration=3", "-c:v", "libx264", "-preset",
                    "ultrafast", str(silent)], check=True)

    def dominant_freq(path):
        import struct
        pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-t", "1",
                              "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                             capture_output=True).stdout
        samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
        crossings = sum(1 for a, b in zip(samples, samples[1:]) if a < 0 <= b)
        return crossings * 8000 / len(samples)

    out = await video.mosaic(clips, tmp_path / "m2.mp4", audio_from=1)
    assert 1000 < dominant_freq(out) < 1400          # sonido de la cámara 2
    out = await video.mosaic([silent, clips[0]], tmp_path / "auto.mp4")
    assert 200 < dominant_freq(out) < 400            # automático: la primera con sonido
    out = await video.mosaic(clips, tmp_path / "mute.mp4", audio_from=-1)
    assert not await video.has_audio(out)
    single = tmp_path / "one.mp4"
    await video.compress_piece(clips[1], single, 0, 3)
    assert await video.has_audio(single)              # un solo video conserva su audio


@pytest.mark.asyncio
async def test_ftp_only_no_search_no_other_methods(tmp_path, monkeypatch):
    """Modo FTP: no busca grabaciones ni usa otros métodos; si el FTP falla, lo dice."""
    from app import main
    object.__setattr__(main.config, "download_method", "ftp")
    object.__setattr__(main.config, "data_dir", tmp_path)
    search = AsyncMock()
    monkeypatch.setattr(main.cms, "find_recordings", search)
    avi = tmp_path / "x.avi"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=640x360:rate=15:duration=10", "-c:v", "libx264", "-preset",
                    "ultrafast", str(avi)], check=True)
    texts = []

    async def ftp(dev, chn, day, a, b, dest, progress, dl_progress, stream, on_uploaded=None,
                  order_lock=None, order_gap=0):
        await progress("el bus está subiendo por FTP", 1, 20, None)
        if on_uploaded:
            on_uploaded()
        await dl_progress(5_000_000, 10_000_000, 1_000_000)
        dest.write_bytes(avi.read_bytes())
        return dest

    monkeypatch.setattr(main.cms, "ftp_download", ftp)
    status = MagicMock(edit_text=AsyncMock(side_effect=lambda t: texts.append(t)))
    tracker = main.Tracker(status, "🎥 prueba")
    cam = tracker.cam(0, "cam1")
    stats = {}
    v = main.Vehicle("SVDD59", "D1", 5, [])
    out = await main._clip_fn()(v, 0, date(2026, 10, 21), 27600, 27610, cam, stats)
    await tracker.render(force=True)
    tracker.stop()
    search.assert_not_called()
    assert stats["metodo"] == "ftp" and stats["avi"].suffix == ".avi"
    assert 9 <= await video.probe_duration(out) <= 11
    joined = "\n".join(texts)
    assert "Descargando del FTP" in joined or "Subiendo al FTP" in joined or "listo" in joined

    async def ftp_fail(*a, **k):
        raise CMSV6Error("El bus no pudo subir el video por FTP")
    monkeypatch.setattr(main.cms, "ftp_download", ftp_fail)
    with pytest.raises(CMSV6Error, match="FTP"):
        await main._clip_fn()(v, 1, date(2026, 10, 21), 27600, 27610, MagicMock(edit_text=AsyncMock()))
    search.assert_not_called()  # no hubo plan B con otros métodos


@pytest.mark.asyncio
async def test_result_as_text_is_success(monkeypatch):
    """ftpUpload responde {"result":"0"} (texto): debe tomarse como éxito."""
    cms = CMSV6("http://x:8088", "u", "p")
    cms.jsession = "J"
    monkeypatch.setattr(cms, "_raw", AsyncMock(return_value={"result": "0", "SEQUENCE": "12"}))
    data = await cms.call("StandardApiAction_ftpUpload.action", {})
    assert data["SEQUENCE"] == "12"


def test_normalize_handwritten_channels():
    from app.main import _split_mode
    for raw in (["svdc74", "1,3,hoy", "07:40", "07:43", "juntas"],
                ["svdc74", "1,3,", "hoy", "07:40", "07:43", "juntas"],
                ["svdc74", "1,", "3", "hoy", "07:40", "07:43", "juntas"]):
        assert _split_mode(list(raw))[:2] == (["svdc74", "1,3", "hoy", "07:40", "07:43"], True)


@pytest.mark.asyncio
async def test_ftp_retries_when_bus_does_not_answer(monkeypatch, tmp_path):
    from app import cmsv6 as m
    cms = CMSV6("http://x:8088", "u", "p")
    cms.jsession = "J"
    calls = {"up": 0}

    async def call(action, params=None):
        if "ftpUpload" in action:
            calls["up"] += 1
            if calls["up"] < 3:
                raise CMSV6Error("device no response", 22)
            return {"result": 0, "SEQUENCE": 5}
        if "queryFtpStatus" in action:
            return {"result": 0, "info": {"status": 4, "downloadUrl": "http://x:6611/3/5?FPATH=a"}}
        raise AssertionError(action)

    async def dl(url, dest, progress=None, total=0):
        dest.write_bytes(b"x" * 2048)
        return dest

    real_sleep = asyncio.sleep
    monkeypatch.setattr(m.asyncio, "sleep", lambda s: real_sleep(0))
    monkeypatch.setattr(cms, "call", call)
    monkeypatch.setattr(cms, "_download_url", dl)
    await cms.ftp_download("D", 0, date(2026, 10, 21), 27600, 27780, tmp_path / "a.avi")
    assert calls["up"] == 3


@pytest.mark.asyncio
async def test_juntas_ftp_asks_audio_and_builds_mosaic(tmp_path, monkeypatch):
    """juntas: sube cada cámara por FTP (una a la vez), descarga, pregunta el audio con
    botones y arma el mosaico con el sonido elegido."""
    from app import main
    object.__setattr__(main.config, "download_method", "ftp")
    object.__setattr__(main.config, "data_dir", tmp_path)
    object.__setattr__(main.config, "allowed_users", [7])
    srcs = {}
    for c, freq in ((0, 300), (2, 1200)):
        p = tmp_path / f"src{c}.avi"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc=size=640x360:rate=15:duration=6", "-f", "lavfi", "-i",
                        f"sine=frequency={freq}:duration=6", "-c:v", "libx264", "-preset",
                        "ultrafast", "-c:a", "pcm_s16le", "-shortest", str(p)], check=True)
        srcs[c] = p
    active = {"n": 0, "max": 0}

    async def ftp(dev, chn, day, a, b, dest, progress, dl_progress, stream, on_uploaded=None,
                  order_lock=None, order_gap=0):
        active["n"] += 1
        active["max"] = max(active["max"], active["n"])
        await asyncio.sleep(0.05)
        active["n"] -= 1
        on_uploaded()
        dest.write_bytes(srcs[chn].read_bytes())
        return dest

    monkeypatch.setattr(main.cms, "ftp_download", ftp)
    sent = {}
    status = MagicMock(edit_text=AsyncMock(), delete=AsyncMock(), chat_id=1)
    buttons = MagicMock(chat_id=1)

    async def reply_text(text, **kw):
        if kw.get("reply_markup"):
            sent["markup"] = kw["reply_markup"]
            return buttons
        return status

    async def reply_video(video, caption, **kw):
        sent["video"], sent["caption"] = video, caption

    msg = MagicMock(chat_id=1, message_id=99, reply_text=reply_text, reply_video=reply_video)
    v = main.Vehicle("SVDC74", "D1", 5, [])
    job = asyncio.create_task(main._video_together(msg, v, [0, 2], date(2026, 10, 21),
                                                   27600, 27606, "21/10/2026"))
    for _ in range(100):
        await asyncio.sleep(0.02)
        if "markup" in sent:
            break
    data = sent["markup"].inline_keyboard[0][1].callback_data  # botón «cam3»
    q = MagicMock(data=data, answer=AsyncMock(), edit_message_text=AsyncMock())
    upd = MagicMock(callback_query=q, effective_user=MagicMock(id=7))
    await main.on_audio_button(upd, MagicMock())
    await job
    assert active["max"] == 2                        # hasta 3 subidas a la vez (aquí 2 cámaras)
    assert "audio de la cámara 3" in sent["caption"]
    dims = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height", "-of", "csv=p=0", str(sent["video"])],
                          capture_output=True, text=True).stdout.strip()
    assert dims == "1280,360"                        # mosaico de 2 cámaras


@pytest.mark.asyncio
async def test_ftp_orders_are_spaced(monkeypatch, tmp_path):
    """Varias subidas a la vez, pero las órdenes al bus salen de a una y separadas."""
    import time as _t
    from app import cmsv6 as m
    cms = CMSV6("http://x:8088", "u", "p")
    cms.jsession = "J"
    sent = []

    async def call(action, params=None):
        if "ftpUpload" in action:
            sent.append(_t.monotonic())
            return {"result": "0", "SEQUENCE": len(sent)}
        return {"result": 0, "info": {"status": 4, "downloadUrl": "http://x:6611/3/5?FPATH=a"}}

    async def dl(url, dest, progress=None, total=0):
        dest.write_bytes(b"x" * 2048)
        return dest

    real_sleep = asyncio.sleep
    monkeypatch.setattr(m.asyncio, "sleep", lambda s: real_sleep(min(s, 0.2)))
    monkeypatch.setattr(cms, "call", call)
    monkeypatch.setattr(cms, "_download_url", dl)
    lock = asyncio.Lock()
    await asyncio.gather(*(cms.ftp_download("D", c, date(2026, 10, 21), 27600, 27780,
                                            tmp_path / f"{c}.avi", order_lock=lock, order_gap=1)
                           for c in range(3)))
    assert len(sent) == 3
    assert all(b - a >= 0.15 for a, b in zip(sent, sent[1:]))  # órdenes separadas
