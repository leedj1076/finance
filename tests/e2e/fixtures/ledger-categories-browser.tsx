import { createRoot } from 'react-dom/client'
import { LedgerCategoriesPanel } from '@/features/ledger/ledger-categories-panel'
import { LedgerFilterForm } from '@/features/ledger/ledger-filter-form'
import { parseLedgerFilters } from '@/features/ledger/filters'

const majors = ['식비', '주거', '교통', '자녀', '보험', '통신', '문화', '여행', '경조사']
const ranks = majors.map((major, index) => ({ major, amount: 46000 - index * 1000, count: 2, percent: 10,
  previous: 40000, delta: 6000 - index * 1000, changeRate: 15 }))
const transactions = [
  { id: 1, date: '2026-07-02', flow: 'expense' as const, fixed: false, sub: '카페', memo: '선택한 커피', merchant: '선택한 커피', amount: 12000, accountId: 12, accountName: 'DJ 카드' },
  { id: 2, date: '2026-07-01', flow: 'expense' as const, fixed: false, sub: '장보기', memo: '다른 장보기', merchant: '다른 장보기', amount: 34000, accountId: 12, accountName: 'DJ 카드' },
]
const detail = { percent: 46, transactions, subs: [
  { sub: '장보기', count: 1, amount: 34000 }, { sub: '카페', count: 1, amount: 12000 },
], merchants: [{ name: '커피 가맹점', count: 1, amount: 12000 }] }
const root = createRoot(document.getElementById('root')!)
function render() {
  const filters = parseLedgerFilters(Object.fromEntries(new URLSearchParams(location.search)))
  root.render(<main className="mx-auto max-w-[1680px] px-5 py-8 sm:px-12">
    <LedgerFilterForm accounts={[{ id: 12, name: 'DJ 카드' }]} filters={filters} key={location.search} majorOptions={majors} month="2026-07" tab="categories" />
    <LedgerCategoriesPanel data={{ month: '2026-07', flow: 'expense', ranks }} detail={filters.major ? detail : null} filters={filters} />
  </main>)
}
// Replace only Next's server navigation in this standalone browser; render the real components.
document.addEventListener('click', event => {
  const link = (event.target as Element).closest('a')
  if (!link) return
  event.preventDefault()
  history.pushState(null, '', link.href)
  render()
})
document.addEventListener('submit', event => {
  event.preventDefault()
  history.pushState(null, '', `/ledger?${new URLSearchParams(new FormData(event.target as HTMLFormElement) as never)}`)
  render()
})
window.addEventListener('popstate', render)
render()
