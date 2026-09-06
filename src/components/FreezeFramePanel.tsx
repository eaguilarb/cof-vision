import { useObd } from '../state/obdContext'

export function FreezeFramePanel() {
  const { freezeFrames, freezeFrameLoading, loadFreezeFrame } = useObd()
  const frames = Object.entries(freezeFrames)

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Freeze frame</h2>
        <button className="btn btn--ghost" disabled={freezeFrameLoading} onClick={() => void loadFreezeFrame(0)}>
          {freezeFrameLoading ? 'Leyendo…' : 'Leer freeze frame actual'}
        </button>
      </div>
      <p className="muted">
        Es la "fotografía" de todos los parámetros del motor en el instante exacto en que se registró una
        falla — clave para diagnosticar problemas intermitentes.
      </p>

      {frames.length === 0 && !freezeFrameLoading && (
        <p className="muted">No hay freeze frames cargados. Léelo desde aquí o desde un código en la pestaña de DTC.</p>
      )}

      {frames.map(([key, frame]) => (
        <div key={key} className="freeze-frame">
          <h3>Código asociado: {frame.dtc ?? 'No especificado por el vehículo'}</h3>
          {frame.readings.length === 0 ? (
            <p className="muted">El vehículo no reportó parámetros para este freeze frame.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Parámetro</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {frame.readings.map((r) => (
                  <tr key={r.pid}>
                    <td>{r.name}</td>
                    <td>
                      {r.value} {r.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  )
}
