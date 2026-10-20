import asyncio
import subprocess
import time
from datetime import date, time as dtime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from app import links, parsing, video
from app.cmsv6 import CMSV6, RecFile, _file_channels


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
    cms = CMSV6("http://47.88.25.163:8080", "u", "p")
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
    assert calls[0]["DevIDNO"] == "D1" and calls[0]["LOC"] == "2"
    # El DownUrl trae una IP interna (10.0.0.5): debe reemplazarse por la del servidor
    f = RecFile("D1", 0, 0, 60, "/x", 1, 2, "http://10.0.0.5:6611/3/5?a=1")
    assert cms.download_url(f) == "http://127.0.0.1:6611/3/5?a=1&jsession=J1&SAVENAME=x"

    jpg = tmp_path / "f.jpg"
    await video.extract_frame(raw, jpg, 10)
    assert jpg.stat().st_size > 1000
    await cms.close()
    await runner.cleanup()
