'use client'

import { useState, useEffect } from 'react'
import { PrintModal } from './PrintModal'
import { InvoiceDocument } from './InvoiceDocument'
import { PaymentNoticeDocument } from './PaymentNoticeDocument'
import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'
import { getIssuedDocument } from '@/app/_actions/document-actions'
import type { IssuedDocumentDetail } from '@/utils/document-search'

/**
 * 発行控えを「発行当時の様式・版」で再表示する。
 * ⚠️ 様式が増えたら format_key × format_version で分岐を足す。旧版の描画を消さない（要件 §5 様式の版管理）。
 */
function renderSnapshot(d: IssuedDocumentDetail) {
  if (d.formatKey === 'standard' && d.formatVersion === 1) {
    return d.kind === 'invoice'
      ? <InvoiceDocument data={d.snapshot as InvoicePdfData} />
      : <PaymentNoticeDocument data={d.snapshot as PaymentNoticePdfData} />
  }
  return (
    <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
      <p className="text-red-600 text-sm">未対応の様式です: {d.formatKey} v{d.formatVersion}</p>
    </div>
  )
}

export function IssuedDocumentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [doc, setDoc]     = useState<IssuedDocumentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getIssuedDocument(id).then(res => {
      if (res.error) setError(res.error)
      else           setDoc(res.data)
    })
  }, [id])

  const kindLabel = doc?.kind === 'invoice' ? '請求書' : '支払通知書'
  return (
    <PrintModal
      isOpen
      onClose={onClose}
      title={doc ? `${kindLabel}控え ${doc.documentNumber} — ${doc.partyName}` : '発行控え'}
    >
      {error ? (
        <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
          <p className="text-red-600 text-sm">データ取得エラー: {error}</p>
        </div>
      ) : !doc ? (
        <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
          <p className="text-zinc-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <>
          {/* 取消済みは印刷時にも帯を残す（再印刷して誤って使うのを防ぐ） */}
          {doc.status === 'cancelled' && (
            <p className="mb-3 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white print:rounded-none">
              取消済（{doc.cancelledAt?.slice(0, 10)}）: {doc.cancelReason}
            </p>
          )}
          {renderSnapshot(doc)}
        </>
      )}
    </PrintModal>
  )
}
