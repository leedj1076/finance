export function PageLoading({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="h-[54px] border-b border-zinc-200 bg-white" />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8" role="status" aria-label={`${title} 불러오는 중`}>
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="mt-3 h-8 w-44 animate-pulse rounded bg-zinc-200" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div className="h-28 animate-pulse rounded-2xl border border-zinc-200 bg-white p-5" key={i}>
              <div className="h-3 w-20 rounded bg-zinc-100" />
              <div className="mt-4 h-6 w-32 rounded bg-zinc-100" />
            </div>
          ))}
        </div>
        <div className="mt-6 h-72 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
        <span className="sr-only">{title} 데이터를 불러오는 중입니다</span>
      </main>
    </div>
  )
}
