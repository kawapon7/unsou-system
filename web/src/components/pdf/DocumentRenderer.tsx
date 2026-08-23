'use client'
import { InvoiceDocument } from './InvoiceDocument'
import { PaymentNoticeDocument } from './PaymentNoticeDocument'
import { OobaInvoiceDocument } from './formats/ooba/OobaInvoiceDocument'
import { OobaPaymentNoticeDocument } from './formats/ooba/OobaPaymentNoticeDocument'
import type { InvoicePdfData, PaymentNoticePdfData } from '@/app/_actions/pdf-actions'

type Props =
  | { kind: 'invoice';        formatKey: string; formatVersion: number; data: InvoicePdfData }
  | { kind: 'payment_notice'; formatKey: string; formatVersion: number; data: PaymentNoticePdfData }

/**
 * format_key × format_version × kind で描画コンポーネントを選ぶ唯一の場所。
 * ⚠️ 様式の版を上げたら旧版の分岐を消さない（発行済み控えはその版で再表示する）。
 */
export function DocumentRenderer(p: Props) {
  const id = `${p.formatKey}@${p.formatVersion}`
  if (id === 'standard@1') return p.kind === 'invoice' ? <InvoiceDocument data={p.data} /> : <PaymentNoticeDocument data={p.data} />
  if (id === 'ooba@1')     return p.kind === 'invoice' ? <OobaInvoiceDocument data={p.data} /> : <OobaPaymentNoticeDocument data={p.data} />
  return (
    <div className="a4-page w-[794px] bg-white p-12 flex items-center justify-center">
      <p className="text-red-600 text-sm">未対応の様式です: {p.formatKey} v{p.formatVersion}</p>
    </div>
  )
}
