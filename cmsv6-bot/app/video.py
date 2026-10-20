"""Recorte, compresión y extracción de fotos con ffmpeg."""

import asyncio
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
    _, err = await proc.communicate()
    if proc.returncode != 0:
        msg = err.decode(errors="replace").strip()[-800:]
        raise FFmpegError(f"ffmpeg falló: {msg}")


def _scale_filter() -> str:
    h = config.video_max_height
    # Reduce solo si es más grande que el máximo; ancho y alto pares (requisito de H.264)
    return f"scale=-2:'min({h},ih)':flags=bicubic,format=yuv420p"


async def compress_piece(src: Path, dest: Path, offset: float, duration: float,
                         stream: int = 0) -> Path:
    """Recorta [offset, offset+duration] de src y lo comprime a MP4 H.264.

    stream: índice del video dentro del archivo (en archivos con varias cámaras)."""
    # -ss después de -i: los .264 crudos de los MDVR no tienen índice y no admiten salto rápido
    await _run(
        "-fflags", "+genpts", "-i", str(src),
        "-ss", f"{max(0.0, offset):.3f}", "-t", f"{duration:.3f}",
        "-map", f"0:v:{stream}", "-map", "0:a:0?",
        "-vf", _scale_filter(),
        "-c:v", "libx264", "-preset", config.video_preset, "-crf", str(config.video_crf),
        "-c:a", "aac", "-b:a", "64k", "-ac", "1",
        "-movflags", "+faststart",
        str(dest))
    return dest


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
    equipos (G.711/ADPCM) se pasa a AAC para que se reproduzca en cualquier teléfono."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-rw_timeout", "20000000",  # 20 s sin datos → error
        "-i", url, "-t", str(seconds),
        "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart", str(dest),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=seconds + 60)
    except asyncio.TimeoutError:
        proc.kill()
        raise FFmpegError("El bus no envió video en vivo a tiempo (¿sin señal?).")
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size < 1024:
        msg = err.decode(errors="replace").strip()[-300:]
        raise FFmpegError(f"No llegó video en vivo. {msg}".strip())
    return dest


TILE_W, TILE_H = 640, 360


def _grid(n: int) -> tuple[int, int]:
    """Columnas y filas del mosaico: 2 → 2x1, 3-4 → 2x2, 5-6 → 3x2, 7-9 → 3x3."""
    cols = 1 if n == 1 else 2 if n <= 4 else 3
    return cols, -(-n // cols)


async def mosaic(inputs: list[Path], dest: Path, image: bool = False) -> Path:
    """Une varios videos (o fotos) de distintas cámaras en una sola pantalla dividida."""
    n = len(inputs)
    cols, rows = _grid(n)
    cells = cols * rows
    tile = (f"scale={TILE_W}:{TILE_H}:force_original_aspect_ratio=decrease,"
            f"pad={TILE_W}:{TILE_H}:(ow-iw)/2:(oh-ih)/2,setsar=1")
    if not image:
        tile += ",fps=15"
    parts = [f"[{i}:v]{tile}[t{i}]" for i in range(n)]
    # Las celdas sobrantes quedan en negro
    for i in range(n, cells):
        parts.append(f"color=c=black:s={TILE_W}x{TILE_H}:r=15[t{i}]")
    layout = "|".join(f"{(i % cols) * TILE_W}_{(i // cols) * TILE_H}" for i in range(cells))
    parts.append("".join(f"[t{i}]" for i in range(cells))
                 + f"xstack=inputs={cells}:layout={layout}:shortest=1,format=yuv420p[v]")
    args = [a for p in inputs for a in ("-i", str(p))]
    args += ["-filter_complex", ";".join(parts), "-map", "[v]"]
    if image:
        args += ["-frames:v", "1", "-q:v", "2"]
    else:
        args += ["-map", "0:a:0?", "-c:v", "libx264", "-preset", config.video_preset,
                 "-crf", str(config.video_crf), "-c:a", "aac", "-b:a", "64k",
                 "-movflags", "+faststart"]
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
