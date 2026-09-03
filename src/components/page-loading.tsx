export function PageLoading({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="h-14 border-b border-finance-ink bg-white" />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12" role="status" aria-label={`${title} 불러오는 중`}>
        <div className="h-3 w-24 animate-pulse bg-finance-track" />
        <div className="mt-3 h-8 w-44 animate-pulse bg-finance-track" />
        <div className="mt-8 grid border-y border-finance-ink sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div className="h-28 animate-pulse bg-white p-5" key={i}>
              <div className="h-3 w-20 bg-finance-track" />
              <div className="mt-4 h-6 w-32 bg-finance-track" />
            </div>
          ))}
        </div>
        <div className="mt-6 h-72 animate-pulse border-y border-finance-hairline bg-finance-panel" />
        <span className="sr-only">{title} 데이터를 불러오는 중입니다</span>
      </main>
    </div>
  )
}
