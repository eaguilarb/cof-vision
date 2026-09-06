import { useEffect } from 'react'
import { useObd } from '../state/obdContext'

export function VehicleInfoPanel() {
  const { vehicleInfo, vehicleInfoLoading, refreshVehicleInfo, protocol, transportLabel } = useObd()

  useEffect(() => {
    void refreshVehicleInfo()
    // Se ejecuta una sola vez al abrir el panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Información del vehículo</h2>
        <button className="btn btn--ghost" disabled={vehicleInfoLoading} onClick={() => void refreshVehicleInfo()}>
          {vehicleInfoLoading ? 'Leyendo…' : 'Actualizar'}
        </button>
      </div>

      <dl className="info-grid">
        <div>
          <dt>VIN</dt>
          <dd>{vehicleInfo?.vin ?? (vehicleInfoLoading ? 'Leyendo…' : 'No disponible')}</dd>
        </div>
        <div>
          <dt>Año modelo (estimado por VIN)</dt>
          <dd>{vehicleInfo?.modelYear ?? '—'}</dd>
        </div>
        <div>
          <dt>Fabricante (aproximado por WMI)</dt>
          <dd>{vehicleInfo?.manufacturer ?? '—'}</dd>
        </div>
        <div>
          <dt>Protocolo OBD-II</dt>
          <dd>{protocol?.protocolName ?? '—'}</dd>
        </div>
        <div>
          <dt>Voltaje de batería</dt>
          <dd>{protocol?.voltage ?? '—'}</dd>
        </div>
        <div>
          <dt>Adaptador</dt>
          <dd>{transportLabel ?? '—'}</dd>
        </div>
      </dl>
    </section>
  )
}
