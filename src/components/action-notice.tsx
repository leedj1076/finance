'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const AUTO_DISMISS_MS = 6000

/**
 * 서버 액션이 redirect(`?notice=...` / `?error=...`)로 전달한 결과를
 * 화면 하단 토스트로 보여주고, URL에서 해당 파라미터를 지워
 * 새로고침 시 같은 메시지가 다시 뜨지 않게 한다.
 */
export function ActionNotice({ notice, error }: { notice?: string; error?: string }) {
  const message = error ?? notice
  const isError = Boolean(error)
  const [visible, setVisible] = useState(Boolean(message))
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!message) return
    setVisible(true)
    const params = new URLSearchParams(searchParams.toString())
    if (params.has('notice') || params.has('error') || params.has('saved')) {
      params.delete('notice')
      params.delete('error')
      params.delete('saved')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message])

  if (!message || !visible) return null

  return (
    <div
      className={`fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-3 border-l-2 px-4 py-3 text-[13px] shadow-lg ${
        isError
          ? 'border-finance-red bg-finance-red-tint text-finance-red'
          : 'border-finance-green bg-finance-green-tint text-finance-green'
      }`}
      role={isError ? 'alert' : 'status'}
    >
      <span>{message}</span>
      <button
        aria-label="알림 닫기"
        className="shrink-0 p-1 leading-none opacity-60 hover:opacity-100"
        onClick={() => setVisible(false)}
        type="button"
      >
        ✕
      </button>
    </div>
  )
}
