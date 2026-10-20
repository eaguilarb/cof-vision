"""Interpretación de fechas, horas y canales escritos por el usuario."""

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import os

TZ = ZoneInfo(os.environ.get("TZ", "America/Santiago"))


class ParseError(ValueError):
    pass


def today() -> date:
    return datetime.now(TZ).date()


def parse_date(text: str) -> date:
    t = text.strip().lower()
    if t == "hoy":
        return today()
    if t == "ayer":
        return today() - timedelta(days=1)
    if t == "anteayer":
        return today() - timedelta(days=2)
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        y, mo, d = map(int, m.groups())
        return _mk_date(y, mo, d)
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?", t)
    if m:
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else today().year
        if y < 100:
            y += 2000
        return _mk_date(y, mo, d)
    raise ParseError(f"No entiendo la fecha «{text}». Usa hoy, ayer, 19/10 o 19/10/2026.")


def _mk_date(y: int, mo: int, d: int) -> date:
    try:
        return date(y, mo, d)
    except ValueError as e:
        raise ParseError(f"Fecha inválida: {d}/{mo}/{y}") from e


def parse_time(text: str) -> time:
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?", text.strip().lower().rstrip("h"))
    if not m:
        raise ParseError(f"No entiendo la hora «{text}». Usa 14:05 o 14:05:30.")
    h, mi, s = int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0)
    if h > 23 or mi > 59 or s > 59:
        raise ParseError(f"Hora inválida: {text}")
    return time(h, mi, s)


def seconds_of_day(t: time) -> int:
    return t.hour * 3600 + t.minute * 60 + t.second


def parse_channels(text: str, channel_count: int) -> list[int]:
    """Devuelve canales en base 0. El usuario escribe 1, 2, 1,3 o «todos»."""
    t = text.strip().lower().removeprefix("cam").removeprefix("ch")
    if t in ("todos", "todas", "all", "*"):
        return list(range(channel_count))
    chans = []
    for part in t.split(","):
        if not part.strip().isdigit():
            raise ParseError(f"No entiendo el canal «{text}». Usa 1, 2, 1,3 o todos.")
        n = int(part)
        if n < 1 or (channel_count and n > channel_count):
            raise ParseError(f"El canal {n} no existe (el equipo tiene {channel_count}).")
        chans.append(n - 1)
    return chans


def fmt_hms(sec: int) -> str:
    sec = max(0, int(sec))
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"
