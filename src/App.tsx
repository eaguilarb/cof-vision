import { useState } from 'react'
import './App.css'
import { ObdProvider, useObd } from './state/obdContext'
import { ConnectionPanel } from './components/ConnectionPanel'
import { Dashboard } from './components/Dashboard'
import { DtcPanel } from './components/DtcPanel'
import { FreezeFramePanel } from './components/FreezeFramePanel'
import { VehicleInfoPanel } from './components/VehicleInfoPanel'
import { ReportPanel } from './components/ReportPanel'

type Tab = 'connection' | 'dashboard' | 'dtc' | 'freeze' | 'vehicle' | 'report'

const TABS: { id: Tab; label: string; requiresConnection: boolean }[] = [
  { id: 'connection', label: 'Conexión', requiresConnection: false },
  { id: 'dashboard', label: 'Tablero', requiresConnection: true },
  { id: 'dtc', label: 'Códigos (DTC)', requiresConnection: true },
  { id: 'freeze', label: 'Freeze frame', requiresConnection: true },
  { id: 'vehicle', label: 'Vehículo', requiresConnection: true },
  { id: 'report', label: 'Reporte', requiresConnection: true },
]

function Shell() {
  const { status } = useObd()
  const [tab, setTab] = useState<Tab>('connection')
  const connected = status === 'connected'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo">⛽</span>
          <div>
            <h1>COF Vision</h1>
            <p className="muted">Escáner automotriz profesional OBD-II</p>
          </div>
        </div>
        <div className={`status-pill status-pill--${status}`}>
          {status === 'connected' && 'Conectado'}
          {status === 'connecting' && 'Conectando…'}
          {status === 'disconnected' && 'Sin conexión'}
          {status === 'error' && 'Error de conexión'}
        </div>
      </header>

      <nav className="app-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`app-tabs__item ${tab === t.id ? 'app-tabs__item--active' : ''}`}
            disabled={t.requiresConnection && !connected}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'connection' && <ConnectionPanel />}
        {tab === 'dashboard' && connected && <Dashboard />}
        {tab === 'dtc' && connected && <DtcPanel onViewFreezeFrame={() => setTab('freeze')} />}
        {tab === 'freeze' && connected && <FreezeFramePanel />}
        {tab === 'vehicle' && connected && <VehicleInfoPanel />}
        {tab === 'report' && connected && <ReportPanel />}
        {tab !== 'connection' && !connected && (
          <section className="panel">
            <p className="muted">Conecta un adaptador ELM327 para acceder a esta sección.</p>
          </section>
        )}
      </main>

      <footer className="app-footer muted">
        Compatible con adaptadores ELM327 v1.5 (todos los protocolos OBD-II) · Uso diagnóstico, no reemplaza
        el escáner de concesionario para procedimientos de programación.
      </footer>
    </div>
  )
}

function App() {
  return (
    <ObdProvider>
      <Shell />
    </ObdProvider>
  )
}

export default App
