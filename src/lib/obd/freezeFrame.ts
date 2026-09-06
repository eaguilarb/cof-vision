// Lectura de "freeze frame" (Modo 02): la foto de los parámetros del motor
// tomada en el instante exacto en que se registró un DTC.

import type { Elm327 } from './elm327'
import { parseHexBytes } from './elm327'
import { PID_TABLE, decodePidValue, type PidReading } from './pids'
import { decodeDtcCode } from './dtc'

export interface FreezeFrame {
  dtc: string | null
  readings: PidReading[]
}

async function queryFreezeFramePid(elm: Elm327, pid: number, frame: number): Promise<number[] | null> {
  const pidHex = pid.toString(16).padStart(2, '0').toUpperCase()
  const frameHex = frame.toString(16).padStart(2, '0').toUpperCase()
  const lines = await elm.sendRaw(`02${pidHex}${frameHex}`)

  for (const line of lines) {
    if (/NO DATA/i.test(line)) return null
    if (/^(SEARCHING|BUS INIT|STOPPED|\?)/i.test(line)) continue
    const bytes = parseHexBytes(line)
    if (bytes.length < 3) continue
    const modeOk = bytes[0].toString(16).toUpperCase().padStart(2, '0') === '42'
    const pidOk = bytes[1].toString(16).toUpperCase().padStart(2, '0') === pidHex
    if (modeOk && pidOk) return bytes.slice(3) // se descartan modo, PID y número de frame
  }
  return null
}

/** Lee el freeze frame número `frame` (0 = el más reciente/único en la mayoría de ECUs). */
export async function readFreezeFrame(elm: Elm327, frame = 0): Promise<FreezeFrame | null> {
  const dtcBytes = await queryFreezeFramePid(elm, 0x02, frame).catch(() => null)
  const dtc = dtcBytes && dtcBytes.length >= 2 ? decodeDtcCode(dtcBytes[0], dtcBytes[1]) : null

  const readings: PidReading[] = []
  for (const def of PID_TABLE) {
    try {
      const bytes = await queryFreezeFramePid(elm, def.pid, frame)
      if (!bytes) continue
      const reading = decodePidValue(def, bytes)
      if (reading) readings.push(reading)
    } catch {
      // El ECU no soporta este PID en el freeze frame; se omite.
    }
  }

  if (!dtc && readings.length === 0) return null
  return { dtc, readings }
}
