// Lector mínimo de "cajas" (boxes) ISO BMFF / QuickTime para ubicar metadatos
// sin tener que cargar el archivo de video completo en memoria.

export interface Box {
  type: string
  start: number
  end: number
  payloadStart: number
}

/** Recorre las cajas contenidas en [start, end) dentro de un DataView ya en memoria. */
export function* iterateBoxes(view: DataView, start: number, end: number): Generator<Box> {
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset)
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    )
    let headerSize = 8

    if (size === 1) {
      if (offset + 16 > end) break
      const high = view.getUint32(offset + 8)
      const low = view.getUint32(offset + 12)
      size = high * 2 ** 32 + low
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }

    if (size < headerSize || offset + size > end) break

    yield { type, start: offset, end: offset + size, payloadStart: offset + headerSize }
    offset += size
  }
}

/** Cabecera de una caja de nivel superior, leída con una lectura pequeña (no carga el payload). */
interface TopLevelBoxHeader {
  type: string
  headerSize: number
  boxSize: number
}

async function readTopLevelHeader(file: File, offset: number): Promise<TopLevelBoxHeader | null> {
  if (offset + 8 > file.size) return null
  const buf = await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer()
  if (buf.byteLength < 8) return null
  const view = new DataView(buf)
  let size = view.getUint32(0)
  const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7))
  let headerSize = 8

  if (size === 1) {
    if (buf.byteLength < 16) return null
    const high = view.getUint32(8)
    const low = view.getUint32(12)
    size = high * 2 ** 32 + low
    headerSize = 16
  } else if (size === 0) {
    size = file.size - offset
  }

  return { type, headerSize, boxSize: size }
}

const MAX_TOP_LEVEL_BOXES = 5000

/** Ubica la caja `moov` de nivel superior sin leer el resto del archivo (mdat, etc.). */
export async function findMoovBox(file: File): Promise<{ start: number; size: number } | null> {
  let offset = 0
  let iterations = 0

  while (offset < file.size && iterations++ < MAX_TOP_LEVEL_BOXES) {
    const header = await readTopLevelHeader(file, offset)
    if (!header || header.boxSize <= 0) break

    if (header.type === 'moov') {
      return { start: offset + header.headerSize, size: header.boxSize - header.headerSize }
    }

    offset += header.boxSize
  }

  return null
}
