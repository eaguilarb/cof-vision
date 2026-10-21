"""Bot de Telegram para extraer videos y fotos de las grabaciones de CMSV6."""

import asyncio
import functools
import json
import logging
import os
import re
import shutil
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
/cancelar — detiene los pedidos en curso de este chat
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
<code>/video ABC123 1,2,3 hoy 08:30 08:35 juntas audio2</code> (mosaico con el sonido de la cámara 2)

Fecha: hoy, ayer, 19/10 o 19/10/2026. Canal: 1, 2, 1,3 o todos.
Con varias cámaras: sin nada al final llegan separadas; con «juntas», en mosaico.
En el mosaico: «audio2» usa el sonido de la cámara 2, «sinaudio» lo quita (si no pones
nada, usa la primera cámara que tenga sonido). Un video solo conserva su audio.
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


# Tramos pedidos a cada bus al mismo tiempo (ver BUS_PARALLEL)
_bus_slots: dict[str, asyncio.Semaphore] = {}


def _bus_slot(dev_id: str) -> asyncio.Semaphore:
    if dev_id not in _bus_slots:
        _bus_slots[dev_id] = asyncio.Semaphore(max(1, config.bus_parallel))
    return _bus_slots[dev_id]


# Pedidos en curso por chat, para poder detenerlos con /cancelar
_running: dict[int, set[asyncio.Task]] = {}
_trackers: dict[int, set["Tracker"]] = {}


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
        chat = update.effective_chat.id if update.effective_chat else 0
        task = asyncio.current_task()
        if task and handler.__name__ != "cmd_cancelar":
            _running.setdefault(chat, set()).add(task)
        try:
            await handler(update, ctx)
        except asyncio.CancelledError:
            log.info("Pedido cancelado en el chat %s", chat)
        except (ParseError, CMSV6Error, video.FFmpegError) as e:
            await update.effective_message.reply_text(f"⚠️ {e}")
        except Exception:
            log.exception("Error inesperado")
            await update.effective_message.reply_text("⚠️ Ocurrió un error inesperado. Revisa los logs.")
        finally:
            _set_busy(-1)
            if task:
                _running.get(chat, set()).discard(task)
    return wrapper


@authorized
async def cmd_probar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Mide qué método es más rápido con un bus real: /probar placa cámara fecha hora."""
    args = list(ctx.args)
    if len(args) == 3:
        args.insert(2, "hoy")
    if len(args) != 4:
        raise ParseError("Uso: /probar placa cámara fecha hora   (ej. /probar SPBG22 1 hoy 13:30)")
    v = await cms.find_vehicle(args[0])
    chn = parse_channels(args[1], v.channels)[0]
    day = parse_date(args[2])
    at = seconds_of_day(parse_time(args[3]))
    msg = update.effective_message
    recs = await cms.find_recordings(v, day, chn, at, at + 60, config.search_locations)
    if not recs:
        raise CMSV6Error("No hay grabación en ese horario.")
    rec = recs[0]
    a, b = max(at, rec.beg), min(at + 60, rec.end)
    lines = [f"🧪 Prueba con {v.plate} {v.channel_label(chn)}, {b - a} s de video desde {fmt_hms(a)}",
             f"Archivo del bus: {fmt_hms(rec.beg)}–{fmt_hms(rec.end)}, "
             f"{rec.size / 1e6:.1f} MB, ubicación {LOC_NAMES.get(rec.loc, rec.loc)}, "
             f"calidad {'liviana' if rec.stream_type == 1 else 'principal'}"]
    status = await msg.reply_text("\n".join(lines + ["Probando métodos…"]))
    avail = [m for m in ("reproduccion", "tramos", "directa")
             if (m == "reproduccion" and rec.playback_url) or (m == "tramos" and rec.task_url)
             or (m == "directa" and (rec.down_url or rec.loc != 1))]
    names = {"reproduccion": "▶️ Reproducción remota", "tramos": "📡 Descarga por tramos",
             "directa": "⬇️ Archivo completo", "ftp": "📤 Subida por FTP"}
    if rec.loc == 1:
        await _edit(status, "\n".join(lines + [f"Probando {names['ftp']}…"]))
        t = time.monotonic()
        try:
            raw = await fetch_ftp(v, chn, day, a, b, status)
            took = time.monotonic() - t
            lines.append(f"{names['ftp']}: {b - a} s de video en {took:.0f} s "
                         f"→ {(b - a) / took:.2f}× tiempo real")
        except Exception as e:
            _learn_method("ftp", 0, 0, ok=False)
            lines.append(f"{names['ftp']}: no funcionó ({str(e)[:150]})")
    for m in avail:
        await _edit(status, "\n".join(lines + [f"Probando {names[m]}…"]))
        t = time.monotonic()
        try:
            raw, beg, stream, _ = await fetch(v, rec, chn, day, a, b, status, force=m)
            took = time.monotonic() - t
            lines.append(f"{names[m]}: {b - a} s de video en {took:.0f} s "
                         f"→ {(b - a) / took:.2f}× tiempo real")
            if m == "reproduccion":
                out = links.files_dir() / _name(v, chn, day, a, b, "_prueba.mp4")
                async with cpu:
                    await video.compress_piece(raw, out, a - beg, b - a, stream)
                await msg.reply_video(video=out, caption="Video obtenido por reproducción remota")
        except Exception as e:
            lines.append(f"{names[m]}: no funcionó ({str(e)[:150]})")
    best = ["ftp"] if _ftp_first([rec]) else _choose_methods(rec, a, b)
    lines.append(f"✅ Desde ahora el bot usará primero: {names[best[0]] if best else '—'}")
    log.info("Prueba de métodos: %s", " | ".join(lines))
    await _edit(status, "\n".join(lines))


@authorized
async def cmd_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Detiene todos los pedidos en curso de este chat (y sus descargas en los buses)."""
    chat = update.effective_chat.id
    tasks = [t for t in _running.get(chat, set()) if not t.done()]
    for tr in list(_trackers.get(chat, set())):
        tr.stop()
        await _edit(tr.status, f"{tr.title}\n❌ Cancelado")
    for t in tasks:
        t.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    await update.effective_message.reply_text(
        f"🛑 Se detuvieron {len(tasks)} pedido(s)." if tasks else "No hay pedidos en curso.")


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
    args, together, _, audio = _split_mode(list(ctx.args))
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
        cams_ok = [c for c, _ in ok]
        a_idx = cams_ok.index(audio) if audio is not None and audio in cams_ok else (
            -1 if audio == -1 else None)
        async with cpu:
            await video.mosaic([p for _, p in ok], out, audio_from=a_idx)
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


