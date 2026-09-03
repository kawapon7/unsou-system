'use client'

import { useEffect, useRef } from 'react'
import { reportClientError } from '@/app/_actions/errorReportActions'

type Props = {
  error:   Error & { digest?: string }
  reset:   () => void
  segment: string
}

/** error.tsx / global-error.tsx 共通。マウント時に1回だけサーバーへ報告する。生メッセージは表示しない */
export default function ErrorFallback({ error, reset, segment }: Props) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    reportClientError({
      message: error?.message ?? '',
      digest:  error?.digest,
      path:    typeof window !== 'undefined' ? window.location.pathname : '',
      segment,
    }).catch(() => { /* 報告失敗は無視 */ })
  }, [error, segment])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">エラーが発生しました</p>
      <p className="text-sm text-gray-600">時間をおいて再度お試しください。続く場合は事務所へご連絡ください。</p>
      <button type="button" onClick={reset} className="rounded bg-gray-800 px-4 py-2 text-white">再読み込み</button>
    </div>
  )
}
