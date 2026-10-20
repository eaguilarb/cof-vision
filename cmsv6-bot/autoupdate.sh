#!/usr/bin/env bash
# Actualización automática del bot: si hay cambios nuevos en GitHub, los baja y reinicia.
#   sudo bash autoupdate.sh            → revisa y actualiza ahora
#   sudo bash autoupdate.sh --instalar → deja la revisión programada cada 10 minutos
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
DIR=$(pwd)
OWNER=$(stat -c %U "$DIR/..")   # dueño del repositorio (ej. ubuntu)
LOG=/var/log/cmsv6-bot-update.log

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root: sudo bash autoupdate.sh"; exit 1; }

if [ "${1:-}" = "--instalar" ]; then
  cat > /etc/cron.d/cmsv6-bot-update <<CRON
# Revisa cada 10 minutos si hay una versión nueva del bot
*/10 * * * * root flock -n /run/cmsv6-bot-update.lock bash $DIR/autoupdate.sh >> $LOG 2>&1
CRON
  chmod 644 /etc/cron.d/cmsv6-bot-update
  echo "Actualización automática activada (cada 10 minutos). Registro: $LOG"
  exit 0
fi

# git se ejecuta como el dueño del repo para no dejar archivos de root
g() { sudo -u "$OWNER" git -C "$DIR/.." "$@"; }
g fetch -q origin
if [ "$(g rev-parse HEAD)" = "$(g rev-parse '@{u}')" ]; then
  exit 0
fi
g merge -q --ff-only '@{u}'
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "$(date '+%F %T') actualizado a $(g log -1 --format='%h %s')"
