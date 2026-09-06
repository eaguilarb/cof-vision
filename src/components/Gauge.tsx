interface GaugeProps {
  label: string
  value: number | undefined
  unit: string
  min: number
  max: number
  decimals?: number
}

const SIZE = 200
const RADIUS = 82
const CENTER = SIZE / 2

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function Gauge({ label, value, unit, min, max, decimals = 0 }: GaugeProps) {
  const hasValue = value !== undefined && Number.isFinite(value)
  const fraction = hasValue ? clamp((value - min) / (max - min || 1), 0, 1) : 0
  const thetaDeg = 180 - fraction * 180
  const thetaRad = (thetaDeg * Math.PI) / 180
  const needleLength = RADIUS - 14
  const tipX = CENTER + needleLength * Math.cos(thetaRad)
  const tipY = CENTER - needleLength * Math.sin(thetaRad)
  const danger = fraction > 0.85

  const pathD = `M ${CENTER - RADIUS},${CENTER} A ${RADIUS},${RADIUS} 0 0 1 ${CENTER + RADIUS},${CENTER}`

  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${SIZE} ${SIZE / 2 + 20}`} className="gauge__svg">
        <path d={pathD} className="gauge__track" pathLength={100} strokeDasharray="100" />
        <path
          d={pathD}
          className={danger ? 'gauge__value gauge__value--danger' : 'gauge__value'}
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 * (1 - fraction)}
        />
        {hasValue && (
          <line
            x1={CENTER}
            y1={CENTER}
            x2={tipX}
            y2={tipY}
            className="gauge__needle"
            strokeLinecap="round"
          />
        )}
        <circle cx={CENTER} cy={CENTER} r={6} className="gauge__hub" />
      </svg>
      <div className="gauge__reading">
        <span className="gauge__number">{hasValue ? value.toFixed(decimals) : '—'}</span>
        <span className="gauge__unit">{unit}</span>
      </div>
      <div className="gauge__label">{label}</div>
    </div>
  )
}
