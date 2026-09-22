import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LedgerTransactionsTable } from '@/features/ledger/ledger-transactions-table'

const rows = [
  { id: 1, date: '2026-09-23', flow: 'expense' as const, fixed: false, categoryId: 1, major: '식비', sub: '식자재', memo: '동네 마트에서 주말 장보기와 생활용품 함께 구매', rawMerchant: '동네 마트', amount: 32000, accountId: 12, account: 'DJ 네이버 현대카드' },
  { id: 2, date: '2026-09-22', flow: 'expense' as const, fixed: false, categoryId: null, major: null, sub: null, memo: null, rawMerchant: '취소된 결제', amount: -8500, accountId: null, account: null },
  { id: 3, date: '2026-09-21', flow: 'income' as const, fixed: false, categoryId: 2, major: '급여', sub: '급여', memo: '급여', rawMerchant: null, amount: 123456789, accountId: 12, account: 'DJ 네이버 현대카드' },
  { id: 4, date: '2026-09-20', flow: 'saving' as const, fixed: false, categoryId: 3, major: '투자', sub: '적금', memo: '적금', rawMerchant: null, amount: 500000, accountId: 12, account: 'DJ 네이버 현대카드' },
]

function Harness() {
  const [empty, setEmpty] = useState(false)
  return <main className="mx-auto max-w-[1680px] px-5 py-8 sm:px-12">
    <h1 className="mb-4 t-section">거래 내역</h1>
    <LedgerTransactionsTable
      accounts={[{ id: 12, name: 'DJ 네이버 현대카드' }]}
      categories={[{ id: 1, kind: 'expense', major: '식비', sub: '식자재' }, { id: 2, kind: 'income', major: '급여', sub: '급여' }, { id: 3, kind: 'saving', major: '투자', sub: '적금' }]}
      filters={{ account: '12', flow: '', major: '식비', sub: '식자재', q: '검색', sort: 'amount-desc' }}
      month="2026-09" rows={empty ? [] : rows}
    />
    <button className="mt-4" onClick={() => setEmpty(true)}>빈 결과 보기</button>
  </main>
}

createRoot(document.getElementById('root')!).render(<Harness />)
