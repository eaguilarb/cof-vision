import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  BluetoothTransport,
  SerialTransport,
  isBluetoothSupported,
  isSerialSupported,
  type Transport,
  type TransportKind,
} from '../lib/obd/transport'
import { Elm327, type Elm327InitResult } from '../lib/obd/elm327'
import { PID_BY_ID, PID_TABLE, DASHBOARD_PIDS, decodePidValue, type PidReading } from '../lib/obd/pids'
import { readAllDtcs, clearDtcs as clearDtcsCmd, type DtcEntry } from '../lib/obd/dtc'
import { readFreezeFrame, type FreezeFrame } from '../lib/obd/freezeFrame'
import { readVehicleInfo, type VehicleInfo } from '../lib/obd/vehicleInfo'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface HistoryPoint {
  t: number
  value: number
}

const MAX_HISTORY_POINTS = 90
const POLL_ERROR_LIMIT = 6

interface ObdState {
  status: ConnectionStatus
  error: string | null
  transportLabel: string | null
  protocol: Elm327InitResult | null
  watchedPids: number[]
  live: Record<number, PidReading>
  history: Record<number, HistoryPoint[]>
  dtcs: DtcEntry[]
  dtcsLoading: boolean
  dtcsError: string | null
  vehicleInfo: VehicleInfo | null
  vehicleInfoLoading: boolean
  freezeFrames: Record<string, FreezeFrame>
  freezeFrameLoading: boolean
}

interface ObdApi extends ObdState {
  bluetoothSupported: boolean
  serialSupported: boolean
  connect: (kind: TransportKind, baudRate?: number) => Promise<void>
  disconnect: () => Promise<void>
  setWatchedPids: (pids: number[]) => void
  refreshDtcs: () => Promise<void>
  clearDtcs: () => Promise<void>
  loadFreezeFrame: (frame?: number) => Promise<void>
  refreshVehicleInfo: () => Promise<void>
  allPids: typeof PID_TABLE
}

const ObdContext = createContext<ObdApi | null>(null)

const initialState: ObdState = {
  status: 'disconnected',
  error: null,
  transportLabel: null,
  protocol: null,
  watchedPids: DASHBOARD_PIDS,
  live: {},
  history: {},
  dtcs: [],
  dtcsLoading: false,
  dtcsError: null,
  vehicleInfo: null,
  vehicleInfoLoading: false,
  freezeFrames: {},
  freezeFrameLoading: false,
}

