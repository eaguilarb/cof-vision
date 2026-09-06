# COF CRM

CRM sencillo para la gestión de reparación de equipamiento tecnológico:
crear casos, asignarlos a técnicos y darles seguimiento (estado, notas,
historial), tanto desde la web como desde Android e iOS con un solo código.

Este proyecto vive junto al escáner OBD-II (`../src`) pero es independiente
de él — no comparten dependencias ni código.

## Componentes

- **`backend/`** — API REST (Express + TypeScript). Hoy persiste en un
  archivo JSON local a modo de "mock"; está pensada para conectarse después
  a la base de datos o API real de tu intranet. Ver `backend/README.md`.
- **`app/`** — App universal (Expo + React Native + Expo Router) que corre
  igual en navegador, Android e iOS. Ver `app/README.md`.

## Arranque rápido

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

## Qué incluye la versión actual

- Login con roles **admin** y **técnico**.
- Alta de equipos (activos a reparar) y de técnicos.
- Alta de casos: título, descripción, cliente/área, prioridad y equipo.
- Asignación de casos a técnicos (admin).
- Cambio de estado del caso (admin o el técnico asignado): abierto,
  asignado, en progreso, esperando repuestos, resuelto, cerrado.
- Notas por caso e historial de cambios de estado.
- Filtro "solo mis casos" para técnicos.

## Próximos pasos sugeridos

- Conectar `backend/` a la base de datos/API real de la intranet (ver la
  sección correspondiente en `backend/README.md`).
- Notificaciones push cuando se asigna un caso.
- Adjuntar fotos al caso (evidencia de la reparación).
- Reportes/exportables por técnico o por cliente.
