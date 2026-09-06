// Tabla de PIDs estándar del Modo 01 (datos en vivo), según SAE J1979.
// Cada fórmula sigue la especificación estándar (A, B, C, D = bytes de datos).

export interface PidReading {
  pid: number
  name: string
  shortName: string
  unit: string
  value: number
  min: number
  max: number
}

export interface PidDefinition {
  pid: number
  name: string
  shortName: string
  unit: string
  minBytes: number
  min: number
  max: number
  decode: (b: number[]) => number
  /** Redondeo sugerido de decimales para mostrar en UI. */
  decimals?: number
}

const pct = (b: number[]) => (b[0] * 100) / 255
const tempC = (b: number[]) => b[0] - 40

export const PID_TABLE: PidDefinition[] = [
  {
    pid: 0x04,
    name: 'Carga calculada del motor',
    shortName: 'Carga motor',
    unit: '%',
    minBytes: 1,
    min: 0,
    max: 100,
    decode: pct,
  },
  {
    pid: 0x05,
    name: 'Temperatura del refrigerante',
    shortName: 'Temp. refrigerante',
    unit: '°C',
    minBytes: 1,
    min: -40,
    max: 215,
    decode: tempC,
  },
  {
    pid: 0x06,
    name: 'Ajuste de combustible a corto plazo (banco 1)',
    shortName: 'STFT B1',
    unit: '%',
    minBytes: 1,
    min: -100,
    max: 99.2,
    decode: (b) => (b[0] - 128) * (100 / 128),
    decimals: 1,
  },
  {
    pid: 0x07,
    name: 'Ajuste de combustible a largo plazo (banco 1)',
    shortName: 'LTFT B1',
    unit: '%',
    minBytes: 1,
    min: -100,
    max: 99.2,
    decode: (b) => (b[0] - 128) * (100 / 128),
    decimals: 1,
  },
  {
    pid: 0x08,
    name: 'Ajuste de combustible a corto plazo (banco 2)',
    shortName: 'STFT B2',
    unit: '%',
    minBytes: 1,
    min: -100,
    max: 99.2,
    decode: (b) => (b[0] - 128) * (100 / 128),
    decimals: 1,
  },
  {
    pid: 0x09,
    name: 'Ajuste de combustible a largo plazo (banco 2)',
    shortName: 'LTFT B2',
    unit: '%',
    minBytes: 1,
    min: -100,
    max: 99.2,
    decode: (b) => (b[0] - 128) * (100 / 128),
    decimals: 1,
  },
  {
    pid: 0x0a,
    name: 'Presión de combustible',
    shortName: 'Presión combustible',
    unit: 'kPa',
    minBytes: 1,
    min: 0,
    max: 765,
    decode: (b) => b[0] * 3,
  },
  {
    pid: 0x0b,
    name: 'Presión absoluta del múltiple de admisión',
    shortName: 'Presión múltiple',
    unit: 'kPa',
    minBytes: 1,
    min: 0,
    max: 255,
    decode: (b) => b[0],
  },
  {
    pid: 0x0c,
    name: 'Revoluciones del motor',
    shortName: 'RPM',
    unit: 'rpm',
    minBytes: 2,
    min: 0,
    max: 8000,
    decode: (b) => (b[0] * 256 + b[1]) / 4,
  },
  {
    pid: 0x0d,
    name: 'Velocidad del vehículo',
    shortName: 'Velocidad',
    unit: 'km/h',
    minBytes: 1,
    min: 0,
    max: 255,
    decode: (b) => b[0],
  },
  {
    pid: 0x0e,
    name: 'Avance del tiempo de encendido',
    shortName: 'Avance encendido',
    unit: '°',
    minBytes: 1,
    min: -64,
    max: 63.5,
    decode: (b) => b[0] / 2 - 64,
    decimals: 1,
  },
  {
    pid: 0x0f,
    name: 'Temperatura del aire de admisión',
    shortName: 'Temp. admisión',
    unit: '°C',
    minBytes: 1,
    min: -40,
    max: 215,
    decode: tempC,
  },
  {
    pid: 0x10,
    name: 'Flujo de masa de aire (MAF)',
    shortName: 'MAF',
    unit: 'g/s',
    minBytes: 2,
    min: 0,
    max: 655.35,
    decode: (b) => (b[0] * 256 + b[1]) / 100,
    decimals: 2,
  },
  {
    pid: 0x11,
    name: 'Posición del acelerador',
    shortName: 'Acelerador',
    unit: '%',
    minBytes: 1,
    min: 0,
    max: 100,
    decode: pct,
  },
  {
    pid: 0x1f,
    name: 'Tiempo desde el arranque del motor',
    shortName: 'Tiempo funcionando',
    unit: 's',
    minBytes: 2,
    min: 0,
    max: 65535,
    decode: (b) => b[0] * 256 + b[1],
  },
  {
    pid: 0x21,
    name: 'Distancia recorrida con MIL activo',
    shortName: 'Distancia c/MIL',
    unit: 'km',
    minBytes: 2,
    min: 0,
    max: 65535,
    decode: (b) => b[0] * 256 + b[1],
  },
  {
    pid: 0x2f,
    name: 'Nivel de combustible en el tanque',
    shortName: 'Nivel combustible',
    unit: '%',
    minBytes: 1,
    min: 0,
    max: 100,
    decode: pct,
  },
  {
    pid: 0x33,
    name: 'Presión barométrica',
    shortName: 'Presión barométrica',
    unit: 'kPa',
    minBytes: 1,
    min: 0,
    max: 255,
    decode: (b) => b[0],
  },
  {
    pid: 0x42,
    name: 'Voltaje del módulo de control',
    shortName: 'Voltaje batería',
    unit: 'V',
    minBytes: 2,
    min: 0,
    max: 65.535,
    decode: (b) => (b[0] * 256 + b[1]) / 1000,
    decimals: 2,
  },
  {
    pid: 0x43,
    name: 'Valor de carga absoluta',
    shortName: 'Carga absoluta',
    unit: '%',
    minBytes: 2,
    min: 0,
    max: 25700,
    decode: (b) => ((b[0] * 256 + b[1]) * 100) / 255,
  },
  {
    pid: 0x44,
    name: 'Relación aire-combustible comandada (lambda)',
    shortName: 'Lambda comandada',
    unit: 'λ',
    minBytes: 2,
    min: 0,
    max: 2,
    decode: (b) => (b[0] * 256 + b[1]) / 32768,
    decimals: 3,
  },
  {
    pid: 0x45,
    name: 'Posición relativa del acelerador',
    shortName: 'Acelerador rel.',
    unit: '%',
    minBytes: 1,
    min: 0,
    max: 100,
    decode: pct,
  },
  {
    pid: 0x46,
    name: 'Temperatura ambiente',
    shortName: 'Temp. ambiente',
    unit: '°C',
    minBytes: 1,
    min: -40,
    max: 215,
    decode: tempC,
  },
  {
    pid: 0x5c,
    name: 'Temperatura del aceite del motor',
    shortName: 'Temp. aceite',
    unit: '°C',
    minBytes: 1,
    min: -40,
    max: 210,
    decode: tempC,
  },
  {
    pid: 0x5e,
    name: 'Tasa de consumo de combustible',
    shortName: 'Consumo combustible',
    unit: 'L/h',
    minBytes: 2,
    min: 0,
    max: 3212.75,
    decode: (b) => (b[0] * 256 + b[1]) / 20,
    decimals: 2,
  },
]

export const PID_BY_ID = new Map(PID_TABLE.map((p) => [p.pid, p]))

/** PIDs recomendados para el tablero principal (los que casi todo vehículo soporta). */
export const DASHBOARD_PIDS = [0x0c, 0x0d, 0x05, 0x11, 0x0f, 0x42, 0x04, 0x0e]

export function decodePidValue(def: PidDefinition, bytes: number[]): PidReading | null {
  if (bytes.length < def.minBytes) return null
  const raw = def.decode(bytes)
  const decimals = def.decimals ?? 0
  const value = Number(raw.toFixed(decimals))
  return {
    pid: def.pid,
    name: def.name,
    shortName: def.shortName,
    unit: def.unit,
    value,
    min: def.min,
    max: def.max,
  }
}

/** Decodifica el bitmask de PIDs soportados devuelto por 0100/0120/etc. */
export function decodeSupportedPidsBitmask(bytes: number[], baseOffset: number): number[] {
  const supported: number[] = []
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const byte = bytes[byteIndex]
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (0x80 >> bit)) {
        supported.push(baseOffset + byteIndex * 8 + bit + 1)
      }
    }
  }
  return supported
}
