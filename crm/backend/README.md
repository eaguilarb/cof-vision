# COF CRM — Backend

API REST del CRM de reparación de equipamiento tecnológico. Hoy es un
backend "mock" con persistencia en un archivo JSON (`data/db.json`),
pensado para poder reemplazarse por la intranet real sin tocar la app:
basta con exponer los mismos endpoints (o adaptar `src/routes/*` para
llamar al sistema real) y apuntar la app a esa URL.

## Desarrollo

```bash
npm install
npm run seed   # crea datos de ejemplo (usuarios, técnicos, equipos, casos)
npm run dev    # levanta la API en http://localhost:4000
```

## Cuentas de ejemplo (creadas por `npm run seed`)

| Rol       | Email               | Contraseña |
|-----------|---------------------|------------|
| Admin     | admin@cof.local      | admin123   |
| Técnico   | carlos@cof.local     | tecnico123 |
| Técnico   | ana@cof.local        | tecnico123 |

## Modelo de datos

- **Technician**: técnico que puede tener casos asignados.
- **Equipment**: equipo del cliente/área que se está reparando.
- **Case**: caso/ticket de reparación — título, descripción, equipo, cliente,
  prioridad, estado, técnico asignado, notas e historial de cambios de estado.

## Endpoints principales

Todos (salvo `/auth/login`) requieren `Authorization: Bearer <token>`.

- `POST /auth/login` — `{ email, password }` → `{ token, user }`
- `GET /technicians` · `POST /technicians` (solo admin) · `PATCH /technicians/:id` (solo admin)
- `GET /equipment` · `POST /equipment`
- `GET /cases?status=&mine=true` · `GET /cases/:id` · `POST /cases`
- `PATCH /cases/:id/assign` (solo admin) — `{ technicianId }`
- `PATCH /cases/:id/status` (admin o el técnico asignado) — `{ status }`
- `POST /cases/:id/notes` — `{ text }`

## Conectar con la intranet real

Este backend es intencionalmente simple para poder arrancar ya. Cuando se
quiera conectar a la base de datos o API real de la intranet, hay dos
caminos:

1. **Reemplazar el almacenamiento**: cambiar `src/db.ts` (que hoy lee/escribe
   `data/db.json`) por llamadas a la base de datos o API real, manteniendo
   las mismas funciones `loadDb`/`saveDb` y formas de datos en `src/types.ts`.
   Las rutas (`src/routes/*`) no necesitan cambiar.
2. **Apuntar la app directamente a la API real**: si la intranet ya expone
   una API REST equivalente, se puede saltar este backend por completo y
   configurar `EXPO_PUBLIC_API_URL` en la app para que apunte allá
   (ver `../app/README.md`).
