#!/usr/bin/env bash
# Instalador del bot CMSV6 → Telegram para Ubuntu 24.04.
# Uso (como root, dentro de la carpeta cmsv6-bot):  bash install.sh
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
# Quita espacios y teclas especiales (flechas, etc.) que se cuelan al pegar
clean() { printf '%s' "$1" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '[:cntrl:][:space:]'; }
ask() { local v; read -rp "$1 (pega y presiona Enter): " v; clean "$v"; }
ask_secret() { local v; read -rsp "$1 (no se verá al escribir; presiona Enter): " v; echo >&2; clean "$v"; }
set_env() { # set_env CLAVE valor
  local k="$1" v="$2"
  if grep -q "^$k=" .env; then
    local esc; esc=$(printf '%s' "$v" | sed -e 's/[\/&|]/\\&/g')
    sed -i "s|^$k=.*|$k=$esc|" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root: sudo bash install.sh"; exit 1; }

say "1/5 Instalando Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

say "2/5 Configurando .env"
[ -f .env ] || cp .env.example .env
grep -q '^TELEGRAM_BOT_TOKEN=.\+' .env || set_env TELEGRAM_BOT_TOKEN "$(ask 'Token del bot (de @BotFather)')"
grep -q '^TELEGRAM_API_ID=.\+' .env   || set_env TELEGRAM_API_ID "$(ask 'api_id (de my.telegram.org)')"
grep -q '^TELEGRAM_API_HASH=.\+' .env || set_env TELEGRAM_API_HASH "$(ask 'api_hash (de my.telegram.org)')"
grep -q '^CMSV6_USER=.\+' .env        || set_env CMSV6_USER "$(ask 'Usuario de CMSV6')"
grep -q '^CMSV6_PASSWORD=.\+' .env    || set_env CMSV6_PASSWORD "$(ask_secret 'Contraseña de CMSV6')"
grep -q '^LINK_SECRET=.\+' .env       || set_env LINK_SECRET "$(openssl rand -hex 32)"
if ! grep -q '^PUBLIC_URL=.\+' .env; then
  ip=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  port=$(grep '^HTTP_PORT=' .env | cut -d= -f2); port=${port:-8088}
  set_env PUBLIC_URL "http://$ip:$port"
fi
chmod 600 .env
mkdir -p data && chmod 755 data

say "3/5 Abriendo puertos en el firewall (SSH y descargas)"
port=$(grep '^HTTP_PORT=' .env | cut -d= -f2); port=${port:-8088}
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow "$port"/tcp >/dev/null
  ufw --force enable >/dev/null
fi
echo "Recuerda abrir también el puerto $port/TCP en el panel de tu proveedor del VPS si tiene firewall propio."

say "4/5 Construyendo y probando la conexión con CMSV6"
docker compose build
docker compose run --rm --no-deps bot python -m app.diagnostico || {
  echo; echo "El diagnóstico falló. Revisa el mensaje de arriba, corrige .env y vuelve a ejecutar install.sh."
  exit 1
}

say "5/5 Iniciando el bot"
docker compose up -d
echo
echo "Listo. Abre tu bot en Telegram y envía /miid."
echo "Luego agrega tu ID en ALLOWED_USERS dentro de $(pwd)/.env y ejecuta: docker compose up -d"
