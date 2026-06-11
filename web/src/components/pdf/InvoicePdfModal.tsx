'use client'

import { useState, useEffect } from 'react'
import { PrintModal } from './PrintModal'
import { InvoiceDocument } from './InvoiceDocument'
import { fetchInvoicePdfData, type InvoicePdfData } from '@/app/_actions/pdf-actions'

export function InvoicePdfModal({
  clientId,
  yearMonth,
  clientName,
  onClose,
}: {
  clientId:   string
  yearMonth:  string
  clientName: string
  onClose:    () => void
}) {
  const [data, setData]   = useState<InvoicePdfData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchInvoicePdfData(clientId, yearMonth).then(res => {
      if (res.error) setError(res.error)
      else           setData(res.data)
    })
  }, [clientId, yearMonth])

  return (
    <PrintModal
      isOpen
      onClose={onClose}
      title={`請求書 — ${clientName} ${yearMonth}`}
    >
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
