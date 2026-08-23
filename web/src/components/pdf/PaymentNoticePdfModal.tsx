'use client'

import { useState, useEffect, useCallback } from 'react'
import { PrintModal } from './PrintModal'
import { PaymentNoticeDocument } from './PaymentNoticeDocument'
import { IssueButton } from './IssueButton'
import { fetchPaymentNoticePdfData, type PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import { issuePaymentNoticeDocument } from '@/app/_actions/document-actions'

export function PaymentNoticePdfModal({
  contractorId,
  yearMonth,
  contractorName,
  onClose,
  showSaveHint = false,
  canIssue = false,
}: {
  contractorId:   string
  yearMonth:      string
  contractorName: string
  onClose:        () => void
  /** ドライバー画面から開いたときに保存を促す一文を出す（確定申告の証憑用） */
  showSaveHint?:  boolean
  /** 確定発行ボタンを出す（管理者画面のみ true を渡す） */
  canIssue?:      boolean
}) {
  const [data, setData]   = useState<PaymentNoticePdfData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg]     = useState<string | null>(null)
  const [issuedNo, setIssuedNo] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchPaymentNoticePdfData(contractorId, yearMonth).then(res => {
      if (res.error) setError(res.error)
      else           setData(res.data)
    })
  }, [contractorId, yearMonth])

  useEffect(() => { load() }, [load])

  return (
    <PrintModal
      isOpen
      onClose={onClose}
      title={`支払通知書 — ${contractorName} ${yearMonth}`}
      actions={canIssue && data ? (
        <IssueButton
          label="支払通知書"
          alreadyIssued={false}
          issue={() => issuePaymentNoticeDocument(contractorId, yearMonth)}
          onIssued={doc => { setMsg(null); setIssuedNo(doc.documentNumber); load() }}
          onError={setMsg}
        />
      ) : null}
    >
      {msg && (
        <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-700 print:hidden">
          {msg}
        </p>
      )}
      {issuedNo && (
        <p className="mb-3 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-800 print:hidden">
          発行控えを保存しました（番号 {issuedNo}）。
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
