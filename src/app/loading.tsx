export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="min-h-screen bg-zinc-50">
      <div className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-emerald-100">
        <div className="h-full w-2/3 animate-pulse rounded-r-full bg-emerald-600" />
      </div>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 sm:px-8">
          <div className="h-5 w-28 animate-pulse rounded bg-zinc-200" />
          <div className="flex gap-2 overflow-hidden">
            {[72, 60, 60, 72, 60, 60].map((width, index) => (
              <div
                className="h-10 shrink-0 animate-pulse rounded-lg bg-zinc-100"
                key={index}
                style={{ width }}
              />
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <p className="text-sm font-medium text-emerald-700">가계부 불러오는 중…</p>
        <div className="mt-3 h-9 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div className="h-32 animate-pulse rounded-2xl border border-zinc-200 bg-white" key={item} />
          ))}
        </div>
        <div className="mt-6 h-80 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
      </main>
    </div>
  )
}
