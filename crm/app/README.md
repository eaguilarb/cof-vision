# COF CRM — App (Expo / React Native)

App móvil y web (un solo código) para asignar y dar seguimiento a casos de
reparación de equipamiento tecnológico. Corre con [Expo](https://expo.dev) +
[Expo Router](https://docs.expo.dev/router/introduction/).

## Requisitos

- Node.js 20+
- El backend corriendo (ver `../backend/README.md`), o cualquier API que
  implemente el mismo contrato.

## Desarrollo

```bash
npm install
npm run web       # abre en el navegador
npm run android   # abre en un emulador/dispositivo Android (requiere Android Studio o Expo Go)
npm run ios       # abre en simulador iOS (requiere macOS) o Expo Go
```

Por defecto la app apunta a `http://localhost:4000` (el backend local). Para
apuntar a otra URL (otra máquina en la red, o la futura API de la intranet),
crea un archivo `.env` en esta carpeta:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:4000
```

- **Emulador Android**: `localhost` del emulador no es el de tu máquina; usa
  `http://10.0.2.2:4000` o la IP de tu red local.
- **Dispositivo físico (Expo Go)**: usa la IP de tu computadora en la red
  local, ej. `http://192.168.1.50:4000`.
- **Producción**: apunta a la URL pública del backend desplegado (ej. en
  Railway, junto a la intranet).

La app se adapta sola según lo que responda `GET /config` del backend: si
el backend está conectado a la intranet real (ver `../backend/README.md`),
"Nuevo caso" pide categoría de falla y patente del bus en vez de
título/cliente libres, y la pestaña "Equipos" muestra la flota real con
buscador en vez del alta manual.

## Estructura

```
src/
  app/                 # rutas (Expo Router, basado en archivos)
    login.tsx
    (tabs)/            # Casos, Equipos, Técnicos (solo admin), Perfil
    case/[id].tsx       # detalle de caso: estado, asignación, notas
    case/new.tsx        # alta de caso
  api/
    client.ts           # instancia axios + URL base configurable
    hooks.ts             # hooks de datos (React Query)
    types.ts              # tipos compartidos con el backend
  state/auth-context.tsx  # sesión (token + usuario), persistida en el dispositivo
  components/               # piezas de UI reutilizables
```

## Cuentas de prueba

Ver `../backend/README.md` para las credenciales sembradas por `npm run seed`.
