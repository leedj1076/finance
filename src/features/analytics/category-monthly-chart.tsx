'use client'

import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'

import { formatWon } from '@/lib/finance'

import type { CategoryMonthlyData } from './account-monthly'
import {
  CHART_HEIGHT,
  CHART_LINE_WIDTH,
  CHART_LINE_WIDTH_ACTIVE,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  alpha,
  resolveChartColor,
  useFinanceChartPalette,
} from './chart-js'
import { ChartLegendToggles } from './chart-primitives'
import { DIMMED_OPACITY, OTHER_SERIES_NAME, compactWon, seriesColor } from './chart-theme'

export function CategoryMonthlyChart({
  data,
  detailHref,
}: {
  data: CategoryMonthlyData
  detailHref?: (category: string) => string
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const palette = useFinanceChartPalette()

  function toggle(category: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
    setHovered(null)
  }

  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: Array.from({ length: 12 }, (_, month) => `${month + 1}월`),
    datasets: data.categories.flatMap((category, index) => {
      if (hidden.has(category)) return []
      const color = resolveChartColor(seriesColor(index, category), palette)
      const active = hovered === category
      const dimmed = hovered !== null && !active
      return [{
        label: category === OTHER_SERIES_NAME && data.folded?.length ? `${OTHER_SERIES_NAME} (${data.folded.join(', ')})` : category,
        data: data.series[category],
        borderColor: alpha(color, dimmed ? DIMMED_OPACITY : 1),
        backgroundColor: color,
        borderWidth: active ? CHART_LINE_WIDTH_ACTIVE : CHART_LINE_WIDTH,
        pointRadius: active ? CHART_POINT_RADIUS_ACTIVE : CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.22,
      }]
    }),
  }), [data, hidden, hovered, palette])
  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    interaction: { mode: 'nearest', intersect: false },
    onHover: (_event, elements) => setHovered(elements[0] ? data.categories.filter((name) => !hidden.has(name))[elements[0].datasetIndex] ?? null : null),
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: palette.ink,
        bodyColor: palette.background,
        titleColor: palette.background,
        titleFont: CHART_TOOLTIP_FONT,
        bodyFont: { ...CHART_TICK_FONT, size: 11 },
        padding: 11,
        callbacks: { label: (context: TooltipItem<'line'>) => `${context.dataset.label}: ${formatWon(Number(context.raw ?? 0))}원` },
      },
    },
    scales: {
      x: { border: { display: false }, grid: { display: false }, ticks: { color: palette.muted, font: CHART_TICK_FONT, maxRotation: 0 } },
      y: { beginAtZero: true, border: { display: false }, grid: { color: palette.track, drawTicks: false }, ticks: { color: palette.faint, font: CHART_TICK_FONT, maxTicksLimit: 4, padding: 8, callback: (value) => compactWon(Number(value)) } },
    },
  }), [data.categories, hidden, palette])

  return (
    <div>
      <ChartLegendToggles
        hidden={hidden}
        items={data.categories.map((category, index) => ({ name: category, color: seriesColor(index, category) }))}
        label="분류 범례"
        onHover={setHovered}
        onToggle={toggle}
        renderExtra={detailHref ? (category) => (
          <Link
            aria-label={`${category} 상세 보기`}
            className="px-1.5 py-1 t-badge text-finance-faint hover:bg-finance-blue-tint hover:text-finance-blue"
            href={detailHref(category)}
          >
            상세
          </Link>
        ) : undefined}
      />
      <div className="relative w-full" onMouseLeave={() => setHovered(null)} style={{ height: CHART_HEIGHT }}>
        <Line aria-label="분류별 월간 추이" data={chartData} options={options} role="img" />
      </div>
    </div>
  )
}
