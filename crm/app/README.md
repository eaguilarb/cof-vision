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

## Generar el instalable de Android (.apk)

La app está conectada a un proyecto de [EAS Build](https://docs.expo.dev/build/introduction/)
(`@eaguilarb/cof-crm`, ver `eas.json`), que compila un `.apk` real en la nube
de Expo — no requiere Android Studio ni una PC con Android SDK.

```bash
npm install -g eas-cli   # o usa npx eas-cli
eas login                # con tu cuenta de expo.dev
eas build --platform android --profile apk
```

Al terminar (10–20 min), el comando muestra un link de descarga directa del
`.apk`. Cualquiera con ese link puede descargarlo e instalarlo en un
Android (puede que el teléfono pida habilitar "instalar apps de origen
desconocido" la primera vez — es normal al no venir de Play Store).

Vuelve a correr `eas build` cada vez que quieras una versión nueva
instalable con los últimos cambios del código.

### Configurar a qué backend apunta el `.apk`

El `.apk` no necesita saber la URL final del backend al momento de
compilar: cualquiera puede cambiarla después, dentro de la app, en
**Perfil → Cambiar servidor** (se guarda en el teléfono; ver
`src/api/client.ts`). Así, cuando despliegues el backend en Railway, no
hace falta generar un `.apk` nuevo — solo actualizar esa URL desde la
app.
