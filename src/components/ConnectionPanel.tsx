import { useState } from 'react'
import { useObd } from '../state/obdContext'

const BAUD_RATES = [38400, 9600, 115200, 57600, 19200]

export function ConnectionPanel() {
  const { status, error, transportLabel, protocol, bluetoothSupported, serialSupported, connect, disconnect } =
    useObd()
  const [baudRate, setBaudRate] = useState(38400)

  const isBusy = status === 'connecting'

  return (
    <section className="panel connection-panel">
      <h2>Conexión con el adaptador</h2>
      <p className="muted">
        Compatible con adaptadores ELM327 v1.5 "Supports all OBDII protocols" — el más común del mercado,
        tanto por Bluetooth como por cable/USB.
      </p>

      {status === 'connected' ? (
        <div className="connection-status connection-status--ok">
          <div>
            <strong>Conectado</strong> vía {transportLabel}
            {protocol && (
              <div className="muted">
                Protocolo: {protocol.protocolName}
                {protocol.voltage ? ` · Batería: ${protocol.voltage}` : ''}
              </div>
            )}
          </div>
          <button className="btn btn--danger" onClick={() => void disconnect()}>
            Desconectar
          </button>
        </div>
      ) : (
        <div className="connection-options">
          <div className="connection-option">
            <h3>Bluetooth (BLE)</h3>
            <p className="muted">
              Para adaptadores ELM327 Bluetooth Low Energy (ej. Vgate iCar Pro BLE, OBDLink CX). Los ELM327
              Bluetooth <em>clásico</em> (como el de la foto, "Interface v1.5") no son compatibles con Web
              Bluetooth — usa la opción de puerto serie después de emparejarlo en tu sistema operativo.
            </p>
            <button
              className="btn btn--primary"
              disabled={!bluetoothSupported || isBusy}
              onClick={() => void connect('bluetooth')}
            >
              {isBusy ? 'Conectando…' : 'Conectar por Bluetooth'}
            </button>
            {!bluetoothSupported && <p className="hint hint--warn">Tu navegador no soporta Web Bluetooth.</p>}
          </div>

          <div className="connection-option">
            <h3>Puerto serie (USB / Bluetooth clásico emparejado)</h3>
            <p className="muted">
              Empareja tu ELM327 Bluetooth en los ajustes de tu computadora primero (esto crea un puerto
              COM/rfcomm), o conéctalo por cable USB-serie. Luego selecciónalo aquí.
            </p>
            <label className="field">
              Velocidad (baudios)
              <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}>
                {BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn--primary"
              disabled={!serialSupported || isBusy}
              onClick={() => void connect('serial', baudRate)}
            >
              {isBusy ? 'Conectando…' : 'Conectar por puerto serie'}
            </button>
            {!serialSupported && <p className="hint hint--warn">Tu navegador no soporta Web Serial.</p>}
          </div>
        </div>
      )}

      {error && <p className="hint hint--error">{error}</p>}
    </section>
  )
}
