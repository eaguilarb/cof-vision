# COF CRM — Backend

API REST del CRM de reparación de equipamiento tecnológico. Puede correr en
dos modos:

- **Conectado a la intranet real de COF** (recomendado, es el modo de
  producción): los casos y el equipamiento (flota de buses) se leen y
  escriben en vivo desde `https://intranet-cof-production.up.railway.app`.
  Se activa automáticamente si defines `INTRANET_EMAIL` e
  `INTRANET_PASSWORD`.
- **Modo local/demo**: sin esas variables, usa un archivo JSON local
  (`data/db.json`) con datos de ejemplo. Útil para desarrollar sin tocar
  datos reales.

## Desarrollo

```bash
npm install
npm run seed   # crea cuentas/datos de ejemplo para el CRM (ver abajo)
npm run dev    # levanta la API en http://localhost:4000
```

`npm run seed` solo crea las cuentas y datos **propios del CRM** (usuarios
admin/técnico, y en modo local también casos/equipos de ejemplo). Nunca
toca la intranet real.

## Conectar la intranet real

Define estas variables de entorno (en `.env` local, o en las variables de
la app en Railway):

```
INTRANET_BASE_URL=https://intranet-cof-production.up.railway.app   # opcional, es el valor por defecto
INTRANET_EMAIL=una-cuenta-con-acceso@stpsantiago.cl
INTRANET_PASSWORD=su-contraseña
```

El backend inicia sesión con esa cuenta (como lo haría cualquier persona
en el sitio) y usa esa sesión para leer y escribir. **Nunca pongas estas
credenciales directamente en el código o en un archivo que se suba a
git** — solo como variables de entorno del servicio.

Con la intranet conectada:

- `GET /equipment` devuelve la flota real (`/api/flota`): cada bus es un
  "equipo", identificado por su patente.
- `GET /cases` devuelve los casos reales del módulo de reparaciones
  técnicas (`/api/problemas-tecnicos`): discos duros, DVR, cámaras, GPS,
  WiFi, consola de validación, validador.
- Cambiar el estado de un caso desde el CRM (`PATCH /cases/:id/status`)
  actualiza el estado real en la intranet (mismo endpoint que usa su
  propia interfaz).
- Crear un caso desde el CRM (`POST /cases`) lo crea también en la
  intranet.
- **Técnico asignado, prioridad y notas** son conceptos que la intranet no
  tiene todavía — el CRM los guarda de forma local, superpuestos sobre el
  caso real (ver `CaseOverlay` en `src/types.ts` y `src/routes/cases.ts`).
  Si en el futuro la intranet agrega esos campos, esta es la parte a
  actualizar.

## Cuentas de ejemplo (creadas por `npm run seed`)

Estas son cuentas del CRM (para entrar a la app), no de la intranet:

| Rol       | Email               | Contraseña |
|-----------|---------------------|------------|
| Admin     | admin@cof.local      | admin123   |
| Técnico   | carlos@cof.local     | tecnico123 |
| Técnico   | ana@cof.local        | tecnico123 |

## Modelo de datos

- **Technician**: técnico del CRM que puede tener casos asignados.
- **Equipment**: en modo intranet, un bus de la flota (patente, marca,
  modelo, terminal). En modo local, un equipo cualquiera.
- **Case**: caso de reparación — descripción, equipo, categoría/cliente,
  prioridad, estado (`open` = pendiente, `assigned` = asignado,
  `in_progress` = en proceso, `resolved` = resuelto), técnico asignado,
  notas e historial.

## Endpoints principales

Todos (salvo `/auth/login`) requieren `Authorization: Bearer <token>`.

- `POST /auth/login` — `{ email, password }` → `{ token, user }`
- `GET /config` — `{ intranetEnabled, categorias }` (para que el frontend sepa qué modo mostrar)
- `GET /technicians` · `POST /technicians` (solo admin) · `PATCH /technicians/:id` (solo admin)
- `GET /equipment` · `POST /equipment` (solo en modo local; en modo intranet la flota se administra desde ahí)
- `GET /cases?status=&mine=true` · `GET /cases/:id` · `POST /cases`
- `PATCH /cases/:id/assign` (solo admin) — `{ technicianId }` (local al CRM)
- `PATCH /cases/:id/status` (admin o el técnico asignado) — `{ status }` (se refleja en la intranet si está conectada)
- `PATCH /cases/:id/priority` — `{ priority }` (local al CRM)
- `POST /cases/:id/notes` — `{ text }` (local al CRM)

## Desplegar en Railway

1. Crea un servicio nuevo en tu proyecto de Railway apuntando a este
   repositorio (carpeta `crm/backend`).
2. **Agrega un volumen** montado en `/data` (Settings → Volumes) y define
   la variable `DATA_DIR=/data` — sin esto, las cuentas y asignaciones se
   pierden en cada redeploy.
3. Define las variables de entorno `INTRANET_EMAIL`, `INTRANET_PASSWORD`,
   `JWT_SECRET` (una clave propia para firmar los tokens del CRM) y la
   cuenta de administrador real: `ADMIN_EMAIL`, `ADMIN_NAME`,
   `ADMIN_PASSWORD`.
4. Railway detecta `npm run build` / `npm start`. El `start` corre el
   script de siembra antes de levantar el servidor — crea las cuentas
   solo la primera vez (si ya existen datos en el volumen, no hace nada),
   así que no hace falta ejecutar nada a mano.
