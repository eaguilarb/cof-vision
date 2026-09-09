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
- **Estándar del bus (RED/TS)**: la flota real trae un campo `estandar`
  ("RED" = con wifi/cámaras, "TS" = sin wifi/cámaras). El CRM lo expone en
  `GET /equipment` (`estandar: 'RED' | 'TS'`) y la app excluye los buses
  "TS" del selector al crear un caso de categoría `wifi` o `camaras`
  (no tiene sentido reportar una falla de un equipo que el bus no tiene).

## Roles

- **admin**: control total — técnicos, usuarios, asignación de casos,
  todo lo que hace un operador.
- **operator**: puede ver todo (casos, equipos, reportes) y cambiar el
  estado de cualquier caso (incluido cerrarlo), pero no administra
  técnicos ni usuarios. Pensado para operar el día a día sin dar acceso
  de administrador. Se crean desde `POST /users` o la pestaña "Usuarios"
  de la app (solo visible para admins).
- **technician**: solo ve y cierra sus propios casos asignados (salvo que
  se filtre por otro). Se administran desde `/technicians`.

## Reportes y exportación

- `GET /reports/summary?days=30` — casos por estado, por terminal (total,
  % resuelto, promedio de días para resolver), por técnico (asignados,
  resueltos, % y promedio) y repuestos/piezas usadas al cerrar casos
  (`partsUsage`). `days` es opcional y limita a casos creados en esos
  últimos N días. Es lo que alimenta la pestaña "Reportes" de la app
  (gráficos de barras) y, a futuro, el módulo de reportes dentro de la
  intranet.
- `GET /reports/export?format=xlsx|pdf` — exporta el listado de casos
  (con los mismos filtros que `GET /cases`: `status`, `technicianId`,
  `mine`) a Excel o PDF, incluyendo los días abiertos/para resolver.

## Control de repuestos (qué se hizo al cerrar un caso)

Al marcar un caso como "resuelto" (`PATCH /cases/:id/status`), además de
`status: 'resolved'` hay que mandar `resolutionAction` (obligatorio) — un
valor de una lista fija según la categoría del caso (ej. para
`disco_duro`: `reemplazo_disco_duro`, `reparacion_disco_duro`, `otro`).
Rechaza el cambio con 400 si falta o no es válido. `resolutionNotes` es
opcional (detalle libre adicional). Las listas por categoría están en
`GET /config` (`resolutionActionsByCategoria`, y `genericResolutionActions`
para modo local/demo). Esto es lo que permite llevar el control de
repuestos usados (discos duros, DVR, etc. reemplazados) — ver
`GET /reports/summary` (`partsUsage`).

## Días abiertos / resueltos

Cada caso devuelto por la API trae `daysOpen` (días desde que se creó
hasta hoy, o hasta que se resolvió) y `resolvedInDays` (días que tomó
resolverlo, `null` si sigue abierto) — se calculan al vuelo en cada
respuesta, no se guardan.

## Notificaciones (correo y push)

- **Correo al resolver un caso**: cuando un caso pasa a estado "resuelto"
  (desde el CRM o, si está conectada la intranet, detectado por el sondeo
  periódico) se envía un correo con el detalle (notas) y las fotos
  adjuntas, vía [Resend](https://resend.com). Variables:
  ```
  RESEND_API_KEY=re_xxx                          # obligatoria para que se envíe
  NOTIFY_EMAIL_TO=eaguilarb@stpsantiago.cl        # opcional, es el valor por defecto
  NOTIFY_EMAIL_FROM=COF CRM <onboarding@resend.dev>  # opcional; para usar tu propio dominio, verifícalo en Resend
  ```
  Sin `RESEND_API_KEY` definida, el envío simplemente no ocurre (no da error).
- **Push al entrar un caso nuevo**: el `.apk` registra el token de push de
  Expo del teléfono (`POST /push-tokens`, requiere sesión) al iniciar
  sesión. Cuando aparece un caso nuevo — creado desde el CRM o detectado
  por el sondeo de la intranet — se manda una notificación push a todos
  los teléfonos registrados. No requiere configuración adicional (usa el
  servicio push de Expo).
- **Sondeo de la intranet**: con la intranet conectada, cada 5 minutos
  (`NOTIFY_POLL_INTERVAL_MS`, opcional) se revisan los casos reales para
  detectar cambios hechos fuera del CRM (directo en la intranet). La
  primera vez que corre no notifica nada de los casos ya existentes —
  solo lo que cambie después.

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
- `POST /push-tokens` — `{ token }` (token de push de Expo del dispositivo; ver sección de notificaciones)
- `GET /users` · `POST /users` · `DELETE /users/:id` (solo admin) — cuentas admin/operator (ver sección de Roles)
- `GET /reports/summary` · `GET /reports/export?format=xlsx|pdf` (ver sección de Reportes)

## Desplegar en Railway

1. Crea un servicio nuevo en tu proyecto de Railway apuntando a este
   repositorio (carpeta `crm/backend`).
2. **Agrega un volumen** montado en `/data` (Settings → Volumes) y define
   la variable `DATA_DIR=/data` — sin esto, las cuentas y asignaciones se
   pierden en cada redeploy.
3. Define las variables de entorno `INTRANET_EMAIL`, `INTRANET_PASSWORD`,
   `JWT_SECRET` (una clave propia para firmar los tokens del CRM), la
   cuenta de administrador real (`ADMIN_EMAIL`, `ADMIN_NAME`,
   `ADMIN_PASSWORD`) y, para las notificaciones, `RESEND_API_KEY` (ver
   sección de notificaciones más arriba).
4. Railway detecta `npm run build` / `npm start`. El `start` corre el
   script de siembra antes de levantar el servidor — crea las cuentas
   solo la primera vez (si ya existen datos en el volumen, no hace nada),
   así que no hace falta ejecutar nada a mano.
