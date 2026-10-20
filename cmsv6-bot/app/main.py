"""Bot de Telegram para extraer videos y fotos de las grabaciones de CMSV6."""

import asyncio
import functools
import json
import logging
import re
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path

from telegram import Message, Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from . import links, video
from .cmsv6 import CMSV6, CMSV6Error, LOC_NAMES, RecFile, Vehicle
from .config import config
from .parsing import (ParseError, fmt_hms, parse_channels, parse_date, parse_time,
                      TZ, seconds_of_day, today)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("bot")

cms = CMSV6(config.cmsv6_url, config.cmsv6_user, config.cmsv6_password,
            config.data_dir / ".jsession", config.cmsv6_media_url)
# Limita solo el trabajo de CPU (ffmpeg); las descargas desde los buses van todas en paralelo
cpu = asyncio.Semaphore(config.max_parallel_jobs)
WORK_HOURS = 6  # cuánto se guardan las grabaciones originales descargadas (caché)

AYUDA = """\
<b>Comandos</b>

/enlinea [<i>texto</i>] — buses encendidos ahora (ej. /enlinea SPB)
/vivo <i>placa</i> [<i>cámaras</i>] [<i>segundos</i>] [juntas] — en vivo: enlace + clip corto
/vehiculos <i>texto</i> — busca vehículos (ej. /vehiculos SVD), cámaras y si están en línea
/grabaciones <i>placa</i> [<i>fecha</i>] — qué horas hay grabadas
/video <i>placa canal fecha inicio fin</i> [juntas] [rapido] — clip comprimido
/foto <i>placa</i> [<i>cámaras</i>] — foto de ahora mismo (rápida, en vivo)
/foto <i>placa canal fecha hora</i> [juntas] — imagen de un momento pasado (más lenta)
/miid — tu ID de Telegram

<b>Ejemplos</b>
<code>/video ABC123 1 hoy 14:00 14:10</code>
<code>/video ABC123 todos ayer 08:30 08:35</code> (un video por cámara)
<code>/video ABC123 todos ayer 08:30 08:35 juntas</code> (todas en una pantalla)
<code>/video ABC123 1,3 hoy 08:30 08:35 juntas</code>
<code>/video ABC123 2 19/10 22:15 22:20</code>
<code>/foto ABC123 todos hoy 14:05:30</code>
<code>/grabaciones ABC123 ayer</code>
<code>/vivo ABC123 1,3 20 juntas</code>

Fecha: hoy, ayer, 19/10 o 19/10/2026. Canal: 1, 2, 1,3 o todos.
Con varias cámaras: sin nada al final llegan separadas; con «juntas», en mosaico.
«rapido» al final usa la grabación liviana del bus (menos calidad, llega mucho antes).
Máximo {max} minutos por video."""


_busy = 0


def _busy_flag() -> Path:
    # Mientras haya pedidos en curso existe este archivo; autoupdate.sh no reinicia el bot
    return config.data_dir / ".ocupado"


def _set_busy(delta: int) -> None:
    global _busy
    _busy += delta
    try:
        if _busy > 0:
            _busy_flag().write_text(str(_busy))
        else:
            _busy_flag().unlink(missing_ok=True)
    except OSError:
        pass


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
        _set_busy(+1)
        try:
            await handler(update, ctx)
        except (ParseError, CMSV6Error, video.FFmpegError) as e:
            await update.effective_message.reply_text(f"⚠️ {e}")
        except Exception:
            log.exception("Error inesperado")
            await update.effective_message.reply_text("⚠️ Ocurrió un error inesperado. Revisa los logs.")
        finally:
            _set_busy(-1)
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
    # Con un texto se filtra: /vehiculos SVD
    q = "".join(ctx.args).upper().replace("-", "")
    if q:
        vs = [v for v in vs if q in v.plate.upper().replace("-", "") or q in v.dev_id.upper()]
    if len(vs) > 60:
        await update.effective_message.reply_text(
            f"Hay {len(vs)} vehículos. Escribe parte de la placa para filtrar, "
            "por ejemplo: /vehiculos SVD")
        return
    if not vs:
        await update.effective_message.reply_text(f"Ningún vehículo coincide con «{q}».")
        return
    online = await cms.online_status([v.dev_id for v in vs])
    lines = []
    for v in sorted(vs, key=lambda v: v.plate):
        mark = "🟢" if online.get(v.dev_id) else ("🔴" if v.dev_id in online else "⚪")
        empresa = f" · {_esc(v.company)}" if v.company else ""
        lines.append(f"{mark} <b>{_esc(v.plate)}</b>{empresa} — {v.channels} cámaras")
    await _send_long(update.effective_message, "\n".join(lines))


