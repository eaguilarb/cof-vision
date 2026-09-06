// Motor de protocolo ELM327: maneja la secuencia de inicialización AT,
// serializa comandos (el ELM327 es medio-duplex: un comando a la vez),
// y expone utilidades de bajo nivel para las capas de PIDs/DTC/vehículo.

import type { Transport } from './transport'

export interface Elm327InitResult {
  protocolName: string
  protocolCode: string
  voltage: string | null
}

interface QueuedCommand {
  command: string
  timeoutMs: number
  resolve: (lines: string[]) => void
  reject: (err: Error) => void
}

interface CurrentCommand extends QueuedCommand {
  timeout: ReturnType<typeof setTimeout>
}

const PROTOCOL_NAMES: Record<string, string> = {
  '0': 'Automático',
  '1': 'SAE J1850 PWM (41.6 kbaud)',
  '2': 'SAE J1850 VPW (10.4 kbaud)',
  '3': 'ISO 9141-2',
  '4': 'ISO 14230-4 KWP (5 baud init)',
  '5': 'ISO 14230-4 KWP (rápido init)',
  '6': 'ISO 15765-4 CAN (11 bit, 500 kbaud)',
  '7': 'ISO 15765-4 CAN (29 bit, 500 kbaud)',
  '8': 'ISO 15765-4 CAN (11 bit, 250 kbaud)',
  '9': 'ISO 15765-4 CAN (29 bit, 250 kbaud)',
  A: 'SAE J1939 CAN (29 bit, 250 kbaud)',
}

export class NoDataError extends Error {}
export class UnableToConnectError extends Error {}

export function parseHexBytes(line: string): number[] {
  const tokens = line.split(/\s+/).filter(Boolean)
  const bytes: number[] = []
  for (const token of tokens) {
    if (!/^[0-9A-Fa-f]{2}$/.test(token)) continue
    bytes.push(parseInt(token, 16))
  }
  return bytes
}

function toHexPair(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase()
}

export class Elm327 {
  private buffer = ''
  private current: CurrentCommand | null = null
  private queue: QueuedCommand[] = []
  private disposed = false
  private transport: Transport

  constructor(transport: Transport) {
    this.transport = transport
    this.transport.onData(this.handleData)
    this.transport.onDisconnect(() => {
      this.disposed = true
      this.failAll(new Error('Se perdió la conexión con el adaptador.'))
    })
  }

  private handleData = (chunk: string): void => {
    this.buffer += chunk
    if (!this.buffer.includes('>')) return
    const raw = this.buffer
    this.buffer = ''
    const job = this.current
    this.current = null
    if (!job) {
      this.pump()
      return
    }
    clearTimeout(job.timeout)
    const lines = raw
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== '>')
      .filter((l) => l.toUpperCase() !== job.command.toUpperCase())
    job.resolve(lines)
    this.pump()
  }

  private failAll(err: Error): void {
    if (this.current) {
      clearTimeout(this.current.timeout)
      this.current.reject(err)
      this.current = null
    }
    for (const job of this.queue.splice(0)) job.reject(err)
  }

  private pump(): void {
    if (this.current || this.queue.length === 0 || this.disposed) return
    const next = this.queue.shift()!
    const timeout = setTimeout(() => {
      this.current = null
      next.reject(new Error(`El adaptador no respondió a "${next.command}" a tiempo.`))
      this.pump()
    }, next.timeoutMs)
    this.current = { ...next, timeout }
    this.transport.write(next.command).catch((err) => {
      clearTimeout(timeout)
      this.current = null
      next.reject(err instanceof Error ? err : new Error(String(err)))
      this.pump()
    })
  }

  /** Envía un comando crudo (AT o modo OBD) y espera la respuesta completa hasta el prompt "&gt;". */
  sendRaw(command: string, timeoutMs = 4000): Promise<string[]> {
    if (this.disposed) return Promise.reject(new Error('El transporte está desconectado.'))
    return new Promise((resolve, reject) => {
      this.queue.push({ command, timeoutMs, resolve, reject })
      this.pump()
    })
  }

  /** Corre la secuencia estándar de inicialización de un ELM327. */
  async initialize(): Promise<Elm327InitResult> {
    await this.sendRaw('ATZ', 3000).catch(() => [])
    await this.sendRaw('ATE0') // eco apagado
    await this.sendRaw('ATL0') // sin saltos de línea extra
    await this.sendRaw('ATS0') // sin espacios en la respuesta
    await this.sendRaw('ATH0') // sin encabezados (más simple de parsear)
    await this.sendRaw('AT SP 0') // protocolo automático

    // "01 00" fuerza al ELM a negociar el protocolo con el vehículo.
    await this.sendRaw('0100', 8000).catch(() => [])

    const dpnLines = await this.sendRaw('ATDPN', 2000).catch(() => [])
    const dpnRaw = dpnLines[0]?.replace(/^A/, '').trim() ?? '0'
    const protocolName = PROTOCOL_NAMES[dpnRaw.toUpperCase()] ?? `Protocolo ${dpnRaw}`

    let voltage: string | null = null
    try {
      const voltLines = await this.sendRaw('ATRV', 2000)
      voltage = voltLines[0] ?? null
    } catch {
      voltage = null
    }

    return { protocolName, protocolCode: dpnRaw, voltage }
  }

  /**
   * Realiza una consulta de un PID de un modo dado y devuelve los bytes de
   * datos (sin el eco de modo+PID). Devuelve null si no hay datos o el bus
   * no responde.
   */
  async queryPid(mode: number, pid: number, extra: number[] = []): Promise<number[] | null> {
    const command =
      toHexPair(mode) + toHexPair(pid) + extra.map(toHexPair).join('')
    const lines = await this.sendRaw(command)
    return this.extractPidResponse(lines, mode, pid)
  }

  private extractPidResponse(lines: string[], mode: number, pid: number): number[] | null {
    const expectedMode = toHexPair(mode + 0x40)
    const expectedPid = toHexPair(pid)
    for (const line of lines) {
      if (/NO DATA/i.test(line)) return null
      if (/UNABLE TO CONNECT/i.test(line)) throw new UnableToConnectError(line)
      if (/^(SEARCHING|BUS INIT|STOPPED|\?)/i.test(line)) continue
      const bytes = parseHexBytes(line)
      if (bytes.length < 2) continue
      if (toHexPair(bytes[0]) === expectedMode && toHexPair(bytes[1]) === expectedPid) {
        return bytes.slice(2)
      }
    }
    return null
  }

  /** Envía un comando de modo (sin PID específico, ej. "03" para DTCs) y devuelve todas las líneas crudas. */
  async queryMode(mode: number, timeoutMs = 5000): Promise<string[]> {
    return this.sendRaw(toHexPair(mode), timeoutMs)
  }

  async close(): Promise<void> {
    this.disposed = true
    this.failAll(new Error('Conexión cerrada.'))
  }
}
