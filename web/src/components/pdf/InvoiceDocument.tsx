import type { InvoicePdfData } from '@/app/_actions/pdf-actions'

// 自社情報は data.company（DBの自社マスタ由来）から受け取る。
// 以前はここに定数をハードコードし NEXT_PUBLIC_COMPANY_* で上書きする作りだったが、
// 1デプロイ＝1社分しか持てずマルチテナントで破綻するため廃止した。

function yen(n: number) {
  return `¥${n.toLocaleString('ja-JP')}`
}

function fmtDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  return (
    <div className="a4-page w-[794px] min-h-[1122px] bg-white shadow-xl print:shadow-none p-12 font-sans text-zinc-900 text-sm">

      {/* ── ヘッダー ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8">
        {/* 左：タイトル + 荷主宛名 */}
        <div>
          <h1 className="text-3xl font-bold tracking-widest text-zinc-800 mb-6">請　求　書</h1>
          <p className="text-base font-bold text-zinc-900">
            {data.clientName}
            {data.contactName && ` ${data.contactName}`} 御中
          </p>
          <p className="text-xs text-zinc-500 mt-1">{data.invoiceMonth}</p>
        </div>
        {/* 右：自社情報 */}
        <div className="text-right text-xs text-zinc-600 space-y-0.5">
          <p className="text-sm font-bold text-zinc-900">{data.company.name}</p>
          <p>登録番号 {data.company.invoiceRegNumber}</p>
          {data.company.postalCode && <p>〒{data.company.postalCode}</p>}
          {data.company.address && <p>{data.company.address}</p>}
          {data.company.phone && <p>TEL: {data.company.phone}</p>}
          {data.company.email && <p>{data.company.email}</p>}
        </div>
      </div>

      {/* ── 請求書メタ情報 ──────────────────────────────────── */}
      <div className="flex gap-6 mb-6 text-xs">
        <div className="bg-zinc-50 border border-zinc-200 rounded px-4 py-2">
          <span className="text-zinc-500">請求書番号</span>
          <p className="font-mono font-semibold mt-0.5">{data.invoiceNumber}</p>
        </div>
        <div className="bg-zinc-50 border border-zinc-200 rounded px-4 py-2">
          <span className="text-zinc-500">発行日</span>
          <p className="font-semibold mt-0.5">{fmtDate(data.issueDate)}</p>
        </div>
        <div className="bg-zinc-50 border border-zinc-200 rounded px-4 py-2">
          <span className="text-zinc-500">お支払期限</span>
          <p className="font-semibold mt-0.5">{fmtDate(data.dueDate)}</p>
        </div>
      </div>

      {/* ── 請求金額ハイライト ──────────────────────────────── */}
      <div className="border-2 border-zinc-900 rounded-lg px-6 py-4 mb-6 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600">合計請求金額（税込）</span>
        <span className="text-2xl font-bold tabular-nums text-zinc-900">{yen(data.totalAmount)}</span>
      </div>

      {/* ── 明細テーブル ────────────────────────────────────── */}
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
        稼 働 明 細
      </h2>
      <table className="w-full border-collapse mb-4 text-xs">
        <thead>
          <tr className="border-b-2 border-zinc-800">
            <th className="text-left py-2 px-2 text-zinc-600 font-medium">日付</th>
            <th className="text-left py-2 px-2 text-zinc-600 font-medium">案件名</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">数量</th>
            <th className="text-right py-2 px-2 text-zinc-600 font-medium">金額（税抜）</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-zinc-400">明細データなし</td>
            </tr>
          ) : (
            data.lines.map((line, i) => (
              <tr key={i} className="border-b border-zinc-100">
                <td className="py-1.5 px-2 text-zinc-600 tabular-nums whitespace-nowrap">
                  {fmtDate(line.workDate)}
                </td>
                <td className="py-1.5 px-2 text-zinc-900">{line.projectName}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-zinc-700">{line.quantity}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-medium">{yen(line.netAmount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ── 合計欄 ──────────────────────────────────────────── */}
      <div className="flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between text-zinc-600">
            <span>小計（税抜）</span>
            <span className="tabular-nums">{yen(data.netTotal)}</span>
          </div>
          {data.isTaxable && (
            <div className="flex justify-between text-zinc-600">
              <span>消費税（10%）</span>
              <span className="tabular-nums">{yen(data.taxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-zinc-900 border-t-2 border-zinc-800 pt-1 mt-1">
            <span>合計（税込）</span>
            <span className="tabular-nums">{yen(data.totalAmount)}</span>
          </div>
        </div>
      </div>

      {/* ── 振込先 ──────────────────────────────────────────── */}
      {/* 自社マスタに口座が未登録なら欄ごと出さない（空欄の振込先を印字しないため） */}
      {data.company.bank.bankName && data.company.bank.accountNumber && (
        <div className="mt-6 rounded border border-zinc-300 px-4 py-3">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
            お 振 込 先
          </h2>
          <div className="text-xs text-zinc-800 space-y-0.5">
            <p>
              {data.company.bank.bankName} {data.company.bank.bankBranch}
              {data.company.bank.accountType && `　${data.company.bank.accountType}`}
            </p>
            <p>口座番号 {data.company.bank.accountNumber}</p>
            <p>口座名義 {data.company.bank.accountHolder}</p>
          </div>
          <p className="mt-2 text-[10px] text-zinc-400">
            ※ 振込手数料は貴社にてご負担くださいますようお願いいたします。
          </p>
        </div>
      )}

      {/* ── 備考 ────────────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-zinc-200">
        <p className="text-xs text-zinc-400">
          ※ 本請求書はインボイス制度（適格請求書等保存方式）に準拠しています。<br />
          ※ 登録番号 {data.company.invoiceRegNumber}
        </p>
      </div>
    </div>
  )
}
