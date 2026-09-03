'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <section className="border-t border-finance-red py-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-red">오류</p>
          <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">문제가 생겼습니다</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            페이지를 그리는 중에 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
            반복되면 새로고침하거나 다시 로그인해 주세요.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-zinc-400">오류 코드: {error.digest}</p>
          )}
          <div className="mt-6 flex gap-2">
            <button
              className="h-[34px] bg-finance-ink px-4 text-xs font-semibold text-white hover:opacity-80"
              onClick={reset}
              type="button"
            >
              다시 시도
            </button>
            <a
              className="inline-flex h-[34px] items-center border border-finance-hairline bg-white px-4 text-xs font-semibold text-finance-ink hover:bg-finance-panel"
              href="/ledger"
            >
              가계부로 이동
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}
