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
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <section className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-950">문제가 생겼습니다</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            페이지를 그리는 중에 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
            반복되면 새로고침하거나 다시 로그인해 주세요.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-zinc-400">오류 코드: {error.digest}</p>
          )}
          <div className="mt-6 flex gap-2">
            <button
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              onClick={reset}
              type="button"
            >
              다시 시도
            </button>
            <a
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
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
