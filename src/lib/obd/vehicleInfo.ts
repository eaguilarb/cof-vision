// Información general del vehículo: VIN (Modo 09) y una decodificación básica
// del VIN (año modelo, y fabricante aproximado a partir del WMI).

import type { Elm327 } from './elm327'
import { parseHexBytes } from './elm327'

export interface VehicleInfo {
  vin: string | null
  modelYear: number | null
  manufacturer: string | null
}

function bytesToAscii(bytes: number[]): string {
  return bytes
    .filter((b) => b > 0)
    .map((b) => String.fromCharCode(b))
    .join('')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

export async function readVin(elm: Elm327): Promise<string | null> {
  const lines = await elm.sendRaw('0902', 6000).catch(() => [])
  const allBytes: number[] = []
  for (const line of lines) {
    if (/NO DATA/i.test(line) || /UNABLE TO CONNECT/i.test(line)) continue
    if (/^(SEARCHING|BUS INIT|STOPPED|\?)/i.test(line)) continue
    allBytes.push(...parseHexBytes(line))
  }

  let dataBytes = allBytes
  // El adaptador antepone el eco "49 02 <NODI>" antes de los datos ASCII del VIN.
  if (dataBytes[0] === 0x49 && dataBytes[1] === 0x02) {
    dataBytes = dataBytes.slice(3)
  }

  const vin = bytesToAscii(dataBytes)
  return vin.length >= 11 ? vin.slice(-17) : null
}

// Mapa parcial del WMI (World Manufacturer Identifier) — cubre los fabricantes
// más comunes. No pretende ser exhaustivo.
const WMI_MANUFACTURERS: Record<string, string> = {
  '1G': 'General Motors (EE. UU.)',
  '1F': 'Ford (EE. UU.)',
  '1C': 'Chrysler/Dodge (EE. UU.)',
  '1N': 'Nissan (EE. UU.)',
  '1J': 'Jeep (EE. UU.)',
  '1H': 'Honda (EE. UU.)',
  '2G': 'General Motors (Canadá)',
  '2H': 'Honda (Canadá)',
  '2T': 'Toyota (Canadá)',
  '3F': 'Ford (México)',
  '3G': 'General Motors (México)',
  '3N': 'Nissan (México)',
  '3V': 'Volkswagen (México)',
  '4T': 'Toyota (EE. UU.)',
  '5N': 'Hyundai (EE. UU.)',
  '5Y': 'Toyota (EE. UU.)',
  JHM: 'Honda (Japón)',
  JN1: 'Nissan (Japón)',
  JT: 'Toyota (Japón)',
  KL: 'Daewoo/GM Korea',
  KM: 'Hyundai (Corea)',
  KN: 'Kia (Corea)',
  WBA: 'BMW (Alemania)',
  WDB: 'Mercedes-Benz (Alemania)',
  WDD: 'Mercedes-Benz (Alemania)',
  WVW: 'Volkswagen (Alemania)',
  VF: 'Renault/Peugeot/Citroën (Francia)',
  VSS: 'SEAT (España)',
  ZFA: 'Fiat (Italia)',
}

// Código del 10.º carácter del VIN -> año modelo (ciclo de 30 años, 1980-2009 y 2010-2039).
const YEAR_CODES = '0123456789ABCDEFGHJKLMNPRSTVWXY'

function decodeModelYear(vin: string): number | null {
  const code = vin[9]?.toUpperCase()
  if (!code) return null
  const index = YEAR_CODES.indexOf(code)
  if (index === -1) return null
  // Los VIN no codifican el siglo; se asume el ciclo 2010-2039 para vehículos modernos.
  return 2010 + index
}

function decodeManufacturer(vin: string): string | null {
  for (const len of [3, 2]) {
    const prefix = vin.slice(0, len).toUpperCase()
    if (WMI_MANUFACTURERS[prefix]) return WMI_MANUFACTURERS[prefix]
  }
  return null
}

export async function readVehicleInfo(elm: Elm327): Promise<VehicleInfo> {
  const vin = await readVin(elm)
  return {
    vin,
    modelYear: vin ? decodeModelYear(vin) : null,
    manufacturer: vin ? decodeManufacturer(vin) : null,
  }
}
