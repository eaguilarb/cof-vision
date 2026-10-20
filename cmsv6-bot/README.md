# Bot CMSV6 / CMSV7 → Telegram

Bot de Telegram que se conecta al servidor CMSV6 (`47.88.25.163`) y responde
con **videos comprimidos** o **fotos** de las grabaciones de los vehículos.
Corre en el VPS (Ubuntu 24.04) con Docker.

```
 Tú (Telegram) ──► Bot en el VPS ──► API web de CMSV6 (47.88.25.163:8088)
                       │                 └─ descarga la grabación (puerto 6611)
                       ├─ recorta y comprime con ffmpeg
                       ├─ te envía el video por Telegram (hasta 2 GB)
                       └─ y además un enlace de descarga temporal (48 h)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `/enlinea` o `/enlinea SPB` | Buses encendidos ahora (todos o filtrados por placa) |
| `/vehiculos SVD` | Busca vehículos por parte de la placa, con cámaras y estado en línea |
| `/grabaciones ABC123 ayer` | Muestra las horas grabadas por cámara |
| `/video ABC123 1 hoy 14:00 14:10` | Clip de la cámara 1, comprimido |
| `/video ABC123 todos 19/10 08:30 08:35` | Un clip por cada cámara (separadas) |
| `/video ABC123 todos 19/10 08:30 08:35 juntas` | Todas las cámaras en un solo video (mosaico) |
| `/video ABC123 1,3 hoy 08:30 08:35 juntas` | Cámaras 1 y 3 lado a lado |
| `/foto ABC123 2 hoy 14:05:30` | Imagen de ese instante |
| `/foto ABC123 todos hoy 14:05:30 juntas` | Una imagen con todas las cámaras |
| `/miid` | Tu ID de Telegram (para autorizarte) |

Solo las personas cuyo ID está en `ALLOWED_USERS` pueden pedir videos.

## De dónde saca los videos

1. **Servidor de almacenamiento** (si la grabación ya se subió): descarga directa, rápido.
2. **Vehículo (MDVR/dashcam)**: si el equipo permite descarga directa, baja el archivo;
   si no (equipos JT/T 1078 o archivos multicanal), le pide a CMSV7 una
   **descarga por tramos**: el vehículo sube por 4G solo los minutos pedidos y
   el bot los recoge. Para esto el vehículo debe estar **encendido y con señal**,
   y puede tardar varios minutos (el bot muestra el avance).

## Compresión

Las grabaciones se recortan exactamente al horario pedido y se recomprimen en
H.264 (MP4), a 720p como máximo. Un video de 10 minutos de MDVR suele bajar a
una fracción de su tamaño original. Se ajusta en `.env`:

- `VIDEO_CRF=28` → equilibrado. Usa `32` si quieres archivos más livianos, o `23` si quieres más calidad.
- `VIDEO_MAX_HEIGHT=720` → `480` reduce bastante más el peso.

## Instalación paso a paso

### Paso 1 — Crear el bot en Telegram (2 minutos)

1. En Telegram busca **@BotFather** y envíale `/newbot`.
2. Escribe un nombre (ej. `COF Grabaciones`) y un usuario que termine en `bot`
   (ej. `cof_grabaciones_bot`).
3. BotFather te responde con un **token** del tipo `7123456789:AAH...`. Guárdalo.

### Paso 2 — Obtener `api_id` y `api_hash` (para enviar videos de hasta 2 GB)

Sin esto, Telegram solo deja enviar videos de hasta 50 MB. Con esto, el VPS
corre su propio servidor de Telegram y el límite sube a 2 GB.

1. Entra a <https://my.telegram.org> con tu número de teléfono (te llega un código por Telegram).
2. Haz clic en **API development tools**.
3. Llena el formulario (App title: `COF Bot`, Short name: `cofbot`, Platform: `Other`).
4. Copia el **App api_id** (un número) y el **App api_hash** (texto largo).

### Paso 3 — Verificar el acceso a CMSV6

No hace falta el proveedor: CMSV6 y CMSV7 traen una API web oficial incluida
(documentación de CMSV7: <https://help.cmsv7.com>), la misma
que usa su versión web, y se entra con **el mismo usuario y contraseña del
programa CMSV6**. Pruébala desde el navegador de tu PC o del iMac:

1. Página de inicio de sesión: `http://47.88.25.163:8088`
2. Documentación de la API (viene dentro de tu propio servidor):
   `http://47.88.25.163:8088/808gps/open/webApi.html`
