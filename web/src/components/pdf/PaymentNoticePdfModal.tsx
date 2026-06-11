'use client'

import { useState, useEffect } from 'react'
import { PrintModal } from './PrintModal'
import { PaymentNoticeDocument } from './PaymentNoticeDocument'
import { fetchPaymentNoticePdfData, type PaymentNoticePdfData } from '@/app/_actions/pdf-actions'

export function PaymentNoticePdfModal({
  contractorId,
  yearMonth,
  contractorName,
  onClose,
}: {
  contractorId:   string
  yearMonth:      string
  contractorName: string
  onClose:        () => void
}) {
  const [data, setData]   = useState<PaymentNoticePdfData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPaymentNoticePdfData(contractorId, yearMonth).then(res => {
      if (res.error) setError(res.error)
      else           setData(res.data)
    })
  }, [contractorId, yearMonth])

  return (
    <PrintModal
      isOpen
      onClose={onClose}
      title={`支払通知書 — ${contractorName} ${yearMonth}`}
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
        <PaymentNoticeDocument data={data} />
      )}
    </PrintModal>
  )
}