_AUDIO_RE = re.compile(r"(?:audio|sonido|aud)[:=]?(\d)")
SIN_AUDIO = ("sinaudio", "sin_audio", "mudo", "silencio")


def _split_mode(args: list[str]) -> tuple[list[str], bool, bool, int | None]:
    """Quita las palabras finales «juntas»/«separadas»/«rapido»/«audioN»/«sinaudio»
    (en cualquier orden).

    Devuelve (resto, juntas, rápido, audio): audio = cámara (base 0) cuyo sonido va en el
    mosaico, -1 sin audio, None automático (la primera cámara que tenga sonido)."""
    together = fast = False
    audio: int | None = None
    while args:
        word = args[-1].lower()
        m = _AUDIO_RE.fullmatch(word)
        if m:
            audio = int(m.group(1)) - 1
        elif word in SIN_AUDIO:
            audio = -1
        elif word in JUNTAS + SEPARADAS + RAPIDO:
            together = together or word in JUNTAS
            fast = fast or word in RAPIDO
        else:
            break
        args.pop()
    return args, together, fast, audio


@authorized
async def cmd_video(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args, together, fast, audio = _split_mode(list(ctx.args))
    if len(args) == 4 and not re.fullmatch(r"\d{1,2}(:\d{2}){0,2}h?", args[2]):
        raise ParseError(f"Falta la hora de fin. Ejemplo: /video {args[0]} {args[1]} {args[2]} "
                         f"{args[3]} HH:MM")
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
    total_video = (stop - start) * len(chans)
    if total_video >= 6 * 60 and config.download_method != "ftp":
        sp = _speed()
        eta = (sp["base"] * len(chans) + sp["ratio"] * total_video) / max(1, config.bus_parallel)
        await msg.reply_text(
            f"ℹ️ Son {total_video // 60} min de video que el bus debe enviar por su 4G "
            f"({(stop - start) // 60} min × {len(chans)} cámaras). Estimado: ~{_mmss(eta)}.\n"
            "Para recibirlo antes, pide menos minutos o menos cámaras; puedes detenerlo con /cancelar.")
    if together and len(chans) > 1:
        if audio is not None and audio >= 0 and audio not in chans:
            raise ParseError(f"El audio debe ser de una de las cámaras pedidas "
                             f"({', '.join(str(c + 1) for c in chans)}).")
        await _video_together(msg, v, chans, day, start, stop, when, fast, audio)
        return
    async def one(chn: int) -> None:
        title = f"🎥 {v.plate} {v.channel_label(chn)} · {day:%d/%m} {fmt_hms(start)}–{fmt_hms(stop)}"
        status = await msg.reply_text(f"{title}\n{_bar(0)} 0% · en cola…")
        tracker = Tracker(status, title)
        stats: dict = {}
        try:
            out = await _clip_fn()(v, chn, day, start, stop, tracker.cam(chn, v.channel_label(chn)),
                                  stats, fast)
        except (CMSV6Error, video.FFmpegError) as e:
            tracker.stop()
            await status.edit_text(f"⚠️ {v.plate} {v.channel_label(chn)}: {e}")
            return
        tracker.stop()
        sound = "" if await video.has_audio(out) else "\n🔇 esta grabación no trae audio"
        avi = ""
        if stats.get("avi"):
            link = links.make_link(stats["avi"])
            if link:
                avi = f"\n📼 AVI original del FTP: {link}"
        await deliver(msg, status, out,
                      f"🎥 {v.plate} {v.channel_label(chn)} · {when}{sound}{_timing(stats)}{avi}")

    # Las cámaras se piden todas a la vez; cada una llega cuando está lista
    await asyncio.gather(*(one(c) for c in chans))


async def _video_together(msg: Message, v: Vehicle, chans: list[int], day: date,
                          start: int, stop: int, when: str, fast: bool = False,
                          audio: int | None = None) -> None:
    title = f"🎥 {v.plate} · cámaras {', '.join(str(c + 1) for c in chans)} juntas · {when}"
    status = await msg.reply_text(f"{title}\n{_bar(0)} 0% · en cola…")
    tracker = Tracker(status, title)
    t0 = time.monotonic()
    cam_status = {c: tracker.cam(c, v.channel_label(c)) for c in chans}

    async def one(chn: int) -> tuple[int, Path | None, str]:
        try:
            clip = await _clip_fn()(v, chn, day, start, stop, cam_status[chn], None, fast,
                                   intermediate=True)
            return chn, clip, ""
        except (CMSV6Error, video.FFmpegError) as e:
            await cam_status[chn].set(f"⚠️ {e}", 100, 0)
            return chn, None, f"{v.channel_label(chn)}: {e}"

    results = await asyncio.gather(*(one(c) for c in chans))
    clips = [r[1] for r in results if r[1]]
    ok = [r[0] for r in results if r[1]]
    failed = [r[2] for r in results if not r[1]]
    tracker.stop()
    if not clips:
        await status.edit_text("⚠️ No se pudo obtener ninguna cámara.\n" + "\n".join(failed))
        return
    await _edit(status, f"{title}\n{_bar(97)} 97% · 🧩 armando el mosaico…")
    out = links.files_dir() / _name(v, -1, day, start, stop, ".mp4", "camaras" + "-".join(
        str(c + 1) for c in ok))
    # Audio: la cámara elegida (si llegó), o la primera que tenga sonido
    audio_idx = ok.index(audio) if audio is not None and audio in ok else (
        -1 if audio == -1 else None)
    if audio_idx is None:
        for i, c in enumerate(clips):
            if await video.has_audio(c):
                audio_idx = i
                break
    try:
        async with cpu:
            await video.mosaic(clips, out, audio_from=audio_idx if audio_idx is not None else -1)
    finally:
        for c in clips:
            c.unlink(missing_ok=True)
    out.chmod(0o644)
    if audio_idx is not None and audio_idx >= 0:
        sound = f"🔊 audio de la cámara {ok[audio_idx] + 1}"
    elif audio == -1:
        sound = "🔇 sin audio (pedido)"
    else:
        sound = "🔇 las grabaciones no traen audio"
    caption = (f"🎥 {v.plate} · cámaras {', '.join(str(c + 1) for c in ok)} juntas · {when}"
               f"\n{sound}\n⏱ {_mmss(time.monotonic() - t0)}")
    if failed:
        caption += "\n⚠️ Sin video: " + "; ".join(failed)
    await deliver(msg, status, out, caption)


@authorized
async def cmd_foto(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args, together, fast, _ = _split_mode(list(ctx.args))
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


async def _edit(status, text: str, pct: float | None = None, left: float | None = None,
                part: int = 0) -> None:
    if isinstance(status, CamStatus):
        await status.set(text, pct, left, part)
        return
    try:
        await status.edit_text(text)
    except Exception:
        pass  # Telegram rechaza ediciones con el mismo texto


# ---------- Avance (porcentaje y tiempo estimado) ----------

_SPEED_FILE = "velocidad.json"


def _speed() -> dict:
    """Cuánto tarda el bus en enviar un tramo: base + ratio × segundos de video.
    Se ajusta solo con cada descarga real."""
    try:
        return json.loads((config.data_dir / _SPEED_FILE).read_text())
    except Exception:
        return {"base": 30.0, "ratio": 1.3}


def _learn_speed(seconds_video: float, seconds_taken: float) -> None:
    if seconds_video <= 0:
        return
    sp = _speed()
    sample = max(0.1, (seconds_taken - sp["base"]) / seconds_video)
    sp["ratio"] = round(0.7 * sp["ratio"] + 0.3 * sample, 3)
    try:
        (config.data_dir / _SPEED_FILE).write_text(json.dumps(sp))
    except OSError:
        pass


def _save_speed(sp: dict) -> None:
    try:
        (config.data_dir / _SPEED_FILE).write_text(json.dumps(sp))
    except OSError:
        pass


# Velocidad supuesta (segundos de video por segundo real) mientras no haya mediciones
_DEFAULT_VEL = {"ftp": 3.0, "reproduccion": 1.0, "tramos": 0.6, "directa": 0.6}
_FAIL_COOLDOWN = 1800  # un método que falla se deja de lado 30 min


def _method_info(m: str) -> dict:
    return _speed().get("metodos", {}).get(m, {})


def _learn_method(m: str, video_seconds: float, wall_seconds: float, ok: bool = True) -> None:
    """Guarda cuánto rinde cada método con tus buses (media móvil) o cuándo falló."""
    sp = _speed()
    info = sp.setdefault("metodos", {}).setdefault(m, {})
    if ok and video_seconds > 0 and wall_seconds > 0:
        sample = video_seconds / wall_seconds
        info["vel"] = round(0.7 * info["vel"] + 0.3 * sample, 3) if "vel" in info else round(sample, 3)
        info["n"] = info.get("n", 0) + 1
        info.pop("fallo", None)
    elif not ok:
        info["fallo"] = int(time.time())
    _save_speed(sp)


def _method_vel(m: str) -> float:
    return _method_info(m).get("vel", _DEFAULT_VEL[m])


def _choose_methods(rec: RecFile, start: int, stop: int) -> list[str]:
    """Métodos posibles para este archivo, del más rápido (según lo medido) al más lento."""
    if rec.loc != 1:
        return ["directa"]  # ya está en el servidor: es lo más rápido
    avail = []
    if rec.playback_url:
        avail.append("reproduccion")
    if rec.task_url and config.segment_mode != "nunca":
        avail.append("tramos")
    if rec.down_url and not rec.segment_only:
        avail.append("directa")
    file_len = max(rec.end - rec.beg, 1)

    def score(m: str) -> float:
        failed = time.time() - _method_info(m).get("fallo", 0) < _FAIL_COOLDOWN
        vel = _method_vel(m)
        if m == "directa":  # baja el archivo completo: rinde según la parte que se usa
            vel *= (stop - start) / file_len
        return vel - (100 if failed else 0)

    avail.sort(key=score, reverse=True)
    forced = {"reproduccion": "reproduccion", "tramos": "tramos", "directa": "directa"}.get(
        config.download_method) or ("tramos" if config.segment_mode == "siempre" else None)
    if forced in avail:
        avail.remove(forced)
        avail.insert(0, forced)
    return avail


def _ftp_first(recs: list[RecFile]) -> bool:
    """¿Conviene el método FTP (una tarea por cámara para todo el horario)?"""
    if not recs or all(r.loc != 1 for r in recs):
        return False  # ya está en el servidor
    if config.download_method == "ftp":
        return True  # siempre primero, como en el aplicativo (los otros quedan de respaldo)
    if config.download_method != "auto":
        return False
    failed = time.time() - _method_info("ftp").get("fallo", 0) < _FAIL_COOLDOWN
    if failed:
        return False
    rest = max(_method_vel(m) for m in ("reproduccion", "tramos", "directa"))
    return _method_vel("ftp") >= rest


def _bus_stream_slot(dev_id: str) -> asyncio.Semaphore:
    key = "stream:" + dev_id
    if key not in _bus_slots:
        _bus_slots[key] = asyncio.Semaphore(max(1, config.bus_streams))
    return _bus_slots[key]


def _bar(pct: float) -> str:
    n = int(round(pct / 10))
    return "▰" * n + "▱" * (10 - n)


class Tracker:
    """Un solo mensaje con el avance de un pedido: barra, %, lo que falta y tiempo estimado.
    Se refresca solo cada pocos segundos aunque el bus no informe nada."""

    def __init__(self, status: Message, title: str):
        self.status, self.title = status, title
        self.cams: dict[int, "CamStatus"] = {}
        self.t0 = time.monotonic()
        self._last = 0.0
        self._ticker: asyncio.Task | None = None
        self._owner = asyncio.current_task()
        self._chat = getattr(status, "chat_id", 0)
        _trackers.setdefault(self._chat, set()).add(self)

    def cam(self, chn: int, label: str) -> "CamStatus":
        cs = CamStatus(self, label)
        self.cams[chn] = cs
        if self._ticker is None:
            self._ticker = asyncio.create_task(self._tick())
        return cs

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(5)
            if self._owner is not None and self._owner.done():
                return
            await self.render(force=True)

    def stop(self) -> None:
        if self._ticker:
            self._ticker.cancel()
        _trackers.get(self._chat, set()).discard(self)

    def overall(self) -> tuple[float, float | None]:
        cams = list(self.cams.values())
        pct = sum(c.pct() for c in cams) / max(len(cams), 1)
        lefts = [c.left() for c in cams if c.pct() < 100 and c.left() is not None]
        return pct, (max(lefts) if lefts else None)

    async def render(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last < 3:
            return
        self._last = now
        pct, left = self.overall()
        head = f"{_bar(pct)} {pct:.0f}% · faltan {100 - pct:.0f}%"
        if left is not None:
            head += f" (~{_mmss(left)})"
        lines = [self.title, head, f"⏱ {_mmss(now - self.t0)} transcurrido"]
        cams = list(self.cams.values())
        if len(cams) == 1:
            lines.append(cams[0].text)
        else:
            lines += [f"• {c.label}: {c.pct():.0f}% · {c.text}" for c in cams]
        await _edit(self.status, "\n".join(lines))


class CamStatus:
    """Avance de una cámara (puede tener varias partes que se bajan a la vez)."""

    def __init__(self, tracker: Tracker, label: str):
        self.tracker, self.label = tracker, label
        self.text = "en cola"
        self.parts = 1
        self._pct: dict[int, float] = {}
        self._left: dict[int, float] = {}
        self._t = time.monotonic()

    def pct(self) -> float:
        return sum(self._pct.get(i, 0) for i in range(self.parts)) / self.parts

    def left(self) -> float | None:
        if not self._left:
            return None
        # Lo que faltaba al último aviso, descontando el tiempo que pasó desde entonces
        return max(0.0, max(self._left.values()) - (time.monotonic() - self._t))

    async def set(self, text: str, pct: float | None = None, left: float | None = None,
                  part: int = 0) -> None:
        self.text = text
        if pct is not None:
            self._pct[part] = max(self._pct.get(part, 0), min(100.0, pct))
        if left is not None:
            self._left[part] = left
            self._t = time.monotonic()
        await self.tracker.render()

    async def edit_text(self, text: str) -> None:
        await self.set(text)


async def make_clip(v: Vehicle, chn: int, day: date, start: int, stop: int,
                    status, stats: dict | None = None, fast: bool = False,
                    intermediate: bool = False) -> Path:
    """Arma el clip de una cámara. En stats deja cuánto tardó cada etapa (para el mensaje).

    Las partes (archivos de grabación) se piden todas a la vez al bus y se comprimen a
    medida que llegan; fast usa la grabación liviana (secundaria) si el equipo la tiene."""
    stats = stats if stats is not None else {}
    t0 = time.monotonic()
    await _edit(status, "🔎 buscando la grabación", 2)
    recs = await cms.find_recordings(v, day, chn, start, stop, config.search_locations, fast)
    if not recs:
        raise CMSV6Error(f"No hay grabaciones en ese horario ({fmt_hms(start)}–{fmt_hms(stop)}).")
    stats["buscar"] = time.monotonic() - t0
    work = _work_dir()

    if _ftp_first(recs):
        try:
            raw = await fetch_ftp(v, chn, day, start, stop, status, fast)
            log.info("Archivo FTP %s: %s", raw.name, await video.describe(raw))
            stats["bajar"] = time.monotonic() - t0 - stats["buscar"]
            stats["metodo"] = "ftp"
            out = links.files_dir() / _name(v, chn, day, start, stop, ".mp4")
            async with cpu:
                t2 = time.monotonic()
                done = False
                if config.ftp_remux and not intermediate:
                    await _edit(status, "⚡ preparando el MP4 (sin recomprimir)", 95, 3)
                    done = await video.remux(raw, out, stop - start)
                if not done:
                    await _edit(status, "🗜️ comprimiendo (ultrarrápido)", 92, 10)
                    await video.compress_piece(raw, out, 0, stop - start, 0, intermediate)
                stats["comprimir"] = time.monotonic() - t2
            out.chmod(0o644)
            stats["total"] = time.monotonic() - t0
            log.info("Clip %s cam%d %s (FTP): %s", v.plate, chn + 1, out.name,
                     {k: (round(x) if isinstance(x, float) else x) for k, x in stats.items()})
            return out
        except (CMSV6Error, video.FFmpegError) as e:
            _learn_method("ftp", 0, 0, ok=False)
            log.info("Método FTP falló (%s); se usan los otros métodos", e)
            await _edit(status, "🔁 FTP no funcionó, cambiando de método…")

    if isinstance(status, CamStatus):
        status.parts = len(recs)

    async def part(i: int, rec: RecFile) -> Path:
        a, b = max(start, rec.beg), min(stop, rec.end)
        prefix = f"({i}/{len(recs)}) " if len(recs) > 1 else ""
        t1 = time.monotonic()
        try:
            raw, beg, stream, how = await fetch(v, rec, chn, day, a, b, status, prefix, i - 1)
        except CMSV6Error as e:
            # Un tramo que falla no debe tumbar la cámara completa: se reintenta una vez
            log.info("Parte %d de cam%d falló (%s); se reintenta", i, chn + 1, e)
            await _edit(status, f"🔁 {prefix}reintentando ({e})"[:120], None, None, i - 1)
            await asyncio.sleep(5)
            raw, beg, stream, how = await fetch(v, rec, chn, day, a, b, status, prefix, i - 1)
        stats["bajar"] = max(stats.get("bajar", 0), time.monotonic() - t1)
        stats["metodo"] = how
        piece = work / f"{raw.stem}_{a}_{b}.mp4"
        async with cpu:
            t2 = time.monotonic()
            await _edit(status, f"🗜️ {prefix}comprimiendo", 92, 10, i - 1)
            await video.compress_piece(raw, piece, a - beg, b - a, stream, intermediate)
            await _edit(status, f"✅ {prefix}lista", 100, 0, i - 1)
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
    how = {"cache": "ya estaba descargado", "tramos": "el bus subió el tramo",
           "ftp": "el bus lo subió por FTP",
           "directa": "archivo completo", "reproduccion": "el bus lo transmitió"}.get(
        stats.get("metodo", ""), "")
    return (f"\n⏱ {_mmss(stats['total'])} (bajada {_mmss(stats.get('bajar', 0))}"
            f"{' · ' + how if how else ''}, compresión {_mmss(stats.get('comprimir', 0))})")


async def fetch_ftp(v: Vehicle, chn: int, day: date, start: int, stop: int, status,
                    fast: bool = False) -> Path:
    """Paso 1: el bus sube [start, stop] al FTP de CMSV7 (un AVI).
    Paso 2: se descarga ese AVI del FTP. Nada más."""
    dest = _work_dir() / f"{v.dev_id}_{chn}_{day:%Y%m%d}_{start}_{stop}{'_l' if fast else ''}.avi"
    if dest.exists():
        dest.touch()
        await _edit(status, "✅ ya estaba descargado", 95, 2)
        return dest
    want = stop - start
    exp = want / max(_method_vel("ftp"), 0.1) + 20

    async def progress(state: str, st=None, elapsed: float = 0, task_pct=None) -> None:
        # Paso 1 = del 0 % al 70 %
        frac = task_pct / 100 if task_pct is not None else min(0.95, elapsed / exp)
        pct_txt = f"{task_pct}%" if task_pct is not None else f"~{frac * 100:.0f}%"
        await _edit(status, f"📤 Paso 1/2 · Subiendo al FTP: {state} ({pct_txt} · {_mmss(elapsed)})",
                    70 * frac, max(10.0, exp - elapsed) + 15)

    async def dl_progress(done: int, total: int, speed: float) -> None:
        # Paso 2 = del 70 % al 95 %
        frac = done / total if total else 0
        left = ((total - done) / speed if speed and total else 15) + 5
        mb = f"{done / 1e6:.1f}{f'/{total / 1e6:.1f}' if total else ''} MB"
        pct_txt = f"{frac * 100:.0f}% · " if total else ""
        await _edit(status, f"⬇️ Paso 2/2 · Descargando del FTP: {pct_txt}{mb} · "
                            f"{speed * 8 / 1e6:.1f} Mbps", 70 + 25 * frac, left)

    t = time.monotonic()
    async with _bus_slot(v.dev_id):
        await progress("enviando la orden al bus", None, 0, 0)
        streams = [1, 0] if fast else [0]  # «rapido»: calidad liviana si el bus la tiene
        for i, stream in enumerate(streams):
            try:
                path = await cms.ftp_download(v.dev_id, chn, day, start, stop, dest, progress,
                                              dl_progress, stream)
                break
            except CMSV6Error as e:
                if i == len(streams) - 1:
                    raise
                log.info("FTP en calidad liviana falló (%s); se usa la principal", e)
    _learn_method("ftp", want, time.monotonic() - t)
    return path


async def make_clip_ftp(v: Vehicle, chn: int, day: date, start: int, stop: int, status,
                        stats: dict | None = None, fast: bool = False,
                        intermediate: bool = False) -> Path:
    """Solo FTP: el bus sube los minutos pedidos al FTP de CMSV7, se descarga el AVI y se
    entrega (sin recomprimir si ya es H.264). Sin búsquedas ni otros métodos."""
    stats = stats if stats is not None else {}
    t0 = time.monotonic()
    raw = await fetch_ftp(v, chn, day, start, stop, status, fast)
    log.info("Archivo FTP %s: %s", raw.name, await video.describe(raw))
    stats["bajar"] = time.monotonic() - t0
    stats["metodo"] = "ftp"
    out = links.files_dir() / _name(v, chn, day, start, stop, ".mp4")
    # El AVI original también queda disponible por enlace
    avi = links.files_dir() / _name(v, chn, day, start, stop, ".avi")
    try:
        if not avi.exists():
            os.link(raw, avi)
        avi.chmod(0o644)
        stats["avi"] = avi
    except OSError:
        pass
    async with cpu:
        t2 = time.monotonic()
        done = False
        if config.ftp_remux and not intermediate:
            await _edit(status, "⚡ Preparando el video para Telegram (sin recomprimir)…", 96, 3)
            done = await video.remux(raw, out, stop - start)
        if not done:
            await _edit(status, "⚡ Preparando el video para Telegram…", 96, 10)
            await video.compress_piece(raw, out, 0, stop - start, 0, intermediate)
        stats["comprimir"] = time.monotonic() - t2
    out.chmod(0o644)
    await _edit(status, "✅ listo", 100, 0)
    stats["total"] = time.monotonic() - t0
    log.info("Clip %s cam%d %s (FTP): %s", v.plate, chn + 1, out.name,
             {k: (round(x) if isinstance(x, float) else x) for k, x in stats.items()
              if k != "avi"})
    return out


def _clip_fn():
    """Con DOWNLOAD_METHOD=ftp (por defecto) se usa solo el FTP."""
    return make_clip_ftp if config.download_method == "ftp" else make_clip


async def fetch(v: Vehicle, rec: RecFile, chn: int, day: date, start: int, stop: int,
                status, prefix: str = "", part: int = 0,
                force: str | None = None) -> tuple[Path, int, int, str]:
    """Consigue el video de [start, stop] (o lo reutiliza si ya está en caché).

    Devuelve (archivo, segundo del día en que empieza, índice del video dentro del archivo,
    método). Si la grabación está en el bus y se pide una parte pequeña del archivo, se piden
    solo esos minutos (descarga por tramos), que es mucho menos dato por 4G; si eso falla o
    no avanza, se baja el archivo completo, y viceversa."""
    work = _work_dir()
    safe = re.sub(r"[^\w.-]", "_", f"{rec.dev_id}_{rec.chn}_{rec.path}")[-150:]
    stream = rec.chns.index(chn) if chn in rec.chns else 0
    dest = work / safe
    if force:
        safe += "_" + force  # en /probar cada método baja su propia copia
        dest = work / safe
    if dest.exists():
        dest.touch()
        return dest, rec.beg, stream, "cache"
    seg_dest = work / f"{safe}_{start}_{stop}.seg"
    for cached in (seg_dest, seg_dest.with_suffix(".rep")):
        if cached.exists():
            cached.touch()
            return cached, start, 0, "cache"

    sp = _speed()
    expected = sp["base"] + sp["ratio"] * (stop - start)  # tiempo estimado del bus

    async def seg_progress(state: str, stu=None, elapsed: float = 0, task_pct=None) -> None:
        # Del 5 % al 75 %: lo que tarda el bus en enviar (estimado si CMSV7 no lo informa)
        frac = task_pct / 100 if task_pct is not None else min(0.95, elapsed / expected)
        pct = 5 + 70 * frac
        left = max(10.0, expected - elapsed) + 15
        await _edit(status, f"📡 {prefix}{state}", pct, left, part)

    async def dl_progress(done: int, total: int, speed: float) -> None:
        # Bajando el archivo: del 75 % al 90 % (o del 5 % al 90 % si es descarga directa)
        lo = 75 if seg_started else 5
        frac = done / total if total else 0
        left = ((total - done) / speed if speed and total else 30) + 10
        mb = f"{done / 1e6:.0f}{f'/{total / 1e6:.0f}' if total else ''} MB"
        await _edit(status, f"⬇️ {prefix}bajando {mb} a {speed * 8 / 1e6:.1f} Mbps",
                    lo + (90 - lo) * frac, left, part)

    seg_started = False

    async def by_segment(stall: int | None) -> tuple[Path, int, int, str]:
        nonlocal seg_started
        slot = _bus_slot(v.dev_id)
        if slot.locked():
            await _edit(status, f"⏳ {prefix}en fila: el bus envía un tramo a la vez", 3,
                        expected * 2 + 15, part)
        async with slot:
            seg_started = True
            await seg_progress("pidiendo el tramo al bus")
            t = time.monotonic()
            path, beg = await cms.segment_download(v, rec, day, start, stop, seg_dest,
                                                   seg_progress, stall_s=stall,
                                                   dl_progress=dl_progress)
            took = time.monotonic() - t
            _learn_speed(stop - start, took)
            _learn_method("tramos", stop - start, took)
        return path, beg, 0, "tramos"

    async def direct() -> tuple[Path, int, int, str]:
        await dl_progress(0, rec.size, 0)
        t = time.monotonic()
        path = await cms.download(rec, dest, dl_progress)
        _learn_method("directa", rec.end - rec.beg, time.monotonic() - t)
        return path, rec.beg, stream, "directa"

    async def by_stream() -> tuple[Path, int, int, str]:
        """Reproducción remota: el bus transmite el tramo; varias cámaras a la vez."""
        want = stop - start
        vel = _method_vel("reproduccion")
        exp = want / max(vel, 0.1) + 10
        out = work / f"{safe}_{start}_{stop}.mkv"
        async with _bus_stream_slot(v.dev_id):
            if not cms.jsession:
                await cms.login()
            url = cms.playback_stream_url(rec, start, stop)
            t = time.monotonic()

            async def ticker() -> None:
                while True:
                    el = time.monotonic() - t
                    await _edit(status, f"▶️ {prefix}el bus está transmitiendo",
                                5 + 85 * min(0.95, el / exp), max(5.0, exp - el) + 10, part)
                    await asyncio.sleep(3)

            tick = asyncio.create_task(ticker())
            try:
                path, took = await video.record_stream(url, out, int(want * 3 + 60), want + 2)
            finally:
                tick.cancel()
        got = await video.probe_duration(path)
        if got < 0.8 * want:
            path.unlink(missing_ok=True)
            raise CMSV6Error(f"la reproducción remota entregó {got:.0f} de {want} s")
        _learn_method("reproduccion", got, took)
        final = seg_dest.with_suffix(".rep")
        path.rename(final)
        return final, start, 0, "reproduccion"

    runners = {"reproduccion": by_stream, "tramos": None, "directa": direct}
    methods = [force] if force else _choose_methods(rec, start, stop)
    if not methods:
        raise CMSV6Error("CMSV7 no ofrece ninguna forma de descargar esta grabación.")
    last: Exception | None = None
    for i, m in enumerate(methods):
        has_backup = i < len(methods) - 1
        try:
            if m == "tramos":
                # Con plan B, no se espera más de segment_stall_s a que el bus responda
                return await by_segment(config.segment_stall_s if has_backup else None)
            return await runners[m]()
        except (CMSV6Error, video.FFmpegError) as e:
            last = e
            _learn_method(m, 0, 0, ok=False)
            log.info("Método %s falló (%s)%s", m, e, "; se prueba otro" if has_backup else "")
            if has_backup:
                await _edit(status, f"🔁 {prefix}cambiando de método…", None, None, part)
    raise last if isinstance(last, CMSV6Error) else CMSV6Error(str(last))


async def deliver(msg: Message, status: Message, out: Path, caption: str) -> None:
    size_mb = out.stat().st_size / 1e6
    link = links.make_link(out)
    caption = f"{caption}\n{size_mb:.1f} MB"
    if link:
        caption += f"\n⬇️ Descarga ({config.link_hours} h): {link}"
    if size_mb <= config.telegram_max_mb:
        await status.edit_text(f"📨 Enviando a Telegram ({size_mb:.1f} MB)…")
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
            # Si el disco se llena, se borra la caché más antigua hasta dejar 3 GB libres
            files = sorted((p for p in _work_dir().iterdir() if p.is_file()),
                           key=lambda p: p.stat().st_mtime)
            while files and shutil.disk_usage(config.data_dir).free < 3 * 1024**3:
                files.pop(0).unlink(missing_ok=True)
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
    app.add_handler(CommandHandler(["cancelar", "detener", "parar"], cmd_cancelar))
    app.add_handler(CommandHandler("probar", cmd_probar))
    app.add_handler(CommandHandler("video", cmd_video))
    app.add_handler(CommandHandler("foto", cmd_foto))
    log.info("Bot iniciado (Bot API: %s)", config.bot_api_url or "nube de Telegram")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
