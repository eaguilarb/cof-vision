import { useState } from 'react'
import { useObd } from '../state/obdContext'
import { PID_BY_ID } from '../lib/obd/pids'
import { Gauge } from './Gauge'
import { LiveChart } from './LiveChart'

export function Dashboard() {
  const { watchedPids, setWatchedPids, live, history, allPids } = useObd()
  const [featuredPid, setFeaturedPid] = useState(0x0c)
  const [pickerOpen, setPickerOpen] = useState(false)

  const togglePid = (pid: number) => {
    if (watchedPids.includes(pid)) {
      setWatchedPids(watchedPids.filter((p) => p !== pid))
    } else {
      setWatchedPids([...watchedPids, pid])
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Datos en vivo</h2>
        <button className="btn btn--ghost" onClick={() => setPickerOpen((v) => !v)}>
          {pickerOpen ? 'Cerrar selector de PIDs' : 'Elegir parámetros a monitorear'}
        </button>
      </div>

      {pickerOpen && (
        <div className="pid-picker">
          {allPids.map((def) => (
            <label key={def.pid} className="pid-picker__item">
              <input
                type="checkbox"
                checked={watchedPids.includes(def.pid)}
                onChange={() => togglePid(def.pid)}
              />
              {def.shortName}
            </label>
          ))}
        </div>
      )}

      <div className="gauge-grid">
        {watchedPids.map((pid) => {
          const def = PID_BY_ID.get(pid)
          if (!def) return null
          return (
            <Gauge
              key={pid}
              label={def.shortName}
              value={live[pid]?.value}
              unit={def.unit}
              min={def.min}
              max={def.max}
              decimals={def.decimals}
            />
          )
        })}
        {watchedPids.length === 0 && <p className="muted">Selecciona al menos un parámetro para monitorear.</p>}
      </div>

      <div className="panel__header">
        <h3>Gráfica en tiempo real</h3>
        <select value={featuredPid} onChange={(e) => setFeaturedPid(Number(e.target.value))}>
          {watchedPids.map((pid) => (
            <option key={pid} value={pid}>
              {PID_BY_ID.get(pid)?.name}
            </option>
          ))}
        </select>
      </div>
      <LiveChart
        title={PID_BY_ID.get(featuredPid)?.name ?? ''}
        unit={PID_BY_ID.get(featuredPid)?.unit ?? ''}
        points={history[featuredPid] ?? []}
      />
    </section>
  )
}
