import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import './video.css'
import { extractVideoGps } from './lib/mp4Gps'
import type { GeoPoint } from './lib/iso6709'
import { captionFrame, loadCaptioner, type CaptionLoadProgress } from './lib/captioner'
import type { ImageToTextPipeline } from '@huggingface/transformers'
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

type ModelState =
  | { status: 'idle' }
  | { status: 'loading'; progress: CaptionLoadProgress | null }
  | { status: 'ready' }
  | { status: 'error'; message: string }

const CAPTION_INTERVAL_MS = 4000

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function VideoAnalysisPage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>({ status: 'idle' })
  const [modelState, setModelState] = useState<ModelState>({ status: 'idle' })
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [autoDescribe, setAutoDescribe] = useState(true)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const captionerRef = useRef<ImageToTextPipeline | null>(null)
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

  const runCaption = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const captioner = captionerRef.current
    if (!video || !canvas || !captioner || isCaptioningRef.current) return
    if (video.paused || video.videoWidth === 0) return

    isCaptioningRef.current = true
    try {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const text = await captionFrame(captioner, canvas)
      if (text) {
        setCaptions((prev) => [...prev, { time: video.currentTime, text }])
      }
    } catch (err) {
      console.error('No se pudo describir el fotograma', err)
    } finally {
      isCaptioningRef.current = false
    }
  }, [])

  const ensureCaptioner = useCallback(async () => {
    if (captionerRef.current) return captionerRef.current
    setModelState({ status: 'loading', progress: null })
    try {
      const captioner = await loadCaptioner((progress) => {
        setModelState({ status: 'loading', progress })
      })
      captionerRef.current = captioner
      setModelState({ status: 'ready' })
      return captioner
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido cargando el modelo.'
      setModelState({ status: 'error', message })
      throw err
    }
  }, [])

  const handlePlay = useCallback(async () => {
    if (!autoDescribe) return
    try {
      await ensureCaptioner()
    } catch {
      return
    }
    void runCaption()
    stopCaptionLoop()
    intervalRef.current = window.setInterval(() => {
      void runCaption()
    }, CAPTION_INTERVAL_MS)
  }, [autoDescribe, ensureCaptioner, runCaption, stopCaptionLoop])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    stopCaptionLoop()
    setCaptions([])
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
          describe lo que va pasando en pantalla usando un modelo que corre 100% en tu navegador — no se
          envía el video a ningún servidor ni se necesita API key. Si el archivo trae coordenadas GPS
          embebidas, se muestran en el mapa.
        </p>
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
              onPlay={() => void handlePlay()}
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

              {modelState.status === 'loading' && (
                <div className="model-progress">
                  <span>
                    Descargando modelo de descripción (una sola vez, queda en caché del navegador)
                    {modelState.progress ? ` · ${formatBytes(modelState.progress.loaded)} / ${formatBytes(modelState.progress.total)}` : '…'}
                  </span>
                  <div className="model-progress__bar">
                    <div
                      className="model-progress__fill"
                      style={{ width: `${modelState.progress?.progress ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
              {modelState.status === 'error' && (
                <p className="hint hint--error">No se pudo cargar el modelo: {modelState.message}</p>
              )}

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
