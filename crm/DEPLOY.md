# Desplegar el CRM en un servidor propio (costo cero)

Esto reemplaza a Railway + Vercel por un stack que corre en cualquier
máquina Linux de la empresa con [Docker](https://docs.docker.com/engine/install/)
instalado (gratis). No hay que pagarle a nadie por hosting — solo usas
hardware que la empresa ya tiene.

Todo el stack está en `docker-compose.yml`, `backend/Dockerfile` y
`web.Dockerfile`. Elige una de estas 3 opciones según qué tipo de
servidor termines usando — se puede empezar por la A y subir de opción
después sin rehacer nada.

## Opción A — Solo red interna de la empresa (la más simple, $0)

Si con que los técnicos/vidrieros y administradores accedan desde la
red de la oficina o terminal (o por VPN) es suficiente — no hace falta
que el CRM sea alcanzable desde internet:

```bash
cd crm
cp .env.example .env      # y completa las variables (ver el archivo)
EXPO_PUBLIC_API_URL=http://IP-DEL-SERVIDOR:4000 docker compose build web
docker compose up -d backend web
```

Los usuarios entran directo a `http://IP-DEL-SERVIDOR:8080` desde
cualquier equipo de la red. Sin dominio, sin certificado HTTPS, sin
configurar nada más. Para el APK, compílalo apuntando a esa misma IP
(solo funcionará conectado a la red de la empresa o por VPN).

**Limitación**: si la IP del servidor cambia (DHCP), hay que
reconstruir el `web` con la nueva IP. Para un servidor fijo esto no
pasa.

## Opción B — Con dominio propio e IP pública

Si la empresa tiene un dominio (o puede comprar uno — es lo único que
podría no ser gratis, normalmente unos USD 10-15 al año) y el servidor
tiene una IP pública fija:

1. Crea dos subdominios apuntando a la IP del servidor (registro DNS
   tipo A), ej. `app.tuempresa.cl` y `api.tuempresa.cl`. Puedes
   gestionar el DNS gratis con [Cloudflare](https://cloudflare.com) si
   el proveedor actual del dominio no te deja hacerlo fácil.
2. Edita `Caddyfile` con esos dos dominios reales.
3. Descomenta el servicio `caddy` en `docker-compose.yml`.
4. ```bash
   cd crm
   cp .env.example .env      # y completa las variables
   EXPO_PUBLIC_API_URL=https://api.tuempresa.cl docker compose build web
   docker compose up -d
   ```

Caddy obtiene el certificado HTTPS automáticamente la primera vez que
alguien entra (Let's Encrypt, gratis, se renueva solo). Los usuarios
entran a `https://app.tuempresa.cl`.

## Opción C — Servidor sin IP pública (detrás de firewall/NAT)

Típico de un servidor interno donde TI no puede o no quiere abrir
puertos. Solución: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(`cloudflared`) — gratis, no requiere IP pública ni abrir nada en el
firewall, la conexión sale desde el servidor hacia Cloudflare.

1. Levanta igual que la Opción A (`docker compose up -d backend web`),
   sin Caddy.
2. Crea una cuenta gratis en Cloudflare y sigue su guía para instalar
   `cloudflared` en el mismo servidor y crear un túnel.
3. En el túnel, define dos rutas (ingress): una hacia
   `http://localhost:8080` (la web) con el hostname que quieras
   (necesita un dominio agregado a tu cuenta de Cloudflare — si no
   tienes uno, `cloudflared tunnel --url http://localhost:8080` te da
   una URL temporal gratis en `*.trycloudflare.com`, útil para probar
   pero cambia cada vez que reinicias el túnel), y otra hacia
   `http://localhost:4000` (la API) con otro hostname.
4. Reconstruye `web` apuntando `EXPO_PUBLIC_API_URL` al hostname que le
   diste a la API en el túnel.

## Los datos

El volumen `crm-data` (definido en `docker-compose.yml`) guarda todo lo
que hoy vive en el Railway Volume de producción — cuentas, casos de
Vidrios, fotos. Para respaldarlo:

```bash
docker run --rm -v crm_crm-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/crm-data-backup.tar.gz -C /data .
```

Para conectar la intranet real de la empresa en vez de modo demo,
completa `INTRANET_EMAIL`/`INTRANET_PASSWORD` en `.env` — ver
`backend/README.md` para más detalle de qué hace cada variable.

## Migrar los datos actuales desde Railway

Si ya tienes casos/cuentas reales en el volumen de Railway
(`cof-crm-backend-volume`) y quieres traerlos a este servidor:

```bash
railway volume files download / ./railway-data-backup \
  --volume cof-crm-backend-volume --environment production
# copia el db.json y la carpeta uploads/ resultantes dentro del volumen
# "crm-data" de este servidor antes de iniciar el backend por primera vez
```
