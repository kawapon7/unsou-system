import type { PaymentNoticePdfData } from '@/app/_actions/pdf-actions'

// 自社情報（環境変数でオーバーライド可能）
const COMPANY = {
  name:   process.env.NEXT_PUBLIC_COMPANY_NAME ?? '○○運送有限会社',
  phone:  process.env.NEXT_PUBLIC_COMPANY_PHONE ?? '000-0000-0000',
}

function yen(n: number) {
  return `¥${n.toLocaleString('ja-JP')}`
}

function fmtDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  toll:       '高速・有料道路代',
  parking:    '駐車場代',
  fuel:       '燃料代・ガソリン代',
  other:      'その他立替経費',
}

export function PaymentNoticeDocument({ data }: { data: PaymentNoticePdfData }) {
  const isUnregistered = data.invoiceRegistration === 'unregistered'
  const deductPct = Math.round(data.deductionRate * 100)

  return (
    <div className="a4-page w-[794px] min-h-[1122px] bg-white shadow-xl print:shadow-none p-12 font-sans text-zinc-900 text-sm">

      {/* ── ヘッダー ──────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-widest text-zinc-800 mb-6">支 払 通 知 書</h1>
          <p className="text-base font-bold text-zinc-900">{data.contractorName} 様</p>
          <p className="text-xs text-zinc-500 mt-1">
            対象: {data.noticeMonth}
            インボイス: {isUnregistered ? '未登録（経過措置適用）' : '登録事業者'}
          </p>
        </div>
        <div className="text-right text-xs text-zinc-600 space-y-0.5">
          <p className="text-sm font-bold text-zinc-900">{COMPANY.name}</p>
          <p>発行日: {fmtDate(data.issueDate)}</p>
          <p>TEL: {COMPANY.phone}</p>
        </div>
      </div>

      {/* ── 最終支払額ハイライト ─────────────────────────── */}
      <div className="border-2 border-zinc-900 rounded-lg px-6 py-4 mb-6 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600">差引支払額（今月お支払い予定額）</span>
        <span className="text-2xl font-bold tabular-nums text-zinc-900">{yen(data.totalAmount)}</span>
      </div>

      {/* ── 労務報酬明細 ─────────────────────────────────── */}
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
        【 労 務 報 酬 】
      </h2>
      <table className="w-full border-collapse mb-2 text-xs">
        <thead>
          <tr className="border-b-2 border-zinc-800">
            <th className="text-left py-2 px-2 text-zinc-600 font-medium">日付</th>
            <th className="text-left py-2 px-2 text-zinc-600 font-medium">案件名</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">数量</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">金額（税抜）</th>
          </tr>
        </thead>
        <tbody>
          {data.laborLines.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-center text-zinc-400">稼働データなし</td>
            </tr>
          ) : (
            data.laborLines.map((line, i) => (
              <tr key={i} className="border-b border-zinc-100">
                <td className="py-1.5 px-2 text-zinc-600 tabular-nums whitespace-nowrap">{fmtDate(line.workDate)}</td>
                <td className="py-1.5 px-2 text-zinc-900">{line.projectName}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-zinc-700">{line.quantity}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-medium">{yen(line.netAmount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex justify-end gap-4 text-xs mb-6 pr-2">
        <span className="text-zinc-500">労務報酬 小計（税抜）: <span className="font-medium text-zinc-800 tabular-nums">{yen(data.laborNet)}</span></span>
        {data.laborTax > 0 && (
          <span className="text-zinc-500">消費税: <span className="tabular-nums font-medium text-zinc-800">{yen(data.laborTax)}</span></span>
        )}
      </div>

      {/* ── 立替経費明細 ─────────────────────────────────── */}
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
        【 立 替 経 費 】
      </h2>
      <table className="w-full border-collapse mb-2 text-xs">
        <thead>
          <tr className="border-b-2 border-zinc-800">
            <th className="text-left py-2 px-2 text-zinc-600 font-medium">日付</th>
            <th className="text-left py-2 px-2 text-zinc-600 font-medium">種別</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">金額（税抜）</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">消費税</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">小計</th>
          </tr>
        </thead>
        <tbody>
          {data.expenseLines.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400">立替経費なし</td>
            </tr>
          ) : (
            data.expenseLines.map((line, i) => (
              <tr key={i} className="border-b border-zinc-100">
                <td className="py-1.5 px-2 text-zinc-600 tabular-nums whitespace-nowrap">{fmtDate(line.expenseDate)}</td>
                <td className="py-1.5 px-2 text-zinc-900">
                  {EXPENSE_TYPE_LABEL[line.expenseType] ?? line.expenseType}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{yen(line.netAmount)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-zinc-500">{yen(line.taxAmount)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-medium">{yen(line.netAmount + line.taxAmount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex justify-end gap-4 text-xs mb-6 pr-2">
        <span className="text-zinc-500">経費 小計（税抜）: <span className="font-medium text-zinc-800 tabular-nums">{yen(data.expenseNet)}</span></span>
        {data.expenseTax > 0 && (
          <span className="text-zinc-500">消費税: <span className="tabular-nums font-medium text-zinc-800">{yen(data.expenseTax)}</span></span>
        )}
      </div>

      {/* ── 最終計算明細 ─────────────────────────────────── */}
      <div className="border-t-2 border-zinc-800 pt-4">
        <div className="flex justify-end">
          <div className="w-72 space-y-1.5 text-sm">
            <div className="flex justify-between text-zinc-600">
              <span>労務報酬（税込）</span>
              <span className="tabular-nums">{yen(data.laborNet + data.laborTax)}</span>
            </div>
            <div className="flex justify-between text-zinc-600">
              <span>立替経費（税込）</span>
              <span className="tabular-nums">{yen(data.expenseNet + data.expenseTax)}</span>
            </div>
            {data.deduction > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>経過措置控除（{deductPct}%減額）</span>
                <span className="tabular-nums">−{yen(data.deduction)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-zinc-900 border-t-2 border-zinc-800 pt-1.5">
              <span>差引支払額</span>
              <span className="tabular-nums text-base">{yen(data.totalAmount)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 備考 ─────────────────────────────────────────── */}
      <div className="mt-8 pt-5 border-t border-zinc-200">
        {isUnregistered && data.deduction > 0 && (
          <p className="text-xs text-zinc-400 mb-1">
            ※ インボイス未登録業者への支払いのため、経過措置（仕入税額控除{deductPct}%相当）を適用しています。
          </p>
        )}
        <p className="text-xs text-zinc-400">
          ※ ご不明点は {COMPANY.phone} までお問い合わせください。
        </p>
      </div>
    </div>
  )
}
