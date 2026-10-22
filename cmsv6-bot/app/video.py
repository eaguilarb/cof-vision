"""Recorte, compresión y extracción de fotos con ffmpeg."""

import asyncio
import signal
import logging
from pathlib import Path

from .config import config

log = logging.getLogger(__name__)


class FFmpegError(RuntimeError):
    pass


async def _run(*args: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await proc.communicate()
    except asyncio.CancelledError:
        _kill(proc)  # pedido cancelado con /cancelar: no dejar ffmpeg trabajando
        raise
    if proc.returncode != 0:
        msg = err.decode(errors="replace").strip()[-800:]
        raise FFmpegError(f"ffmpeg falló: {msg}")


def _kill(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass


# En los archivos de los equipos el audio puede aparecer tarde en el archivo: se analiza más
# a fondo para no perderlo (por defecto ffmpeg mira solo el comienzo)
PROBE = ("-analyzeduration", "30000000", "-probesize", "50000000")


async def has_audio(src: Path) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", *PROBE, "-select_streams", "a", "-show_entries",
        "stream=codec_name", "-of", "csv=p=0", str(src),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, _ = await proc.communicate()
    return bool(out.decode().strip())


async def describe(src: Path) -> str:
    """Pistas del archivo (para el registro): códec de video y de audio."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", *PROBE, "-show_entries",
        "stream=codec_type,codec_name,sample_rate,channels", "-of", "compact=p=0:nk=1", str(src),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, _ = await proc.communicate()
    return out.decode(errors="replace").strip().replace("\n", " | ")


def _scale_filter() -> str:
    h = config.video_max_height
    # Reduce solo si es más grande que el máximo; ancho y alto pares (requisito de H.264)
    return f"scale=-2:'min({h},ih)':flags=bicubic,format=yuv420p"


async def compress_piece(src: Path, dest: Path, offset: float, duration: float,
                         stream: int = 0, intermediate: bool = False) -> Path:
    """Recorta [offset, offset+duration] de src y lo comprime a MP4 H.264.

    stream: índice del video dentro del archivo (en archivos con varias cámaras)."""
    # -ss después de -i: los .264 crudos de los MDVR no tienen índice y no admiten salto rápido
    await _run(
        *PROBE, "-fflags", "+genpts", "-i", str(src),
        "-ss", f"{max(0.0, offset):.3f}", "-t", f"{duration:.3f}",
        "-map", f"0:v:{stream}", "-map", "0:a:0?",
        "-vf", _scale_filter(),
        # Para el mosaico este archivo es intermedio (se vuelve a comprimir al unir):
        # se hace muy rápido y con buena calidad para no gastar CPU dos veces
        "-threads", "0",
        "-c:v", "libx264", "-preset", "ultrafast" if intermediate else config.video_preset,
        "-crf", "20" if intermediate else str(config.video_crf),
        "-c:a", "aac", "-b:a", "64k", "-ac", "1",
        "-movflags", "+faststart",
        str(dest))
    return dest


async def video_codec(src: Path) -> str:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name",
        "-of", "default=nw=1:nk=1", str(src),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, _ = await proc.communicate()
    return out.decode().strip().lower()


async def remux(src: Path, dest: Path, duration: float) -> bool:
    """Pasa el video a MP4 sin recomprimir (segundos en vez de minutos). Solo si es H.264,
    que se reproduce en cualquier teléfono; devuelve False si hay que comprimir."""
    if await video_codec(src) != "h264":
        return False
    await _run(*PROBE, "-fflags", "+genpts", "-i", str(src), "-t", f"{duration:.3f}",
               "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy",
               "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", str(dest))
    return dest.exists() and dest.stat().st_size > 1024


async def concat(pieces: list[Path], dest: Path) -> Path:
    if len(pieces) == 1:
        pieces[0].rename(dest)
        return dest
    listfile = dest.with_suffix(".txt")
    listfile.write_text("".join(f"file '{p.resolve()}'\n" for p in pieces))
    await _run("-f", "concat", "-safe", "0", "-i", str(listfile),
               "-c", "copy", "-movflags", "+faststart", str(dest))
    listfile.unlink(missing_ok=True)
    for p in pieces:
        p.unlink(missing_ok=True)
    return dest


async def extract_frame(src: Path, dest: Path, offset: float, stream: int = 0) -> Path:
    await _run("-fflags", "+genpts", "-i", str(src), "-ss", f"{max(0.0, offset):.3f}",
               "-map", f"0:v:{stream}", "-frames:v", "1", "-q:v", "2", str(dest))
    if not dest.exists() or dest.stat().st_size == 0:
        raise FFmpegError("No se pudo extraer una imagen en ese instante.")
    return dest


async def record_live(url: str, dest: Path, seconds: int) -> Path:
    """Graba unos segundos del video en vivo (HTTP-FLV) y lo deja en MP4.

    El video se copia tal cual (sin recomprimir, es la calidad liviana); el audio de los
    equipos (G.711/ADPCM) se pasa a AAC para que se reproduzca en cualquier teléfono.
    Se corta por tiempo real (no solo por los tiempos del video, que en el en vivo de los
    equipos pueden saltar y cortar el clip antes)."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-rw_timeout", "20000000",  # 20 s sin datos → error
        # Análisis corto del flujo: por defecto ffmpeg espera ~5 s antes de empezar
        "-probesize", "65536", "-analyzeduration", "1500000",
        "-fflags", "+genpts", "-i", url, "-t", str(seconds * 3),
        "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart", str(dest),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)

    async def stop_after_real_time() -> None:
        # Espera a que empiece a llegar video y luego cuenta los segundos pedidos
        for _ in range(40):
            if dest.exists() and dest.stat().st_size > 0 or proc.returncode is not None:
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(seconds)
        if proc.returncode is None:
            proc.send_signal(signal.SIGINT)  # ffmpeg cierra el MP4 ordenadamente

    stopper = asyncio.create_task(stop_after_real_time())
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=seconds + 70)
    except asyncio.TimeoutError:
        proc.kill()
        raise FFmpegError("El bus no envió video en vivo a tiempo (¿sin señal?).")
    except asyncio.CancelledError:
        _kill(proc)
        raise
    finally:
        stopper.cancel()
    # Cortado por nosotros (SIGINT) ffmpeg termina con código 255: es normal
    if proc.returncode not in (0, 255) or not dest.exists() or dest.stat().st_size < 1024:
        msg = err.decode(errors="replace").strip()[-300:]
        raise FFmpegError(f"No llegó video en vivo. {msg}".strip())
    return dest


