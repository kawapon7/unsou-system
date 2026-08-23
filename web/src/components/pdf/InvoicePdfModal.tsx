'use client'

import { useState, useEffect, useCallback } from 'react'
import { PrintModal } from './PrintModal'
import { InvoiceDocument } from './InvoiceDocument'
import { IssueButton } from './IssueButton'
import { fetchInvoicePdfData, type InvoicePdfData } from '@/app/_actions/pdf-actions'
import { issueInvoiceDocument } from '@/app/_actions/document-actions'

export function InvoicePdfModal({
  clientId,
  yearMonth,
  clientName,
  onClose,
  canIssue = false,
}: {
  clientId:   string
  yearMonth:  string
  clientName: string
  onClose:    () => void
  /** 確定発行ボタンを出す（管理者画面のみ true を渡す） */
  canIssue?:  boolean
}) {
  const [data, setData]   = useState<InvoicePdfData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg]     = useState<string | null>(null)

  const load = useCallback(() => {
    fetchInvoicePdfData(clientId, yearMonth).then(res => {
      if (res.error) setError(res.error)
      else           setData(res.data)
    })
  }, [clientId, yearMonth])

  useEffect(() => { load() }, [load])

  // 暫定番号は「(未発行)」で終わる（pdf-actions.ts 参照）。正式番号なら発行済み扱い
  const alreadyIssued = !!data && !data.invoiceNumber.endsWith('(未発行)')

  return (
    <PrintModal
      isOpen
      onClose={onClose}
      title={`請求書 — ${clientName} ${yearMonth}`}
      actions={canIssue && data ? (
        <IssueButton
          label="請求書"
          alreadyIssued={alreadyIssued}
          issue={() => issueInvoiceDocument(clientId, yearMonth)}
          onIssued={() => { setMsg(null); load() }}
          onError={setMsg}
        />
      ) : null}
    >
      {msg && (
        <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-700 print:hidden">
          {msg}
        </p>
      )}
      {error ? (
        <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
          <p className="text-red-600 text-sm">データ取得エラー: {error}</p>
        </div>
      ) : !data ? (
        <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
          <p className="text-zinc-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <InvoiceDocument data={data} />
      )}
    </PrintModal>
  )
}
