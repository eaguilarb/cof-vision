"""Prueba la conexión con CMSV6 paso a paso, antes de usar el bot.

Uso:  docker compose run --rm bot python -m app.diagnostico [placa] [fecha]
"""

import asyncio
import json
import sys

from . import video
from .cmsv6 import CMSV6, CMSV6Error, LOC_NAMES
from .config import config
from .links import files_dir
from .parsing import fmt_hms, parse_date, today


def paso(n: int, txt: str) -> None:
    print(f"\n[{n}] {txt}")


async def run() -> int:
    cms = CMSV6(config.cmsv6_url, config.cmsv6_user, config.cmsv6_password)
    try:
        paso(1, f"Iniciando sesión en {config.cmsv6_url} con el usuario «{config.cmsv6_user}»")
        await cms.login()
        print("    OK")

        paso(2, "Listando vehículos")
        raw = await cms.call("StandardApiAction_queryUserVehicle.action")
        vs = await cms.vehicles()
        for v in vs[:20]:
            print(f"    {v.plate:15} equipo={v.dev_id:15} cámaras={v.channels} {v.channel_names}")
        if not vs:
            print("    (ninguno) Respuesta cruda:", json.dumps(raw)[:800])
            return 1

        v = await cms.find_vehicle(sys.argv[1]) if len(sys.argv) > 1 else vs[0]
        day = parse_date(sys.argv[2]) if len(sys.argv) > 2 else today()
        paso(3, f"Buscando grabaciones de {v.plate} el {day:%d/%m/%Y}")
        found = None
        for loc in (2, 1, 4):
            try:
                data = await cms.call("StandardApiAction_getVideoFileInfo.action", {
                    "DevIDNO": v.dev_id if loc == 1 else v.plate, "LOC": loc, "CHN": -1, "YEAR": day.year,
                    "MON": day.month, "DAY": day.day, "RECTYPE": -1, "FILEATTR": 2,
                    "BEG": 0, "END": 86399, "ARM1": 0, "ARM2": 0, "RES": 0,
                    "STREAM": -1, "STORE": 0})
            except CMSV6Error as e:
                print(f"    LOC={loc} ({LOC_NAMES[loc]}): ERROR {e}")
                continue
            files = data.get("files") or []
            print(f"    LOC={loc} ({LOC_NAMES[loc]}): {len(files)} archivos")
            if files:
                print("    Ejemplo crudo:", json.dumps(files[0], ensure_ascii=False)[:800])
                if found is None:
                    found = (await cms.search(v, day, chn=-1, loc=loc))[0]
        if not found:
            print("    No hay grabaciones ese día. Prueba con otra placa o fecha:")
            print("    python -m app.diagnostico PLACA 19/10/2026")
            return 1

        paso(4, f"Descargando cam{found.chn + 1} {fmt_hms(found.beg)}–{fmt_hms(found.end)} "
                f"({found.size / 1e6:.1f} MB)")
        work = config.data_dir / "work"
        work.mkdir(parents=True, exist_ok=True)
        offset = 0
        try:
            print("    URL:", cms.download_url(found).split("jsession=")[0])
            raw_file = await cms.download(found, work / "diagnostico.raw")
        except CMSV6Error as e:
            if not found.task_url:
                raise
            print(f"    Descarga directa no disponible ({e}).")
            print("    Probando descarga por tramos (el vehículo debe estar encendido)…")

            async def prog(state):
                print("      estado:", state)
            raw_file, beg = await cms.segment_download(
                v, found, day, found.beg, min(found.end, found.beg + 30),
                work / "diagnostico.seg", prog)
            offset = found.beg - beg
        print(f"    OK, {raw_file.stat().st_size / 1e6:.1f} MB descargados")

        paso(5, "Comprimiendo 20 segundos con ffmpeg")
        out = files_dir() / "diagnostico.mp4"
        await video.compress_piece(raw_file, out, offset, 20)
        print(f"    OK, {out.stat().st_size / 1e6:.2f} MB, duración {await video.probe_duration(out):.1f} s")
        print("\nTodo funciona. Ya puedes iniciar el bot con: docker compose up -d")
        return 0
    except (CMSV6Error, video.FFmpegError) as e:
        print(f"    ERROR: {e}")
        return 1
    finally:
        await cms.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
