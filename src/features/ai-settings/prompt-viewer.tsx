import type { AiJobPromptView, AiPromptPreview } from './types'

function dateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

export function AiPromptViewer({ view }: { view: AiJobPromptView | { state: 'preview'; preview: AiPromptPreview } }) {
  if (view.state === 'unrecorded') {
    return (
      <div className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 text-[12px] leading-7 text-finance-ink">
        <strong className="font-semibold">이전 결과 · 사용한 프롬프트 미기록</strong>
        <p className="text-finance-muted">당시 입력이 저장되지 않은 작업이라 현재 설정으로 대신 만들지 않습니다.</p>
      </div>
    )
  }
  const preview = view.preview
  return (
    <div className="min-w-0 border-t border-finance-ink pt-5 text-finance-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] text-finance-violet">{view.state === 'preview' ? 'PROMPT PREVIEW' : 'RECORDED PROMPT'}</p>
          <h3 className="mt-1 text-[16px] font-bold">{preview.month} {preview.kind === 'ledger' ? '내역 진단' : '예산 추천'} 프롬프트</h3>
        </div>
        <span className="bg-finance-violet-tint px-2 py-1 text-[10px] font-semibold text-finance-violet">
          {preview.unsaved ? '미저장' : '요청 당시 기록'}
        </span>
      </div>
      {preview.unsaved && <p className="mt-3 text-[12px] leading-6 text-finance-muted">미저장 편집안 기준 · 진단 요청에는 저장된 설정이 사용됩니다.</p>}
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="min-w-0 border border-finance-hairline p-4" aria-labelledby={`prompt-prefix-${preview.promptHash}`}>
          <h4 className="text-[12px] font-semibold" id={`prompt-prefix-${preview.promptHash}`}>고정 계약과 분석 지침</h4>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-6 text-finance-muted">{preview.prefix}</pre>
        </section>
        <section className="min-w-0 border border-finance-hairline p-4" aria-labelledby={`prompt-suffix-${preview.promptHash}`}>
          <h4 className="text-[12px] font-semibold" id={`prompt-suffix-${preview.promptHash}`}>고정 출력 계약</h4>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-6 text-finance-muted">{preview.suffix}</pre>
        </section>
      </div>
      <details className="mt-4 border-y border-finance-hairline">
        <summary className="cursor-pointer py-4 text-[12px] font-semibold">분석 데이터 JSON <span className="text-finance-muted">(펼쳐 보기)</span></summary>
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words border-t border-finance-hairline py-4 font-mono text-[11px] leading-6 text-finance-muted">{preview.dataJson}</pre>
      </details>
      <dl className="mt-3 grid min-w-0 gap-1 text-[10px] leading-5 text-finance-muted sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
        <dt>생성 시각</dt><dd>{dateTime(preview.generatedAt)}</dd>
        <dt>SHA-256</dt><dd className="break-all font-mono">{preview.promptHash}</dd>
      </dl>
      <p className="mt-3 text-[11px] leading-6 text-finance-muted">이후 거래나 설정이 바뀌면 실제 요청 내용이 달라질 수 있습니다.</p>
    </div>
  )
}
