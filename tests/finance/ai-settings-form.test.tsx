import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

vi.mock('@/features/ai-settings/client', () => ({
  loadAiSettings: vi.fn(), submitAiSettings: vi.fn(), requestAiPromptPreview: vi.fn(), loadAiJobPrompt: vi.fn(),
}))

import { AiSettingsForm } from '@/features/ai-settings/settings-form'
import { AiPromptViewer } from '@/features/ai-settings/prompt-viewer'
import type { AiSettingsPageData, AiPromptPreview } from '@/features/ai-settings/types'

const initial: AiSettingsPageData = {
  settings: { commonInstructions: null, ledgerInstructions: '', budgetInstructions: '예산 사용자 지정', revision: 4, updatedAt: '2026-09-10T00:00:00.000Z' },
  defaults: { commonInstructions: '공통 기본값', ledgerInstructions: '내역 기본값', budgetInstructions: '예산 기본값' },
  workers: [{ id: 'worker-1', label: '거실 Mac', lastSeenAt: '2026-09-10T00:00:00.000Z', state: 'ready', promptProtocolVersion: 1, budgetProtocolVersion: 1, configuredModel: null, timeoutMs: 180_000 }],
  budgetPreviewAvailable: true,
}

test('renders three labeled instruction editors with explicit default, custom-empty and restore states', () => {
  const html = renderToStaticMarkup(<AiSettingsForm initial={initial} />)
  for (const label of ['공통 분석 지침', '내역 진단 지침', '예산 추천 지침']) expect(html).toContain(label)
  expect(html).toContain('공통 기본값')
  expect(html).toMatch(/id="ai-ledgerInstructions"[^>]*><\/textarea>/)
  expect(html).toContain('기본값 사용')
  expect(html).toContain('사용자 지정')
  expect((html.match(/기본값 복원/g) ?? [])).toHaveLength(3)
  expect(html).toContain('프롬프트 미리보기')
  expect(html).toContain('type="button"')
  expect(html).toContain('AI 설정 저장')
})

test('execution details are read-only and never render editable model or timeout controls', () => {
  const html = renderToStaticMarkup(<AiSettingsForm initial={initial} />)
  expect(html).toContain('거실 Mac')
  expect(html).toContain('CLI 기본값')
  expect(html).toContain('180초')
  expect(html).toContain('내역 지침 지원')
  expect(html).toContain('예산 지원')
  expect(html).not.toMatch(/<input[^>]+(?:model|모델|timeout|타임아웃)/i)
  expect(html).not.toMatch(/<textarea[^>]+(?:model|모델|timeout|타임아웃)/i)
  expect(html).not.toContain('tokenHash')
})

test('prompt viewer renders immutable plain text and keeps analysis data collapsed', () => {
  const preview: AiPromptPreview = {
    kind: 'ledger', month: '2026-07', prefix: '<fixed><script>alert(1)</script>', dataJson: '{"merchant":"[link](javascript:bad)"}', suffix: '</fixed>', promptHash: 'a'.repeat(64),
    instructions: { kind: 'ledger', settingsRevision: 4, defaultsVersion: 'v1', common: '공통', task: '내역', commonSource: 'custom', taskSource: 'custom' },
    generatedAt: '2026-09-10T00:00:00.000Z', unsaved: true,
  }
  const html = renderToStaticMarkup(<AiPromptViewer view={{ state: 'preview', preview }} />)
  expect(html).toContain('미저장 편집안 기준')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('<details')
  expect(html).not.toContain('<details open')
  expect(html).toContain('분석 데이터 JSON')
  expect(html).toContain('이후 거래나 설정이 바뀌면 실제 요청 내용이 달라질 수 있습니다.')
})

test('legacy job prompt is identified as unrecorded without reconstructing current text', () => {
  const html = renderToStaticMarkup(<AiPromptViewer view={{ state: 'unrecorded', kind: 'ledger', month: '2026-07' }} />)
  expect(html).toContain('이전 결과 · 사용한 프롬프트 미기록')
  expect(html).not.toContain('공통 기본값')
})
