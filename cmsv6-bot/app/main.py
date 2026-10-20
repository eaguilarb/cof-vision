"""Bot de Telegram para extraer videos y fotos de las grabaciones de CMSV6."""

import asyncio
import functools
import json
import logging
import re
import time
import urllib.request
from datetime import date
from pathlib import Path

from telegram import Message, Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from . import links, video
from .cmsv6 import CMSV6, CMSV6Error, LOC_NAMES, RecFile, Vehicle
from .config import config
from .parsing import (ParseError, fmt_hms, parse_channels, parse_date, parse_time,
                      seconds_of_day, today)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("bot")

cms = CMSV6(config.cmsv6_url, config.cmsv6_user, config.cmsv6_password)
jobs = asyncio.Semaphore(config.max_parallel_jobs)
WORK_HOURS = 6  # cuánto se guardan las grabaciones originales descargadas (caché)

AYUDA = """\
<b>Comandos</b>

/vehiculos — lista de vehículos, cámaras y si están en línea
/grabaciones <i>placa</i> [<i>fecha</i>] — qué horas hay grabadas
/video <i>placa canal fecha inicio fin</i> — clip comprimido
/foto <i>placa canal fecha hora</i> — imagen de ese instante
/miid — tu ID de Telegram

<b>Ejemplos</b>
<code>/video ABC123 1 hoy 14:00 14:10</code>
<code>/video ABC123 todos ayer 08:30 08:35</code>
<code>/video ABC123 2 19/10 22:15 22:20</code>
<code>/foto ABC123 todos hoy 14:05:30</code>
<code>/grabaciones ABC123 ayer</code>

Fecha: hoy, ayer, 19/10 o 19/10/2026. Canal: 1, 2, 1,3 o todos.
Máximo {max} minutos por video."""


def authorized(handler):
    @functools.wraps(handler)
    async def wrapper(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        user = update.effective_user
        if not user or user.id not in config.allowed_users:
            log.warning("Acceso denegado a %s (%s)", user and user.id, user and user.username)
            if update.effective_message:
                await update.effective_message.reply_text(
                    "No tienes permiso para usar este bot. Envía /miid y pásale tu ID "
                    "al administrador para que te agregue.")
            return
        try:
            await handler(update, ctx)
        except (ParseError, CMSV6Error, video.FFmpegError) as e:
            await update.effective_message.reply_text(f"⚠️ {e}")
        except Exception:
            log.exception("Error inesperado")
            await update.effective_message.reply_text("⚠️ Ocurrió un error inesperado. Revisa los logs.")
    return wrapper


async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        AYUDA.format(max=config.max_clip_minutes), parse_mode=ParseMode.HTML)


async def cmd_miid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    await update.effective_message.reply_text(
        f"Tu ID de Telegram es: <code>{u.id}</code>", parse_mode=ParseMode.HTML)


