import { useObd } from '../state/obdContext'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function ReportPanel() {
  const { vehicleInfo, protocol, transportLabel, dtcs, freezeFrames, live, allPids } = useObd()

  const timestamp = new Date()
  const dateLabel = timestamp.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })
  const fileStamp = timestamp.toISOString().replace(/[:.]/g, '-')

  const buildPdf = async () => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const marginX = 48
    const pageHeight = doc.internal.pageSize.getHeight()
    const pageWidth = doc.internal.pageSize.getWidth()
    let y = 56

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - 48) {
        doc.addPage()
        y = 56
      }
    }

    const heading = (text: string) => {
      ensureSpace(28)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text(text, marginX, y)
      y += 20
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
    }

    const line = (text: string) => {
      const wrapped = doc.splitTextToSize(text, pageWidth - marginX * 2)
      for (const w of wrapped) {
        ensureSpace(14)
        doc.text(w, marginX, y)
        y += 14
      }
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text('Reporte de diagnóstico OBD-II', marginX, y)
    y += 22
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Generado: ${dateLabel}`, marginX, y)
    y += 24

    heading('Vehículo')
    line(`VIN: ${vehicleInfo?.vin ?? 'No disponible'}`)
    line(`Año modelo estimado: ${vehicleInfo?.modelYear ?? '—'}`)
    line(`Fabricante aproximado: ${vehicleInfo?.manufacturer ?? '—'}`)
    line(`Protocolo OBD-II: ${protocol?.protocolName ?? '—'}`)
    line(`Voltaje de batería: ${protocol?.voltage ?? '—'}`)
    line(`Adaptador utilizado: ${transportLabel ?? '—'}`)
    y += 10

    heading(`Códigos de diagnóstico (${dtcs.length})`)
    if (dtcs.length === 0) {
      line('No se detectaron códigos de falla.')
    } else {
      for (const dtc of dtcs) {
        line(`[${dtc.category.toUpperCase()}] ${dtc.code} — ${dtc.description}`)
      }
    }
    y += 10

    const frames = Object.values(freezeFrames)
    if (frames.length > 0) {
      heading('Freeze frame')
      for (const frame of frames) {
        line(`Código asociado: ${frame.dtc ?? 'No especificado'}`)
        for (const r of frame.readings) {
          line(`  · ${r.name}: ${r.value} ${r.unit}`)
        }
      }
      y += 10
    }

    heading('Instantánea de datos en vivo')
    const liveEntries = Object.values(live)
    if (liveEntries.length === 0) {
      line('No hay datos en vivo capturados en esta sesión.')
    } else {
      for (const reading of liveEntries) {
        line(`${reading.name}: ${reading.value} ${reading.unit}`)
      }
    }

    doc.save(`reporte-obd2-${fileStamp}.pdf`)
  }

  const buildCsv = () => {
    const rows: string[] = []
    rows.push('Sección,Campo,Valor')
    rows.push(`Vehículo,VIN,${csvEscape(vehicleInfo?.vin ?? '')}`)
    rows.push(`Vehículo,Año estimado,${csvEscape(String(vehicleInfo?.modelYear ?? ''))}`)
    rows.push(`Vehículo,Fabricante,${csvEscape(vehicleInfo?.manufacturer ?? '')}`)
    rows.push(`Vehículo,Protocolo,${csvEscape(protocol?.protocolName ?? '')}`)
    rows.push(`Vehículo,Voltaje batería,${csvEscape(protocol?.voltage ?? '')}`)

    for (const dtc of dtcs) {
      rows.push(`DTC (${dtc.category}),${csvEscape(dtc.code)},${csvEscape(dtc.description)}`)
    }

    for (const [key, frame] of Object.entries(freezeFrames)) {
      for (const r of frame.readings) {
        rows.push(`Freeze frame ${csvEscape(key)},${csvEscape(r.name)},${r.value} ${r.unit}`)
      }
    }

    for (const def of allPids) {
      const reading = live[def.pid]
      if (!reading) continue
      rows.push(`Datos en vivo,${csvEscape(def.name)},${reading.value} ${reading.unit}`)
    }

    downloadBlob(`reporte-obd2-${fileStamp}.csv`, rows.join('\n'), 'text/csv;charset=utf-8')
  }

  return (
    <section className="panel">
      <h2>Reporte de diagnóstico</h2>
      <p className="muted">
        Genera un reporte con la información del vehículo, los códigos de falla, el freeze frame cargado y
        una instantánea de los datos en vivo — listo para entregar al cliente o archivar.
      </p>
      <div className="panel__actions">
        <button className="btn btn--primary" onClick={() => void buildPdf()}>
          Descargar PDF
        </button>
        <button className="btn btn--ghost" onClick={buildCsv}>
          Descargar CSV
        </button>
      </div>
    </section>
  )
}
