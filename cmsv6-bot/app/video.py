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
