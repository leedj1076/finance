import { formatRate } from '@/lib/finance'

import { LINE_WIDTH, POINT_RADIUS, ROLE } from './chart-theme'

// Fixed-size server-rendered marks for the home hero and tables. The
// responsive trend charts live in home-trend-charts.tsx.

export function SavingsProgressRing({ value, target }: { value: number; target: number }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const progress = Math.min(Math.max(value, 0), 100)
  const targetAngle = (Math.min(Math.max(target, 0), 100) / 100) * Math.PI * 2 - Math.PI / 2
  const markerStart = 45
  const markerEnd = 62
  return (
    <svg aria-label={`순저축률 ${formatRate(value)}%, 목표 ${formatRate(target)}%`} className="h-[136px] w-[136px]" role="img" viewBox="0 0 136 136">
      <circle cx="68" cy="68" fill="none" r={radius} stroke={ROLE.track} strokeWidth="14" />
      <circle
        cx="68"
        cy="68"
        fill="none"
        r={radius}
        stroke={value >= target ? ROLE.saving : ROLE.ink}
        strokeDasharray={`${(progress / 100) * circumference} ${circumference}`}
        strokeLinecap="butt"
        strokeWidth="14"
        transform="rotate(-90 68 68)"
      />
      <line
        stroke={ROLE.ink}
        strokeWidth="2"
        x1={68 + Math.cos(targetAngle) * markerStart}
        x2={68 + Math.cos(targetAngle) * markerEnd}
        y1={68 + Math.sin(targetAngle) * markerStart}
        y2={68 + Math.sin(targetAngle) * markerEnd}
      />
      <text className="chart-hero-value" fill={ROLE.ink} textAnchor="middle" x="68" y="68">{formatRate(value)}%</text>
      <text className="chart-caption" fill={ROLE.muted} textAnchor="middle" x="68" y="84">목표 {formatRate(target)}%</text>
    </svg>
  )
}

export function Sparkline({ values, tone = 'neutral' }: { values: number[]; tone?: 'good' | 'bad' | 'neutral' }) {
  if (values.length === 0 || values.every((value) => value === 0)) {
    return <span className="t-caption text-finance-faint">기록 없음</span>
  }
  const width = 110
  const height = 26
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 1)
  const points = values.map((value, index) => ({
    x: 2 + (index * 106) / Math.max(values.length - 1, 1),
    y: 3 + ((max - value) / range) * 20,
  }))
  const color = tone === 'good' ? ROLE.saving : tone === 'bad' ? ROLE.over : ROLE.muted
  return (
    <svg aria-hidden height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      <polyline fill="none" points={points.map((point) => `${point.x},${point.y}`).join(' ')} stroke={color} strokeWidth={LINE_WIDTH} />
      <circle cx={points.at(-1)?.x} cy={points.at(-1)?.y} fill={color} r={POINT_RADIUS} />
    </svg>
  )
}
