import { findMoovBox, iterateBoxes, type Box } from './mp4Boxes'
import { parseIso6709, type GeoPoint } from './iso6709'

// Tamaño máximo de "moov" que estamos dispuestos a cargar en memoria para inspeccionar.
const MAX_MOOV_SIZE = 200 * 1024 * 1024

const QUICKTIME_XYZ_TYPE = '©xyz'
const LOCATION_KEY_NAME = 'com.apple.quicktime.location.ISO6709'

function decodeUtf8(view: DataView, start: number, end: number): string {
  if (end <= start) return ''
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, end - start)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Atom de texto clásico de QuickTime: uint16 length + uint16 lang + bytes UTF-8. */
function parseQuickTimeTextAtom(view: DataView, box: Box): string | null {
  const { payloadStart, end } = box
  if (end - payloadStart < 4) return null
  const len = view.getUint16(payloadStart)
  const strStart = payloadStart + 4
  const strEnd = Math.min(strStart + len, end)
  if (strEnd <= strStart) return null
  return decodeUtf8(view, strStart, strEnd)
}

/**
 * Sistema de metadatos "keys/ilst" que usa el iPhone (moov/meta) para guardar
 * la ubicación bajo la clave com.apple.quicktime.location.ISO6709.
 */
function parseMetaKeysIlst(view: DataView, metaBox: Box): string | null {
  // "meta" aquí es una full box: 1 byte versión + 3 bytes flags antes de las cajas hijas.
  const childrenStart = metaBox.payloadStart + 4
  if (childrenStart > metaBox.end) return null

  let keysBox: Box | null = null
  let ilstBox: Box | null = null
  for (const child of iterateBoxes(view, childrenStart, metaBox.end)) {
    if (child.type === 'keys') keysBox = child
    else if (child.type === 'ilst') ilstBox = child
  }
  if (!keysBox || !ilstBox) return null

  let offset = keysBox.payloadStart + 4 // versión + flags
  if (offset + 4 > keysBox.end) return null
  const entryCount = view.getUint32(offset)
  offset += 4

  const keyNames: string[] = []
  for (let i = 0; i < entryCount && offset + 8 <= keysBox.end; i++) {
    const keySize = view.getUint32(offset)
    if (keySize < 8 || offset + keySize > keysBox.end) break
    keyNames.push(decodeUtf8(view, offset + 8, offset + keySize))
    offset += keySize
  }

  const keyIndex = keyNames.indexOf(LOCATION_KEY_NAME)
  if (keyIndex === -1) return null
  const targetItemId = keyIndex + 1 // los items en "ilst" se numeran desde 1

  for (const item of iterateBoxes(view, ilstBox.payloadStart, ilstBox.end)) {
    // Dentro de "ilst" el "type" de cada caja es en realidad el índice (entero de 4 bytes),
    // no un fourcc legible.
    const itemId = view.getUint32(item.start + 4)
    if (itemId !== targetItemId) continue

    for (const dataBox of iterateBoxes(view, item.payloadStart, item.end)) {
      if (dataBox.type !== 'data') continue
      if (dataBox.end - dataBox.payloadStart < 8) continue
      const typeIndicator = view.getUint32(dataBox.payloadStart)
      if (typeIndicator !== 1) continue // 1 = UTF-8 string
      return decodeUtf8(view, dataBox.payloadStart + 8, dataBox.end)
    }
  }

  return null
}

/** Busca un string de ubicación ISO 6709 dentro del payload (ya en memoria) de "moov". */
function findLocationString(view: DataView, moovStart: number, moovEnd: number): string | null {
  for (const box of iterateBoxes(view, moovStart, moovEnd)) {
    if (box.type === 'meta') {
      const iso = parseMetaKeysIlst(view, box)
      if (iso) return iso
    }

    if (box.type === 'udta') {
      for (const child of iterateBoxes(view, box.payloadStart, box.end)) {
        if (child.type === QUICKTIME_XYZ_TYPE) {
          const iso = parseQuickTimeTextAtom(view, child)
          if (iso) return iso
        }
        if (child.type === 'meta') {
          const iso = parseMetaKeysIlst(view, child)
          if (iso) return iso
        }
      }
    }
  }
  return null
}

export interface VideoGpsResult {
  point: GeoPoint
  raw: string
}

/**
 * Extrae la coordenada GPS embebida en un video MP4/MOV (metadato de ubicación
 * grabado por el celular o por ffmpeg), sin cargar el archivo completo en memoria.
 */
export async function extractVideoGps(file: File): Promise<VideoGpsResult | null> {
  const moov = await findMoovBox(file)
  if (!moov || moov.size <= 0) return null
  if (moov.size > MAX_MOOV_SIZE) {
    throw new Error(
      'El bloque de metadatos del video es demasiado grande para inspeccionarlo en el navegador.',
    )
  }

  const buffer = await file.slice(moov.start, moov.start + moov.size).arrayBuffer()
  const view = new DataView(buffer)
  const raw = findLocationString(view, 0, buffer.byteLength)
  if (!raw) return null

  const point = parseIso6709(raw)
  if (!point) return null

  return { point, raw }
}