export function ObdProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ObdState>(initialState)
  const transportRef = useRef<Transport | null>(null)
  const elmRef = useRef<Elm327 | null>(null)
  const pollActiveRef = useRef(false)
  const watchedPidsRef = useRef<number[]>(DASHBOARD_PIDS)

  const patch = useCallback((partial: Partial<ObdState>) => {
    setState((prev) => ({ ...prev, ...partial }))
  }, [])

  const stopPolling = useCallback(() => {
    pollActiveRef.current = false
  }, [])

  const startPolling = useCallback(() => {
    if (pollActiveRef.current) return
    pollActiveRef.current = true

    const loop = async () => {
      let consecutiveErrors = 0
      while (pollActiveRef.current) {
        const elm = elmRef.current
        if (!elm) break
        for (const pid of watchedPidsRef.current) {
          if (!pollActiveRef.current) break
          const def = PID_BY_ID.get(pid)
          if (!def) continue
          try {
            const bytes = await elm.queryPid(0x01, pid)
            consecutiveErrors = 0
            if (!bytes) continue
            const reading = decodePidValue(def, bytes)
            if (!reading) continue
            setState((prev) => {
              const prevHistory = prev.history[pid] ?? []
              const nextHistory = [...prevHistory, { t: Date.now(), value: reading.value }].slice(
                -MAX_HISTORY_POINTS,
              )
              return {
                ...prev,
                live: { ...prev.live, [pid]: reading },
                history: { ...prev.history, [pid]: nextHistory },
              }
            })
          } catch {
            consecutiveErrors++
            if (consecutiveErrors >= POLL_ERROR_LIMIT) {
              pollActiveRef.current = false
              patch({ status: 'error', error: 'Se perdió la comunicación con el vehículo.' })
              return
            }
          }
        }
      }
    }

    void loop()
  }, [patch])

  const disconnect = useCallback(async () => {
    stopPolling()
    await elmRef.current?.close()
    await transportRef.current?.disconnect()
    elmRef.current = null
    transportRef.current = null
    setState({ ...initialState, watchedPids: watchedPidsRef.current })
  }, [stopPolling])

  const connect = useCallback(
    async (kind: TransportKind, baudRate = 38400) => {
      patch({ status: 'connecting', error: null })
      try {
        const transport = kind === 'bluetooth' ? new BluetoothTransport() : new SerialTransport(baudRate)
        transport.onDisconnect(() => {
          stopPolling()
          patch({ status: 'disconnected', error: 'El adaptador se desconectó.' })
        })
        await transport.connect()

        const elm = new Elm327(transport)
        const protocol = await elm.initialize()

        transportRef.current = transport
        elmRef.current = elm

        patch({
          status: 'connected',
          transportLabel: transport.label,
          protocol,
          error: null,
        })

        startPolling()
      } catch (err) {
        patch({
          status: 'error',
          error: err instanceof Error ? err.message : 'No se pudo conectar con el adaptador.',
        })
      }
    },
    [patch, startPolling, stopPolling],
  )

  const setWatchedPids = useCallback((pids: number[]) => {
    watchedPidsRef.current = pids
    setState((prev) => ({ ...prev, watchedPids: pids }))
  }, [])

  const refreshDtcs = useCallback(async () => {
    const elm = elmRef.current
    if (!elm) return
    patch({ dtcsLoading: true, dtcsError: null })
    try {
      const dtcs = await readAllDtcs(elm)
      patch({ dtcs, dtcsLoading: false })
    } catch (err) {
      patch({
        dtcsLoading: false,
        dtcsError: err instanceof Error ? err.message : 'No se pudieron leer los códigos de falla.',
      })
    }
  }, [patch])

  const clearDtcs = useCallback(async () => {
    const elm = elmRef.current
    if (!elm) return
    patch({ dtcsLoading: true, dtcsError: null })
    try {
      await clearDtcsCmd(elm)
      const dtcs = await readAllDtcs(elm)
      patch({ dtcs, dtcsLoading: false, freezeFrames: {} })
    } catch (err) {
      patch({
        dtcsLoading: false,
        dtcsError: err instanceof Error ? err.message : 'No se pudieron borrar los códigos de falla.',
      })
    }
  }, [patch])

  const loadFreezeFrame = useCallback(
    async (frame = 0) => {
      const elm = elmRef.current
      if (!elm) return
      patch({ freezeFrameLoading: true })
      try {
        const result = await readFreezeFrame(elm, frame)
        setState((prev) => ({
          ...prev,
          freezeFrameLoading: false,
          freezeFrames: result
            ? { ...prev.freezeFrames, [result.dtc ?? `frame-${frame}`]: result }
            : prev.freezeFrames,
        }))
      } catch {
        patch({ freezeFrameLoading: false })
      }
    },
    [patch],
  )

  const refreshVehicleInfo = useCallback(async () => {
    const elm = elmRef.current
    if (!elm) return
    patch({ vehicleInfoLoading: true })
    try {
      const info = await readVehicleInfo(elm)
      patch({ vehicleInfo: info, vehicleInfoLoading: false })
    } catch {
      patch({ vehicleInfoLoading: false })
    }
  }, [patch])

  useEffect(() => {
    return () => {
      stopPolling()
      void elmRef.current?.close()
      void transportRef.current?.disconnect()
    }
  }, [stopPolling])

  const value = useMemo<ObdApi>(
    () => ({
      ...state,
      bluetoothSupported: isBluetoothSupported(),
      serialSupported: isSerialSupported(),
      connect,
      disconnect,
      setWatchedPids,
      refreshDtcs,
      clearDtcs,
      loadFreezeFrame,
      refreshVehicleInfo,
      allPids: PID_TABLE,
    }),
    [state, connect, disconnect, setWatchedPids, refreshDtcs, clearDtcs, loadFreezeFrame, refreshVehicleInfo],
  )

  return <ObdContext.Provider value={value}>{children}</ObdContext.Provider>
}

export function useObd(): ObdApi {
  const ctx = useContext(ObdContext)
  if (!ctx) throw new Error('useObd debe usarse dentro de <ObdProvider>')
  return ctx
}