3. Prueba de inicio de sesión (cambia USUARIO y CLAVE):
   `http://47.88.25.163:8088/StandardApiAction_login.action?account=USUARIO&password=CLAVE`

   Si responde algo como `{"result":0,"jsession":"..."}`, la API funciona con
   tu cuenta y el bot podrá conectarse.

Si el puerto 8088 no carga, mira en el programa CMSV6 la pantalla de inicio de
sesión (botón de configuración del servidor), que muestra la IP y los puertos
que usa. Pásame esa captura.

### Paso 4 — Entrar al VPS por SSH

- **Windows**: abre *PowerShell* y escribe `ssh root@IP_DEL_VPS`.
- **Mac (iMac)**: abre *Terminal* y escribe `ssh root@IP_DEL_VPS`.

Usa la IP y la contraseña de root que te dio el proveedor del VPS (al escribir
la contraseña no se ven los caracteres; es normal). La primera vez te pregunta
`Are you sure you want to continue connecting?`: responde `yes`.

### Paso 5 — Descargar e instalar

Ya dentro del VPS, pega estos comandos:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/eaguilarb/cof-vision.git
cd cof-vision/cmsv6-bot
bash install.sh
```

Si el repositorio es privado, `git clone` te pedirá un usuario y contraseña.
Usa tu usuario de GitHub y, como contraseña, un *token*: créalo en GitHub →
Settings → Developer settings → Personal access tokens con permiso de lectura
del repositorio.

El instalador:
1. instala Docker;
2. te pide el token del bot, el `api_id`, el `api_hash`, y el usuario y la contraseña de CMSV6;
3. abre el puerto 8088 en el firewall, que se usa para los enlaces de descarga;
4. **prueba la conexión con CMSV6**: inicia sesión, lista los vehículos, busca grabaciones de hoy,
   descarga una y la comprime;
5. inicia el bot.

> Si tu VPS tiene un firewall en el panel del proveedor (Alibaba Cloud,
> AWS, etc.), abre ahí también el puerto **8088/TCP** de entrada.

### Paso 6 — Autorizarte

1. Abre tu bot en Telegram y envía `/miid`. Te responde con un número.
2. En el VPS, dentro de la carpeta `cmsv6-bot`:
   ```bash
   nano .env      # pon tu número en ALLOWED_USERS=123456789 (varios separados por coma)
   docker compose up -d
   ```
3. Envía `/vehiculos` y luego prueba con `/video PLACA 1 hoy 10:00 10:05`.

## Mantenimiento

```bash
cd ~/cof-vision/cmsv6-bot
docker compose logs -f bot          # ver qué está haciendo el bot
docker compose restart bot          # reiniciar
git pull && docker compose up -d --build   # actualizar a la última versión
docker compose run --rm --no-deps bot python -m app.diagnostico ABC123 19/10/2026
```

Los videos generados y los enlaces se borran solos después de `LINK_HOURS` (48 h).

## Problemas frecuentes

| Mensaje | Causa probable |
|---|---|
| `No se pudo contactar a CMSV6` | El puerto 8088 no está abierto hacia el VPS, o la IP cambió |
| `inicio de sesión único` (código 34) | El usuario ya está conectado en el aplicativo o el navegador. Usa un usuario exclusivo para el bot |
| `Login rechazado` | Usuario o contraseña de CMSV6 incorrectos en `.env` |
| `No hay grabaciones en ese horario` | No hay grabación de esa cámara en ese horario. Revisa con `/grabaciones` |
| `Falló la descarga` | El puerto 6611 está cerrado; o, si la grabación está en el equipo del vehículo, el vehículo está apagado o sin señal |
| `ffmpeg falló` | El formato del archivo no es estándar. Envía la salida de `diagnostico` |
