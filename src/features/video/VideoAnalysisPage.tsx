import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import './video.css'
import { extractVideoGps } from './lib/mp4Gps'
import type { GeoPoint } from './lib/iso6709'
import { captionFrame, createCaptionClient, describeCaptionError, drawFrame } from './lib/captioner'
import { LocationMap } from './components/LocationMap'

interface CaptionEntry {
  time: number
  text: string
}

type GpsState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; point: GeoPoint; raw: string }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

const CAPTION_INTERVAL_MS = 4000
const API_KEY_STORAGE_KEY = 'cof-vision-anthropic-api-key'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VideoAnalysisPage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>({ status: 'idle' })
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [autoDescribe, setAutoDescribe] = useState(true)
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? '')
  const [captionError, setCaptionError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const clientRef = useRef<{ key: string; client: Anthropic } | null>(null)
  const intervalRef = useRef<number | null>(null)
  const isCaptioningRef = useRef(false)

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  const stopCaptionLoop = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const handleApiKeyChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value.trim()
    setApiKey(value)
    if (value) window.localStorage.setItem(API_KEY_STORAGE_KEY, value)
    else window.localStorage.removeItem(API_KEY_STORAGE_KEY)
  }, [])

  const getClient = useCallback((): Anthropic | null => {
    if (!apiKey) return null
    if (clientRef.current?.key === apiKey) return clientRef.current.client
    const client = createCaptionClient(apiKey)
    clientRef.current = { key: apiKey, client }
    return client
  }, [apiKey])

  const runCaption = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const client = getClient()
    if (!video || !canvas || !client || isCaptioningRef.current) return
    if (video.paused) return

    isCaptioningRef.current = true
    try {
      if (!drawFrame(video, canvas)) return
      const text = await captionFrame(client, canvas)
      if (text) {
        setCaptions((prev) => [...prev, { time: video.currentTime, text }])
        setCaptionError(null)
      }
    } catch (err) {
      setCaptionError(describeCaptionError(err))
    } finally {
      isCaptioningRef.current = false
    }
  }, [getClient])

  const handlePlay = useCallback(() => {
    if (!autoDescribe) return
    if (!apiKey) {
      setCaptionError('Ingresa tu API key de Anthropic para describir la escena.')
      return
    }
    void runCaption()
    stopCaptionLoop()
    intervalRef.current = window.setInterval(() => {
      void runCaption()
    }, CAPTION_INTERVAL_MS)
  }, [apiKey, autoDescribe, runCaption, stopCaptionLoop])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    stopCaptionLoop()
    setCaptions([])
    setCaptionError(null)
    setFileName(file.name)
    setGpsState({ status: 'searching' })
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })

    extractVideoGps(file)
      .then((result) => {
        setGpsState(result ? { status: 'found', point: result.point, raw: result.raw } : { status: 'not-found' })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'No se pudo leer la ubicación del video.'
        setGpsState({ status: 'error', message })
      })
  }, [stopCaptionLoop])

  useEffect(() => stopCaptionLoop, [stopCaptionLoop])

  const point = gpsState.status === 'found' ? gpsState.point : null

  return (
    <div className="video-page">
      <section className="panel">
        <div className="panel__header">
          <h2>Análisis de video</h2>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={autoDescribe}
              onChange={(e) => setAutoDescribe(e.target.checked)}
            />
            Describir la escena automáticamente
          </label>
        </div>
        <p className="muted">
          Sube un video (por ejemplo, grabado con el celular o una dashcam). Mientras se reproduce, se
          describe lo que va pasando usando la API de Claude (visión) — rápido y sin descargar nada. Si el
          archivo trae coordenadas GPS embebidas, se muestran en el mapa.
        </p>
        <div className="field">
          <label htmlFor="anthropic-key">API key de Anthropic</label>
          <input
            id="anthropic-key"
            type="password"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={handleApiKeyChange}
            autoComplete="off"
          />
          <span className="hint">
            Se guarda solo en tu navegador. Consíguela en{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            . Cada descripción consume créditos de tu cuenta (modelo Haiku, el más barato).
          </span>
        </div>
        <div className="video-dropzone">
          <input type="file" accept="video/*" onChange={handleFileChange} />
          {fileName && <span className="hint">{fileName}</span>}
        </div>
      </section>

      {videoUrl && (
        <section className="panel">
          <div className="video-stage">
            <video
              ref={videoRef}
              src={videoUrl}
              className="video-player"
              controls
              onPlay={handlePlay}
              onPause={stopCaptionLoop}
              onEnded={stopCaptionLoop}
            />

            <div className="video-side">
              <div>
                <h3>Ubicación</h3>
                {gpsState.status === 'searching' && <p className="hint">Buscando coordenadas en el video…</p>}
                {gpsState.status === 'not-found' && (
                  <p className="hint">Este video no trae coordenadas GPS embebidas.</p>
                )}
                {gpsState.status === 'error' && <p className="hint hint--error">{gpsState.message}</p>}
                {gpsState.status === 'found' && (
                  <div className="location-summary">
                    <span>
                      <code>{gpsState.point.lat.toFixed(5)}, {gpsState.point.lon.toFixed(5)}</code>
                    </span>
                    {gpsState.point.alt !== undefined && (
                      <span className="muted">Altitud: {gpsState.point.alt.toFixed(1)} m</span>
                    )}
                  </div>
                )}
                <LocationMap point={point} />
              </div>

              {captionError && <p className="hint hint--error">{captionError}</p>}

              <div>
                <h3>Qué va pasando</h3>
                <div className="caption-feed">
                  {captions.length === 0 && (
                    <p className="caption-feed__empty">
                      {autoDescribe ? 'Dale play al video para empezar a describir la escena.' : 'La descripción automática está apagada.'}
                    </p>
                  )}
                  {captions.map((entry, i) => (
                    <div className="caption-entry" key={i}>
                      <span className="caption-entry__time">{formatTime(entry.time)}</span>
                      <span className="caption-entry__text">{entry.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </section>
      )}
    </div>
  )
}
