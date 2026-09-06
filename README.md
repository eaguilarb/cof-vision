# COF Vision — Escáner automotriz profesional OBD-II

Aplicación web (React + TypeScript + Vite) para diagnóstico automotriz OBD-II
mediante adaptadores ELM327, sin necesidad de instalar nada: corre directamente
en Chrome o Edge y se conecta al adaptador por **Bluetooth (Web Bluetooth)** o
por **puerto serie (Web Serial)**.

## Funciones

- **Lectura de códigos de falla (DTC)**: almacenados, pendientes y permanentes,
  con descripción de cada código.
- **Borrado de códigos** y apagado de la luz de "Check Engine".
- **Datos en vivo** con gauges tipo tablero y gráfica en tiempo real, para
  ~25 parámetros estándar SAE J1979 (RPM, velocidad, temperaturas, presión,
  MAF, avance de encendido, voltaje de batería, ajustes de combustible, etc.).
- **Freeze frame**: los valores del motor capturados en el instante exacto en
  que se registró una falla.
- **Información del vehículo**: VIN, año modelo y fabricante aproximado
  (decodificados del VIN), protocolo OBD-II detectado y voltaje de batería.
- **Reportes exportables** en PDF y CSV, listos para entregar al cliente.

## Compatibilidad del adaptador

Funciona con cualquier adaptador **ELM327** (v1.5 o superior) que soporte
todos los protocolos OBD-II — el tipo más común del mercado.

- **Puerto serie (recomendado para la mayoría de los adaptadores)**: para
  adaptadores Bluetooth *clásico* (SPP) — como los "ELM327 Interface v1.5" más
  comunes — empareja el adaptador en los ajustes de Bluetooth de tu sistema
  operativo primero (esto crea un puerto COM/rfcomm), y luego conéctate desde
  la pestaña "Conexión" eligiendo ese puerto. También sirve para adaptadores
  con cable USB-serie.
- **Bluetooth (BLE)**: para adaptadores ELM327 Bluetooth *Low Energy* más
  recientes (ej. Vgate iCar Pro BLE, OBDLink CX). Web Bluetooth no puede
  hablar con Bluetooth clásico/SPP, por eso esos adaptadores usan la opción de
  puerto serie en su lugar.

Requiere Chrome o Edge (de escritorio o Android) — son los únicos navegadores
con soporte para Web Bluetooth y Web Serial.

## Desarrollo

```bash
npm install
npm run dev       # servidor de desarrollo
npm run build     # build de producción (tsc + vite build)
npm run lint      # oxlint
```

## Estructura del código

```
src/
  lib/obd/
    transport.ts       # transporte Bluetooth (BLE) y Serial
    elm327.ts           # motor de protocolo ELM327 (cola de comandos AT/OBD)
    pids.ts              # tabla de PIDs Modo 01 y fórmulas de decodificación
    dtc.ts               # lectura/borrado de códigos de falla (Modo 03/04/07/0A)
    dtcDescriptions.ts   # diccionario de descripciones de DTC
    freezeFrame.ts        # lectura de freeze frame (Modo 02)
    vehicleInfo.ts         # VIN y datos del vehículo (Modo 09)
  state/obdContext.tsx    # estado global de la conexión y los datos
  components/              # UI (conexión, tablero, DTC, freeze frame, reporte)
```

## Aviso

Esta herramienta es para diagnóstico OBD-II genérico. No reemplaza el escáner
de concesionario para procedimientos de programación de módulos ni para
códigos específicos de fabricante que requieran bases de datos propietarias.
