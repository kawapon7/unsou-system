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
  showSaveHint = false,
}: {
  contractorId:   string
  yearMonth:      string
  contractorName: string
  onClose:        () => void
  /** ドライバー画面から開いたときに保存を促す一文を出す（確定申告の証憑用） */
  showSaveHint?:  boolean
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
        <>
          {/* ⚠️ PDFは都度生成でDBに保存しない（HANDOVER §2-2）。単価や自社情報を
              後から変えると過去分の見た目が変わり得るため、証憑として残すには
              ドライバー自身の保存が要る。印刷ボタンの近くで明示する。 */}
          {showSaveHint && (
            <p className="mb-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs text-blue-800 print:hidden">
              確定申告で使う場合は、この画面から「印刷・PDF保存」でご自身の端末に保存してください。
            </p>
          )}
          <PaymentNoticeDocument data={data} />
        </>
      )}
    </PrintModal>
  )
}
