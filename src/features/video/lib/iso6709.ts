export interface GeoPoint {
  lat: number
  lon: number
  /** Altitud en metros, si el string la incluye. */
  alt?: number
}

// Formato ISO 6709 usado por QuickTime/ffmpeg para geolocalización, p.ej.:
//   "+37.3318-122.0312/"
//   "+37.3318-122.0312+000.000/"
const ISO6709_RE = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/

/** Convierte un string de ubicación ISO 6709 en coordenadas numéricas. */
export function parseIso6709(value: string): GeoPoint | null {
  const match = ISO6709_RE.exec(value.trim())
  if (!match) return null

  const lat = Number.parseFloat(match[1])
  const lon = Number.parseFloat(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null

  const point: GeoPoint = { lat, lon }
  if (match[3] !== undefined) {
    const alt = Number.parseFloat(match[3])
    if (Number.isFinite(alt)) point.alt = alt
  }
  return point
}
