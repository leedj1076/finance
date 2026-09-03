'use client'

import { formatRate, formatWon } from '@/lib/finance'

import {
  BOTTOM,
  ChartFrame,
  Grid,
  HEIGHT,
  LEFT,
  LINE_WIDTH,
  POINT_RADIUS,
  POINT_RADIUS_ACTIVE,
  REFERENCE_LINE_WIDTH,
  RIGHT,
  ROLE,
  TOP,
  plotWidthFor,
  xAt,
} from './chart-primitives'

// Trend charts for the home screen and the annual page. Same frame, same
// axes, same marks as the interactive charts; no hover layer because they
// are read at a glance.

export function SavingsRateChart({ data, target }: {
  data: Array<{ month: string; savingsRate: number; active: boolean }>
  target: number
}) {
  const active = data.filter((row) => row.active)
  if (active.length === 0) return <p className="py-14 text-center t-caption text-finance-muted">올해 수입·지출 기록이 없습니다.</p>
  const min = Math.min(0, target, ...active.map((row) => row.savingsRate))
  const max = Math.max(50, target, ...active.map((row) => row.savingsRate))
  const range = Math.max(max - min, 1)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const y = (value: number) => TOP + ((max - value) / range) * plotHeight
  const months = active.map((row) => `${Number(row.month.slice(5))}월`)

  return (
    <ChartFrame>
      {(width) => {
        const x = (index: number) => xAt(index, active.length, width)
        const points = active.map((row, index) => `${x(index)},${y(row.savingsRate)}`).join(' ')
        return (
          <svg aria-label="올해 월별 순저축률" height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
            <Grid formatValue={(value) => `${value}%`} maxValue={max} minValue={min} months={months} width={width} />
            <line stroke={ROLE.saving} strokeDasharray="4 3" strokeWidth={REFERENCE_LINE_WIDTH} x1={LEFT} x2={width - RIGHT} y1={y(target)} y2={y(target)} />
            <text className="chart-caption" fill={ROLE.saving} textAnchor="end" x={width - RIGHT} y={y(target) - 6}>목표 {formatRate(target)}%</text>
            <polyline fill="none" points={points} stroke={ROLE.ink} strokeWidth={LINE_WIDTH} />
            {active.map((row, index) => {
              const last = index === active.length - 1
              return (
                <circle
                  cx={x(index)}
                  cy={y(row.savingsRate)}
                  fill={last ? ROLE.saving : 'var(--background)'}
                  key={row.month}
                  r={last ? POINT_RADIUS_ACTIVE : POINT_RADIUS}
                  stroke={row.savingsRate >= target ? ROLE.saving : ROLE.ink}
                  strokeWidth={REFERENCE_LINE_WIDTH}
                />
              )
            })}
          </svg>
        )
      }}
    </ChartFrame>
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
  const plotHeight = HEIGHT - TOP - BOTTOM
  const baseline = TOP + plotHeight
  const maxValue = Math.max(income, fixedExpense + variableExpense + saving, Math.abs(cashRemaining), 1)
  const scale = plotHeight / maxValue
  const steps = [
    { amount: fixedExpense, label: '고정비', color: ROLE.expense },
    { amount: variableExpense, label: '변동비', color: ROLE.muted },
    { amount: saving, label: '저축 납입', color: ROLE.saving },
  ]
  let running = income
  const placed = steps.map((step) => {
    const before = running
    running -= step.amount
    return { ...step, before }
  })
  const remainingColor = cashRemaining >= 0 ? ROLE.saving : ROLE.over
  const remainingTint = cashRemaining >= 0 ? 'var(--finance-green-tint)' : 'var(--finance-red-tint)'
  const incomeHeight = Math.max(income * scale, 1)
  const finalHeight = Math.max(Math.abs(cashRemaining) * scale, 1)
  const columns = ['수입', ...steps.map((step) => step.label), '계좌에 남음']

  return (
    <div>
      <ChartFrame>
        {(width) => {
          const step = plotWidthFor(width) / columns.length
          const barWidth = Math.min(62, step * 0.55)
          const columnX = (index: number) => LEFT + step * index + (step - barWidth) / 2
          const labelX = (index: number) => LEFT + step * index + step / 2
          return (
            <svg aria-label="이번 달 수입에서 고정비, 변동비, 저축 납입을 뺀 현금흐름" height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
              <line stroke={ROLE.grid} x1={LEFT} x2={width - RIGHT} y1={baseline} y2={baseline} />
              <rect fill={ROLE.income} height={incomeHeight} width={barWidth} x={columnX(0)} y={baseline - incomeHeight} />
              <text className="chart-value-label" fill={ROLE.ink} textAnchor="middle" x={labelX(0)} y={Math.max(baseline - incomeHeight - 7, 12)}>{formatWon(income)}</text>
              {placed.map((item, index) => {
                const barHeight = Math.max(item.amount * scale, 1)
                const y = baseline - item.before * scale
                const x = columnX(index + 1)
                return (
                  <g key={item.label}>
                    <line stroke={ROLE.grid} strokeDasharray="3 2" x1={columnX(index) + barWidth} x2={x} y1={y} y2={y} />
                    <rect fill={item.color} height={barHeight} width={barWidth} x={x} y={y} />
                    <text className="chart-value-label" fill={ROLE.ink} textAnchor="middle" x={labelX(index + 1)} y={Math.max(y - 7, 12)}>−{formatWon(item.amount)}</text>
                  </g>
                )
              })}
              <line stroke={ROLE.grid} strokeDasharray="3 2" x1={columnX(3) + barWidth} x2={columnX(4)} y1={baseline - running * scale} y2={baseline - running * scale} />
              <rect fill={remainingTint} height={finalHeight} width={barWidth} x={columnX(4)} y={cashRemaining >= 0 ? baseline - finalHeight : baseline} />
              <rect fill={remainingColor} height={finalHeight} width="3" x={columnX(4)} y={cashRemaining >= 0 ? baseline - finalHeight : baseline} />
              <text className="chart-value-label" fill={ROLE.ink} textAnchor="middle" x={labelX(4)} y={cashRemaining >= 0 ? Math.max(baseline - finalHeight - 7, 12) : Math.min(baseline + finalHeight + 15, HEIGHT - 20)}>{formatWon(cashRemaining)}</text>
              {columns.map((label, index) => (
                <text className="chart-axis-label" fill={ROLE.muted} key={label} textAnchor="middle" x={labelX(index)} y={HEIGHT - 12}>{label}</text>
              ))}
            </svg>
          )
        }}
      </ChartFrame>
      <p className="mt-2 t-caption text-finance-faint">단위 원 · 순저축 = 저축 납입 + 계좌 잔여</p>
    </div>
  )
}