async def record_stream(url: str, dest: Path, wall_limit: int,
                        max_seconds: float | None = None) -> tuple[Path, float]:
    """Graba un flujo (p. ej. reproducción remota) hasta que termine, llegue a max_seconds
    de video o pasen wall_limit s. Devuelve el archivo y los segundos reales que tardó."""
    t0 = asyncio.get_running_loop().time()
    limit = ["-t", f"{max_seconds:.3f}"] if max_seconds else []
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-rw_timeout", "20000000",
        "-probesize", "65536", "-analyzeduration", "1500000", "-fflags", "+genpts",
        "-i", url, *limit, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac",
        "-f", "matroska", str(dest),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=wall_limit)
    except asyncio.TimeoutError:
        proc.send_signal(signal.SIGINT)
        _, err = await proc.communicate()
    except asyncio.CancelledError:
        _kill(proc)
        raise
    took = asyncio.get_running_loop().time() - t0
    if not dest.exists() or dest.stat().st_size < 1024:
        raise FFmpegError("No llegó video: " + err.decode(errors="replace").strip()[-300:])
    return dest, took


async def snapshot_live(url: str, dest: Path) -> Path:
    """Foto del momento actual: toma el primer cuadro completo (clave) del video en vivo."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-rw_timeout", "15000000", "-probesize", "65536", "-analyzeduration", "1500000",
        "-skip_frame", "nokey", "-i", url,
        "-frames:v", "1", "-q:v", "2", str(dest),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=40)
    except asyncio.TimeoutError:
        proc.kill()
        raise FFmpegError("El bus no envió imagen a tiempo (¿sin señal?).")
    except asyncio.CancelledError:
        _kill(proc)
        raise
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size < 1024:
        raise FFmpegError("No llegó imagen en vivo. " + err.decode(errors="replace").strip()[-200:])
    return dest


TILE_W, TILE_H = 640, 360

# Niveles de compresión. maxrate pone un techo al peso: MB ≈ (maxrate + audio) × segundos / 8
#   normal: mosaico de celdas 640×360, buena calidad
#   720:    todo el mosaico cabe en 1280×720
#   ultra:  todo el mosaico cabe en 854×480, 10 cuadros/s; lo más liviano
LEVELS = {
    "normal": {"canvas": None, "crf": 28, "maxrate": "1500k", "fps": 15, "height": 720,
               "abr": "64k", "preset": "superfast"},
    "720": {"canvas": (1280, 720), "crf": 30, "maxrate": "900k", "fps": 15, "height": 720,
            "abr": "48k", "preset": "veryfast"},
    "ultra": {"canvas": (854, 480), "crf": 34, "maxrate": "350k", "fps": 10, "height": 480,
              "abr": "32k", "preset": "veryfast"},
}


def _enc(level: str) -> list[str]:
    lv = LEVELS[level]
    rate = int(lv["maxrate"].rstrip("k"))
    return ["-c:v", "libx264", "-preset", lv["preset"], "-crf", str(lv["crf"]),
            "-maxrate", lv["maxrate"], "-bufsize", f"{rate * 2}k",
            "-c:a", "aac", "-b:a", lv["abr"], "-ac", "1", "-movflags", "+faststart"]


async def compress_level(src: Path, dest: Path, duration: float, level: str) -> Path:
    """Un solo video comprimido al nivel pedido (normal, 720 o ultra)."""
    lv = LEVELS[level]
    await _run(*PROBE, "-fflags", "+genpts", "-i", str(src), "-t", f"{duration:.3f}",
               "-map", "0:v:0", "-map", "0:a:0?", "-threads", "0",
               "-vf", f"scale=-2:'min({lv['height']},ih)':flags=bicubic,fps={lv['fps']},"
                      "format=yuv420p",
               *_enc(level), str(dest))
    return dest


def _tile_size(cols: int, rows: int, level: str) -> tuple[int, int]:
    canvas = LEVELS[level]["canvas"]
    if not canvas:
        return TILE_W, TILE_H
    w, h = canvas[0] // cols, canvas[1] // rows
    # Celdas 16:9 que quepan en el lienzo, con medidas pares (requisito de H.264)
    w = min(w, h * 16 // 9)
    h = w * 9 // 16
    return w - w % 2, h - h % 2


def _grid(n: int) -> tuple[int, int]:
    """Columnas y filas del mosaico: 2 → 2x1, 3-4 → 2x2, 5-6 → 3x2, 7-9 → 3x3."""
    cols = 1 if n == 1 else 2 if n <= 4 else 3
    return cols, -(-n // cols)


async def mosaic(inputs: list[Path], dest: Path, image: bool = False,
                 audio_from: int | None = None, level: str = "normal") -> Path:
    """Une varios videos (o fotos) de distintas cámaras en una sola pantalla dividida.

    audio_from: índice de la entrada cuyo audio se usa; None = la primera que tenga
    audio; -1 = sin audio. level: compresión (normal, 720 o ultra)."""
    n = len(inputs)
    cols, rows = _grid(n)
    cells = cols * rows
    tw, th = (TILE_W, TILE_H) if image else _tile_size(cols, rows, level)
    fps = LEVELS[level]["fps"]
    tile = (f"scale={tw}:{th}:force_original_aspect_ratio=decrease,"
            f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    if not image:
        tile += f",fps={fps}"
    parts = [f"[{i}:v]{tile}[t{i}]" for i in range(n)]
    # Las celdas sobrantes quedan en negro
    for i in range(n, cells):
        parts.append(f"color=c=black:s={tw}x{th}:r={fps}[t{i}]")
    layout = "|".join(f"{(i % cols) * tw}_{(i // cols) * th}" for i in range(cells))
    parts.append("".join(f"[t{i}]" for i in range(cells))
                 + f"xstack=inputs={cells}:layout={layout}:shortest=1,format=yuv420p[v]")
    args = [a for p in inputs for a in ("-i", str(p))]
    args += ["-filter_complex", ";".join(parts), "-map", "[v]"]
    if image:
        args += ["-frames:v", "1", "-q:v", "2"]
    else:
        if audio_from is None:
            audio_from = -1
            for i, p in enumerate(inputs):
                if await has_audio(p):
                    audio_from = i
                    break
        if 0 <= audio_from < n:
            args += ["-map", f"{audio_from}:a:0?"]
        args += ["-threads", "0", *_enc(level)]
    await _run(*args, str(dest))
    return dest


async def probe_duration(src: Path) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(src),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except ValueError:
        return 0.0
