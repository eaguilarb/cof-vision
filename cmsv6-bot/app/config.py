"""Configuración leída de variables de entorno (archivo .env)."""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass(frozen=True)
class Config:
    telegram_token: str = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    # URL del servidor local de Telegram Bot API (vacío = usar la nube de Telegram, límite 50 MB)
    bot_api_url: str = os.environ.get("BOT_API_URL", "").rstrip("/")
    allowed_users: list[int] = field(
        default_factory=lambda: [int(x) for x in _list("ALLOWED_USERS")]
    )

    cmsv6_url: str = os.environ.get("CMSV6_URL", "http://47.88.25.163:8088").rstrip("/")
    cmsv6_user: str = os.environ.get("CMSV6_USER", "")
    cmsv6_password: str = os.environ.get("CMSV6_PASSWORD", "")
    # Dónde buscar grabaciones, en orden: 2 = servidor de almacenamiento, 1 = equipo (MDVR), 4 = servidor de descarga
    search_locations: list[int] = field(
        default_factory=lambda: [int(x) for x in _list("CMSV6_LOCATIONS") or ["2", "1"]]
    )

    # Servidor de video en vivo de CMSV7 (vacío = se detecta solo a partir de las grabaciones)
    cmsv6_media_url: str = os.environ.get("CMSV6_MEDIA_URL", "").rstrip("/")
    live_seconds: int = int(os.environ.get("LIVE_SECONDS", "15"))
    live_link_minutes: int = int(os.environ.get("LIVE_LINK_MINUTES", "120"))

    data_dir: Path = Path(os.environ.get("DATA_DIR", "/data"))
    public_url: str = os.environ.get("PUBLIC_URL", "").rstrip("/")
    link_secret: str = os.environ.get("LINK_SECRET", "")
    link_hours: int = int(os.environ.get("LINK_HOURS", "48"))
    http_port: int = int(os.environ.get("HTTP_PORT", "8088"))

    # Compresión: CRF más alto = archivo más liviano (23 alta calidad, 28 equilibrado, 32 muy liviano)
    video_crf: int = int(os.environ.get("VIDEO_CRF", "28"))
    video_max_height: int = int(os.environ.get("VIDEO_MAX_HEIGHT", "720"))
    # «ultrafast» comprime varias veces más rápido (el archivo pesa algo más). El valor antiguo
    # por defecto («veryfast», que quedó en los .env viejos) se toma también como ultrafast.
    video_preset: str = (lambda p: "ultrafast" if p == "veryfast" else p)(
        os.environ.get("VIDEO_PRESET", "ultrafast"))
    # Si el AVI del FTP ya viene en H.264, se entrega sin recomprimir (instantáneo)
    ftp_remux: bool = os.environ.get("FTP_REMUX", "1") != "0"
    # Hasta 1 hora por video (con el FTP baja rápido). El valor antiguo (30, que quedó en
    # los .env viejos) se toma también como 60.
    max_clip_minutes: int = (lambda m: 60 if m == 30 else m)(
        int(os.environ.get("MAX_CLIP_MINUTES", "60")))
    max_parallel_jobs: int = int(os.environ.get("MAX_PARALLEL_JOBS", "3"))
    # Grabaciones en el bus: «auto» pide solo los minutos necesarios (descarga por tramos) cuando
    # son menos de la mitad del archivo; «siempre» / «nunca» fuerzan un método
    segment_mode: str = os.environ.get("SEGMENT_MODE", "auto").lower()
    # Si la descarga por tramos no avanza en este tiempo, se usa la descarga directa
    segment_stall_s: int = int(os.environ.get("SEGMENT_STALL_SECONDS", "120"))
    # Cuántos tramos se piden a la vez a un mismo bus: el equipo los envía de a uno por su
    # 4G; pedir muchos juntos no acelera y hace que fallen
    bus_parallel: int = int(os.environ.get("BUS_PARALLEL", "2"))
    # Método de descarga de grabaciones del bus: auto (elige el más rápido medido),
    # ftp (el bus sube el horario al FTP de CMSV7, como en el aplicativo),
    # reproduccion (el bus transmite el tramo), tramos (el bus sube el tramo) o directa
    download_method: str = os.environ.get("DOWNLOAD_METHOD", "ftp").lower()
    # Transmisiones de reproducción a la vez por bus (una por cámara)
    bus_streams: int = int(os.environ.get("BUS_STREAMS", "4"))
    # Subidas FTP a la vez por bus (el aplicativo permite hasta 3). Las órdenes se envían
    # separadas por unos segundos: dos órdenes en el mismo instante el bus no las contesta
    ftp_parallel: int = int(os.environ.get("FTP_PARALLEL", "3"))
    ftp_order_gap: float = float(os.environ.get("FTP_ORDER_GAP", "2"))

    @property
    def telegram_max_mb(self) -> int:
        # Servidor local: 2000 MB; nube de Telegram: 50 MB
        return 1900 if self.bot_api_url else 49


config = Config()