@authorized
async def cmd_vehiculos(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    vs = await cms.vehicles()
    if not vs:
        await update.effective_message.reply_text("Tu cuenta de CMSV6 no tiene vehículos.")
        return
    online = await cms.online_status([v.dev_id for v in vs])
    lines = []
    for v in sorted(vs, key=lambda v: v.plate):
        mark = "🟢" if online.get(v.dev_id) else ("🔴" if v.dev_id in online else "⚪")
        lines.append(f"{mark} <b>{_esc(v.plate)}</b> — equipo {_esc(v.dev_id)}, {v.channels} cámaras")
    await _send_long(update.effective_message, "\n".join(lines))


@authorized
async def cmd_grabaciones(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if not args:
        raise ParseError("Uso: /grabaciones placa [fecha]")
    v = await cms.find_vehicle(args[0])
    day = parse_date(args[1]) if len(args) > 1 else today()
    out = [f"<b>{_esc(v.plate)}</b> — {day:%d/%m/%Y}"]
    for loc in config.search_locations:
        try:
            files = await cms.search(v, day, chn=-1, loc=loc)
        except CMSV6Error as e:
            out.append(f"\n<i>{LOC_NAMES.get(loc, loc)}</i>: error ({_esc(str(e))})")
            continue
        out.append(f"\n<i>En {LOC_NAMES.get(loc, loc)}:</i>")
        if not files:
            out.append("  sin grabaciones")
            continue
        for chn in sorted({f.chn for f in files}):
            ranges = _merge([(f.beg, f.end) for f in files if f.chn == chn])
            txt = ", ".join(f"{fmt_hms(a)[:5]}–{fmt_hms(b)[:5]}" for a, b in ranges)
            out.append(f"  {v.channel_label(chn)}: {txt}")
    await _send_long(update.effective_message, "\n".join(out))


@authorized
async def cmd_video(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = list(ctx.args)
    if len(args) == 4:  # sin fecha → hoy
        args.insert(2, "hoy")
    if len(args) != 5:
        raise ParseError("Uso: /video placa canal fecha inicio fin\n"
                         "Ejemplo: /video ABC123 1 hoy 14:00 14:10")
    v = await cms.find_vehicle(args[0])
    chans = parse_channels(args[1], v.channels)
    day = parse_date(args[2])
    start, stop = seconds_of_day(parse_time(args[3])), seconds_of_day(parse_time(args[4]))
    if stop <= start:
        raise ParseError("La hora de fin debe ser posterior a la de inicio (mismo día).")
    if stop - start > config.max_clip_minutes * 60:
        raise ParseError(f"Máximo {config.max_clip_minutes} minutos por video.")

    msg = update.effective_message
    for chn in chans:
        status = await msg.reply_text(
            f"⏳ {v.plate} {v.channel_label(chn)} {day:%d/%m} {fmt_hms(start)}–{fmt_hms(stop)}: en cola…")
        async with jobs:
            try:
                out = await make_clip(v, chn, day, start, stop, status)
            except (CMSV6Error, video.FFmpegError) as e:
                await status.edit_text(f"⚠️ {v.plate} {v.channel_label(chn)}: {e}")
                continue
        await deliver(msg, status, out, f"🎥 {v.plate} {v.channel_label(chn)} · "
                                        f"{day:%d/%m/%Y} {fmt_hms(start)}–{fmt_hms(stop)}")


@authorized
async def cmd_foto(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = list(ctx.args)
    if len(args) == 3:
        args.insert(2, "hoy")
    if len(args) != 4:
        raise ParseError("Uso: /foto placa canal fecha hora\nEjemplo: /foto ABC123 1 hoy 14:05:30")
    v = await cms.find_vehicle(args[0])
    chans = parse_channels(args[1], v.channels)
    day = parse_date(args[2])
    at = seconds_of_day(parse_time(args[3]))
    msg = update.effective_message
    for chn in chans:
        status = await msg.reply_text(f"⏳ Buscando imagen {v.plate} {v.channel_label(chn)}…")
        async with jobs:
            try:
                recs = await cms.find_recordings(v, day, chn, at, at + 1, config.search_locations)
                if not recs:
                    raise CMSV6Error(f"No hay grabación de {v.channel_label(chn)} a las {fmt_hms(at)}.")
                raw, beg, stream = await fetch(v, recs[0], chn, day, at, at + 2, status)
                out = links.files_dir() / _name(v, chn, day, at, None, ".jpg")
                await video.extract_frame(raw, out, at - beg, stream)
            except (CMSV6Error, video.FFmpegError) as e:
                await status.edit_text(f"⚠️ {v.plate} {v.channel_label(chn)}: {e}")
                continue
        await msg.reply_photo(photo=out.read_bytes(),
                              caption=f"📷 {v.plate} {v.channel_label(chn)} · {day:%d/%m/%Y} {fmt_hms(at)}")
        await status.delete()


async def make_clip(v: Vehicle, chn: int, day: date, start: int, stop: int,
                    status: Message) -> Path:
    await status.edit_text(f"🔎 Buscando grabaciones de {v.plate} {v.channel_label(chn)}…")
    recs = await cms.find_recordings(v, day, chn, start, stop, config.search_locations)
    if not recs:
        raise CMSV6Error(f"No hay grabaciones en ese horario ({fmt_hms(start)}–{fmt_hms(stop)}).")
    pieces = []
    work = _work_dir()
    for i, rec in enumerate(recs, 1):
        a, b = max(start, rec.beg), min(stop, rec.end)
        raw, beg, stream = await fetch(v, rec, chn, day, a, b, status, f"({i}/{len(recs)}) ")
        await status.edit_text(f"🗜️ Comprimiendo parte {i}/{len(recs)}…")
        piece = work / f"{raw.stem}_{a}_{b}.mp4"
        await video.compress_piece(raw, piece, a - beg, b - a, stream)
        pieces.append(piece)
    out = links.files_dir() / _name(v, chn, day, start, stop, ".mp4")
    await video.concat(pieces, out)
    out.chmod(0o644)
    return out


async def fetch(v: Vehicle, rec: RecFile, chn: int, day: date, start: int, stop: int,
                status: Message, prefix: str = "") -> tuple[Path, int, int]:
    """Consigue el video de [start, stop] (o lo reutiliza si ya está en caché).

    Devuelve (archivo, segundo del día en que empieza, índice del video dentro del archivo).
    Primero intenta la descarga directa del archivo completo; si la grabación está en el
    vehículo y no se puede bajar directo, pide a CMSV6 una descarga por tramos."""
    work = _work_dir()
    safe = re.sub(r"[^\w.-]", "_", f"{rec.dev_id}_{rec.chn}_{rec.path}")[-150:]
    stream = rec.chns.index(chn) if chn in rec.chns else 0
    dest = work / safe
    if dest.exists():
        dest.touch()
        return dest, rec.beg, stream
    seg_dest = work / f"{safe}_{start}_{stop}.seg"
    if seg_dest.exists():
        seg_dest.touch()
        return seg_dest, start, 0

    can_segment = rec.loc == 1 and bool(rec.task_url)
    if not (can_segment and (rec.segment_only or not rec.down_url)):
        mb = f" ({rec.size / 1e6:.0f} MB)" if rec.size else ""
        await status.edit_text(f"⬇️ {prefix}Descargando grabación desde el "
                               f"{LOC_NAMES.get(rec.loc, 'servidor')}{mb}…")
        try:
            return await cms.download(rec, dest), rec.beg, stream
        except CMSV6Error as e:
            if not can_segment:
                raise
            log.info("Descarga directa falló (%s); se intenta por tramos", e)

    async def progress(state: str) -> None:
        try:
            await status.edit_text(f"📡 {prefix}Pidiendo al vehículo el tramo "
                                   f"{fmt_hms(start)}–{fmt_hms(stop)}: {state}…")
        except Exception:
            pass  # Telegram rechaza ediciones con el mismo texto

    await progress("enviando solicitud")
    path, beg = await cms.segment_download(v, rec, day, start, stop, seg_dest, progress)
    return path, beg, 0


async def deliver(msg: Message, status: Message, out: Path, caption: str) -> None:
    size_mb = out.stat().st_size / 1e6
    link = links.make_link(out)
    caption = f"{caption}\n{size_mb:.1f} MB"
    if link:
        caption += f"\n⬇️ Descarga ({config.link_hours} h): {link}"
    if size_mb <= config.telegram_max_mb:
        await status.edit_text(f"📤 Enviando video ({size_mb:.1f} MB)…")
        try:
            await msg.reply_video(video=out, caption=caption, supports_streaming=True)
            await status.delete()
            return
        except Exception as e:
            log.warning("No se pudo enviar el video por Telegram: %s", e)
    if link:
        await status.edit_text(f"{caption}\n(El video es muy grande para Telegram; usa el enlace.)")
    else:
        await status.edit_text(f"⚠️ El video pesa {size_mb:.1f} MB y no se pudo enviar. "
                               "Configura PUBLIC_URL para recibir enlaces de descarga.")


def _name(v: Vehicle, chn: int, day: date, start: int, stop: int | None, ext: str) -> str:
    plate = re.sub(r"[^\w-]", "", v.plate) or v.dev_id
    t = fmt_hms(start).replace(":", "")
    if stop is not None:
        t += "-" + fmt_hms(stop).replace(":", "")
    return f"{plate}_cam{chn + 1}_{day:%Y%m%d}_{t}{ext}"


def _work_dir() -> Path:
    d = config.data_dir / "work"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _merge(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1] + 5:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def _send_long(msg: Message, text: str) -> None:
    while text:
        cut = text[:4000].rfind("\n") if len(text) > 4000 else len(text)
        await msg.reply_text(text[:cut], parse_mode=ParseMode.HTML)
        text = text[cut:].lstrip("\n")


async def _cleanup_loop() -> None:
    while True:
        try:
            n = links.cleanup_old_files()
            cutoff = time.time() - WORK_HOURS * 3600
            for p in _work_dir().iterdir():
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink(missing_ok=True)
                    n += 1
            if n:
                log.info("Limpieza: %d archivos eliminados", n)
        except Exception:
            log.exception("Error en la limpieza")
        await asyncio.sleep(1800)


def _logout_from_cloud() -> None:
    """Antes de usar el servidor local de Bot API hay que cerrar sesión en la nube una vez."""
    flag = config.data_dir / ".cloud_logged_out"
    if flag.exists():
        return
    url = f"https://api.telegram.org/bot{config.telegram_token}/logOut"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            log.info("logOut en la nube de Telegram: %s", json.load(r))
    except Exception as e:  # ya cerrado (400) u otro error: el servidor local igual funciona
        log.info("logOut en la nube de Telegram: %s", e)
    flag.parent.mkdir(parents=True, exist_ok=True)
    flag.touch()


async def post_init(app: Application) -> None:
    app.bot_data["http"] = await links.start_server()
    app.bot_data["cleanup"] = asyncio.create_task(_cleanup_loop())
    try:
        await cms.login()
    except CMSV6Error as e:
        log.error("%s (se reintentará en cada comando)", e)


async def post_shutdown(app: Application) -> None:
    await cms.close()
    await app.bot_data["http"].cleanup()


def main() -> None:
    if not config.telegram_token:
        raise SystemExit("Falta TELEGRAM_BOT_TOKEN en el archivo .env")
    if not config.allowed_users:
        log.warning("ALLOWED_USERS está vacío: nadie podrá pedir videos. Usa /miid para obtener tu ID.")
    config.data_dir.mkdir(parents=True, exist_ok=True)

    b = (Application.builder().token(config.telegram_token)
         .concurrent_updates(True)
         .post_init(post_init).post_shutdown(post_shutdown)
         .connect_timeout(30).read_timeout(120).write_timeout(1800).media_write_timeout(1800))
    if config.bot_api_url:
        _logout_from_cloud()
        b = (b.base_url(f"{config.bot_api_url}/bot")
             .base_file_url(f"{config.bot_api_url}/file/bot")
             .local_mode(True))
    app = b.build()
    app.add_handler(CommandHandler(["start", "ayuda", "help"], cmd_start))
    app.add_handler(CommandHandler("miid", cmd_miid))
    app.add_handler(CommandHandler("vehiculos", cmd_vehiculos))
    app.add_handler(CommandHandler("grabaciones", cmd_grabaciones))
    app.add_handler(CommandHandler("video", cmd_video))
    app.add_handler(CommandHandler("foto", cmd_foto))
    log.info("Bot iniciado (Bot API: %s)", config.bot_api_url or "nube de Telegram")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
