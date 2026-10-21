"""Envío por correo de los enlaces de descarga (SMTP)."""

import asyncio
import json
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage

from .config import config

log = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}")


def enabled() -> bool:
    return bool(config.smtp_host and config.smtp_user and config.smtp_password)


def _book_path():
    return config.data_dir / "correos.json"


def _book() -> dict[str, str]:
    try:
        return json.loads(_book_path().read_text())
    except Exception:
        return {}


def get(user_id: int) -> str | None:
    return _book().get(str(user_id))


def set_(user_id: int, email: str | None) -> None:
    book = _book()
    if email:
        book[str(user_id)] = email
    else:
        book.pop(str(user_id), None)
    _book_path().write_text(json.dumps(book, indent=1))
    _book_path().chmod(0o600)


def _send_sync(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = config.smtp_from or config.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if config.smtp_port == 465:
        with smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, context=ctx, timeout=30) as s:
            s.login(config.smtp_user, config.smtp_password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=30) as s:
            s.starttls(context=ctx)
            s.login(config.smtp_user, config.smtp_password)
            s.send_message(msg)


async def send(to: str, subject: str, body: str) -> None:
    await asyncio.to_thread(_send_sync, to, subject, body)
    log.info("Correo enviado a %s: %s", to, subject)
