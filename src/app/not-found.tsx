import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-950">페이지를 찾을 수 없습니다</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            주소가 바뀌었거나 없는 페이지입니다.
          </p>
          <div className="mt-6">
            <Link
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              href="/ledger"
            >
              가계부로 이동
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
