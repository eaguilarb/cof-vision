import { useEffect, useState } from 'react'
import { useObd } from '../state/obdContext'
import type { DtcCategory } from '../lib/obd/dtc'

const CATEGORY_LABELS: Record<DtcCategory, string> = {
  stored: 'Almacenados (confirmados)',
  pending: 'Pendientes',
  permanent: 'Permanentes',
}

const CATEGORY_HINTS: Record<DtcCategory, string> = {
  stored: 'Fallas confirmadas que encendieron la luz de "Check Engine".',
  pending: 'Fallas detectadas en el ciclo de manejo actual, aún no confirmadas.',
  permanent: 'Fallas que no se pueden borrar hasta que el sistema confirme que se corrigieron.',
}

interface DtcPanelProps {
  onViewFreezeFrame?: () => void
}

export function DtcPanel({ onViewFreezeFrame }: DtcPanelProps) {
  const { dtcs, dtcsLoading, dtcsError, refreshDtcs, clearDtcs, loadFreezeFrame } = useObd()
  const [confirmingClear, setConfirmingClear] = useState(false)

  useEffect(() => {
    void refreshDtcs()
    // Se ejecuta una sola vez al conectar el panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grouped: Record<DtcCategory, typeof dtcs> = {
    stored: dtcs.filter((d) => d.category === 'stored'),
    pending: dtcs.filter((d) => d.category === 'pending'),
    permanent: dtcs.filter((d) => d.category === 'permanent'),
  }

  const handleClear = async () => {
    setConfirmingClear(false)
    await clearDtcs()
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Códigos de diagnóstico (DTC)</h2>
        <div className="panel__actions">
          <button className="btn btn--ghost" disabled={dtcsLoading} onClick={() => void refreshDtcs()}>
            {dtcsLoading ? 'Leyendo…' : 'Actualizar'}
          </button>
          <button
            className="btn btn--danger"
            disabled={dtcsLoading || dtcs.length === 0}
            onClick={() => setConfirmingClear(true)}
          >
            Borrar códigos
          </button>
        </div>
      </div>

      {confirmingClear && (
        <div className="confirm-box">
          <p>
            Esto borrará todos los códigos de falla y apagará la luz de "Check Engine". También se
            reiniciarán los monitores de emisiones. ¿Confirmas?
          </p>
          <div className="panel__actions">
            <button className="btn btn--danger" onClick={() => void handleClear()}>
              Sí, borrar
            </button>
            <button className="btn btn--ghost" onClick={() => setConfirmingClear(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {dtcsError && <p className="hint hint--error">{dtcsError}</p>}

      {(Object.keys(grouped) as DtcCategory[]).map((category) => (
        <div key={category} className="dtc-group">
          <h3>
            {CATEGORY_LABELS[category]} ({grouped[category].length})
          </h3>
          <p className="muted">{CATEGORY_HINTS[category]}</p>
          {grouped[category].length === 0 ? (
            <p className="muted">Sin códigos en esta categoría.</p>
          ) : (
            <ul className="dtc-list">
              {grouped[category].map((dtc) => (
                <li key={`${category}-${dtc.code}`} className="dtc-list__item">
                  <span className="dtc-code">{dtc.code}</span>
                  <span className="dtc-description">{dtc.description}</span>
                  {category === 'stored' && (
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        void loadFreezeFrame(0)
                        onViewFreezeFrame?.()
                      }}
                    >
                      Ver freeze frame
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}
