// Decodificación de códigos de diagnóstico (DTC) a partir de pares de bytes,
// según el formato estándar SAE J2012 / ISO 15031-6, y utilidades para
// leerlos (Modo 03/07/0A) y borrarlos (Modo 04).

import type { Elm327 } from './elm327'
import { parseHexBytes } from './elm327'
import { describeDtc } from './dtcDescriptions'

const LETTERS = ['P', 'C', 'B', 'U'] as const

export type DtcCategory = 'stored' | 'pending' | 'permanent'

export interface DtcEntry {
  code: string
  description: string
  category: DtcCategory
}

export function decodeDtcCode(byte0: number, byte1: number): string | null {
  if (byte0 === 0 && byte1 === 0) return null
  const letter = LETTERS[(byte0 >> 6) & 0x3]
  const digit1 = (byte0 >> 4) & 0x3
  const digit2 = (byte0 & 0xf).toString(16).toUpperCase()
  const digit3 = ((byte1 >> 4) & 0xf).toString(16).toUpperCase()
  const digit4 = (byte1 & 0xf).toString(16).toUpperCase()
  return `${letter}${digit1}${digit2}${digit3}${digit4}`
}

export function decodeDtcList(bytes: number[]): string[] {
  const codes: string[] = []
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = decodeDtcCode(bytes[i], bytes[i + 1])
    if (code) codes.push(code)
  }
  return codes
}

const MODE_BY_CATEGORY: Record<DtcCategory, number> = {
  stored: 0x03,
  pending: 0x07,
  permanent: 0x0a,
}

/** Lee los códigos de una categoría (almacenados, pendientes o permanentes). */
export async function readDtcs(elm: Elm327, category: DtcCategory): Promise<DtcEntry[]> {
  const lines = await elm.queryMode(MODE_BY_CATEGORY[category], 6000)
  const expectedPrefix = (MODE_BY_CATEGORY[category] + 0x40).toString(16).toUpperCase().padStart(2, '0')
  const codes = new Set<string>()

  for (const line of lines) {
    if (/NO DATA/i.test(line)) continue
    if (/^(SEARCHING|BUS INIT|STOPPED|\?)/i.test(line)) continue
    const bytes = parseHexBytes(line)
    if (bytes.length < 2) continue
    const prefix = bytes[0].toString(16).toUpperCase().padStart(2, '0')
    const dataBytes = prefix === expectedPrefix ? bytes.slice(1) : bytes
    for (const code of decodeDtcList(dataBytes)) codes.add(code)
  }

  return [...codes].map((code) => ({
    code,
    description: describeDtc(code),
    category,
  }))
}

export async function readAllDtcs(elm: Elm327): Promise<DtcEntry[]> {
  const [stored, pending, permanent] = await Promise.all([
    readDtcs(elm, 'stored').catch(() => []),
    readDtcs(elm, 'pending').catch(() => []),
    readDtcs(elm, 'permanent').catch(() => []),
  ])
  return [...stored, ...pending, ...permanent]
}

/** Borra los códigos almacenados y apaga la luz de "Check Engine" (Modo 04). */
export async function clearDtcs(elm: Elm327): Promise<boolean> {
  const lines = await elm.sendRaw('04', 6000)
  return lines.some((l) => /^(44|OK)/i.test(l))
}

export interface MonitorStatus {
  milOn: boolean
  dtcCount: number
}

/** Decodifica el PID 01 00-equivalente 0x01 (estado de monitores desde el último borrado). */
export function decodeMonitorStatus(bytes: number[]): MonitorStatus | null {
  if (bytes.length < 1) return null
  const a = bytes[0]
  return {
    milOn: (a & 0x80) !== 0,
    dtcCount: a & 0x7f,
  }
}
