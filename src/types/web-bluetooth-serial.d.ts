// Declaraciones mínimas para las Web Bluetooth API y Web Serial API.
// No forman parte de lib.dom.d.ts por defecto en TypeScript.

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string
  readonly value?: DataView
  readonly properties: {
    read: boolean
    write: boolean
    writeWithoutResponse: boolean
    notify: boolean
    indicate: boolean
  }
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  writeValueWithResponse(value: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  addEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => void,
  ): void
  removeEventListener(
    type: 'characteristicvaluechanged',
    listener: (this: BluetoothRemoteGATTCharacteristic, ev: Event) => void,
  ): void
}

interface BluetoothRemoteGATTService {
  readonly uuid: string
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>
  getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]>
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean
  readonly device: BluetoothDevice
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>
  getPrimaryServices(service?: string): Promise<BluetoothRemoteGATTService[]>
}

interface BluetoothDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: BluetoothRemoteGATTServer
  addEventListener(type: 'gattserverdisconnected', listener: (this: BluetoothDevice, ev: Event) => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: (this: BluetoothDevice, ev: Event) => void): void
}

interface BluetoothLEScanFilter {
  services?: string[]
  name?: string
  namePrefix?: string
}

interface RequestDeviceOptions {
  filters?: BluetoothLEScanFilter[]
  optionalServices?: string[]
  acceptAllDevices?: boolean
}

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>
}

interface Navigator {
  readonly bluetooth?: Bluetooth
  readonly serial?: Serial
}

// --- Web Serial API ---

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialOptions {
  baudRate: number
  dataBits?: number
  stopBits?: number
  parity?: 'none' | 'even' | 'odd'
  bufferSize?: number
  flowControl?: 'none' | 'hardware'
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface SerialFilter {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialRequestOptions {
  filters?: SerialFilter[]
}

interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>
  requestPort(options?: SerialRequestOptions): Promise<SerialPort>
}