@authorized
async def cmd_enlinea(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Lista compacta de los buses encendidos ahora (opcionalmente filtrados por placa)."""
    vs = await cms.vehicles()
    online = await cms.online_devices()
    q = "".join(ctx.args).upper().replace("-", "")
    on = sorted(v.plate for v in vs if v.dev_id in online
                and (not q or q in v.plate.upper().replace("-", "")))
    total = len([v for v in vs if not q or q in v.plate.upper().replace("-", "")])
    head = f"🟢 <b>{len(on)} de {total}</b> buses en línea" + (f" con «{_esc(q)}»" if q else "")
    if not on:
        await update.effective_message.reply_text(head, parse_mode=ParseMode.HTML)
        return
    await _send_long(update.effective_message, head + "\n\n" + _esc(", ".join(on)))


@authorized
async def cmd_vivo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Video en vivo: enlace para mirar en el navegador + un clip corto en el chat."""
    args, together, _ = _split_mode(list(ctx.args))
    if not args:
        raise ParseError("Uso: /vivo placa [cámaras] [segundos] [juntas]\n"
                         "Ejemplo: /vivo SPBS42 1,3 20")
    v = await cms.find_vehicle(args[0])
    chans = parse_channels(args[1] if len(args) > 1 else "1", v.channels)
    seconds = config.live_seconds
    if len(args) > 2:
        if not args[2].rstrip("s").isdigit():
            raise ParseError("Los segundos deben ser un número, por ejemplo: /vivo SPBS42 1 20")
        seconds = max(5, min(60, int(args[2].rstrip("s"))))
    msg = update.effective_message
    online = await cms.online_status([v.dev_id])
    if online and not online.get(v.dev_id):
        raise CMSV6Error(f"{v.plate} no está en línea (apagado o sin señal).")
    if not cms.jsession:
        await cms.login()

    link = links.make_live_link(v.dev_id, v.plate, chans)
    cams_txt = ", ".join(str(c + 1) for c in chans)
    if link:
        await msg.reply_text(
            f"🔴 <b>{_esc(v.plate)}</b> en vivo · cámaras {cams_txt}\n"
            f'<a href="{link}">▶️ Ver en vivo</a> (vale {config.live_link_minutes // 60} h; '
            "puede tardar unos segundos en conectar con el bus)",
            parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    status = await msg.reply_text(f"⏺ Grabando {seconds} s en vivo de {v.plate}…")

    async def one(chn: int) -> tuple[int, Path | None, str]:
        out = links.files_dir() / _name(v, chn, today(), seconds_of_day(
            datetime.now(TZ).time()), None, "_vivo.mp4")
        last = ""
        for base in cms.media_bases():
            try:
                await video.record_live(cms.live_flv_url(base, v.dev_id, chn), out, seconds)
                cms.media_url = cms.media_url or base  # este servidor de video funciona
                out.chmod(0o644)
                return chn, out, ""
            except video.FFmpegError as e:
                last = str(e)
        return chn, None, f"{v.channel_label(chn)}: {last}"

    results = await asyncio.gather(*(one(c) for c in chans))
    ok = [(c, p) for c, p, _ in results if p]
    failed = [e for _, p, e in results if not p]
    if not ok:
        await status.edit_text("⚠️ No llegó video en vivo.\n" + "\n".join(failed))
        return
    when = datetime.now(TZ).strftime("%d/%m/%Y %H:%M:%S")
    if together and len(ok) > 1:
        out = links.files_dir() / _name(v, -1, today(), seconds_of_day(datetime.now(TZ).time()),
                                         None, "_vivo.mp4", "camaras" + "-".join(
                                             str(c + 1) for c, _ in ok))
        async with cpu:
            await video.mosaic([p for _, p in ok], out)
        out.chmod(0o644)
        caption = f"🔴 {v.plate} en vivo · cámaras {', '.join(str(c + 1) for c, _ in ok)} · {when}"
        if failed:
            caption += "\n⚠️ Sin video: " + "; ".join(failed)
        await deliver(msg, status, out, caption)
        return
    for i, (c, p) in enumerate(ok):
        st = status if i == 0 else await msg.reply_text("📤 Enviando…")
        await deliver(msg, st, p, f"🔴 {v.plate} {v.channel_label(c)} en vivo · {when}")
    if failed:
        await msg.reply_text("⚠️ Sin video: " + "; ".join(failed))


async def _live_source(dev_id: str, chn: int) -> str:
    if not cms.jsession:
        await cms.login()
    return cms.live_hls_url(cms.media_bases()[0], dev_id, chn)


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


JUNTAS = ("juntas", "juntos", "junta", "mosaico", "unidas")
SEPARADAS = ("separadas", "separados", "separada")
RAPIDO = ("rapido", "rápido", "rapida", "rápida", "liviano")


def _split_mode(args: list[str]) -> tuple[list[str], bool, bool]:
    """Quita las palabras finales «juntas»/«separadas»/«rapido» (en cualquier orden).

    Devuelve (resto, juntas, rápido)."""
    together = fast = False
    while args and args[-1].lower() in JUNTAS + SEPARADAS + RAPIDO:
        word = args.pop().lower()
        together = together or word in JUNTAS
        fast = fast or word in RAPIDO
    return args, together, fast


@authorized
async def cmd_video(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args, together, fast = _split_mode(list(ctx.args))
    if len(args) == 4:  # sin fecha → hoy
        args.insert(2, "hoy")
    if len(args) != 5:
        raise ParseError("Uso: /video placa canal fecha inicio fin [juntas]\n"
                         "Ejemplo: /video ABC123 1 hoy 14:00 14:10")
    v = await cms.find_vehicle(args[0])
    chans = parse_channels(args[1], v.channels)
    day = parse_date(args[2])
    start, stop = seconds_of_day(parse_time(args[3])), seconds_of_day(parse_time(args[4]))
    if stop <= start:
        raise ParseError("La hora de fin debe ser posterior a la de inicio (mismo día).")
    if stop - start > config.max_clip_minutes * 60:
        raise ParseError(f"Máximo {config.max_clip_minutes} minutos por video.")
    when = f"{day:%d/%m/%Y} {fmt_hms(start)}–{fmt_hms(stop)}"

    msg = update.effective_message
    if together and len(chans) > 1:
        await _video_together(msg, v, chans, day, start, stop, when, fast)
        return
    async def one(chn: int) -> None:
        status = await msg.reply_text(
            f"⏳ {v.plate} {v.channel_label(chn)} {day:%d/%m} {fmt_hms(start)}–{fmt_hms(stop)}: en cola…")
        stats: dict = {}
        try:
            out = await make_clip(v, chn, day, start, stop, status, stats, fast)
        except (CMSV6Error, video.FFmpegError) as e:
            await status.edit_text(f"⚠️ {v.plate} {v.channel_label(chn)}: {e}")
            return
        await deliver(msg, status, out,
                      f"🎥 {v.plate} {v.channel_label(chn)} · {when}{_timing(stats)}")

    # Las cámaras se piden todas a la vez; cada una llega cuando está lista
    await asyncio.gather(*(one(c) for c in chans))


async def _video_together(msg: Message, v: Vehicle, chans: list[int], day: date,
                          start: int, stop: int, when: str, fast: bool = False) -> None:
    status = await msg.reply_text(
        f"⏳ {v.plate} {len(chans)} cámaras juntas, {when}: en cola…")
    t0 = time.monotonic()
    done_count = 0

    async def one(chn: int) -> tuple[int, Path | None, str]:
        nonlocal done_count
        # Mensaje de estado propio por cámara para no pisar el progreso de las otras
        sub = await msg.reply_text(f"⏳ {v.channel_label(chn)}: en cola…")
        try:
            clip = await make_clip(v, chn, day, start, stop, sub, None, fast)
            return chn, clip, ""
        except (CMSV6Error, video.FFmpegError) as e:
            return chn, None, f"{v.channel_label(chn)}: {e}"
        finally:
            done_count += 1
            await _edit(status, f"⏳ {v.plate}: {done_count} de {len(chans)} cámaras listas…")
            try:
                await sub.delete()
            except Exception:
                pass

    results = await asyncio.gather(*(one(c) for c in chans))
    clips = [r[1] for r in results if r[1]]
    ok = [r[0] for r in results if r[1]]
    failed = [r[2] for r in results if not r[1]]
    if not clips:
        await status.edit_text("⚠️ No se pudo obtener ninguna cámara.\n" + "\n".join(failed))
        return
    await _edit(status, f"🧩 Armando el mosaico de {len(clips)} cámaras…")
    out = links.files_dir() / _name(v, -1, day, start, stop, ".mp4", "camaras" + "-".join(
        str(c + 1) for c in ok))
    try:
        async with cpu:
            await video.mosaic(clips, out)
    finally:
        for c in clips:
            c.unlink(missing_ok=True)
    out.chmod(0o644)
    caption = (f"🎥 {v.plate} · cámaras {', '.join(str(c + 1) for c in ok)} juntas · {when}"
               f"\n⏱ {_mmss(time.monotonic() - t0)}")
    if failed:
        caption += "\n⚠️ Sin video: " + "; ".join(failed)
    await deliver(msg, status, out, caption)


@authorized
async def cmd_foto(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args, together, fast = _split_mode(list(ctx.args))
    # Sin fecha ni hora, o con «ahora»: foto instantánea desde el video en vivo
    live = len(args) in (1, 2) or (len(args) == 3 and args[2].lower() in ("ahora", "vivo"))
    if live:
        await _foto_live(update.effective_message, args, together)
        return
    if len(args) == 3:
        args.insert(2, "hoy")
    if len(args) != 4:
        raise ParseError("Uso: /foto placa canal fecha hora [juntas]\n"
                         "Ejemplo: /foto ABC123 1 hoy 14:05:30")
    v = await cms.find_vehicle(args[0])
    chans = parse_channels(args[1], v.channels)
    day = parse_date(args[2])
    at = seconds_of_day(parse_time(args[3]))
    when = f"{day:%d/%m/%Y} {fmt_hms(at)}"
    msg = update.effective_message
    together = together and len(chans) > 1
    photos, ok, failed = [], [], []
    status = None
    for chn in chans:
        if status is None or not together:
            status = await msg.reply_text(f"⏳ Buscando imagen {v.plate} {v.channel_label(chn)}…")
        else:
            await _edit(status, f"⏳ Buscando imagen {v.plate} {v.channel_label(chn)}…")
        try:
            out = await make_photo(v, chn, day, at, status)
        except (CMSV6Error, video.FFmpegError) as e:
            if together:
                failed.append(f"{v.channel_label(chn)}: {e}")
            else:
                await status.edit_text(f"⚠️ {v.plate} {v.channel_label(chn)}: {e}")
            continue
        if together:
            photos.append(out)
            ok.append(chn)
            continue
        await msg.reply_photo(photo=out.read_bytes(),
                              caption=f"📷 {v.plate} {v.channel_label(chn)} · {when}")
        await status.delete()
    if not together:
        return
    if not photos:
        await status.edit_text("⚠️ No se pudo obtener ninguna cámara.\n" + "\n".join(failed))
        return
    out = links.files_dir() / _name(v, -1, day, at, None, ".jpg", "camaras" + "-".join(
        str(c + 1) for c in ok))
    async with cpu:
        await video.mosaic(photos, out, image=True)
    caption = f"📷 {v.plate} · cámaras {', '.join(str(c + 1) for c in ok)} · {when}"
    if failed:
        caption += "\n⚠️ Sin imagen: " + "; ".join(failed)
    await msg.reply_photo(photo=out.read_bytes(), caption=caption)
    await status.delete()


async def _foto_live(msg: Message, args: list[str], together: bool) -> None:
    v = await cms.find_vehicle(args[0])
    chans = parse_channels(args[1] if len(args) > 1 else "todos", v.channels)
    if not cms.jsession:
        await cms.login()
    status = await msg.reply_text(f"📸 Tomando foto en vivo de {v.plate}…")
    stamp = seconds_of_day(datetime.now(TZ).time())

    async def one(chn: int) -> tuple[int, Path | None, str]:
        out = links.files_dir() / _name(v, chn, today(), stamp, None, "_ahora.jpg")
        last = ""
        for base in cms.media_bases():
            try:
                await video.snapshot_live(cms.live_flv_url(base, v.dev_id, chn), out)
                cms.media_url = cms.media_url or base
                return chn, out, ""
            except video.FFmpegError as e:
                last = str(e)
        return chn, None, f"{v.channel_label(chn)}: {last}"

    results = await asyncio.gather(*(one(c) for c in chans))
    ok = [(c, p) for c, p, _ in results if p]
    failed = [e for _, p, e in results if not p]
    when = datetime.now(TZ).strftime("%d/%m/%Y %H:%M:%S")
    if not ok:
        await status.edit_text("⚠️ No llegó imagen en vivo.\n" + "\n".join(failed))
        return
    if together and len(ok) > 1:
        out = links.files_dir() / _name(v, -1, today(), stamp, None, "_ahora.jpg",
                                         "camaras" + "-".join(str(c + 1) for c, _ in ok))
        async with cpu:
            await video.mosaic([p for _, p in ok], out, image=True)
        await msg.reply_photo(photo=out.read_bytes(), caption=f"📸 {v.plate} ahora · {when}")
    else:
        for c, p in ok:
            await msg.reply_photo(photo=p.read_bytes(),
                                  caption=f"📸 {v.plate} {v.channel_label(c)} ahora · {when}")
    if failed:
        await msg.reply_text("⚠️ Sin imagen: " + "; ".join(failed))
    await status.delete()


async def make_photo(v: Vehicle, chn: int, day: date, at: int, status: Message) -> Path:
    recs = await cms.find_recordings(v, day, chn, at, at + 1, config.search_locations)
    if not recs:
        raise CMSV6Error(f"No hay grabación de {v.channel_label(chn)} a las {fmt_hms(at)}.")
    raw, beg, stream, _ = await fetch(v, recs[0], chn, day, at, at + 2, status)
    out = links.files_dir() / _name(v, chn, day, at, None, ".jpg")
    async with cpu:
        await video.extract_frame(raw, out, at - beg, stream)
    return out


async def _edit(status: Message, text: str) -> None:
    try:
        await status.edit_text(text)
    except Exception:
        pass  # Telegram rechaza ediciones con el mismo texto


async def make_clip(v: Vehicle, chn: int, day: date, start: int, stop: int,
                    status: Message, stats: dict | None = None, fast: bool = False) -> Path:
    """Arma el clip de una cámara. En stats deja cuánto tardó cada etapa (para el mensaje).

    Las partes (archivos de grabación) se piden todas a la vez al bus y se comprimen a
    medida que llegan; fast usa la grabación liviana (secundaria) si el equipo la tiene."""
    stats = stats if stats is not None else {}
    t0 = time.monotonic()
    await _edit(status, f"🔎 Buscando grabaciones de {v.plate} {v.channel_label(chn)}…")
    recs = await cms.find_recordings(v, day, chn, start, stop, config.search_locations, fast)
    if not recs:
        raise CMSV6Error(f"No hay grabaciones en ese horario ({fmt_hms(start)}–{fmt_hms(stop)}).")
    stats["buscar"] = time.monotonic() - t0
    work = _work_dir()

    async def part(i: int, rec: RecFile) -> Path:
        a, b = max(start, rec.beg), min(stop, rec.end)
        prefix = f"({i}/{len(recs)}) " if len(recs) > 1 else ""
        t1 = time.monotonic()
        raw, beg, stream, how = await fetch(v, rec, chn, day, a, b, status, prefix)
        stats["bajar"] = max(stats.get("bajar", 0), time.monotonic() - t1)
        stats["metodo"] = how
        piece = work / f"{raw.stem}_{a}_{b}.mp4"
        async with cpu:
            t2 = time.monotonic()
            await _edit(status, f"🗜️ {prefix}Comprimiendo {v.channel_label(chn)}…")
            await video.compress_piece(raw, piece, a - beg, b - a, stream)
            stats["comprimir"] = stats.get("comprimir", 0) + time.monotonic() - t2
        return piece

    pieces = await asyncio.gather(*(part(i, r) for i, r in enumerate(recs, 1)))
    out = links.files_dir() / _name(v, chn, day, start, stop, ".mp4")
    await video.concat(list(pieces), out)
    out.chmod(0o644)
    stats["total"] = time.monotonic() - t0
    log.info("Clip %s cam%d %s (%d partes): %s", v.plate, chn + 1, out.name, len(recs),
             {k: (round(x) if isinstance(x, float) else x) for k, x in stats.items()})
    return out


def _mmss(sec: float) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _timing(stats: dict) -> str:
    if "total" not in stats:
        return ""
    how = {"cache": "ya estaba descargado", "tramos": "solo los minutos pedidos",
           "directa": "archivo completo"}.get(stats.get("metodo", ""), "")
    return (f"\n⏱ {_mmss(stats['total'])} (bajada {_mmss(stats.get('bajar', 0))}"
            f"{' · ' + how if how else ''}, compresión {_mmss(stats.get('comprimir', 0))})")


async def fetch(v: Vehicle, rec: RecFile, chn: int, day: date, start: int, stop: int,
                status: Message, prefix: str = "") -> tuple[Path, int, int, str]:
    """Consigue el video de [start, stop] (o lo reutiliza si ya está en caché).

    Devuelve (archivo, segundo del día en que empieza, índice del video dentro del archivo,
    método). Si la grabación está en el bus y se pide una parte pequeña del archivo, se piden
    solo esos minutos (descarga por tramos), que es mucho menos dato por 4G; si eso falla o
    no avanza, se baja el archivo completo, y viceversa."""
    work = _work_dir()
    safe = re.sub(r"[^\w.-]", "_", f"{rec.dev_id}_{rec.chn}_{rec.path}")[-150:]
    stream = rec.chns.index(chn) if chn in rec.chns else 0
    dest = work / safe
    if dest.exists():
        dest.touch()
        return dest, rec.beg, stream, "cache"
    seg_dest = work / f"{safe}_{start}_{stop}.seg"
    if seg_dest.exists():
        seg_dest.touch()
        return seg_dest, start, 0, "cache"

    can_segment = rec.loc == 1 and bool(rec.task_url) and config.segment_mode != "nunca"
    can_direct = bool(rec.down_url or rec.loc != 1) and not rec.segment_only
    small_part = (stop - start) <= 0.5 * max(rec.end - rec.beg, 1)
    prefer_segment = can_segment and (not can_direct or config.segment_mode == "siempre"
                                      or small_part)

    async def seg_progress(state: str) -> None:
        await _edit(status, f"📡 {prefix}Pidiendo al bus solo {fmt_hms(start)}–{fmt_hms(stop)}: "
                            f"{state}…")

    async def dl_progress(done: int, total: int, speed: float) -> None:
        if total and done < total:
            left = (total - done) / speed if speed else 0
            pct = (f" {done * 100 // total}% (faltan {100 - done * 100 // total}%"
                   f"{f', ~{int(left) // 60}:{int(left) % 60:02d}' if left else ''})")
        else:
            pct = ""
        await _edit(status, f"⬇️ {prefix}Bajando grabación{pct}: {done / 1e6:.0f}"
                            f"{f'/{total / 1e6:.0f}' if total else ''} MB a {speed * 8 / 1e6:.1f} Mbps…")

    async def by_segment(stall: int | None) -> tuple[Path, int, int, str]:
        await seg_progress("enviando solicitud")
        path, beg = await cms.segment_download(v, rec, day, start, stop, seg_dest,
                                               seg_progress, stall_s=stall,
                                               dl_progress=dl_progress)
        return path, beg, 0, "tramos"

    async def direct() -> tuple[Path, int, int, str]:
        await dl_progress(0, rec.size, 0)
        return await cms.download(rec, dest, dl_progress), rec.beg, stream, "directa"

    if prefer_segment:
        try:
            # Si hay plan B, no se espera más de segment_stall_s a que el bus responda
            return await by_segment(config.segment_stall_s if can_direct else None)
        except CMSV6Error as e:
            if not can_direct:
                raise
            log.info("Descarga por tramos falló (%s); se baja el archivo completo", e)
            return await direct()
    try:
        return await direct()
    except CMSV6Error as e:
        if not can_segment:
            raise
        log.info("Descarga directa falló (%s); se intenta por tramos", e)
        return await by_segment(None)


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


def _name(v: Vehicle, chn: int, day: date, start: int, stop: int | None, ext: str,
          cams: str | None = None) -> str:
    plate = re.sub(r"[^\w-]", "", v.plate) or v.dev_id
    t = fmt_hms(start).replace(":", "")
    if stop is not None:
        t += "-" + fmt_hms(stop).replace(":", "")
    return f"{plate}_{cams or f'cam{chn + 1}'}_{day:%Y%m%d}_{t}{ext}"


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
    links.set_live_source(_live_source)
    _busy_flag().unlink(missing_ok=True)  # restos de un reinicio anterior
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
    app.add_handler(CommandHandler(["enlinea", "en_linea"], cmd_enlinea))
    app.add_handler(CommandHandler(["vivo", "envivo"], cmd_vivo))
    app.add_handler(CommandHandler("video", cmd_video))
    app.add_handler(CommandHandler("foto", cmd_foto))
    log.info("Bot iniciado (Bot API: %s)", config.bot_api_url or "nube de Telegram")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
