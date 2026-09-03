import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <section className="border-t border-finance-ink py-8">
          <p className="t-label uppercase text-finance-blue">404</p>
          <h1 className="mt-2 t-page-title text-finance-ink">페이지를 찾을 수 없습니다</h1>
          <p className="mt-3 t-body text-finance-muted">
            주소가 바뀌었거나 없는 페이지입니다.
          </p>
          <div className="mt-6">
            <Link
              className="inline-flex h-[34px] items-center bg-finance-ink px-4 t-body-strong text-white hover:opacity-80"
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
