'use client'

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { useEffect, useState } from 'react'

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
)

export const CHART_HEIGHT = 250
export const CHART_TICK_FONT = { size: 10, weight: 500 as const }
export const CHART_TOOLTIP_FONT = { size: 12, weight: 600 as const }
export const CHART_LINE_WIDTH = 1.75
export const CHART_LINE_WIDTH_ACTIVE = 2.25
export const CHART_POINT_RADIUS = 2.5
export const CHART_POINT_RADIUS_ACTIVE = 4

export type FinanceChartPalette = {
  background: string
  ink: string
  muted: string
  faint: string
  border: string
  track: string
  blue: string
  red: string
  green: string
  amber: string
  series: string[]
  other: string
}

const FALLBACK_PALETTE: FinanceChartPalette = {
  background: '#ffffff',
  ink: '#18181b',
  muted: '#71717a',
  faint: '#a1a1aa',
  border: '#e4e4e7',
  track: '#f4f4f5',
  blue: '#2563eb',
  red: '#dc2626',
  green: '#16a34a',
  amber: '#d97706',
  series: [
    '#2563eb', '#d97706', '#0d9488', '#be123c', '#7c3aed', '#4d7c0f',
    '#0891b2', '#ea580c', '#4f46e5', '#059669', '#c026d3', '#92400e',
    '#0284c7', '#db2777', '#9333ea', '#65a30d', '#475569', '#ca8a04',
  ],
  other: '#a1a1aa',
}

function cssColor(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback
}

function readPalette(): FinanceChartPalette {
  if (typeof document === 'undefined') return FALLBACK_PALETTE
  const styles = getComputedStyle(document.documentElement)
  return {
    background: cssColor(styles, '--background', FALLBACK_PALETTE.background),
    ink: cssColor(styles, '--finance-ink', FALLBACK_PALETTE.ink),
    muted: cssColor(styles, '--finance-muted', FALLBACK_PALETTE.muted),
    faint: cssColor(styles, '--finance-faint', FALLBACK_PALETTE.faint),
    border: cssColor(styles, '--finance-border', FALLBACK_PALETTE.border),
    track: cssColor(styles, '--finance-track', FALLBACK_PALETTE.track),
    blue: cssColor(styles, '--finance-blue', FALLBACK_PALETTE.blue),
    red: cssColor(styles, '--finance-red', FALLBACK_PALETTE.red),
    green: cssColor(styles, '--finance-green', FALLBACK_PALETTE.green),
    amber: cssColor(styles, '--finance-amber', FALLBACK_PALETTE.amber),
    series: FALLBACK_PALETTE.series.map((fallback, index) => cssColor(styles, `--chart-${index + 1}`, fallback)),
    other: cssColor(styles, '--chart-other', FALLBACK_PALETTE.other),
  }
}

export function useFinanceChartPalette() {
  const [palette, setPalette] = useState(FALLBACK_PALETTE)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      ChartJS.defaults.font.family = getComputedStyle(document.body).fontFamily
      setPalette(readPalette())
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return palette
}

export function alpha(color: string, opacity: number) {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!match) return color
  return `rgba(${Number.parseInt(match[1], 16)}, ${Number.parseInt(match[2], 16)}, ${Number.parseInt(match[3], 16)}, ${opacity})`
}

export function resolveChartColor(color: string, palette: FinanceChartPalette) {
  const seriesMatch = color.match(/^var\(--chart-(\d+)\)$/)
  if (seriesMatch) return palette.series[Number(seriesMatch[1]) - 1] ?? palette.other
  if (color === 'var(--chart-other)') return palette.other
  const roles: Record<string, string> = {
    'var(--background)': palette.background,
    'var(--finance-ink)': palette.ink,
    'var(--finance-muted)': palette.muted,
    'var(--finance-faint)': palette.faint,
    'var(--finance-border)': palette.border,
    'var(--finance-track)': palette.track,
    'var(--finance-blue)': palette.blue,
    'var(--finance-red)': palette.red,
    'var(--finance-green)': palette.green,
    'var(--finance-amber)': palette.amber,
  }
  return roles[color] ?? color
}
