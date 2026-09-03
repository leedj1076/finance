import { formatRate, formatWon } from '@/lib/finance'

import {
  LINE_WIDTH,
  POINT_RADIUS,
  POINT_RADIUS_ACTIVE,
  REFERENCE_LINE_WIDTH,
  ROLE,
} from './chart-theme'

// Server-rendered home charts. No hover layer: these are stat tiles and a
// small trend, not explorable plots. Text uses text tokens, never series color.

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

export function CashflowWaterfall({
  income,
  fixedExpense,
  variableExpense,
  saving,
  cashRemaining,
}: {
  income: number
  fixedExpense: number
  variableExpense: number
  saving: number
  cashRemaining: number
}) {
  const width = 500
  const baseline = 168
  const top = 24
  const barWidth = 62
  const maxValue = Math.max(income, fixedExpense + variableExpense + saving, Math.abs(cashRemaining), 1)
  const scale = (baseline - top) / maxValue
  const steps = [
    { amount: fixedExpense, label: '고정비', color: ROLE.expense },
    { amount: variableExpense, label: '변동비', color: 'var(--finance-muted)' },
    { amount: saving, label: '저축 납입', color: ROLE.saving },
  ]
  const xValues = [18, 116, 214, 312, 410]
  let running = income
  const placed = steps.map((step, index) => {
    const before = running
    running -= step.amount
    return { ...step, before, x: xValues[index + 1] }
  })
  const incomeHeight = Math.max(income * scale, 1)
  const finalHeight = Math.max(Math.abs(cashRemaining) * scale, 1)
  const remainingColor = cashRemaining >= 0 ? ROLE.saving : ROLE.over
  const remainingTint = cashRemaining >= 0 ? 'var(--finance-green-tint)' : 'var(--finance-red-tint)'
  return (
    <svg aria-label="이번 달 수입에서 고정비, 변동비, 저축 납입을 뺀 현금흐름" className="h-auto min-w-[500px] w-full" role="img" viewBox={`0 0 ${width} 220`}>
      <line stroke={ROLE.grid} x1="0" x2={width} y1={baseline} y2={baseline} />
      <rect fill={ROLE.income} height={incomeHeight} width={barWidth} x={xValues[0]} y={baseline - incomeHeight} />
      <text className="chart-value-label" fill={ROLE.ink} textAnchor="middle" x={xValues[0] + barWidth / 2} y={Math.max(baseline - incomeHeight - 7, 12)}>{formatWon(income)}</text>
      <text className="chart-axis-label" fill={ROLE.muted} textAnchor="middle" x={xValues[0] + barWidth / 2} y="190">수입</text>
      {placed.map((step) => {
        const height = Math.max(step.amount * scale, 1)
        const y = baseline - step.before * scale
        return (
          <g key={step.label}>
            <line stroke={ROLE.grid} strokeDasharray="3 2" x1={step.x - 36} x2={step.x} y1={y} y2={y} />
            <rect fill={step.color} height={height} width={barWidth} x={step.x} y={y} />
            <text className="chart-value-label" fill={ROLE.ink} textAnchor="middle" x={step.x + barWidth / 2} y={Math.max(y - 7, 12)}>−{formatWon(step.amount)}</text>
            <text className="chart-axis-label" fill={ROLE.muted} textAnchor="middle" x={step.x + barWidth / 2} y="190">{step.label}</text>
          </g>
        )
      })}
      <line stroke={ROLE.grid} strokeDasharray="3 2" x1={xValues[4] - 36} x2={xValues[4]} y1={baseline - running * scale} y2={baseline - running * scale} />
      <rect fill={remainingTint} height={finalHeight} width={barWidth} x={xValues[4]} y={cashRemaining >= 0 ? baseline - finalHeight : baseline} />
      <rect fill={remainingColor} height={finalHeight} width="3" x={xValues[4]} y={cashRemaining >= 0 ? baseline - finalHeight : baseline} />
      <text className="chart-value-label" fill={ROLE.ink} textAnchor="middle" x={xValues[4] + barWidth / 2} y={cashRemaining >= 0 ? Math.max(baseline - finalHeight - 7, 12) : baseline + finalHeight + 15}>{formatWon(cashRemaining)}</text>
      <text className="chart-axis-label" fill={ROLE.muted} textAnchor="middle" x={xValues[4] + barWidth / 2} y="190">계좌에 남음</text>
      <text className="chart-caption" fill={ROLE.faint} x="0" y="215">단위 원 · 순저축 = 저축 납입 + 계좌 잔여</text>
    </svg>
  )
}

export function SavingsRateChart({ data, target }: {
  data: Array<{ month: string; savingsRate: number; active: boolean }>
  target: number
}) {
  const active = data.filter((row) => row.active)
  if (active.length === 0) return <p className="py-14 text-center t-caption text-finance-muted">올해 수입·지출 기록이 없습니다.</p>
  const width = 440
  const height = 180
  const left = 24
  const right = 18
  const top = 22
  const bottom = 32
  const min = Math.min(0, target, ...active.map((row) => row.savingsRate))
  const max = Math.max(50, target, ...active.map((row) => row.savingsRate))
  const range = Math.max(max - min, 1)
  const y = (value: number) => top + ((max - value) / range) * (height - top - bottom)
  const x = (index: number) => left + (index * (width - left - right)) / Math.max(active.length - 1, 1)
  const points = active.map((row, index) => `${x(index)},${y(row.savingsRate)}`).join(' ')
  return (
    <svg aria-label="올해 월별 순저축률" className="h-auto min-w-[420px] w-full" role="img" viewBox={`0 0 ${width} ${height}`}>
      <line stroke={ROLE.saving} strokeDasharray="4 3" strokeWidth={REFERENCE_LINE_WIDTH} x1={left} x2={width - right} y1={y(target)} y2={y(target)} />
      <text className="chart-caption" fill={ROLE.saving} x={left} y={y(target) - 6}>목표 {formatRate(target)}%</text>
      <line stroke={ROLE.grid} x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      <polyline fill="none" points={points} stroke={ROLE.ink} strokeWidth={LINE_WIDTH} />
      {active.map((row, index) => {
        const last = index === active.length - 1
        return (
          <g key={row.month}>
            <circle
              cx={x(index)}
              cy={y(row.savingsRate)}
              fill={last ? ROLE.saving : 'var(--background)'}
              r={last ? POINT_RADIUS_ACTIVE : POINT_RADIUS}
              stroke={row.savingsRate >= target ? ROLE.saving : ROLE.ink}
              strokeWidth={REFERENCE_LINE_WIDTH}
            />
            <text className="chart-axis-label" fill={ROLE.faint} textAnchor="middle" x={x(index)} y={height - 10}>{Number(row.month.slice(5))}월</text>
          </g>
        )
      })}
    </svg>
  )
}
