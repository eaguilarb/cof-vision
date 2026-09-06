// Capa de transporte: abstrae la conexión física con el adaptador ELM327,
// ya sea por Bluetooth Low Energy (Web Bluetooth) o por puerto serie
// (Web Serial — cubre USB y adaptadores Bluetooth clásico SPP ya emparejados
// a nivel de sistema operativo, que el SO expone como puerto COM/rfcomm).

export type TransportKind = 'bluetooth' | 'serial'

export interface Transport {
  readonly kind: TransportKind
  readonly label: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Envía una línea de texto (se le agrega el terminador \r). */
  write(line: string): Promise<void>
  /** Se invoca con cada fragmento de texto recibido del adaptador. */
  onData(listener: (chunk: string) => void): void
  /** Se invoca si la conexión se pierde de forma inesperada. */
  onDisconnect(listener: () => void): void
  readonly connected: boolean
}

// Nordic UART Service — usado por la mayoría de los adaptadores ELM327 BLE.
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const NUS_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e' // escritura (host -> adaptador)
const NUS_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e' // notificación (adaptador -> host)

// Servicio estilo HM-10 / módulos BLE-UART genéricos, usado por algunos clones.
const HM10_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb'
const HM10_CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb'

const CANDIDATE_PROFILES: { service: string; tx: string; rx: string }[] = [
  { service: NUS_SERVICE, tx: NUS_TX, rx: NUS_RX },
  { service: HM10_SERVICE, tx: HM10_CHAR, rx: HM10_CHAR },
]

export class BluetoothTransport implements Transport {
  readonly kind: TransportKind = 'bluetooth'
  private device: BluetoothDevice | null = null
  private txChar: BluetoothRemoteGATTCharacteristic | null = null
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null
  private dataListeners: Array<(chunk: string) => void> = []
  private disconnectListeners: Array<() => void> = []
  private decoder = new TextDecoder()

  get label(): string {
    return this.device?.name ? `Bluetooth: ${this.device.name}` : 'Bluetooth'
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error(
        'Este navegador no soporta Web Bluetooth. Usa Chrome o Edge en escritorio o Android.',
      )
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [NUS_SERVICE] },
        { services: [HM10_SERVICE] },
        { namePrefix: 'OBD' },
        { namePrefix: 'ELM' },
        { namePrefix: 'Vgate' },
        { namePrefix: 'VLink' },
      ],
      optionalServices: [NUS_SERVICE, HM10_SERVICE],
    })

    this.device.addEventListener('gattserverdisconnected', this.handleDisconnect)

    const server = await this.device.gatt!.connect()

    for (const profile of CANDIDATE_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service)
        this.txChar = await service.getCharacteristic(profile.tx)
        this.rxChar = await service.getCharacteristic(profile.rx)
        break
      } catch {
        // Se intenta con el siguiente perfil de servicio UART candidato.
      }
    }

    if (!this.txChar || !this.rxChar) {
      server.disconnect()
      throw new Error(
        'No se encontró un servicio UART compatible en el adaptador Bluetooth. ' +
          'Si tu ELM327 es Bluetooth clásico (SPP), empareja el dispositivo en el sistema operativo y conéctate por "Puerto serie".',
      )
    }

    await this.rxChar.startNotifications()
    this.rxChar.addEventListener('characteristicvaluechanged', this.handleNotification)
  }

  private handleNotification = (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic
    const value = characteristic.value
    if (!value) return
    const chunk = this.decoder.decode(value.buffer)
    for (const listener of this.dataListeners) listener(chunk)
  }

  private handleDisconnect = () => {
    this.txChar = null
    this.rxChar = null
    for (const listener of this.disconnectListeners) listener()
  }

  async disconnect(): Promise<void> {
    this.device?.gatt?.disconnect()
    this.device = null
    this.txChar = null
    this.rxChar = null
  }

  async write(line: string): Promise<void> {
    if (!this.txChar) throw new Error('No hay conexión Bluetooth activa.')
    const encoder = new TextEncoder()
    const payload = encoder.encode(line + '\r')
    // Muchos adaptadores BLE limitan el MTU de escritura; se fragmenta en bloques de 20 bytes.
    const chunkSize = 20
    for (let i = 0; i < payload.length; i += chunkSize) {
      const slice = payload.subarray(i, i + chunkSize)
      try {
        await this.txChar.writeValueWithoutResponse(slice)
      } catch {
        await this.txChar.writeValue(slice)
      }
    }
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener)
  }

  onDisconnect(listener: () => void): void {
    this.disconnectListeners.push(listener)
  }
}

export class SerialTransport implements Transport {
  readonly kind: TransportKind = 'serial'
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private dataListeners: Array<(chunk: string) => void> = []
  private disconnectListeners: Array<() => void> = []
  private decoder = new TextDecoder()
  private encoder = new TextEncoder()
  private readLoopActive = false
  private _connected = false
  private baudRate: number

  constructor(baudRate = 38400) {
    this.baudRate = baudRate
  }

  get label(): string {
    return `Puerto serie (${this.baudRate} bps)`
  }

  get connected(): boolean {
    return this._connected
  }

  async connect(): Promise<void> {
    if (!navigator.serial) {
      throw new Error(
        'Este navegador no soporta Web Serial. Usa Chrome o Edge en escritorio.',
      )
    }

    this.port = await navigator.serial.requestPort()
    await this.port.open({ baudRate: this.baudRate })
    this._connected = true

    if (this.port.writable) {
      this.writer = this.port.writable.getWriter()
    }

    this.readLoopActive = true
    void this.readLoop()
  }

  private async readLoop(): Promise<void> {
    if (!this.port?.readable) return
    this.reader = this.port.readable.getReader()
    try {
      while (this.readLoopActive) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value) {
          const chunk = this.decoder.decode(value)
          for (const listener of this.dataListeners) listener(chunk)
        }
      }
    } catch {
      // El puerto se cerró o se desconectó el dispositivo.
    } finally {
      this._connected = false
      for (const listener of this.disconnectListeners) listener()
    }
  }

  async disconnect(): Promise<void> {
    this.readLoopActive = false
    try {
      await this.reader?.cancel()
    } catch {
      /* noop */
    }
    this.reader?.releaseLock()
    this.reader = null

    try {
      this.writer?.releaseLock()
    } catch {
      /* noop */
    }
    this.writer = null

    try {
      await this.port?.close()
    } catch {
      /* noop */
    }
    this.port = null
    this._connected = false
  }

  async write(line: string): Promise<void> {
    if (!this.writer) throw new Error('No hay conexión serie activa.')
    await this.writer.write(this.encoder.encode(line + '\r'))
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener)
  }

  onDisconnect(listener: () => void): void {
    this.disconnectListeners.push(listener)
  }
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

export function isSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serial
}
