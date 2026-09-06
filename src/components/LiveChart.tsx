import type { HistoryPoint } from '../state/obdContext'

interface LiveChartProps {
  title: string
  unit: string
  points: HistoryPoint[]
}

const WIDTH = 320
const HEIGHT = 110
const PAD = 8

export function LiveChart({ title, unit, points }: LiveChartProps) {
  if (points.length < 2) {
    return (
      <div className="live-chart">
        <div className="live-chart__header">
          <span>{title}</span>
          <span className="muted">{unit}</span>
        </div>
        <div className="live-chart__empty">Recolectando datos…</div>
      </div>
    )
  }

  const values = points.map((p) => p.value)
  let dataMin = Math.min(...values)
  let dataMax = Math.max(...values)
  if (dataMin === dataMax) {
    dataMin -= 1
    dataMax += 1
  }
  const range = dataMax - dataMin

  const coords = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * (WIDTH - PAD * 2)
    const y = PAD + (1 - (p.value - dataMin) / range) * (HEIGHT - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const last = points[points.length - 1]

  return (
    <div className="live-chart">
      <div className="live-chart__header">
        <span>{title}</span>
        <span className="live-chart__last">
          {last.value} <span className="muted">{unit}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="live-chart__svg" preserveAspectRatio="none">
        <polyline points={coords.join(' ')} className="live-chart__line" />
      </svg>
      <div className="live-chart__scale">
        <span>{dataMin.toFixed(1)}</span>
        <span>{dataMax.toFixed(1)}</span>
      </div>
    </div>
  )
}
