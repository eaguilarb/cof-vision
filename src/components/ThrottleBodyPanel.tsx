import { useState } from 'react'
import { useObd } from '../state/obdContext'
import { PID_BY_ID } from '../lib/obd/pids'

const STEPS = [
  'Con el motor frío y apagado, limpia físicamente el cuerpo de aceleración (mariposa y sensor de posición) con limpiador específico para TPS/cuerpo de aceleración — nunca con limpiador de frenos o WD-40.',
  'Con el motor aún apagado, gira la llave a la posición "ON" (contacto, sin arrancar) y espera 3 segundos.',
  'Apaga el contacto y espera 10 segundos. Repite este ciclo 3 veces — esto permite que el ECU vuelva a leer la posición de reposo del sensor TPS.',
  'Reinicia los valores adaptativos con el botón de abajo (equivale al comando estándar OBD-II Modo 04).',
  'Enciende el motor y déjalo en ralentí, sin tocar el acelerador, durante 5 minutos para que el ECU reaprenda el ralentí.',
  'Verifica con el panel de abajo que el ralentí se estabilice y que la posición del acelerador en reposo sea constante (normalmente 0-1 %).',
]

export function ThrottleBodyPanel() {
  const { live, clearDtcs, dtcsLoading } = useObd()
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)

  const rpm = live[0x0c]
  const throttle = live[0x11]
  const coolant = live[0x05]

  const handleReset = async () => {
    setConfirming(false)
    await clearDtcs()
    setDone(true)
  }

  return (
    <section className="panel">
      <h2>Limpieza y reinicio del cuerpo de aceleración</h2>
      <p className="muted">
        Guía para limpiar el cuerpo de aceleración y reiniciar los valores que el ECU aprendió sobre su
        posición — el procedimiento recomendado tras una limpieza para evitar ralentí inestable o calado del
        motor.
      </p>

      <div className="hint hint--warn">
        En cuerpos de aceleración electrónicos (drive-by-wire) de VAG, Ford, GM, BMW y otras marcas, algunos
        vehículos necesitan además una <strong>adaptación específica del fabricante</strong> (ej. "Throttle
        Body Alignment" de Ford, "Grupo 060" de VAG) que requiere un protocolo UDS propietario — esto no lo
        puede ejecutar un ELM327 genérico y necesita una herramienta de marca (Forscan, VCDS, Techstream,
        etc.). El procedimiento de abajo es el genérico que resuelve la mayoría de los casos.
      </div>

      <ol className="steps-list">
        {STEPS.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <div className="panel__header">
        <h3>Reiniciar valores adaptativos</h3>
      </div>
      <p className="muted">
        Envía el comando estándar OBD-II Modo 04: borra los códigos de falla y, en la mayoría de las ECU,
        también reinicia la memoria adaptativa de ralentí y combustible. No es una recalibración garantizada
        por el estándar — es el equivalente genérico más cercano disponible sin herramienta de marca.
      </p>

      {confirming ? (
        <div className="confirm-box">
          <p>
            Esto borrará también los códigos de falla almacenados y reiniciará los monitores de emisiones.
            ¿Confirmas?
          </p>
          <div className="panel__actions">
            <button className="btn btn--danger" onClick={() => void handleReset()}>
              Sí, reiniciar
            </button>
            <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="panel__actions">
          <button className="btn btn--primary" disabled={dtcsLoading} onClick={() => setConfirming(true)}>
            {dtcsLoading ? 'Enviando…' : 'Reiniciar valores adaptativos'}
          </button>
        </div>
      )}

      {done && <p className="hint">Comando enviado. Sigue con el paso 5: enciende el motor y espera en ralentí.</p>}

      <div className="panel__header">
        <h3>Verificación en vivo</h3>
      </div>
      <dl className="info-grid">
        <div>
          <dt>{PID_BY_ID.get(0x0c)?.name}</dt>
          <dd>{rpm ? `${rpm.value} ${rpm.unit}` : 'Conecta el motor / sin dato'}</dd>
        </div>
        <div>
          <dt>{PID_BY_ID.get(0x11)?.name}</dt>
          <dd>{throttle ? `${throttle.value} ${throttle.unit}` : 'Sin dato'}</dd>
        </div>
        <div>
          <dt>{PID_BY_ID.get(0x05)?.name}</dt>
          <dd>{coolant ? `${coolant.value} ${coolant.unit}` : 'Sin dato'}</dd>
        </div>
      </dl>
    </section>
  )
}
