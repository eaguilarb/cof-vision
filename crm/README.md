# COF CRM

CRM para la gestión de reparación de equipamiento tecnológico de la flota
(discos duros, DVR, cámaras, GPS, WiFi, etc.): asignar casos a técnicos y
darles seguimiento, tanto desde la web como desde Android e iOS con un
solo código.

Este proyecto vive junto al escáner OBD-II (`../src`) pero es independiente
de él — no comparten dependencias ni código.

## Componentes

- **`backend/`** — API REST (Express + TypeScript). Se conecta en vivo a la
  intranet real de COF (casos y flota) cuando defines las variables de
  entorno correspondientes; sin ellas corre en modo local/demo. Ver
  `backend/README.md`.
- **`app/`** — App universal (Expo + React Native + Expo Router) que corre
  igual en navegador, Android e iOS. Ver `app/README.md`.

## Arranque rápido (modo local/demo, sin tocar la intranet real)

```bash
# Terminal 1: backend
cd crm/backend
npm install
npm run seed
npm run dev

# Terminal 2: app (web)
cd crm/app
npm install
npm run web
```

Abre `http://localhost:8081` (o el puerto que indique Expo) e inicia sesión
con `admin@cof.local` / `admin123` (ver más cuentas en `backend/README.md`).

## Conectado a la intranet real

Definiendo `INTRANET_EMAIL` e `INTRANET_PASSWORD` al levantar el backend
(ver `backend/README.md`), el CRM deja de usar datos de ejemplo y pasa a
leer y escribir directo en `https://intranet-cof-production.up.railway.app`:

- **Casos** = módulo de reparaciones técnicas de la intranet (239 casos
  reales al momento de conectar: discos duros y WiFi, con categorías para
  cámaras, DVR, GPS, consola de validación y validador).
- **Equipos** = flota real de buses (868 unidades).
- Cambiar el estado de un caso o crear uno nuevo desde el CRM se refleja
  en la intranet. Técnico asignado, prioridad y notas son propios del CRM
  (la intranet no tiene esos campos todavía).

## Qué incluye la versión actual

- Login con roles **admin** y **técnico**.
- En modo intranet: categorías reales de falla, buscador de buses por
  patente (la flota tiene cientos de unidades).
- En modo local/demo: alta libre de equipos y casos.
- Asignación de casos a técnicos (admin).
- Cambio de estado del caso (admin o el técnico asignado): pendiente,
  asignado, en proceso, resuelto.
- Prioridad editable por caso, notas y historial de cambios de estado.
- Filtro "solo mis casos" para técnicos.

## Próximos pasos sugeridos

- Desplegar `backend/` en Railway (junto a la intranet) — ver la sección
  correspondiente en `backend/README.md`.
- Si la intranet agrega campos de técnico asignado, mover esa parte desde
  el overlay local del CRM a la intranet.
- Notificaciones push cuando se asigna un caso.
- Adjuntar fotos al caso (evidencia de la reparación).
- Reportes/exportables por técnico o por terminal.
