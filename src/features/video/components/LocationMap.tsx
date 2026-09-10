import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPoint } from '../lib/iso6709'

interface LocationMapProps {
  point: GeoPoint | null
}

const PIN_ICON = L.divIcon({
  className: 'location-pin',
  html: '<span class="location-pin__dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export function LocationMap({ point }: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [0, 0],
      zoom: 3,
      attributionControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
    mapRef.current = map
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0)

    return () => {
      window.clearTimeout(resizeTimer)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !point) return

    const latLng: L.LatLngTuple = [point.lat, point.lon]
    if (!markerRef.current) {
      markerRef.current = L.marker(latLng, { icon: PIN_ICON }).addTo(map)
    } else {
      markerRef.current.setLatLng(latLng)
    }
    map.setView(latLng, 15)
  }, [point])

  return <div ref={containerRef} className="location-map" />
}
