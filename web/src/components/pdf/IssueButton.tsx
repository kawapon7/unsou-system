'use client'

import { useState } from 'react'
import type { IssuedDocumentSummary } from '@/utils/document-search'

/**
 * 確定発行ボタン（PrintModal の actions に置く）。
 * 採番して発行控え（issued_documents）を保存する。発行後は onIssued で呼び出し元が再取得する。
 * ⚠️ 管理者画面からのみ描画すること（Server Action 側でも requireOwner で守っている）。
 */
export function IssueButton({
  label,
  alreadyIssued,
  issue,
  onIssued,
  onError,
}: {
  label:         string
  /** 読み込んだデータが既に正式番号付き（発行済み）なら true */
  alreadyIssued: boolean
  issue:         () => Promise<{ data: IssuedDocumentSummary | null; error: string | null }>
  onIssued:      (doc: IssuedDocumentSummary) => void
  onError:       (msg: string) => void
}) {
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued]   = useState<IssuedDocumentSummary | null>(null)

  const done = alreadyIssued || !!issued
  return (
    <button
      type="button"
      disabled={issuing || done}
      onClick={async () => {
        if (!confirm(`この内容で${label}を確定発行し、番号を採番して控えを保存します。よろしいですか？`)) return
        setIssuing(true)
        const res = await issue()
        setIssuing(false)
        if (res.error || !res.data) { onError(res.error ?? '発行に失敗しました'); return }
        setIssued(res.data)
        onIssued(res.data)
      }}
      className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-600 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition"
    >
      {issued ? `発行済 ${issued.documentNumber}` : done ? '発行済' : issuing ? '発行中...' : '確定発行（控え保存）'}
    </button>
  )
}
